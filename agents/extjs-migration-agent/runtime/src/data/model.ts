/**
 * Ext.data.Model with typed fields (auto, string, int, number, boolean, date), convert / calculate / depends /
 * persist / allowNull / dateFormat / serialize, dirty tracking (modified, commit, reject), validators
 * (presence, length, format, email, range, inclusion, exclusion, functions), identifiers (negative,
 * sequential) and the CRUD life cycle through the class's proxy (save, erase, drop, Model.load).
 */
import { Ext } from '../core/ext';
import { define } from '../core/class';
import '../util/date';

Ext.data = Ext.data || {};

// ---------------------------------------------------------------- fields
const isEmptyVal = (v: any) => v === undefined || v === null || v === '';

const fieldTypes: Record<string, any> = {
  auto: { convert: (v: any) => (v === undefined ? null : v) },
  string: { convert: function (this: any, v: any) { return v === undefined || v === null ? (this.allowNull ? null : '') : String(v); } },
  int: {
    convert: function (this: any, v: any) {
      if (typeof v === 'number') { return Math.trunc(v); }
      if (isEmptyVal(v)) { return this.allowNull ? null : 0; }
      const n = parseInt(String(v).replace(/[$,%]/g, ''), 10);
      return isNaN(n) ? (this.allowNull ? null : 0) : n;
    }
  },
  number: {
    convert: function (this: any, v: any) {
      if (typeof v === 'number') { return v; }
      if (isEmptyVal(v)) { return this.allowNull ? null : 0; }
      const n = parseFloat(String(v).replace(/[$,%]/g, ''));
      return isNaN(n) ? (this.allowNull ? null : 0) : n;
    }
  },
  boolean: {
    convert: function (this: any, v: any) {
      if (typeof v === 'boolean') { return v; }
      if (this.allowNull && (v === undefined || v === null || v === '')) { return null; }
      return v === 'true' || v === 1 || v === '1' || v === 'on' || v === 'yes' || v === true;
    }
  },
  date: {
    convert: function (this: any, v: any) {
      if (v === undefined || v === null || v === '') { return null; }
      if (Ext.isDate(v)) { return v; }
      const fmt = this.dateReadFormat || this.dateFormat;
      let d = null;
      if (fmt) { d = Ext.Date.parse(v, fmt); }
      if (!d && typeof v === 'number') { d = new Date(v); }
      if (!d) { const t = Date.parse(v); d = isNaN(t) ? null : new Date(t); }
      return d;
    }
  }
};
fieldTypes.integer = fieldTypes.int;
fieldTypes.float = fieldTypes.number;
fieldTypes.bool = fieldTypes.boolean;

export class Field {
  [k: string]: any;
  isField = true;
  constructor(cfg: any) {
    if (typeof cfg === 'string') { cfg = { name: cfg }; }
    Object.assign(this, cfg);
    this.type = (this.type || 'auto').toLowerCase();
    const t = fieldTypes[this.type] || fieldTypes.auto;
    this.typeConvert = t.convert;
    this.isCalculated = typeof this.calculate === 'function';
    if (this.isCalculated && this.persist === undefined) { this.persist = false; }
    if (this.persist === undefined) { this.persist = true; }
    if (typeof this.convert === 'function') { this.customConvert = this.convert; }
    if (this.depends) { this.depends = Ext.Array.from(this.depends); }
  }
  getName() { return this.name; }
  getType() { return this.type; }
  getPersist() { return this.persist; }
  getAllowNull() { return !!this.allowNull; }
  getDefaultValue() { return this.defaultValue; }
  getDateFormat() { return this.dateFormat; }
  convertValue(v: any, rec: any) {
    if (this.customConvert) { return this.customConvert.call(this, v, rec); }
    return this.typeConvert.call(this, v, rec);
  }
  serializeValue(v: any, rec: any) {
    if (this.serialize) { return this.serialize.call(this, v, rec); }
    if (this.type === 'date' && Ext.isDate(v)) {
      const fmt = this.dateWriteFormat || this.dateFormat;
      if (!fmt) { return v; }
      if (fmt === 'timestamp') { return Math.floor(v.getTime() / 1000); }
      if (fmt === 'time') { return v.getTime(); }
      return Ext.Date.format(v, fmt);
    }
    return v;
  }
  isEqual(a: any, b: any) {
    if (a === b) { return true; }
    if (Ext.isDate(a) && Ext.isDate(b)) { return a.getTime() === b.getTime(); }
    if ((a === null || a === undefined) && (b === null || b === undefined)) { return true; }
    if (Ext.isArray(a) && Ext.isArray(b)) { return a.length === b.length && a.every((x, i) => x === b[i] || JSON.stringify(x) === JSON.stringify(b[i])); }
    if (a && b && typeof a === 'object' && typeof b === 'object' && a.constructor === Object && b.constructor === Object) { return JSON.stringify(a) === JSON.stringify(b); }
    return false;
  }
  compare(a: any, b: any) { if (Ext.isDate(a)) { a = a.getTime(); } if (Ext.isDate(b)) { b = b.getTime(); } return a === b ? 0 : a < b ? -1 : 1; }
}
Ext.data.field = Ext.data.field || {};
Ext.data.field.Field = Field;
Ext.ClassManager.classes['Ext.data.field.Field'] = Field;

