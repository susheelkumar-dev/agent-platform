"""Writes the React + TypeScript + Vite project for an analysed Ext JS application.

Layout of the output:

    package.json, tsconfig.json, vite.config.ts, index.html
    public/resources/...           the app's resources folder
    src/app/..., src/overrides/... one ES module per Ext JS source file, code ported by the rules, written against
                                   @extreact/runtime (Ext JS-style classes, stores and components for React)
    src/app-globals.d.ts           the application namespaces (GT, ...) for the type checker
    src/styles/theme.css, app.scss theme variables and the app's own SCSS
    src/main.ts                    imports the runtime, styles, then every module in dependency order
    migration-report.json / MIGRATION_REPORT.md (written by the report step)

With shell="framework" the same modules are hosted by @extreact/framework instead of the Ext viewport:

    src/ext-modules.ts             the Ext-style classes in load order, defined but not launched (the shell creates screens)
    src/main.tsx                   renders <FrameworkApp> (generator-owned, rewritten on every run)
    src/app.config.ts, src/displays.ts, src/app-bridge.ts, src/modules/**, registration/**
                                   application-owned: written once if missing, never overwritten; --app-files
                                   copies a developer's versions over them

The libraries are not copied: package.json depends on the prebuilt, versioned packages that ship with the agent
(packages/extreact-runtime-<v>.tgz, packages/extreact-framework-<v>.tgz) through file: references, so every
migrated application uses the same library code, installs offline and upgrades by changing a version.
"""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .analyzer import Analysis
from .jsast import try_literal
from .manifest import RUNTIME_DIR, RuntimeManifest
from .model import Finding
from .rules import FileRules, apply_rules
from .styles import convert as convert_styles

FRAMEWORK_DIR = RUNTIME_DIR.parent / "framework"
PACKAGES_DIR = RUNTIME_DIR.parent / "packages"

VERSIONS = {
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "@fortawesome/fontawesome-free": "5.15.4",
    "@fontsource/open-sans": "5.0.28",
    "vite": "5.4.2",
    "typescript": "5.5.4",
    "sass": "1.77.8",
    "@types/react": "18.3.3",
    "@types/react-dom": "18.3.0",
    "ag-grid-community": "36.2.0",
    "ag-grid-react": "36.2.0",
    "write-excel-file": "4.1.1",
}
# ui-forge.*: the UI Forge lock and configuration travel with the displays they describe
APP_OWNED = ("src/app.config.ts", "src/displays.ts", "src/app-bridge.ts", "src/modules", "registration", "ui-forge.lock.json", "ui-forge.config.json")


@dataclass
class ModulePlan:
    source: str  # app-relative path of the Ext JS file
    target: str  # output-relative path of the module (src/...)
    classes: list[str] = field(default_factory=list)
    rules: FileRules | None = None


@dataclass
class GenerateResult:
    out_dir: str
    modules: list[ModulePlan] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)
    order: list[str] = field(default_factory=list)  # module targets in import order
    lazy_screens: dict[str, list[str]] = field(default_factory=dict)  # xtype -> modules loaded on first use
    shell: str = "compat"
    app_files: list[str] = field(default_factory=list)  # files copied from --app-files
    app_defaults: list[str] = field(default_factory=list)  # app-owned files created because they were missing


def target_for(path: str, classpath: list[str], overrides: list[str], app_js: str | None) -> str:
    p = path
    if app_js and p == app_js:
        return "src/" + re.sub(r"\.js$", ".ts", Path(p).name)
    for ov in overrides:
        ov = ov.rstrip("/")
        if p == ov or p.startswith(ov + "/"):
            rest = p[len(ov):].lstrip("/") or Path(p).name
            return "src/overrides/" + re.sub(r"\.js$", ".ts", rest)
    for cp in classpath:
        cp = cp.rstrip("/")
        if cp in (".", ""):
            return "src/app/" + re.sub(r"\.js$", ".ts", p)
        if p == cp or p.startswith(cp + "/"):
            rest = p[len(cp):].lstrip("/") or Path(p).name
            return "src/app/" + re.sub(r"\.js$", ".ts", rest)
    return "src/app/" + re.sub(r"\.js$", ".ts", p)


