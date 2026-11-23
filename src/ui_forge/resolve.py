"""Schema -> the framework's template configuration (SummaryConfig, EntryConfig, MasterSlaveConfig).

One function per framework type. The same output feeds the generated TypeScript (`*.config.generated.ts`), the
builder's live preview and the generated tests, so what the developer previews is what ships.
"""

from __future__ import annotations

from typing import Any

from .naming import pascal
from .schema import (
    Action,
    Column,
    DisplaySchema,
    EntityDef,
    EntityField,
    EntryLayout,
    FormItem,
    SearchField,
    SummaryLayout,
)
from .workspace import Workspace

NUMERIC = {"integer", "decimal", "currency"}


def _clean(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None and v is not False and v != [] and v != {}}


def field_type(f: EntityField) -> str:
    t = f.dataType
    if t == "enum":
        return "multiselect" if f.multiple else "select"
    if t == "lookup":
        return "multiselect" if f.multiple else "lookup"
    return t


def field_def(e: EntityDef, f: EntityField, item: FormItem | None = None) -> dict[str, Any]:
    it = item or FormItem(field=f.name)
    d: dict[str, Any] = {
        "name": f.name,
        "label": it.label or f.label,
        "type": field_type(f),
        "widget": it.widget,
        "required": f.required or None,
        "maxLength": f.maxLength, "minLength": f.minLength,
        "min": f.min, "max": f.max,
        "decimals": f.decimals if f.decimals is not None else (2 if f.dataType == "currency" else 0 if f.dataType == "integer" else None),
        "currency": f.currency,
        "pattern": f.pattern, "patternMessage": f.patternMessage,
        "placeholder": it.placeholder,
        "upperCase": f.upperCase or None,
        "options": f.options,
        "lookup": f.lookup.model_dump() if f.lookup else None,
        "defaultValue": it.defaultValue if it.defaultValue is not None else f.defaultValue,
        "readOnly": (it.readOnly if it.readOnly is not None else f.readOnly) or None,
        "readOnlyOnEdit": it.readOnlyOnEdit or None,
        "help": it.help or f.description,
        "hidden": it.hidden or None,
        "span": it.span if it.span > 1 else None,
        "visibleWhen": it.visibleWhen.model_dump() if it.visibleWhen else None,
        "validator": it.validator,
    }
    if f.dataType == "integer" and d["decimals"] == 0:
        d["decimals"] = None  # integers are whole numbers already
    return _clean(d)


def column_def(e: EntityDef, c: Column) -> dict[str, Any]:
    f = e.field(c.field)
    t = f.dataType if f else "integer"  # the id column
    grid_type = "number" if t in NUMERIC else "date" if t in ("date", "datetime") else "boolean" if t == "boolean" else "string"
    renderer = c.renderer
    if not renderer and f is not None:
        if t == "currency":
            renderer = f"currency:{f.currency or 'INR'}"
        elif t == "datetime":
            renderer = "datetime"
        elif t == "time":
            renderer = "time"
        elif f.multiple and t == "enum":
            renderer = "list"
    filt: Any = c.filter
    if filt is True and f is not None and t == "enum" and not f.multiple:
        filt = "list"
    d: dict[str, Any] = {
        "field": c.field,
        "text": c.label or (f.label if f else "ID"),
        "type": grid_type if grid_type != "string" else None,
        "width": c.width if not c.flex else None,
        "flex": c.flex,
        "align": c.align or ("right" if t in NUMERIC or f is None else "center" if t == "boolean" else None),
        "decimals": c.decimals if c.decimals is not None else (0 if t == "integer" or f is None else (f.decimals if f and f.decimals is not None else 2) if t in NUMERIC else None),
        "format": c.format,
        "options": f.options if f is not None and t == "enum" and not f.multiple else None,
        "filter": filt if filt is not True else None,
        "sortable": False if not c.sortable else None,
        "hidden": c.hidden or None,
        "renderer": renderer,
        "badgeTones": c.badgeTones,
        "lookup": f.lookup.model_dump() if f is not None and f.lookup else None,
    }
    if filt is False:
        d["filter"] = False
    return {k: v for k, v in d.items() if v is not None and v != [] and v != {}}


def search_def(e: EntityDef, s: SearchField) -> dict[str, Any]:
    f = e.field(s.field)
    base = field_def(e, f) if f else {"name": s.field, "label": s.field}
    keep = {k: base[k] for k in ("name", "label", "type", "options", "lookup") if k in base}
    if keep.get("type") == "multiselect":
        keep["type"] = "lookup" if f and f.lookup else "select"
    return _clean({**keep, "label": s.label or keep.get("label"), "operator": s.operator if s.operator != "eq" else None,
                   "param": s.param, "required": s.required or None, "defaultValue": s.defaultValue, "placeholder": s.placeholder})


def action_def(a: Action) -> dict[str, Any]:
    return _clean(a.model_dump())


