/**
 * Ext.Component and Ext.ComponentManager.
 *
 * Construction follows Ext: config applied -> view model / controller created -> controller.beforeInit ->
 * initComponent() -> listeners attached -> state restored -> plugins initialised -> controller.init().
 * Rendering is React (see render.tsx); lifecycle events (render, afterrender, boxready, resize, show, hide,
 * destroy ...) fire at the matching points. String handlers resolve to view controllers using Ext's rules.
 */
import * as React from 'react';
import { Ext } from '../core/ext';
import { define } from '../core/class';
import '../core/observable';
import { markDirty, flushRender, isPending, addFloating, removeFloating, renderInto, boxValue, sizeValue, styleObject, clsList, html } from './render';
import { query, is } from './componentquery';
import { alignXY } from '../dom/element';
import '../app/viewmodel';

// ---------------------------------------------------------------- ComponentManager
const all = new Map<string, any>();
export const ComponentManager: any = {
  register(c: any) { all.set(c.id, c); },
  unregister(c: any) { if (all.get(c.id) === c) { all.delete(c.id); } },
  get(id: string) { return all.get(id); },
  getAll() { return Array.from(all.values()).filter((c) => !c.destroyed); },
  each(fn: any, scope?: any) { all.forEach((c) => fn.call(scope, c.id, c)); },
  getCount() { return all.size; },
  isRegistered(id: string) { return all.has(id); },
  fromElement(el: any) {
    let dom = el && el.dom ? el.dom : el;
    while (dom && dom.nodeType === 1) { const c = all.get(dom.id); if (c) { return c; } dom = dom.parentNode; }
    return null;
  }
};
Ext.ComponentManager = Ext.ComponentMgr = ComponentManager;
Ext.getCmp = (id: string) => all.get(id);

const idCounters: Record<string, number> = {};
let idSeed = 1000;
function autoId(cmp: any) {
  const x = (cmp.xtype || (cmp.$className || 'component').split('.').pop().toLowerCase());
  idCounters[x] = idCounters[x] || 0;
  return x + '-' + (++idSeed);
}

let zSeed = 19000;
export function nextZ() { zSeed += 10; return zSeed; }

// Collect `listeners` declared on the class bodies along the prototype chain (most-derived last).
function classListeners(cmp: any) {
  const out: any[] = [];
  let p = Object.getPrototypeOf(cmp);
  while (p && p !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(p, 'listeners') && p.listeners) { out.unshift(p.listeners); }
    p = Object.getPrototypeOf(p);
  }
  return out;
}

