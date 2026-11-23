"""Backend files for the GridTrade Node API (server/generated), loaded through its module seam
(server/security.js reads index.js for permissions; server/server.js calls index.register with its helpers).

    server/generated/forge-runtime.js                  shared validation, filtering, coercion (generated)
    server/generated/<entity>.routes.generated.js      CRUD + custom action routes per entity (generated)
    server/generated/<entity>.hooks.js                 business rules (developer, written once)
    server/generated/index.js                          permissions, entity types, route registration (generated)
    server/generated/selftest.generated.js             API tests for every generated entity (generated)

Every route uses the API's own helpers: need() for permissions, bad() for field errors, store.insert/update/remove
(which write the audit trail), listResult for sorting and paging. Reads need the entity's view permission.
"""

from __future__ import annotations

import json
from typing import Any

from .files import GeneratedFile, js_banner
from .naming import collection_of, entity_file
from .project import Project
from .schema import EntityDef, EntityField
from .workspace import Workspace, entity_path

# GridTrade lookups that are collections keyed by numeric id (checked on save)
KNOWN_LOOKUP_COLLECTIONS = {
    "/lookups/counterparties": "counterparties", "/lookups/legalEntities": "legalEntities", "/lookups/nodes": "nodes",
    "/lookups/timeseries": "timeseries", "/lookups/contracts": "contracts", "/lookups/roles": "roles",
}


def _j(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False)


def _field_spec(ws: Workspace, f: EntityField) -> dict[str, Any]:
    spec: dict[str, Any] = {"name": f.name, "label": f.label, "type": f.dataType}
    for k in ("required", "unique", "multiple", "upperCase", "readOnly"):
        if getattr(f, k):
            spec[k] = True
    for k in ("maxLength", "minLength", "min", "max", "decimals", "pattern", "patternMessage", "options", "defaultValue"):
        v = getattr(f, k)
        if v is not None:
            spec[k] = v
    if f.lookup:
        ep = f.lookup.endpoint
        target = next((e for e in ws.entities.values() if e.endpoint == ep and e.backend.generate), None)
        if target is not None:
            spec["refCollection"] = target.backend.collection or collection_of(target.name)
            spec["refLabel"] = target.label
        elif ep in KNOWN_LOOKUP_COLLECTIONS:
            spec["refCollection"] = KNOWN_LOOKUP_COLLECTIONS[ep]
        elif ep.startswith("/lookups/"):
            spec["refLookup"] = ep.split("/")[-1]
    return spec


