"""Ext JS -> React Migration Agent: the migration pipeline as an agent service on the AI Agent Platform.

Capabilities
  extjs.app.analyze  inventory an Ext JS application and check its framework usage against the runtime
  extjs.app.migrate  generate the React + TypeScript + Vite project (optionally build-verify it)

The agent reads source and writes output only under the folders allowed by EXTJS_MIGRATE_ROOTS
(os.pathsep-separated; default: the current directory) and EXTJS_MIGRATE_OUTPUT (default ./migrations).
The LLM fallback uses the platform's LLM gateway (llm: "platform") or a local Ollama (llm: "ollama").
"""

from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from ai_agent_sdk import AgentContext, AgentRequest, AgentResult, Artifact, BaseAgent, capability

try:
    from .extjs_migrator.pipeline import Options, analysis_summary, migrate, run_analysis
except ImportError:  # run as a script from this folder
    from extjs_migrator.pipeline import Options, analysis_summary, migrate, run_analysis


class AnalyzeInput(BaseModel):
    model_config = ConfigDict(extra="allow")
    message: str = ""
    path: str | None = Field(default=None, description="Ext JS app folder (with app.json) or class folder")


class MigrateInput(AnalyzeInput):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    output: str | None = Field(default=None, description="output folder name under EXTJS_MIGRATE_OUTPUT")
    llm: str = Field(default="none", pattern="^(none|ollama|platform)$")
    verify: bool | None = Field(default=None, description="build-check the result; when omitted, true if the message says build or verify")
    shell: str | None = Field(default=None, pattern="^(compat|framework)$",
                       description="compat: Ext viewport; framework: @extreact/framework shell with sign-in and registry menus")
    app_files: str | None = Field(default=None, alias="appFiles",
                                  description="framework shell: folder of application-owned files to copy in (under EXTJS_MIGRATE_ROOTS)")


def _load_env_file(path: Path) -> None:
    """Export KEY=VALUE lines from the agent's .env into os.environ (real environment variables win).

    The SDK's settings read .env only for their own fields; EXTJS_MIGRATE_* and OLLAMA_URL are read through
    os.environ, so without this a value set only in .env would be ignored.
    """
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.split(" #", 1)[0].strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file(Path.cwd() / ".env")
_load_env_file(Path(__file__).resolve().parent / ".env")


def _allowed_roots() -> list[Path]:
    raw = os.environ.get("EXTJS_MIGRATE_ROOTS") or os.getcwd()
    return [Path(p).expanduser().resolve() for p in raw.split(os.pathsep) if p]


def _inside_roots(p: Path, what: str) -> Path:
    p = p.expanduser().resolve()
    if not any(p == r or r in p.parents for r in _allowed_roots()):
        raise PermissionError(f"{p} is outside the folders this agent may read (EXTJS_MIGRATE_ROOTS)")
    if not p.exists():
        raise FileNotFoundError(f"{what} {p} does not exist")
    return p


def _resolve_source(path: str | None, message: str) -> Path:
    if not path:
        m = re.search(r"([A-Za-z]:\\[^\s\"']+|/[^\s\"']+)", message or "")
        path = m.group(1) if m else None
    if not path:
        raise ValueError("Give the Ext JS application folder in 'path' (or in the message).")
    return _inside_roots(Path(path), "Source folder")


def _resolve_output(name: str | None, source: Path) -> Path:
    base = Path(os.environ.get("EXTJS_MIGRATE_OUTPUT", "migrations")).expanduser().resolve()
    stem = source.parent.name if source.name.lower() in ("web", "app", "src", "client") else source.name  # <repo>/web -> <repo>
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", name or (stem + "-react")).strip("-.") or "app-react"
    out = (base / slug).resolve()
    if base not in out.parents:
        raise PermissionError("output must stay inside EXTJS_MIGRATE_OUTPUT")
    return out