export const Component: any = define('Ext.Component', {
  mixins: { observable: 'Ext.mixin.Observable' },
  alias: ['widget.component', 'widget.box'],
  isComponent: true,
  baseCls: 'x-component',
  componentCls: null,
  ui: 'default',
  hidden: false,
  disabled: false,
  rendered: false,
  floating: false,
  focusable: false,
  shadow: false,
  hideMode: 'display',
  tplWriteMode: 'overwrite',
  defaultBindProperty: 'html',
  maskOnDisable: true,
  autoDestroy: true,
  autoShow: false,
  border: undefined,
  $uiVersion: 0,

  constructor: function (config?: any) {
    const me = this;
    if (config && config.isComponent) { return config; }
    config = config || {};
    me.$uiSubs = new Set();
    me.$subscribeUI = (cb: () => void) => { me.$uiSubs.add(cb); return () => { me.$uiSubs.delete(cb); }; };
    me.$getUIVersion = () => me.$uiVersion;
    me.$addedCls = [];
    me.$elementListeners = [];
    me.plugins = me.plugins;
    me.initialConfig = config;
    const cfg = Ext.apply({}, config);
    me.$instanceListeners = cfg.listeners;
    delete cfg.listeners;
    me.initConfig(cfg);
    if (!me.id) { me.id = me.autoGenId = autoId(me); me.$autoId = true; }
    ComponentManager.register(me);
    me.$setupViewModel();
    me.$setupController();
    if (me.controller && me.controller.beforeInit) { me.controller.beforeInit(me); }
    me.initComponent();
    me.$attachListeners();
    me.$initState();
    me.$initPlugins();
    if (me.$vm && me.controller && me.controller.initViewModel) { me.controller.initViewModel(me.$vm); }
    if (me.controller && me.controller.init) { me.controller.init(me); }
    if (me.controller && me.controller.$connectRoutes) { me.controller.$connectRoutes(); }
    if (me.controller && me.controller.$attachListen) { me.controller.$attachListen(); }
    if (me.$vm || me.ownerCt) { me.initBindable(); }
    if (me.renderTo) { renderInto(me, me.renderTo); }
    if (me.floating && me.autoShow) { me.show(); }
    return me;
  },

  initComponent: function () {
    // template method: subclasses call callParent
  },

  // ---------------------------------------------------------------- listeners
  $attachListeners: function () {
    const me = this;
    for (const l of classListeners(me)) { me.$addListenerSet(l, true); }
    const inst = me.$instanceListeners;
    if (inst) { me.$addListenerSet(inst, false); }
    // initComponent may have assigned a new listeners object
    const own = Object.prototype.hasOwnProperty.call(me, 'listeners') ? me.listeners : null;
    if (own && own !== inst && classListeners(me).indexOf(own) < 0) { me.$addListenerSet(own, false); }
  },
  $addListenerSet: function (listeners: any, fromClass: boolean) {
    const me = this;
    const shared = {};
    for (const k of ['scope', 'single', 'buffer', 'delay', 'destroyable', 'element', 'delegate', 'args']) { if (k in listeners) { shared[k] = listeners[k]; } }
    for (const name in listeners) {
      if (name in shared) { continue; }
      let v = listeners[name];
      if (v === null || v === undefined) { continue; }
      let opts: any;
      if (typeof v === 'object' && !Ext.isArray(v)) { opts = Ext.apply({}, v, shared); v = v.fn; } else { opts = Ext.apply({}, shared); }
      opts.$fromClass = fromClass;
      me.addListener(name, v, opts.scope, opts);
    }
  },
  addListener: function (ename: any, fn?: any, scope?: any, options?: any, order?: any, caller?: any) {
    const me = this;
    // record where a string handler came from so resolveListenerScope can follow Ext's rules
    const r = me.mixins.observable.addListener.call(me, ename, fn, scope, options, order, caller);
    return r;
  },
  addElementListener: function (element: string, ename: string, fn: any, scope?: any, options?: any) {
    const me = this;
    const entry: any = { element, ename, fn, scope, options: Ext.apply({}, options), d: null };
    delete entry.options.element;
    me.$elementListeners.push(entry);
    if (me.rendered) { me.$bindElementListener(entry); }
    return { destroy: () => { if (entry.d) { entry.d.destroy(); } Ext.Array.remove(me.$elementListeners, entry); } };
  },
  $bindElementListener: function (entry: any) {
    const me = this;
    const el = me[entry.element] || (entry.element === 'el' ? me.el : null);
    if (!el || !el.on) { return; }
    let fn = entry.fn, scope = entry.scope;
    if (typeof fn === 'string') {
      const target = me.resolveListenerScope(scope, { options: entry.options });
      scope = target;
      fn = target && target[fn];
      if (!fn) { console.warn('Element listener "' + entry.fn + '" not found'); return; }
    }
    entry.d = el.on(entry.ename, fn, scope || me, Ext.apply({}, entry.options, { destroyable: true }));
  },
  resolveListenerScope: function (defaultScope?: any, listener?: any) {
    const me = this;
    if (defaultScope && typeof defaultScope === 'object') { return defaultScope; }
    if (defaultScope === 'this' || defaultScope === 'self') { return me; }
    let c = me;
    while (c) {
      if (c.defaultListenerScope === true) { return c; }
      c = c.getRefOwner ? c.getRefOwner() : null;
    }
    const opts = listener && listener.options;
    const ownController = me.controller && me.controller.isViewController;
    if (opts && opts.$fromClass === false && ownController && defaultScope !== 'controller') {
      return me.lookupController(true) || me.controller;
    }
    return me.lookupController(false) || me;
  },

  // ---------------------------------------------------------------- MVVM wiring
  $setupViewModel: function () {
    const me = this;
    const cfg = me.viewModel;
    if (!cfg) { return; }
    let vm;
    if (cfg.isViewModel) { vm = cfg; vm.setView(me); }
    else if (cfg === true) { vm = new (Ext.ClassManager.get('Ext.app.ViewModel'))({ view: me }); }
    else if (typeof cfg === 'string') { vm = Ext.Factory.viewModel({ type: cfg, view: me }); }
    else { vm = Ext.Factory.viewModel(Ext.apply({ view: me }, cfg), 'default'); }
    me.$vm = vm;
    me.viewModel = vm;
  },
  $setupController: function () {
    const me = this;
    const c = me.controller;
    if (!c) { return; }
    let inst;
    if (c.isViewController) { inst = c; }
    else if (typeof c === 'string') { inst = Ext.Factory.controller({ type: c }); }
    else { inst = Ext.Factory.controller(c); }
    inst.setView(me);
    me.controller = inst;
  },
  getViewModel: function () { return this.$vm || null; },
  setViewModel: function (vm: any) { this.viewModel = vm; this.$setupViewModel(); },
  lookupViewModel: function (skipThis?: boolean) {
    let c = skipThis ? this.getRefOwner() : this;
    while (c) { if (c.$vm) { return c.$vm; } c = c.getRefOwner ? c.getRefOwner() : null; }
    return null;
  },
  getController: function () { return this.controller && this.controller.isViewController ? this.controller : null; },
  lookupController: function (skipThis?: boolean) {
    let c = skipThis ? this.getRefOwner() : this;
    while (c) {
      if (c.controller && c.controller.isViewController) { return c.controller; }
      c = c.getRefOwner ? c.getRefOwner() : null;
    }
    return null;
  },
  isReferenceHolder: function () { return !!(this.referenceHolder || (this.controller && this.controller.isViewController)); },
  lookupReferenceHolder: function (skipThis = true) {
    let c = skipThis ? this.getRefOwner() : this;
    while (c) { if (c.isReferenceHolder && c.isReferenceHolder()) { return c; } c = c.getRefOwner ? c.getRefOwner() : null; }
    return null;
  },
  getReferenceHolder: function () { return this.isReferenceHolder() ? this : this.lookupReferenceHolder(); },
  lookupReference: function (ref: string) {
    const holder = this.isReferenceHolder() ? this : this.lookupReferenceHolder();
    if (!holder) { return null; }
    return holder.$findReference(ref);
  },
  lookup: function (ref: string) { return this.lookupReference(ref); },
  $findReference: function (ref: string) {
    // breadth-first over ref items, not descending into nested reference holders
    const queue = this.getRefItems ? this.getRefItems(false).slice() : [];
    const seen = new Set();
    while (queue.length) {
      const c = queue.shift();
      if (!c || seen.has(c) || c.destroyed) { continue; }
      seen.add(c);
      if (c.reference === ref) { return c; }
      if (c.isReferenceHolder && c.isReferenceHolder()) { continue; }
      if (c.getRefItems) { queue.push(...c.getRefItems(false)); }
    }
    return null;
  },
  getReferences: function () {
    const out = {};
    const queue = this.getRefItems ? this.getRefItems(false).slice() : [];
    while (queue.length) {
      const c = queue.shift();
      if (!c) { continue; }
      if (c.reference && !(c.reference in out)) { out[c.reference] = c; }
      if (c.isReferenceHolder && c.isReferenceHolder()) { continue; }
      if (c.getRefItems) { queue.push(...c.getRefItems(false)); }
    }
    return out;
  },

  /** Bindings (bind config) and published values (reference + publishes). */
  initBindable: function () {
    const me = this;
    if (me.$bindInit || me.destroyed) { return; }
    const vm = me.lookupViewModel();
    if (!vm) { return; }
    me.$bindInit = true;
    me.$bindings = [];
    let bind = me.bind;
    if (bind) {
      if (typeof bind === 'string') { bind = { [me.defaultBindProperty]: bind }; }
      for (const prop in bind) {
        const desc = bind[prop];
        if (desc === null || desc === undefined) { continue; }
        const b = vm.bind(desc, (v: any) => me.$applyBound(prop, v), me);
        b.$prop = prop;
        me.$bindings.push(b);
      }
    }
    me.$publishInit(vm);
  },
  $applyBound: function (prop: string, v: any) {
    const me = this;
    if (me.destroyed) { return; }
    me.$applyingBinding = prop;
    try {
      const setter = me['set' + Ext.String.capitalize(prop)];
      if (typeof setter === 'function') { setter.call(me, v); }
      else { me[prop] = v; me.updateUI(); }
    } finally {
      me.$applyingBinding = null;
    }
  },
  getBind: function () {
    const out = {};
    for (const b of this.$bindings || []) { out[b.$prop] = b; }
    return out;
  },
  setBind: function (bind: any) { for (const b of this.$bindings || []) { b.destroy(); } this.bind = bind; this.$bindInit = false; this.initBindable(); },
  /** Two-way: push a changed value back to the bound VM path. */
  $publishBinding: function (prop: string, value: any) {
    const me = this;
    if (me.$applyingBinding === prop) { return; }
    for (const b of me.$bindings || []) { if (b.$prop === prop && !b.isReadOnly()) { b.setValue(value); } }
  },
  $publishInit: function (vm: any) {
    const me = this;
    if (!me.reference) { return; }
    const pubs = me.$publishedProps();
    for (const p of pubs) { me.publishState(p, me.$publishValue(p)); }
  },
  $publishedProps: function () {
    const p = this.publishes;
    if (!p) { return []; }
    if (typeof p === 'string') { return [p]; }
    if (Ext.isArray(p)) { return p; }
    return Object.keys(p);
  },
  $publishValue: function (prop: string) {
    const getter = this['get' + Ext.String.capitalize(prop)];
    return typeof getter === 'function' ? getter.call(this) : this[prop];
  },
  publishState: function (prop: string, value: any) {
    const me = this;
    if (!me.reference) { return; }
    if (me.$publishedProps().indexOf(prop) < 0 && prop !== 'selection' && prop !== 'value') { return; }
    const vm = me.lookupViewModel();
    if (!vm) { return; }
    vm.set(me.reference + '.' + prop, value === undefined ? null : value);
  },

  // ---------------------------------------------------------------- hierarchy
  getRefOwner: function () { return this.ownerCt || this.ownerCmp || this.floatParent || this.$refOwner || null; },
  getRefItems: function () { return this.$menuItems ? this.$menuItems() : []; },
  up: function (selector?: string, limit?: any) {
    let c = this.getRefOwner();
    let depth = 0;
    const max = typeof limit === 'number' ? limit : Infinity;
    while (c && depth < max) {
      if (!selector || is(c, selector)) { return c; }
      if (limit && limit.isComponent && c === limit) { break; }
      c = c.getRefOwner ? c.getRefOwner() : null;
      depth++;
    }
    return null;
  },
  is: function (selector: string) { return is(this, selector); },
  findParentBy: function (fn: any) { let c = this.getRefOwner(); while (c) { if (fn(c, this)) { return c; } c = c.getRefOwner(); } return null; },
  findParentByType: function (xtype: any) { return this.findParentBy((c: any) => (typeof xtype === 'function' ? c instanceof xtype : c.isXType(xtype))); },
  nextSibling: function (selector?: string) {
    const o = this.ownerCt;
    if (!o || !o.items) { return null; }
    const items = o.items.items;
    for (let i = items.indexOf(this) + 1; i < items.length; i++) { if (!selector || is(items[i], selector)) { return items[i]; } }
    return null;
  },
  previousSibling: function (selector?: string) {
    const o = this.ownerCt;
    if (!o || !o.items) { return null; }
    const items = o.items.items;
    for (let i = items.indexOf(this) - 1; i >= 0; i--) { if (!selector || is(items[i], selector)) { return items[i]; } }
    return null;
  },
  next: function (s?: string) { return this.nextSibling(s); },
  prev: function (s?: string) { return this.previousSibling(s); },
  getItemId: function () { return this.itemId || this.id; },
  getId: function () { return this.id; },
  getReference: function () { return this.reference; },
  isDescendantOf: function (container: any) { let c = this.getRefOwner(); while (c) { if (c === container) { return true; } c = c.getRefOwner(); } return false; },
  isAncestor: function (cmp: any) { return cmp && cmp.isDescendantOf ? cmp.isDescendantOf(this) : false; },
  onAdded: function (container: any, pos: number) {
    const me = this;
    me.ownerCt = container;
    me.fireEvent('added', me, container, pos);
    if (!me.$bindInit) { me.initBindable(); }
    // descendants whose view model sits above this container can bind now too
    if (me.getRefItems) { for (const c of query('*', me)) { if (!c.$bindInit) { c.initBindable(); } } }
  },
  onRemoved: function (destroying?: boolean) {
    const me = this;
    me.fireEvent('removed', me, me.ownerCt);
    me.ownerCt = null;
    void destroying;
  },
  getInherited: function () { return this; },
  getInheritedConfig: function (name: string, skipThis?: boolean) {
    let c = skipThis ? this.getRefOwner() : this;
    while (c) { if (c[name] !== undefined) { return c[name]; } c = c.getRefOwner ? c.getRefOwner() : null; }
    return undefined;
  },

  // ---------------------------------------------------------------- rendering contract
  updateUI: function () { if (!this.destroyed || this.rendered) { markDirty(this); } },
  updateLayout: function () { this.updateUI(); return this; },
  doLayout: function () { this.updateUI(); return this; },
  doComponentLayout: function () { return this; },
  $notifyUI: function () { this.$uiVersion++; for (const cb of Array.from(this.$uiSubs) as any[]) { cb(); } },
  $ref: function (name: string) {
    const me = this;
    me.$refCbs = me.$refCbs || {};
    if (!me.$refCbs[name]) {
      me.$refCbs[name] = (dom: any) => { me[name] = dom ? Ext.get(dom) : null; };
    }
    return me.$refCbs[name];
  },
  /** Root element of the component; subclasses usually override renderContent / getRootProps only. */
  $renderUI: function (ref: any) {
    this.$lastRenderRef = ref;
    return this.renderRoot(ref);
  },
  renderRoot: function (ref: any) {
    const me = this;
    const props = me.getRootProps(ref);
    const content = me.renderContent();
    const Tag: any = me.renderTag || 'div';
    if (content === undefined || content === null) {
      const h = me.$htmlContent();
      if (h !== null) { return <Tag {...props} dangerouslySetInnerHTML={html(h)} />; }
      return <Tag {...props} />;
    }
    return <Tag {...props}>{content}</Tag>;
  },
  renderContent: function () { return null; },
  $htmlContent: function () {
    const me = this;
    if (me.tpl && me.data !== undefined && me.data !== null) {
      const tpl = me.getTpl('tpl');
      return tpl ? tpl.apply(me.data) : '';
    }
    if (me.html !== undefined && me.html !== null) { return Ext.isArray(me.html) ? me.html.join('') : me.html; }
    return null;
  },
  getTpl: function (name: string) { return Ext.XTemplate.getTpl(this, name); },
  getRootCls: function () {
    const me = this;
    return clsList(
      me.baseCls, me.componentCls, me.ui && me.baseCls && me.ui !== 'default' ? me.baseCls + '-' + me.ui : null,
      me.cls, me.userCls, me.$addedCls,
      me.disabled ? 'x-item-disabled' : null, me.disabled && me.disabledCls ? me.disabledCls : null,
      me.hidden ? 'x-hidden-' + (me.hideMode || 'display') : null,
      me.floating ? 'x-layer' : null,
      me.$ownerLayoutCls ? me.$ownerLayoutCls() : null,
      me.extraCls ? me.extraCls() : null,
      me.$overCls
    );
  },
  getRootStyle: function () {
    const me = this;
    const st: any = styleObject(me.style);
    const w = sizeValue(me.width), h = sizeValue(me.height);
    if (w !== undefined) { st.width = w; }
    if (h !== undefined) { st.height = h; }
    if (me.minWidth) { st.minWidth = sizeValue(me.minWidth); }
    if (me.maxWidth) { st.maxWidth = sizeValue(me.maxWidth); }
    if (me.minHeight) { st.minHeight = sizeValue(me.minHeight); }
    if (me.maxHeight) { st.maxHeight = sizeValue(me.maxHeight); }
    const m = boxValue(me.margin);
    if (m !== undefined) { st.margin = m; }
    if (me.padding !== undefined && me.$paddingOnRoot !== false) { const p = boxValue(me.padding); if (p !== undefined) { st.padding = p; } }
    const scroll = me.$rootScroll ? me.$rootScroll() : me.scrollable;
    if (scroll === true || scroll === 'both' || scroll === 'auto') { st.overflow = 'auto'; }
    else if (scroll === 'y' || scroll === 'vertical') { st.overflowY = 'auto'; st.overflowX = 'hidden'; }
    else if (scroll === 'x' || scroll === 'horizontal') { st.overflowX = 'auto'; st.overflowY = 'hidden'; }
    if (me.ownerCt && me.ownerCt.$childLayoutStyle && !me.isDocked && me.ownerCt.items && me.ownerCt.items.contains && me.ownerCt.items.contains(me)) { Object.assign(st, me.ownerCt.$childLayoutStyle(me)); }
    if (me.floating) {
      st.position = 'absolute';
      st.left = (me.x || 0) + 'px';
      st.top = (me.y || 0) + 'px';
      st.zIndex = me.$zIndex || 19000;
      if (me.$positionPending) { st.visibility = 'hidden'; }
    }
    if (me.hidden) { applyHidden(me, st); }
    return st;
  },
  getRootProps: function (ref: any) {
    const me = this;
    const props: any = { ref, id: me.id, className: me.getRootCls(), style: me.getRootStyle() };
    if (me.tooltip && typeof me.tooltip === 'string' && !me.$tooltipOnChild) { props['data-qtip'] = me.tooltip; }
    if (me.ariaRole) { props.role = me.ariaRole; }
    if (me.tabIndex !== undefined && me.focusable) { props.tabIndex = me.tabIndex; }
    if (me.$extraRootProps) { Object.assign(props, me.$extraRootProps()); }
    return props;
  },

  // ---------------------------------------------------------------- mount life cycle (called by CmpView)
  $afterMount: function (dom: any) {
    const me = this;
    if (me.destroyed) { return; }
    me.el = Ext.get(dom);
    me.rendered = true;
    for (const e of me.$elementListeners) { if (!e.d) { me.$bindElementListener(e); } }
    if (!me.$renderedOnce) {
      me.$renderedOnce = true;
      if (!me.$bindInit) { me.initBindable(); }
      if (me.onRender) { me.onRender(); }
      me.fireEvent('render', me);
      if (me.afterRender) { me.afterRender(); }
      me.fireEvent('afterrender', me);
      me.$observeSize(dom);
    }
    if (me.$pendingMask !== undefined) { const m = me.$pendingMask; me.$pendingMask = undefined; if (m !== null) { me.mask(m.msg, m.cls); } }
    if (me.$pendingFocus) { const f = me.$pendingFocus; me.$pendingFocus = null; setTimeout(() => me.focus(f.selectText), f.delay || 0); }
    if (me.floating && me.$afterFloatingMount) { me.$afterFloatingMount(); }
  },
  $afterUpdate: function () {
    const me = this;
    if (me.floating && me.$afterFloatingUpdate) { me.$afterFloatingUpdate(); }
    if (me.afterUIUpdate) { me.afterUIUpdate(); }
  },
  $beforeUnmount: function () {
    const me = this;
    for (const e of me.$elementListeners) { if (e.d) { e.d.destroy(); e.d = null; } }
    if (me.$ro) { me.$ro.disconnect(); me.$ro = null; }
    me.rendered = false;
    me.$renderedOnce = me.destroyed ? me.$renderedOnce : me.$renderedOnce;
  },
  $observeSize: function (dom: any) {
    const me = this;
    if (typeof ResizeObserver === 'undefined' || !dom) {
      setTimeout(() => { if (!me.destroyed && !me.$boxReady) { me.$boxReady = true; me.fireEvent('boxready', me, dom ? dom.offsetWidth : 0, dom ? dom.offsetHeight : 0); } }, 0);
      return;
    }
    me.$ro = new ResizeObserver(() => {
      if (me.destroyed || !me.el) { return; }
      const w = me.el.dom.offsetWidth, h = me.el.dom.offsetHeight;
      if (!w && !h) { return; }
      if (!me.$boxReady) {
        me.$boxReady = true;
        me.$lastSize = [w, h];
        me.fireEvent('boxready', me, w, h);
        me.fireEvent('resize', me, w, h);
        return;
      }
      const [ow, oh] = me.$lastSize || [0, 0];
      if (ow !== w || oh !== h) { me.$lastSize = [w, h]; me.fireEvent('resize', me, w, h, ow, oh); }
    });
    me.$ro.observe(dom);
  },
  getEl: function () {
    if (isPending(this) || !this.el) { flushRender(); }
    return this.el || null;
  },
  getContentTarget: function () { return this.getEl(); },
  getFocusEl: function () { return this.getEl(); },
  isRendered: function () { return !!this.rendered; },

  // ---------------------------------------------------------------- visibility / state
  setHidden: function (hidden: boolean) { return hidden ? this.hide() : this.show(); },
  setVisible: function (v: boolean) { return this.setHidden(!v); },
  isHidden: function () { return !!this.hidden; },
  isVisible: function (deep?: boolean) {
    const me = this;
    if (me.hidden || me.destroyed) { return false; }
    if (!me.rendered) { flushRender(); }
    if (!me.rendered) { return false; }
    if (deep) {
      let c = me.floating ? null : me.ownerCt;
      while (c) {
        if (c.hidden || !c.rendered || (c.collapsed && c !== me && me.$isInBodyOf && me.$isInBodyOf(c))) { return false; }
        c = c.floating ? null : c.ownerCt;
      }
    }
    return true;
  },
  show: function () {
    const me = this;
    if (me.floating) { return me.$showFloating ? me.$showFloating() : me; }
    if (!me.hidden) { return me; }
    if (me.fireEvent('beforeshow', me) === false) { return me; }
    me.hidden = false;
    me.updateUI();
    if (me.ownerCt && me.ownerCt.onChildVisibilityChange) { me.ownerCt.onChildVisibilityChange(me); }
    me.fireEvent('show', me);
    return me;
  },
  hide: function () {
    const me = this;
    if (me.floating) { return me.$hideFloating ? me.$hideFloating() : me; }
    if (me.hidden) { return me; }
    if (me.fireEvent('beforehide', me) === false) { return me; }
    me.hidden = true;
    me.updateUI();
    if (me.ownerCt && me.ownerCt.onChildVisibilityChange) { me.ownerCt.onChildVisibilityChange(me); }
    me.fireEvent('hide', me);
    return me;
  },
  setDisabled: function (d: boolean) { return d ? this.disable() : this.enable(); },
  disable: function (silent?: boolean) {
    const me = this;
    if (me.disabled) { return me; }
    me.disabled = true;
    if (me.onDisable) { me.onDisable(); }
    me.updateUI();
    if (!silent) { me.fireEvent('disable', me); }
    return me;
  },
  enable: function (silent?: boolean) {
    const me = this;
    if (!me.disabled) { return me; }
    me.disabled = false;
    if (me.onEnable) { me.onEnable(); }
    me.updateUI();
    if (!silent) { me.fireEvent('enable', me); }
    return me;
  },
  isDisabled: function () { return !!this.disabled; },
  addCls: function (cls: any) {
    const me = this;
    let changed = false;
    for (const c of Ext.Array.from(cls)) { for (const p of String(c || '').split(/\s+/)) { if (p && me.$addedCls.indexOf(p) < 0) { me.$addedCls.push(p); changed = true; } } }
    if (changed) { me.updateUI(); }
    return me;
  },
  removeCls: function (cls: any) {
    const me = this;
    let changed = false;
    for (const c of Ext.Array.from(cls)) {
      for (const p of String(c || '').split(/\s+/)) {
        if (!p) { continue; }
        const i = me.$addedCls.indexOf(p);
        if (i >= 0) { me.$addedCls.splice(i, 1); changed = true; }
        if (typeof me.cls === 'string' && (' ' + me.cls + ' ').indexOf(' ' + p + ' ') >= 0) { me.cls = (' ' + me.cls + ' ').replace(' ' + p + ' ', ' ').trim(); changed = true; }
      }
    }
    if (changed) { me.updateUI(); }
    return me;
  },
  hasCls: function (cls: string) { return this.$addedCls.indexOf(cls) >= 0 || (' ' + clsList(this.cls, this.userCls) + ' ').indexOf(' ' + cls + ' ') >= 0; },
  toggleCls: function (cls: string, state?: boolean) { if (state === undefined) { state = !this.hasCls(cls); } return state ? this.addCls(cls) : this.removeCls(cls); },
  setCls: function (cls: string) { this.cls = cls; this.updateUI(); },
  setUserCls: function (cls: string) { this.userCls = cls; this.updateUI(); },
  setStyle: function (prop: any, value?: any) {
    const st = Object.assign(styleObject(this.style), typeof prop === 'object' ? styleObject(prop) : { [String(prop).replace(/-([a-z])/g, (m, c) => c.toUpperCase())]: value });
    this.style = st;
    this.updateUI();
    return this;
  },
  setWidth: function (w: any) { this.width = w; this.updateUI(); return this; },
  setHeight: function (h: any) { this.height = h; this.updateUI(); return this; },
  setSize: function (w: any, h?: any) { if (w && typeof w === 'object') { h = w.height; w = w.width; } if (w !== undefined) { this.width = w; } if (h !== undefined) { this.height = h; } this.updateUI(); return this; },
  getWidth: function () { const el = this.getEl(); return el ? el.dom.offsetWidth : (typeof this.width === 'number' ? this.width : 0); },
  getHeight: function () { const el = this.getEl(); return el ? el.dom.offsetHeight : (typeof this.height === 'number' ? this.height : 0); },
  getSize: function () { return { width: this.getWidth(), height: this.getHeight() }; },
  setMargin: function (m: any) { this.margin = m; this.updateUI(); },
  setPadding: function (p: any) { this.padding = p; this.updateUI(); },
  setMinWidth: function (v: any) { this.minWidth = v; this.updateUI(); },
  setMinHeight: function (v: any) { this.minHeight = v; this.updateUI(); },
  setMaxWidth: function (v: any) { this.maxWidth = v; this.updateUI(); },
  setMaxHeight: function (v: any) { this.maxHeight = v; this.updateUI(); },
  setFlex: function (f: number) { this.flex = f; this.updateUI(); },
  setScrollable: function (s: any) { this.scrollable = s; this.updateUI(); },
  getScrollable: function () {
    const me = this;
    const target = () => (me.$scrollEl ? me.$scrollEl() : me.getEl());
    return {
      isScroller: true,
      scrollBy: (x: any, y?: any) => { const el = target(); if (!el) { return; } if (Ext.isArray(x)) { y = x[1]; x = x[0]; } if (x && typeof x === 'object') { y = x.y; x = x.x; } el.dom.scrollLeft += x || 0; el.dom.scrollTop += y || 0; },
      scrollTo: (x: any, y?: any) => { const el = target(); if (!el) { return; } if (x && typeof x === 'object') { y = x.y; x = x.x; } if (x !== null && x !== undefined) { el.dom.scrollLeft = x === Infinity ? el.dom.scrollWidth : x; } if (y !== null && y !== undefined) { el.dom.scrollTop = y === Infinity ? el.dom.scrollHeight : y; } },
      getPosition: () => { const el = target(); return el ? { x: el.dom.scrollLeft, y: el.dom.scrollTop } : { x: 0, y: 0 }; },
      getSize: () => { const el = target(); return el ? { x: el.dom.scrollWidth, y: el.dom.scrollHeight } : { x: 0, y: 0 }; },
      getMaxPosition: () => { const el = target(); return el ? { x: el.dom.scrollWidth - el.dom.clientWidth, y: el.dom.scrollHeight - el.dom.clientHeight } : { x: 0, y: 0 }; },
      scrollIntoView: (el: any) => { const d = el && el.dom ? el.dom : el; if (d && d.scrollIntoView) { d.scrollIntoView({ block: 'nearest' }); } },
      getElement: () => target(),
      on: (...a: any[]) => { const el = target(); if (el && a[0] === 'scroll') { el.on('scroll', a[1], a[2]); } },
      un: Ext.emptyFn
    };
  },

  // ---------------------------------------------------------------- content
  setHtml: function (h: any) { this.html = h; this.updateUI(); return this; },
  getHtml: function () { return this.html; },
  update: function (htmlOrData: any) {
    const me = this;
    if (me.tpl && !Ext.isString(htmlOrData)) { me.data = htmlOrData; } else { me.html = Ext.isObject(htmlOrData) && htmlOrData.html !== undefined ? htmlOrData.html : htmlOrData; }
    me.updateUI();
    return me;
  },
  setData: function (d: any) { this.data = d; this.updateUI(); return this; },
  getData: function () { return this.data; },
  setTpl: function (t: any) { this.tpl = t; this.updateUI(); },
  setTooltip: function (t: any) { this.tooltip = t; this.updateUI(); return this; },
  setUi: function (ui: string) { this.ui = ui; this.updateUI(); },
  setRegion: function (r: string) { this.region = r; if (this.ownerCt) { this.ownerCt.updateUI(); } },

  // ---------------------------------------------------------------- masks / focus
  mask: function (msg?: any, msgCls?: string) {
    const me = this;
    if (msg && typeof msg === 'object') { msgCls = msg.msgCls; msg = msg.msg; }
    if (!me.rendered) { me.$pendingMask = { msg, cls: msgCls }; return null; }
    const target = me.$maskTarget ? me.$maskTarget() : me.el;
    me.$masked = true;
    return target ? target.mask(msg, msgCls) : null;
  },
  unmask: function () {
    const me = this;
    me.$pendingMask = undefined;
    if (!me.rendered) { return; }
    const target = me.$maskTarget ? me.$maskTarget() : me.el;
    me.$masked = false;
    if (target) { target.unmask(); }
  },
  isMasked: function () { return !!this.$masked; },
  setLoading: function (load: any, targetEl?: any) {
    void targetEl;
    if (load === false || load === null || load === undefined) { this.unmask(); return null; }
    const msg = typeof load === 'string' ? load : (load && load.msg) || 'Loading...';
    return this.mask(msg);
  },
  focus: function (selectText?: any, delay?: any) {
    const me = this;
    if (typeof delay === 'number' && delay > 0) { setTimeout(() => { if (!me.destroyed) { me.focus(selectText); } }, delay); return me; }
    if (!me.rendered) { me.$pendingFocus = { selectText, delay: 0 }; return me; }
    const el = me.getFocusEl();
    if (el && el.dom && el.dom.focus) {
      el.dom.focus({ preventScroll: false });
      if (selectText && el.dom.select) { el.dom.select(); }
    }
    return me;
  },
  blur: function () { const el = this.getFocusEl(); if (el && el.dom && el.dom.blur) { el.dom.blur(); } return this; },
  hasFocus: function () { const el = this.el; return !!(el && el.dom && (el.dom === document.activeElement || el.dom.contains(document.activeElement))); },
  containsFocus: function () { return this.hasFocus(); },
  isFocusable: function () { return !!this.focusable && !this.disabled && !this.hidden; },

  // ---------------------------------------------------------------- positioning (floating and general)
  setPosition: function (x: any, y?: any) {
    const me = this;
    if (Ext.isArray(x)) { y = x[1]; x = x[0]; }
    if (x && typeof x === 'object') { y = x.y; x = x.x; }
    if (x !== undefined && x !== null) { me.x = Math.round(x); }
    if (y !== undefined && y !== null) { me.y = Math.round(y); }
    me.updateUI();
    me.fireEvent('move', me, me.x, me.y);
    return me;
  },
  setXY: function (xy: number[]) { return this.setPosition(xy[0], xy[1]); },
  setX: function (x: number) { return this.setPosition(x, this.y); },
  setY: function (y: number) { return this.setPosition(this.x, y); },
  getXY: function () { const el = this.getEl(); if (el) { return el.getXY(); } return [this.x || 0, this.y || 0]; },
  getX: function () { return this.getXY()[0]; },
  getY: function () { return this.getXY()[1]; },
  getPosition: function (local?: boolean) { void local; return this.floating ? [this.x || 0, this.y || 0] : this.getXY(); },
  getBox: function () { const el = this.getEl(); return el ? el.getBox() : { x: this.x || 0, y: this.y || 0, width: this.width || 0, height: this.height || 0 }; },
  getRegion: function () { const el = this.getEl(); return el ? el.getRegion() : null; },
  alignTo: function (target: any, position?: string, offsets?: number[]) {
    const me = this;
    const el = me.getEl();
    let tb: any;
    if (target && target.isComponent) { target = target.getEl(); }
    if (Ext.isArray(target) && typeof target[0] === 'number') { tb = { x: target[0], y: target[1], width: 0, height: 0 }; }
    else { const t = Ext.get(target); tb = t ? t.getBox() : { x: 0, y: 0, width: 0, height: 0 }; }
    const size = el ? { width: el.dom.offsetWidth, height: el.dom.offsetHeight } : { width: sizeNum(me.width), height: sizeNum(me.height) };
    const xy = alignXY(size, tb, position, offsets);
    return me.setPosition(xy[0], xy[1]);
  },
  center: function () {
    const me = this;
    const el = me.getEl();
    const w = el ? el.dom.offsetWidth : sizeNum(me.width), h = el ? el.dom.offsetHeight : sizeNum(me.height);
    return me.setPosition(Math.max(0, Math.round((window.innerWidth - w) / 2)), Math.max(0, Math.round((window.innerHeight - h) / 2)));
  },
  isFloating: function () { return !!this.floating; },

  // ---------------------------------------------------------------- plugins
  $initPlugins: function () {
    const me = this;
    const cfgs = me.plugins;
    if (!cfgs) { me.plugins = []; return; }
    const list = [];
    for (let p of Ext.Array.from(cfgs)) {
      if (!p) { continue; }
      if (typeof p === 'string') { p = { ptype: p }; }
      let inst;
      if (p.isPlugin || p.init) { inst = p; }
      else {
        const cfg = Ext.apply({}, p);
        const type = cfg.ptype || cfg.type;
        delete cfg.ptype;
        const cls = Ext.ClassManager.getByAlias('plugin.' + type) || Ext.ClassManager.get(type);
        if (!cls) { console.warn('Unknown plugin type "' + type + '"'); continue; }
        inst = new cls(cfg);
      }
      list.push(inst);
    }
    me.plugins = list;
    for (const pl of list) { pl.cmp = me; if (pl.init) { pl.init(me); } }
  },
  getPlugin: function (id: string) { return (this.plugins || []).find((p: any) => p.pluginId === id || p.id === id) || null; },
  findPlugin: function (ptype: string) { return (this.plugins || []).find((p: any) => p.ptype === ptype || (p.isXType && p.isXType(ptype))) || null; },
  getPlugins: function () { return (this.plugins || []).slice(); },
  addPlugin: function (p: any) { const old = this.plugins; this.plugins = [p]; this.$initPlugins(); this.plugins = (old || []).concat(this.plugins); return this.plugins[this.plugins.length - 1]; },
  removePlugin: function (p: any) { Ext.Array.remove(this.plugins, p); if (p.destroy) { p.destroy(); } },

  // ---------------------------------------------------------------- state
  getStateId: function () { return this.stateId || null; },
  $initState: function () {
    const me = this;
    if (!me.stateful || !me.getStateId()) { return; }
    const state = Ext.state && Ext.state.Manager ? Ext.state.Manager.get(me.getStateId()) : null;
    if (state && me.fireEvent('beforestaterestore', me, state) !== false) {
      try { me.applyState(state); } catch (e) { console.warn('Could not restore state of ' + me.getStateId(), e); }
      me.fireEvent('staterestore', me, state);
    }
    const events = me.stateEvents || [];
    for (const ev of events) { me.on(ev, me.$scheduleSaveState, me); }
  },
  $scheduleSaveState: function () {
    const me = this;
    if (me.$saveTimer) { clearTimeout(me.$saveTimer); }
    me.$saveTimer = setTimeout(() => { me.$saveTimer = null; if (!me.destroyed) { me.saveState(); } }, me.saveDelay === undefined ? 100 : me.saveDelay);
  },
  saveState: function () {
    const me = this;
    if (!me.stateful || !me.getStateId()) { return; }
    const state = me.getState();
    if (state && me.fireEvent('beforestatesave', me, state) !== false) {
      Ext.state.Manager.set(me.getStateId(), state);
      me.fireEvent('statesave', me, state);
    }
  },
  getState: function () { return null; },
  applyState: function (state: any) { if (state) { Ext.apply(this, state); } },
  addStateEvents: function (events: any) { this.stateEvents = (this.stateEvents || []).concat(Ext.Array.from(events)); for (const e of Ext.Array.from(events)) { this.on(e, this.$scheduleSaveState, this); } },

  // ---------------------------------------------------------------- destroy
  destroy: function () {
    const me = this;
    if (me.destroyed || me.destroying) { return; }
    if (me.fireEvent('beforedestroy', me) === false) { return; }
    me.destroying = true;
    if (me.onDestroy) { me.onDestroy(); }
    me.doDestroy();
    me.fireEvent('destroy', me);
    me.destroyObservable();
    me.destroyed = true;
    me.isDestroyed = true;
    me.destroying = false;
    me.updateUI();
  },
  doDestroy: function () {
    const me = this;
    if (me.$saveTimer) { clearTimeout(me.$saveTimer); }
    if (me.ownerCt && !me.ownerCt.destroying && me.ownerCt.$detach) { me.ownerCt.$detach(me); }
    if (me.floating) { removeFloating(me); }
    for (const p of me.plugins || []) { if (p && p.destroy) { try { p.destroy(); } catch (e) { /* ignore */ } } }
    for (const b of me.$bindings || []) { b.destroy(); }
    if (me.controller && me.controller.isViewController) { me.controller.destroy(); }
    if (me.$vm) { me.$vm.destroy(); }
    for (const e of me.$elementListeners) { if (e.d) { e.d.destroy(); } }
    if (me.$ro) { me.$ro.disconnect(); }
    if (me.$ownRoot) { const r = me.$ownRoot; me.$ownRoot = null; setTimeout(() => r.unmount(), 0); }
    if (me.$topLevel && Ext.$removeTopLevel) { Ext.$removeTopLevel(me); }
    ComponentManager.unregister(me);
  },
  isDestroyed: false,
  statics: {
    fromElement: (el: any) => ComponentManager.fromElement(el)
  }
});

