"""The target application: where files go, and what already exists there.

A project has up to three roots:

* ``app``    the React application (a framework-shell app made by extjs-migrate: src/framework, src/displays.ts,
             registration/). Required.
* ``api``    the backend repository (GridTrade: server/server.js with the generated-module seam). Optional, and
             off by default: without it UI Forge writes the front end only, plus an API contract per entity
             (src/modules/<module>/api/*.api.md) for the backend team, whatever its language.
* ``mirror`` the folder holding the application-owned files that extjs-migrate copies in with --app-files
             (optional; GridTrade works in the app folder itself and uses none). when set, every file under src/modules,
             registration/ and src/displays.ts is written there too, so a fresh migration keeps it.

Configuration comes from ``ui-forge.config.json`` in the app root, then environment variables
(UI_FORGE_APP, UI_FORGE_API, UI_FORGE_MIRROR, UI_FORGE_APP_API_URL, UI_FORGE_REGISTRY_URL), then arguments.
Inspection only reads files; nothing here writes.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

CONFIG_FILE = "ui-forge.config.json"
MIRRORED = ("src/modules/", "registration/", "src/displays.ts")
FORGE_MANIFEST = re.compile(r"\.ui-forge\.[a-z0-9-]+\.manifest\.json$")


@dataclass
class Project:
    app_root: Path
    api_root: Path | None = None
    mirror_root: Path | None = None
    app_id: str = "app"
    api_base: str = "/api"
    app_api_url: str = "http://127.0.0.1:5080/api"
    registry_url: str = "http://127.0.0.1:8130"
    backend_kind: str = "none"  # gridtrade-node | none

    def root(self, key: str) -> Path:
        r = {"app": self.app_root, "api": self.api_root, "mirror": self.mirror_root}[key]
        if r is None:
            raise ValueError(f"no {key} root is configured")
        return r

    def summary(self) -> dict[str, Any]:
        return {
            "appRoot": str(self.app_root), "apiRoot": str(self.api_root) if self.api_root else None,
            "mirrorRoot": str(self.mirror_root) if self.mirror_root else None, "appId": self.app_id,
            "apiBase": self.api_base, "appApiUrl": self.app_api_url, "registryUrl": self.registry_url,
            "backend": self.backend_kind,
        }


def _read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except (FileNotFoundError, UnicodeDecodeError):
        return ""


def _uses_framework(app_root: Path) -> bool:
    """@extreact/framework as a package dependency (current agents) or copied into src/framework (older ones)."""
    if (app_root / "src" / "framework").is_dir():
        return True
    try:
        pkg = json.loads((app_root / "package.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return "@extreact/framework" in {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}


def load_project(app: str | os.PathLike | None = None, api: str | os.PathLike | None = None,
                 mirror: str | os.PathLike | None = None) -> Project:
    app = app or os.environ.get("UI_FORGE_APP")
    if not app:
        raise ValueError("Give the React app folder (--app or UI_FORGE_APP)")
    app_root = Path(app).expanduser().resolve()
    if not _uses_framework(app_root) or not (app_root / "src" / "displays.ts").is_file():
        raise ValueError(f"{app_root} is not a framework-shell React app (it needs src/displays.ts and the @extreact/framework "
                         "package). Migrate it with: extjs-migrate migrate <app> -o <out> --shell framework")
    cfg: dict[str, Any] = {}
    cf = app_root / CONFIG_FILE
    if cf.is_file():
        try:
            cfg = json.loads(cf.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"{cf} is not valid JSON: {e}") from e

    def path_opt(arg: Any, env: str, key: str) -> Path | None:
        v = arg or os.environ.get(env) or cfg.get(key)
        if not v:
            return None
        p = Path(v)
        if not p.is_absolute():
            p = app_root / p
        return p.expanduser().resolve()

    api_root = path_opt(api, "UI_FORGE_API", "apiRoot")
    mirror_root = path_opt(mirror, "UI_FORGE_MIRROR", "mirrorRoot")
    if mirror_root is not None and mirror_root == app_root:
        mirror_root = None
    m = re.search(r"appId:\s*'([a-z0-9][a-z0-9._-]*)'", _read(app_root / "src" / "app.config.ts"))
    m2 = re.search(r"apiBase:\s*'([^']+)'", _read(app_root / "src" / "app.config.ts"))
    backend = "none"
    if api_root is not None:
        if (api_root / "server" / "server.js").is_file() and "security.generated" in _read(api_root / "server" / "server.js"):
            backend = "gridtrade-node"
        else:
            raise ValueError(f"{api_root} has no server/server.js with the UI Forge module seam (security.generated); "
                             "see the UI Forge README, 'Backend integration'")
    return Project(
        app_root=app_root, api_root=api_root, mirror_root=mirror_root,
        app_id=cfg.get("appId") or (m.group(1) if m else "app"), api_base=cfg.get("apiBase") or (m2.group(1) if m2 else "/api"),
        app_api_url=os.environ.get("UI_FORGE_APP_API_URL") or cfg.get("appApiUrl") or "http://127.0.0.1:5080/api",
        registry_url=os.environ.get("UI_FORGE_REGISTRY_URL") or cfg.get("registryUrl") or "http://127.0.0.1:8130",
        backend_kind=backend,
    )


# ------------------------------------------------------------------------------------------------ inspection
@dataclass
class Inventory:
    """What the project already has, for validation, conflict checks and the builder's pickers."""

    menus: list[dict[str, Any]] = field(default_factory=list)       # {id, title, parent, display, folder, module, forge}
    displays: list[dict[str, Any]] = field(default_factory=list)    # {id, title, type, key, route, module, forge, actionPermissions}
    modules: list[dict[str, Any]] = field(default_factory=list)     # {id, file, forge}
    display_keys: set[str] = field(default_factory=set)             # keys in displays.ts and module registries (not generated)
    permissions: list[dict[str, Any]] = field(default_factory=list)  # {module, label, actions}
    lookups: list[str] = field(default_factory=list)                # '/lookups/regions' ...
    routes: list[tuple[str, str]] = field(default_factory=list)     # (method, '/api/...') hand-written routes
    collections: set[str] = field(default_factory=set)

    def permission_names(self) -> set[str]:
        return {f"{m['module']}.{a}" for m in self.permissions for a in m["actions"]}

    def as_dict(self) -> dict[str, Any]:
        return {
            "menus": self.menus, "displays": self.displays, "modules": self.modules, "displayKeys": sorted(self.display_keys),
            "permissions": self.permissions, "lookups": self.lookups,
            "routes": [{"method": m, "path": p} for m, p in self.routes], "collections": sorted(self.collections),
        }


