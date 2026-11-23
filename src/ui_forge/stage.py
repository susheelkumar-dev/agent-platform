"""Staging: the code of one display written to a review folder instead of into the project.

    <app>/ui-forge-out/<display-id>/
        README.md            what each file is, where it goes, how to register and test the display
        app/...              files for the React app, at their project-relative paths
        api/...              files for the backend (when the project has one), at their paths
                             (app/src/modules/<module>/ui-forge/*.json are the design documents themselves)

The developer reviews and adjusts the files, copies them into the project (or uses "Apply to project", which does
the same with conflict checks and backups), then registers and tests the display. Staging never writes into the
project itself. A previous staging of the same display is moved to ui-forge-out/.previous/ first, so edits made
there are not lost.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .files import GeneratedFile
from .gen_frontend import IMPORT_BEGIN, IMPORT_END, REG_BEGIN, REG_END
from .plan import desired_files
from .project import Project
from .resolve import permissions_of
from .schema import DisplaySchema, EntityDef
from .workspace import Workspace, display_path, dump_display, dump_entity, entity_path

STAGING_DIR = "ui-forge-out"


@dataclass
class StagedFile:
    root: str          # app | api
    path: str          # project-relative path
    owner: str         # generated | developer | shared | design
    role: str          # what it is
    action: str        # what to do with it
    exists: bool       # already in the project


@dataclass
class StageResult:
    folder: Path
    files: list[StagedFile] = field(default_factory=list)
    previous: Path | None = None

    def as_dict(self) -> dict[str, Any]:
        return {"folder": str(self.folder), "previous": str(self.previous) if self.previous else None,
                "files": [f.__dict__ for f in self.files], "readme": (self.folder / "README.md").read_text(encoding="utf-8")}


def _role(f: GeneratedFile, d: DisplaySchema) -> tuple[str, str]:
    """(owner label, role) of a generated file."""
    p = f.path
    if p.endswith(".config.generated.ts"):
        return "generated", "Layout, fields, columns, actions and permissions of the display (framework config)."
    if p.endswith(".hooks.ts"):
        return "developer", "Your business rules for the screen: validation, before/after save, custom actions."
    if p.endswith(".tsx") and "/displays/" in p:
        return "developer", "The display component: the framework template with the config and your hooks."
    if "/types/" in p:
        return "generated", "TypeScript types of the records (and their options)."
    if "/services/" in p:
        return "generated", "Typed API calls: list, get, create, update, remove, history, custom actions."
    if p.endswith(".schema.generated.ts"):
        return "generated", "Field definitions shared by the configs of this entity."
    if p.endswith("generated-displays.ts"):
        return "shared", "Registers every UI Forge display's component (implementation key -> lazy import)."
    if p.startswith("registration/"):
        return "shared", "Registry manifest of the module: displays, routes, menu entries, required permissions."
    if p.endswith(".routes.generated.js"):
        return "generated", "API routes: list (filters, sort, paging), get, create, update, delete, custom actions, each permission-checked."
    if p.endswith(".hooks.js"):
        return "developer", "Your business rules for the API: validate, beforeSave, afterSave, canDelete, custom actions."
    if p.endswith("index.js"):
        return "shared", "Loads every generated API module; declares new permission modules and role grants."
    if p.endswith("forge-runtime.js"):
        return "shared", "Validation, defaults and filtering used by the generated routes."
    if p.endswith("selftest.generated.js"):
        return "shared", "API tests for every generated entity (node server/generated/selftest.generated.js)."
    return f.owner, ""


def _action(owner: str, exists: bool) -> str:
    if owner == "developer":
        return "keep yours (compare and merge)" if exists else "copy (new); yours to change"
    if owner == "shared":
        return "replace (one file for all UI Forge displays, already includes them)" if exists else "copy (new)"
    if owner == "design":
        return "replace" if exists else "copy (new)"
    return "replace" if exists else "copy (new)"


def stage(project: Project, ws: Workspace, display_id: str, out_root: Path | None = None,
          overrides: dict[str, str] | None = None, now: datetime | None = None) -> StageResult:
    d = ws.displays.get(display_id)
    if d is None:
        raise KeyError(f"no saved display '{display_id}'")
    ents = [ws.entities[n] for n in d.entities() if n in ws.entities]
    sources = {display_path(d)} | {entity_path(e) for e in ents}
    files, problems = desired_files(project, ws)
    if problems:
        raise ValueError("; ".join(problems))
    picked = [f for f in files if f.root in ("app", "api") and f.owner != "block"
              and (f.source in sources or f.source in ("workspace", "ui-forge") or (f.root == "app" and f.path.startswith("registration/")
                                                                                      and f"ui-forge.{d.module}." in f.path))]

    root = Path(out_root) if out_root else project.app_root / STAGING_DIR
    folder = root / d.id
    stamp = (now or datetime.now(UTC)).strftime("%Y%m%dT%H%M%SZ")
    res = StageResult(folder=folder)
    if folder.exists():
        prev = root / ".previous" / f"{d.id}-{stamp}"
        prev.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(folder), prev)
        res.previous = prev
    folder.mkdir(parents=True)

    for f in sorted(picked, key=lambda x: (x.root, x.path)):
        content = (overrides or {}).get(f.key, f.content) if f.owner == "developer" else f.content
        dest = folder / f.root / f.path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8", newline="\n")
        owner, role = _role(f, d)
        exists = (project.root(f.root) / f.path).is_file()
        res.files.append(StagedFile(f.root, f.path, owner, role, _action(owner, exists), exists))
    # the design documents, so the folder is complete on its own (and can be imported into UI Forge elsewhere)
    for rel, text in [(display_path(d), dump_display(d))] + [(entity_path(e), dump_entity(e)) for e in ents]:
        dest = folder / "app" / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8", newline="\n")
        res.files.append(StagedFile("app", rel, "design", "UI Forge design document (source of truth for regeneration).",
                                    _action("design", (project.app_root / rel).is_file()), (project.app_root / rel).is_file()))

    (folder / "README.md").write_text(readme(project, ws, d, ents, res, stamp), encoding="utf-8", newline="\n")
    (root / "README.md").write_text(index_readme(root), encoding="utf-8", newline="\n")
    return res


def _menu_path(ws: Workspace, d: DisplaySchema) -> str:
    folders = {f.id: f for x in ws.displays.values() for f in x.folders}
    parts, cur, seen = [], d.menu.parent if d.menu else None, set()
    while cur and cur not in seen:
        seen.add(cur)
        f = folders.get(cur)
        parts.append(f.title if f else cur)
        cur = f.parent if f else None
    return " / ".join(reversed(parts)) or "(top level)"


def readme(project: Project, ws: Workspace, d: DisplaySchema, ents: list[EntityDef], res: StageResult, stamp: str) -> str:
    required, actions = permissions_of(ws, d)
    app, api = project.app_root, project.api_root
    folder = res.folder
    kind = {"entry": "Entry form", "summary": "Summary grid", "master-slave": "Master-Slave (grid + linked form)"}[d.type]
    rows = []
    for f in res.files:
        rows.append(f"| `{f.root}/{f.path}` | {f.owner} | {f.role} | {f.action} |")
    new_perm = [e.permissionModule for e in ents if e.permissionModule]
    displays_ts = (app / "src" / "displays.ts").read_text(encoding="utf-8") if (app / "src" / "displays.ts").is_file() else ""
    wired = IMPORT_BEGIN in displays_ts and REG_BEGIN in displays_ts
    has_backend = any(f.root == "api" for f in res.files)
    api_kind = (lambda e: "API contract for the backend team") if project.backend_kind == "none" else (lambda e: "generated API" if e.backend.generate else "existing API")
    entity_list = ", ".join(f"{e.label} (`{e.endpoint}`, {api_kind(e)})" for e in ents)
    win_app = str(app)
    lines = [
        f"# {d.title} — staged by UI Forge",
        "",
        f"Staged {stamp} (UTC). Nothing here is in the project yet: review it, adjust it, copy it in, register and test.",
        "This folder is regenerated each time you stage the display; the previous one is kept in `../.previous/`.",
        "",
        "## The display",
        "",
        "| | |",
        "|---|---|",
        f"| Title | {d.title} |",
        f"| Kind | {kind} |",
        f"| Display id (registry) | `{d.id}` |",
        f"| Component (implementation key) | `{d.name}` |",
        f"| Module | `{d.module}` |",
        f"| Address | `#/{d.route or 'd/' + d.id}` |",
        f"| Menu | {(_menu_path(ws, d) + ' / ' + d.menu.title) if d.menu else 'not in the menu (opened from other displays)'} |",
        f"| Needed to open | {', '.join(f'`{p}`' for p in required) or 'nothing'} |",
        f"| Action permissions | {', '.join(f'{k} → `{v}`' for k, v in actions.items()) or 'none'} |",
        f"| Entities | {entity_list} |",
        "",
        "## The files",
        "",
        "Paths are relative to the project roots: `app/` is the React app"
        + (f" (`{app}`), `api/` is the backend (`{api}`)." if api else f" (`{app}`)."),
        "",
        "| File | Owner | What it is | What to do |",
        "|---|---|---|---|",
        *rows,
        "",
        "Owners: **generated** — rebuilt from the design, do not edit (change the design instead); **developer** — yours,",
        "UI Forge creates it once and never overwrites it; **shared** — one file for all UI Forge displays (replace it, it",
        "already lists the other displays); **design** — the JSON UI Forge regenerates everything from.",
        "",
        "## Put it in the project",
        "",
        "Either click **Apply to project** in UI Forge's Generate tab (it does the steps below, keeps your files, backs",
        "up anything it overwrites and refuses if files changed since the plan), or do it by hand:",
        "",
        "1. **Review and adjust.** Business rules go in the *developer* files (`*.hooks.ts`, `*.hooks.js`, the component).",
        "   If a developer file already exists in the project, keep yours and copy across only what you need.",
        "2. **Copy the React files** (PowerShell):",
        "   ```powershell",
        f"   Copy-Item -Recurse -Force \"{folder / 'app'}\\*\" \"{win_app}\\\"",
        "   ```",
        "3. **Register the component in `src/displays.ts`** "
        + ("— already done in this project (the `// <ui-forge:…>` block)." if wired else "— add once:"),
    ]
    if project.mirror_root:
        i = next(k for k, x in enumerate(lines) if x.startswith("3. **Register the component"))
        lines[i:i] = [
            f"   Also copy the React files into `{project.mirror_root}` (the app files the next migration copies in), so",
            "   re-migrating the Ext JS app keeps this display:",
            "   ```powershell",
            f"   Copy-Item -Recurse -Force \"{folder / 'app'}\\*\" \"{project.mirror_root}\\\"",
            "   ```",
        ]
    if not wired:
        lines += [
            "   ```ts",
            f"   {IMPORT_BEGIN}",
            "   import { generatedDisplays } from './modules/generated-displays';",
            f"   {IMPORT_END}",
            "   export const displays = mergeDisplays(",
            "     builtinDisplays,",
            "     // ...",
            f"     {REG_BEGIN}",
            "     generatedDisplays,",
            f"     {REG_END}",
            "   );",
            "   ```",
        ]
    if has_backend:
        lines += [
            "4. **Copy the API files and restart the API** (it loads `server/generated` at start-up):",
            "   ```powershell",
            f"   Copy-Item -Recurse -Force \"{folder / 'api'}\\*\" \"{api}\\\"",
            "   ```",
        ]
    else:
        contracts = [f.path for f in res.files if f.path.endswith(".api.md")]
        lines += ["4. **API** — UI Forge writes the front end only. Hand the API contract"
                  + ("s " if len(contracts) > 1 else " ") + ", ".join(f"`app/{c}`" for c in contracts)
                  + " to the backend team: the endpoints, fields, rules and permissions the screens need. Until the backend"
                  + " provides them, test with UI Forge's Preview → Sample data."]
    lines += [
        "5. **Register the menu and the display** with the display registry (as an administrator):",
        "   ```powershell",
        f"   cd \"{win_app}\"",
        f"   agentctl display register registration\\{project.app_id}.ui-forge.{d.module}.manifest.json --registry http://127.0.0.1:8130 --app-api http://127.0.0.1:5080/api --user admin --password-env GT_ADMIN_PASSWORD",
        "   ```",
        "   (or **Register** in UI Forge's Generate tab).",
    ]
    if new_perm:
        lines += [
            "6. **Permissions.** New permission module(s): "
            + ", ".join(f"`{m.module}` ({', '.join(m.actions)})" for m in new_perm)
            + (". They appear in *Admin → Roles* after the API restart; grants listed in the design are applied once."
               if has_backend else ". The backend must add them to its permission catalogue (see the API contract) before the menu can be registered."),
        ]
    else:
        lines += ["6. **Permissions.** The display uses existing permissions; give the roles that need it access in *Admin → Roles*."]
    lines += [
        "7. **Test.**",
        "   ```powershell",
        f"   cd \"{win_app}\"; npx tsc --noEmit      # type check",
    ]
    if has_backend:
        lines += [f"   cd \"{api}\"; node server/generated/selftest.generated.js   # API tests"]
    lines += [
        "   ```",
        f"   Open the app, sign in, and find **{d.menu.title if d.menu else d.title}** in the menu (or go to `#/{d.route or 'd/' + d.id}`).",
        "   Try it as a user without the permissions too: the menu entry disappears and the API answers 403.",
        "",
        "## How it fits together",
        "",
        "```",
        "registry manifest (registration/*.json) ──register──▶ display registry ──menu filtered by permissions──▶ shell",
        f"   display '{d.id}', key '{d.name}', route '{d.route or 'd/' + d.id}'",
        "shell opens the route ──▶ src/displays.ts (approved keys) ──▶ generated-displays.ts ──lazy import──▶",
        f"   {d.name}.tsx = framework template + config.generated.ts + hooks.ts ──API calls──▶ /api{ents[0].endpoint if ents else ''} (permission-checked)",
        "```",
        "",
        "More: the UI Forge README (ai-agent-platform/src/ui_forge/README.md) and the developer guide",
        "(ai-agent-platform/agents/extjs-migration-agent/docs/DEVELOPER-GUIDE.md).",
        "",
    ]
    return "\n".join(lines)


def index_readme(root: Path) -> str:
    items = sorted(p.name for p in root.iterdir() if p.is_dir() and not p.name.startswith("."))
    out = ["# UI Forge staging", "",
           "Each folder is one display's code, staged for review. Open its README.md for the files, where they go and how",
           "to register and test the display. Previous stagings are kept in `.previous/`. Add `ui-forge-out/` to .gitignore",
           "if you do not want staged code in source control.", ""]
    out += [f"- [{n}]({n}/README.md)" for n in items]
    return "\n".join(out) + "\n"


def stage_summary(res: StageResult) -> str:
    return json.dumps(res.as_dict(), indent=2)
