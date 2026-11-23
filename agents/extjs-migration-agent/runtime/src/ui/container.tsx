/**
 * Ext.container.Container, Ext.container.Viewport and the container layouts, implemented with CSS flexbox:
 * auto, fit, card, hbox, vbox, anchor, form, column, border (regions, split bars, collapsed placeholders),
 * absolute and center. Items keep Ext semantics: defaults, defaultType, fieldDefaults inheritance,
 * add / insert / remove / removeAll with before/after events, child / down / query, card setActiveItem.
 */
import * as React from 'react';
import { Ext } from '../core/ext';
import { define } from '../core/class';
import { Collection } from '../util/collection';
import { Component } from './component';
import { renderCmps, boxValue, sizeValue, clsList, addTopLevel, removeTopLevel, CmpView } from './render';
import { query, is } from './componentquery';

Ext.$removeTopLevel = removeTopLevel;

// ---------------------------------------------------------------- layouts
function marginPx(m: any) {
  const v = boxValue(m);
  if (!v) { return [0, 0, 0, 0]; }
  const p = v.split(' ').map((x) => parseFloat(x) || 0);
  if (p.length === 1) { return [p[0], p[0], p[0], p[0]]; }
  if (p.length === 2) { return [p[0], p[1], p[0], p[1]]; }
  if (p.length === 3) { return [p[0], p[1], p[2], p[1]]; }
  return p;
}

const ALIGN: Record<string, string> = { stretch: 'stretch', stretchmax: 'stretch', middle: 'center', center: 'center', top: 'flex-start', left: 'flex-start', begin: 'flex-start', start: 'flex-start', bottom: 'flex-end', right: 'flex-end', end: 'flex-end' };
const PACK: Record<string, string> = { start: 'flex-start', begin: 'flex-start', center: 'center', middle: 'center', end: 'flex-end', justify: 'space-between' };

export const Layout: any = define('Ext.layout.container.Container', {
  alias: ['layout.auto', 'layout.autocontainer'],
  type: 'auto',
  isLayout: true,
  constructor: function (config?: any) { Ext.apply(this, config); return this; },
  setOwner: function (o: any) { this.owner = o; },
  getOwner: function () { return this.owner; },
  targetCls: function () { return 'x-layout-' + this.type; },
  targetStyle: function () { return {}; },
  childStyle: function (item: any) { void item; return {}; },
  childCls: function () { return null; },
  renderItems: function (items: any[]) { return renderCmps(items); },
  getLayoutItems: function () { return this.owner ? this.owner.items.getRange() : []; },
  onAdd: Ext.emptyFn,
  onRemove: Ext.emptyFn
});

define('Ext.layout.container.Fit', {
  extend: 'Ext.layout.container.Container',
  alias: 'layout.fit',
  type: 'fit',
  targetStyle: function () { return { display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, minWidth: 0 }; },
  childStyle: function () { return { flex: '1 1 auto', minHeight: 0, minWidth: 0, width: 'auto', height: 'auto', alignSelf: 'stretch' }; }
});