def file_order(analysis: Analysis, files: list[str]) -> list[str]:
    """Files in load order: a file comes after the files defining what it extends / mixes in / overrides,
    and (when that does not create a cycle) after what it requires. The application file is last."""
    by_class = {c.name: c.file for c in analysis.classes.values()}
    hard: dict[str, set[str]] = {f: set() for f in files}
    soft: dict[str, set[str]] = {f: set() for f in files}
    for cls in analysis.classes.values():
        f = cls.file
        if f not in hard:
            continue
        for d in analysis.deps.get(cls.name, ()):
            if by_class.get(d) and by_class[d] != f:
                hard[f].add(by_class[d])
        for r in cls.requires:
            if r in by_class and by_class[r] != f:
                soft[f].add(by_class[r])
    app_files = {c.file for c in analysis.classes.values() if c.kind == "application"}
    if analysis.info.app_js:
        app_files.add(analysis.info.app_js)
    override_files = {c.file for c in analysis.classes.values() if c.kind == "override"}
    order: list[str] = []
    state: dict[str, int] = {}

    def visit(f: str) -> None:
        if state.get(f) == 2:
            return
        if state.get(f) == 1:
            return  # cycle: the edge is dropped (soft requires) or reported by the analyzer (hard)
        state[f] = 1
        for d in sorted(hard[f]):
            visit(d)
        for d in sorted(soft[f]):
            if state.get(d) != 1:
                visit(d)
        state[f] = 2
        order.append(f)

    # overrides of framework classes first (Sencha Cmd puts them right after the framework), then classes
    for f in sorted(files, key=lambda x: (x in app_files, x not in override_files, x)):
        if f not in app_files:
            visit(f)
    for f in sorted(app_files):
        if f in hard:
            visit(f)
    return order


def _rel_import(from_target: str, to: str) -> str:
    """Import specifier from a module under src/ to src/<to>."""
    depth = len(Path(from_target).parent.relative_to("src").parts)
    return ("/".join([".."] * depth) if depth else ".") + "/" + to


def package_version(name: str) -> str:
    folder = RUNTIME_DIR if name == "runtime" else FRAMEWORK_DIR
    return json.loads((folder / "package.json").read_text(encoding="utf-8"))["version"]


def package_tarball(name: str, packages_dir: Path | None = None) -> Path:
    """The prebuilt package (npm pack output) the application installs: packages/extreact-<name>-<version>.tgz."""
    d = Path(packages_dir) if packages_dir else PACKAGES_DIR
    p = d / f"extreact-{name}-{package_version(name)}.tgz"
    if not p.is_file():
        raise FileNotFoundError(f"{p} is missing: build the packages once with `npm run pack:local` in "
                                f"agents/extjs-migration-agent/{name} (scripts\\build-packages.ps1 in ai-agent-platform does both)")
    return p.resolve()


def file_spec(target: Path, out: Path) -> str:
    """npm file: specifier, relative to the project when possible (portable between machines with the same layout)."""
    import os
    try:
        rel = os.path.relpath(target, out.resolve())
    except ValueError:  # another drive on Windows
        rel = str(target)
    return "file:" + rel.replace("\\", "/")


def remove_library_copies(out: Path) -> None:
    """Older versions of the agent copied the libraries into the project; they are packages now."""
    for rel in ("src/runtime", "src/framework", "src/ext-hosted.ts"):
        p = out / rel
        if p.is_dir():
            shutil.rmtree(p)
        elif p.is_file():
            p.unlink()


def write_globals(out: Path, analysis: Analysis) -> None:
    """Ext JS code refers to its classes through namespace globals (GT.util.Format); declare them for tsc."""
    roots = sorted({c.name.split(".")[0] for c in analysis.classes.values() if "." in c.name and not c.name.startswith("Ext.")}
                   | ({analysis.namespace} if analysis.namespace else set()))
    lines = ["/* Generated by extjs-migration-agent: the application namespaces created by Ext.define. */", ""]
    lines += [f"declare var {r}: any;" for r in roots if re.fullmatch(r"[A-Za-z_$][\w$]*", r)]
    (out / "src" / "app-globals.d.ts").write_text("\n".join(lines) + "\n", encoding="utf-8")


