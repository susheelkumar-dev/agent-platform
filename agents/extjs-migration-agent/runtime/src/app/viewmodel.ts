/**
 * Ext.app.ViewModel and the binding engine.
 *
 * Bind descriptors: '{name}', '{a.b.c}' (record fields resolve through record.get), '{!flag}', templates such as
 * 'Acting as {user} ({role})', and objects of descriptors (multi-bind). Formulas receive a `get` function and
 * are re-evaluated when anything changes; bindings deliver only when their value changes. Delivery is
 * scheduled (microtask) like Ext's scheduler; vm.notify() flushes synchronously. Values that are not yet
 * available (undefined) are not delivered, as in Ext.
 */
import { Ext } from '../core/ext';
import { define } from '../core/class';

const liveVMs = new Set<any>();
let scheduled = false;
let flushing = false;

function schedule() {
  if (scheduled) { return; }
  scheduled = true;
  queueMicrotask(() => { scheduled = false; flushAll(); });
}

function flushAll() {
  if (flushing) { schedule(); return; }
  flushing = true;
  try {
    for (let pass = 0; pass < 10; pass++) {
      let delivered = false;
      for (const vm of Array.from(liveVMs)) {
        if (vm.destroyed) { liveVMs.delete(vm); continue; }
        vm.$formulaCache = null;
      }
      for (const vm of Array.from(liveVMs)) {
        if (vm.destroyed) { continue; }
        if (vm.$deliver()) { delivered = true; }
      }
      if (!delivered) { break; }
    }
  } finally {
    flushing = false;
  }
}

/** Records referenced by bindings trigger a flush when they change. */
export const boundRecords = new WeakSet<any>();
Ext.app = Ext.app || {};
Ext.app.$recordChanged = function (rec: any) { if (boundRecords.has(rec)) { schedule(); } };

function getPathValue(root: any, parts: string[]) {
  let v = root;
  for (const p of parts) {
    if (v === null || v === undefined) { return undefined; }
    if (v.isModel) { boundRecords.add(v); v = v.get(p); }
    else if (v.isStore && p === 'count') { v = v.getCount(); }
    else { v = v[p]; }
  }
  if (v && v.isModel) { boundRecords.add(v); }
  return v;
}

const TOKEN_RE = /\{(!?)([\w.$-]+)(?::([\w.]+)(?:\(([^)]*)\))?)?\}/g;

function parseDescriptor(desc: string) {
  const s = String(desc);
  const whole = /^\{(!?)([\w.$-]+)(?::([\w.]+)(?:\(([^)]*)\))?)?\}$/.exec(s);
  if (whole) {
    return { kind: 'single', not: !!whole[1], path: whole[2], format: whole[3], args: whole[4] };
  }
  return { kind: 'template', text: s };
}