def entry_config(e: EntityDef, layout: EntryLayout, audit_endpoint: str = "/audit") -> dict[str, Any]:
    fields = []
    sections = []
    for s in layout.sections:
        for it in s.items:
            f = e.field(it.field)
            if f is not None:
                fields.append(field_def(e, f, it))
        sections.append(_clean({"id": s.id, "title": s.title, "kind": s.kind, "columns": s.columns, "collapsible": s.collapsible,
                                "collapsed": s.collapsed, "description": s.description, "fields": [i.field for i in s.items]}))
    has_audit = any(a.kind == "audit" for a in layout.actions)
    cfg: dict[str, Any] = {
        "entity": e.label,
        "endpoint": e.endpoint,
        "idField": e.idField if e.idField != "id" else None,
        "titleField": e.titleField,
        "fields": fields,
        "columns": layout.columns,
        "sections": sections if not (len(sections) == 1 and sections[0].get("kind") == "plain" and not sections[0].get("title")) else None,
        "actions": [action_def(a) for a in layout.actions] or None,
        "audit": {"endpoint": audit_endpoint, "entityType": e.backend.auditEntityType or e.label} if has_audit else None,
        "copyExclude": layout.copyExclude or None,
        "summaryDisplay": layout.summaryDisplay,
    }
    return {k: v for k, v in cfg.items() if v is not None}


def summary_config(e: EntityDef, layout: SummaryLayout) -> dict[str, Any]:
    cfg: dict[str, Any] = {
        "entity": e.label,
        "entityPlural": e.plural,
        "endpoint": e.endpoint,
        "idField": e.idField if e.idField != "id" else None,
        "titleField": e.titleField,
        "columns": [column_def(e, c) for c in layout.columns],
        "entryDisplay": layout.entryDisplay,
        "sorters": [{"property": s.field, "direction": s.direction} for s in layout.sorters] or None,
        "remote": layout.remote or None,
        "pageSize": layout.pageSize or (50 if layout.remote else None),
        "searchFields": [search_def(e, s) for s in layout.searchFields] or None,
        "autoLoad": False if not layout.autoLoad else None,
        "toolbarActions": [action_def(a) for a in layout.toolbarActions] or None,
        "rowActions": [action_def(a) for a in layout.rowActions] or None,
        "emptyText": layout.emptyText,
        "selection": layout.selection if layout.selection != "single" else None,
        "features": layout.features or None,
    }
    return {k: v for k, v in cfg.items() if v is not None}


def master_slave_config(ws: Workspace, d: DisplaySchema, audit_endpoint: str = "/audit") -> dict[str, Any]:
    ms = d.masterSlave
    me, de = ws.entities[ms.master.entity], ws.entities[ms.detail.entity]
    cfg: dict[str, Any] = {
        "master": summary_config(me, ms.master.summary),
        "relation": ms.detail.relation,
        "detail": {"entry": entry_config(de, ms.detail.entry, audit_endpoint)},
        "linkField": ms.detail.linkField,
        "masterKey": ms.detail.masterKey,
        "orientation": ms.orientation,
        "split": ms.split,
        "unsavedChanges": ms.unsavedChanges,
        "stackBelow": ms.stackBelow,
    }
    if ms.detail.summary:
        cfg["detail"]["summary"] = summary_config(de, ms.detail.summary)
    return {k: v for k, v in cfg.items() if v is not None}


def display_config(ws: Workspace, d: DisplaySchema, audit_endpoint: str = "/audit") -> dict[str, Any]:
    if d.type == "entry":
        return entry_config(ws.entities[d.entity], d.entry, audit_endpoint)
    if d.type == "summary":
        return summary_config(ws.entities[d.entity], d.summary)
    return master_slave_config(ws, d, audit_endpoint)


def config_type(d: DisplaySchema) -> str:
    return {"entry": "EntryConfig", "summary": "SummaryConfig", "master-slave": "MasterSlaveConfig"}[d.type]


def factory(d: DisplaySchema) -> tuple[str, str]:
    """(framework factory, hooks type)"""
    return {"entry": ("createEntryDisplay", "EntryHooks"), "summary": ("createSummaryDisplay", "SummaryHooks"),
            "master-slave": ("createMasterSlaveDisplay", "MasterSlaveHooks")}[d.type]


def permissions_of(ws: Workspace, d: DisplaySchema) -> tuple[list[str], dict[str, str]]:
    """requiredPermissions and actionPermissions of the registry entry: defaults from the entities, then the display's own."""
    ents = [ws.entities[n] for n in d.entities() if n in ws.entities]
    if not ents:
        return list(d.permissions.required), dict(d.permissions.actions)
    main = ents[0]
    required = sorted({e.permissions.view for e in ents})
    actions = {"create": main.permissions.create, "update": main.permissions.update, "delete": main.permissions.delete}
    if d.type == "master-slave" and d.masterSlave.detail.relation == "child":
        de = ents[1]
        actions.update({"detail-create": de.permissions.create, "detail-update": de.permissions.update, "detail-delete": de.permissions.delete})
    required = list(d.permissions.required) or required
    actions.update(d.permissions.actions)
    return sorted(set(required)), dict(sorted(actions.items()))


def component_name(d: DisplaySchema) -> str:
    return pascal(d.name)