def generate(analysis: Analysis, manifest: RuntimeManifest, out_dir: str, *, app_title: str | None = None,
             shell: str = "compat", app_files: str | None = None, packages_dir: str | None = None,
             typecheck: bool = False, lazy_screens: bool = True) -> GenerateResult:
    if shell not in ("compat", "framework"):
        raise ValueError(f"unknown shell '{shell}' (compat | framework)")
    info = analysis.info
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    res = GenerateResult(out_dir=str(out), shell=shell)
    root = Path(info.root)
    # resolve the packages first: a missing build stops here, before anything is written
    tarballs = {"runtime": package_tarball("runtime", Path(packages_dir) if packages_dir else None)}
    if shell == "framework":
        tarballs["framework"] = package_tarball("framework", Path(packages_dir) if packages_dir else None)
    remove_library_copies(out)

    js_files = [f for f in analysis.files if f.kind == "js"]
    paths = [f.path for f in js_files]
    order = file_order(analysis, paths)
    text_of = {f.path: f.text for f in js_files}
    classes_by_file: dict[str, list[str]] = {}
    for c in analysis.classes.values():
        classes_by_file.setdefault(c.file, []).append(c.name)

    # ---- modules
    for path in order:
        target = target_for(path, info.classpath, info.overrides, info.app_js)
        rules = apply_rules(path, text_of[path], analysis, manifest)
        mp = ModulePlan(source=path, target=target, classes=sorted(classes_by_file.get(path, [])), rules=rules)
        res.modules.append(mp)
        res.findings.extend(rules.findings)
        write_module(out, mp, checked=typecheck)
    res.order = [m.target for m in res.modules]

    # ---- styles (the component theme comes from @extreact/runtime/theme.css)
    write_globals(out, analysis)
    st = convert_styles(analysis.files, info.sass)
    res.findings.extend(st.findings)
    styles = out / "src" / "styles"
    styles.mkdir(parents=True, exist_ok=True)
    (styles / "theme.css").write_text(st.theme_css or ":root {}\n", encoding="utf-8")
    (styles / "app.scss").write_text(st.app_scss or "// no sass in the source app\n", encoding="utf-8")

    # ---- resources
    res_dir = root / "resources"
    if res_dir.is_dir():
        dest = out / "public" / "resources"
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(res_dir, dest)

    # ---- entry, html, config
    name = analysis.namespace or info.name or "App"
    if shell == "framework":
        write_framework_entry(out, res.modules, analysis if lazy_screens else None, res)
        write_framework_index_html(out, app_title or name)
        write_project_files(out, name, shell="framework", tarballs=tarballs)
        guide = RUNTIME_DIR.parent / "docs" / "DEVELOPER-GUIDE.md"
        if guide.is_file():  # how displays are registered and how the app works, next to the code (rewritten every run)
            (out / "docs").mkdir(exist_ok=True)
            shutil.copyfile(guide, out / "docs" / "DEVELOPER-GUIDE.md")
        res.app_defaults = write_app_defaults(out, name, app_title or name)
        if app_files:
            res.app_files = copy_app_files(Path(app_files), out)
    else:
        write_main(out, res.modules)
        write_index_html(out, root, info.index_html, app_title or name)
        write_project_files(out, name, tarballs=tarballs)
    return res


HEADER = """{nocheck}/*
 * Ported from {source} (Ext JS) by extjs-migration-agent.
 * Written against @extreact/runtime (the Ext JS-style class system, stores and components for React), so it keeps
 * its Ext.define structure. Edit it like any other module.
 */
import {{ Ext }} from '@extreact/runtime';
"""

NOCHECK = "// @ts-nocheck: type errors remain in this ported module (see MIGRATION_REPORT.md); remove when fixed\n"


def write_module(out: Path, mp: ModulePlan, checked: bool = False) -> None:
    """checked=False: the module starts with @ts-nocheck (no type check was run during migration). With --verify the
    pipeline writes modules without it and adds it back only to modules that still fail tsc (relax_typecheck)."""
    target = out / mp.target
    target.parent.mkdir(parents=True, exist_ok=True)
    body = mp.rules.text if mp.rules else ""
    head = HEADER.format(source=mp.source, nocheck="" if checked else NOCHECK)
    target.write_text(head + "void Ext;\n\n" + body.rstrip() + "\n", encoding="utf-8")


