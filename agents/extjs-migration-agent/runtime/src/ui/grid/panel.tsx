/**
 * Ext.grid.Panel (Ext.panel.Table): store, columns (header container), view, selection model, plugins,
 * features, events relayed from the view and selection model, reconfigure, ensureVisible and state
 * (column order / width / visibility, sorters, filters, grouping). Selection models: rowmodel,
 * checkboxmodel (checker column, header check-all, checkOnly) and cellmodel.
 */
import { Ext } from '../../core/ext';
import { define } from '../../core/class';
import * as React from 'react';
import { flushRender, CmpView } from '../render';
import '../panel';
import './column';
import './view';

const RELAY = ['itemclick', 'itemdblclick', 'itemcontextmenu', 'itemmousedown', 'itemmouseup', 'itemmouseenter', 'itemmouseleave', 'itemkeydown', 'itemkeyenter',
  'cellclick', 'celldblclick', 'cellcontextmenu', 'cellmousedown', 'cellmouseup', 'cellkeydown',
  'rowclick', 'rowdblclick', 'rowcontextmenu', 'rowmousedown', 'rowmouseup', 'containerclick', 'containerdblclick', 'containercontextmenu', 'containermousedown',
  'beforeitemclick', 'beforeitemdblclick', 'beforeitemcontextmenu', 'beforeitemmousedown', 'groupclick', 'groupdblclick', 'groupcontextmenu', 'groupexpand', 'groupcollapse',
  'rowbodyclick', 'expandbody', 'collapsebody'];

