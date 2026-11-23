"""Cross-document validation: references, conflicts with the existing application, permissions and menus.

Shape errors come from the pydantic models; this module checks what one document cannot know alone. Errors stop
generation; warnings are shown and generation goes on.
"""

from __future__ import annotations

from .naming import collection_of
from .project import Inventory, Project
from .schema import Action, Column, DisplaySchema, EntityDef, EntryLayout, SummaryLayout
from .workspace import Issue, Workspace

WIDGET_TYPES = {
    "input": {"string", "integer", "decimal", "currency", "date", "datetime", "time"},
    "textarea": {"string", "text"},
    "select": {"enum", "lookup"},
    "radio": {"enum", "lookup"},
    "checkbox": {"boolean"},
    "switch": {"boolean"},
    "multiselect": {"enum", "lookup"},
}
SEARCH_RANGE_TYPES = {"integer", "decimal", "currency", "date", "datetime"}


def entity_permission_names(e: EntityDef) -> set[str]:
    if not e.permissionModule:
        return set()
    return {f"{e.permissionModule.module}.{a}" for a in e.permissionModule.actions}


def known_permissions(ws: Workspace, inv: Inventory) -> set[str]:
    out = set(inv.permission_names())
    for e in ws.entities.values():
        out |= entity_permission_names(e)
    return out


def check(project: Project, ws: Workspace, inv: Inventory, only: set[str] | None = None) -> list[Issue]:
    """Issues for the whole workspace, or for the displays in `only` (and the entities they use)."""
    issues: list[Issue] = list(ws.issues)
    perms = known_permissions(ws, inv)
    displays = [d for d in ws.displays.values() if only is None or d.id in only]
    used_entities = {n for d in displays for n in d.entities()}
    entities = [e for e in ws.entities.values() if only is None or e.name in used_entities]
    for e in entities:
        issues += _entity(project, ws, inv, e, perms)
    issues += _entity_conflicts(ws, inv)
    for d in displays:
        issues += _display(project, ws, inv, d, perms)
    issues += _display_conflicts(ws, inv)
    return issues


# ------------------------------------------------------------------------------------------------ entities
def _entity(project: Project, ws: Workspace, inv: Inventory, e: EntityDef, perms: set[str]) -> list[Issue]:
    out: list[Issue] = []
    w = f"entity:{e.name}"
    err = lambda path, msg: out.append(Issue("error", w, path, msg))  # noqa: E731
    warn = lambda path, msg: out.append(Issue("warning", w, path, msg))  # noqa: E731
    for k in ("view", "create", "update", "delete"):
        p = getattr(e.permissions, k)
        if perms and p not in perms:
            err(f"permissions.{k}", f"permission '{p}' does not exist in the application; pick an existing one or declare it in permissionModule")
    if e.permissionModule and any(m["module"] == e.permissionModule.module for m in inv.permissions):
        existing = next(m for m in inv.permissions if m["module"] == e.permissionModule.module)
        new = [a for a in e.permissionModule.actions if a not in existing["actions"]]
        if new:
            warn("permissionModule", f"module '{e.permissionModule.module}' already exists; actions {', '.join(new)} will be added to it")
    if e.backend.generate:
        # no backend configured (front-end only): the API contract (src/modules/<module>/api/*.api.md) tells the backend
        # team what to build; nothing is generated for the server
        coll = e.backend.collection or collection_of(e.name)
        if coll in inv.collections:
            err("backend.collection", f"collection '{coll}' already exists in the application's data; reuse its API (backend.generate = false) or choose another collection")
        api_path = project.api_base.rstrip("/") + e.endpoint
        clash = [f"{m} {p}" for m, p in inv.routes if p == api_path or p.startswith(api_path + "/")]
        if clash:
            err("endpoint", f"the API already has {clash[0]}; use that API (backend.generate = false) or choose another endpoint")
    for f in e.fields:
        if f.lookup and f.lookup.endpoint.startswith("/lookups/") and inv.lookups and f.lookup.endpoint not in inv.lookups:
            known_entities = {x.endpoint for x in ws.entities.values()}
            if f.lookup.endpoint not in known_entities:
                warn(f"fields.{f.name}.lookup.endpoint", f"lookup '{f.lookup.endpoint}' is not one of the application's lookups")
        if f.dataType == "lookup" and f.lookup and not f.lookup.endpoint.startswith("/lookups/"):
            target = next((x for x in ws.entities.values() if x.endpoint == f.lookup.endpoint), None)
            if target is None and not any(p == project.api_base.rstrip("/") + f.lookup.endpoint for _, p in inv.routes):
                warn(f"fields.{f.name}.lookup.endpoint", f"no entity or API route serves '{f.lookup.endpoint}'")
    if e.parent:
        parent = ws.entities.get(e.parent.entity)
        if parent is None:
            err("parent.entity", f"parent entity '{e.parent.entity}' is not defined")
        elif e.parent.onParentDelete == "cascade" and not parent.backend.generate:
            warn("parent.onParentDelete", "cascade needs the parent's backend to be generated; the parent API decides")
        pf = e.field(e.parent.field)
        if pf and pf.dataType not in ("integer", "lookup", "string"):
            err(f"fields.{pf.name}", "the parent key field must be integer, lookup or string")
    if e.titleField is None:
        warn("titleField", "no titleField: confirmations and titles will show the id")
    return out