def relax_typecheck(out: Path, modules: list[ModulePlan], tsc_output: str) -> list[str]:
    """Adds @ts-nocheck to the ported modules tsc reported errors in. Returns their paths."""
    failing = {m.group(1).replace("\\", "/") for m in re.finditer(r"^(src/[^\s(]+\.tsx?)\(\d+,\d+\): error", tsc_output, re.M)}
    relaxed = []
    for mp in modules:
        if mp.target in failing:
            p = out / mp.target
            text = p.read_text(encoding="utf-8")
            if not text.startswith("// @ts-nocheck"):
                p.write_text(NOCHECK + text, encoding="utf-8")
            relaxed.append(mp.target)
    return relaxed


def write_main(out: Path, modules: list[ModulePlan]) -> None:
    lines = [
        "/* Entry point generated by extjs-migration-agent: runtime and styles first, then the app modules in load order. */",
        "import '@fontsource/open-sans/400.css';",
        "import '@fontsource/open-sans/600.css';",
        "import '@fontsource/open-sans/700.css';",
        "import '@fortawesome/fontawesome-free/css/all.min.css';",
        "import '@extreact/runtime/theme.css';",
        "import './styles/theme.css';",
        "import './styles/app.scss';",
        "import '@extreact/runtime';",
        "",
    ]
    for m in modules:
        lines.append("import './" + m.target[len("src/"):].removesuffix(".ts") + "';")
    (out / "src" / "main.ts").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _is_view_module(target: str) -> bool:
    """Ext JS MVVM keeps views, their controllers and view models under a view/ folder: those load on first use."""
    return "/view/" in target and not target.startswith("src/overrides/")


def split_screens(analysis: Analysis, modules: list[ModulePlan]) -> tuple[list[ModulePlan], dict[str, list[ModulePlan]], list[ModulePlan], list[str]]:
    """Startup modules, per-screen chunks and the rest of the lazy modules (in load order).

    Everything outside view/ folders (overrides, utilities, models, stores, base classes, the application) loads at
    startup. A view loads when a display first shows it, together with what it references (its controller, view
    model, the windows it opens, other views it nests), in load order. A view folder class that a startup class
    references stays at startup. Returns (startup, {xtype: chunk}, every lazy module, notes)."""
    by_class = {c: m for m in modules for c in m.classes}
    index = {m.target: i for i, m in enumerate(modules)}
    def is_app(c: str) -> bool:
        cls = analysis.classes.get(c)
        return cls is not None and (cls.kind == "application" or (cls.framework_base or "") == "Ext.app.Application")
    app_targets = {m.target for m in modules if any(is_app(c) for c in m.classes)}

    def edges(m: ModulePlan) -> set[str]:
        out: set[str] = set()
        if m.target in app_targets:  # the application's views / mainView are not created in hosted mode
            for c in m.classes:
                out |= {by_class[d].target for d in analysis.deps.get(c, ()) if d in by_class}
            return out - {m.target}
        for c in m.classes:
            for d in set(analysis.deps.get(c, ())) | set(analysis.refs.get(c, ())):
                if d in by_class:
                    out.add(by_class[d].target)
        return out - {m.target}

    by_target = {m.target: m for m in modules}
    graph = {m.target: edges(m) for m in modules}
    lazy = {m.target for m in modules if _is_view_module(m.target)}
    notes: list[str] = []

    startup: set[str] = set()
    stack = [m.target for m in modules if m.target not in lazy]
    while stack:
        t = stack.pop()
        if t in startup:
            continue
        startup.add(t)
        for d in graph[t]:
            if d not in startup:
                if d in lazy:
                    notes.append(f"{d} loads at startup: {t} references it")
                stack.append(d)

    def closure(t: str) -> list[ModulePlan]:
        seen: set[str] = set()
        todo = [t]
        while todo:
            x = todo.pop()
            if x in seen or x in startup:
                continue
            seen.add(x)
            todo.extend(graph[x])
        return [by_target[x] for x in sorted(seen, key=index.__getitem__)]

    chunks: dict[str, list[ModulePlan]] = {}
    for m in modules:
        if m.target in startup:
            continue
        for c in m.classes:
            cls = analysis.classes.get(c)
            for xt in (cls.xtypes if cls is not None else []):
                chunks.setdefault(xt, closure(m.target))
    rest = [m for m in modules if m.target not in startup]
    return [m for m in modules if m.target in startup], chunks, rest, sorted(set(notes))


