/**
 * Ext.app.ViewController, Ext.app.Controller and Ext.app.Application (Ext.application): routes, listen
 * domains (global, controller, component, store), control, references, redirectTo, setMainView and
 * defaultToken. The Application waits for the DOM, runs init / launch and creates the main view.
 */
import { Ext } from '../core/ext';
import { define } from '../core/class';
import { Router, redirectTo, History } from './router';
import { query, is } from '../ui/componentquery';

function routeMixin(proto: any) {
  proto.$connectRoutes = function () {
    const me = this;
    const routes = me.routes;
    if (!routes || me.$routesConnected) { return; }
    me.$routesConnected = true;
    for (const url in routes) {
      let cfg = routes[url];
      if (typeof cfg === 'string' || typeof cfg === 'function') { cfg = { action: cfg }; }
      Router.connect(url, cfg, me);
    }
  };
  proto.redirectTo = function (token: any, options?: any) { return redirectTo(token, options); };
}

/** Wires a listen config: { global: {...}, controller: { '*': {...} }, component: { selector: {...} }, store: { '#id': {...} } } */
function attachListen(me: any, listen: any, componentRoot?: () => any) {
  const disposers: any[] = [];
  const add = (target: any, listeners: any) => {
    if (!target || !target.on) { return; }
    const cfg: any = {};
    for (const ev in listeners) {
      if (ev === 'scope') { continue; }
      let h = listeners[ev];
      let opts: any = {};
      if (h && typeof h === 'object' && !Ext.isFunction(h)) { opts = Ext.apply({}, h); h = opts.fn; delete opts.fn; }
      const fn = typeof h === 'string' ? (...a: any[]) => { const f = me[h]; if (!f) { throw new Error('Listener "' + h + '" not found on ' + me.$className); } return f.apply(me, a); } : h;
      cfg[ev] = Ext.apply({ fn, scope: typeof h === 'string' ? me : (listeners.scope || me) }, opts);
    }
    cfg.destroyable = true;
    disposers.push(target.on(cfg));
  };
  if (!listen) { return disposers; }
  if (listen.global) { add(Ext.GlobalEvents, listen.global); }
  if (listen.store) {
    for (const sel in listen.store) {
      const id = sel.charAt(0) === '#' ? sel.slice(1) : sel;
      const s = Ext.data.StoreManager.lookup(id);
      if (s && s.isStore) { add(s, listen.store[sel]); }
    }
  }
  if (listen.controller) {
    me.$controllerDomain = listen.controller;
  }
  if (listen.component) {
    const root = componentRoot ? componentRoot() : null;
    for (const sel in listen.component) {
      const targets = root ? (sel === '#' || sel === '' ? [root] : [root].filter((c: any) => is(c, sel)).concat(query(sel, root))) : query(sel);
      for (const t of targets) { add(t, listen.component[sel]); }
    }
  }
  return disposers;
}

