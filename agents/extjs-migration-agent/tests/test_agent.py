"""Agent service tests: capabilities, folder sandboxing, analyze and migrate through the SDK test harness."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ai_agent_sdk.testing import make_context, run_agent_locally  # noqa: E402

from agent import ExtJsMigrationAgent  # noqa: E402
sys.path.insert(0, str(ROOT / "tests"))
from test_migrator import FILES  # noqa: E402


@pytest.fixture()
def env(tmp_path: Path, monkeypatch):
    for rel, text in FILES.items():
        p = tmp_path / "src" / "web" / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    monkeypatch.setenv("EXTJS_MIGRATE_ROOTS", str(tmp_path / "src"))
    monkeypatch.setenv("EXTJS_MIGRATE_OUTPUT", str(tmp_path / "out"))
    return tmp_path


def test_manifest():
    m = ExtJsMigrationAgent().manifest()
    assert m.capability_names == ["extjs.app.analyze", "extjs.app.migrate"]
    assert m.idempotent is False


@pytest.mark.anyio
async def test_analyze_and_migrate(env: Path):
    agent = ExtJsMigrationAgent()
    ctx = make_context()
    r = await run_agent_locally(agent, {"path": str(env / "src" / "web")}, capability="extjs.app.analyze", context=ctx)
    assert r.status == "success" and r.output["classes"] == 7
    assert "Ext.Unknown.thing" in r.output["coverage"]["apis"]["missing"]
    r = await run_agent_locally(agent, {"path": str(env / "src" / "web"), "output": "demo"}, capability="extjs.app.migrate", context=ctx)
    assert r.status == "success"
    assert (env / "out" / "demo" / "src" / "main.ts").is_file()
    assert r.output["report"]["markdown"].endswith("MIGRATION_REPORT.md")


@pytest.mark.anyio
async def test_paths_outside_roots_are_refused(env: Path):
    agent = ExtJsMigrationAgent()
    r = await run_agent_locally(agent, {"path": "/etc"}, capability="extjs.app.analyze", context=make_context())
    assert r.status != "success" and "outside" in (r.error.message if r.error else "")
    r = await run_agent_locally(agent, {"path": str(env / "src" / "web"), "output": "../../escape"}, capability="extjs.app.migrate", context=make_context())
    assert r.status == "success"  # the output name is reduced to a safe slug inside EXTJS_MIGRATE_OUTPUT
    assert (env / "out" / "escape").is_dir()


@pytest.mark.anyio
async def test_framework_shell_and_app_files(env: Path, tmp_path: Path):
    agent = ExtJsMigrationAgent()
    ctx = make_context()
    web = env / "src" / "web"
    app_files = env / "src" / "react-app"
    (app_files / "src").mkdir(parents=True)
    (app_files / "src" / "displays.ts").write_text("// app-owned\n", encoding="utf-8")
    r = await run_agent_locally(agent, {"path": str(web), "output": "fw", "shell": "framework", "app_files": str(app_files)},
                                capability="extjs.app.migrate", context=ctx)
    assert r.status == "success", r.error
    out = env / "out" / "fw"
    assert (out / "src" / "main.tsx").is_file() and "@extreact/framework" in (out / "package.json").read_text()
    assert (out / "src" / "displays.ts").read_text() == "// app-owned\n"

    # chat wording picks the framework shell, and <repo>/react-app next to <repo>/web is used by convention
    r = await run_agent_locally(agent, {"path": str(web), "output": "fw2", "message": "migrate to the framework shell"},
                                capability="extjs.app.migrate", context=ctx)
    assert r.status == "success" and "react-app" in r.summary
    assert (env / "out" / "fw2" / "src" / "displays.ts").read_text() == "// app-owned\n"

    # app files outside the allowed roots are refused
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    r = await run_agent_locally(agent, {"path": str(web), "shell": "framework", "app_files": str(outside)},
                                capability="extjs.app.migrate", context=ctx)
    assert r.status != "success" and "outside" in r.error.message
