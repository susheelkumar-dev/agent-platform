/** Ext.toolbar.Toolbar (+ Fill '->', Separator '-', Spacer ' ', TextItem) and Ext.toolbar.Paging. */
import * as React from 'react';
import { Ext } from '../core/ext';
import { define } from '../core/class';
import { clsList } from './render';
import './container';

export const Toolbar: any = define('Ext.toolbar.Toolbar', {
  extend: 'Ext.container.Container',
  alias: 'widget.toolbar',
  isToolbar: true,
  baseCls: 'x-toolbar',
  defaultType: 'button',
  vertical: false,
  ui: 'default',
  overflowHandler: null,
  initComponent: function () {
    const me = this;
    if (!me.layout || me.layout === 'auto' || typeof me.layout === 'string' && me.layout !== 'hbox' && me.layout !== 'vbox') {
      me.layout = { type: me.vertical ? 'vbox' : 'hbox', align: me.vertical ? 'stretch' : 'middle', overflow: 'visible' };
    }
    me.callParent();
  },
  $specialItem: function (s: string) {
    if (s === '->') { return Ext.widget('tbfill'); }
    if (s === '-' || s === '|') { return Ext.widget('tbseparator', { vertical: this.vertical }); }
    if (s === ' ') { return Ext.widget('tbspacer'); }
    return Ext.widget('tbtext', { text: s });
  },
  getRootCls: function () {
    const me = this;
    return clsList(me.callParent(), 'x-toolbar-' + me.ui, 'x-box-layout-ct', me.vertical ? 'x-toolbar-vertical' : 'x-toolbar-horizontal',
      me.isDocked ? ['x-docked', 'x-docked-' + (me.dock || 'top'), 'x-toolbar-docked-' + (me.dock || 'top')] : null,
      me.ui === 'footer' ? 'x-toolbar-footer' : null);
  },
  getRootStyle: function () {
    const st = this.callParent();
    if (!this.vertical) { st.flexWrap = 'nowrap'; if (st.overflowX === undefined && st.overflow === undefined) { st.overflowX = 'auto'; st.overflowY = 'hidden'; } }
    st.flexShrink = 0;
    return st;
  }
});

define('Ext.toolbar.Fill', {
  extend: 'Ext.Component',
  alias: 'widget.tbfill',
  baseCls: 'x-toolbar-fill',
  flex: 1,
  isFill: true
});
define('Ext.toolbar.Separator', {
  extend: 'Ext.Component',
  alias: 'widget.tbseparator',
  baseCls: 'x-toolbar-separator',
  getRootCls: function () { return clsList(this.callParent(), this.vertical ? 'x-toolbar-separator-vertical' : 'x-toolbar-separator-horizontal'); }
});
define('Ext.toolbar.Spacer', { extend: 'Ext.Component', alias: 'widget.tbspacer', baseCls: 'x-toolbar-spacer', width: 2 });
define('Ext.toolbar.TextItem', {
  extend: 'Ext.Component',
  alias: 'widget.tbtext',
  baseCls: 'x-toolbar-text',
  defaultBindProperty: 'html',
  text: '',
  getRootCls: function () { return clsList(this.callParent(), 'x-toolbar-text-default'); },
  $htmlContent: function () {
    const me = this;
    if (me.html !== undefined && me.html !== null) { return me.html; }
    return me.text === undefined || me.text === null ? '' : String(me.text);
  },
  setText: function (t: string) { this.text = t; this.html = undefined; this.updateUI(); },
  setHtml: function (h: string) { this.html = h; this.updateUI(); },
  getText: function () { return this.html !== undefined ? this.html : this.text; }
});