// ---------------------------------------------------------------- validators
const validatorDefs: Record<string, (cfg: any) => (v: any, rec: any) => any> = {
  presence: (cfg) => (v) => {
    const ok = v !== undefined && v !== null && (cfg.allowEmpty || v !== '') && !(Ext.isArray(v) && !v.length && !cfg.allowEmpty);
    return ok ? true : (cfg.message || 'Must be present');
  },
  length: (cfg) => (v) => {
    if (v === undefined || v === null) { return cfg.emptyMessage || 'Must be present'; }
    const len = Ext.isArray(v) ? v.length : String(v).length;
    const min = cfg.min, max = cfg.max;
    if (min !== undefined && max !== undefined && (len < min || len > max)) { return Ext.String.format(cfg.bothMessage || 'Length must be between {0} and {1}', min, max); }
    if (min !== undefined && len < min) { return Ext.String.format(cfg.minOnlyMessage || 'Length must be at least {0}', min); }
    if (max !== undefined && len > max) { return Ext.String.format(cfg.maxOnlyMessage || 'Length must be no more than {0}', max); }
    return true;
  },
  range: (cfg) => (v) => {
    if (v === undefined || v === null) { return cfg.emptyMessage || 'Must be present'; }
    if (isNaN(v)) { return cfg.nanMessage || 'Must be numeric'; }
    const min = cfg.min, max = cfg.max;
    if (min !== undefined && max !== undefined && (v < min || v > max)) { return Ext.String.format(cfg.bothMessage || 'Must be between {0} and {1}', min, max); }
    if (min !== undefined && v < min) { return Ext.String.format(cfg.minOnlyMessage || 'Must be must be at least {0}', min); }
    if (max !== undefined && v > max) { return Ext.String.format(cfg.maxOnlyMessage || 'Must be no more than than {0}', max); }
    return true;
  },
  format: (cfg) => (v) => (cfg.matcher && cfg.matcher.test(v === undefined || v === null ? '' : String(v)) ? true : (cfg.message || 'Is in the wrong format')),
  email: (cfg) => (v) => (/^(")?(?:[^."])(?:(?:[.])?(?:[\w\-!#$%&'*+/=?^_`{|}~]))*\1@(\w[-\w]*\.){1,5}([A-Za-z]){2,63}$/.test(v === undefined || v === null ? '' : String(v)) ? true : (cfg.message || 'Is not a valid email address')),
  url: (cfg) => (v) => (/^(https?|ftp):\/\/\S+$/i.test(String(v || '')) ? true : (cfg.message || 'Is not a valid URL')),
  inclusion: (cfg) => (v) => (Ext.Array.contains(cfg.list || [], v) ? true : (cfg.message || 'Is not in the list of acceptable values')),
  exclusion: (cfg) => (v) => (!Ext.Array.contains(cfg.list || [], v) ? true : (cfg.message || 'Is a value that has been excluded')),
  number: (cfg) => (v) => (v === undefined || v === null || v === '' || !isNaN(Number(v)) ? true : (cfg.message || 'Is not a valid number')),
  date: (cfg) => (v) => (v === undefined || v === null || v === '' || Ext.isDate(v) || !!Ext.Date.parse(v, cfg.format || 'c') ? true : (cfg.message || 'Is not a valid date')),
  notnull: (cfg) => (v) => (v !== null && v !== undefined ? true : (cfg.message || 'Must not be null'))
};
export function makeValidator(spec: any) {
  if (typeof spec === 'function') { return spec; }
  if (typeof spec === 'string') { spec = { type: spec }; }
  if (spec && spec.isValidator) { return (v: any, r: any) => spec.validate(v, r); }
  if (spec && typeof spec.fn === 'function') { return spec.fn; }
  const def = validatorDefs[String(spec.type || '').toLowerCase()];
  if (!def) {
    const cls = Ext.ClassManager.getByAlias('data.validator.' + spec.type);
    if (cls) { const inst = new cls(spec); return (v: any, r: any) => inst.validate(v, r); }
    return () => true;
  }
  return def(spec);
}
Ext.data.validator = Ext.data.validator || {};
define('Ext.data.validator.Validator', {
  isValidator: true,
  alias: 'data.validator.base',
  constructor: function (cfg?: any) { if (typeof cfg === 'function') { this.validate = cfg; } else { Ext.apply(this, cfg); } return this; },
  validate: function () { return true; }
});
for (const name of Object.keys(validatorDefs)) {
  define('Ext.data.validator.' + Ext.String.capitalize(name), {
    extend: 'Ext.data.validator.Validator',
    alias: 'data.validator.' + name,
    validate: function (v: any, r: any) { return validatorDefs[name](this)(v, r); }
  });
}

// ---------------------------------------------------------------- identifiers
const identifierCounters: Record<string, number> = {};
function makeIdentifier(spec: any, entityName: string) {
  if (!spec) { spec = { type: 'sequential', prefix: entityName + '-' }; }
  if (typeof spec === 'string') { spec = { type: spec }; }
  if (spec.isIdentifier) { return spec; }
  const type = spec.type || 'sequential';
  const key = spec.id || (type + ':' + entityName);
  if (type === 'negative') {
    return { isIdentifier: true, generate: () => { identifierCounters[key] = (identifierCounters[key] || 0) - 1; return identifierCounters[key]; } };
  }
  if (type === 'uuid') {
    return { isIdentifier: true, generate: () => (crypto && (crypto as any).randomUUID ? (crypto as any).randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); })) };
  }
  const prefix = spec.prefix === undefined ? '' : spec.prefix;
  const increment = spec.increment || 1;
  const seed = spec.seed === undefined ? 1 : spec.seed;
  return {
    isIdentifier: true,
    generate: () => {
      if (identifierCounters[key] === undefined) { identifierCounters[key] = seed - increment; }
      identifierCounters[key] += increment;
      return prefix ? prefix + identifierCounters[key] : identifierCounters[key];
    }
  };
}
Ext.data.identifier = Ext.data.identifier || {};
define('Ext.data.identifier.Generator', { isIdentifier: true, constructor: function (c?: any) { Ext.apply(this, c); return this; }, generate: function () { return Ext.id(); } });
define('Ext.data.identifier.Negative', { extend: 'Ext.data.identifier.Generator', alias: 'data.identifier.negative' });
define('Ext.data.identifier.Sequential', { extend: 'Ext.data.identifier.Generator', alias: 'data.identifier.sequential' });
define('Ext.data.identifier.Uuid', { extend: 'Ext.data.identifier.Generator', alias: 'data.identifier.uuid' });

