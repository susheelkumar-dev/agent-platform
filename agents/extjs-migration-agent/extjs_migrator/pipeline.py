"""The migration pipeline: discover -> analyze -> rules + generate -> LLM fallback -> verify -> report.

Used by the CLI (extjs-migrate) and by the agent service (capabilities extjs.app.analyze / extjs.app.migrate).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .analyzer import Analysis, analyze
from .discover import discover
from .generate import ModulePlan, generate, relax_typecheck, summarize_classes, write_module
from .llm import LlmFixer
from .manifest import load_manifest
from .report import build_report, write_report
from .rules import framework_coverage
from .verify import verify as run_verify


@dataclass
class Options:
    source: str
    out: str
    llm: str = "none"  # none | ollama | platform
    verify: bool = False
    install: bool = True
    smoke_url: str | None = None
    smoke_selector: str | None = None
    shell: str = "compat"  # compat: Ext viewport as before | framework: hosted by @extreact/framework
    app_files: str | None = None  # framework shell: the developer's application-owned files to copy in
    packages_dir: str | None = None  # where the prebuilt @extreact packages are (default: the agent's packages/)
    eager_screens: bool = False  # load every view at startup instead of when a display first shows it
    platform_generate: Callable[[str, str], str] | None = None
    progress: Callable[[str], None] | None = None


def run_analysis(source: str) -> tuple[Analysis, dict[str, Any]]:
    info, files = discover(source)
    a = analyze(info, files)
    cov = framework_coverage(a, load_manifest())
    return a, cov


def analysis_summary(a: Analysis, cov: dict[str, Any]) -> dict[str, Any]:
    from collections import Counter
    return {
        "app": a.info.name, "namespace": a.namespace, "toolkit": a.info.toolkit, "theme": a.info.theme,
        "classes": len(a.classes), "files": len([f for f in a.files if f.kind == "js"]),
        "categories": dict(Counter(c.category for c in a.classes.values())),
        "frameworkClasses": a.framework_classes.most_common(), "frameworkAliases": a.framework_aliases.most_common(),
        "coverage": cov, "routes": a.routes, "findings": [f.as_dict() for f in a.findings],
        "loadOrder": a.order,
    }


def migrate(opts: Options) -> dict[str, Any]:
    say = opts.progress or (lambda _m: None)
    say(f"Analysing {opts.source}")
    a, cov = run_analysis(opts.source)
    say(f"{len(a.classes)} classes; framework coverage: " + ", ".join(f"{k} {len(v['missing'])} missing" for k, v in cov.items()))
    say(f"Generating the React + TypeScript project in {opts.out}")
    gen = generate(a, load_manifest(), opts.out, shell=opts.shell, app_files=opts.app_files, packages_dir=opts.packages_dir,
                   typecheck=opts.verify, lazy_screens=not opts.eager_screens)
    if gen.app_files:
        say(f"Copied {len(gen.app_files)} application file(s) from {opts.app_files}")

    fixer = LlmFixer.from_env(opts.llm, cache_dir=Path(opts.out) / ".migration-cache")
    fixer.platform_generate = opts.platform_generate
    targets = [(m, t) for m in gen.modules if m.rules for t in m.rules.llm_targets]
    if targets:
        if fixer.provider != "none" and not fixer.available():
            say(f"LLM provider {fixer.provider} is not reachable; the {len(targets)} flagged member(s) stay as they are")
            fixer.provider = "none"
        say(f"LLM pass over {len(targets)} flagged member(s) ({fixer.provider})")
        fixer.api_hint = _api_hint()
        by_module: dict[str, list[dict[str, Any]]] = {}
        for m, t in targets:
            by_module.setdefault(m.target, []).append(t)
        for m in gen.modules:
            ts = by_module.get(m.target)
            if not ts or not m.rules:
                continue
            # targets carry offsets into the original file; apply back to front on the original, then re-run rules
            original = next(f.text for f in a.files if f.path == m.source)
            new = original
            for t in sorted(_dedupe(ts), key=lambda x: x["start"], reverse=True):
                new = fixer.fix(m.source, new, t)
            if new != original:
                from .rules import apply_rules
                m.rules = apply_rules(m.source, new, a, load_manifest())
                write_module(Path(opts.out), m, checked=opts.verify)

    result: dict[str, Any] = {"analysis": a, "generated": gen, "coverage": cov, "llm": fixer, "classes": summarize_classes(a, gen.modules)}
    if opts.verify:
        say("Verifying: npm install, tsc --noEmit, vite build" + (f", smoke test {opts.smoke_url}" if opts.smoke_url else ""))
        relaxed: list[str] = []

        def relax(tsc_output: str) -> bool:
            # modules that do not type-check yet keep @ts-nocheck, the rest are checked from now on
            relaxed.extend(relax_typecheck(Path(opts.out), gen.modules, tsc_output))
            return bool(relaxed)

        result["verify"] = run_verify(opts.out, install=opts.install, smoke_url=opts.smoke_url, smoke_selector=opts.smoke_selector,
                                      relax=relax)
        result["typecheckRelaxed"] = relaxed
        checked = len(gen.modules) - len(relaxed)
        say(f"Type check: {checked} of {len(gen.modules)} ported modules are checked by tsc" + (f"; {len(relaxed)} keep @ts-nocheck (listed in the report)" if relaxed else ""))
    report = build_report(result)
    jp, mp = write_report(report, opts.out)
    say(f"Report: {mp}")
    result["report"] = report
    result["reportFiles"] = {"json": jp, "markdown": mp}
    return result


def _dedupe(targets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen, out = set(), []
    for t in targets:
        key = (t["start"], t["end"])
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
    # drop targets nested in another target
    out.sort(key=lambda t: (t["start"], -t["end"]))
    kept: list[dict[str, Any]] = []
    for t in out:
        if kept and t["start"] >= kept[-1]["start"] and t["end"] <= kept[-1]["end"]:
            kept[-1]["reason"] += "; " + t["reason"]
            continue
        kept.append(t)
    return kept


def _api_hint() -> str:
    m = load_manifest()
    top = sorted(s for s in m.statics if s.count(".") <= 1)[:400]
    return "Ext." + ", Ext.".join(top)


__all__ = ["Options", "migrate", "run_analysis", "analysis_summary", "ModulePlan"]
