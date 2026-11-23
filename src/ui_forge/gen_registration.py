"""Registry manifests (registration/<app>.ui-forge.<module>.manifest.json, contract v1 of the display registry).

One manifest per module, owned by UI Forge (module id <app>.ui-forge.<module>), so hand-written modules are never
edited. Folders the displays create are menu entries without a display. The version is 1.0.<sum of the display
revisions>, so it only goes up and regeneration of unchanged schemas gives the same file.
"""

from __future__ import annotations

import json
from typing import Any

from .files import GeneratedFile
from .naming import pascal
from .project import Project
from .resolve import permissions_of
from .workspace import Workspace


def manifest_path(app_id: str, module: str) -> str:
    return f"registration/{app_id}.ui-forge.{module}.manifest.json"


def manifests(project: Project, ws: Workspace) -> list[GeneratedFile]:
    by_module: dict[str, list] = {}
    for d in ws.displays.values():
        by_module.setdefault(d.module, []).append(d)
    files = []
    for module, displays in sorted(by_module.items()):
        displays.sort(key=lambda x: x.id)
        title = next((ws.entities[n].permissionModule.label for d in displays for n in d.entities()
                      if n in ws.entities and ws.entities[n].permissionModule), pascal(module))
        man: dict[str, Any] = {
            "schemaVersion": 1,
            "app": project.app_id,
            "module": {"id": f"{project.app_id}.ui-forge.{module}", "version": f"1.0.{sum(d.revision for d in displays)}",
                       "title": f"{title} (UI Forge)", "owner": "UI Forge"},
            "displays": [],
            "menus": [],
        }
        for d in displays:
            required, actions = permissions_of(ws, d)
            entry: dict[str, Any] = {"id": d.id, "title": d.title, "type": d.registry_type, "key": d.name}
            if d.route:
                entry["route"] = d.route
            if d.openMode != "tab":
                entry["openMode"] = d.openMode
            if d.icon:
                entry["icon"] = d.icon
            if d.type == "entry":
                entry["params"] = [{"name": "id", "required": True, "description": "record id, or 'new'"}]
            entry["requiredPermissions"] = required
            entry["actionPermissions"] = actions
            entry["config"] = {"generatedBy": "ui-forge"}
            man["displays"].append(entry)
        seen = set()
        for d in displays:
            for f in d.folders:
                if f.id in seen:
                    continue
                seen.add(f.id)
                m = {"id": f.id, "title": f.title}
                if f.parent:
                    m["parent"] = f.parent
                if f.icon:
                    m["icon"] = f.icon
                m["sortOrder"] = f.sortOrder
                man["menus"].append(m)
        for d in displays:
            if not d.menu:
                continue
            mu = d.menu
            m = {"id": mu.id, "title": mu.title}
            if mu.parent:
                m["parent"] = mu.parent
            m["display"] = d.id
            if mu.icon or d.icon:
                m["icon"] = mu.icon or d.icon
            m["sortOrder"] = mu.sortOrder
            if mu.params:
                m["params"] = dict(sorted(mu.params.items()))
            if mu.action:
                m["action"] = mu.action
            if mu.requiredPermissions:
                m["requiredPermissions"] = sorted(mu.requiredPermissions)
            if not mu.enabled:
                m["enabled"] = False
            man["menus"].append(m)
        files.append(GeneratedFile("app", manifest_path(project.app_id, module), json.dumps(man, indent=2, ensure_ascii=False) + "\n",
                                   source=f"src/modules/{module}/ui-forge/*.display.json"))
    return files