def _entity_conflicts(ws: Workspace, inv: Inventory) -> list[Issue]:
    out: list[Issue] = []
    seen_ep: dict[str, str] = {}
    seen_coll: dict[str, str] = {}
    for e in ws.entities.values():
        if e.endpoint in seen_ep:
            out.append(Issue("error", f"entity:{e.name}", "endpoint", f"endpoint {e.endpoint} is also used by {seen_ep[e.endpoint]}"))
        seen_ep[e.endpoint] = e.name
        if e.backend.generate:
            c = e.backend.collection or collection_of(e.name)
            if c in seen_coll:
                out.append(Issue("error", f"entity:{e.name}", "backend.collection", f"collection {c} is also used by {seen_coll[c]}"))
            seen_coll[c] = e.name
    return out


# ------------------------------------------------------------------------------------------------ displays
def _display(project: Project, ws: Workspace, inv: Inventory, d: DisplaySchema, perms: set[str]) -> list[Issue]:
    out: list[Issue] = []
    w = f"display:{d.id}"
    err = lambda path, msg: out.append(Issue("error", w, path, msg))  # noqa: E731
    warn = lambda path, msg: out.append(Issue("warning", w, path, msg))  # noqa: E731

    for name in d.entities():
        if name not in ws.entities:
            err("entity", f"entity '{name}' is not defined")
    if any(n not in ws.entities for n in d.entities()):
        return out

    for p in d.permissions.required:
        if perms and p not in perms:
            err("permissions.required", f"permission '{p}' does not exist in the application")
    for k, p in d.permissions.actions.items():
        if perms and p not in perms:
            err(f"permissions.actions.{k}", f"permission '{p}' does not exist in the application")

    if d.type == "entry":
        out += _entry(w, "entry", ws.entities[d.entity], d.entry)
    elif d.type == "summary":
        out += _summary(w, "summary", ws.entities[d.entity], d.summary)
    else:
        ms = d.masterSlave
        me, de = ws.entities[ms.master.entity], ws.entities[ms.detail.entity]
        out += _summary(w, "masterSlave.master.summary", me, ms.master.summary)
        out += _entry(w, "masterSlave.detail.entry", de, ms.detail.entry)
        if ms.detail.relation == "same":
            if me.name != de.name:
                err("masterSlave.detail.relation", "relation 'same' needs the same entity in the master and the detail")
            if ms.detail.summary:
                err("masterSlave.detail.summary", "relation 'same' has no child list")
        else:
            if me.name == de.name:
                err("masterSlave.detail.relation", "relation 'child' needs a different detail entity")
            if not ms.detail.linkField:
                err("masterSlave.detail.linkField", "relation 'child' needs linkField (the child's field holding the master's key)")
            elif not de.field(ms.detail.linkField):
                err("masterSlave.detail.linkField", f"'{ms.detail.linkField}' is not a field of {de.name}")
            elif de.parent and de.parent.field != ms.detail.linkField:
                warn("masterSlave.detail.linkField", f"{de.name}'s parent link is {de.parent.field}, not {ms.detail.linkField}")
            if ms.detail.masterKey and ms.detail.masterKey != me.idField and not me.field(ms.detail.masterKey):
                err("masterSlave.detail.masterKey", f"'{ms.detail.masterKey}' is not a field of {me.name}")
            if not ms.detail.summary:
                err("masterSlave.detail.summary", "relation 'child' needs the child list (detail.summary)")
            else:
                out += _summary(w, "masterSlave.detail.summary", de, ms.detail.summary)
                if ms.detail.linkField and "{" not in de.endpoint and de.backend.generate is False:
                    warn("masterSlave.detail.linkField", f"the child list is filtered with ?{ms.detail.linkField}=<key>; check that {de.endpoint} supports it")

    # menu placement
    known_menu = {m["id"]: m for m in inv.menus if not m["forge"]}
    forge_folders = {f.id: f for x in ws.displays.values() for f in x.folders}
    for f in d.folders:
        if f.id in known_menu:
            err("folders", f"menu id '{f.id}' already exists (module {known_menu[f.id]['module']})")
        if f.parent and f.parent not in known_menu and f.parent not in forge_folders:
            err("folders", f"folder '{f.id}': parent '{f.parent}' does not exist")
        if f.parent and f.parent in known_menu and not known_menu[f.parent]["folder"]:
            err("folders", f"folder '{f.id}': parent '{f.parent}' is a menu entry, not a folder")
    if d.menu:
        if d.menu.id in known_menu:
            err("menu.id", f"menu id '{d.menu.id}' already exists (module {known_menu[d.menu.id]['module']})")
        if d.menu.id in forge_folders:
            err("menu.id", f"menu id '{d.menu.id}' is also a folder")
        p = d.menu.parent
        if p and p not in known_menu and p not in forge_folders:
            err("menu.parent", f"parent menu '{p}' does not exist; create it as a folder")
        if p and p in known_menu and not known_menu[p]["folder"]:
            err("menu.parent", f"'{p}' is a menu entry, not a folder")
        for rp in d.menu.requiredPermissions:
            if perms and rp not in perms:
                err("menu.requiredPermissions", f"permission '{rp}' does not exist in the application")
        if d.type == "entry" and not d.menu.params.get("id"):
            warn("menu.params", "an Entry display opened from the menu needs params.id = 'new'")
    elif d.type != "entry":
        warn("menu", "this display has no menu entry; it can only be opened by link or from another display")
    # cycles among folders
    parents = {f.id: f.parent for x in ws.displays.values() for f in x.folders}
    for f in d.folders:
        seen, cur = set(), f.id
        while cur in parents and parents[cur]:
            if cur in seen:
                err("folders", f"folder '{f.id}' is part of a parent cycle")
                break
            seen.add(cur)
            cur = parents[cur]

    # links to other displays
    all_ids = {x["id"] for x in inv.displays if not x["forge"]} | set(ws.displays)
    for path, target in _links(d):
        if target and target not in all_ids:
            err(path, f"display '{target}' does not exist")
        if target == d.id:
            err(path, "a display cannot open itself")

    # the summary's entry display must edit the same entity
    if d.type == "summary" and d.summary.entryDisplay in ws.displays:
        t = ws.displays[d.summary.entryDisplay]
        if t.type != "entry" or t.entity != d.entity:
            err("summary.entryDisplay", f"'{t.id}' is not an Entry display of {d.entity}")
    if d.generator.backend is False and any(ws.entities[n].backend.generate for n in d.entities()):
        warn("generator.backend", "backend generation is off for this display, but its entity asks for a generated backend")
    return out