// ---------------------------------------------------------------- Model
let internalSeed = 0;
let anonymousSeed = 0;

function processFields(cls: any, body: any) {
  const parentProto = cls.superclass;
  const parentFields: Field[] = (parentProto && parentProto.fields) || [];
  const fields: Field[] = parentFields.slice();
  const add = (cfg: any) => {
    const f = cfg instanceof Field ? cfg : new Field(cfg);
    const i = fields.findIndex((x) => x.name === f.name);
    if (i >= 0) { fields[i] = f; } else { fields.push(f); }
  };
  for (const cfg of Ext.Array.from(body.fields)) { add(cfg); }
  const proto = cls.prototype;
  const idProperty = body.idProperty || (parentProto && parentProto.idProperty) || 'id';
  if (!fields.some((f) => f.name === idProperty)) { add({ name: idProperty, type: 'auto', $auto: true }); }
  proto.fields = fields;
  proto.fieldsMap = {};
  for (const f of fields) { proto.fieldsMap[f.name] = f; }
  proto.idProperty = idProperty;
  proto.idField = proto.fieldsMap[idProperty];
  proto.$calculated = fields.filter((f) => f.isCalculated);
  // entity name: GT.model.Contract with schema namespace GT.model -> Contract
  const ns = (body.schema && body.schema.namespace) || (parentProto && parentProto.$schemaNamespace);
  if (body.schema && body.schema.namespace) { proto.$schemaNamespace = body.schema.namespace; }
  const name = cls.$className || ('extModel' + (++anonymousSeed));
  proto.entityName = ns && name.indexOf(ns + '.') === 0 ? name.substr(ns.length + 1) : name;
  cls.entityName = proto.entityName;
  // validators: object map or Ext 4 style array
  const validators: Record<string, any[]> = {};
  const inherit = (parentProto && parentProto.$validators) || {};
  for (const k in inherit) { validators[k] = inherit[k].slice(); }
  const vs = body.validators;
  if (Ext.isArray(vs)) {
    for (const v of vs) { (validators[v.field] = validators[v.field] || []).push(makeValidator(v)); }
  } else if (vs) {
    for (const k in vs) { validators[k] = Ext.Array.from(vs[k]).map(makeValidator); }
  }
  for (const f of fields) { if (f.validators) { validators[f.name] = (validators[f.name] || []).concat(Ext.Array.from(f.validators).map(makeValidator)); } }
  proto.$validators = validators;
  proto.$identifier = makeIdentifier(body.identifier !== undefined ? body.identifier : (parentProto && parentProto.$identifierSpec), proto.entityName);
  proto.$identifierSpec = body.identifier !== undefined ? body.identifier : (parentProto && parentProto.$identifierSpec);
  if (body.proxy !== undefined) { proto.$proxyConfig = body.proxy; cls.$proxy = null; }
}