define('Ext.toolbar.Paging', {
  extend: 'Ext.toolbar.Toolbar',
  alias: 'widget.pagingtoolbar',
  displayInfo: false,
  displayMsg: 'Displaying {0} - {1} of {2}',
  emptyMsg: 'No data to display',
  beforePageText: 'Page',
  afterPageText: 'of {0}',
  firstText: 'First Page', prevText: 'Previous Page', nextText: 'Next Page', lastText: 'Last Page', refreshText: 'Refresh',
  initComponent: function () {
    const me = this;
    const extra = Ext.Array.from(me.items);
    me.items = [
      { itemId: 'first', iconCls: 'x-fa fa-angle-double-left', tooltip: me.firstText, handler: () => me.moveFirst() },
      { itemId: 'prev', iconCls: 'x-fa fa-angle-left', tooltip: me.prevText, handler: () => me.movePrevious() },
      '-',
      { xtype: 'tbtext', text: me.beforePageText },
      { xtype: 'numberfield', itemId: 'inputItem', width: 60, hideTrigger: true, hideLabel: true, value: 1, minValue: 1, allowDecimals: false, submitValue: false,
        listeners: { specialkey: (f: any, e: any) => { if (e.getKey() === 13) { me.$gotoPage(f.getValue()); } } } },
      { xtype: 'tbtext', itemId: 'afterTextItem', text: Ext.String.format(me.afterPageText, 1) },
      '-',
      { itemId: 'next', iconCls: 'x-fa fa-angle-right', tooltip: me.nextText, handler: () => me.moveNext() },
      { itemId: 'last', iconCls: 'x-fa fa-angle-double-right', tooltip: me.lastText, handler: () => me.moveLast() },
      '-',
      { itemId: 'refresh', iconCls: 'x-fa fa-sync-alt', tooltip: me.refreshText, handler: () => me.doRefresh() }
    ].concat(extra);
    if (me.displayInfo) { me.items.push('->', { xtype: 'tbtext', itemId: 'displayItem' }); }
    me.callParent();
    if (me.store) { me.bindStore(me.store); }
  },
  onAdded: function (container: any, pos: number) {
    this.callParent(arguments);
    if (!this.store && container && container.getStore) { this.bindStore(container.getStore()); }
  },
  bindStore: function (store: any) {
    const me = this;
    Ext.destroy(me.$storeListeners);
    me.store = typeof store === 'string' || (store && !store.isStore) ? Ext.data.StoreManager.lookup(store) : store;
    if (me.store) { me.$storeListeners = me.mon(me.store, { load: me.onLoad, datachanged: me.onLoad, scope: me, destroyable: true }); }
    me.onLoad();
  },
  getStore: function () { return this.store; },
  getPageData: function () {
    const s = this.store;
    if (!s) { return { total: 0, currentPage: 1, pageCount: 1, fromRecord: 0, toRecord: 0 }; }
    const total = s.getTotalCount(), size = s.pageSize || total || 1;
    return { total, currentPage: s.currentPage, pageCount: Math.max(1, Math.ceil(total / size)), fromRecord: total ? ((s.currentPage - 1) * size) + 1 : 0, toRecord: Math.min(s.currentPage * size, total) };
  },
  onLoad: function () {
    const me = this;
    if (!me.items || !me.down) { return; }
    const d = me.getPageData();
    const input = me.down('#inputItem');
    if (input) { input.setValue(d.currentPage); }
    const after = me.down('#afterTextItem');
    if (after) { after.setText(Ext.String.format(me.afterPageText, d.pageCount)); }
    const set = (id: string, dis: boolean) => { const b = me.down('#' + id); if (b) { b.setDisabled(dis); } };
    set('first', d.currentPage <= 1); set('prev', d.currentPage <= 1); set('next', d.currentPage >= d.pageCount); set('last', d.currentPage >= d.pageCount);
    const di = me.down('#displayItem');
    if (di) { di.setText(d.total ? Ext.String.format(me.displayMsg, d.fromRecord, d.toRecord, d.total) : me.emptyMsg); }
    me.fireEvent('change', me, d);
  },
  $gotoPage: function (p: number) { const d = this.getPageData(); p = Math.max(1, Math.min(d.pageCount, Number(p) || 1)); if (this.fireEvent('beforechange', this, p) !== false) { this.store.loadPage(p); } },
  moveFirst: function () { this.$gotoPage(1); },
  movePrevious: function () { this.$gotoPage(this.store.currentPage - 1); },
  moveNext: function () { this.$gotoPage(this.store.currentPage + 1); },
  moveLast: function () { this.$gotoPage(this.getPageData().pageCount); },
  doRefresh: function () { if (this.fireEvent('beforechange', this, this.store.currentPage) !== false) { this.store.loadPage(this.store.currentPage); } }
});
