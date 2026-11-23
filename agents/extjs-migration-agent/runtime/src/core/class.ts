/**
 * Ext JS class system: Ext.define (extend, mixins, config, statics, inheritableStatics, privates, singleton,
 * alias / xtype, alternateClassName, override), Ext.create / Ext.widget / Ext.Factory and callParent / callSuper.
 *
 * callParent: ES modules are strict, so Ext's `arguments.callee.caller` trick is unavailable. Every method
 * whose source calls callParent/callSuper is wrapped so the running method is known (a call stack); callParent
 * then resolves the overridden (or inherited) implementation exactly like Ext does.
 */
import { Ext } from './ext';

const CALL_STACK: any[] = [];
const PARENT_RE = /\bcall(Parent|Super)\b/;

function makeCtor(): any {
  // Same shape as Ext's class constructors: the class delegates to the "constructor" method.
  return function ExtClass(this: any, ...args) { return this.constructor.apply(this, args) || null; };
}

function wrap(fn: any, owner: any, name: string, isStatic = false, previous?: any) {
  if (typeof fn !== 'function' || fn.$isClass) { return fn; }
  const orig = fn.$orig || fn;
  if (!PARENT_RE.test(Function.prototype.toString.call(orig))) {
    // Plain methods need no bookkeeping (and may be shared values such as Ext.emptyFn).
    return orig;
  }
  const out: any = function (this: any, ...args) {
    CALL_STACK.push(out);
    try { return orig.apply(this, args); } finally { CALL_STACK.pop(); }
  };
  out.$orig = orig;
  out.$owner = owner;
  out.$name = name;
  if (isStatic) { out.$static = true; }
  if (previous) { out.$previous = previous; }
  return out;
}

function currentMethod(name: string) {
  const m = CALL_STACK[CALL_STACK.length - 1];
  if (!m) { throw new Error('this.' + name + '() was called outside of a class method'); }
  return m;
}

function resolveParent(method: any) {
  if (method.$previous) { return method.$previous; }
  const name = method.$name, owner = method.$owner;
  if (method.$static) {
    const sup = owner.superclass && owner.superclass.self;
    return sup ? sup[name] : undefined;
  }
  const sup = owner.superclass;
  return sup ? sup[name] : undefined;
}

// ---------------------------------------------------------------- ClassManager
const classes: Record<string, any> = {};
const aliasToName: Record<string, string> = {};
const nameToAliases: Record<string, string[]> = {};
const pendingOverrides: Record<string, any[]> = {};

function setNamespace(name: string, value: any) {
  const parts = name.split('.');
  let root = Ext.global;
  for (let i = 0; i < parts.length - 1; i++) {
    root = root[parts[i]] = root[parts[i]] || {};
  }
  const last = parts[parts.length - 1];
  const existing = root[last];
  if (existing && typeof existing === 'object' && !existing.isInstance && value) {
    // a namespace object already holds child classes: keep them on the new class
    for (const k in existing) { if (!(k in value)) { try { value[k] = existing[k]; } catch (e) { /* ignore */ } } }
  }
  root[last] = value;
}

export const ClassManager: any = {
  classes,
  get(name: string) { return classes[name] || (aliasToName[name] ? classes[aliasToName[name]] : undefined) || lookupPath(name); },
  getByAlias(alias: string) { const n = aliasToName[alias]; return n ? classes[n] : undefined; },
  getNameByAlias(alias: string) { return aliasToName[alias] || ''; },
  getAliasesByName(name: string) { return nameToAliases[name] || []; },
  getName(obj: any) { return obj && (obj.$className || (obj.prototype && obj.prototype.$className)) || ''; },
  getClass(obj: any) { return obj && obj.self; },
  isCreated(name: string) { return !!classes[name]; },
  setAlias(cls: any, alias: string) {
    const name = typeof cls === 'string' ? cls : cls.$className;
    aliasToName[alias] = name;
    (nameToAliases[name] = nameToAliases[name] || []).push(alias);
  },
  instantiate(name: string, ...args) {
    const cls = ClassManager.get(name);
    if (!cls) { throw new Error('Ext.create: unknown class "' + name + '"'); }
    return new cls(...args);
  },
  instantiateByAlias(alias: string, ...args) {
    const cls = ClassManager.getByAlias(alias);
    if (!cls) { throw new Error('Ext.create: unknown alias "' + alias + '"'); }
    return new cls(...args);
  },
  getAll() { return classes; },
  getAliasMap() { return Object.assign({}, aliasToName); }
};
function lookupPath(name: string) {
  if (!name || typeof name !== 'string' || name.indexOf('.') < 0) { return undefined; }
  let root = Ext.global;
  for (const p of name.split('.')) { root = root && root[p]; if (!root) { return undefined; } }
  return typeof root === 'function' ? root : undefined;
}
Ext.ClassManager = ClassManager;

