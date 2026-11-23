/**
 * Ext.mixin.Observable / Ext.util.Observable: on/un/fireEvent with Ext's listener options (scope, single,
 * buffer, delay, args, priority, destroyable, element/delegate for components), managed listeners (mon/mun),
 * relayEvents, suspendEvents/resumeEvents and Ext.GlobalEvents. Event names are case-insensitive, as in Ext.
 */
import { Ext } from './ext';
import { define } from './class';

const OPTION_KEYS = new Set(['scope', 'single', 'buffer', 'delay', 'args', 'priority', 'order', 'destroyable', 'element',
  'delegate', 'target', 'onFrame', 'capture', 'stopEvent', 'preventDefault', 'stopPropagation', 'translate', 'vertical', 'horizontal']);

function makeDestroyable(fn: () => void) {
  return { destroy: fn, destroyed: false };
}

export const ObservableMixin: any = define('Ext.mixin.Observable', {
  extend: 'Ext.Mixin',
  mixinConfig: { id: 'observable' },
  isObservable: true,
  eventsSuspended: 0,

  constructor: function (config?: any) {
    this.initConfig(config);
    if (this.listeners && !this.$listenersApplied) {
      this.$listenersApplied = true;
      this.on(this.listeners);
    }
    return this;
  },

  $getEvents: function () {
    if (!Object.prototype.hasOwnProperty.call(this, '$events') || !this.$events) { this.$events = {}; }
    return this.$events;
  },

  addListener: function (ename: any, fn?: any, scope?: any, options?: any, order?: any, caller?: any) {
    const me = this;
    if (ename && typeof ename === 'object') {
      const cfg = ename;
      const shared: any = {};
      for (const k in cfg) { if (OPTION_KEYS.has(k)) { shared[k] = cfg[k]; } }
      const destroyables = [];
      for (const name in cfg) {
        if (OPTION_KEYS.has(name)) { continue; }
        const v = cfg[name];
        if (v === undefined || v === null) { continue; }
        if (typeof v === 'function' || typeof v === 'string') {
          destroyables.push(me.addListener(name, v, shared.scope, Ext.apply({}, shared, { destroyable: true }), order, caller));
        } else if (typeof v === 'object') {
          const opts = Ext.apply({}, v, shared);
          destroyables.push(me.addListener(name, v.fn, v.scope !== undefined ? v.scope : shared.scope, Ext.apply(opts, { destroyable: true }), order, caller));
        }
      }
      if (shared.destroyable) {
        return makeDestroyable(() => { for (const d of destroyables) { if (d) { d.destroy(); } } });
      }
      return me;
    }
    if (!ename || !fn) { return me; }
    options = options || {};
    if (options.element && me.addElementListener) {
      const d = me.addElementListener(options.element, ename, fn, scope, options);
      return options.destroyable ? d : me;
    }
    const name = String(ename).toLowerCase();
    const events = me.$getEvents();
    const list = events[name] || (events[name] = []);
    const listener: any = { fn, scope, options, owner: me, caller: caller || options.caller, priority: options.priority || 0 };
    let fire = (args) => me.$invokeListener(listener, args);
    if (options.buffer) {
      let timer = null;
      const real = fire;
      fire = (args) => { if (timer) { clearTimeout(timer); } timer = setTimeout(() => { timer = null; if (!me.destroyed) { real(args); } }, options.buffer); };
      listener.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    } else if (options.delay) {
      const real = fire;
      fire = (args) => { setTimeout(() => { if (!me.destroyed) { real(args); } }, options.delay); };
    }
    listener.fire = fire;
    if (listener.priority) {
      let i = 0;
      while (i < list.length && (list[i].priority || 0) >= listener.priority) { i++; }
      list.splice(i, 0, listener);
    } else {
      list.push(listener);
    }
    if (options.destroyable) {
      return makeDestroyable(() => me.removeListener(ename, fn, scope));
    }
    return me;
  },

  $invokeListener: function (listener: any, args: any[]) {
    const me = this;
    let fn = listener.fn, scope = listener.scope;
    const opts = listener.options || {};
    if (opts.target && args[0] !== opts.target) { return undefined; }
    if (typeof fn === 'string') {
      const resolved = me.resolveListenerScope ? me.resolveListenerScope(scope, listener) : scope;
      if (!resolved || typeof resolved[fn] !== 'function') {
        console.warn('Listener "' + fn + '" for an event of ' + (me.$className || 'an object') + ' was not found on the resolved scope');
        return undefined;
      }
      scope = resolved;
      fn = resolved[fn];
    } else if (scope === 'this') {
      scope = me;
    } else if (scope === 'controller' && me.lookupController) {
      scope = me.lookupController();
    }
    if (opts.single) { me.removeListener(listener.$name || '', listener.fn, listener.scope, listener); }
    const callArgs = opts.args ? opts.args.concat(args) : args;
    return fn.apply(scope === undefined || scope === null ? me : scope, callArgs.concat([opts]));
  },

  removeListener: function (ename: any, fn?: any, scope?: any, exact?: any) {
    const me = this;
    if (ename && typeof ename === 'object') {
      const cfg = ename;
      for (const name in cfg) {
        if (OPTION_KEYS.has(name)) { continue; }
        const v = cfg[name];
        me.removeListener(name, typeof v === 'object' && v ? v.fn : v, (v && v.scope) || cfg.scope);
      }
      return me;
    }
    const events = me.$events;
    if (!events) { return me; }
    if (exact && !ename) {
      for (const n in events) { const i = events[n].indexOf(exact); if (i >= 0) { events[n].splice(i, 1); } }
      return me;
    }
    const name = String(ename).toLowerCase();
    const list = events[name];
    if (!list) { return me; }
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i];
      if ((exact && l === exact) || (!exact && l.fn === fn && (scope === undefined || l.scope === scope))) {
        if (l.cancel) { l.cancel(); }
        list.splice(i, 1);
        if (!exact) { break; }
      }
    }
    return me;
  },

  fireEvent: function (ename: string, ...args) {
    return this.fireEventArgs(ename, args);
  },

  fireEventArgs: function (ename: string, args: any[]) {
    const me = this;
    const name = String(ename).toLowerCase();
    if (me.eventsSuspended || (me.$suspendedEvents && me.$suspendedEvents[name])) {
      if (me.$eventQueue) { me.$eventQueue.push([name, args]); }
      return true;
    }
    let result = true;
    const list = me.$events && me.$events[name];
    if (list && list.length) {
      for (const l of list.slice()) {
        if (me.destroyed && name !== 'destroy') { break; }
        l.$name = name;
        const r = l.fire(args);
        if (r === false) { result = false; }
      }
    }
    if (result !== false && me.bubbleEvents && me.bubbleEvents.indexOf(name) >= 0 && me.getBubbleTarget) {
      const target = me.getBubbleTarget();
      if (target && target.fireEventArgs) { return target.fireEventArgs(name, args); }
    }
    return result;
  },

  hasListener: function (ename: string) {
    const list = this.$events && this.$events[String(ename).toLowerCase()];
    return !!(list && list.length);
  },

  clearListeners: function () {
    this.$events = {};
    this.clearManagedListeners();
  },

  // ---- managed listeners (removed on destroy)
  addManagedListener: function (item: any, ename: any, fn?: any, scope?: any, options?: any) {
    const me = this;
    if (!item) { return null; }
    const managed = me.$managed || (me.$managed = []);
    if (ename && typeof ename === 'object') {
      const cfg = ename;
      const opts: any = {};
      for (const k in cfg) { if (OPTION_KEYS.has(k)) { opts[k] = cfg[k]; } }
      const list = [];
      for (const name in cfg) {
        if (OPTION_KEYS.has(name)) { continue; }
        const v = cfg[name];
        if (v === undefined || v === null) { continue; }
        const f = typeof v === 'object' ? v.fn : v;
        const s = typeof v === 'object' && v.scope !== undefined ? v.scope : opts.scope;
        const o = Ext.apply({}, typeof v === 'object' ? v : {}, opts);
        list.push(me.addManagedListener(item, name, f, s, Ext.apply(o, { destroyable: true })));
      }
      if (opts.destroyable) { return makeDestroyable(() => { for (const d of list) { if (d) { d.destroy(); } } }); }
      return me;
    }
    const d = item.on(ename, fn, scope, Ext.apply({}, options, { destroyable: true }));
    const entry = { item, ename, fn, scope, d };
    managed.push(entry);
    if (options && options.destroyable) {
      return makeDestroyable(() => { if (d && d.destroy) { d.destroy(); } Ext.Array.remove(managed, entry); });
    }
    return me;
  },

  removeManagedListener: function (item: any, ename: any, fn?: any, scope?: any) {
    const managed = this.$managed || [];
    if (ename && typeof ename === 'object') {
      for (const name in ename) { if (!OPTION_KEYS.has(name)) { const v = ename[name]; this.removeManagedListener(item, name, typeof v === 'object' ? v.fn : v, ename.scope); } }
      return this;
    }
    for (let i = managed.length - 1; i >= 0; i--) {
      const m = managed[i];
      if (m.item === item && (!ename || String(m.ename).toLowerCase() === String(ename).toLowerCase()) && (!fn || m.fn === fn) && (scope === undefined || m.scope === scope)) {
        if (m.d && m.d.destroy) { m.d.destroy(); } else { item.un(m.ename, m.fn, m.scope); }
        managed.splice(i, 1);
      }
    }
    return this;
  },

  clearManagedListeners: function () {
    for (const m of this.$managed || []) {
      try { if (m.d && m.d.destroy) { m.d.destroy(); } else if (m.item && m.item.un) { m.item.un(m.ename, m.fn, m.scope); } } catch (e) { /* item gone */ }
    }
    this.$managed = [];
  },

  relayEvents: function (origin: any, events: string[], prefix?: string) {
    const me = this;
    const ds = [];
    for (const name of Ext.Array.from(events)) {
      // the invoker appends the listener options as the last argument: drop it before re-firing
      const fn = function (...args) { return me.fireEventArgs((prefix || '') + name, args.slice(0, -1)); };
      ds.push(origin.on(name, fn, me, { destroyable: true }));
    }
    return makeDestroyable(() => { for (const d of ds) { if (d && d.destroy) { d.destroy(); } } });
  },

  suspendEvents: function (queueSuspended?: boolean) {
    this.eventsSuspended = (this.eventsSuspended || 0) + 1;
    if (queueSuspended && !this.$eventQueue) { this.$eventQueue = []; }
  },

  resumeEvents: function (discardQueue?: boolean) {
    const me = this;
    if (me.eventsSuspended) { me.eventsSuspended--; }
    if (!me.eventsSuspended && me.$eventQueue) {
      const q = me.$eventQueue;
      me.$eventQueue = null;
      if (!discardQueue) { for (const [n, a] of q) { me.fireEventArgs(n, a); } }
    }
  },

  suspendEvent: function (...names: string[]) {
    this.$suspendedEvents = this.$suspendedEvents || {};
    for (const n of names) { this.$suspendedEvents[String(n).toLowerCase()] = (this.$suspendedEvents[String(n).toLowerCase()] || 0) + 1; }
  },

  resumeEvent: function (...names: string[]) {
    for (const n of names) {
      const k = String(n).toLowerCase();
      if (this.$suspendedEvents && this.$suspendedEvents[k]) { this.$suspendedEvents[k]--; }
    }
  },

  isSuspended: function (ename?: string) {
    return !!this.eventsSuspended || (!!ename && !!(this.$suspendedEvents && this.$suspendedEvents[ename.toLowerCase()]));
  },

  enableBubble: function (events: any) {
    this.bubbleEvents = (this.bubbleEvents || []).concat(Ext.Array.from(events).map((e) => String(e).toLowerCase()));
  },

  resolveListenerScope: function (scope?: any) {
    if (scope && typeof scope === 'object') { return scope; }
    return this;
  },

  destroyObservable: function () {
    this.clearManagedListeners();
    if (this.$events) {
      for (const n in this.$events) { for (const l of this.$events[n]) { if (l.cancel) { l.cancel(); } } }
    }
    this.$events = {};
  }
});

const P = ObservableMixin.prototype;
P.on = P.addListener;
P.un = P.removeListener;
P.mon = P.addManagedListener;
P.mun = P.removeManagedListener;

export const Observable: any = define('Ext.util.Observable', {
  mixins: { observable: 'Ext.mixin.Observable' },
  constructor: function (config?: any) {
    this.mixins.observable.constructor.call(this, config);
    return this;
  },
  destroy: function () {
    this.destroyObservable();
    this.callParent();
  }
});

Ext.GlobalEvents = new Observable();
Ext.on = (...a) => Ext.GlobalEvents.on(...a);
Ext.un = (...a) => Ext.GlobalEvents.un(...a);
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => Ext.GlobalEvents.fireEvent('resize', window.innerWidth, window.innerHeight));
}