RUNTIME = r"""
/**
 * Shared helpers of generated modules: picking, coercing and validating fields, and list filtering.
 * A field spec is { name, label, type, required, unique, multiple, maxLength, minLength, min, max, decimals,
 * pattern, options, refCollection | refLookup }. Types: string text integer decimal currency boolean date datetime
 * time enum lookup.
 */
const NUMERIC = new Set(['integer', 'decimal', 'currency']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const empty = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && !v.length);

function coerceOne(f, v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return f.type === 'boolean' ? false : null;
  if (NUMERIC.has(f.type)) { const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : v; }
  if (f.type === 'boolean') return v === true || v === 'true' || v === 1 || v === '1';
  if (f.type === 'lookup' && f.refCollection && /^-?\d+$/.test(String(v))) return Number(v);
  if (typeof v === 'string' && (f.type === 'string' || f.type === 'text')) return f.upperCase ? v.trim().toUpperCase() : v.trim();
  return v;
}

function coerce(f, v) {
  if (f.multiple) {
    if (v === undefined) return undefined;
    if (v === null || v === '') return [];
    return (Array.isArray(v) ? v : String(v).split(',')).map(x => coerceOne(f, x)).filter(x => x !== null && x !== '');
  }
  return coerceOne(f, v);
}

/** The known fields of a request body, coerced to their types (unknown keys and read-only fields are dropped). */
function pick(fields, body, { includeReadOnly = false } = {}) {
  const out = {};
  for (const f of fields) {
    if (f.readOnly && !includeReadOnly) continue;
    if (body && Object.prototype.hasOwnProperty.call(body, f.name)) out[f.name] = coerce(f, body[f.name]);
  }
  return out;
}

function withDefaults(fields, d) {
  const out = Object.assign({}, d);
  for (const f of fields) {
    if (out[f.name] !== undefined) continue;
    if (f.defaultValue !== undefined) out[f.name] = Array.isArray(f.defaultValue) ? f.defaultValue.slice() : f.defaultValue;
    else if (f.type === 'boolean') out[f.name] = false;
    else if (f.multiple) out[f.name] = [];
  }
  return out;
}

function decimals(n) { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }

/** Field errors of a whole record ({ field: message }); `others` are the rest of the collection (uniqueness). */
function validate(fields, rec, { others = [], data = {}, lookups = {} } = {}) {
  const errors = {};
  for (const f of fields) {
    const v = rec[f.name];
    if (empty(v)) { if (f.required) errors[f.name] = 'Required'; continue; }
    const values = f.multiple ? (Array.isArray(v) ? v : [v]) : [v];
    if (f.multiple && !Array.isArray(v)) { errors[f.name] = 'Must be a list'; continue; }
    let msg = null;
    for (const x of values) {
      if (NUMERIC.has(f.type)) {
        if (typeof x !== 'number' || !Number.isFinite(x)) msg = 'Must be a number';
        else if (f.type === 'integer' && !Number.isInteger(x)) msg = 'Must be a whole number';
        else if (f.min !== undefined && x < f.min) msg = `Must be at least ${f.min}`;
        else if (f.max !== undefined && x > f.max) msg = `Must be at most ${f.max}`;
        else if (f.decimals !== undefined && f.type !== 'integer' && decimals(x) > f.decimals) msg = `Allows ${f.decimals} decimal place(s)`;
      } else if (f.type === 'boolean') {
        if (typeof x !== 'boolean') msg = 'Must be true or false';
      } else if (f.type === 'date') {
        if (typeof x !== 'string' || !DATE_RE.test(x) || isNaN(Date.parse(x))) msg = 'Use YYYY-MM-DD';
      } else if (f.type === 'datetime') {
        if (typeof x !== 'string' || !DATETIME_RE.test(x) || isNaN(Date.parse(x))) msg = 'Use YYYY-MM-DDThh:mm';
      } else if (f.type === 'time') {
        if (typeof x !== 'string' || !TIME_RE.test(x)) msg = 'Use hh:mm';
      } else if (f.type === 'enum') {
        if (!(f.options || []).map(String).includes(String(x))) msg = `Must be one of ${(f.options || []).join(', ')}`;
      } else if (f.type === 'lookup') {
        if (f.refCollection) {
          const rows = data[f.refCollection] || [];
          if (!rows.some(r => String(r.id) === String(x))) msg = `Unknown ${(f.refLabel || f.label).toLowerCase()}`;
        } else if (f.refLookup && Array.isArray(lookups[f.refLookup]) && !lookups[f.refLookup].map(String).includes(String(x))) {
          msg = `Must be one of ${lookups[f.refLookup].join(', ')}`;
        }
      } else if (typeof x === 'string') {
        if (f.maxLength !== undefined && x.length > f.maxLength) msg = `At most ${f.maxLength} characters`;
        else if (f.minLength !== undefined && x.length < f.minLength) msg = `At least ${f.minLength} characters`;
        else if (f.pattern && !new RegExp(f.pattern).test(x)) msg = f.patternMessage || 'Not in the expected format';
      } else {
        msg = 'Must be text';
      }
      if (msg) break;
    }
    if (msg) { errors[f.name] = msg; continue; }
    if (f.unique) {
      const norm = x => (typeof x === 'string' ? x.toLowerCase() : JSON.stringify(x));
      if (others.some(o => o.id !== rec.id && !empty(o[f.name]) && norm(o[f.name]) === norm(v))) errors[f.name] = `Another record already has this ${f.label.toLowerCase()}`;
    }
  }
  return errors;
}

/** Rows matching the query: field=value (text fields: contains; lists: any), fieldFrom / fieldTo, query (any text). */
function filterRows(fields, rows, q) {
  let out = rows;
  if (q.query) {
    const s = String(q.query).toLowerCase();
    const texts = fields.filter(f => f.type === 'string' || f.type === 'text' || f.type === 'enum');
    out = out.filter(r => texts.some(f => String(r[f.name] ?? '').toLowerCase().includes(s)));
  }
  for (const f of fields) {
    const v = q[f.name];
    if (v !== undefined && v !== '') {
      const want = String(v).split(',').map(x => x.trim().toLowerCase());
      if (f.type === 'string' || f.type === 'text') out = out.filter(r => String(r[f.name] ?? '').toLowerCase().includes(want.join(',')));
      else out = out.filter(r => {
        const have = f.multiple ? (r[f.name] || []) : [r[f.name]];
        return have.some(h => want.includes(String(h ?? '').toLowerCase()));
      });
    }
    const from = q[f.name + 'From'], to = q[f.name + 'To'];
    if ((from !== undefined && from !== '') || (to !== undefined && to !== '')) {
      const num = NUMERIC.has(f.type);
      const val = x => (num ? Number(x) : String(x));
      out = out.filter(r => {
        const x = r[f.name];
        if (x === null || x === undefined || x === '') return false;
        if (from !== undefined && from !== '' && val(x) < val(from)) return false;
        if (to !== undefined && to !== '') {
          const t = !num && f.type === 'datetime' && String(to).length === 10 ? String(to) + 'T23:59:59' : to;
          if (val(x) > val(t)) return false;
        }
        return true;
      });
    }
  }
  return out;
}

module.exports = { coerce, pick, withDefaults, validate, filterRows, empty };
"""