// ---------------------------------------------------------------- Ext.Base
export const Base: any = makeCtor();
Base.$isClass = true;
Base.$className = 'Ext.Base';
Base.prototype.$className = 'Ext.Base';
Base.prototype.self = Base;
Base.prototype.isInstance = true;
Base.prototype.$configs = {};
Base.prototype.xtypes = [];
Base.prototype.mixins = {};
Base.$configs = {};
Base.prototype.constructor = function (config?) { this.initConfig(config); return this; };
Base.prototype.initConfig = function (config?) {
  const me = this;
  if (me.$configInitialized) {
    if (config) { me.setConfig(config); }
    return me;
  }
  me.$configInitialized = true;
  const configs = me.self.$configs || {};
  const values: any = {};
  for (const k in configs) { values[k] = configs[k]; }
  if (config) {
    for (const k in config) {
      if (k in configs) { values[k] = config[k]; } else { me[k] = config[k]; }
    }
  }
  me.initialConfig = me.initialConfig || config || {};
  for (const k in values) {
    const setter = me['set' + Ext.String.capitalize(k)];
    if (setter && !setter.$autoGenerated) {
      setter.call(me, Ext.clone(values[k]));
    } else {
      applyConfigValue(me, k, Ext.clone(values[k]));
    }
  }
  return me;
};
function applyConfigValue(me: any, name: string, value: any) {
  const cap = Ext.String.capitalize(name);
  const old = me[name];
  const apply = me['apply' + cap];
  if (apply) { value = apply.call(me, value, old); }
  if (value !== undefined && (value !== old || !(name in me) || me['$cfgInit_' + name] !== true)) {
    me[name] = value;
    me['$cfgInit_' + name] = true;
    const update = me['update' + cap];
    if (update) { update.call(me, value, old); }
  }
}
Base.prototype.setConfig = function (name: any, value?: any) {
  if (name && typeof name === 'object') { for (const k in name) { this.setConfig(k, name[k]); } return this; }
  const setter = this['set' + Ext.String.capitalize(name)];
  if (setter) { setter.call(this, value); } else { this[name] = value; }
  return this;
};
Base.prototype.getConfig = function (name?: string) {
  if (!name) { const out = {}; for (const k in this.self.$configs) { out[k] = this[k]; } return out; }
  const getter = this['get' + Ext.String.capitalize(name)];
  return getter && !getter.$isGetterFor ? getter.call(this) : this[name];
};
Base.prototype.getInitialConfig = function (name?: string) { return name ? (this.initialConfig || {})[name] : this.initialConfig; };
Base.prototype.hasConfig = function (name: string) { return name in (this.self.$configs || {}); };
Base.prototype.callParent = function (args?) {
  const m = currentMethod('callParent');
  const parent = resolveParent(m);
  return parent ? parent.apply(this, args || []) : undefined;
};
Base.prototype.callSuper = function (args?) {
  const m = currentMethod('callSuper');
  const cls = m.$overrideOf || m.$owner;
  const parent = m.$static ? (cls.superclass && cls.superclass.self && cls.superclass.self[m.$name]) : (cls.superclass && cls.superclass[m.$name]);
  return parent ? parent.apply(this, args || []) : undefined;
};
Base.prototype.statics = function () { return this.self; };
Base.prototype.destroy = function () {
  this.destroy = Ext.emptyFn;
  this.destroyed = true;
  this.isDestroyed = true;
};
Base.prototype.getId = function () { return this.id || (this.id = Ext.id(null, 'ext-' + (this.$className || 'base').split('.').pop().toLowerCase() + '-')); };
Base.prototype.isXType = function (xtype: string, shallow?: boolean) {
  if (shallow) { return this.xtype === xtype; }
  return (this.xtypes || []).indexOf(xtype) !== -1 || this.xtype === xtype;
};
Base.prototype.getXType = function () { return this.xtype; };
Base.prototype.getXTypes = function () { return (this.xtypes || []).join('/'); };
Base.prototype.link = function (name, value) { this[name] = value; return value; };
Base.prototype.unlink = function (names) { for (const n of Ext.Array.from(names)) { Ext.destroy(this[n]); delete this[n]; } };
Base.prototype.$owner = Base;
Base.superclass = null;
Base.self = Base;
Base.create = function (...args) { return new this(...args); };
Base.addStatics = function (members) { for (const k in members) { this[k] = wrap(members[k], this, k, true); } return this; };
Base.addMembers = function (members) { addMembers(this, members); return this; };
Base.override = function (members) { applyOverride(this, members); return this; };
Base.getName = function () { return this.$className; };
Base.mixin = function (name, mixinClass) { applyMixin(this, name, mixinClass); return this; };
classes['Ext.Base'] = Base;
Ext.Base = Base;