// ---------------------------------------------------------------- selection models
export const SelModel: any = define('Ext.selection.Model', {
  mixins: { observable: 'Ext.mixin.Observable' },
  alias: 'selection.abstract',
  isSelectionModel: true,
  mode: 'SINGLE',
  allowDeselect: undefined,
  toggleOnClick: true,
  pruneRemoved: true,
  locked: false,
  constructor: function (config?: any) {
    const me = this;
    me.mixins.observable.constructor.call(me, config);
    if (me.mode) { me.mode = String(me.mode).toUpperCase(); }
    if (me.allowDeselect === undefined) { me.allowDeselect = me.mode === 'SIMPLE'; }
    me.selected = [];
    me.selected.getCount = function () { return this.length; };
    me.selected.getRange = function () { return this.slice(); };
    me.selected.items = me.selected;
    me.selected.contains = function (r: any) { return this.indexOf(r) >= 0; };
    me.selected.first = function () { return this[0]; };
    me.selected.last = function () { return this[this.length - 1]; };
    me.selected.each = function (fn: any, s?: any) { this.slice().forEach(fn, s); };
    return me;
  },
  bindComponent: function (view: any) { this.view = view; this.grid = view.grid; this.bindStore(view.getStore()); },
  bindStore: function (store: any) {
    const me = this;
    if (me.$storeL) { me.$storeL.destroy(); }
    me.store = store;
    if (store && store.on) {
      me.$storeL = store.on({ remove: me.$onStoreRemove, clear: me.$onStoreRefresh, load: me.$onStoreRefresh, refresh: me.$onStoreRefresh, datachanged: me.$onStoreRefresh, scope: me, destroyable: true });
    }
  },
  getStore: function () { return this.store; },
  $onStoreRemove: function (store: any, records: any[]) { const sel = Ext.Array.from(records).filter((r: any) => this.isSelected(r)); if (sel.length) { this.deselect(sel); } },
  $onStoreRefresh: function () {
    const me = this;
    const s = me.store;
    if (!s || !me.selected.length) { return; }
    const keep: any[] = [];
    let changed = false;
    for (const r of me.selected) {
      if (s.indexOf(r) >= 0) { keep.push(r); continue; }
      const byId = !r.phantom && s.getById ? s.getById(r.getId()) : null;
      if (byId && s.indexOf(byId) >= 0) { keep.push(byId); changed = true; } else { changed = true; }
    }
    if (changed) {
      me.selected.length = 0;
      me.selected.push(...keep);
      if (me.lastSelected && keep.indexOf(me.lastSelected) < 0) { me.lastSelected = keep[keep.length - 1] || null; }
      me.$fireSelectionChange();
    }
  },
  getSelection: function () { return this.selected.slice(); },
  getSelected: function () { return this.selected; },
  getCount: function () { return this.selected.length; },
  hasSelection: function () { return this.selected.length > 0; },
  getLastSelected: function () { return this.lastSelected || null; },
  isSelected: function (r: any) { if (typeof r === 'number') { r = this.store ? this.store.getAt(r) : null; } return this.selected.indexOf(r) >= 0; },
  isRangeSelected: function () { return false; },
  getSelectionMode: function () { return this.mode; },
  setSelectionMode: function (m: string) { this.mode = String(m).toUpperCase(); },
  isLocked: function () { return !!this.locked; },
  setLocked: function (l: boolean) { this.locked = !!l; },
  $normalize: function (records: any) {
    const me = this;
    return Ext.Array.from(records).map((r: any) => (typeof r === 'number' ? me.store.getAt(r) : r)).filter(Boolean);
  },
  select: function (records: any, keepExisting?: boolean, suppressEvent?: boolean) {
    const me = this;
    if (me.locked) { return; }
    let list = me.$normalize(records);
    if (me.mode === 'SINGLE') { list = list.slice(-1); keepExisting = false; }
    let changed = false;
    if (!keepExisting) {
      const drop = me.selected.filter((r: any) => list.indexOf(r) < 0);
      for (const r of drop) { if (me.$doDeselect(r, suppressEvent)) { changed = true; } else { return; } }
    }
    for (const r of list) {
      if (me.isSelected(r)) { me.lastSelected = r; continue; }
      if (!suppressEvent && me.$fire('beforeselect', me, r, me.store ? me.store.indexOf(r) : -1) === false) { continue; }
      me.selected.push(r);
      me.lastSelected = r;
      changed = true;
      if (!suppressEvent) { me.$fire('select', me, r, me.store ? me.store.indexOf(r) : -1); }
    }
    me.$refreshView();
    if (changed && !suppressEvent) { me.$fireSelectionChange(); } else if (changed) { me.$publish(); }
  },
  $doDeselect: function (r: any, suppressEvent?: boolean) {
    const me = this;
    const i = me.selected.indexOf(r);
    if (i < 0) { return true; }
    if (!suppressEvent && me.$fire('beforedeselect', me, r, me.store ? me.store.indexOf(r) : -1) === false) { return false; }
    me.selected.splice(i, 1);
    if (me.lastSelected === r) { me.lastSelected = me.selected[me.selected.length - 1] || null; }
    if (!suppressEvent) { me.$fire('deselect', me, r, me.store ? me.store.indexOf(r) : -1); }
    return true;
  },
  deselect: function (records: any, suppressEvent?: boolean) {
    const me = this;
    if (me.locked) { return; }
    let changed = false;
    for (const r of me.$normalize(records)) { if (me.isSelected(r) && me.$doDeselect(r, suppressEvent)) { changed = true; } }
    me.$refreshView();
    if (changed && !suppressEvent) { me.$fireSelectionChange(); } else if (changed) { me.$publish(); }
  },
  selectAll: function (suppressEvent?: boolean) { if (this.store) { this.select(this.store.getRange(), true, suppressEvent); } },
  deselectAll: function (suppressEvent?: boolean) { this.deselect(this.selected.slice(), suppressEvent); },
  selectRange: function (start: any, end: any, keepExisting?: boolean) {
    const me = this;
    const s = me.store;
    const a = typeof start === 'number' ? start : s.indexOf(start), b = typeof end === 'number' ? end : s.indexOf(end);
    me.select(s.getRange(Math.min(a, b), Math.max(a, b)), keepExisting);
  },
  $fire: function (name: string, ...args: any[]) {
    const me = this;
    const r = me.fireEvent(name, ...args);
    if (r === false) { return false; }
    if (me.grid) { return me.grid.fireEvent(name, ...args); }
    return r;
  },
  $fireSelectionChange: function () {
    const me = this;
    const sel = me.getSelection();
    me.fireEvent('selectionchange', me, sel);
    if (me.grid) { me.grid.fireEvent('selectionchange', me, sel); }
    me.$publish();
  },
  $publish: function () {
    const g = this.grid;
    if (g && g.reference) { g.publishState('selection', this.mode === 'SINGLE' ? (this.selected[0] || null) : this.getSelection()); }
    if (g) { g.$selection = this.mode === 'SINGLE' ? (this.selected[0] || null) : this.getSelection(); }
  },
  $refreshView: function () { if (this.view) { this.view.updateUI(); } },
  $isCheckOnly: function () { return false; },
  $onItemEvent: function () { /* subclasses */ },
  destroy: function () { if (this.$storeL) { this.$storeL.destroy(); } this.destroyed = true; }
});