def _routes(ws: Workspace, e: EntityDef) -> str:
    coll = e.backend.collection or collection_of(e.name)
    ef = entity_file(e.name)
    fields = [_field_spec(ws, f) for f in e.fields]
    entity_type = e.backend.auditEntityType or e.label
    parent = None
    if e.parent:
        pe = ws.entities.get(e.parent.entity)
        if pe is not None:
            parent = {"field": e.parent.field, "collection": pe.backend.collection or collection_of(pe.name), "label": pe.label,
                      "generated": pe.backend.generate}
    children = []
    for c in sorted(ws.entities.values(), key=lambda x: x.name):
        if c.parent and c.parent.entity == e.name and c.backend.generate:
            children.append({"collection": c.backend.collection or collection_of(c.name), "field": c.parent.field, "label": c.label,
                             "plural": c.plural, "entityType": c.backend.auditEntityType or c.label, "onDelete": c.parent.onParentDelete})
    actions = {a: e.permissions.update for a in e.backend.customActions}
    return js_banner(entity_path(e), f"{ef}.hooks.js") + f"""const rt = require('./forge-runtime');
const hooks = require('./{ef}.hooks');

const ENTITY = {_j(entity_type)};
const COLLECTION = {_j(coll)};
const BASE = {_j('/api' + e.endpoint)};
const TITLE_FIELD = {_j(e.titleField)};
const PERM = {_j(e.permissions.model_dump())};
const FIELDS = {json.dumps(fields, indent=2, ensure_ascii=False)};
const PARENT = {_j(parent)};
const CHILDREN = {json.dumps(children, indent=2, ensure_ascii=False)};
const ACTIONS = {_j(actions)};

/** Routes of {e.label}: list (filters, sort, paging), get, create, update, delete, custom actions. */
module.exports = function register(api) {{
  const {{ route, need, ok, bad, notFound, HttpError, readBody, listResult, store, D, lookups }} = api;
  const rows = () => {{ const db = D(); if (!Array.isArray(db[COLLECTION])) db[COLLECTION] = []; return db[COLLECTION]; }};
  const find = id => rows().find(r => r.id === Number(id));
  const view = rec => (hooks.view ? hooks.view(Object.assign({{}}, rec), {{ api }}) : rec);
  // the audit trail names a record by its `name`; entities without such a field get one while they are inserted
  const HAS_NAME = FIELDS.some(f => f.name === 'name');
  const named = rec => (HAS_NAME ? rec : Object.assign({{ name: TITLE_FIELD ? String(rec[TITLE_FIELD] ?? '') : '' }}, rec));
  const lookupValues = () => Object.fromEntries(Object.entries(lookups || {{}}).map(([k, v]) => [k, Array.isArray(v) ? v : []]));

  function check(rec, ctx) {{
    const errors = rt.validate(FIELDS, rec, {{ others: rows(), data: D(), lookups: lookupValues() }});
    if (PARENT && rec[PARENT.field] !== undefined && rec[PARENT.field] !== null && !errors[PARENT.field]) {{
      const parents = D()[PARENT.collection] || [];
      if (!parents.some(p => String(p.id) === String(rec[PARENT.field]))) errors[PARENT.field] = `Unknown ${{PARENT.label.toLowerCase()}}`;
    }}
    if (hooks.validate) Object.assign(errors, hooks.validate(rec, {{ ctx, api }}) || {{}});
    if (Object.keys(errors).length) bad('Please correct the highlighted fields', errors);
  }}

  route('GET', BASE, (req, p, q, ctx) => {{
    need(ctx, PERM.view);
    return listResult(rt.filterRows(FIELDS, rows(), q).map(view), q);
  }});

  route('GET', BASE + '/:id', (req, p, q, ctx) => {{
    need(ctx, PERM.view);
    return ok(view(find(p.id) || notFound(ENTITY)));
  }});

  route('POST', BASE, async (req, p, q, ctx) => {{
    need(ctx, PERM.create);
    let d = rt.withDefaults(FIELDS, rt.pick(FIELDS, await readBody(req)));
    if (hooks.beforeSave) d = (await hooks.beforeSave(d, {{ isNew: true, existing: null, ctx, api }})) || d;
    check(d, ctx);
    rows();
    const now = new Date().toISOString();
    const rec = store.insert(COLLECTION, ENTITY, named(Object.assign(d, {{ createdBy: ctx.user, createdAt: now, updatedBy: ctx.user, updatedAt: now }})), ctx);
    if (!HAS_NAME) delete rec.name;
    if (hooks.afterSave) await hooks.afterSave(rec, {{ isNew: true, ctx, api }});
    return ok(view(rec));
  }});

  route('PUT', BASE + '/:id', async (req, p, q, ctx) => {{
    need(ctx, PERM.update);
    const existing = find(p.id) || notFound(ENTITY);
    let d = rt.pick(FIELDS, await readBody(req));
    if (hooks.beforeSave) d = (await hooks.beforeSave(d, {{ isNew: false, existing, ctx, api }})) || d;
    check(Object.assign({{}}, existing, d), ctx);
    const rec = store.update(COLLECTION, ENTITY, existing.id, Object.assign(d, {{ updatedBy: ctx.user, updatedAt: new Date().toISOString() }}), ctx);
    if (hooks.afterSave) await hooks.afterSave(rec, {{ isNew: false, ctx, api }});
    return ok(view(rec));
  }});

  route('DELETE', BASE + '/:id', (req, p, q, ctx) => {{
    need(ctx, PERM.delete);
    const existing = find(p.id) || notFound(ENTITY);
    for (const c of CHILDREN) {{
      const kids = (D()[c.collection] || []).filter(k => String(k[c.field]) === String(existing.id));
      if (kids.length && c.onDelete === 'restrict') throw new HttpError(409, `${{ENTITY}} has ${{kids.length}} ${{(kids.length === 1 ? c.label : c.plural).toLowerCase()}}; delete them first`);
    }}
    const reason = hooks.canDelete ? hooks.canDelete(existing, {{ ctx, api }}) : null;
    if (reason) throw new HttpError(409, reason);
    for (const c of CHILDREN.filter(x => x.onDelete === 'cascade')) {{
      (D()[c.collection] || []).filter(k => String(k[c.field]) === String(existing.id)).forEach(k => store.remove(c.collection, c.entityType, k.id, ctx));
    }}
    store.remove(COLLECTION, ENTITY, existing.id, ctx);
    return ok(null);
  }});

  for (const [action, perm] of Object.entries(ACTIONS)) {{
    route('POST', BASE + '/:id/' + action, async (req, p, q, ctx) => {{
      need(ctx, perm);
      const existing = find(p.id) || notFound(ENTITY);
      const fn = hooks.actions && hooks.actions[action];
      if (!fn) throw new HttpError(501, `Action '${{action}}' is not implemented yet: add actions.${{action}} to server/generated/{ef}.hooks.js`);
      const body = await readBody(req);
      const changes = await fn(existing, body, {{ ctx, api }});
      if (changes && Object.keys(changes).length) {{
        const d = rt.pick(FIELDS, changes, {{ includeReadOnly: true }});
        check(Object.assign({{}}, existing, d), ctx);
        store.update(COLLECTION, ENTITY, existing.id, Object.assign(d, {{ updatedBy: ctx.user, updatedAt: new Date().toISOString() }}), ctx);
      }}
      return ok(view(find(p.id)));
    }});
  }}
}};

module.exports.meta = {{ entity: ENTITY, collection: COLLECTION, base: BASE, permissions: PERM }};
"""


