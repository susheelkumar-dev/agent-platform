"""Migration report: migration-report.json (machine readable) and MIGRATION_REPORT.md (for people)."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any


def build_report(ctx: dict[str, Any]) -> dict[str, Any]:
    analysis = ctx["analysis"]
    gen = ctx["generated"]
    findings = [f.as_dict() for f in analysis.findings] + [f.as_dict() for f in gen.findings]
    levels = Counter(f["level"] for f in findings)
    verify = ctx.get("verify")
    llm = ctx.get("llm")
    return {
        "app": {"name": analysis.info.name, "namespace": analysis.namespace, "root": analysis.info.root,
                "toolkit": analysis.info.toolkit, "theme": analysis.info.theme, "framework": analysis.info.framework_version},
        "output": gen.out_dir,
        "shell": getattr(gen, "shell", "compat"),
        "appFiles": getattr(gen, "app_files", []),
        "summary": {
            "classes": len(analysis.classes),
            "modules": len(gen.modules),
            "categories": dict(Counter(c.category for c in analysis.classes.values())),
            "findings": dict(levels),
            "frameworkClassesUsed": len(analysis.framework_classes),
            "frameworkAliasesUsed": len(analysis.framework_aliases),
            "frameworkApisUsed": len(analysis.framework_apis),
        },
        "coverage": ctx.get("coverage"),
        "loadOrder": gen.order,
        "lazyScreens": getattr(gen, "lazy_screens", {}) or {},
        "classes": ctx.get("classes", []),
        "findings": findings,
        "llm": [a.__dict__ for a in (llm.attempts if llm else [])],
        "typecheckRelaxed": ctx.get("typecheckRelaxed") or [],
        "verify": None if not verify else {
            "ok": verify.ok,
            "steps": [{"name": s.name, "ok": s.ok, "skipped": s.skipped, "command": s.command, "output": s.output[-2000:]} for s in verify.steps],
            "errorsByModule": verify.errors_by_module,
        },
        "nextSteps": next_steps(ctx),
    }


def next_steps(ctx: dict[str, Any]) -> list[str]:
    steps = []
    cov = ctx.get("coverage") or {}
    missing = sum(len(v.get("missing", [])) for v in cov.values())
    if missing:
        steps.append(f"Implement or replace {missing} framework class/alias/API reference(s) the runtime lacks (see Coverage).")
    gen = ctx["generated"]
    errs = [f for f in gen.findings if f.level == "error"]
    if errs:
        steps.append(f"Fix {len(errs)} error finding(s) in the listed modules (strict-mode / ES module issues).")
    llm = ctx.get("llm")
    if llm and any(a.status in ("rejected", "failed", "skipped") for a in llm.attempts):
        steps.append("Review the members the LLM pass did not fix (LLM section).")
    v = ctx.get("verify")
    if v is None:
        steps.append("Build it: cd <output> && npm install && npm run build (or re-run with --verify).")
    elif not v.ok:
        steps.append("Fix the build errors listed under Verification, then re-run with --verify.")
    if getattr(gen, "shell", "compat") == "framework":
        steps.append("Start the display registry (display-registry) and register registration/*.manifest.json with "
                     "agentctl display register; the menu comes from there.")
        steps.append("Run the app: API_TARGET=http://host:port REGISTRY_TARGET=http://host:8130 npm run dev, sign in, walk every screen.")
        steps.append("Read docs/DEVELOPER-GUIDE.md: where everything is, how a display is registered and how to add one.")
    else:
        steps.append("Run the app against the original backend: API_TARGET=http://host:port npm run dev, then walk every screen.")
    steps.append("Keep the Ext-style code, or rewrite a screen as a template / React display when you want to; each module is independent.")
    return steps


def write_report(report: dict[str, Any], out_dir: str) -> tuple[str, str]:
    out = Path(out_dir)
    jp = out / "migration-report.json"
    jp.write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
    mp = out / "MIGRATION_REPORT.md"
    mp.write_text(markdown(report), encoding="utf-8")
    return str(jp), str(mp)


def markdown(r: dict[str, Any]) -> str:
    s = r["summary"]
    import re
    fw = r["app"].get("framework") or ""
    label = "Ext JS" + (f" {fw}" if re.match(r"^\d", str(fw)) else "") + (f" {r['app'].get('toolkit')}" if r["app"].get("toolkit") else "")
    lines = [f"# Migration report: {r['app']['name']} ({label}) to React + TypeScript", ""]
    lines += [
        f"- Source: `{r['app']['root']}`",
        f"- Output: `{r['output']}`" + (" (hosted by @extreact/framework: sign-in, menus from the display registry)" if r.get("shell") == "framework" else ""),
        f"- Classes: **{s['classes']}** in **{s['modules']}** modules ({', '.join(f'{k} {v}' for k, v in sorted(s['categories'].items()))})",
        f"- Framework usage: {s['frameworkClassesUsed']} classes, {s['frameworkAliasesUsed']} aliases (xtypes, layouts, plugins ...), {s['frameworkApisUsed']} Ext.* APIs",
        f"- Findings: " + (", ".join(f"{v} {k}" for k, v in sorted(s["findings"].items())) or "none"),
        "",
        "## How the code was ported",
        "",
        "Every Ext JS file became one ES module under `src/` written against `@extreact/runtime`, the shared library with",
        "the Ext JS-style class system, stores and components for React (a package, not copied into the app). The modules are imported in load order",
        "(what a class extends, mixes in, overrides or requires comes first). The app's SCSS is compiled by Vite, and its",
        "theme variables drive the runtime theme through CSS variables. Code that cannot run as an ES module, or uses",
        "an Ext API the runtime lacks, was reported, and with `--llm` sent to a local model for a checked rewrite.",
        "",
        "## Coverage",
        "",
    ]
    cov = r.get("coverage") or {}
    for k, v in cov.items():
        miss = v.get("missing") or []
        lines.append(f"- {k}: {v.get('used')} used, " + (f"**{len(miss)} missing**: " + ", ".join(f"`{m}`" for m in miss) if miss else "all supported"))
    if r.get("lazyScreens"):
        ls = r["lazyScreens"]
        lines += ["", "## Screens loaded on first use", "",
                  f"{len(ls)} views (screens and windows) are not part of the startup bundle. Each is downloaded the first time",
                  "a display shows it (`Ext.require`, registered in `src/ext-modules.ts`; chunks in `src/ext-screens/`):", ""]
        lines += [f"- `{xt}`: {len(ms)} module(s)" for xt, ms in ls.items()]
    if r.get("typecheckRelaxed"):
        lines += ["", "## Modules that keep @ts-nocheck", "",
                  "These ported modules still have type errors, so they start with `// @ts-nocheck`. Every other module is",
                  "checked by `tsc`. Fix the errors (run `npx tsc --noEmit` after removing the line) when you work on them:", ""]
        lines += [f"- `{m}`" for m in r["typecheckRelaxed"]]
    lines += ["", "## Verification", ""]
    v = r.get("verify")
    if not v:
        lines.append("Not run (use `--verify`).")
    else:
        lines.append(("**Passed**" if v["ok"] else "**Failed**") + "")
        for st in v["steps"]:
            mark = "skipped" if st["skipped"] else ("ok" if st["ok"] else "FAILED")
            lines.append(f"- `{st['command']}`: {mark}")
        for mod, errs in (v.get("errorsByModule") or {}).items():
            lines.append(f"  - `{mod}`: " + "; ".join(errs[:3]))
    lines += ["", "## LLM pass", ""]
    if not r["llm"]:
        lines.append("Nothing needed an LLM rewrite.")
    else:
        for a in r["llm"]:
            lines.append(f"- {a['status']}: `{a['file']}` {a.get('cls') or ''}.{a.get('member') or ''}: {a['reason']}" + (f" ({a['detail']})" if a.get("detail") else ""))
    lines += ["", "## Findings", ""]
    if not r["findings"]:
        lines.append("None.")
    else:
        lines.append("| Level | Code | Where | Message |")
        lines.append("|---|---|---|---|")
        for f in sorted(r["findings"], key=lambda x: ({"error": 0, "warning": 1, "info": 2}.get(x["level"], 3), x.get("file") or "")):
            where = (f.get("file") or "") + (f":{f['line']}" if f.get("line") else "") + (f" ({f['cls']})" if f.get("cls") else "")
            lines.append(f"| {f['level']} | {f['code']} | {where} | {f['message'].replace('|', '/')} |")
    lines += ["", "## Classes", "", "| Class | Category | Extends | Module |", "|---|---|---|---|"]
    for c in r["classes"]:
        lines.append(f"| `{c['name']}` | {c['category']} | `{c.get('extends') or c.get('frameworkBase') or ''}` | `{c.get('module') or ''}` |")
    lines += ["", "## Next steps", ""] + [f"{i + 1}. {t}" for i, t in enumerate(r["nextSteps"])] + [""]
    return "\n".join(lines)
