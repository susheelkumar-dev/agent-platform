/**
 * Ext.panel.Panel with Ext.panel.Header, Ext.panel.Title and Ext.panel.Tool: header (title, icon, tools,
 * custom header items), docked items (dockedItems, tbar, bbar, lbar, rbar, fbar, buttons), body (layout target
 * with bodyPadding/bodyStyle/bodyCls, html/tpl), collapse / expand (also as a border-layout region),
 * close / closeAction and masking of the body.
 */
import * as React from 'react';
import { Ext } from '../core/ext';
import { define } from '../core/class';
import { Collection } from '../util/collection';
import { clsList, boxValue, styleObject, renderCmps, CmpView, flushRender } from './render';
import { query } from './componentquery';
import './container';
import { applyHidden } from './component';

const TOOL_ICONS: Record<string, string> = {
  close: 'fa-times', minimize: 'fa-window-minimize', maximize: 'fa-expand', restore: 'fa-compress', toggle: 'fa-chevron-down',
  gear: 'fa-cog', prev: 'fa-angle-left', next: 'fa-angle-right', pin: 'fa-thumbtack', unpin: 'fa-thumbtack', right: 'fa-chevron-right',
  left: 'fa-chevron-left', down: 'fa-chevron-down', up: 'fa-chevron-up', refresh: 'fa-sync-alt', plus: 'fa-plus', minus: 'fa-minus',
  search: 'fa-search', save: 'fa-save', help: 'fa-question', print: 'fa-print', expand: 'fa-angle-down', collapse: 'fa-angle-up',
  'collapse-top': 'fa-angle-up', 'collapse-bottom': 'fa-angle-down', 'collapse-left': 'fa-angle-left', 'collapse-right': 'fa-angle-right',
  'expand-top': 'fa-angle-down', 'expand-bottom': 'fa-angle-up', 'expand-left': 'fa-angle-right', 'expand-right': 'fa-angle-left',
  'resize': 'fa-expand-arrows-alt', 'report': 'fa-file-alt', 'move': 'fa-arrows-alt', 'unselectall': 'fa-square', 'selectall': 'fa-check-square'
};

// ---------------------------------------------------------------- Tool
define('Ext.panel.Tool', {
  extend: 'Ext.Component',
  alias: 'widget.tool',
  baseCls: 'x-tool',
  focusable: true,
  type: null,
  getRootCls: function () { return clsList(this.callParent(), this.type ? 'x-tool-' + this.type : null); },
  $extraRootProps: function () {
    const me = this;
    return { role: 'button', tabIndex: me.disabled ? -1 : 0, 'data-qtip': me.tooltip || undefined, onClick: (e: any) => me.$onToolClick(e) };
  },
  renderContent: function () {
    const icon = this.iconCls || ('x-fa ' + (TOOL_ICONS[this.type] || 'fa-circle'));
    return <span className={clsList('x-tool-tool-el', 'x-tool-img', icon)} />;
  },
  $onToolClick: function (re: any) {
    const me = this;
    if (me.disabled) { return; }
    re.stopPropagation();
    const e = new Ext.event.Event(re.nativeEvent);
    const owner = me.toolOwner || (me.ownerCt && me.ownerCt.ownerCt) || me.ownerCt;
    if (me.fireEvent('click', me, e, owner) === false) { return; }
    if (me.handler) { Ext.callback(me.handler, me.scope, [e, me.el ? me.el.dom : null, me.ownerCt, me], 0, me); }
    if (me.callback) { Ext.callback(me.callback, me.scope, [owner, me, e], 0, me); }
  },
  setType: function (t: string) { this.type = t; this.updateUI(); },
  setIconCls: function (c: string) { this.iconCls = c; this.updateUI(); }
});