def _hooks(e: EntityDef) -> str:
    ef = entity_file(e.name)
    acts = "".join(
        f"    // POST /api{e.endpoint}/:id/{a}: return field changes to save (or nothing)\n"
        f"    // {a}: async (record, body, {{ ctx, api }}) => ({{}}),\n" for a in e.backend.customActions)
    return f"""'use strict';
/**
 * Business rules for {e.label} (routes in {ef}.routes.generated.js). UI Forge created this file once and
 * never changes it: it is yours. Every function is optional.
 *
 *   view(record)                   add computed values to what the API returns
 *   beforeSave(data, info)         adjust or refuse data before it is validated and saved (throw to refuse)
 *   validate(record, info)         extra rules: return {{ field: message }}
 *   afterSave(record, info)        follow-up work after a save
 *   canDelete(record, info)        return a reason to refuse a delete (409), or null
 *   actions.<name>(record, body)   custom actions (POST /api{e.endpoint}/:id/<name>); return field changes
 *
 * info = {{ isNew, existing, ctx (user, permissions), api (route helpers, store, D) }}
 */
module.exports = {{
  // view: (record) => record,
  // beforeSave: async (data, info) => data,
  // validate: (record, info) => ({{}}),
  // afterSave: async (record, info) => {{}},
  // canDelete: (record, info) => null,
  actions: {{
{acts}  }},
}};
"""


