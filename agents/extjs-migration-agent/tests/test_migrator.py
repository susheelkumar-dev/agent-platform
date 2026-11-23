"""Tests for the migration pipeline on a small synthetic Ext JS app (no Node needed; the build check is skipped)."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from extjs_migrator.analyzer import analyze  # noqa: E402
from extjs_migrator.discover import discover  # noqa: E402
from extjs_migrator.generate import file_order, target_for  # noqa: E402
from extjs_migrator.llm import LlmFixer, _acceptable  # noqa: E402
from extjs_migrator.manifest import load_manifest  # noqa: E402
from extjs_migrator.pipeline import Options, migrate  # noqa: E402
from extjs_migrator.rules import apply_rules, framework_coverage  # noqa: E402
from extjs_migrator.styles import convert  # noqa: E402

APP_JSON = """{
  // comments and trailing commas are allowed in Sencha app.json
  "name": "Demo", "toolkit": "classic", "theme": "theme-triton",
  "classpath": ["app"], "overrides": ["overrides"],
  "sass": { "var": ["sass/var.scss"], "src": ["sass/src.scss"], },
}"""

FILES = {
    "app.json": APP_JSON,
    "index.html": '<!DOCTYPE HTML>\n<html manifest="">\n<head><title>Demo</title>\n'
                  '<!-- The line below must be kept intact for Sencha Cmd to build your application -->\n'
                  '<script id="microloader" type="text/javascript" src="bootstrap.js"></script>\n</head>\n<body></body>\n</html>\n',
    "app.js": "Ext.application({ name: 'Demo', extend: 'Demo.Application' });\n",
    "app/Application.js": "Ext.define('Demo.Application', { extend: 'Ext.app.Application', name: 'Demo',\n"
                          "  requires: ['Demo.view.Main'], launch: function () { this.setMainView('Demo.view.Main'); } });\n",
    "app/view/Main.js": "Ext.define('Demo.view.Main', { extend: 'Demo.view.Base', xtype: 'demo-main', requires: ['Demo.util.Fmt'],\n"
                        "  controller: 'main', items: [{ xtype: 'grid', store: { fields: ['a'], data: [] }, columns: [{ dataIndex: 'a', renderer: Demo.util.Fmt.up }] }] });\n",
    "app/view/Base.js": "Ext.define('Demo.view.Base', { extend: 'Ext.panel.Panel', layout: 'fit' });\n",
    "app/view/MainController.js": "Ext.define('Demo.view.MainController', { extend: 'Ext.app.ViewController', alias: 'controller.main',\n"
                                  "  init: function () { counter = 1; var x = this; with (x) { } },\n"
                                  "  later: function () { Ext.Unknown.thing(); } });\n",
    "app/util/Fmt.js": "Ext.define('Demo.util.Fmt', { singleton: true, up: function (v) { return String(v).toUpperCase(); } });\n",
    "overrides/Button.js": "Ext.define('Demo.overrides.Button', { override: 'Ext.button.Button', scale: 'medium' });\n",
    "sass/var.scss": "$base-color: dynamic(#0f766e);\n$font-size: dynamic(14px);\n",
    "sass/src.scss": ".demo { color: $base-color; }\n@include extjs-button-ui($ui: 'x');\n",
    "resources/logo.svg": "<svg/>",
}


@pytest.fixture()
def app(tmp_path: Path) -> Path:
    for rel, text in FILES.items():
        p = tmp_path / "web" / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return tmp_path / "web"


def test_analysis_and_order(app: Path):
    info, files = discover(str(app))
    assert info.name == "Demo" and info.overrides == ["overrides"]
    a = analyze(info, files)
    assert set(a.classes) >= {"Demo.Application", "Demo.view.Main", "Demo.view.Base", "Demo.util.Fmt", "Demo.overrides.Button"}
    order = file_order(a, [f.path for f in files if f.kind == "js"])
    # override first, base before subclass, required util before the view that uses it at define time, app last
    assert order[0] == "overrides/Button.js"
    assert order.index("app/view/Base.js") < order.index("app/view/Main.js")
    assert order.index("app/util/Fmt.js") < order.index("app/view/Main.js")
    assert order[-1] == "app.js"
    assert target_for("app/view/Main.js", info.classpath, info.overrides, info.app_js) == "src/app/view/Main.ts"
    assert target_for("overrides/Button.js", info.classpath, info.overrides, info.app_js) == "src/overrides/Button.ts"


def test_rules_flag_strict_mode_and_unsupported_api(app: Path):
    info, files = discover(str(app))
    a = analyze(info, files)
    m = load_manifest()
    src = next(f for f in files if f.path == "app/view/MainController.js")
    r = apply_rules(src.path, src.text, a, m)
    codes = {f.code for f in r.findings}
    assert {"implicit-global", "with-statement", "unsupported-api"} <= codes
    assert r.implicit_globals == ["counter"]
    assert "globalThis.counter = 1" in r.text
    reasons = " ".join(t["reason"] for t in r.llm_targets)
    assert "with statement" in reasons and "Ext.Unknown.thing" in reasons
    cov = framework_coverage(a, m)
    assert cov["apis"]["missing"] == ["Ext.Unknown.thing"]


def test_styles(app: Path):
    info, files = discover(str(app))
    st = convert(files, info.sass)
    assert "--ext-base-color: #0f766e" in st.theme_css and "--ext-font-size: 14px" in st.theme_css
    assert "dynamic(" not in st.app_scss and "extjs-button-ui" not in st.app_scss
    assert any(f.code == "sass-ext-mixin" for f in st.findings)


def test_migrate_writes_project_and_report(app: Path, tmp_path: Path):
    out = tmp_path / "out"
    res = migrate(Options(source=str(app), out=str(out)))
    # the library is a package dependency, not a copy; modules import it by name
    assert not (out / "src" / "runtime").exists()
    pkg0 = json.loads((out / "package.json").read_text())
    assert pkg0["dependencies"]["@extreact/runtime"].startswith("file:") and pkg0["dependencies"]["@extreact/runtime"].endswith(".tgz")
    view = (out / "src" / "app" / "view" / "Main.ts").read_text()
    assert view.startswith("// @ts-nocheck") and "from '@extreact/runtime'" in view  # no type check run without --verify
    assert "declare var" in (out / "src" / "app-globals.d.ts").read_text()
    main = (out / "src" / "main.ts").read_text()
    assert main.index("./overrides/Button") < main.index("./app/view/Base") < main.index("./app/view/Main") < main.index("./app'")
    html = (out / "index.html").read_text()
    assert "microloader" not in html and '<script type="module" src="/src/main.ts">' in html
    assert (out / "public" / "resources" / "logo.svg").is_file()
    pkg = json.loads((out / "package.json").read_text())
    assert pkg["dependencies"]["react"] == "18.3.1" and "vite" in pkg["devDependencies"]
    rep = json.loads((out / "migration-report.json").read_text())
    assert rep["summary"]["classes"] == 7  # six classes + the Ext.application call
    assert any(a["status"] == "skipped" for a in rep["llm"])  # LLM off: flagged members are listed, not changed
    assert (out / "MIGRATION_REPORT.md").read_text().startswith("# Migration report: Demo")
    assert res["report"]["nextSteps"]


def test_llm_fix_is_checked_and_cached(tmp_path: Path):
    calls = []

    def fake(prompt: str, system: str) -> str:
        calls.append(prompt)
        return "```js\nfunction () { return Ext.Array.from(1); }\n```"

    fixer = LlmFixer(provider="platform", platform_generate=fake, cache_dir=tmp_path / "cache")
    src = "Ext.define('A', { go: function () { return Ext.Unknown.x(); } });"
    start = src.index("function")
    end = src.index("}", src.index("x();")) + 1
    tgt = {"cls": "A", "member": "go", "reason": "uses Ext.Unknown.x, which the runtime does not implement", "start": start, "end": end}
    out = fixer.fix("a.js", src, tgt)
    assert "Ext.Array.from(1)" in out and "Ext.Unknown" not in out
    assert fixer.attempts[-1].status == "applied"
    out2 = fixer.fix("a.js", src, tgt)
    assert out2 == out and fixer.attempts[-1].status == "cached" and len(calls) == 1
    ok, why = _acceptable("function () {}", "Ext.Unknown.x()", "uses Ext.Unknown.x")
    assert not ok


GT_WEB = Path(os.environ.get("GRIDTRADE_WEB", Path(__file__).resolve().parents[4] / "gridtrade-contracts-extjs" / "web"))


@pytest.mark.skipif(not (GT_WEB / "app.json").is_file(), reason="GridTrade source not present (set GRIDTRADE_WEB)")
def test_gridtrade_coverage_is_complete():
    info, files = discover(str(GT_WEB))
    a = analyze(info, files)
    cov = framework_coverage(a, load_manifest())
    assert len(a.classes) == 101
    assert all(not v["missing"] for v in cov.values()), cov


def test_framework_shell_keeps_app_owned_files(app: Path, tmp_path: Path):
    out = tmp_path / "fw"
    res = migrate(Options(source=str(app), out=str(out), shell="framework"))
    gen = res["generated"]
    assert gen.shell == "framework"
    assert (out / "src" / "main.tsx").is_file() and not (out / "src" / "main.ts").exists()
    assert not (out / "src" / "ext-hosted.ts").exists() and not (out / "src" / "framework").exists()
    ext_modules = (out / "src" / "ext-modules.ts").read_text()
    assert ext_modules.index("'@extreact/runtime/hosted'") < ext_modules.index("./app/")
    assert "classicDisplays(Ext)" in (out / "src" / "app-bridge.ts").read_text()
    assert "Adding a new display, step by step" in (out / "docs" / "DEVELOPER-GUIDE.md").read_text(encoding="utf-8")
    assert set(gen.app_defaults) == {"src/app.config.ts", "src/displays.ts", "src/app-bridge.ts", "registration/README.md"}
    pkg = json.loads((out / "package.json").read_text())
    assert pkg["dependencies"]["ag-grid-react"] == "36.2.0"
    fw_version = json.loads((ROOT / "framework" / "package.json").read_text())["version"]
    assert pkg["dependencies"]["@extreact/framework"].endswith(f"extreact-framework-{fw_version}.tgz")
    assert "paths" not in (out / "tsconfig.json").read_text()  # no aliases to copied sources
    assert "'/registry'" in (out / "vite.config.ts").read_text()
    assert '<div id="root"></div>' in (out / "index.html").read_text()

    # a developer's edit survives regeneration; --app-files copies explicit versions in
    (out / "src" / "displays.ts").write_text("// mine\n")
    extra = tmp_path / "appfiles"
    (extra / "src" / "modules" / "demo").mkdir(parents=True)
    (extra / "src" / "modules" / "demo" / "index.ts").write_text("export const demoDisplays = {};\n")
    (extra / "registration").mkdir()
    (extra / "registration" / "demo.manifest.json").write_text("{}\n")
    res = migrate(Options(source=str(app), out=str(out), shell="framework", app_files=str(extra)))
    assert (out / "src" / "displays.ts").read_text() == "// mine\n"
    assert res["generated"].app_defaults == []
    assert sorted(res["generated"].app_files) == ["registration/demo.manifest.json", "src/modules/demo/index.ts"]

    bad = tmp_path / "bad"
    (bad / "src").mkdir(parents=True)
    (bad / "src" / "main.tsx").write_text("x")
    with pytest.raises(ValueError, match="application-owned"):
        migrate(Options(source=str(app), out=str(out), shell="framework", app_files=str(bad)))

    # back to the compat shell: the Ext entry returns
    migrate(Options(source=str(app), out=str(out)))
    assert (out / "src" / "main.ts").is_file()


def test_framework_shell_loads_views_on_first_use(app: Path, tmp_path: Path):
    out = tmp_path / "lazy"
    res = migrate(Options(source=str(app), out=str(out), shell="framework"))
    ext_modules = (out / "src" / "ext-modules.ts").read_text()
    startup = [ln for ln in ext_modules.splitlines() if ln.startswith("import './")]
    # utilities, overrides and the application load at startup; the view, its base class and controller do not
    assert "import './app/util/Fmt';" in startup and "import './app/Application';" in startup
    assert not any("/view/" in ln for ln in startup)
    assert "'widget.demo-main': () => import('./ext-screens/demo-main')," in ext_modules
    assert "'Demo.view.Main': () => import('./ext-screens/demo-main')," in ext_modules
    assert "}, () => import('./ext-screens/all'));" in ext_modules
    chunk = (out / "src" / "ext-screens" / "demo-main.ts").read_text().splitlines()
    imports = [ln for ln in chunk if ln.startswith("import")]
    assert imports == ["import '../app/view/Base';", "import '../app/view/Main';", "import '../app/view/MainController';"]
    assert res["generated"].lazy_screens == {"demo-main": ["src/app/view/Base.ts", "src/app/view/Main.ts", "src/app/view/MainController.ts"]}
    assert "## Screens loaded on first use" in (out / "MIGRATION_REPORT.md").read_text(encoding="utf-8")

    # opting out: every class at startup, no chunks
    migrate(Options(source=str(app), out=str(out), shell="framework", eager_screens=True))
    assert "import './app/view/Main';" in (out / "src" / "ext-modules.ts").read_text()
    assert not (out / "src" / "ext-screens").exists()


def test_relax_typecheck_marks_only_failing_modules(tmp_path: Path):
    from extjs_migrator.generate import NOCHECK, ModulePlan, relax_typecheck
    (tmp_path / "src" / "app").mkdir(parents=True)
    for n in ("A", "B"):
        (tmp_path / "src" / "app" / f"{n}.ts").write_text("export {};\n")
    mods = [ModulePlan(source=f"app/{n}.js", target=f"src/app/{n}.ts") for n in ("A", "B")]
    out = "src/app/B.ts(3,5): error TS2339: Property 'x' does not exist on type 'Error'.\n"
    assert relax_typecheck(tmp_path, mods, out) == ["src/app/B.ts"]
    assert (tmp_path / "src" / "app" / "B.ts").read_text().startswith(NOCHECK)
    assert not (tmp_path / "src" / "app" / "A.ts").read_text().startswith("//")


def test_missing_packages_stop_generation(app: Path, tmp_path: Path):
    with pytest.raises(FileNotFoundError, match="pack:local"):
        migrate(Options(source=str(app), out=str(tmp_path / "x"), packages_dir=str(tmp_path / "nowhere")))