define('Ext.layout.container.Card', {
  extend: 'Ext.layout.container.Fit',
  alias: 'layout.card',
  type: 'card',
  deferredRender: false,
  activeItem: undefined,
  getActiveItem: function () {
    const o = this.owner;
    if (!o) { return null; }
    if (this.$active && !this.$active.destroyed && o.items.contains(this.$active)) { return this.$active; }
    const visible = o.items.items.find((c: any) => !c.hidden);
    return visible || null;
  },
  setActiveItem: function (item: any) {
    const me = this, o = me.owner;
    if (typeof item === 'number' || typeof item === 'string') { item = o.getComponent(item); }
    if (!item) { return null; }
    const old = me.getActiveItem();
    if (item === old && !item.hidden) { return item; }
    if (o.fireEvent('beforeactivate', o, item, old) === false) { return null; }
    me.$active = item;
    for (const c of o.items.items) {
      if (c === item) { c.hidden = false; c.$cardRendered = true; } else if (!c.hidden) { c.hidden = true; c.updateUI(); c.fireEvent('deactivate', c); c.fireEvent('hide', c); }
    }
    item.updateUI();
    o.updateUI();
    item.fireEvent('activate', item);
    item.fireEvent('show', item);
    return item;
  },
  next: function () { const o = this.owner; const i = o.items.indexOf(this.getActiveItem()); return this.setActiveItem(o.items.getAt(i + 1)); },
  prev: function () { const o = this.owner; const i = o.items.indexOf(this.getActiveItem()); return this.setActiveItem(o.items.getAt(i - 1)); },
  getNext: function () { const o = this.owner; return o.items.getAt(o.items.indexOf(this.getActiveItem()) + 1); },
  getPrev: function () { const o = this.owner; return o.items.getAt(o.items.indexOf(this.getActiveItem()) - 1); },
  renderItems: function (items: any[]) {
    const deferred = this.deferredRender || (this.owner && this.owner.deferredRender);
    const active = this.getActiveItem();
    return renderCmps(items.filter((c: any) => !deferred || c === active || c.$cardRendered || c.rendered));
  },
  onAdd: function (item: any) {
    // newly added cards are hidden unless they become active
    const active = this.getActiveItem();
    if (active && active !== item) { item.hidden = true; }
  }
});

function boxLayout(alias: string, dir: 'row' | 'column') {
  return define('Ext.layout.container.' + (dir === 'row' ? 'HBox' : 'VBox'), {
    extend: 'Ext.layout.container.Container',
    alias: [alias],
    type: dir === 'row' ? 'hbox' : 'vbox',
    align: 'begin',
    pack: 'start',
    targetStyle: function () {
      const st: any = { display: 'flex', flexDirection: dir, alignItems: ALIGN[this.align] || 'flex-start', justifyContent: PACK[this.pack] || 'flex-start', minWidth: 0, minHeight: 0 };
      if (this.padding !== undefined) { st.padding = boxValue(this.padding); }
      if (this.overflow !== 'visible') { st.overflow = 'hidden'; }
      return st;
    },
    childStyle: function (item: any) {
      const st: any = {};
      if (item.flex) {
        st.flex = item.flex + ' 1 0px';
        if (dir === 'row') { st.minWidth = item.minWidth ? sizeValue(item.minWidth) : 0; if (item.width === undefined) { st.width = 'auto'; } }
        else { st.minHeight = item.minHeight ? sizeValue(item.minHeight) : 0; if (item.height === undefined) { st.height = 'auto'; } }
      } else {
        st.flex = '0 0 auto';
      }
      if (this.align === 'stretch' || this.align === 'stretchmax') {
        st.alignSelf = 'stretch';
        if (dir === 'column' && item.width === undefined) { st.width = 'auto'; }
        if (dir === 'row' && item.height === undefined) { st.height = 'auto'; }
      }
      return st;
    }
  });
}
boxLayout('layout.hbox', 'row');
boxLayout('layout.vbox', 'column');
define('Ext.layout.container.Box', { extend: 'Ext.layout.container.HBox', alias: 'layout.box' });