// ---------------------------------------------------------------- define helpers
const RESERVED = new Set([
  'extend', 'override', 'mixins', 'config', 'cachedConfig', 'eventedConfig', 'platformConfig', 'statics', 'inheritableStatics',
  'privates', 'alias', 'xtype', 'alternateClassName', 'singleton', 'requires', 'uses', 'mixinConfig', '$createdFn', 'onClassExtended'
]);

function addMembers(cls: any, members: any) {
  const proto = cls.prototype;
  const configs = cls.$configs;
  for (const k in members) {
    if (RESERVED.has(k)) { continue; }
    let v = members[k];
    if (k !== 'constructor' && configs && k in configs && typeof v !== 'function') {
      // a subclass redefining a config's default value
      configs[k] = v;
      continue;
    }
    if (typeof v === 'function' && !v.$isClass) { v = wrap(v, cls, k); }
    proto[k] = v;
  }
}

function addConfig(cls: any, config: any) {
  if (!config) { return; }
  const proto = cls.prototype;
  for (const name in config) {
    cls.$configs[name] = config[name];
    const cap = Ext.String.capitalize(name);
    if (!proto['get' + cap]) {
      const getter = function (this: any) { return this[name]; };
      (getter as any).$isGetterFor = name;
      proto['get' + cap] = getter;
    }
    if (!proto['set' + cap]) {
      const setter = function (this: any, value: any) { applyConfigValue(this, name, value); return this; };
      (setter as any).$autoGenerated = true;
      proto['set' + cap] = setter;
    }
  }
}

function applyMixin(cls: any, id: string, mixin: any) {
  if (typeof mixin === 'string') {
    const name = mixin;
    mixin = ClassManager.get(name);
    if (!mixin) { throw new Error('Mixin ' + name + ' is not defined'); }
  }
  const mproto = mixin.prototype;
  const proto = cls.prototype;
  const mcfg = mproto.mixinConfig || {};
  id = mcfg.id || id || mproto.mixinId || mproto.$className;
  for (const key in mproto) {
    if (key === 'mixins' || key === 'mixinId' || key === 'config' || key === 'mixinConfig' || key === 'self' || key === '$className' ||
        key === 'constructor' || key === 'xtypes' || key === '$configs' || key === 'isInstance') { continue; }
    if (proto[key] === undefined) { proto[key] = mproto[key]; }
  }
  if (mixin.$configs) {
    for (const k in mixin.$configs) {
      if (!(k in cls.$configs)) { addConfig(cls, { [k]: mixin.$configs[k] }); }
    }
  }
  if (!Object.prototype.hasOwnProperty.call(proto, 'mixins')) { proto.mixins = Object.create(proto.mixins || {}); }
  proto.mixins[id] = mproto;
  if (mcfg.before) {
    for (const m in mcfg.before) { const own = proto[m]; const hook = mproto[mcfg.before[m]]; proto[m] = function (...a) { if (hook.apply(this, a) === false) { return false; } return own ? own.apply(this, a) : undefined; }; }
  }
  if (mcfg.after) {
    for (const m in mcfg.after) { const own = proto[m]; const hook = mproto[mcfg.after[m]]; proto[m] = function (...a) { const r = own ? own.apply(this, a) : undefined; hook.apply(this, a); return r; }; }
  }
  if (mixin.onClassMixedIn) { mixin.onClassMixedIn.call(mixin, cls); }
  if (mproto.onClassMixedIn) { mproto.onClassMixedIn.call(mixin, cls); }
}

function applyOverride(target: any, body: any) {
  const proto = target.prototype;
  if (body.config) {
    for (const k in body.config) {
      if (k in target.$configs) { target.$configs[k] = body.config[k]; } else { addConfig(target, { [k]: body.config[k] }); }
    }
  }
  if (body.statics) { for (const k in body.statics) { target[k] = wrap(body.statics[k], target, k, true, target[k]); } }
  if (body.inheritableStatics) { for (const k in body.inheritableStatics) { target[k] = wrap(body.inheritableStatics[k], target, k, true, target[k]); } }
  if (body.mixins) { for (const [id, m] of mixinEntries(body.mixins)) { applyMixin(target, id, m); } }
  if (body.privates) { applyOverride(target, body.privates); }
  for (const k in body) {
    if (RESERVED.has(k)) { continue; }
    const v = body[k];
    if (typeof v === 'function' && !v.$isClass) {
      const previous = proto[k];
      const fn = wrap(v, target, k, false, previous || null);
      if (fn.$orig) { fn.$overrideOf = target; }
      proto[k] = fn;
    } else if (k in target.$configs) {
      target.$configs[k] = v;
    } else {
      proto[k] = v;
    }
  }
}