// ---------------------------------------------------------------- ViewController
export const ViewController: any = define('Ext.app.ViewController', {
  mixins: { observable: 'Ext.mixin.Observable' },
  alias: 'controller.controller',
  isViewController: true,
  constructor: function (config?: any) {
    const me = this;
    me.mixins.observable.constructor.call(me, config);
    me.$disposers = [];
    return me;
  },
  setView: function (view: any) { this.view = view; },
  getView: function () { return this.view || null; },
  getId: function () { return this.id || (this.id = Ext.id(null, 'controller-')); },
  getViewModel: function () { return this.view ? this.view.lookupViewModel() : null; },
  getStore: function (name: string) { const vm = this.getViewModel(); return vm ? vm.getStore(name) : null; },
  lookupReference: function (ref: string) { const v = this.view; return v ? v.lookupReference(ref) : null; },
  lookup: function (ref: string) { return this.lookupReference(ref); },
  getReferences: function () { return this.view ? this.view.getReferences() : {}; },
  fireViewEvent: function (name: string, ...args: any[]) {
    const v = this.view;
    if (!v) { return false; }
    return v.fireEvent(name, v, ...args);
  },
  getSession: function () { return null; },
  initViewModel: Ext.emptyFn,
  beforeInit: Ext.emptyFn,
  init: Ext.emptyFn,
  $attachListen: function () {
    const me = this;
    if (me.$listenAttached) { return; }
    me.$listenAttached = true;
    const view = me.view;
    me.$disposers.push(...attachListen(me, Ext.apply({}, me.listen), () => view));
    if (me.control) {
      // control: selectors relative to the view, attached once the view's children exist
      const attach = () => { me.$disposers.push(...attachListen(me, { component: me.control }, () => view)); };
      if (view && view.items) { attach(); } else if (view) { view.on('afterrender', attach, me, { single: true }); }
    }
  },
  /** fires an event to other controllers' listen.controller domains */
  $fireControllerEvent: function (name: string, ...args: any[]) {
    for (const c of liveControllers) {
      const dom = c.$controllerDomain;
      if (!dom) { continue; }
      for (const sel in dom) {
        if (sel !== '*' && sel !== '#' + this.getId() && !(this.alias && Ext.Array.from(this.alias).some((a: string) => sel === a.replace('controller.', '')))) { continue; }
        const h = dom[sel][name];
        if (h) { (typeof h === 'string' ? c[h] : h).apply(c, args); }
      }
    }
  },
  destroy: function () {
    const me = this;
    if (me.destroyed) { return; }
    for (const d of me.$disposers) { if (d && d.destroy) { d.destroy(); } }
    Router.disconnect(me);
    liveControllers.delete(me);
    if (me.destroyObservable) { me.destroyObservable(); }
    me.view = null;
    me.destroyed = true;
  }
});
routeMixin(ViewController.prototype);
const liveControllers = new Set<any>();
const origInit = ViewController.prototype.$attachListen;
ViewController.prototype.$attachListen = function () { liveControllers.add(this); return origInit.call(this); };

// ---------------------------------------------------------------- Ext.app.Controller (MVC)
export const Controller: any = define('Ext.app.Controller', {
  mixins: { observable: 'Ext.mixin.Observable' },
  isController: true,
  constructor: function (config?: any) {
    const me = this;
    me.mixins.observable.constructor.call(me, config);
    me.$disposers = [];
    me.$refCache = {};
    if (me.refs) { me.$initRefs(); }
    return me;
  },
  $initRefs: function () {
    const me = this;
    const refs = Ext.isArray(me.refs) ? me.refs : Object.keys(me.refs).map((k) => (typeof me.refs[k] === 'string' ? { ref: k, selector: me.refs[k] } : Ext.apply({ ref: k }, me.refs[k])));
    for (const r of refs) {
      const name = 'get' + Ext.String.capitalize(r.ref);
      if (!me[name]) { me[name] = () => query(r.selector)[0] || null; }
    }
  },
  getApplication: function () { return this.application || Ext.app.Application.instance; },
  getController: function (id: string) { const app = this.getApplication(); return app ? app.getController(id) : null; },
  getStore: function (name: string) { return Ext.data.StoreManager.lookup(name); },
  getModel: function (name: string) { return Ext.ClassManager.get(name); },
  getView: function (name: string) { return Ext.ClassManager.get(name); },
  control: function (selectors: any) { this.$disposers.push(...attachListen(this, { component: selectors })); },
  listen: null,
  doInit: function (app: any) {
    const me = this;
    me.application = app;
    if (me.init) { me.init(app); }
    me.$disposers.push(...attachListen(me, me.listen));
    if (me.control && typeof me.control === 'object') { me.$disposers.push(...attachListen(me, { component: me.control })); }
    me.$connectRoutes();
  },
  init: Ext.emptyFn,
  onLaunch: Ext.emptyFn,
  destroy: function () {
    const me = this;
    for (const d of me.$disposers) { if (d && d.destroy) { d.destroy(); } }
    Router.disconnect(me);
    me.destroyed = true;
  }
});
routeMixin(Controller.prototype);