define('Ext.layout.container.Anchor', {
  extend: 'Ext.layout.container.Container',
  alias: 'layout.anchor',
  type: 'anchor',
  defaultAnchor: null,
  targetStyle: function () { return { display: 'block' }; },
  childStyle: function (item: any) {
    const st: any = {};
    let anchor = item.anchor !== undefined ? item.anchor : this.defaultAnchor;
    if (anchor === undefined && this.owner && this.owner.defaultAnchor) { anchor = this.owner.defaultAnchor; }
    if (anchor) {
      const [w, h] = String(anchor).split(/\s+/);
      const m = marginPx(item.margin);
      const conv = (a: string, extra: number) => {
        if (!a) { return undefined; }
        if (/%$/.test(a)) { return extra ? 'calc(' + a + ' - ' + extra + 'px)' : a; }
        const n = parseFloat(a);
        if (n < 0) { return 'calc(100% - ' + (-n + extra) + 'px)'; }
        return undefined;
      };
      const ww = conv(w, m[1] + m[3]);
      if (ww && item.width === undefined) { st.width = ww; }
      const hh = conv(h, m[0] + m[2]);
      if (hh && item.height === undefined) { st.height = hh; }
    }
    return st;
  }
});
define('Ext.layout.container.Form', { extend: 'Ext.layout.container.Anchor', alias: 'layout.form', type: 'form', defaultAnchor: '100%' });