/** Ext hide modes: display (default), visibility, offsets (kept laid out, moved off screen; tab cards use it). */
export function applyHidden(cmp: any, st: any) {
  const mode = cmp.hideMode || 'display';
  if (mode === 'offsets') { st.position = 'absolute'; st.left = '-10000px'; st.top = '-10000px'; if (st.display === 'none') { delete st.display; } }
  else if (mode === 'visibility') { st.visibility = 'hidden'; }
  else { st.display = 'none'; }
}
function sizeNum(v: any) { return typeof v === 'number' ? v : parseInt(v, 10) || 0; }

Ext.suspendLayouts = Ext.emptyFn;
Ext.resumeLayouts = Ext.emptyFn;
Ext.batchLayouts = (fn: any, scope?: any) => fn.call(scope);
Ext.updateLayout = Ext.emptyFn;

// Ext.Widget (lightweight component) maps onto Component
define('Ext.Widget', { extend: 'Ext.Component', alias: 'widget.widget' });
define('Ext.Img', { extend: 'Ext.Component', alias: ['widget.image', 'widget.imagecomponent'], baseCls: 'x-img', renderTag: 'img',
  $extraRootProps: function () { return { src: this.src, alt: this.alt || '' }; }, setSrc: function (s: string) { this.src = s; this.updateUI(); } });
define('Ext.form.Label', { extend: 'Ext.Component', alias: 'widget.label', baseCls: 'x-form-item-label', renderTag: 'label',
  $htmlContent: function () { return this.html !== undefined ? this.html : Ext.String.htmlEncode(this.text || ''); }, setText: function (t: string) { this.text = t; this.updateUI(); } });

export default Component;