def _links(d: DisplaySchema) -> list[tuple[str, str | None]]:
    if d.type == "summary":
        return [("summary.entryDisplay", d.summary.entryDisplay)]
    if d.type == "entry":
        return [("entry.summaryDisplay", d.entry.summaryDisplay)]
    return []


def _actions(w: str, path: str, e: EntityDef, actions: list[Action], allowed: set[str]) -> list[Issue]:
    out = []
    ids = [a.id for a in actions]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        out.append(Issue("error", w, path, f"action id '{dup}' is used twice"))
    for i, a in enumerate(actions):
        if a.kind not in allowed:
            out.append(Issue("error", w, f"{path}.{i}", f"'{a.kind}' is not available here (use {', '.join(sorted(allowed))})"))
        if a.kind == "custom" and a.path and e.backend.generate and a.path not in e.backend.customActions:
            out.append(Issue("error", w, f"{path}.{i}.path", f"custom action '{a.path}' is not in {e.name}.backend.customActions, so the API has no route for it"))
        if a.kind == "custom" and not a.path:
            out.append(Issue("warning", w, f"{path}.{i}", f"'{a.id}' has no path: implement it in the display's hooks (onAction)"))
    return out


def _entry(w: str, path: str, e: EntityDef, layout: EntryLayout) -> list[Issue]:
    out: list[Issue] = []
    seen: dict[str, str] = {}
    sec_ids = [s.id for s in layout.sections]
    for dup in sorted({i for i in sec_ids if sec_ids.count(i) > 1}):
        out.append(Issue("error", w, f"{path}.sections", f"section id '{dup}' is used twice"))
    placed = set()
    for si, s in enumerate(layout.sections):
        cols = s.columns or layout.columns
        if not s.items:
            out.append(Issue("warning", w, f"{path}.sections.{si}", f"section '{s.title or s.id}' has no fields"))
        for ii, it in enumerate(s.items):
            p = f"{path}.sections.{si}.items.{ii}"
            f = e.field(it.field)
            if f is None:
                out.append(Issue("error", w, p, f"'{it.field}' is not a field of {e.name}"))
                continue
            if it.field in seen:
                out.append(Issue("error", w, p, f"'{it.field}' is already on the form (section {seen[it.field]})"))
            seen[it.field] = s.id
            placed.add(it.field)
            if it.span > cols:
                out.append(Issue("warning", w, p, f"'{it.field}' spans {it.span} columns but its section has {cols}"))
            if it.widget:
                ok_types = WIDGET_TYPES[it.widget]
                if f.dataType not in ok_types:
                    out.append(Issue("error", w, f"{p}.widget", f"a {it.widget} cannot edit a {f.dataType} field"))
                if it.widget == "multiselect" and not f.multiple:
                    out.append(Issue("error", w, f"{p}.widget", "a multiselect needs a field with multiple = true"))
                if it.widget in ("select", "radio") and f.multiple:
                    out.append(Issue("error", w, f"{p}.widget", "a field with several values needs the multiselect widget"))
            if it.visibleWhen and not e.field(it.visibleWhen.field):
                out.append(Issue("error", w, f"{p}.visibleWhen", f"'{it.visibleWhen.field}' is not a field of {e.name}"))
            if it.visibleWhen and it.visibleWhen.field == it.field:
                out.append(Issue("error", w, f"{p}.visibleWhen", "a field cannot depend on itself"))
    for f in e.fields:
        if f.required and f.name not in placed and f.defaultValue is None and not f.readOnly:
            if e.parent and e.parent.field == f.name:
                continue  # filled from the master in a Master-Slave display
            out.append(Issue("error", w, f"{path}.sections", f"required field '{f.name}' is not on the form and has no default: saving would always fail"))
    for c in layout.copyExclude:
        if not e.field(c):
            out.append(Issue("error", w, f"{path}.copyExclude", f"'{c}' is not a field of {e.name}"))
    out += _actions(w, f"{path}.actions", e, layout.actions, {"save", "delete", "copy", "audit", "reset", "cancel", "custom"})
    if layout.actions and not any(a.kind == "save" for a in layout.actions):
        out.append(Issue("warning", w, f"{path}.actions", "no Save action: the form is read only"))
    return out