define('Ext.selection.RowModel', {
  extend: 'Ext.selection.Model',
  alias: 'selection.rowmodel',
  isRowModel: true,
  enableKeyNav: true,
  $onItemEvent: function (type: string, view: any, record: any, item: any, index: number, e: any) {
    const me = this;
    if (type === 'mousedown' && e.button === 0) { me.selectWithEvent(record, e); }
    else if (type === 'contextmenu' && !me.isSelected(record)) { me.selectWithEvent(record, e); }
  },
  selectWithEvent: function (record: any, e: any) {
    const me = this;
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const mode = me.mode;
    if (mode === 'SINGLE') {
      if (ctrl && me.isSelected(record) && me.allowDeselect !== false) { me.deselect(record); }
      else if (me.isSelected(record) && me.allowDeselect && me.toggleOnClick && me.selected.length === 1) { me.deselect(record); }
      else { me.select(record); }
    } else if (mode === 'SIMPLE') {
      if (me.isSelected(record)) { me.deselect(record); } else { me.select(record, true); }
    } else {
      if (shift && me.lastSelected) { me.selectRange(me.lastSelected, record, ctrl); me.lastSelected = me.lastSelected; }
      else if (ctrl) { if (me.isSelected(record)) { me.deselect(record); } else { me.select(record, true); } }
      else if (me.isSelected(record) && me.selected.length === 1) { /* keep */ }
      else { me.select(record); }
    }
  }
});

define('Ext.selection.CellModel', {
  extend: 'Ext.selection.RowModel',
  alias: 'selection.cellmodel',
  isCellModel: true,
  $onItemEvent: function (type: string, view: any, record: any, item: any, index: number, e: any, column: any) {
    const me = this;
    if (type === 'mousedown' && e.button === 0) {
      me.$pos = { record, row: index, column, columnHeader: column, view };
      me.select(record);
      me.fireEvent('selectionchange', me, [record]);
    }
  },
  getCurrentPosition: function () { return this.$pos || null; },
  getPosition: function () { return this.$pos || null; },
  setCurrentPosition: function (pos: any) { this.$pos = pos; }
});