def _imports(modules: list[ModulePlan], prefix: str) -> list[str]:
    return [f"import '{prefix}" + m.target[len("src/"):].removesuffix(".ts") + "';" for m in modules]


def write_framework_entry(out: Path, modules: list[ModulePlan], analysis: Analysis | None = None,
                          res: GenerateResult | None = None) -> None:
    """src/ext-modules.ts: the Ext-style classes needed at startup, in load order. With an analysis, each view (the
    screens and windows, with their controllers and view models) goes into its own chunk under src/ext-screens/ and
    is registered with Ext.Loader, so it is downloaded the first time a display shows it."""
    src = out / "src"
    (src / "main.ts").unlink(missing_ok=True)  # the compat entry, when switching modes
    screens_dir = src / "ext-screens"
    if screens_dir.exists():
        shutil.rmtree(screens_dir)
    lines = ["/* Generated by extjs-migration-agent: the application's Ext-style classes in load order. The shell creates",
             " * the screens, so @extreact/runtime/hosted comes first: Ext.application() registers without launching. */",
             "import '@extreact/runtime/hosted';", ""]
    startup, chunks, rest = modules, {}, []
    if analysis is not None:
        startup, chunks, rest, notes = split_screens(analysis, modules)
        if res is not None:
            res.lazy_screens = {xt: [m.target for m in ms] for xt, ms in sorted(chunks.items())}
            res.findings.extend(Finding("info", "startup-view", n) for n in notes)
    lines += _imports(startup, "./")
    if chunks:
        screens_dir.mkdir(parents=True)
        head = "/* Generated by extjs-migration-agent: loaded on first use (Ext.require). Classes in load order. */"
        names: dict[str, list[str]] = {}
        for xt, ms in sorted(chunks.items()):
            fname = re.sub(r"[^A-Za-z0-9_-]", "_", xt)
            (screens_dir / f"{fname}.ts").write_text("\n".join([head, *_imports(ms, "../")]) + "\n", encoding="utf-8")
            names[fname] = ["widget." + xt]
        # class names too, so Ext.require('GT.view.trade.TradeWindow') works like the alias
        for m in rest:
            for c in m.classes:
                cls = analysis.classes.get(c) if analysis else None
                for xt in (cls.xtypes if cls is not None else []):
                    if xt in chunks:
                        names[re.sub(r"[^A-Za-z0-9_-]", "_", xt)].append(c)
        (screens_dir / "all.ts").write_text("\n".join([head, *_imports(rest, "../")]) + "\n", encoding="utf-8")
        lines += ["", "// Screens and windows: downloaded the first time a display shows them (see src/ext-screens/).",
                  "import { Ext } from '@extreact/runtime';", "", "Ext.Loader.register({"]
        for fname, keys in sorted(names.items()):
            for k in sorted(set(keys)):
                lines.append(f"  '{k}': () => import('./ext-screens/{fname}'),")
        lines += ["}, () => import('./ext-screens/all'));"]
    (src / "ext-modules.ts").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (src / "main.tsx").write_text("""/* Generated by extjs-migration-agent (rewritten on every run). Application code goes in app.config.ts,
 * displays.ts, app-bridge.ts and modules/. */
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import '@fontsource/open-sans/700.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import '@extreact/runtime/theme.css';
import './styles/theme.css';
import './styles/app.scss';
import '@extreact/framework/styles.css';
import './ext-modules';
import { createRoot } from 'react-dom/client';
import { FrameworkApp } from '@extreact/framework';
import { appConfig } from './app.config';
import { displays } from './displays';
import { bridge } from './app-bridge';

createRoot(document.getElementById('root')!).render(<FrameworkApp config={appConfig} displays={displays} bridge={bridge} />);
""", encoding="utf-8")