def _manifests(app_root: Path) -> list[tuple[Path, dict[str, Any]]]:
    out = []
    for p in sorted((app_root / "registration").glob("*.manifest.json")):
        try:
            out.append((p, json.loads(p.read_text(encoding="utf-8"))))
        except json.JSONDecodeError:
            continue
    return out


def _display_keys(app_root: Path) -> set[str]:
    keys = {"SummaryDisplay", "EntryForm", "MasterSlave"}
    files = [app_root / "src" / "displays.ts"] + [p for p in (app_root / "src" / "modules").rglob("*.ts")
                                                  if not p.name.endswith(".generated.ts") and p.name != "generated-displays.ts"]
    for f in files:
        text = _read(f)
        if "defineDisplays" not in text:
            continue
        keys.update(re.findall(r"^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*\{\s*load\s*:", text, re.M))
    return keys


_MODULE_RE = re.compile(r"\{\s*module:\s*'([a-z][a-z0-9_-]*)',\s*label:\s*'((?:[^'\\]|\\.)*)',\s*actions:\s*\[([^\]]*)\]")


def _permissions(api_root: Path | None) -> list[dict[str, Any]]:
    if api_root is None:
        return []
    text = _read(api_root / "server" / "security.js")
    i = text.find("BASE_MODULES")
    j = text.find("];", i) if i >= 0 else -1
    block = text[i:j] if i >= 0 and j > i else text
    return [{"module": m, "label": lbl.replace("\\'", "'"), "actions": re.findall(r"'([a-z][a-z0-9_-]*)'", acts)}
            for m, lbl, acts in _MODULE_RE.findall(block)]


def _server_facts(api_root: Path | None) -> tuple[list[tuple[str, str]], list[str], set[str]]:
    if api_root is None:
        return [], [], set()
    text = _read(api_root / "server" / "server.js")
    routes = [(m, p) for m, p in re.findall(r"route\('(GET|POST|PUT|DELETE|PATCH)',\s*'([^']+)'", text)]
    for base, _coll in re.findall(r"referenceRoutes\('([^']+)',\s*'([^']+)'", text):
        routes += [("GET", base), ("GET", base + "/:id"), ("POST", base), ("PUT", base + "/:id"), ("DELETE", base + "/:id")]
    lookups: list[str] = []
    m = re.search(r"const STATIC_LOOKUPS = \{(.*?)\n\};", text, re.S)
    if m:
        lookups += re.findall(r"(\w+):\s*(?:seed\.\w+|\[)", m.group(1))
    m = re.search(r"const map = \{(.*?)\n  \};", text, re.S)
    if m:
        lookups += re.findall(r"^\s*(\w+):\s*\(\)\s*=>", m.group(1), re.M)
    seed = _read(api_root / "server" / "seed.js")
    colls = set()
    m = re.search(r"const db = \{(.*?)\n  \};", seed, re.S)
    if m:
        colls.update(re.findall(r"(\w+):\s*(?:\[\]|\{\})", m.group(1)))
    colls.update(re.findall(r"referenceRoutes\('[^']+',\s*'([^']+)'", text))
    colls.update({"users", "roles", "credentials", "audit", "seq"})
    return routes, sorted(set(f"/lookups/{k}" for k in lookups)), colls


def inspect(project: Project) -> Inventory:
    inv = Inventory()
    for path, man in _manifests(project.app_root):
        forge = bool(FORGE_MANIFEST.search(path.name))
        mod = (man.get("module") or {}).get("id", path.stem)
        inv.modules.append({"id": mod, "file": f"registration/{path.name}", "forge": forge})
        for d in man.get("displays", []):
            inv.displays.append({"id": d.get("id"), "title": d.get("title"), "type": d.get("type"), "key": d.get("key"),
                                 "route": d.get("route") or f"d/{d.get('id')}", "module": mod, "forge": forge,
                                 "actionPermissions": d.get("actionPermissions", {}), "requiredPermissions": d.get("requiredPermissions", [])})
        for m in man.get("menus", []):
            inv.menus.append({"id": m.get("id"), "title": m.get("title"), "parent": m.get("parent"), "display": m.get("display"),
                              "folder": not m.get("display"), "sortOrder": m.get("sortOrder", 100), "icon": m.get("icon"),
                              "module": mod, "forge": forge})
    inv.display_keys = _display_keys(project.app_root)
    inv.permissions = _permissions(project.api_root)
    inv.routes, inv.lookups, inv.collections = _server_facts(project.api_root)
    return inv