function mixinEntries(mixins: any): [string, any][] {
  if (!mixins) { return []; }
  if (Array.isArray(mixins)) {
    return mixins.map((m) => {
      const cls = typeof m === 'string' ? ClassManager.get(m) : m;
      const id = cls && cls.prototype && cls.prototype.mixinConfig && cls.prototype.mixinConfig.id;
      return [id || (cls && cls.prototype.mixinId) || (typeof m === 'string' ? m : cls && cls.$className), m];
    });
  }
  return Object.keys(mixins).map((k) => [k, mixins[k]]);
}

// ---------------------------------------------------------------- Ext.define
export function define(name: string | null, body: any, createdFn?: any) {
  if (typeof body === 'function') { body = body.call(Ext.global, null); }
  body = body || {};
  if (body.override) {
    const targetName = body.override;
    const target = typeof targetName === 'string' ? ClassManager.get(targetName) : targetName;
    if (!target) {
      (pendingOverrides[targetName] = pendingOverrides[targetName] || []).push(body);
      return null;
    }
    applyOverride(target, body);
    if (createdFn) { createdFn.call(target, target); }
    if (name) { classes[name] = target; }
    return target;
  }
  let parent = body.extend;
  if (typeof parent === 'string') {
    const p = ClassManager.get(parent);
    if (!p) { throw new Error('Ext.define("' + name + '"): base class "' + parent + '" is not defined (check load order)'); }
    parent = p;
  }
  parent = parent || Base;
  const cls = makeCtor();
  cls.$isClass = true;
  cls.$className = name;
  cls.superclass = parent.prototype;
  cls.prototype = Object.create(parent.prototype);
  cls.prototype.self = cls;
  cls.prototype.$className = name;
  cls.self = cls;
  cls.$configs = Object.create(parent.$configs || {});
  // copy statics that are inheritable / class helpers
  for (const k of ['create', 'addStatics', 'addMembers', 'override', 'getName', 'mixin']) { cls[k] = Base[k]; }
  if (parent.$inheritableStatics) {
    cls.$inheritableStatics = Object.assign({}, parent.$inheritableStatics);
    for (const k in parent.$inheritableStatics) { cls[k] = parent[k]; }
  }
  if (parent.$onExtended) {
    cls.$onExtended = parent.$onExtended;
  }
  // own constructor wrapped like any method
  if (Object.prototype.hasOwnProperty.call(body, 'constructor') && typeof body.constructor === 'function') {
    cls.prototype.constructor = wrap(body.constructor, cls, 'constructor');
  }
  // xtypes / aliases
  const aliases = Ext.Array.from(body.alias).slice();
  for (const x of Ext.Array.from(body.xtype)) { if (aliases.indexOf('widget.' + x) < 0) { aliases.push('widget.' + x); } }
  const xtypes = (parent.prototype.xtypes || []).slice();
  for (const a of aliases) {
    if (a.indexOf('widget.') === 0) {
      const x = a.substr(7);
      if (xtypes.indexOf(x) < 0) { xtypes.push(x); }
    }
  }
  cls.prototype.xtypes = xtypes;
  const firstWidget = aliases.find((a) => a.indexOf('widget.') === 0);
  if (firstWidget) { cls.prototype.xtype = firstWidget.substr(7); }
  // hooks before members
  if (cls.$onExtended) { for (const fn of cls.$onExtended) { fn.call(cls, cls, body); } }
  if (body.onClassExtended) {
    cls.$onExtended = (cls.$onExtended || []).concat([body.onClassExtended]);
  }
  addConfig(cls, body.config);
  addConfig(cls, body.cachedConfig);
  addConfig(cls, body.eventedConfig);
  for (const [id, m] of mixinEntries(body.mixins)) { applyMixin(cls, id, m); }
  if (body.privates) { addMembers(cls, body.privates); }
  addMembers(cls, body);
  if (body.statics) { for (const k in body.statics) { cls[k] = wrap(body.statics[k], cls, k, true); } }
  if (body.inheritableStatics) {
    cls.$inheritableStatics = Object.assign({}, cls.$inheritableStatics || {});
    for (const k in body.inheritableStatics) { cls[k] = wrap(body.inheritableStatics[k], cls, k, true); cls.$inheritableStatics[k] = true; }
  }
  if (body.mixinConfig) { cls.prototype.mixinConfig = body.mixinConfig; }
  if (name) {
    classes[name] = cls;
    for (const a of aliases) { ClassManager.setAlias(cls, a); }
    for (const alt of Ext.Array.from(body.alternateClassName)) { classes[alt] = cls; setNamespace(alt, cls); }
  }
  let result = cls;
  if (body.singleton) {
    result = new cls();
    if (name) { classes[name] = cls; }
  }
  if (name) { setNamespace(name, result); }
  if (name && pendingOverrides[name]) {
    for (const ov of pendingOverrides[name]) { applyOverride(cls, ov); }
    delete pendingOverrides[name];
  }
  if (createdFn) { createdFn.call(result, result); }
  if (body.$createdFn) { body.$createdFn.call(result, result); }
  return result;
}
Ext.define = define;