// ---------------------------------------------------------------- Title
define('Ext.panel.Title', {
  extend: 'Ext.Component',
  alias: 'widget.title',
  baseCls: 'x-title',
  text: '',
  renderContent: function () {
    const me = this;
    return [
      me.iconCls || me.icon ? <span key="i" className={clsList('x-title-icon-wrap')}><span className={clsList('x-title-icon', me.iconCls)} style={me.icon ? { backgroundImage: 'url(' + me.icon + ')' } : undefined} /></span> : null,
      <span key="t" className="x-title-text" dangerouslySetInnerHTML={{ __html: me.text === undefined || me.text === null ? '' : String(me.text) }} />
    ];
  },
  setText: function (t: string) { this.text = t; this.updateUI(); },
  setIconCls: function (c: string) { this.iconCls = c; this.updateUI(); }
});

// ---------------------------------------------------------------- Header
define('Ext.panel.Header', {
  extend: 'Ext.container.Container',
  alias: 'widget.header',
  isHeader: true,
  baseCls: 'x-panel-header',
  defaultType: 'tool',
  layout: { type: 'hbox', align: 'middle' },
  titlePosition: 0,
  initComponent: function () {
    const me = this;
    const items = Ext.Array.from(me.items).slice();
    me.items = [];
    me.callParent();
    me.titleCmp = me.add({ xtype: 'title', text: me.title, iconCls: me.iconCls, icon: me.icon, flex: 1, itemId: 'title' });
    for (const t of me.tools || []) { me.add(Ext.apply({ xtype: 'tool', toolOwner: me.ownerPanel }, t)); }
    if (items.length) { me.add(items); }
    me.$sortTools();
  },
  $sortTools: function () {
    // custom header items sit after the title, standard tools (close, maximize ...) at the far right
    const me = this;
    const tools = me.items.items.filter((c: any) => c.isXType('tool'));
    const others = me.items.items.filter((c: any) => !c.isXType('tool') && c !== me.titleCmp);
    me.items.items = [me.titleCmp].concat(others, tools.sort((a: any, b: any) => (a.weight || 0) - (b.weight || 0)));
    me.items.$reindex();
  },
  addTool: function (tools: any) {
    const me = this;
    const added = me.add(Ext.Array.from(tools).map((t: any) => Ext.apply({ xtype: 'tool', toolOwner: me.ownerPanel }, t)));
    me.$sortTools();
    return added;
  },
  getTools: function () { return this.items.items.filter((c: any) => c.isXType('tool')); },
  setTitle: function (t: string) { this.title = t; if (this.titleCmp) { this.titleCmp.setText(t); } },
  setIconCls: function (c: string) { this.iconCls = c; if (this.titleCmp) { this.titleCmp.setIconCls(c); } },
  getRootCls: function () {
    const me = this;
    return clsList(me.callParent(), 'x-header', 'x-docked', 'x-docked-top', 'x-panel-header-default', me.ownerPanel && me.ownerPanel.isWindow ? 'x-window-header x-window-header-default' : null);
  },
  $extraRootProps: function () {
    const me = this;
    const p = me.ownerPanel;
    const props: any = {};
    if (p && (p.titleCollapse && p.collapsible)) { props.onClick = (e: any) => { if (!e.target.closest('.x-tool, .x-btn, .x-form-item')) { p.toggleCollapse(); } }; }
    if (p && p.isWindow && p.draggable !== false) { props.onMouseDown = (e: any) => p.$startDrag(e); props.onDoubleClick = (e: any) => { if (p.maximizable && !e.target.closest('.x-tool, .x-btn')) { p.toggleMaximize(); } }; }
    return props;
  }
});

function dockOf(c: any) { return c.dock || 'top'; }