def write_framework_index_html(out: Path, title: str) -> None:
    (out / "index.html").write_text(f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{title}</title>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
</body>
</html>
""", encoding="utf-8")


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-") or "app"


def write_app_defaults(out: Path, name: str, title: str) -> list[str]:
    """Application-owned starting files. Written only when missing, so a developer's changes are never lost."""
    files = {
        "src/app.config.ts": f"""import type {{ AppConfig }} from '@extreact/framework';

/** Where the shell finds the backend, the display registry, and which display opens first. */
export const appConfig: AppConfig = {{
  appId: '{_slug(name)}',
  title: {json.dumps(title)},
  apiBase: '/api',
  registryBase: '/registry/api/v1',
  // home: 'dashboard',
}};
""",
        "src/displays.ts": """/**
 * The approved display registry: every implementation key a registered display may use. Keys come from
 * module manifests (registration/*.json); only what is listed here can be rendered.
 */
import { builtinDisplays, mergeDisplays } from '@extreact/framework';
import { screens } from './app-bridge';

export const displays = mergeDisplays(
  builtinDisplays,  // SummaryDisplay, EntryForm, MasterSlave: screens configured purely by metadata
  screens,          // 'ExtScreen': the application's Ext-style views, by xtype (display type 'custom')
  // module registries are added here, e.g. referenceDisplays from './modules/reference'
);
""",
        "src/app-bridge.ts": """/**
 * The application's Ext-style views inside the shell. The hosting itself comes from @extreact/framework:
 *  - screens: the registry entry rendering a view by the xtype in its manifest config;
 *  - bridge:  signs every Ext.Ajax / store request with the user's token. Add what the old Application.launch did
 *             (load lookups, set up session helpers, listen to application events) in start().
 */
import { Ext } from '@extreact/runtime';
import { classicBridge, classicDisplays } from '@extreact/framework';

export const screens = classicDisplays(Ext);

export const bridge = classicBridge(Ext, {
  async start(_shell) {
    // e.g. await MyApp.util.Lookups.preload();
  },
});
""",
        "registration/README.md": """# Registration

Each `*.manifest.json` here declares a module's displays and menu entries for the display registry.
Register them with:

    agentctl display register registration/*.manifest.json --app-api http://localhost:5080/api --registry http://localhost:8130
""",
    }
    written = []
    for rel, text in files.items():
        p = out / rel
        if p.exists():
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        written.append(rel)
    return written


def copy_app_files(src: Path, out: Path) -> list[str]:
    """Copies a developer's application files (bridge, displays, modules, manifests) into the project."""
    if not src.is_dir():
        raise FileNotFoundError(f"--app-files {src} is not a folder")
    copied = []
    for f in sorted(p for p in src.rglob("*") if p.is_file()):
        rel = f.relative_to(src).as_posix()
        if rel.startswith(("node_modules/", "dist/")):
            continue
        if not rel.startswith(APP_OWNED) and rel != "README.md":
            raise ValueError(f"--app-files may only contain application-owned files ({', '.join(APP_OWNED)}); found {rel}")
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dest)
        copied.append(rel)
    return copied


def write_index_html(out: Path, root: Path, index_html: str | None, title: str) -> None:
    html = ""
    if index_html and (root / index_html).is_file():
        html = (root / index_html).read_text(encoding="utf-8")
    if not html:
        html = f"<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"UTF-8\">\n<title>{title}</title>\n</head>\n<body>\n</body>\n</html>\n"
    html = re.sub(r"<!--\s*The line below must be kept intact[^>]*-->\s*", "", html)
    html = re.sub(r"<script[^>]*(microloader|bootstrap\.js|ext-all|ext\.js)[^>]*>\s*</script>\s*", "", html, flags=re.I)
    html = re.sub(r"<html\s+manifest=\"[^\"]*\"", "<html", html)
    html = html.replace('<meta http-equiv="X-UA-Compatible" content="IE=edge">', "")
    if "/src/main.ts" not in html:
        html = html.replace("</body>", '    <script type="module" src="/src/main.ts"></script>\n</body>')
    (out / "index.html").write_text(html, encoding="utf-8")


