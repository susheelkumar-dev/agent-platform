"""API contracts: what each entity's screens send and expect, for the team that owns the backend.

UI Forge writes the front end only (unless a backend it can generate for is configured with --api). The screens
call the application's API exactly as written here, so the backend team (.NET, Java, Node ...) implements or maps
these endpoints in its own code, with its own authorization:

    src/modules/<module>/api/<entity>.api.md      one per entity a display uses (generated, rewritten)

The contract is derived from the same schemas as the screens, so it changes when a field, search or action does.
"""

from __future__ import annotations

from .files import GeneratedFile
from .naming import entity_file
from .schema import DisplaySchema, EntityDef, EntityField, SearchField, SummaryLayout
from .workspace import Workspace, entity_path

JSON_TYPE = {
    "string": "string", "text": "string", "integer": "integer", "decimal": "number", "currency": "number",
    "boolean": "boolean", "date": "string (date, YYYY-MM-DD)", "datetime": "string (date-time, ISO 8601)",
    "time": "string (time, HH:mm)", "enum": "string", "lookup": "id of the lookup",
}


def _summaries(d: DisplaySchema) -> list[tuple[str, SummaryLayout]]:
    out: list[tuple[str, SummaryLayout]] = []
    if d.type == "summary" and d.summary and d.entity:
        out.append((d.entity, d.summary))
    if d.type == "master-slave" and d.masterSlave:
        out.append((d.masterSlave.master.entity, d.masterSlave.master.summary))
        if d.masterSlave.detail.summary is not None:
            out.append((d.masterSlave.detail.entity, d.masterSlave.detail.summary))
    return out


def _rules(f: EntityField) -> str:
    r: list[str] = []
    if f.required:
        r.append("required")
    if f.unique:
        r.append("unique")
    if f.readOnly:
        r.append("read only")
    if f.minLength is not None:
        r.append(f"min length {f.minLength}")
    if f.maxLength is not None:
        r.append(f"max length {f.maxLength}")
    if f.min is not None:
        r.append(f"≥ {f.min:g}")
    if f.max is not None:
        r.append(f"≤ {f.max:g}")
    if f.decimals is not None:
        r.append(f"{f.decimals} decimals")
    if f.currency:
        r.append(f"currency {f.currency}")
    if f.pattern:
        r.append(f"pattern `{f.pattern}`")
    if f.upperCase:
        r.append("upper case")
    if f.options:
        r.append("one of " + ", ".join(f"`{o}`" for o in f.options))
    if f.lookup:
        r.append(f"from `{f.lookup.endpoint}` ({f.lookup.valueField} / {f.lookup.labelField})")
    if f.multiple:
        r.append("a list")
    if f.defaultValue is not None:
        r.append(f"default `{f.defaultValue}`")
    return "; ".join(r) or "—"


def _search_rows(fields: dict[str, EntityField], searches: list[SearchField]) -> list[str]:
    rows = []
    for s in searches:
        p = s.param or s.field
        f = fields.get(s.field)
        label = (s.label or (f.label if f else s.field))
        if s.operator == "between":
            rows.append(f"| `{p}From`, `{p}To` | {label}: from / to (either may be absent) |")
        elif s.operator == "gte":
            rows.append(f"| `{p}From` | {label}: at least |")
        elif s.operator == "lte":
            rows.append(f"| `{p}To` | {label}: at most |")
        elif s.operator == "in":
            rows.append(f"| `{p}` | {label}: any of a comma-separated list |")
        elif s.operator == "contains":
            rows.append(f"| `{p}` | {label}: contains the text (case-insensitive) |")
        else:
            rows.append(f"| `{p}` | {label}: equals{' (comma-separated list for several)' if f and f.multiple else ''} |")
        if s.required:
            rows[-1] = rows[-1][:-2] + " — always sent |"
    return rows