def _index(ws: Workspace, entities: list[EntityDef]) -> str:
    mods: dict[str, dict[str, Any]] = {}
    labels: dict[str, str] = {}
    for e in ws.entities.values():
        pm = e.permissionModule
        if pm is None:
            continue
        m = mods.setdefault(pm.module, {"module": pm.module, "label": pm.label, "actions": [], "grants": {}})
        for a in pm.actions:
            if a not in m["actions"]:
                m["actions"].append(a)
        for role, acts in pm.grants.items():
            g = m["grants"].setdefault(role, [])
            g += [a for a in acts if a not in g]
        labels.update(pm.actionLabels)
    entity_types = sorted({e.backend.auditEntityType or e.label for e in entities})
    # parents first, so a child's routes can rely on its parent's collection
    order = sorted(entities, key=lambda x: (1 if x.parent else 0, x.name))
    requires = "\n".join(f"    require('./{entity_file(e.name)}.routes.generated')(api);" for e in order)
    enum_lookups = {}
    for e in entities:
        for f in e.fields:
            if f.dataType == "enum" and f.options:
                enum_lookups[f"{e.name[0].lower() + e.name[1:]}{f.name[0].upper() + f.name[1:]}"] = f.options
    return js_banner("every src/modules/*/ui-forge/*.entity.json with a generated backend", "the *.hooks.js files") + f"""
/** Loaded by server/security.js (permissions) and server/server.js (routes). */
module.exports = {{
  permissionModules: {json.dumps(sorted(mods.values(), key=lambda m: m['module']), indent=2, ensure_ascii=False).replace(chr(10), chr(10) + '  ')},
  actionLabels: {_j(dict(sorted(labels.items())))},
  entityTypes: {_j(entity_types)},
  /** enum values, served as /api/lookups/<name> like the API's own lists */
  lookups: {json.dumps(enum_lookups, indent=2, ensure_ascii=False).replace(chr(10), chr(10) + '  ')},
  register(api) {{
    if (api.lookups) {{
      if (Array.isArray(api.lookups.entityTypes)) this.entityTypes.forEach(t => {{ if (!api.lookups.entityTypes.includes(t)) api.lookups.entityTypes.push(t); }});
      for (const [name, values] of Object.entries(this.lookups)) if (!api.lookups[name]) api.lookups[name] = values;
    }}
{requires}
  }},
}};
"""