export const Model: any = define('Ext.data.Model', {
  isModel: true,
  isEntity: true,
  idProperty: 'id',
  fields: [],
  fieldsMap: {},
  phantom: false,
  dirty: false,
  dropped: false,
  erased: false,
  editing: false,
  modified: null,
  $version: 0,

  onClassExtended: function (cls: any, body: any) {
    processFields(cls, body);
    // consumed here: keep them off the prototype (fields there are the processed Field objects)
    for (const k of ['fields', 'validators', 'identifier', 'proxy', 'schema', 'idProperty']) { delete body[k]; }
    cls.load = Model.load;
    cls.getProxy = Model.getProxy;
    cls.setProxy = Model.setProxy;
    cls.getFields = Model.getFields;
    cls.getFieldsMap = Model.getFieldsMap;
    cls.getField = Model.getField;
    cls.getIdProperty = Model.getIdProperty;
    cls.addFields = Model.addFields;
    cls.replaceFields = Model.replaceFields;
    cls.create = Model.create;
    cls.createWithId = Model.createWithId;
  },

  constructor: function (data?: any, session?: any, skipStore?: any) {
    const me = this;
    void session; void skipStore;
    me.internalId = ++internalSeed;
    me.stores = [];
    const raw = data && data.isModel ? data.getData() : Ext.apply({}, data);
    me.data = {};
    const fields: Field[] = me.fields;
    const idp = me.idProperty;
    for (const f of fields) {
      if (f.isCalculated) { continue; }
      let v = raw[f.name];
      if (v === undefined && f.mapping && typeof f.mapping === 'string') {
        v = f.mapping.split('.').reduce((o: any, k: string) => (o === null || o === undefined ? undefined : o[k]), raw);
      }
      if (v === undefined && f.defaultValue !== undefined) { v = Ext.clone(f.defaultValue); }
      if (f.name === idp && (v === undefined || v === null || v === '')) { continue; }
      me.data[f.name] = f.convertValue(v, me);
    }
    // keep unknown keys too (Ext keeps raw data members on the record)
    for (const k in raw) { if (!(k in me.fieldsMap)) { me.data[k] = raw[k]; } }
    let id = raw[idp];
    if (id === undefined || id === null || id === '') {
      id = me.$identifier.generate();
      me.data[idp] = id;
      me.phantom = true;
    } else {
      me.data[idp] = me.idField ? me.idField.convertValue(id, me) : id;
    }
    me.id = me.data[idp];
    me.$recalc(null);
    return me;
  },

  $recalc: function (changed: string[] | null) {
    const me = this;
    const out = [];
    for (const f of me.$calculated) {
      if (changed && f.depends && !f.depends.some((d: string) => changed.indexOf(d) >= 0)) { continue; }
      const v = f.calculate.call(f, me.data, me);
      if (!f.isEqual(me.data[f.name], v)) { me.data[f.name] = v; out.push(f.name); }
    }
    return out;
  },

  get: function (name: string) {
    const f = this.fieldsMap[name];
    if (f && f.isCalculated && !(name in this.data)) { return f.calculate.call(f, this.data, this); }
    return this.data[name];
  },
  getId: function () { return this.id; },
  setId: function (id: any, options?: any) { this.set(this.idProperty, id, options); },
  getField: function (name: string) { return this.fieldsMap[name]; },
  getFields: function () { return this.fields; },
  getProxy: function () { return this.self.getProxy(); },
  getIdProperty: function () { return this.idProperty; },

  set: function (fieldName: any, newValue?: any, options?: any) {
    const me = this;
    let values: any;
    if (fieldName && typeof fieldName === 'object') { values = fieldName; options = newValue; } else { values = { [fieldName]: newValue }; }
    options = options || {};
    const convert = options.convert !== false;
    const markDirty = options.dirty !== false;
    const changed: string[] = [];
    let idChanged = false, oldId;
    for (const name in values) {
      const f = me.fieldsMap[name];
      if (f && f.isCalculated) { continue; }
      let v = values[name];
      if (f && convert) { v = f.convertValue(v, me); }
      const cur = me.data[name];
      const eq = f ? f.isEqual(cur, v) : cur === v;
      if (eq) { continue; }
      me.data[name] = v;
      changed.push(name);
      if (name === me.idProperty) { idChanged = true; oldId = me.id; me.id = v; }
      if (markDirty) {
        const mod = me.modified || (me.modified = {});
        if (Object.prototype.hasOwnProperty.call(mod, name)) {
          const orig = mod[name];
          if (f ? f.isEqual(orig, v) : orig === v) { delete mod[name]; }
        } else {
          mod[name] = cur;
        }
      } else if (me.modified && Object.prototype.hasOwnProperty.call(me.modified, name)) {
        delete me.modified[name];
      }
    }
    if (!changed.length) { return null; }
    const calc = me.$recalc(changed);
    const all = changed.concat(calc);
    me.dirty = !!(me.modified && Object.keys(me.modified).length);
    me.$version++;
    if (Ext.app && Ext.app.$recordChanged) { Ext.app.$recordChanged(me); }
    if (idChanged) { me.$callJoined('onIdChanged', [oldId, me.id]); }
    if (options.commit) {
      me.commit(options.silent, all);
    } else if (!options.silent && !me.editing) {
      me.$callJoined('afterEdit', [all]);
    } else if (me.editing) {
      me.$pendingEdits = (me.$pendingEdits || []).concat(all);
    }
    return all;
  },

  beginEdit: function () { this.editing = true; this.$pendingEdits = []; },
  endEdit: function (silent?: boolean, modifiedFieldNames?: string[]) {
    this.editing = false;
    const names = modifiedFieldNames || Ext.Array.unique(this.$pendingEdits || []);
    this.$pendingEdits = null;
    if (!silent && names.length) { this.$callJoined('afterEdit', [names]); }
  },
  cancelEdit: function () { this.editing = false; this.$pendingEdits = null; this.reject(true); },

  isModified: function (name: string) { return !!(this.modified && Object.prototype.hasOwnProperty.call(this.modified, name)); },
  getModified: function (name: string) { return this.modified ? this.modified[name] : undefined; },
  getPrevious: function (name: string) { return this.getModified(name); },
  getChanges: function () {
    const out = {};
    if (this.modified) { for (const k in this.modified) { out[k] = this.data[k]; } }
    return out;
  },

  commit: function (silent?: boolean, modifiedFieldNames?: string[]) {
    const me = this;
    const names = modifiedFieldNames || (me.modified ? Object.keys(me.modified) : []);
    me.phantom = me.dirty = me.editing = false;
    me.modified = null;
    me.$version++;
    if (Ext.app && Ext.app.$recordChanged) { Ext.app.$recordChanged(me); }
    if (!silent) { me.$callJoined('afterCommit', [names]); }
  },
  reject: function (silent?: boolean) {
    const me = this;
    const mod = me.modified;
    const names = mod ? Object.keys(mod) : [];
    if (mod) {
      for (const k in mod) { me.data[k] = mod[k]; if (k === me.idProperty) { me.id = mod[k]; } }
      me.$recalc(names);
    }
    me.dirty = me.editing = false;
    me.modified = null;
    me.$version++;
    if (Ext.app && Ext.app.$recordChanged) { Ext.app.$recordChanged(me); }
    if (!silent) { me.$callJoined('afterReject', [names]); }
  },

  getData: function (options?: any) {
    const me = this;
    let persistOnly = false, serialize = false, changesOnly = false, critical = false;
    if (options === true) { options = { associated: true }; }
    if (options) { persistOnly = !!options.persist; serialize = !!options.serialize; changesOnly = !!options.changes; critical = !!options.critical; }
    const out: any = {};
    for (const f of me.fields) {
      if (persistOnly && !f.persist) { continue; }
      if (changesOnly && !me.isModified(f.name) && !(critical && f.critical) && f.name !== me.idProperty) { continue; }
      const v = me.get(f.name);
      out[f.name] = serialize ? f.serializeValue(v, me) : v;
    }
    if (!persistOnly && !changesOnly) { for (const k in me.data) { if (!(k in out)) { out[k] = me.data[k]; } } }
    return out;
  },
  getAssociatedData: function () { return {}; },
  copy: function (newId?: any) {
    const data = Ext.apply({}, this.data);
    if (newId === undefined || newId === null) { delete data[this.idProperty]; } else { data[this.idProperty] = newId; }
    return new this.self(data);
  },
  clone: function () { const c = new this.self(Ext.apply({}, this.data)); c.phantom = this.phantom; return c; },

  // ---- validation
  validate: function () {
    const errors = new ErrorCollection();
    for (const name in this.$validators) {
      for (const fn of this.$validators[name]) {
        const r = fn(this.get(name), this);
        if (r !== true && r !== undefined && r !== null) { errors.add({ field: name, message: r === false ? 'Is invalid' : r }); }
      }
    }
    return errors;
  },
  isValid: function () { return this.validate().isValid(); },
  getValidation: function (refresh?: boolean) {
    const me = this;
    if (!me.$validation || refresh) {
      const errors = me.validate();
      const data = {};
      for (const f of me.fields) { const e = errors.getByField(f.name); data[f.name] = e.length ? e[0].message : true; }
      me.$validation = {
        isValidation: true,
        data,
        get: (n: string) => (n in data ? data[n] : true),
        isValid: () => errors.isValid(),
        getErrors: () => errors.items.slice(),
        dirty: false
      };
    }
    return me.$validation;
  },

  // ---- stores
  join: function (store: any) { if (this.stores.indexOf(store) < 0) { this.stores.push(store); } this.store = this.stores[0]; },
  unjoin: function (store: any) { Ext.Array.remove(this.stores, store); this.store = this.stores[0] || null; },
  $callJoined: function (method: string, args: any[]) {
    for (const s of this.stores.slice()) { if (s[method]) { s[method].apply(s, [this].concat(args)); } }
  },
  callJoined: function (method: string, args: any[]) { this.$callJoined(method, args || []); },

  // ---- CRUD
  drop: function () {
    const me = this;
    if (me.dropped || me.erased) { return; }
    me.dropped = true;
    me.$callJoined('afterDrop', []);
    if (me.phantom) { me.setErased(); }
  },
  setErased: function () { this.erased = true; this.$callJoined('afterErase', []); },
  erase: function (options?: any) {
    const me = this;
    options = Ext.apply({}, options);
    if (me.phantom) {
      me.drop();
      const op = me.getProxy() ? me.getProxy().createOperation('destroy', { records: [me] }) : { wasSuccessful: () => true, getRecords: () => [me] };
      Ext.callback(options.success, options.scope, [me, op]);
      Ext.callback(options.callback, options.scope, [me, op, true]);
      return op;
    }
    me.dropped = true;
    return me.save(options, 'destroy');
  },
  save: function (options?: any, forcedAction?: string) {
    const me = this;
    options = Ext.apply({}, options);
    const action = forcedAction || (me.dropped ? 'destroy' : (me.phantom ? 'create' : 'update'));
    const proxy = me.getProxy();
    if (!proxy) { throw new Error(me.$className + ' has no proxy configured'); }
    const scope = options.scope || me;
    const operation = proxy.createOperation(action, Ext.apply({}, options.operation, {
      records: [me],
      params: options.params,
      internalCallback: function (op: any) {
        const success = op.wasSuccessful();
        if (success && action === 'destroy') {
          me.erased = true;
          me.$callJoined('afterErase', []);
        } else if (!success && action === 'destroy') {
          me.dropped = false;
        }
        const args = [me, op];
        if (success) { Ext.callback(options.success, scope, args); } else { Ext.callback(options.failure, scope, args); }
        Ext.callback(options.callback, scope, [me, op, success]);
      }
    }));
    operation.execute();
    return operation;
  },
  load: function (options?: any) {
    const me = this;
    options = Ext.apply({}, options);
    const scope = options.scope || me;
    const proxy = me.getProxy();
    const operation = proxy.createOperation('read', {
      id: me.getId(),
      params: options.params,
      recordCreator: (data: any) => { me.set(data, { convert: true, dirty: false }); me.commit(true); me.phantom = false; return me; },
      internalCallback: function (op: any) {
        const success = op.wasSuccessful() && op.getRecords().length > 0;
        if (op.wasSuccessful() && !op.getRecords().length) { op.success = false; }
        if (success) { Ext.callback(options.success, scope, [me, op]); } else { Ext.callback(options.failure, scope, [me, op]); }
        Ext.callback(options.callback, scope, [me, op, success]);
      }
    });
    operation.execute();
    return operation;
  },
  toUrl: function () { return this.entityName.toLowerCase() + '/' + this.getId(); },

  statics: {
    EDIT: 'edit',
    REJECT: 'reject',
    COMMIT: 'commit',
    load: function (this: any, id: any, options?: any) {
      const rec = new this({ [this.prototype.idProperty]: id });
      rec.phantom = false;
      rec.load(options);
      return rec;
    },
    getProxy: function (this: any) {
      const cls = this;
      if (!Object.prototype.hasOwnProperty.call(cls, '$proxy') || !cls.$proxy) {
        let cfg = cls.prototype.$proxyConfig;
        if (!cfg) {
          // inherit the parent's proxy config (Ext shares the proxy type down the hierarchy)
          let p = cls.superclass;
          while (p && !p.$proxyConfig) { p = p.self && p.self.superclass; }
          cfg = p && p.$proxyConfig;
        }
        if (!cfg) { return null; }
        const proxy = cfg.isProxy ? cfg : Ext.Factory.proxy(Ext.clone(cfg), 'ajax');
        proxy.setModel(cls);
        cls.$proxy = proxy;
      }
      return cls.$proxy;
    },
    setProxy: function (this: any, cfg: any) {
      const proxy = cfg && cfg.isProxy ? cfg : Ext.Factory.proxy(cfg, 'ajax');
      proxy.setModel(this);
      this.$proxy = proxy;
      return proxy;
    },
    getFields: function (this: any) { return this.prototype.fields; },
    getFieldsMap: function (this: any) { return this.prototype.fieldsMap; },
    getField: function (this: any, name: string) { return this.prototype.fieldsMap[name]; },
    getIdProperty: function (this: any) { return this.prototype.idProperty; },
    addFields: function (this: any, fields: any[]) { processFields(this, { fields: this.prototype.fields.concat(Ext.Array.from(fields)), idProperty: this.prototype.idProperty }); },
    replaceFields: function (this: any, fields: any[]) { processFields(this, { fields: Ext.Array.from(fields), idProperty: this.prototype.idProperty }); },
    create: function (this: any, data?: any) { return new this(data); },
    createWithId: function (this: any, id: any, data?: any) { return new this(Ext.apply({}, data, { [this.prototype.idProperty]: id })); },
    isEqual: (a: any, b: any) => Field.prototype.isEqual(a, b)
  }
});
// the base model itself gets its field structures
processFields(Model, { fields: [] });

class ErrorCollection {
  items: any[] = [];
  isErrorCollection = true;
  add(e: any) { this.items.push(e); }
  getByField(name: string) { return this.items.filter((e) => e.field === name); }
  isValid() { return this.items.length === 0; }
  getCount() { return this.items.length; }
  each(fn: any, scope?: any) { this.items.forEach(fn, scope); }
}
Ext.data.ErrorCollection = ErrorCollection;

/** Creates (or reuses) a model class for stores configured with inline `fields`. */
export function implicitModel(fields: any[], idProperty?: string) {
  return define(null, { extend: 'Ext.data.Model', fields, idProperty });
}

export default Model;