def _contract(ws: Workspace, e: EntityDef, displays: list[DisplaySchema]) -> str:
    fields = {f.name: f for f in e.fields}
    base = e.endpoint
    p = e.permissions
    searches: list[SearchField] = []
    remote = False
    sorters: set[str] = set()
    actions: set[str] = set(e.backend.customActions)
    for d in displays:
        for ent, sm in _summaries(d):
            if ent != e.name:
                continue
            remote = remote or sm.remote
            for s in sm.searchFields:
                if all((x.param or x.field, x.operator) != (s.param or s.field, s.operator) for x in searches):
                    searches.append(s)
            sorters.update(s.field for s in sm.sorters)
            actions.update(a.path for a in (sm.toolbarActions + sm.rowActions) if a.kind == "custom" and a.path)
        entry = d.entry if d.entity == e.name else (d.masterSlave.detail.entry if d.masterSlave and d.masterSlave.detail.entity == e.name else None)
        if entry is not None:
            actions.update(a.path for a in entry.actions if a.kind == "custom" and a.path)
    used_by = ", ".join(f"`{d.id}`" for d in displays)

    L = [
        f"# API contract: {e.label}",
        "",
        f"Generated by UI Forge from `{entity_path(e)}`. Do not edit: it is rewritten when the schema changes.",
        f"Screens using it: {used_by}.",
        "",
        "The screens call these endpoints, relative to the app's API base (`apiBase` in `src/app.config.ts`), with the",
        "signed-in user's token (`Authorization: Bearer …`). **The backend must check the permission on every call**;",
        "the screens only hide what a user may not do.",
        "",
        "## Endpoints",
        "",
        "| Method | Path | Permission | Purpose |",
        "| --- | --- | --- | --- |",
        f"| GET | `{base}` | `{p.view}` | list (search, sort{', paging' if remote else ''}) |",
        f"| GET | `{base}/{{id}}` | `{p.view}` | one record |",
        f"| POST | `{base}` | `{p.create}` | create; body = the record without `{e.idField}` |",
        f"| PUT | `{base}/{{id}}` | `{p.update}` | update; body = the changed record |",
        f"| DELETE | `{base}/{{id}}` | `{p.delete}` | delete |",
    ]
    for a in sorted(x for x in actions if x):
        L.append(f"| POST | `{base}/{{id}}/{a}` | `{p.update}` | custom action *{a}* (empty body) |")
    L += ["", "## List query parameters", "", "| Parameter | Meaning |", "| --- | --- |",
          "| `sort` | JSON list, e.g. `[{\"property\":\"name\",\"direction\":\"ASC\"}]` |"]
    if remote:
        L += ["| `start`, `limit` | paging: skip `start` records, return at most `limit` |"]
    L += _search_rows(fields, searches)
    if e.parent:
        L.append(f"| `{e.parent.field}` | the parent {e.parent.entity}'s id (child lists) |")
    L += [
        "",
        "## Responses",
        "",
        "- List: `{ \"success\": true, \"data\": [ …records ], \"total\": 120 }`"
        + (" — `total` = all matches before paging." if remote else " — a bare JSON array also works."),
        "- One record, create, update: `{ \"success\": true, \"data\": { …record } }` (or the bare record). Create returns the new `" + e.idField + "`.",
        "- Delete and custom actions: any 2xx.",
        "- Errors: a 4xx/5xx with `{ \"success\": false, \"message\": \"…\", \"errors\": { \"field\": \"what is wrong\" } }`;",
        "  `errors` is optional and puts the text under that field in the form. 401 = sign in again, 403 = not allowed.",
        "",
        "## Record",
        "",
        "| Field | JSON type | Label | Rules the backend must enforce |",
        "| --- | --- | --- | --- |",
        f"| `{e.idField}` | integer | Id | set by the backend |",
    ]
    for f in e.fields:
        L.append(f"| `{f.name}` | {JSON_TYPE.get(f.dataType, 'string')}{'[]' if f.multiple else ''} | {f.label} | {_rules(f)} |")
    if e.parent:
        L += ["", f"`{e.parent.field}` links each record to its {e.parent.entity}; deleting the parent: **{e.parent.onParentDelete}**."]
    lookups = sorted({f.lookup.endpoint for f in e.fields if f.lookup})
    if lookups:
        L += ["", "## Lookups the screens also call", "", "Each returns `[{ id, name }]` (or the fields named in the rules above):", ""]
        L += [f"- `GET {x}`" for x in lookups]
    if e.permissionModule:
        pm = e.permissionModule
        L += ["", "## Permissions to declare", "",
              f"Module `{pm.module}` ({pm.label}) with actions " + ", ".join(f"`{pm.module}.{a}`" for a in pm.actions) + ".",
              "The display registry refuses menus that name a permission the application does not have, so add these to the",
              "backend's permission catalogue before registering."]
        if pm.grants:
            L += ["", "Suggested role grants: " + "; ".join(f"{r}: {', '.join(a)}" for r, a in sorted(pm.grants.items())) + "."]
    L += ["", "## Done when", "",
          "- [ ] every endpoint above answers with the shapes above",
          "- [ ] each call checks its permission and returns 403 otherwise",
          "- [ ] the rules in the Record table are validated on the server (400 with `errors` per field)",
          "- [ ] the screens work against it: UI Forge → Preview → Live API"]
    return "\n".join(L) + "\n"


def contract_files(ws: Workspace) -> list[GeneratedFile]:
    users: dict[str, list[DisplaySchema]] = {}
    for d in sorted(ws.displays.values(), key=lambda x: x.id):
        for name in d.entities():
            users.setdefault(name, []).append(d)
    out = []
    for name, displays in sorted(users.items()):
        e = ws.entities.get(name)
        if e is None:
            continue
        out.append(GeneratedFile("app", f"src/modules/{e.module}/api/{entity_file(e.name)}.api.md", _contract(ws, e, displays),
                                 source=entity_path(e), note="what the backend must provide"))
    return out