def _summary(w: str, path: str, e: EntityDef, layout: SummaryLayout) -> list[Issue]:
    out: list[Issue] = []
    names = {f.name for f in e.fields} | {e.idField}
    cols: list[Column] = layout.columns
    fields = [c.field for c in cols]
    for dup in sorted({f for f in fields if fields.count(f) > 1}):
        out.append(Issue("error", w, f"{path}.columns", f"column '{dup}' appears twice"))
    for i, c in enumerate(cols):
        if c.field not in names:
            out.append(Issue("error", w, f"{path}.columns.{i}", f"'{c.field}' is not a field of {e.name}"))
        if c.width and c.flex:
            out.append(Issue("warning", w, f"{path}.columns.{i}", "width and flex are both set; flex wins"))
    if all(c.hidden for c in cols):
        out.append(Issue("error", w, f"{path}.columns", "every column is hidden"))
    params = []
    for i, s in enumerate(layout.searchFields):
        f = e.field(s.field)
        if f is None:
            out.append(Issue("error", w, f"{path}.searchFields.{i}", f"'{s.field}' is not a field of {e.name}"))
            continue
        if s.operator == "between" and f.dataType not in SEARCH_RANGE_TYPES:
            out.append(Issue("error", w, f"{path}.searchFields.{i}", f"'between' needs a numeric or date field; {s.field} is {f.dataType}"))
        if s.operator in ("gte", "lte") and f.dataType not in SEARCH_RANGE_TYPES:
            out.append(Issue("error", w, f"{path}.searchFields.{i}", f"'{s.operator}' needs a numeric or date field"))
        if s.param and s.param != s.field and e.backend.generate:
            out.append(Issue("warning", w, f"{path}.searchFields.{i}.param",
                             f"the generated API filters by field name; '{s.param}' is ignored there (set param only for an existing API)"))
        params.append(s.param or s.field)
    for dup in sorted({p for p in params if params.count(p) > 1}):
        out.append(Issue("error", w, f"{path}.searchFields", f"query parameter '{dup}' is used by two search fields"))
    for i, s in enumerate(layout.sorters):
        if s.field not in names:
            out.append(Issue("error", w, f"{path}.sorters.{i}", f"'{s.field}' is not a field of {e.name}"))
    if layout.remote and not layout.pageSize:
        out.append(Issue("warning", w, f"{path}.pageSize", "server paging without a page size uses 50"))
    if layout.remote and not e.backend.generate:
        out.append(Issue("warning", w, f"{path}.remote", f"server paging sends start/limit/sort to {e.endpoint}; check the API supports them"))
    out += _actions(w, f"{path}.toolbarActions", e, layout.toolbarActions, {"new", "open", "delete", "refresh", "custom"})
    out += _actions(w, f"{path}.rowActions", e, layout.rowActions, {"open", "delete", "custom"})
    return out


