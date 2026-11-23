"""Validation, idempotent registration, navigation and admin overrides.

Registration policy (documented in docs/display-registry.md):

* A module owns the displays and menus it registered. Another module using the same id is a conflict.
* Re-registering the same manifest changes nothing (checksum match) and reports "unchanged".
* A version may not go down. Content changes without a version bump are allowed but reported.
* Fields an administrator changed through the API (``admin_overrides``) are kept unless the caller passes
  ``overrideAdminChanges``.
* Items the module registered before but no longer declares are kept as they are, or disabled with ``prune``.
  Nothing is deleted, so role assignments and admin settings are never lost silently.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .manifest import DisplayDef, MenuDef, ModuleManifest
from .security import Principal
from .settings import AppConfig
from .tables import RegistryDisplayRow, RegistryHistoryRow, RegistryMenuRow, RegistryModuleRow

DISPLAY_FIELDS = ("title", "display_type", "display_key", "route", "open_mode", "params", "required_permissions",
                  "action_permissions", "icon", "enabled", "config")
MENU_FIELDS = ("parent_id", "display_id", "title", "params", "action", "icon", "sort_order", "enabled",
               "required_permissions")
OVERRIDABLE = {"display": ("enabled", "required_permissions", "action_permissions", "title"),
               "menu": ("enabled", "required_permissions", "sort_order", "title", "parent_id")}


def now() -> datetime:
    return datetime.now(UTC)


def canonical(manifest: ModuleManifest) -> dict[str, Any]:
    return manifest.model_dump(mode="json", by_alias=True)


def checksum(manifest: ModuleManifest) -> str:
    return hashlib.sha256(json.dumps(canonical(manifest), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _semver(v: str) -> tuple[int, int, int]:
    core = v.split("-", 1)[0].split("+", 1)[0]
    a, b, c = (int(x) for x in core.split("."))
    return a, b, c


def display_values(d: DisplayDef) -> dict[str, Any]:
    return {
        "title": d.title, "display_type": d.type, "display_key": d.key, "route": d.route or f"d/{d.id}",
        "open_mode": d.open_mode, "params": [p.model_dump(mode="json") for p in d.params],
        "required_permissions": list(d.required_permissions), "action_permissions": dict(d.action_permissions),
        "icon": d.icon, "enabled": d.enabled, "config": d.config,
    }


def menu_values(m: MenuDef) -> dict[str, Any]:
    return {
        "parent_id": m.parent, "display_id": m.display, "title": m.title, "params": dict(m.params), "action": m.action,
        "icon": m.icon, "sort_order": m.sort_order, "enabled": m.enabled,
        "required_permissions": list(m.required_permissions),
    }


@dataclass
class Report:
    app: str
    module: str
    version: str
    status: str = "unchanged"  # created | updated | unchanged | invalid
    dry_run: bool = False
    checksum: str = ""
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    changes: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {"app": self.app, "module": self.module, "version": self.version, "status": self.status,
                "dryRun": self.dry_run, "checksum": self.checksum, "errors": self.errors,
                "warnings": self.warnings, "changes": self.changes}


async def _rows(session: AsyncSession, app_id: str):
    displays = {r.display_id: r for r in (await session.scalars(select(RegistryDisplayRow).where(RegistryDisplayRow.app_id == app_id)))}
    menus = {r.menu_id: r for r in (await session.scalars(select(RegistryMenuRow).where(RegistryMenuRow.app_id == app_id)))}
    return displays, menus


async def validate(session: AsyncSession, app_id: str, app: AppConfig, manifest: ModuleManifest,
                   catalog: set[str] | None, *, prune: bool = False) -> Report:
    rep = Report(app=app_id, module=manifest.module.id, version=manifest.module.version, checksum=checksum(manifest))
    err, warn = rep.errors.append, rep.warnings.append
    if manifest.app != app_id:
        err(f"manifest is for app '{manifest.app}', not '{app_id}'")
    displays, menus = await _rows(session, app_id)
    mod_id = manifest.module.id
    existing = await session.get(RegistryModuleRow, (app_id, mod_id))
    if existing:
        try:
            if _semver(manifest.module.version) < _semver(existing.version):
                err(f"version {manifest.module.version} is older than the registered {existing.version}")
            elif manifest.module.version == existing.version and existing.checksum != rep.checksum:
                warn(f"content changed but the version is still {existing.version}; bump it so deployments can tell versions apart")
        except ValueError:
            err("version is not semantic")

    new_displays = {d.id: d for d in manifest.displays}
    new_menus = {m.id: m for m in manifest.menus}
    routes = {r.route: r.display_id for r in displays.values() if r.module_id != mod_id}

    for d in manifest.displays:
        if d.type not in app.display_types:
            err(f"display '{d.id}': type '{d.type}' is not one of {', '.join(app.display_types)}")
        row = displays.get(d.id)
        if row and row.module_id != mod_id:
            err(f"display '{d.id}' belongs to module '{row.module_id}'")
        route = d.route or f"d/{d.id}"
        if route in routes and routes[route] != d.id:
            err(f"display '{d.id}': route '{route}' is already used by '{routes[route]}'")
        if catalog is not None:
            for p in list(d.required_permissions) + list(d.action_permissions.values()):
                if p not in catalog:
                    err(f"display '{d.id}': permission '{p}' does not exist in the application")
    own_routes = [d.route or f"d/{d.id}" for d in manifest.displays]
    if len(own_routes) != len(set(own_routes)):
        err("two displays in this manifest use the same route")

    def display_of(did: str) -> tuple[list[str], set[str]] | None:
        if did in new_displays:
            d = new_displays[did]
            return [p.name for p in d.params if p.required], {p.name for p in d.params}
        row = displays.get(did)
        if row:
            return [p["name"] for p in row.params if p.get("required")], {p["name"] for p in row.params}
        return None

    def is_folder(mid: str) -> bool | None:
        if mid in new_menus:
            return new_menus[mid].display is None
        row = menus.get(mid)
        return None if row is None else row.display_id is None

    for m in manifest.menus:
        row = menus.get(m.id)
        if row and row.module_id != mod_id:
            err(f"menu '{m.id}' belongs to module '{row.module_id}'")
        if m.parent:
            folder = is_folder(m.parent)
            if folder is None:
                err(f"menu '{m.id}': parent '{m.parent}' is not registered")
            elif not folder:
                err(f"menu '{m.id}': parent '{m.parent}' opens a display, so it cannot hold entries")
        if m.display:
            info = display_of(m.display)
            if info is None:
                err(f"menu '{m.id}': display '{m.display}' is not registered")
            else:
                required, known = info
                missing = [p for p in required if p not in m.params]
                if missing:
                    err(f"menu '{m.id}': display '{m.display}' needs parameter(s) {', '.join(missing)}")
                extra = [p for p in m.params if p not in known]
                if extra:
                    warn(f"menu '{m.id}': parameter(s) {', '.join(extra)} are not declared by '{m.display}'")
        if catalog is not None:
            for p in m.required_permissions:
                if p not in catalog:
                    err(f"menu '{m.id}': permission '{p}' does not exist in the application")

    parents = {mid: r.parent_id for mid, r in menus.items()}
    parents.update({mid: m.parent for mid, m in new_menus.items()})
    for start in new_menus:
        node, seen = start, set()
        while node and node in parents:
            if node in seen:
                err(f"menu '{start}' is part of a parent cycle")
                break
            seen.add(node)
            node = parents[node]

    for did, row in displays.items():
        if row.module_id == mod_id and did not in new_displays:
            warn(f"display '{did}' is no longer declared: it will be {'disabled' if prune else 'kept as is'}")
    for mid, row in menus.items():
        if row.module_id == mod_id and mid not in new_menus:
            warn(f"menu '{mid}' is no longer declared: it will be {'disabled' if prune else 'kept as is'}")
    if rep.errors:
        rep.status = "invalid"
    return rep


def _apply(row: Any, values: dict[str, Any], kind: str, override_admin: bool) -> tuple[list[str], list[str]]:
    """Copies values onto row. Returns (changed fields, fields kept because an admin set them)."""
    changed, kept = [], []
    overrides = dict(row.admin_overrides or {})
    for f, v in values.items():
        if f in overrides and not override_admin:
            kept.append(f)
            continue
        if getattr(row, f) != v:
            setattr(row, f, v)
            changed.append(f)
    if override_admin and overrides:
        row.admin_overrides = {}
    return changed, kept


async def register(session: AsyncSession, app_id: str, app: AppConfig, manifest: ModuleManifest,
                   catalog: set[str] | None, actor: str, *, prune: bool = False, override_admin: bool = False,
                   dry_run: bool = False) -> Report:
    rep = await validate(session, app_id, app, manifest, catalog, prune=prune)
    rep.dry_run = dry_run
    if rep.errors:
        return rep
    ts = now()
    mod_id = manifest.module.id
    module = await session.get(RegistryModuleRow, (app_id, mod_id))
    if module and module.checksum == rep.checksum and not prune and not override_admin:
        rep.status = "unchanged"
        return rep
    rep.status = "updated" if module else "created"
    if module is None:
        module = RegistryModuleRow(app_id=app_id, module_id=mod_id, registered_at=ts)
        session.add(module)
        rep.changes.append({"kind": "module", "id": mod_id, "change": "created"})
    elif module.version != manifest.module.version:
        rep.changes.append({"kind": "module", "id": mod_id, "change": "updated", "fields": ["version"],
                            "from": module.version, "to": manifest.module.version})
    module.version, module.title, module.owner = manifest.module.version, manifest.module.title, manifest.module.owner
    module.checksum, module.manifest, module.registered_by, module.updated_at = rep.checksum, canonical(manifest), actor, ts
    await session.flush()

    displays, menus = await _rows(session, app_id)
    for kind, defs, existing, values_of, model, key in (
        ("display", manifest.displays, displays, display_values, RegistryDisplayRow, "display_id"),
        ("menu", manifest.menus, menus, menu_values, RegistryMenuRow, "menu_id"),
    ):
        declared = set()
        for d in defs:
            declared.add(d.id)
            values = values_of(d)
            row = existing.get(d.id)
            if row is None:
                row = model(app_id=app_id, module_id=mod_id, admin_overrides={}, updated_at=ts, **{key: d.id}, **values)
                session.add(row)
                rep.changes.append({"kind": kind, "id": d.id, "change": "created"})
                continue
            changed, kept = _apply(row, values, kind, override_admin)
            if changed:
                row.updated_at = ts
                rep.changes.append({"kind": kind, "id": d.id, "change": "updated", "fields": changed})
            if kept:
                rep.changes.append({"kind": kind, "id": d.id, "change": "kept-admin-override", "fields": kept})
        for rid, row in existing.items():
            if row.module_id == mod_id and rid not in declared and prune and row.enabled:
                row.enabled, row.updated_at = False, ts
                rep.changes.append({"kind": kind, "id": rid, "change": "disabled"})
    if dry_run:
        await session.rollback()
        return rep
    session.add(RegistryHistoryRow(history_id=uuid.uuid4().hex, app_id=app_id, module_id=mod_id, action="register",
                                   actor=actor, at=ts, version=manifest.module.version, checksum=rep.checksum,
                                   summary=f"{rep.status}: {len(rep.changes)} change(s)", report=rep.as_dict()))
    await session.commit()
    return rep


def _visible(perms: list[str], principal: Principal) -> bool:
    return all(p in principal.permissions for p in perms)


def display_payload(row: RegistryDisplayRow, principal: Principal) -> dict[str, Any]:
    return {
        "id": row.display_id, "title": row.title, "type": row.display_type, "key": row.display_key,
        "route": row.route, "openMode": row.open_mode, "params": row.params, "icon": row.icon, "config": row.config,
        "module": row.module_id, "requiredPermissions": row.required_permissions,
        "actions": {a: p in principal.permissions for a, p in sorted(row.action_permissions.items())},
    }


async def navigation(session: AsyncSession, app_id: str, principal: Principal) -> dict[str, Any]:
    displays, menus = await _rows(session, app_id)
    usable = {did: r for did, r in displays.items() if r.enabled and _visible(r.required_permissions, principal)}
    children: dict[str | None, list[RegistryMenuRow]] = {}
    for r in menus.values():
        children.setdefault(r.parent_id, []).append(r)

    def build(parent: str | None, depth: int = 0) -> list[dict[str, Any]]:
        out = []
        if depth > 8:
            return out
        for r in sorted(children.get(parent, []), key=lambda x: (x.sort_order, x.title.lower())):
            if not r.enabled or not _visible(r.required_permissions, principal):
                continue
            if r.parent_id is not None and r.parent_id not in menus:
                continue
            item: dict[str, Any] = {"id": r.menu_id, "title": r.title, "icon": r.icon}
            if r.display_id:
                if r.display_id not in usable:
                    continue
                item.update(display=r.display_id, params=r.params or {}, action=r.action)
            else:
                kids = build(r.menu_id, depth + 1)
                if not kids:
                    continue  # an empty folder is not shown
                item["children"] = kids
            out.append(item)
        return out

    menu = build(None)
    payload = {"app": app_id, "user": principal.user, "menu": menu,
               "displays": {did: display_payload(r, principal) for did, r in sorted(usable.items())}}
    payload["etag"] = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16]
    return payload


async def admin_patch(session: AsyncSession, app_id: str, kind: str, item_id: str, changes: dict[str, Any],
                      actor: str, catalog: set[str] | None) -> dict[str, Any]:
    model = RegistryDisplayRow if kind == "display" else RegistryMenuRow
    row = await session.get(model, (app_id, item_id))
    if row is None:
        raise LookupError(f"{kind} '{item_id}' is not registered")
    allowed = OVERRIDABLE[kind]
    if changes.get("clearOverrides"):
        module = await session.get(RegistryModuleRow, (app_id, row.module_id))
        manifest = ModuleManifest.model_validate(module.manifest)
        defs = {d.id: d for d in (manifest.displays if kind == "display" else manifest.menus)}
        if item_id in defs:
            values = display_values(defs[item_id]) if kind == "display" else menu_values(defs[item_id])
            for f in row.admin_overrides or {}:
                setattr(row, f, values[f])
        row.admin_overrides = {}
    else:
        unknown = [k for k in changes if k not in allowed]
        if unknown:
            raise ValueError(f"cannot change {', '.join(unknown)}; allowed: {', '.join(allowed)}")
        for f in ("required_permissions", "action_permissions"):
            if f in changes and catalog is not None:
                vals = changes[f].values() if isinstance(changes[f], dict) else changes[f]
                bad = [p for p in vals if p not in catalog]
                if bad:
                    raise ValueError(f"unknown permission(s): {', '.join(bad)}")
        overrides = dict(row.admin_overrides or {})
        for f, v in changes.items():
            setattr(row, f, v)
            overrides[f] = v
        row.admin_overrides = overrides
    row.updated_at = now()
    session.add(RegistryHistoryRow(history_id=uuid.uuid4().hex, app_id=app_id, module_id=row.module_id,
                                   action=f"admin-{kind}", actor=actor, at=row.updated_at,
                                   summary=f"{kind} {item_id}: {', '.join(changes)}", report={"changes": changes}))
    await session.commit()
    return {"id": item_id, "kind": kind, "adminOverrides": row.admin_overrides}


async def module_status(session: AsyncSession, app_id: str, module_id: str) -> dict[str, Any] | None:
    module = await session.get(RegistryModuleRow, (app_id, module_id))
    if module is None:
        return None
    displays, menus = await _rows(session, app_id)
    history = (await session.scalars(select(RegistryHistoryRow).where(
        RegistryHistoryRow.app_id == app_id, RegistryHistoryRow.module_id == module_id)
        .order_by(RegistryHistoryRow.at.desc()).limit(20))).all()
    return {
        "app": app_id, "module": module_id, "version": module.version, "title": module.title, "owner": module.owner,
        "checksum": module.checksum, "registeredBy": module.registered_by, "updatedAt": module.updated_at.isoformat(),
        "displays": [{"id": r.display_id, "type": r.display_type, "key": r.display_key, "enabled": r.enabled,
                      "adminOverrides": r.admin_overrides} for r in displays.values() if r.module_id == module_id],
        "menus": [{"id": r.menu_id, "parent": r.parent_id, "display": r.display_id, "enabled": r.enabled,
                   "adminOverrides": r.admin_overrides} for r in menus.values() if r.module_id == module_id],
        "history": [{"action": h.action, "actor": h.actor, "at": h.at.isoformat(), "version": h.version,
                     "summary": h.summary} for h in history],
    }