def write_project_files(out: Path, name: str, shell: str = "compat", tarballs: dict[str, Path] | None = None) -> None:
    slug = _slug(name)
    framework = shell == "framework"
    pkg = {
        "name": f"{slug}-react",
        "version": "1.0.0",
        "private": True,
        "type": "module",
        "description": f"{name} migrated from Ext JS to React + TypeScript by extjs-migration-agent.",
        "scripts": {
            "dev": "vite",
            "build": "tsc --noEmit && vite build",
            "preview": "vite preview",
            "typecheck": "tsc --noEmit",
        },
        "dependencies": {k: VERSIONS[k] for k in ("react", "react-dom", "@fortawesome/fontawesome-free", "@fontsource/open-sans")
                         + (("ag-grid-community", "ag-grid-react", "write-excel-file") if framework else ())},
        "devDependencies": {k: VERSIONS[k] for k in ("vite", "typescript", "sass", "@types/react", "@types/react-dom")},
    }
    # the shared libraries: prebuilt packages shipped with the agent, never copied into src/
    for lib, tgz in (tarballs or {}).items():
        pkg["dependencies"][f"@extreact/{lib}"] = file_spec(tgz, out)
    pkg["dependencies"] = dict(sorted(pkg["dependencies"].items()))
    (out / "package.json").write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")
    tsconfig = {
        "compilerOptions": {
            "target": "ES2020", "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx",
            "lib": ["ES2021", "DOM", "DOM.Iterable"], "strict": False, "noImplicitAny": False, "skipLibCheck": True,
            "allowJs": True, "esModuleInterop": True, "isolatedModules": True, "resolveJsonModule": True, "noEmit": True,
            "types": [],
        },
        "include": ["src"],
    }
    (out / "tsconfig.json").write_text(json.dumps(tsconfig, indent=2) + "\n", encoding="utf-8")
    if framework:
        (out / "vite.config.ts").write_text(
            "import { defineConfig } from 'vite';\n\n"
            "// In development Vite proxies the backend (/api) and the display registry (/registry) so the app is one origin.\n"
            "const api = process.env.API_TARGET || 'http://127.0.0.1:5080';\n"
            "const registry = process.env.REGISTRY_TARGET || 'http://127.0.0.1:8130';\n"
            "const proxy = {\n"
            "  '/api': { target: api, changeOrigin: true },\n"
            "  '/registry': { target: registry, changeOrigin: true, rewrite: (p: string) => p.replace(/^\\/registry/, '') },\n"
            "};\n\n"
            "export default defineConfig({\n"
            "  base: './',\n"
            "  esbuild: { jsx: 'automatic' },\n"
            "  // one React for the app and the @extreact packages\n"
            "  resolve: { dedupe: ['react', 'react-dom', 'ag-grid-community', 'ag-grid-react'] },\n"
            "  server: { port: 5173, proxy },\n"
            "  preview: { port: 4173, proxy },\n"
            "  build: { outDir: 'dist', chunkSizeWarningLimit: 4000, sourcemap: true }\n"
            "});\n", encoding="utf-8")
        (out / ".gitignore").write_text("node_modules/\ndist/\n.migration-cache/\n.migration-backups/\n.ui-forge/\nui-forge-out/\n", encoding="utf-8")
        return
    (out / "vite.config.ts").write_text(
        "import { defineConfig } from 'vite';\n\n"
        "// The Ext JS app called a relative 'api/...' URL; in development Vite proxies it to the original backend.\n"
        "const api = process.env.API_TARGET || 'http://127.0.0.1:5080';\n\n"
        "export default defineConfig({\n"
        "  base: './',\n"
        "  esbuild: { jsx: 'automatic' },\n"
        "  server: { port: 5173, proxy: { '/api': { target: api, changeOrigin: true } } },\n"
        "  preview: { port: 4173, proxy: { '/api': { target: api, changeOrigin: true } } },\n"
        "  build: { outDir: 'dist', chunkSizeWarningLimit: 4000, sourcemap: true }\n"
        "});\n", encoding="utf-8")
    (out / ".gitignore").write_text("node_modules/\ndist/\n.migration-cache/\n.migration-backups/\n.ui-forge/\nui-forge-out/\n", encoding="utf-8")


def summarize_classes(analysis: Analysis, modules: list[ModulePlan]) -> list[dict[str, Any]]:
    target_of = {m.source: m.target for m in modules}
    out = []
    for c in sorted(analysis.classes.values(), key=lambda x: x.name):
        out.append({
            "name": c.name, "category": c.category, "kind": c.kind, "extends": c.extend or c.override or (try_literal(c.members["extend"].node) if "extend" in c.members else None),
            "frameworkBase": c.framework_base, "aliases": c.alias, "source": c.file, "module": target_of.get(c.file),
        })
    return out