class ExtJsMigrationAgent(BaseAgent):
    agent_id = "extjs-migration-agent"
    name = "Ext JS to React Migration Agent"
    version = "1.0.0"
    description = ("Analyses an Ext JS 6/7 classic application and migrates it to React + TypeScript + Vite on a React "
                   "implementation of the Ext JS API, with a build check and a migration report.")
    owner = "Susheel Kumar"
    capabilities = [
        capability("extjs.app.analyze", "Inventory an Ext JS app: classes, views, stores, framework usage, migration coverage",
                   keywords=["ext js", "extjs", "sencha", "analyze ext", "migration assessment", "ext js inventory"],
                   examples=["Analyse the Ext JS app in /work/gridtrade/web", "How much of our Ext JS app can be migrated?"],
                   permissions=["migration.read"], input_model=AnalyzeInput),
        capability("extjs.app.migrate", "Migrate an Ext JS app to React + TypeScript + Vite",
                   keywords=["migrate ext js", "ext js to react", "convert extjs", "sencha to react", "react migration"],
                   examples=["Migrate the Ext JS app in /work/gridtrade/web to React", "Convert our Sencha app to React and build it"],
                   permissions=["migration.write"], input_model=MigrateInput),
    ]
    permissions = ["migration.read"]
    timeout_seconds = 1800
    idempotent = False  # writes an output folder
    tags = ["migration", "extjs", "react", "frontend"]

    def input_model_for(self, capability_name: str):
        return MigrateInput if capability_name == "extjs.app.migrate" else AnalyzeInput

    async def execute(self, request: AgentRequest, context: AgentContext) -> AgentResult:
        q = request.input
        cap = request.capability or ("extjs.app.migrate" if re.search(r"\b(migrate|convert)\b", q.get("message", ""), re.I) else "extjs.app.analyze")
        try:
            src = _resolve_source(q.get("path"), q.get("message", ""))
        except (ValueError, PermissionError, FileNotFoundError) as e:
            return AgentResult.failure(str(e), code="BAD_INPUT", category="VALIDATION")
        if cap == "extjs.app.analyze":
            a, cov = await asyncio.to_thread(run_analysis, str(src))
            s = analysis_summary(a, cov)
            return AgentResult.success(_trim(s), summary=_analysis_text(s), artifacts=_analysis_artifacts(s))

        out = _resolve_output(q.get("output"), src)
        msg = q.get("message", "")
        # Chat users cannot pass fields, so the message may ask for the framework shell or a build check.
        shell = q.get("shell") or ("framework" if re.search(r"\bframework\b", msg, re.I) else "compat")
        app_files_raw = q.get("app_files") or q.get("appFiles")
        if shell == "framework" and not app_files_raw:
            # convention: the app's own files sit next to the output, <output>-app (gridtrade-react -> gridtrade-react-app),
            # outside the Ext JS repository; <repo>/react-app is the older place, still read when present
            for cand in (Path(out).with_name(Path(out).name + "-app"), src.parent / "react-app"):
                if cand.is_dir():
                    app_files_raw = str(cand)
                    break
        verify = bool(q["verify"]) if q.get("verify") is not None else bool(re.search(r"\b(build|verify)\b", msg, re.I))
        if shell not in ("compat", "framework"):
            return AgentResult.failure("shell must be 'compat' or 'framework'", code="BAD_INPUT", category="VALIDATION")
        try:
            app_files = str(_inside_roots(Path(app_files_raw), "App files folder")) if app_files_raw else None
        except (PermissionError, FileNotFoundError) as e:
            return AgentResult.failure(str(e), code="BAD_INPUT", category="VALIDATION")
        if app_files and shell != "framework":
            return AgentResult.failure("app_files needs shell 'framework'", code="BAD_INPUT", category="VALIDATION")
        llm = q.get("llm", "none")
        loop = asyncio.get_running_loop()
        gen = None
        if llm == "platform" and self.platform is not None:
            def gen(prompt: str, system: str) -> str:
                fut = asyncio.run_coroutine_threadsafe(self.platform.generate(context, prompt, system=system, max_tokens=2048, purpose="code-migration"), loop)
                return fut.result(timeout=180).content
        opts = Options(source=str(src), out=str(out), llm=llm if (llm != "platform" or gen) else "none", verify=verify, shell=shell, app_files=app_files, platform_generate=gen)
        res = await asyncio.to_thread(migrate, opts)
        rep = res["report"]
        s = rep["summary"]
        text = f"Migrated {rep['app']['name']}: {s['classes']} classes into {s['modules']} React/TypeScript modules in {out}"
        text += " on the framework shell" + (f" with the app files from {app_files}." if app_files else ".") if shell == "framework" else "."
        if rep.get("verify"):
            text += " Build check " + ("passed." if rep["verify"]["ok"] else "failed; see the report.")
        return AgentResult.success(
            {"output": str(out), "report": res["reportFiles"], "summary": s, "coverage": rep["coverage"], "verify": rep.get("verify"), "nextSteps": rep["nextSteps"]},
            summary=text,
            artifacts=[
                Artifact.metric("Classes migrated", s["classes"], format="number"),
                Artifact.table("Framework coverage", [("area", "Area", "string"), ("used", "Used", "number"), ("missing", "Missing", "number")],
                               [{"area": k, "used": v["used"], "missing": len(v["missing"])} for k, v in (rep["coverage"] or {}).items()]),
                Artifact.text("\n".join(f"{i + 1}. {t}" for i, t in enumerate(rep["nextSteps"])), title="Next steps"),
            ],
        )


def _trim(s: dict[str, Any]) -> dict[str, Any]:
    s = dict(s)
    s["findings"] = s["findings"][:200]
    return s


def _analysis_text(s: dict[str, Any]) -> str:
    missing = sum(len(v["missing"]) for v in s["coverage"].values())
    return (f"{s['app']} has {s['classes']} classes in {s['files']} files. "
            + ("Every framework class, alias and API it uses is supported by the runtime." if not missing
               else f"{missing} framework reference(s) are not supported yet."))


def _analysis_artifacts(s: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        Artifact.metric("Classes", s["classes"], format="number"),
        Artifact.table("Classes by category", [("category", "Category", "string"), ("count", "Classes", "number")],
                       [{"category": k, "count": v} for k, v in sorted(s["categories"].items())]),
        Artifact.table("Framework coverage", [("area", "Area", "string"), ("used", "Used", "number"), ("missing", "Missing", "string")],
                       [{"area": k, "used": v["used"], "missing": ", ".join(v["missing"]) or "none"} for k, v in s["coverage"].items()]),
    ]