Ext.create = function (name: any, ...args) {
  if (name && typeof name === 'object' && !name.$isClass) {
    const cfg = name;
    if (cfg.xclass) { return ClassManager.instantiate(cfg.xclass, cfg); }
    if (cfg.xtype) { return Ext.widget(cfg); }
    throw new Error('Ext.create: config without xclass/xtype');
  }
  if (typeof name === 'function') { return new name(...args); }
  if (typeof name === 'string' && !classes[name] && aliasToName[name]) { return ClassManager.instantiateByAlias(name, ...args); }
  return ClassManager.instantiate(name, ...args);
};
Ext.widget = function (xtype: any, config?: any) {
  if (xtype && typeof xtype === 'object') {
    if (xtype.isComponent) { return xtype; }
    config = xtype;
    xtype = config.xtype;
  }
  if (config && config.xclass) { return ClassManager.instantiate(config.xclass, config); }
  const cls = ClassManager.getByAlias('widget.' + xtype);
  if (!cls) { throw new Error('Unknown xtype "' + xtype + '"'); }
  return new cls(config);
};
Ext.getClass = (o) => o && o.self;
Ext.getClassName = (o) => ClassManager.getName(o);
Ext.override = function (target: any, overrides: any) {
  if (target.$isClass) { applyOverride(target, overrides); } else { Ext.apply(target, overrides); }
  return target;
};

/**
 * Ext.Factory: creates or reconfigures instances of an alias family from a config. `type` picks the alias
 * (e.g. 'store.gt-trades'); instances pass through unchanged.
 */
export function factory(prefix: string, defaultType?: string) {
  return function (config: any, defaultTypeOverride?: string, existing?: any) {
    if (config === null || config === undefined || config === false) { return config === false ? false : null; }
    if (config.isInstance) { return config; }
    if (typeof config === 'string') {
      const cls = ClassManager.getByAlias(prefix + '.' + config) || ClassManager.get(config);
      if (!cls) { throw new Error('Unknown ' + prefix + ' type "' + config + '"'); }
      return new cls();
    }
    if (typeof config === 'function') { return new config(); }
    if (config.xclass) { return ClassManager.instantiate(config.xclass, config); }
    const type = config.type || defaultTypeOverride || defaultType;
    let cls = type ? (ClassManager.getByAlias(prefix + '.' + type) || ClassManager.get(type)) : null;
    if (!cls && existing) { cls = existing.self; }
    if (!cls) { throw new Error('Unknown ' + prefix + ' type "' + type + '"'); }
    const cfg = Ext.apply({}, config);
    delete cfg.type;
    return new cls(cfg);
  };
}
Ext.Factory = {
  store: factory('store', 'store'),
  proxy: factory('proxy', 'ajax'),
  reader: factory('reader', 'json'),
  writer: factory('writer', 'json'),
  layout: factory('layout', 'auto'),
  plugin: factory('plugin'),
  feature: factory('feature'),
  controller: factory('controller'),
  viewModel: factory('viewmodel', 'default'),
  selection: factory('selection', 'rowmodel'),
  validator: factory('data.validator'),
  identifier: factory('data.identifier', 'sequential')
};
Ext.factory = function (config: any, classReference?: string, instance?: any, aliasNamespace?: string) {
  if (config && config.isInstance) { return config; }
  if (aliasNamespace) { return factory(aliasNamespace)(config, undefined, instance); }
  if (classReference) {
    if (instance && config && !config.isInstance) { instance.setConfig(config); return instance; }
    return ClassManager.instantiate(classReference, config);
  }
  return config;
};

define('Ext.Mixin', {});
define('Ext.util.Positionable', { extend: 'Ext.Mixin' });

export default define;