define('Ext.selection.CheckboxModel', {
  extend: 'Ext.selection.RowModel',
  alias: 'selection.checkboxmodel',
  isCheckboxModel: true,
  mode: 'MULTI',
  injectCheckbox: 0,
  checkOnly: false,
  showHeaderCheckbox: true,
  headerWidth: 32,
  checkSelector: '.x-grid-row-checker',
  $isCheckOnly: function () { return !!this.checkOnly; },
  getHeaderConfig: function () {
    const me = this;
    return {
      xtype: 'gridcolumn', isCheckerHd: true, text: '&#160;', width: me.headerWidth, sortable: false, draggable: false, resizable: false, hideable: false, menuDisabled: true,
      dataIndex: '', tdCls: 'x-grid-cell-row-checker x-grid-cell-special', cls: 'x-column-header-checkbox', locked: me.locked || undefined, ignoreExport: true, align: 'center',
      $hasDefaultRenderer: true,
      defaultRenderer: () => '<div class="x-grid-row-checker" role="button" tabindex="0"><span class="x-grid-checkcolumn"></span></div>',
      $headerInner: function (this: any) {
        if (!me.showHeaderCheckbox || me.mode === 'SINGLE') { return null; }
        return '<span class="x-grid-hd-checker' + (me.$allSelected() ? ' x-grid-hd-checker-on' : '') + '"><span class="x-column-header-checkbox-inner x-grid-checkcolumn' + (me.$allSelected() ? ' x-grid-checkcolumn-checked' : '') + '"></span></span>';
      },
      $cellExtraCls: function (rec: any) { return me.isSelected(rec) ? 'x-grid-checker-checked' : null; },
      processEvent: function (type: string, view: any, cell: any, recordIndex: number, cellIndex: number, e: any, record: any) {
        if (type === 'mousedown' && e.button === 0) {
          e.preventDefault();
          if (me.isSelected(record)) { me.deselect(record); } else { me.select(record, me.mode !== 'SINGLE'); }
          return false;
        }
        if (type === 'click' || type === 'dblclick') { return false; }
        return true;
      }
    };
  },
  $allSelected: function () { const s = this.store; return !!(s && s.getCount() && this.selected.length >= s.getCount() && s.getRange().every((r: any) => this.isSelected(r))); },
  $toggleAll: function () { if (this.$allSelected()) { this.deselectAll(); } else { this.selectAll(); } },
  $onItemEvent: function (type: string, view: any, record: any, item: any, index: number, e: any, column: any) {
    const me = this;
    if (column && column.isCheckerHd) { return; }
    if (me.checkOnly) { return; }
    if (type === 'mousedown' && e.button === 0) {
      if (me.mode === 'SIMPLE') { if (me.isSelected(record)) { me.deselect(record); } else { me.select(record, true); } return; }
      me.selectWithEvent(record, e);
    } else if (type === 'contextmenu' && !me.isSelected(record)) { me.selectWithEvent(record, e); }
  },
  $fireSelectionChange: function () {
    this.callParent();
    const h = this.$checker;
    if (h) { h.updateUI(); }
  },
  $refreshView: function () { this.callParent(); if (this.$checker) { this.$checker.updateUI(); } }
});