// ---------------------------------------------------------------- Application
export const Application: any = define('Ext.app.Application', {
  extend: 'Ext.app.Controller',
  isApplication: true,
  appFolder: 'app',
  defaultToken: null,
  mainView: null,
  constructor: function (config?: any) {
    const me = this;
    me.callParent([config]);
    Ext.app.Application.instance = me;
    if (me.name) { Ext.ns(me.name); Ext.global[me.name].getApplication = () => me; Ext.global[me.name].app = me; }
    me.$controllers = {};
    return me;
  },
  getApplication: function () { return this; },
  getName: function () { return this.name; },
  getController: function (id: string) {
    const me = this;
    if (me.$controllers[id]) { return me.$controllers[id]; }
    const full = Ext.ClassManager.get(id) ? id : (me.name ? me.name + '.controller.' + id : id);
    const cls = Ext.ClassManager.get(full);
    if (!cls) { return null; }
    const c = new cls({ application: me, id });
    me.$controllers[id] = c;
    c.doInit(me);
    return c;
  },
  getMainView: function () { return this.$mainView || null; },
  setMainView: function (view: any) {
    const me = this;
    let v = view;
    if (typeof v === 'string') { v = Ext.ClassManager.get(v) ? Ext.create(v) : Ext.widget(v); }
    else if (v && !v.isComponent) { v = Ext.ClassManager.get(v.xclass) ? Ext.create(v.xclass, v) : Ext.widget(v.xtype || 'container', v); }
    if (!v.isViewport && !v.$topLevel) {
      const P = Ext.ClassManager.getByAlias('plugin.viewport');
      new P().init(v);
      v.addCls('x-viewport-host');
      v.$viewportHost = true;
    }
    me.$mainView = v;
    me.viewport = v;
    me.fireEvent('mainviewset', me, v);
    return v;
  },
  $start: function () {
    const me = this;
    const ctl = Ext.Array.from(me.controllers);
    for (const c of ctl) { me.getController(c); }
    me.$connectRoutes();
    if (me.init) { me.init(me); }
    me.$disposers.push(...attachListen(me, me.listen));
    for (const id in me.$controllers) { const c = me.$controllers[id]; if (c.onLaunch) { c.onLaunch(me); } }
    if (me.defaultToken && !History.getToken()) { History.replace(me.defaultToken); }
    me.fireEvent('beforelaunch', me);
    if (me.launch) { me.launch(me); }
    if (me.mainView && !me.$mainView) { me.setMainView(me.mainView); }
    me.fireEvent('launch', me);
    if (me.routes) { Router.onStateChange(History.getToken()); }
  },
  launch: Ext.emptyFn,
  onAppUpdate: Ext.emptyFn
});

Ext.application = function (config: any) {
  let cls: any;
  if (typeof config === 'string') { config = { extend: config }; }
  const cfg = Ext.apply({}, config);
  if (cfg.extend && Object.keys(cfg).every((k) => k === 'extend' || k === 'name')) {
    cls = Ext.ClassManager.get(cfg.extend);
    if (!cls) { throw new Error('Ext.application: unknown class ' + cfg.extend); }
  } else {
    const base = cfg.extend || 'Ext.app.Application';
    delete cfg.extend;
    cls = define((cfg.name ? cfg.name + '.$Application' : null), Ext.apply({ extend: base }, cfg));
  }
  let app: any = null;
  // Hosted by the React application shell (@extreact/framework): the classes are defined and screens are
  // created by the shell, so the Ext application object and its main view are not started.
  if (Ext.$hosted) { Ext.$applicationClass = cls; return null; }
  Ext.onReady(() => {
    app = new cls({ name: cfg.name || cls.prototype.name });
    app.$start();
  });
  return app;
};
Ext.getApplication = () => Ext.app.Application.instance;