// ---------------------------------------------------------------- Panel
export const Panel: any = define('Ext.panel.Panel', {
  extend: 'Ext.container.Container',
  alias: 'widget.panel',
  isPanel: true,
  baseCls: 'x-panel',
  title: undefined,
  header: undefined,
  collapsible: false,
  collapsed: false,
  titleCollapse: false,
  hideCollapseTool: false,
  closable: false,
  closeAction: 'destroy',
  buttonAlign: 'right',
  bodyBorder: undefined,
  frame: false,

  initComponent: function () {
    const me = this;
    me.callParent();
    me.$initDockedItems();
    me.$initHeader();
  },

  $initDockedItems: function () {
    const me = this;
    const cfg = me.dockedItems;
    me.dockedItems = new Collection();
    const list: any[] = [];
    const bar = (items: any, dock: string, extra?: any) => {
      if (!items) { return; }
      let cfgBar;
      if (Ext.isArray(items)) { cfgBar = { xtype: 'toolbar', items }; }
      else if (items.isComponent) { cfgBar = items; }
      else { cfgBar = Ext.apply({ xtype: 'toolbar' }, items); }
      if (!cfgBar.isComponent) { cfgBar.dock = dock; Ext.applyIf(cfgBar, extra); } else { cfgBar.dock = dock; }
      list.push(cfgBar);
    };
    bar(me.tbar, 'top');
    bar(me.lbar, 'left', { vertical: true });
    for (const d of Ext.Array.from(cfg)) { if (d) { list.push(d); } }
    bar(me.bbar, 'bottom');
    bar(me.rbar, 'right', { vertical: true });
    let fbar = me.fbar || me.buttons;
    if (fbar) {
      if (Ext.isArray(fbar)) { fbar = { items: fbar }; }
      fbar = Ext.apply({ xtype: 'toolbar', ui: 'footer', cls: 'x-panel-footer', $isFooter: true }, fbar);
      const items = Ext.Array.from(fbar.items).slice();
      if (me.buttonAlign !== 'left' && items[0] !== '->') { items.unshift(me.buttonAlign === 'center' ? '->' : '->'); if (me.buttonAlign === 'center') { items.push('->'); } }
      fbar.items = items.map((i: any) => (i && typeof i === 'object' && !i.isComponent && !i.xtype && me.minButtonWidth ? Ext.applyIf(i, { minWidth: me.minButtonWidth }) : i));
      bar(fbar, 'bottom');
    }
    me.addDocked(list);
  },
  addDocked: function (items: any, pos?: number) {
    const me = this;
    const added = [];
    let i = pos === undefined ? me.dockedItems.getCount() : pos;
    for (const raw of Ext.Array.from(items)) {
      const c = me.$lookupDocked(raw);
      c.dock = c.dock || 'top';
      c.isDocked = true;
      me.dockedItems.insert(i++, c);
      c.onAdded(me, i);
      me.fireEvent('dockedadd', me, c);
      added.push(c);
    }
    me.updateUI();
    return added;
  },
  $lookupDocked: function (raw: any) {
    if (raw && raw.isComponent) { return raw; }
    const cfg = Ext.apply({}, raw);
    if (!cfg.xtype && !cfg.xclass) { cfg.xtype = 'toolbar'; }
    return cfg.xclass ? Ext.create(cfg.xclass, cfg) : Ext.widget(cfg.xtype, cfg);
  },
  removeDocked: function (item: any, autoDestroy = true) {
    const me = this;
    if (!me.dockedItems.contains(item)) { return; }
    me.dockedItems.remove(item);
    item.onRemoved(autoDestroy);
    if (autoDestroy) { item.destroy(); }
    me.updateUI();
  },
  getDockedItems: function (selector?: string, beforeBody?: boolean) {
    const me = this;
    let list = me.dockedItems ? me.dockedItems.items.slice() : [];
    if (me.$header) { list = [me.$header].concat(list); }
    if (beforeBody !== undefined) { list = list.filter((c: any) => (dockOf(c) === 'top' || dockOf(c) === 'left') === !!beforeBody); }
    if (selector) {
      const all = new Set(query(selector, me));
      list = list.filter((c: any) => all.has(c) || (selector.indexOf('[dock=') >= 0 && Ext.ComponentQuery.is(c, selector)));
    }
    return list;
  },
  getDockedComponent: function (id: any) {
    if (typeof id === 'number') { return this.dockedItems.getAt(id); }
    return this.dockedItems.items.find((c: any) => c.itemId === id || c.id === id) || null;
  },
  $detachOther: function (c: any) {
    if (this.dockedItems && this.dockedItems.contains(c)) { this.dockedItems.remove(c); this.updateUI(); }
    if (this.$header === c) { this.$header = null; this.updateUI(); }
  },
  $extraRefItems: function () {
    const me = this;
    const out = [];
    if (me.$header) { out.push(me.$header); }
    if (me.dockedItems && me.dockedItems.items) { out.push(...me.dockedItems.items); }
    return out;
  },
  getRefItems: function () {
    const me = this;
    const docked = me.dockedItems && me.dockedItems.items ? me.dockedItems.items : [];
    const before = docked.filter((c: any) => dockOf(c) === 'top' || dockOf(c) === 'left');
    const after = docked.filter((c: any) => dockOf(c) === 'bottom' || dockOf(c) === 'right');
    const items = me.items && me.items.items ? me.items.items : [];
    return (me.$header ? [me.$header] : []).concat(before, items, after, me.$moreRefItems ? me.$moreRefItems() : []);
  },

  // ---- header
  $wantsHeader: function () {
    const me = this;
    if (me.header === false || me.preventHeader || me.$hideHeaderForOwner) { return false; }
    return !!(me.title || me.iconCls || (me.tools && me.tools.length) || (me.header && typeof me.header === 'object') || me.collapsible || (me.closable && !me.$inTabPanel()) || me.isWindow);
  },
  $inTabPanel: function () { return !!(this.ownerCt && this.ownerCt.isTabPanel); },
  $initHeader: function () {
    const me = this;
    if (me.$header) { me.$header.destroy(); me.$header = null; }
    if (!me.$wantsHeader()) { return; }
    const hcfg = me.header && typeof me.header === 'object' && !me.header.isComponent ? Ext.apply({}, me.header) : {};
    const tools = (me.tools || []).map((t: any) => (typeof t === 'string' ? { type: t } : t)).slice();
    if (me.collapsible && !me.hideCollapseTool && !me.$isBorderRegion()) {
      tools.push({ type: me.collapsed ? 'expand' : 'collapse', itemId: 'collapseTool', weight: 90, tooltip: me.collapsed ? 'Expand panel' : 'Collapse panel', handler: () => me.toggleCollapse() });
    } else if (me.collapsible && !me.hideCollapseTool && me.$isBorderRegion()) {
      const r = me.region;
      tools.push({ type: 'collapse-' + (r === 'west' ? 'left' : r === 'east' ? 'right' : r === 'north' ? 'top' : 'bottom'), itemId: 'collapseTool', weight: 90, tooltip: 'Collapse panel', handler: () => me.collapse() });
    }
    if (me.$extraTools) { tools.push(...me.$extraTools()); }
    if (me.closable && !me.$inTabPanel()) { tools.push({ type: 'close', itemId: 'closeTool', weight: 100, tooltip: 'Close', handler: () => me.close() }); }
    hcfg.tools = tools;
    hcfg.title = me.title;
    hcfg.iconCls = me.iconCls;
    hcfg.icon = me.icon;
    hcfg.ownerPanel = me;
    hcfg.dock = 'top';
    me.$header = Ext.widget('header', hcfg);
    me.$header.ownerCt = me;
    me.$header.isDocked = true;
  },
  $isBorderRegion: function () { return !!(this.region && this.ownerCt && this.ownerCt.$layout && this.ownerCt.$layout.type === 'border'); },
  onAdded: function (container: any, pos: number, initial?: boolean) {
    const me = this;
    me.callParent([container, pos, initial]);
    // tab panels hide their children's headers; border regions use region collapse tools
    const want = me.$wantsHeader();
    if (!!me.$header !== want) { me.$initHeader(); }
    else if (me.$header && me.collapsible && me.$isBorderRegion()) {
      const t = me.$header.down('#collapseTool');
      const r = me.region;
      if (t) { t.setType('collapse-' + (r === 'west' ? 'left' : r === 'east' ? 'right' : r === 'north' ? 'top' : 'bottom')); t.handler = () => me.collapse(); }
    }
  },
  getHeader: function () { return this.$header || null; },
  setTitle: function (title: string) {
    const me = this;
    const old = me.title;
    me.title = title;
    if (me.$header) { me.$header.setTitle(title); } else if (title && me.$wantsHeader()) { me.$initHeader(); }
    me.updateUI();
    me.fireEvent('titlechange', me, title, old);
    return me;
  },
  getTitle: function () { return this.title; },
  setIconCls: function (cls: string) {
    const me = this;
    const old = me.iconCls;
    me.iconCls = cls;
    if (me.$header) { me.$header.setIconCls(cls); }
    me.updateUI();
    me.fireEvent('iconchange', me, cls, old);
    return me;
  },
  setIcon: function (icon: string) { this.icon = icon; this.updateUI(); return this; },
  setGlyph: function () { return this; },
  addTool: function (tools: any) { if (!this.$header) { this.tools = (this.tools || []).concat(Ext.Array.from(tools)); this.$initHeader(); this.updateUI(); return; } return this.$header.addTool(tools); },
  getTools: function () { return this.$header ? this.$header.getTools() : []; },

  // ---- collapse
  collapse: function (direction?: string) {
    const me = this;
    if (me.collapsed) { return me; }
    if (me.fireEvent('beforecollapse', me, direction, false) === false) { return me; }
    me.collapsed = true;
    me.$syncCollapseTool();
    me.updateUI();
    if (me.ownerCt) { me.ownerCt.updateUI(); }
    me.fireEvent('collapse', me);
    return me;
  },
  expand: function () {
    const me = this;
    if (!me.collapsed) { return me; }
    if (me.fireEvent('beforeexpand', me, false) === false) { return me; }
    me.collapsed = false;
    me.$syncCollapseTool();
    me.updateUI();
    if (me.ownerCt) { me.ownerCt.updateUI(); }
    me.fireEvent('expand', me);
    return me;
  },
  toggleCollapse: function () { return this.collapsed ? this.expand() : this.collapse(); },
  setCollapsed: function (c: boolean) { return c ? this.collapse() : this.expand(); },
  getCollapsed: function () { return this.collapsed; },
  isCollapsed: function () { return !!this.collapsed; },
  $syncCollapseTool: function () {
    const t = this.$header && this.$header.down('#collapseTool');
    if (t && !this.$isBorderRegion()) { t.setType(this.collapsed ? 'expand' : 'collapse'); t.tooltip = this.collapsed ? 'Expand panel' : 'Collapse panel'; }
  },

  // ---- close
  close: function () {
    const me = this;
    if (me.fireEvent('beforeclose', me) === false) { return; }
    me.doClose();
  },
  doClose: function () {
    const me = this;
    me.fireEvent('close', me);
    if (me.closeAction === 'hide') { me.hide(); } else { me.destroy(); }
  },
  setClosable: function (c: boolean) { this.closable = c; this.$initHeader(); this.updateUI(); if (this.tab) { this.tab.setClosable(c); } },

  // ---- body content
  setHtml: function (h: any) { this.html = h; this.updateUI(); return this; },
  setBodyStyle: function (s: any) { this.bodyStyle = s; this.updateUI(); },
  setBodyPadding: function (p: any) { this.bodyPadding = p; this.updateUI(); },
  $maskTarget: function () { return this.body || this.el; },
  $scrollEl: function () { flushRender(); return this.body || this.el; },
  $rootScroll: function () { return null; },

  // ---- rendering
  getRootCls: function () {
    const me = this;
    return clsList(me.callParent(), me.baseCls + '-default', me.frame ? me.baseCls + '-framed' : null, me.collapsed ? 'x-collapsed x-panel-collapsed' : null, me.$header ? null : 'x-panel-noheader',
      me.border === false ? 'x-noborder-trbl' : null);
  },
  getRootStyle: function () {
    const me = this;
    const st = me.callParent();
    st.display = (me.collapsed && me.$isBorderRegion()) ? 'none' : 'flex';
    if (me.hidden) { applyHidden(me, st); if (st.display === undefined) { st.display = 'flex'; } }
    st.flexDirection = 'column';
    if (st.overflow === undefined && st.overflowY === undefined) { st.overflow = 'hidden'; }
    delete st.overflowX; delete st.overflowY;
    if (me.$isBorderRegion() && me.collapsed) { st.display = 'none'; }
    return st;
  },
  getBodyProps: function () {
    const me = this;
    const t = me.getLayoutTargetProps();
    const st: any = Object.assign({}, t.style, styleObject(me.bodyStyle));
    const pad = boxValue(me.bodyPadding);
    if (pad !== undefined) { st.padding = pad; }
    const scroll = me.scrollable === undefined ? me.autoScroll : me.scrollable;
    if (scroll === true || scroll === 'both' || scroll === 'auto') { st.overflow = 'auto'; }
    else if (scroll === 'y' || scroll === 'vertical') { st.overflowY = 'auto'; st.overflowX = 'hidden'; }
    else if (scroll === 'x' || scroll === 'horizontal') { st.overflowX = 'auto'; st.overflowY = 'hidden'; }
    else if (st.overflow === undefined) { st.overflow = 'hidden'; }
    st.flex = '1 1 auto';
    st.minHeight = 0;
    st.minWidth = 0;
    st.position = 'relative';
    if (me.collapsed && !me.$isBorderRegion()) { st.display = 'none'; }
    return {
      ref: me.$ref('body'),
      className: clsList(me.baseCls + '-body', me.baseCls + '-body-default', me.bodyCls, t.className, me.bodyBorder === false || me.border === false ? 'x-noborder-trbl' : null, me.$bodyExtraCls ? me.$bodyExtraCls() : null),
      style: st
    };
  },
  renderBodyContent: function () {
    const me = this;
    const h = me.$htmlContent();
    return [
      h !== null ? <div key="$html" className="x-autocontainer-innerCt" dangerouslySetInnerHTML={{ __html: h }} /> : null,
      ...[].concat(me.renderItemsUI() || [])
    ];
  },
  renderDocked: function (dock: string) {
    const me = this;
    const list = me.dockedItems && me.dockedItems.items ? me.dockedItems.items.filter((c: any) => dockOf(c) === dock) : [];
    return renderCmps(list);
  },
  renderRoot: function (ref: any) {
    const me = this;
    const props = me.getRootProps(ref);
    const hasSide = me.dockedItems && me.dockedItems.items && me.dockedItems.items.some((c: any) => dockOf(c) === 'left' || dockOf(c) === 'right');
    const body = <div key="$body" {...me.getBodyProps()}>{me.renderBodyContent()}</div>;
    const hidden = me.collapsed && !me.$isBorderRegion();
    return (
      <div {...props}>
        {me.$header ? <CmpView key="$header" cmp={me.$header} /> : null}
        {hidden ? null : me.renderDocked('top')}
        {hasSide && !hidden ? <div key="$side" className="x-panel-bodyWrap" style={{ display: 'flex', flexDirection: 'row', flex: '1 1 auto', minHeight: 0 }}>
          {me.renderDocked('left')}
          {React.cloneElement(body, { style: Object.assign({}, body.props.style, { flex: '1 1 auto' }) })}
          {me.renderDocked('right')}
        </div> : body}
        {hidden ? null : me.renderDocked('bottom')}
        {me.$renderExtra ? me.$renderExtra() : null}
      </div>
    );
  },

  doDestroy: function () {
    const me = this;
    if (me.dockedItems && me.dockedItems.getRange) { for (const c of me.dockedItems.getRange()) { c.destroy(); } }
    if (me.$header) { me.$header.destroy(); }
    me.callParent();
  }
});

export default Panel;