// ---------------------------------------------------------------- Grid panel
export const GridPanel: any = define('Ext.grid.Panel', {
  extend: 'Ext.panel.Panel',
  alias: ['widget.gridpanel', 'widget.grid'],
  alternateClassName: ['Ext.panel.Table'],
  isGrid: true,
  isTablePanel: true,
  baseCls: 'x-panel',
  layout: 'fit',
  columnLines: false,
  rowLines: true,
  sortableColumns: true,
  enableColumnHide: true,
  enableColumnMove: true,
  enableColumnResize: true,
  hideHeaders: false,
  loadMask: true,
  emptyText: undefined,
  multiSelect: false,
  simpleSelect: false,
  defaultBindProperty: 'store',
  stateEvents: undefined,
  initComponent: function () {
    const me = this;
    // store
    me.store = me.$resolveStore(me.store);
    // selection model
    let sm = me.selModel || me.selType;
    if (!sm || !sm.isSelectionModel) {
      let cfg: any = typeof sm === 'string' ? { type: sm } : Ext.apply({}, sm);
      if (!cfg.type) { cfg.type = me.selType || 'rowmodel'; }
      if (me.simpleSelect && !cfg.mode) { cfg.mode = 'SIMPLE'; } else if (me.multiSelect && !cfg.mode) { cfg.mode = 'MULTI'; }
      const cls = Ext.ClassManager.getByAlias('selection.' + cfg.type) || Ext.ClassManager.get('Ext.selection.RowModel');
      delete cfg.type;
      sm = new cls(cfg);
    }
    me.selModel = sm;
    // columns
    let cols = me.columns;
    let colDefaults: any = null;
    if (cols && !Ext.isArray(cols) && cols.items) { colDefaults = cols.defaults; cols = cols.items; }
    cols = Ext.Array.from(cols).filter(Boolean).slice();
    if (sm.isCheckboxModel) {
      const hdr = sm.getHeaderConfig();
      if (sm.injectCheckbox === 'last') { cols.push(hdr); } else { cols.splice(typeof sm.injectCheckbox === 'number' ? sm.injectCheckbox : 0, 0, hdr); }
    }
    me.$initialColumnCfg = cols;
    me.headerCt = Ext.widget('headercontainer', { grid: me, columnDefaults: colDefaults, items: cols, $refOwner: me, sortable: me.sortableColumns });
    me.headerCt.$refOwner = me;
    if (sm.isCheckboxModel) { sm.$checker = me.headerCt.getGridColumns().find((c: any) => c.isCheckerHd); }
    me.columns = me.headerCt.getGridColumns();
    me.columnManager = { getColumns: () => me.headerCt.getGridColumns() };
    me.visibleColumnManager = { getColumns: () => me.headerCt.getVisibleGridColumns() };
    // view
    const vcfg = Ext.apply({ grid: me, ownerGrid: me, panel: me, $refOwner: me, emptyText: me.emptyText, loadMask: me.loadMask }, me.viewConfig);
    if (vcfg.emptyText === undefined) { delete vcfg.emptyText; }
    me.view = Ext.widget(vcfg.xtype || me.viewType || 'tableview', vcfg);
    me.view.$refOwner = me;
    if (me.view.getRowClass) { me.view.$rowClassScope = me.view; }
    // features
    me.$features = Ext.Array.from(me.features).filter(Boolean).map((f: any) => {
      if (f.isFeature) { return f; }
      const cfg = typeof f === 'string' ? { ftype: f } : Ext.apply({}, f);
      const cls = Ext.ClassManager.getByAlias('feature.' + cfg.ftype);
      if (!cls) { console.warn('Unknown grid feature ' + cfg.ftype); return null; }
      return new cls(cfg);
    }).filter(Boolean);
    me.view.features = me.$features;
    me.items = [];
    me.callParent();
    me.add(me.view);
    for (const f of me.$features) { f.grid = me; f.view = me.view; if (f.init) { f.init(me); } }
    sm.bindComponent(me.view);
    me.view.bindStore(me.store);
    me.$bindStoreEvents();
    me.relayEvents(me.view, RELAY);
    if (me.stateful && !me.stateEvents) { me.addStateEvents(['columnresize', 'columnmove', 'columnhide', 'columnshow', 'sortchange', 'filterchange', 'groupchange']); }
  },
  $resolveStore: function (s: any) {
    if (!s) { return Ext.create('Ext.data.Store', { fields: [], data: [], isEmptyStore: true }); }
    if (s.isStore) { return s; }
    if (typeof s === 'string') { return Ext.data.StoreManager.lookup(s) || Ext.create('Ext.data.Store', { fields: [], data: [], isEmptyStore: true }); }
    if (typeof s === 'object' && !s.isStore) {
      if (s.type || s.model || s.fields || s.data || s.proxy) { return Ext.data.StoreManager.lookup(s, 'store') || Ext.Factory.store(s); }
    }
    return Ext.data.StoreManager.lookup(s);
  },
  $bindStoreEvents: function () {
    const me = this;
    if (me.$gridStoreL) { me.$gridStoreL.destroy(); }
    if (me.store && me.store.on) {
      me.$gridStoreL = me.mon(me.store, {
        sort: () => me.headerCt.$invalidateSortCls(), filterchange: (s: any, f: any) => { me.headerCt.$invalidateSortCls(); me.fireEvent('filterchange', s, f); },
        groupchange: (s: any, g: any) => me.fireEvent('groupchange', s, g), scope: me, destroyable: true
      });
    }
  },
  getStore: function () { return this.store; },
  setStore: function (store: any) {
    const me = this;
    if (store && typeof store === 'object' && !store.isStore) { store = me.$resolveStore(store); }
    if (!store) { return; }
    if (store === me.store) { return; }
    me.reconfigure(store);
  },
  bindStore: function (store: any) { this.setStore(store); },
  getView: function () { return this.view; },
  getSelectionModel: function () { return this.selModel; },
  getSelection: function () { return this.selModel.getSelection(); },
  setSelection: function (rec: any) {
    const sm = this.selModel;
    if (rec === null || rec === undefined || (Ext.isArray(rec) && !rec.length)) { sm.deselectAll(); } else { sm.select(rec); }
  },
  getColumns: function () { return this.headerCt.getGridColumns(); },
  getVisibleColumns: function () { return this.headerCt.getVisibleGridColumns(); },
  getColumnManager: function () { return this.columnManager; },
  getVisibleColumnManager: function () { return this.visibleColumnManager; },
  getHeaderContainer: function () { return this.headerCt; },
  getRefItems: function () {
    const me = this;
    const out = me.callParent();
    if (me.headerCt) { out.push(me.headerCt); }
    for (const f of me.$features || []) { if (f.$bar) { out.push(f.$bar); } }
    return out;
  },
  $columnsChanged: function () { if (this.view) { this.view.$columnsChanged(); } },
  /** Body: header container, docked-top summaries, the view (scroller), docked-bottom summaries, like Ext's docking. */
  renderBodyContent: function () {
    const me = this;
    const bars = (dock: string) => (me.$features || []).filter((f: any) => f.$bar && (f.dock || 'bottom') === dock).map((f: any) => <CmpView key={f.$bar.id} cmp={f.$bar} />);
    return [
      me.hideHeaders || !me.headerCt ? null : <CmpView key="$hd" cmp={me.headerCt} />,
      ...bars('top'),
      ...[].concat(me.renderItemsUI() || []),
      ...bars('bottom')
    ];
  },
  $afterViewRefresh: function () { /* hook */ },
  $extendHeaderMenu: function (items: any[], col: any) {
    const me = this;
    for (const p of me.plugins || []) { if (p.$extendHeaderMenu) { p.$extendHeaderMenu(items, col); } }
    for (const f of me.$features || []) { if (f.$extendHeaderMenu) { f.$extendHeaderMenu(items, col); } }
  },
  reconfigure: function (store?: any, columns?: any) {
    const me = this;
    const oldStore = me.store;
    const oldColumns = me.headerCt.getGridColumns();
    if (me.fireEvent('beforereconfigure', me, store, columns, oldStore, oldColumns) === false) { return; }
    if (columns) {
      let cols = columns;
      let defaults = null;
      if (!Ext.isArray(cols) && cols.items) { defaults = cols.defaults; cols = cols.items; }
      cols = Ext.Array.from(cols).slice();
      if (me.selModel.isCheckboxModel) { cols.splice(0, 0, me.selModel.getHeaderConfig()); }
      me.headerCt.columnDefaults = defaults || me.headerCt.columnDefaults;
      me.headerCt.removeAll(true);
      me.headerCt.add(cols);
      if (me.selModel.isCheckboxModel) { me.selModel.$checker = me.headerCt.getGridColumns().find((c: any) => c.isCheckerHd); }
      me.columns = me.headerCt.getGridColumns();
      me.headerCt.$invalidate();
    }
    if (store) {
      store = me.$resolveStore(store);
      me.store = store;
      me.view.bindStore(store);
      me.selModel.bindStore(store);
      me.$bindStoreEvents();
      if (me.reference) { me.publishState('store', store); }
    }
    me.view.refresh();
    me.fireEvent('reconfigure', me, store || oldStore, columns ? me.headerCt.getGridColumns() : undefined, oldStore, oldColumns);
  },
  ensureVisible: function (record: any, options?: any) {
    const me = this;
    options = options || {};
    if (typeof record === 'number') { record = me.store.getAt(record); }
    if (!record) { return; }
    flushRender();
    me.view.focusRow(record);
    if (options.select) { me.selModel.select(record); }
    if (options.focus) { const n = me.view.getNode(record); if (n) { n.focus({ preventScroll: true }); } }
    if (options.callback) { options.callback.call(options.scope || me, true, record, me.view.getNode(record)); }
  },
  scrollTo: function (x: number, y: number) { const el = this.view.getEl(); if (el) { el.dom.scrollLeft = x || 0; el.dom.scrollTop = y || 0; } },
  getScrollable: function () { return this.view.getScrollable(); },
  $maskTarget: function () { return this.body || this.el; },

  // ---- state
  getState: function () {
    const me = this;
    const state: any = { columns: [] };
    const walk = (items: any[]) => {
      for (const c of items) {
        if (c.isCheckerHd || c.isRowNumberer) { continue; }
        const id = c.stateId || c.dataIndex || c.$colId;
        const s: any = { id };
        if (!c.flex && typeof c.width === 'number') { s.width = c.width; }
        if (c.hidden) { s.hidden = true; }
        state.columns.push(s);
        if (c.isGroupHeader) { walk(c.items.items); }
      }
    };
    walk(me.headerCt.items.items);
    const st = me.store;
    if (st && st.getSorters) {
      const sorters = st.getSorters();
      const list = (sorters.items || []).map((s: any) => ({ property: s.getProperty ? s.getProperty() : s.property, direction: s.getDirection ? s.getDirection() : s.direction })).filter((s: any) => s.property);
      state.storeState = { sorters: list };
      if (st.getGroupField && st.getGroupField()) { state.storeState.grouper = { property: st.getGroupField() }; }
    }
    for (const p of me.plugins || []) { if (p.$saveState) { p.$saveState(state); } }
    return state;
  },
  applyState: function (state: any) {
    const me = this;
    if (!state) { return; }
    if (state.columns && me.headerCt) {
      const byId = new Map<string, any>();
      for (const c of me.headerCt.items.items) { byId.set(c.stateId || c.dataIndex || c.$colId, c); }
      const order: any[] = [];
      for (const s of state.columns) {
        const c = byId.get(s.id);
        if (!c) { continue; }
        if (s.width !== undefined) { c.width = s.width; c.flex = undefined; }
        c.hidden = !!s.hidden;
        if (c.ownerCt === me.headerCt) { order.push(c); }
      }
      const items = me.headerCt.items.items;
      const fixed = items.filter((c: any) => order.indexOf(c) < 0);
      const newOrder: any[] = [];
      let oi = 0;
      for (const c of items) { if (fixed.indexOf(c) >= 0) { newOrder.push(c); } else { newOrder.push(order[oi++]); } }
      me.headerCt.items.items = newOrder;
      if (me.headerCt.items.$reindex) { me.headerCt.items.$reindex(); }
      me.headerCt.$invalidate();
    }
    const ss = state.storeState;
    if (ss && me.store) {
      if (ss.sorters && ss.sorters.length && me.store.setSorters) { me.store.$sorters.$silent = false; me.store.sort(ss.sorters); }
      if (ss.grouper && me.store.group) { me.store.group(ss.grouper.property); }
    }
    for (const p of me.plugins || []) { if (p.$applyState) { p.$applyState(state); } }
  },
  getRootCls: function () {
    const me = this;
    return me.callParent() + ' x-grid x-grid-panel' + (me.columnLines ? ' x-grid-with-col-lines' : '') + (me.rowLines ? ' x-grid-with-row-lines' : '') + (me.hideHeaders ? ' x-grid-header-hidden' : '');
  },
  $bodyExtraCls: function () { return 'x-grid-body'; },
  doDestroy: function () {
    const me = this;
    if (me.$gridStoreL) { me.$gridStoreL.destroy(); }
    if (me.headerCt) { me.headerCt.destroy(); }
    if (me.selModel && me.selModel.destroy) { me.selModel.destroy(); }
    for (const f of me.$features || []) { if (f.destroy) { f.destroy(); } }
    if (me.store && me.store.autoDestroy && !me.store.storeId) { /* keep shared stores */ }
    me.callParent();
  }
});