def _sample(f: EntityField, i: int = 0) -> Any:
    if f.example is not None:
        return f.example
    t = f.dataType
    if t in ("string", "text"):
        base = f"T{i}{f.name}"[: f.maxLength or 40]
        if f.minLength and len(base) < f.minLength:
            base = base + "x" * (f.minLength - len(base))
        return base.upper() if f.upperCase else base
    if t == "integer":
        return int(max(f.min if f.min is not None else 1, min(1, f.max if f.max is not None else 1)))
    if t in ("decimal", "currency"):
        lo = f.min if f.min is not None else 1.5
        return lo if f.max is None or lo <= f.max else f.max
    if t == "boolean":
        return True
    if t == "date":
        return "2026-01-15"
    if t == "datetime":
        return "2026-01-15T10:30"
    if t == "time":
        return "10:30"
    if t == "enum":
        return [f.options[0]] if f.multiple else f.options[0]
    return None  # lookup: resolved at run time


def _selftest(ws: Workspace, entities: list[EntityDef]) -> str:
    order = sorted(entities, key=lambda x: (1 if x.parent else 0, x.name))
    specs = []
    for e in order:
        ep = "/api" + e.endpoint
        sample = {}
        lookup_refs = {}
        for f in e.fields:
            spec = _field_spec(ws, f)
            v = _sample(f)
            if f.dataType == "lookup" and f.example is None:
                if spec.get("refCollection"):
                    lookup_refs[f.name] = {"collection": spec["refCollection"], "multiple": f.multiple}
                elif spec.get("refLookup"):
                    lookup_refs[f.name] = {"lookup": spec["refLookup"], "multiple": f.multiple}
                continue
            if v is not None:
                sample[f.name] = v
        required = [f.name for f in e.fields if f.required and not f.readOnly and f.defaultValue is None and not (e.parent and e.parent.field == f.name)]
        unique = next((f.name for f in e.fields if f.unique and f.dataType in ("string", "text") and not f.readOnly), None)
        change = next((f.name for f in e.fields if f.dataType in ("string", "text") and not f.unique and not f.readOnly and not f.pattern and not f.options), None)
        parent = None
        if e.parent:
            pe = ws.entities.get(e.parent.entity)
            if pe is not None and pe.backend.generate:
                parent = {"field": e.parent.field, "endpoint": "/api" + pe.endpoint}
        specs.append({"hooks": f"./{entity_file(e.name)}.hooks", "label": e.label, "endpoint": ep, "entityType": e.backend.auditEntityType or e.label, "sample": sample,
                      "lookups": lookup_refs, "required": required[:1], "unique": unique, "change": change, "parent": parent,
                      "create": e.permissions.create, "view": e.permissions.view})
    return js_banner("the UI Forge entity schemas", "server/generated/*.hooks.js") + f"""
// API tests for every generated module: node server/generated/selftest.generated.js
// Starts the API on a free port with a throw-away database (your demo data is not touched).
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-forge-'));
process.env.GT_LATENCY = '0';
process.env.GT_AUTH = 'demo';
process.env.GT_DB_FILE = path.join(tmp, 'db.json');
const server = require('../server');
const store = require('../db');
store.reset();

const SPECS = {json.dumps(specs, indent=2, ensure_ascii=False)};

let passed = 0, failed = 0;
const check = (name, cond, extra) => {{ if (cond) {{ passed++; console.log('  ok   ' + name); }} else {{ failed++; console.log('  FAIL ' + name + (extra ? ' -> ' + JSON.stringify(extra).slice(0, 300) : '')); }} }};

server.listen(0, async () => {{
  const base = `http://127.0.0.1:${{server.address().port}}`;
  const call = async (method, p, body, user) => {{
    const r = await fetch(base + p, {{ method, headers: {{ 'Content-Type': 'application/json', 'X-GT-User': user || 'admin' }}, body: body ? JSON.stringify(body) : undefined }});
    let json = null; try {{ json = await r.json(); }} catch (e) {{ /* empty body */ }}
    return {{ status: r.status, body: json }};
  }};
  const created = {{}};
  let n = 0;
  try {{
    console.log('UI Forge generated modules: API self-test');
    for (const s of SPECS) {{
      const rec = Object.assign({{}}, s.sample);
      for (const [field, ref] of Object.entries(s.lookups)) {{
        let id = null;
        if (ref.collection) {{ const rows = store.data[ref.collection] || []; id = rows.length ? rows[0].id : null; }}
        if (ref.lookup) {{ const r = await call('GET', '/api/lookups/' + ref.lookup); id = r.body && r.body.data && r.body.data[0] ? r.body.data[0].id : null; }}
        if (id !== null) rec[field] = ref.multiple ? [id] : id;
      }}
      if (s.parent) rec[s.parent.field] = created[s.parent.endpoint];
      if (s.unique) rec[s.unique] = String(rec[s.unique]).slice(0, 3).replace(/[^A-Za-z0-9]/g, '') + (++n);

      let r = await call('GET', s.endpoint);
      check(`${{s.label}}: list`, r.status === 200 && Array.isArray(r.body.data), r.body);
      r = await call('GET', s.endpoint, null, 'auditor');
      check(`${{s.label}}: a read-only user gets 200 (granted ${{s.view}}) or 403, never a server error`, r.status === 403 || r.status === 200, r.status);
      r = await call('POST', s.endpoint, rec, 'auditor');
      check(`${{s.label}}: create needs ${{s.create}} (403)`, r.status === 403, r.body);
      if (s.required.length) {{
        const bad = Object.assign({{}}, rec); delete bad[s.required[0]];
        r = await call('POST', s.endpoint, bad);
        check(`${{s.label}}: ${{s.required[0]}} is required (400)`, r.status === 400 && r.body.errors && r.body.errors[s.required[0]], r.body);
      }}
      r = await call('POST', s.endpoint, rec);
      check(`${{s.label}}: create`, r.status === 200 && r.body.data && r.body.data.id > 0, r.body);
      if (r.status !== 200) continue;
      const id = r.body.data.id;
      created[s.endpoint] = id;
      r = await call('GET', `${{s.endpoint}}/${{id}}`);
      check(`${{s.label}}: get`, r.status === 200 && r.body.data.id === id, r.body);
      if (s.unique) {{
        r = await call('POST', s.endpoint, rec);
        check(`${{s.label}}: ${{s.unique}} is unique (400)`, r.status === 400 && r.body.errors && r.body.errors[s.unique], r.body);
      }}
      if (s.parent) {{
        const orphan = Object.assign({{}}, rec, {{ [s.parent.field]: 999999 }});
        if (s.unique) orphan[s.unique] = 'Z' + (++n);
        r = await call('POST', s.endpoint, orphan);
        check(`${{s.label}}: unknown parent rejected (400)`, r.status === 400 && r.body.errors && r.body.errors[s.parent.field], r.body);
        r = await call('GET', `${{s.endpoint}}?${{s.parent.field}}=${{rec[s.parent.field]}}`);
        check(`${{s.label}}: list filtered by parent`, r.status === 200 && r.body.data.some(x => x.id === id), r.body);
      }}
      if (s.change) {{
        r = await call('PUT', `${{s.endpoint}}/${{id}}`, {{ [s.change]: 'Changed by self-test' }});
        check(`${{s.label}}: update`, r.status === 200 && r.body.data[s.change] === 'Changed by self-test', r.body);
        r = await call('GET', `/api/audit?entityType=${{encodeURIComponent(s.entityType)}}&entityId=${{id}}`);
        check(`${{s.label}}: audit trail`, r.status === 200 && r.body.data.some(a => a.action === 'UPDATE'), r.body);
      }}
    }}
    for (const s of SPECS.slice().reverse()) {{
      const id = created[s.endpoint];
      if (!id) continue;
      const children = SPECS.filter(c => c.parent && c.parent.endpoint === s.endpoint && created[c.endpoint]);
      if (children.length) {{
        const r = await call('DELETE', `${{s.endpoint}}/${{id}}`);
        check(`${{s.label}}: delete refused while children exist (409)`, r.status === 409, r.body);
        continue;
      }}
      let r = await call('DELETE', `${{s.endpoint}}/${{id}}`);
      const rule = typeof require(s.hooks).canDelete === 'function';
      if (r.status === 409 && rule) {{
        check(`${{s.label}}: delete refused by your canDelete rule (${{r.body.message}})`, true);
        continue;
      }}
      check(`${{s.label}}: delete`, r.status === 200, r.body);
      r = await call('GET', `${{s.endpoint}}/${{id}}`);
      check(`${{s.label}}: gone (404)`, r.status === 404, r.body);
      delete created[s.endpoint];
    }}
  }} catch (e) {{
    failed++;
    console.log('  FAIL ' + (e.stack || e));
  }}
  console.log(`\\n${{passed}} passed, ${{failed}} failed`);
  server.close();
  fs.rmSync(tmp, {{ recursive: true, force: true }});
  process.exit(failed ? 1 : 0);
}});
"""


def backend_files(project: Project, ws: Workspace) -> list[GeneratedFile]:
    if project.backend_kind != "gridtrade-node":
        return []
    entities = [e for e in sorted(ws.entities.values(), key=lambda x: x.name) if e.backend.generate
                and any(e.name in d.entities() and d.generator.backend for d in ws.displays.values())]
    files = [GeneratedFile("api", "server/generated/forge-runtime.js", js_banner("UI Forge", "the *.hooks.js files") + RUNTIME.lstrip("\n"),
                           source="ui-forge")]
    for e in entities:
        ef = entity_file(e.name)
        files.append(GeneratedFile("api", f"server/generated/{ef}.routes.generated.js", _routes(ws, e), source=entity_path(e)))
        files.append(GeneratedFile("api", f"server/generated/{ef}.hooks.js", _hooks(e), owner="developer", source=entity_path(e)))
    files.append(GeneratedFile("api", "server/generated/index.js", _index(ws, entities), source="workspace"))
    if entities:
        files.append(GeneratedFile("api", "server/generated/selftest.generated.js", _selftest(ws, entities), source="workspace"))
    return files