define('Ext.layout.container.Column', {
  extend: 'Ext.layout.container.Container',
  alias: 'layout.column',
  type: 'column',
  targetStyle: function () { return { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start' }; },
  childStyle: function (item: any) {
    if (item.columnWidth) {
      const m = marginPx(item.margin);
      const lr = m[1] + m[3];
      return { flex: '0 0 auto', width: lr ? 'calc(' + (item.columnWidth * 100) + '% - ' + lr + 'px)' : (item.columnWidth * 100) + '%' };
    }
    return { flex: '0 0 auto' };
  }
});

define('Ext.layout.container.Absolute', {
  extend: 'Ext.layout.container.Anchor',
  alias: 'layout.absolute',
  type: 'absolute',
  targetStyle: function () { return { position: 'relative' }; },
  childStyle: function (item: any) { return Ext.apply(this.callParent([item]), { position: 'absolute', left: (item.x || 0) + 'px', top: (item.y || 0) + 'px' }); }
});
define('Ext.layout.container.Center', {
  extend: 'Ext.layout.container.Container',
  alias: 'layout.center',
  type: 'center',
  targetStyle: function () { return { display: 'flex', alignItems: 'center', justifyContent: 'center' }; }
});

// ---- border layout
const REGION_ORDER: Record<string, number> = { north: 0, south: 0, west: 1, east: 1, center: 2 };
function regionOf(c: any) { return c.region || 'center'; }

function Splitter({ item, vertical, owner }: any) {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const el = item.getEl();
    const startW = el ? el.dom.offsetWidth : item.width, startH = el ? el.dom.offsetHeight : item.height;
    const region = regionOf(item);
    const bar = (e.currentTarget as HTMLElement);
    bar.classList.add('x-splitter-active');
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (vertical) {
        let w = region === 'west' ? startW + dx : startW - dx;
        w = Math.max(item.minWidth || 50, Math.min(item.maxWidth || 2000, w));
        item.width = w;
      } else {
        let h = region === 'north' ? startH + dy : startH - dy;
        h = Math.max(item.minHeight || 40, Math.min(item.maxHeight || 2000, h));
        item.height = h;
      }
      item.updateUI();
    };
    const up = () => {
      bar.classList.remove('x-splitter-active');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      item.fireEvent('resize', item, item.getWidth(), item.getHeight());
      owner.fireEvent('resize', owner, owner.getWidth(), owner.getHeight());
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  return <div className={clsList('x-splitter', vertical ? 'x-splitter-vertical' : 'x-splitter-horizontal', 'x-border-splitter')} onMouseDown={onMouseDown}
    style={vertical ? { width: 5, flex: '0 0 5px', cursor: 'col-resize' } : { height: 5, flex: '0 0 5px', cursor: 'row-resize' }} />;
}

function CollapsedPlaceholder({ item }: any) {
  const region = regionOf(item);
  const vertical = region === 'west' || region === 'east';
  const expand = () => item.expand();
  const title = item.title || '';
  return (
    <div className={clsList('x-region-collapsed-placeholder', 'x-region-collapsed-' + region + '-placeholder', 'x-panel-header', 'x-header', vertical ? 'x-header-vertical' : 'x-header-horizontal', item.cls)}
      style={vertical ? { width: 28, flex: '0 0 28px', cursor: item.titleCollapse ? 'pointer' : 'default' } : { height: 32, flex: '0 0 32px', cursor: item.titleCollapse ? 'pointer' : 'default' }}
      onClick={() => { if (item.titleCollapse !== false) { expand(); } }}>
      <div className="x-tool x-tool-expand" role="button" title="Expand panel" onClick={(e) => { e.stopPropagation(); expand(); }}>
        <span className={'x-tool-tool-el x-fa ' + (region === 'west' ? 'fa-angle-right' : region === 'east' ? 'fa-angle-left' : region === 'north' ? 'fa-angle-down' : 'fa-angle-up')} />
      </div>
      {title ? <div className={clsList('x-title', vertical ? 'x-title-rotate-' + (region === 'west' ? 'left' : 'right') : null)}>
        {item.iconCls ? <span className={'x-title-icon ' + item.iconCls} /> : null}
        <span className="x-title-text" dangerouslySetInnerHTML={{ __html: title }} />
      </div> : null}
    </div>
  );
}

define('Ext.layout.container.Border', {
  extend: 'Ext.layout.container.Container',
  alias: 'layout.border',
  type: 'border',
  targetStyle: function () { return { display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, minWidth: 0 }; },
  childStyle: function (item: any) {
    const r = regionOf(item);
    if (r === 'center') { return { flex: '1 1 0px', minWidth: 0, minHeight: 0, width: 'auto', height: 'auto' }; }
    if (r === 'north' || r === 'south') { return { flex: '0 0 auto', width: 'auto', minHeight: 0 }; }
    return { flex: '0 0 auto', height: 'auto', minWidth: 0 };
  },
  childCls: function (item: any) { return 'x-border-item x-region-' + regionOf(item); },
  renderItems: function (items: any[]) {
    const owner = this.owner;
    const by = (r: string) => items.filter((c: any) => regionOf(c) === r);
    const piece = (c: any, beforeSplit: boolean, vertical: boolean) => {
      const out: any[] = [];
      const hiddenReg = c.hidden && !c.collapsed;
      if (c.collapsed && c.collapsible !== false) {
        out.push(<CollapsedPlaceholder key={c.id + '-ph'} item={c} />);
        out.push(...renderCmps([c]).map((el: any) => React.cloneElement(el, { key: c.id })));
        return out;
      }
      const split = c.split && !hiddenReg ? <Splitter key={c.id + '-split'} item={c} vertical={vertical} owner={owner} /> : null;
      if (split && !beforeSplit) { out.push(split); }
      out.push(<CmpView key={c.id} cmp={c} />);
      if (split && beforeSplit) { out.push(split); }
      return out;
    };
    const north = by('north'), south = by('south'), west = by('west'), east = by('east'), center = by('center');
    void REGION_ORDER;
    return [
      ...north.flatMap((c: any) => piece(c, true, false)),
      <div key="$middle" className="x-border-middle" style={{ display: 'flex', flexDirection: 'row', flex: '1 1 0px', minHeight: 0, minWidth: 0, alignItems: 'stretch' }}>
        {west.flatMap((c: any) => piece(c, true, true))}
        {center.map((c: any) => <CmpView key={c.id} cmp={c} />)}
        {east.flatMap((c: any) => piece(c, false, true))}
      </div>,
      ...south.flatMap((c: any) => piece(c, false, false))
    ];
  }
});

// ---------------------------------------------------------------- Container
const SPECIAL = new Set(['->', '-', ' ', '|']);

export const Container: any = define('Ext.container.Container', {
  extend: 'Ext.Component',
  alias: 'widget.container',
  isContainer: true,
  baseCls: 'x-container',
  layout: 'auto',
  defaultType: 'panel',
  autoDestroy: true,
  deferredRender: false,

  initComponent: function () {
    const me = this;
    me.callParent();
    me.$initLayout();
    me.initItems();
  },

  $initLayout: function () {
    const me = this;
    let l = me.layout;
    if (l && l.isLayout) { me.$layout = l; }
    else {
      if (typeof l === 'string') { l = { type: l }; }
      l = Ext.apply({}, l);
      const type = l.type || 'auto';
      const cls = Ext.ClassManager.getByAlias('layout.' + type) || Ext.ClassManager.getByAlias('layout.auto');
      delete l.type;
      me.$layout = new cls(l);
    }
    me.$layout.setOwner(me);
    if (me.activeItem !== undefined && me.$layout.type === 'card') { me.$layout.$initialActive = me.activeItem; }
  },
  getLayout: function () { if (!this.$layout) { this.$initLayout(); } return this.$layout; },
  setLayout: function (l: any) { this.layout = l; this.$initLayout(); this.updateUI(); },

  initItems: function () {
    const me = this;
    const cfg = me.items;
    me.items = new Collection();
    if (cfg !== undefined && cfg !== null) {
      me.$initialAdd = true;
      me.add(Ext.isArray(cfg) ? cfg : (cfg.isCollection ? cfg.items : [cfg]));
      me.$initialAdd = false;
    }
    if (me.$layout && me.$layout.type === 'card') {
      let first = me.$layout.$initialActive;
      if (first === undefined) { first = 0; }
      const target = typeof first === 'object' && first ? first : me.items.get(first) || me.items.getAt(typeof first === 'number' ? first : 0);
      me.items.each((c: any) => { if (c !== target) { c.hidden = true; } else { c.hidden = false; c.$cardRendered = true; } });
      me.$layout.$active = target || null;
    }
  },

  // ---- fieldDefaults inheritance
  $fieldDefaults: function () {
    const own = this.fieldDefaults;
    const inherited = this.$inheritedFieldDefaults;
    if (!own && !inherited) { return null; }
    return Ext.apply({}, own, inherited);
  },

  /** Turns an item config (or shorthand) into a component instance owned by this container. */
  lookupComponent: function (cfg: any) {
    const me = this;
    if (cfg && cfg.isComponent) { return cfg; }
    if (typeof cfg === 'string') { return me.$specialItem ? me.$specialItem(cfg) : Ext.widget('component', { html: cfg }); }
    cfg = Ext.apply({}, cfg);
    const defaults = typeof me.defaults === 'function' ? me.defaults(cfg) : me.defaults;
    if (defaults) { Ext.applyIf(cfg, defaults); }
    if (!cfg.xtype && !cfg.xclass) { cfg.xtype = cfg.$defaultType || me.$childDefaultType(cfg); }
    const cls = cfg.xclass ? Ext.ClassManager.get(cfg.xclass) : Ext.ClassManager.getByAlias('widget.' + cfg.xtype);
    if (!cls) { throw new Error('Unknown xtype "' + cfg.xtype + '" in ' + me.$className); }
    const fd = me.$fieldDefaults();
    if (fd) {
      if (cls.prototype.isFieldLabelable) {
        // fieldDefaults never override values set on the item or its class
        // Ext applies fieldDefaults unless the item's own config sets the same option
        for (const k in fd) { if (cfg[k] === undefined) { cfg[k] = fd[k]; } }
      }
      cfg.$inheritedFieldDefaults = fd;
    }
    return cfg.xclass ? new cls(cfg) : Ext.widget(cfg.xtype, cfg);
  },
  $childDefaultType: function () { return this.defaultType; },

  add: function (...args: any[]) {
    const me = this;
    let index = me.items ? me.items.getCount() : 0;
    let list: any[];
    if (typeof args[0] === 'number' && args.length > 1) { index = args[0]; list = Ext.Array.from(args[1]); }
    else if (args.length === 1) { list = Ext.isArray(args[0]) ? args[0] : [args[0]]; }
    else { list = args; }
    const added = [];
    for (const raw of list) {
      if (raw === null || raw === undefined || raw === false) { continue; }
      const item = me.lookupComponent(raw);
      if (!item) { continue; }
      if (item.ownerCt && item.ownerCt !== me) { item.ownerCt.remove(item, false); }
      if (me.fireEvent('beforeadd', me, item, index) === false) { continue; }
      if (me.items.contains(item)) { continue; }
      me.items.insert(index, item);
      if (me.$layout && me.$layout.onAdd) { me.$layout.onAdd(item, index); }
      if (me.onBeforeAdd) { me.onBeforeAdd(item); }
      item.onAdded(me, index, !!me.$initialAdd);
      if (me.onAdd) { me.onAdd(item, index); }
      me.fireEvent('add', me, item, index);
      added.push(item);
      index++;
    }
    me.updateUI();
    return args.length === 1 && !Ext.isArray(args[0]) ? added[0] : (typeof args[0] === 'number' && !Ext.isArray(args[1]) ? added[0] : added);
  },
  insert: function (index: number, items: any) { return this.add(index, items); },
  move: function (from: any, to: number) {
    const item = typeof from === 'number' ? this.items.getAt(from) : from;
    this.items.remove(item);
    this.items.insert(to, item);
    this.updateUI();
    this.fireEvent('childmove', this, item, from, to);
    return item;
  },
  moveBefore: function (item: any, before: any) { return this.move(item, before ? this.items.indexOf(before) : this.items.getCount()); },
  moveAfter: function (item: any, after: any) { return this.move(item, after ? this.items.indexOf(after) + 1 : 0); },
  remove: function (item: any, autoDestroy?: any) {
    const me = this;
    const c = typeof item === 'string' || typeof item === 'number' ? me.getComponent(item) : item;
    if (!c || !me.items.contains(c)) { return c; }
    if (typeof autoDestroy === 'object' && autoDestroy) { autoDestroy = autoDestroy.destroy; }
    const destroy = autoDestroy === undefined ? me.autoDestroy : !!autoDestroy;
    if (me.fireEvent('beforeremove', me, c) === false) { return null; }
    me.$detach(c, destroy);
    if (destroy) { c.destroy(); }
    return c;
  },
  /** Removes a child without destroying it (also used by a child that is being destroyed). */
  $detach: function (c: any, destroying?: boolean) {
    const me = this;
    if (!me.items || !me.items.contains(c)) {
      if (me.$detachOther) { me.$detachOther(c); }
      return;
    }
    const wasActive = me.$layout && me.$layout.type === 'card' && me.$layout.getActiveItem() === c;
    me.items.remove(c);
    if (me.$layout && me.$layout.$active === c) { me.$layout.$active = null; }
    if (me.$layout && me.$layout.onRemove) { me.$layout.onRemove(c); }
    c.onRemoved(!!destroying);
    if (me.onRemove) { me.onRemove(c, !!destroying); }
    me.fireEvent('remove', me, c);
    if (wasActive && me.onActiveItemRemoved) { me.onActiveItemRemoved(c); }
    me.updateUI();
  },
  removeAll: function (autoDestroy?: boolean) {
    const me = this;
    const items = me.items.getRange();
    for (const c of items) { me.remove(c, autoDestroy); }
    return items;
  },
  getComponent: function (comp: any) {
    const me = this;
    if (comp === undefined || comp === null) { return undefined; }
    if (comp.isComponent) { return me.items.contains(comp) ? comp : undefined; }
    if (typeof comp === 'number') { return me.items.getAt(comp); }
    return me.items.items.find((c: any) => c.itemId === comp || c.id === comp) || undefined;
  },
  getRefItems: function () {
    const me = this;
    const out = me.items ? me.items.items.slice() : [];
    if (me.$extraRefItems) { out.push(...me.$extraRefItems()); }
    return out;
  },
  child: function (selector?: string) {
    const items = this.getRefItems(false);
    if (!selector) { return items[0] || null; }
    if (selector.charAt(0) === '#' && /^#[\w\-.]+$/.test(selector)) { const id = selector.substr(1); return items.find((c: any) => c.itemId === id || c.id === id) || null; }
    return items.find((c: any) => is(c, selector)) || null;
  },
  down: function (selector?: any) {
    if (selector && selector.isComponent) { return selector.isDescendantOf(this) ? selector : null; }
    return query(selector || '*', this)[0] || null;
  },
  query: function (selector?: string) { return query(selector || '*', this); },
  queryBy: function (fn: any, scope?: any) { return query('*', this).filter((c: any) => fn.call(scope || c, c) !== false); },
  queryById: function (id: string) { return query('*', this).find((c: any) => c.id === id || c.itemId === id) || null; },
  contains: function (cmp: any, deep?: boolean) { return deep === false ? this.items.contains(cmp) : !!cmp && cmp.isDescendantOf && cmp.isDescendantOf(this); },
  getActiveItem: function () { return this.$layout && this.$layout.getActiveItem ? this.$layout.getActiveItem() : this.items.first(); },
  setActiveItem: function (item: any) { return this.$layout && this.$layout.setActiveItem ? this.$layout.setActiveItem(item) : null; },
  onChildVisibilityChange: function () { /* CSS handles reflow */ },

  // ---- rendering
  $childLayoutStyle: function (child: any) { return this.$layout ? this.$layout.childStyle(child) : {}; },
  $layoutChildCls: function (child: any) { return this.$layout && this.$layout.childCls ? this.$layout.childCls(child) : null; },
  getLayoutTargetProps: function () {
    const me = this;
    const l = me.getLayout();
    return { className: clsList(l.targetCls()), style: l.targetStyle() };
  },
  renderItemsUI: function () {
    const me = this;
    return me.getLayout().renderItems(me.items ? me.items.items : []);
  },
  renderRoot: function (ref: any) {
    const me = this;
    const props = me.getRootProps(ref);
    const t = me.getLayoutTargetProps();
    props.className = clsList(props.className, t.className);
    props.style = Object.assign({}, t.style, props.style);
    const h = me.$htmlContent();
    return (
      <div {...props}>
        {h !== null ? <div className="x-autocontainer-innerCt" dangerouslySetInnerHTML={{ __html: h }} /> : null}
        {me.renderItemsUI()}
      </div>
    );
  },

  doDestroy: function () {
    const me = this;
    if (me.items && me.items.getRange) {
      for (const c of me.items.getRange()) { c.destroy(); }
    }
    me.callParent();
  }
});
define('Ext.container.Monitor', {});

// child classes used by layouts
Component.prototype.$ownerLayoutCls = function () {
  const o = this.ownerCt;
  if (!o || !o.$layoutChildCls || this.isDocked || !(o.items && o.items.contains && o.items.contains(this))) { return null; }
  return o.$layoutChildCls(this);
};

// ---------------------------------------------------------------- Viewport
define('Ext.container.Viewport', {
  extend: 'Ext.container.Container',
  alias: 'widget.viewport',
  isViewport: true,
  baseCls: 'x-viewport',
  layout: 'fit',
  initComponent: function () {
    this.callParent();
    this.$topLevel = true;
    addTopLevel(this);
    document.documentElement.classList.add('x-viewport');
    document.body.classList.add('x-body', 'x-border-box');
  },
  getRootStyle: function () {
    const st = this.callParent();
    return Object.assign(st, { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, width: 'auto', height: 'auto' });
  }
});
define('Ext.plugin.Viewport', { alias: 'plugin.viewport', init: function (c: any) { c.$topLevel = true; addTopLevel(c); } });

export default Container;