def _display_conflicts(ws: Workspace, inv: Inventory) -> list[Issue]:
    out: list[Issue] = []
    others = [x for x in inv.displays if not x["forge"]]
    taken_ids = {x["id"]: x["module"] for x in others}
    taken_routes = {x["route"]: x["id"] for x in others}
    keys = set(inv.display_keys)
    seen_key: dict[str, str] = {}
    seen_route: dict[str, str] = {}
    seen_menu: dict[str, str] = {}
    for d in ws.displays.values():
        w = f"display:{d.id}"
        if d.id in taken_ids:
            out.append(Issue("error", w, "id", f"display id '{d.id}' is already registered by module {taken_ids[d.id]}"))
        if d.name in keys:
            out.append(Issue("error", w, "name", f"implementation key '{d.name}' already exists in the app's display registry"))
        if d.name in seen_key:
            out.append(Issue("error", w, "name", f"name '{d.name}' is also used by display {seen_key[d.name]}"))
        seen_key[d.name] = d.id
        route = d.route or f"d/{d.id}"
        if route in taken_routes:
            out.append(Issue("error", w, "route", f"route '{route}' is used by display {taken_routes[route]}"))
        if route in seen_route:
            out.append(Issue("error", w, "route", f"route '{route}' is also used by display {seen_route[route]}"))
        seen_route[route] = d.id
        for mid in ([d.menu.id] if d.menu else []) + [f.id for f in d.folders]:
            if mid in seen_menu:
                out.append(Issue("error", w, "menu", f"menu id '{mid}' is also used by display {seen_menu[mid]}"))
            seen_menu[mid] = d.id
    return out


def has_errors(issues: list[Issue]) -> bool:
    return any(i.level == "error" for i in issues)