export const ViewModel: any = define('Ext.app.ViewModel', {
  mixins: { observable: 'Ext.mixin.Observable' },
  alias: 'viewmodel.default',
  isViewModel: true,

  constructor: function (config?: any) {
    const me = this;
    config = Ext.apply({}, config);
    const classData = me.data;
    const classFormulas = me.formulas;
    const classStores = me.stores;
    me.$data = Ext.Object.merge({}, Ext.clone(classData) || {}, config.data || {});
    me.$formulas = Ext.apply({}, config.formulas, classFormulas);
    me.$storeConfigs = Ext.apply({}, classStores, config.stores);
    me.$stores = {};
    me.$bindings = [];
    me.view = config.view || null;
    me.$parent = config.parent || null;
    for (const k of ['data', 'formulas', 'stores', 'view', 'parent', 'type']) { delete config[k]; }
    me.mixins.observable.constructor.call(me, config);
    liveVMs.add(me);
    me.$createStores();
    return me;
  },

  $createStores: function () {
    const me = this;
    for (const name in me.$storeConfigs) {
      let cfg = me.$storeConfigs[name];
      if (cfg && cfg.isStore) { me.$stores[name] = cfg; continue; }
      cfg = Ext.apply({}, cfg);
      // simple support for { source: '{otherStore}' } chained stores
      if (typeof cfg.source === 'string' && /^\{.*\}$/.test(cfg.source)) {
        const srcName = cfg.source.slice(1, -1);
        cfg.source = me.getStore(srcName) || me.get(srcName);
        cfg.type = cfg.type || 'chained';
      }
      me.$stores[name] = Ext.Factory.store(cfg);
    }
  },
  getStore: function (name: string) {
    if (this.$stores[name]) { return this.$stores[name]; }
    const p = this.getParent();
    return p ? p.getStore(name) : null;
  },
  getStores: function () { return this.$stores; },

  getView: function () { return this.view; },
  setView: function (v: any) { this.view = v; },
  getParent: function () {
    const me = this;
    if (me.$parent) { return me.$parent; }
    const view = me.view;
    if (!view) { return null; }
    let owner = view.getRefOwner ? view.getRefOwner() : view.ownerCt;
    while (owner) {
      const vm = owner.getViewModel && owner.getViewModel();
      if (vm && vm !== me) { return vm; }
      owner = owner.getRefOwner ? owner.getRefOwner() : owner.ownerCt;
    }
    return null;
  },
  setParent: function (p: any) { this.$parent = p; },
  getData: function () { return this.$data; },

  /** True when this VM (not a parent) owns the root of the path. */
  $owns: function (root: string) {
    return Object.prototype.hasOwnProperty.call(this.$data, root) || !!this.$formulas[root] || !!this.$stores[root];
  },

  get: function (path: string) {
    const me = this;
    if (!path) { return undefined; }
    const parts = String(path).split('.');
    const root = parts[0];
    if (me.$formulas[root]) {
      const v = me.$evalFormula(root);
      return parts.length > 1 ? getPathValue(v, parts.slice(1)) : v;
    }
    if (me.$stores[root]) { return parts.length > 1 ? getPathValue(me.$stores[root], parts.slice(1)) : me.$stores[root]; }
    if (Object.prototype.hasOwnProperty.call(me.$data, root)) { return getPathValue(me.$data, parts); }
    const parent = me.getParent();
    return parent ? parent.get(path) : undefined;
  },

  $evalFormula: function (name: string) {
    const me = this;
    me.$formulaCache = me.$formulaCache || {};
    if (Object.prototype.hasOwnProperty.call(me.$formulaCache, name)) { return me.$formulaCache[name]; }
    const f = me.$formulas[name];
    let fn = f, bindValue;
    if (f && typeof f === 'object') {
      fn = f.get;
      if (f.bind) {
        if (typeof f.bind === 'string') { bindValue = me.$resolve(parseDescriptor(f.bind)); }
        else { bindValue = {}; for (const k in f.bind) { bindValue[k] = me.$resolve(parseDescriptor(f.bind[k])); } }
      }
    }
    me.$formulaCache[name] = undefined; // cycle guard
    let v;
    try {
      const getter = (p: string) => me.get(p);
      v = f && typeof f === 'object' && f.bind ? fn.call(me, bindValue) : fn.call(me, getter);
    } catch (e) {
      console.warn('ViewModel formula "' + name + '" failed: ' + (e && e.message));
      v = undefined;
    }
    me.$formulaCache[name] = v;
    return v;
  },

  set: function (path: any, value?: any) {
    const me = this;
    if (path && typeof path === 'object') {
      for (const k in path) { me.set(k, path[k]); }
      return;
    }
    const parts = String(path).split('.');
    const root = parts[0];
    // set on the VM that owns the root (walking up), else on this one
    let target = me;
    if (!me.$owns(root)) {
      let p = me.getParent();
      while (p) { if (p.$owns(root)) { target = p; break; } p = p.getParent(); }
    }
    if (target.$formulas[root]) {
      const f = target.$formulas[root];
      if (f && typeof f === 'object' && f.set) { f.set.call(target, value); }
      schedule();
      return;
    }
    let obj = target.$data;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (obj[k] && obj[k].isModel) { obj[k].set(parts.slice(i + 1).join('.'), value); schedule(); return; }
      if (obj[k] === null || obj[k] === undefined || typeof obj[k] !== 'object') { obj[k] = {}; }
      obj = obj[k];
    }
    const last = parts[parts.length - 1];
    if (obj[last] === value) { return; }
    obj[last] = value;
    schedule();
  },

  $resolve: function (d: any) {
    const me = this;
    if (d.kind === 'single') {
      const parts = d.path.split('.');
      const rootVal = me.get(parts[0]);
      if (rootVal === undefined && !me.$knows(parts[0])) { return undefined; }
      let v = parts.length > 1 ? getPathValue(rootVal, parts.slice(1)) : rootVal;
      if (d.format) {
        const args = d.args ? (new Function('return [' + d.args + '];'))() : [];
        const fn = Ext.util.Format[d.format];
        if (fn) { v = fn.apply(Ext.util.Format, [v].concat(args)); }
      }
      return d.not ? !v : v;
    }
    let missing = false;
    const out = d.text.replace(TOKEN_RE, (m: string, not: string, path: string, fmt?: string, args?: string) => {
      const r = me.$resolve({ kind: 'single', not: !!not, path, format: fmt, args });
      if (r === undefined) { missing = true; return ''; }
      return r === null ? '' : r;
    });
    return missing ? undefined : out;
  },
  /** Whether a root name is known anywhere up the chain (data, formula or store), even if undefined. */
  $knows: function (root: string) {
    let vm = this;
    while (vm) { if (vm.$owns(root)) { return true; } vm = vm.getParent(); }
    return false;
  },

  bind: function (descriptor: any, callback: any, scope?: any, options?: any) {
    const me = this;
    const isMulti = descriptor && typeof descriptor === 'object' && !Ext.isArray(descriptor);
    const parsed = isMulti ? Ext.Object.getKeys(descriptor).map((k: string) => [k, parseDescriptor(descriptor[k])]) : parseDescriptor(descriptor);
    const binding: any = {
      isBinding: true,
      vm: me,
      descriptor,
      callback,
      scope,
      options: options || {},
      $last: undefined,
      $delivered: false,
      getValue: () => me.$bindingValue(binding),
      setValue: (v: any) => {
        if (!isMulti && (parsed as any).kind === 'single' && !(parsed as any).not && !(parsed as any).format) {
          binding.$last = v;
          me.set((parsed as any).path, v);
        }
      },
      isReadOnly: () => isMulti || (parsed as any).kind !== 'single' || (parsed as any).not,
      destroy: () => { Ext.Array.remove(me.$bindings, binding); binding.destroyed = true; },
      refresh: () => { binding.$delivered = false; schedule(); },
      $parsed: parsed,
      $multi: isMulti
    };
    me.$bindings.push(binding);
    schedule();
    return binding;
  },

  $bindingValue: function (b: any) {
    const me = this;
    if (b.$multi) {
      const out = {};
      for (const [k, d] of b.$parsed) { const v = me.$resolve(d); if (v === undefined) { return undefined; } out[k] = v; }
      return out;
    }
    return me.$resolve(b.$parsed);
  },

  $deliver: function () {
    const me = this;
    let delivered = false;
    for (const b of me.$bindings.slice()) {
      if (b.destroyed) { continue; }
      const v = me.$bindingValue(b);
      if (v === undefined) { continue; }
      const same = b.$delivered && (b.$multi ? Ext.Object.equals(v, b.$last) : v === b.$last || (Ext.isDate(v) && Ext.isDate(b.$last) && v.getTime() === b.$last.getTime()));
      if (same) { continue; }
      b.$last = v;
      b.$delivered = true;
      delivered = true;
      try { b.callback.call(b.scope || me, v, b); } catch (e) { console.error('Binding callback failed', b.descriptor, e); }
      if (b.options.single) { b.destroy(); }
    }
    return delivered;
  },

  notify: function () { flushAll(); },
  linkTo: function (name: string, value: any) { this.set(name, value); },
  getSession: function () { return null; },
  getSchema: function () { return null; },
  destroy: function () {
    const me = this;
    liveVMs.delete(me);
    for (const n in me.$stores) { if (me.$stores[n] && me.$stores[n].autoDestroy !== false && !me.$storeConfigs[n].isStore) { Ext.destroy(me.$stores[n]); } }
    me.$bindings = [];
    me.destroyObservable();
    me.callParent();
  },
  statics: { notifyAll: flushAll, schedule }
});

export default ViewModel;
