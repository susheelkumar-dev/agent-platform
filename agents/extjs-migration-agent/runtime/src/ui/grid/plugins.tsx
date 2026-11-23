/**
 * Grid plugins: Ext.plugin.Abstract, Ext.grid.plugin.CellEditing (floating x-editor over the cell, Enter /
 * Tab / Esc, blur completes, beforeedit / validateedit / edit / canceledit), Ext.grid.plugin.RowEditing
 * (editor row with Update / Cancel), Ext.grid.plugin.RowExpander (rowBodyTpl) and Ext.grid.filters.Filters
 * (column filters: string, number, date, list, boolean, in the column menu).
 */
import * as React from 'react';
import { Ext } from '../../core/ext';
import { define } from '../../core/class';
import { clsList, CmpView, flushRender } from '../render';
import '../floating';
import '../menu';
import '../form/field';
import '../form/picker';

// ---------------------------------------------------------------- Abstract
define('Ext.plugin.Abstract', {
  mixins: { observable: 'Ext.mixin.Observable' },
  alias: 'plugin.abstract',
  isPlugin: true,
  disabled: false,
  constructor: function (config?: any) {
    const me = this;
    me.initialConfig = config;
    me.mixins.observable.constructor.call(me, config);
    return me;
  },
  init: function (cmp: any) { this.cmp = cmp; },
  getCmp: function () { return this.cmp; },
  setCmp: function (c: any) { this.cmp = c; },
  enable: function () { this.disabled = false; },
  disable: function () { this.disabled = true; },
  setDisabled: function (d: boolean) { if (d) { this.disable(); } else { this.enable(); } },
  isDisabled: function () { return !!this.disabled; },
  destroy: function () { const me = this; if (me.destroyObservable) { me.destroyObservable(); } me.cmp = null; me.destroyed = true; }
});
Ext.AbstractPlugin = Ext.ClassManager.get('Ext.plugin.Abstract');

// ---------------------------------------------------------------- Editing base
function fireBoth(plugin: any, grid: any, name: string, ...args: any[]) {
  if (plugin.fireEvent(name, ...args) === false) { return false; }
  if (grid && grid.fireEvent(name, ...args) === false) { return false; }
  return true;
}

define('Ext.grid.CellEditor', {
  extend: 'Ext.Component',
  alias: 'widget.celleditor',
  baseCls: 'x-editor',
  floating: true,
  hidden: true,
  focusable: false,
  getRefItems: function () { return this.field ? [this.field] : []; },
  setField: function (f: any) { this.field = f; if (f) { f.ownerCmp = this; } this.updateUI(); },
  getRootCls: function () { return clsList(this.callParent(), 'x-small-editor', 'x-grid-editor', 'x-grid-cell-editor', 'x-layer'); },
  getRootStyle: function () {
    const st = this.callParent();
    st.position = 'fixed';
    if (this.width !== undefined) { st.width = this.width; }
    if (this.height !== undefined) { st.height = this.height; }
    return st;
  },
  renderContent: function () {
    const f = this.field;
    return f ? <CmpView cmp={f} /> : null;
  }
});

define('Ext.grid.plugin.Editing', {
  extend: 'Ext.plugin.Abstract',
  alias: 'editing.editing',
  clicksToEdit: 2,
  triggerEvent: undefined,
  editing: false,
  init: function (grid: any) {
    const me = this;
    me.grid = me.cmp = grid;
    me.view = grid.getView();
    grid.editingPlugin = grid.editingPlugin || me;
    const ev = me.triggerEvent || (me.clicksToEdit === 1 ? 'cellclick' : 'celldblclick');
    me.view.on(ev, me.$onTrigger, me);
    grid.getStore().on({ load: () => { if (me.editing) { me.cancelEdit(); } }, scope: me });
    grid.on('reconfigure', (g: any, store: any) => { if (store) { store.on({ load: () => { if (me.editing) { me.cancelEdit(); } }, scope: me }); } });
    me.view.on('scroll', () => { if (me.editing && me.$reposition) { me.$reposition(); } });
  },
  $onTrigger: function (view: any, td: any, cellIndex: number, record: any) {
    const me = this;
    if (me.disabled) { return; }
    const col = view.getHeaderByCell(td);
    if (!col) { return; }
    me.startEdit(record, col);
  },
  $context: function (record: any, column: any) {
    const me = this;
    const g = me.grid;
    const store = g.getStore();
    const cols = g.headerCt.getVisibleGridColumns();
    return {
      grid: g, view: me.view, store, record, field: column ? column.dataIndex : null, column, colIdx: column ? cols.indexOf(column) : -1,
      rowIdx: store.indexOf(record), row: me.view.getNode(record, true), cell: column ? me.view.getCell(record, column) : null,
      value: column && column.dataIndex ? record.get(column.dataIndex) : undefined, originalValue: column && column.dataIndex ? record.get(column.dataIndex) : undefined, cancel: false
    };
  },
  $resolveColumn: function (c: any) {
    const g = this.grid;
    if (c === undefined || c === null) { return g.headerCt.getVisibleGridColumns().find((x: any) => x.hasEditor && x.hasEditor()) || null; }
    if (typeof c === 'number') { return g.headerCt.getHeaderAtIndex(c); }
    if (typeof c === 'string') { return g.headerCt.getGridColumns().find((x: any) => x.dataIndex === c || x.itemId === c) || null; }
    return c;
  },
  $resolveRecord: function (r: any) { return typeof r === 'number' ? this.grid.getStore().getAt(r) : r; },
  getActiveRecord: function () { return this.context ? this.context.record : null; },
  getActiveColumn: function () { return this.context ? this.context.column : null; },
  getEditingContext: function () { return this.context || null; },
  disable: function () { if (this.editing) { this.cancelEdit(); } this.callParent(); },
  destroy: function () { const me = this; if (me.$editorCmp) { me.$editorCmp.destroy(); } me.callParent(); }
});

// ---------------------------------------------------------------- Cell editing
define('Ext.grid.plugin.CellEditing', {
  extend: 'Ext.grid.plugin.Editing',
  alias: 'plugin.cellediting',
  ptype: 'cellediting',
  startEdit: function (record: any, columnHeader?: any) {
    const me = this;
    record = me.$resolveRecord(record);
    const column = me.$resolveColumn(columnHeader);
    if (!record || !column || me.disabled) { return false; }
    const field = column.getEditor ? column.getEditor(record) : null;
    if (!field) { return false; }
    if (me.editing) {
      if (me.context && me.context.record === record && me.context.column === column) { return true; }
      me.completeEdit();
    }
    flushRender();
    const ctx = me.$context(record, column);
    if (!fireBoth(me, me.grid, 'beforeedit', me, ctx) || ctx.cancel) { return false; }
    me.view.ensureVisible(record);
    me.context = ctx;
    me.editing = true;
    me.activeRecord = record;
    me.activeColumn = column;
    const ed = me.getEditor(record, column);
    me.activeEditor = ed;
    ed.setField(field);
    field.$suspendCheck = true;
    field.setValue(ctx.value);
    field.$suspendCheck = false;
    field.lastValue = field.getValue();
    field.originalValue = field.getValue();
    field.clearInvalid();
    me.$startValue = field.getValue();
    me.$reposition();
    ed.show();
    me.$bindField(field);
    setTimeout(() => {
      if (!me.editing || me.context !== ctx) { return; }
      field.focus(true);
      if (field.selectText) { try { field.selectText(); } catch (e) { /* ignore */ } }
    }, 0);
    return true;
  },
  getEditor: function () {
    const me = this;
    if (!me.$editorCmp || me.$editorCmp.destroyed) {
      me.$editorCmp = Ext.widget('celleditor', { ownerCmp: me.grid, plugin: me });
    }
    return me.$editorCmp;
  },
  $reposition: function () {
    const me = this;
    const ctx = me.context;
    if (!ctx) { return; }
    const cell = me.view.getCell(ctx.record, ctx.column);
    const ed = me.$editorCmp;
    if (!cell || !ed) { return; }
    const b = cell.dom.getBoundingClientRect();
    ed.x = Math.round(b.left); ed.y = Math.round(b.top); ed.width = Math.round(b.width); ed.height = Math.round(b.height);
    ed.updateUI();
  },
  $bindField: function (field: any) {
    const me = this;
    if (me.$fieldL) { me.$fieldL.destroy(); }
    me.$fieldL = field.on({
      specialkey: (f: any, e: any) => {
        const k = e.getKey();
        if (k === e.ENTER) { if (f.isExpanded) { return; } e.preventDefault(); me.completeEdit(); me.$focusCell(); }
        else if (k === e.ESC) { if (f.isExpanded) { return; } e.preventDefault(); me.cancelEdit(); me.$focusCell(); }
        else if (k === e.TAB) { e.preventDefault(); me.$tabTo(e.shiftKey ? -1 : 1); }
      },
      blur: () => {
        setTimeout(() => {
          if (!me.editing || !me.$editorCmp) { return; }
          const a = document.activeElement;
          const edEl = me.$editorCmp.el && me.$editorCmp.el.dom;
          if (edEl && a && edEl.contains(a)) { return; }
          if (field.picker && field.picker.el && a && field.picker.el.dom.contains(a)) { return; }
          if (field.isExpanded) { return; }
          me.completeEdit();
        }, 0);
      },
      destroyable: true
    });
  },
  $focusCell: function () {
    const me = this;
    const ctx = me.$lastCtx;
    if (!ctx) { return; }
    const n = me.view.getNode(ctx.record);
    if (n) { try { n.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  },
  $tabTo: function (dir: number) {
    const me = this;
    const ctx = me.context;
    if (!ctx) { return; }
    const store = me.grid.getStore();
    const cols = me.grid.headerCt.getVisibleGridColumns().filter((c: any) => c.hasEditor && c.hasEditor());
    let ri = store.indexOf(ctx.record);
    let ci = cols.indexOf(ctx.column) + dir;
    me.completeEdit();
    while (ri >= 0 && ri < store.getCount()) {
      if (ci >= 0 && ci < cols.length) { if (me.startEdit(store.getAt(ri), cols[ci])) { return; } ci += dir; continue; }
      ri += dir;
      ci = dir > 0 ? 0 : cols.length - 1;
    }
  },
  completeEdit: function () {
    const me = this;
    if (!me.editing) { return; }
    const ctx = me.context;
    const field = me.activeEditor.field;
    if (field.beforeBlur) { try { field.beforeBlur(); } catch (e) { /* ignore */ } }
    if (field.isValid && !field.isValid()) { me.cancelEdit(); return; }
    const value = field.getValue();
    ctx.value = value;
    me.$hide();
    me.$lastCtx = ctx;
    if (!fireBoth(me, me.grid, 'validateedit', me, ctx) || ctx.cancel) { me.$finish(); return; }
    const rec = ctx.record;
    if (ctx.field && !isSame(rec.get(ctx.field), value)) { rec.set(ctx.field, value); }
    me.$finish();
    fireBoth(me, me.grid, 'edit', me, ctx);
  },
  cancelEdit: function () {
    const me = this;
    if (!me.editing) { return; }
    const ctx = me.context;
    ctx.value = me.activeEditor && me.activeEditor.field ? me.activeEditor.field.getValue() : ctx.value;
    me.$hide();
    me.$lastCtx = ctx;
    me.$finish();
    fireBoth(me, me.grid, 'canceledit', me, ctx);
  },
  $hide: function () {
    const me = this;
    if (me.$fieldL) { me.$fieldL.destroy(); me.$fieldL = null; }
    const f = me.activeEditor && me.activeEditor.field;
    if (f && f.collapse) { f.collapse(); }
    if (me.$editorCmp) { me.$editorCmp.hide(); }
  },
  $finish: function () { const me = this; me.editing = false; me.context = null; me.activeRecord = null; me.activeColumn = null; },
  getCell: function () { return this.context ? this.view.getCell(this.context.record, this.context.column) : null; }
});

function isSame(a: any, b: any) {
  if (a === b) { return true; }
  if (a instanceof Date && b instanceof Date) { return a.getTime() === b.getTime(); }
  if ((a === null || a === undefined || a === '') && (b === null || b === undefined || b === '')) { return true; }
  return false;
}

// ---------------------------------------------------------------- Row editing
define('Ext.grid.RowEditor', {
  extend: 'Ext.Component',
  alias: 'widget.roweditor',
  baseCls: 'x-grid-row-editor',
  floating: true,
  hidden: true,
  saveBtnText: 'Update',
  cancelBtnText: 'Cancel',
  getRefItems: function () { return (this.fields || []).concat(this.$buttons || []); },
  initComponent: function () {
    const me = this;
    me.callParent();
    me.$buttons = [
      Ext.widget('button', { text: me.saveBtnText, itemId: 'update', ownerCmp: me, handler: () => me.plugin.completeEdit() }),
      Ext.widget('button', { text: me.cancelBtnText, itemId: 'cancel', ownerCmp: me, handler: () => me.plugin.cancelEdit() })
    ];
  },
  getRootStyle: function () { const st = this.callParent(); st.position = 'fixed'; return st; },
  renderContent: function () {
    const me = this;
    return [
      <div key="f" className="x-grid-row-editor-fields" style={{ display: 'flex', alignItems: 'center', width: me.width, overflow: 'hidden' }}>
        {(me.slots || []).map((s: any) => <div key={s.col.$uid} style={{ width: s.col.$w, flex: '0 0 auto', padding: '0 2px', boxSizing: 'border-box' }}>{s.field ? <CmpView cmp={s.field} /> : <div className="x-grid-cell-inner" dangerouslySetInnerHTML={{ __html: s.html }} />}</div>)}
      </div>,
      <div key="b" className="x-grid-row-editor-buttons" style={{ display: 'flex', gap: 6, justifyContent: 'center', padding: 4 }}>
        {me.$buttons.map((b: any) => <CmpView key={b.id} cmp={b} />)}
      </div>
    ];
  },
  doDestroy: function () { for (const b of this.$buttons || []) { b.destroy(); } this.callParent(); }
});

define('Ext.grid.plugin.RowEditing', {
  extend: 'Ext.grid.plugin.Editing',
  alias: 'plugin.rowediting',
  ptype: 'rowediting',
  autoCancel: true,
  errorSummary: true,
  init: function (grid: any) {
    const me = this;
    me.callParent([grid]);
    const ev = me.clicksToEdit === 1 ? 'itemclick' : 'itemdblclick';
    me.view.un(me.triggerEvent || (me.clicksToEdit === 1 ? 'cellclick' : 'celldblclick'), me.$onTrigger, me);
    me.view.on(ev, (view: any, record: any, item: any, idx: number, e: any) => {
      if (me.disabled) { return; }
      const td = e.getTarget('td.x-grid-cell');
      me.startEdit(record, td ? view.getHeaderByCell(td) : null);
    });
  },
  getEditor: function () {
    const me = this;
    if (!me.$editorCmp || me.$editorCmp.destroyed) { me.$editorCmp = Ext.widget('roweditor', { plugin: me, ownerCmp: me.grid }); }
    return me.$editorCmp;
  },
  startEdit: function (record: any, columnHeader?: any) {
    const me = this;
    record = me.$resolveRecord(record);
    if (!record || me.disabled) { return false; }
    if (me.editing) { if (me.context && me.context.record === record) { return true; } if (me.autoCancel) { me.cancelEdit(); } else { me.completeEdit(); } }
    flushRender();
    const column = columnHeader ? me.$resolveColumn(columnHeader) : null;
    const ctx: any = me.$context(record, column);
    const cols = me.grid.headerCt.getVisibleGridColumns();
    ctx.originalValues = {};
    for (const c of cols) { if (c.dataIndex) { ctx.originalValues[c.dataIndex] = record.get(c.dataIndex); } }
    ctx.newValues = Ext.apply({}, ctx.originalValues);
    if (!fireBoth(me, me.grid, 'beforeedit', me, ctx) || ctx.cancel) { return false; }
    me.context = ctx;
    me.editing = true;
    const ed = me.getEditor();
    const store = me.grid.getStore();
    ed.slots = cols.map((c: any) => {
      const f = c.getEditor ? c.getEditor(record) : null;
      if (f) {
        f.$suspendCheck = true; f.setValue(record.get(c.dataIndex)); f.$suspendCheck = false;
        f.lastValue = f.originalValue = f.getValue(); f.clearInvalid();
        f.ownerCmp = ed;
      }
      return { col: c, field: f, html: f ? '' : c.$renderCell(record, store.indexOf(record), cols.indexOf(c), me.view).html };
    });
    ed.fields = ed.slots.map((s: any) => s.field).filter(Boolean);
    me.$reposition();
    ed.show();
    const first = (column && column.getEditor && column.getEditor(record)) || ed.fields[0];
    if (me.$keyL) { me.$keyL.forEach((d: any) => d.destroy()); }
    me.$keyL = ed.fields.map((f: any) => f.on({ specialkey: (fld: any, e: any) => { if (e.getKey() === e.ENTER && !fld.isExpanded) { e.preventDefault(); me.completeEdit(); } else if (e.getKey() === e.ESC && !fld.isExpanded) { e.preventDefault(); me.cancelEdit(); } }, destroyable: true }));
    if (first) { setTimeout(() => { if (me.editing) { first.focus(true); } }, 0); }
    return true;
  },
  $reposition: function () {
    const me = this;
    const ctx = me.context;
    const ed = me.$editorCmp;
    if (!ctx || !ed) { return; }
    const node = me.view.getNode(ctx.record, true);
    const vb = me.view.el.dom.getBoundingClientRect();
    const b = node ? node.getBoundingClientRect() : vb;
    ed.x = Math.round(vb.left); ed.y = Math.round(b.top - 3); ed.width = Math.round(Math.min(vb.width, me.view.$tableWidth || vb.width));
    ed.updateUI();
  },
  completeEdit: function () {
    const me = this;
    if (!me.editing) { return false; }
    const ed = me.$editorCmp;
    const ctx = me.context;
    let valid = true;
    for (const f of ed.fields) { if (!f.isValid()) { valid = false; } }
    if (!valid) { return false; }
    ctx.newValues = {};
    for (const s of ed.slots) { if (s.field && s.col.dataIndex) { if (s.field.beforeBlur) { s.field.beforeBlur(); } ctx.newValues[s.col.dataIndex] = s.field.getValue(); } }
    if (!fireBoth(me, me.grid, 'validateedit', me, ctx) || ctx.cancel) { return false; }
    const rec = ctx.record;
    const changes: any = {};
    for (const k in ctx.newValues) { if (!isSame(rec.get(k), ctx.newValues[k])) { changes[k] = ctx.newValues[k]; } }
    if (Object.keys(changes).length) { rec.set(changes); }
    me.$close();
    fireBoth(me, me.grid, 'edit', me, ctx);
    return true;
  },
  cancelEdit: function () {
    const me = this;
    if (!me.editing) { return; }
    const ctx = me.context;
    me.$close();
    fireBoth(me, me.grid, 'canceledit', me, ctx);
  },
  $close: function () {
    const me = this;
    if (me.$keyL) { me.$keyL.forEach((d: any) => d.destroy()); me.$keyL = null; }
    if (me.$editorCmp) { me.$editorCmp.hide(); }
    me.editing = false;
    me.context = null;
  }
});

// ---------------------------------------------------------------- Row expander
define('Ext.grid.plugin.RowExpander', {
  extend: 'Ext.plugin.Abstract',
  alias: 'plugin.rowexpander',
  ptype: 'rowexpander',
  expandOnDblClick: true,
  expandOnEnter: true,
  selectRowOnExpand: false,
  headerWidth: 24,
  init: function (grid: any) {
    const me = this;
    me.grid = me.cmp = grid;
    const view = me.view = grid.getView();
    me.$expanded = new Set();
    me.$tpl = me.rowBodyTpl && me.rowBodyTpl.isTemplate ? me.rowBodyTpl : new Ext.XTemplate(me.rowBodyTpl || '');
    view.$isExpanded = (r: any) => me.$expanded.has(r);
    view.$rowBodyHtml = (r: any) => {
      if (!me.$expanded.has(r)) { return null; }
      const cols = view.$cols ? view.$cols.length : 1;
      let html = '';
      try { html = me.$tpl.apply(me.getRowBodyData ? me.getRowBodyData(r) : r.getData()); } catch (e) { html = ''; }
      return <tr key="$rowbody" className="x-grid-rowbody-tr"><td className="x-grid-td x-grid-cell-rowbody" colSpan={cols}><div className="x-grid-rowbody" dangerouslySetInnerHTML={{ __html: html }} /></td></tr>;
    };
    const cfg = me.getHeaderConfig();
    grid.headerCt.insert(0, cfg);
    grid.headerCt.$invalidate();
    if (me.expandOnDblClick) { view.on('itemdblclick', (v: any, rec: any, item: any, idx: number) => me.toggleRow(idx, rec)); }
    if (me.expandOnEnter) { view.on('itemkeyenter', (v: any, rec: any, idx: number) => me.toggleRow(idx, rec)); }
  },
  getHeaderConfig: function () {
    const me = this;
    return {
      xtype: 'gridcolumn', isExpanderColumn: true, width: me.headerWidth, text: '&#160;', sortable: false, hideable: false, menuDisabled: true, resizable: false, draggable: false,
      tdCls: 'x-grid-cell-row-expander x-grid-cell-special', innerCls: 'x-grid-cell-inner-row-expander', ignoreExport: true, lockable: false,
      $hasDefaultRenderer: true,
      defaultRenderer: function (v: any, meta: any, rec: any) { return '<div class="x-grid-row-expander' + (me.$expanded.has(rec) ? ' x-grid-row-expander-expanded' : '') + '" role="button"></div>'; },
      processEvent: function (type: string, view: any, cell: any, rowIndex: number, cellIndex: number, e: any, rec: any) {
        if (e.getTarget('.x-grid-row-expander')) {
          if (type === 'mousedown') { e.preventDefault(); return me.selectRowOnExpand; }
          if (type === 'click') { me.toggleRow(rowIndex, rec); return me.selectRowOnExpand; }
        }
        return true;
      }
    };
  },
  toggleRow: function (rowIdx: number, record?: any) {
    const me = this;
    const rec = record || me.grid.getStore().getAt(rowIdx);
    if (!rec) { return; }
    const view = me.view;
    const expanding = !me.$expanded.has(rec);
    if (expanding) { me.$expanded.add(rec); } else { me.$expanded.delete(rec); }
    view.refreshNode(rec);
    const node = view.getNode(rec);
    const body = node ? node.querySelector('.x-grid-rowbody') : null;
    view.fireEvent(expanding ? 'expandbody' : 'collapsebody', node, rec, body);
  },
  isExpanded: function (rec: any) { return this.$expanded.has(rec); },
  collapseAll: function () { const me = this; for (const r of Array.from(me.$expanded)) { me.$expanded.delete(r); me.view.refreshNode(r); } }
});

// ---------------------------------------------------------------- Grid filters
function filterId(col: any) { return 'x-gridfilter-' + (col.filter && col.filter.dataIndex || col.dataIndex); }

define('Ext.grid.filters.Filters', {
  extend: 'Ext.plugin.Abstract',
  alias: 'plugin.gridfilters',
  ptype: 'gridfilters',
  menuFilterText: 'Filters',
  showMenu: true,
  stateId: undefined,
  init: function (grid: any) {
    const me = this;
    me.grid = me.cmp = grid;
    me.$initColumns();
    grid.on('reconfigure', () => me.$initColumns());
    me.$applyAll(true);
  },
  $columns: function () { return this.grid.headerCt.getGridColumns().filter((c: any) => c.filter !== undefined && c.filter !== null && c.filter !== false && c.dataIndex); },
  $initColumns: function () {
    const me = this;
    for (const c of me.$columns()) {
      if (c.filter.isGridFilter) { continue; }
      let cfg = c.filter;
      if (cfg === true) { cfg = { type: 'string' }; }
      if (typeof cfg === 'string') { cfg = { type: cfg }; }
      cfg = Ext.apply({ type: 'string' }, cfg);
      const f: any = { isGridFilter: true, type: cfg.type, dataIndex: cfg.dataIndex || c.dataIndex, column: c, active: false, value: undefined, cfg };
      if (cfg.value !== undefined) { f.value = cfg.value; f.active = cfg.active !== false && me.$hasValue(f, cfg.value); }
      if (cfg.type === 'numeric') { f.type = 'number'; }
      c.filter = f;
    }
  },
  $hasValue: function (f: any, v: any) {
    if (v === null || v === undefined || v === '') { return false; }
    if (f.type === 'list') { return Ext.isArray(v) ? v.length > 0 : true; }
    if (f.type === 'number' || f.type === 'date') { return typeof v === 'object' && !(v instanceof Date) ? Object.keys(v).some((k) => v[k] !== null && v[k] !== undefined && v[k] !== '') : true; }
    return true;
  },
  /** store filter for one grid filter */
  $storeFilters: function (f: any) {
    const di = f.dataIndex;
    const id = filterId(f.column);
    const v = f.value;
    if (f.type === 'string') { return [{ id, property: di, value: String(v), operator: 'like', anyMatch: true, filterFn: (r: any) => { const x = r.get(di); return x !== null && x !== undefined && String(x).toLowerCase().indexOf(String(v).toLowerCase()) >= 0; } }]; }
    if (f.type === 'boolean') { const want = v === true || v === 'true'; return [{ id, property: di, value: want, operator: '==', filterFn: (r: any) => !!r.get(di) === want }]; }
    if (f.type === 'list') { const vals = Ext.Array.from(v).map(String); return [{ id, property: di, value: vals, operator: 'in', filterFn: (r: any) => vals.indexOf(String(r.get(di))) >= 0 }]; }
    const out: any[] = [];
    const ops: Record<string, (a: any, b: any) => boolean> = { lt: (a, b) => a < b, gt: (a, b) => a > b, eq: (a, b) => a === b };
    const vv = typeof v === 'object' && !(v instanceof Date) ? v : { eq: v };
    for (const op of ['lt', 'gt', 'eq']) {
      let target = vv[op];
      if (target === null || target === undefined || target === '') { continue; }
      if (f.type === 'date') {
        const d = target instanceof Date ? target : Ext.Date.parse(target, 'Y-m-d') || new Date(target);
        const t = Ext.Date.clearTime(d, true).getTime();
        out.push({ id: id + '-' + op, property: di, operator: op, value: d, filterFn: (r: any) => { const x = r.get(di); if (!x) { return false; } const xd = x instanceof Date ? x : new Date(x); return ops[op](Ext.Date.clearTime(xd, true).getTime(), t); } });
      } else {
        target = Number(target);
        out.push({ id: id + '-' + op, property: di, operator: op, value: target, filterFn: (r: any) => { const x = r.get(di); if (x === null || x === undefined || x === '') { return false; } return ops[op](Number(x), target); } });
      }
    }
    return out;
  },
  $applyAll: function (silent?: boolean) {
    const me = this;
    const store = me.grid.getStore();
    if (!store || !store.getFilters) { return; }
    const fc = store.getFilters();
    const existing = (fc.items || []).filter((x: any) => String(x.id || '').indexOf('x-gridfilter-') === 0);
    const add: any[] = [];
    for (const c of me.$columns()) { const f = c.filter; if (f && f.isGridFilter && f.active) { add.push(...me.$storeFilters(f)); } }
    if (!existing.length && !add.length) { return; }
    fc.$silent = true;
    for (const x of existing) { fc.remove(x); }
    if (add.length) { fc.add(add); }
    fc.$silent = false;
    store.$suppressFilterEvent = !!silent;
    store.$onFiltersChanged();
    store.$suppressFilterEvent = false;
    for (const c of me.$columns()) { c.updateUI(); }
    if (!silent) { me.grid.fireEvent('filterchange', store, store.getFilters().items); }
  },
  $setValue: function (f: any, v: any) {
    const me = this;
    f.value = v;
    f.active = me.$hasValue(f, v);
    me.$applyAll();
  },
  setActive: function (col: any, active: boolean) { const f = col.filter; if (f && f.isGridFilter) { f.active = !!active && me_hasValue(this, f); this.$applyAll(); } },
  clearFilters: function (autoFilter?: boolean) {
    const me = this;
    void autoFilter;
    for (const c of me.$columns()) { const f = c.filter; if (f && f.isGridFilter) { f.active = false; f.value = undefined; } }
    me.$applyAll();
  },
  getFilters: function () { return this.$columns().map((c: any) => c.filter).filter((f: any) => f && f.active); },
  addFilter: function (cfg: any) {
    const me = this;
    const col = me.grid.headerCt.getGridColumns().find((c: any) => c.dataIndex === cfg.dataIndex);
    if (!col) { return; }
    col.filter = cfg;
    me.$initColumns();
    me.$applyAll();
  },
  $listOptions: function (f: any) {
    const me = this;
    if (f.cfg.options) { return f.cfg.options.map((o: any) => (Ext.isArray(o) ? { id: o[0], text: o[1] } : typeof o === 'object' ? { id: o.id !== undefined ? o.id : o.value, text: o.text || o.label || o.id } : { id: o, text: o })); }
    const store = me.grid.getStore();
    const src = store.getData && store.getData().getSource ? (store.getData().getSource() || store.getData()) : null;
    const items = src && src.items ? src.items : store.getRange();
    const seen = new Set();
    const out: any[] = [];
    for (const r of items) { const v = r.get(f.dataIndex); if (v === null || v === undefined || v === '' || seen.has(String(v))) { continue; } seen.add(String(v)); out.push({ id: String(v), text: String(v) }); }
    out.sort((a, b) => String(a.text).localeCompare(String(b.text)));
    return out;
  },
  $menuItems: function (f: any) {
    const me = this;
    const t = f.type;
    if (t === 'string') {
      return [{ xtype: 'textfield', emptyText: 'Enter Filter Text...', width: 180, value: f.value || '', hideLabel: true, margin: 4, enableKeyEvents: true,
        listeners: { change: { fn: (fld: any, v: any) => me.$setValue(f, v), buffer: 500 } } }];
    }
    if (t === 'boolean') {
      const g = 'gf-' + f.dataIndex + '-' + me.grid.id;
      return [{ xtype: 'menucheckitem', text: f.cfg.yesText || 'Yes', group: g, checked: f.value === true, checkHandler: (i: any, c: boolean) => { if (c) { me.$setValue(f, true); } } },
        { xtype: 'menucheckitem', text: f.cfg.noText || 'No', group: g, checked: f.value === false, checkHandler: (i: any, c: boolean) => { if (c) { me.$setValue(f, false); } } }];
    }
    if (t === 'list') {
      const sel = new Set(Ext.Array.from(f.value).map(String));
      return me.$listOptions(f).map((o: any) => ({ xtype: 'menucheckitem', text: Ext.String.htmlEncode(String(o.text)), checked: sel.has(String(o.id)), hideOnClick: false,
        checkHandler: (i: any, c: boolean) => { if (c) { sel.add(String(o.id)); } else { sel.delete(String(o.id)); } me.$setValue(f, Array.from(sel)); } }));
    }
    const cur = typeof f.value === 'object' && f.value && !(f.value instanceof Date) ? Ext.apply({}, f.value) : {};
    const set = (op: string, v: any) => { if (v === null || v === undefined || v === '') { delete cur[op]; } else { cur[op] = v; } me.$setValue(f, Object.keys(cur).length ? Ext.apply({}, cur) : undefined); };
    if (t === 'number') {
      const fld = (op: string, label: string) => ({ xtype: 'numberfield', fieldLabel: label, labelWidth: 20, labelSeparator: '', width: 170, margin: 4, hideTrigger: false, value: cur[op], decimalPrecision: 4,
        listeners: { change: { fn: (x: any, v: any) => set(op, v), buffer: 500 } } });
      return [fld('lt', '<'), fld('gt', '>'), '-', fld('eq', '=')];
    }
    if (t === 'date') {
      const fmt = f.cfg.dateFormat || Ext.Date.defaultFormat;
      const item = (op: string, text: string) => ({
        xtype: 'menucheckitem', text, checked: cur[op] !== undefined, hideOnClick: false,
        checkHandler: (i: any, c: boolean) => { if (!c) { set(op, null); } },
        menu: { items: [{ xtype: 'datepicker', value: cur[op] || new Date(), format: fmt, listeners: { select: (p: any, d: Date) => { set(op, d); } } }] }
      });
      return [item('lt', 'Before'), item('gt', 'After'), '-', item('eq', 'On')];
    }
    return [];
  },
  $extendHeaderMenu: function (items: any[], col: any) {
    const me = this;
    const f = col.filter;
    if (!f || !f.isGridFilter || me.disabled) { return; }
    items.push('-', {
      xtype: 'menucheckitem', text: me.menuFilterText, itemId: 'filters', checked: !!f.active, hideOnClick: false,
      checkHandler: (i: any, c: boolean) => { if (!c) { f.active = false; me.$applyAll(); } else if (me.$hasValue(f, f.value)) { f.active = true; me.$applyAll(); } else { i.setChecked(false, true); } },
      menu: { items: me.$menuItems(f), plain: true }
    });
  },
  $saveState: function (state: any) {
    const list = this.getFilters().map((f: any) => ({ dataIndex: f.dataIndex, type: f.type, value: f.value instanceof Date ? Ext.Date.format(f.value, 'c') : f.value }));
    state.storeState = state.storeState || {};
    state.storeState.filters = list;
  },
  $applyState: function (state: any) {
    const me = this;
    const list = state && state.storeState && state.storeState.filters;
    if (!list) { return; }
    for (const s of list) {
      const col = me.$columns().find((c: any) => c.filter && c.filter.dataIndex === s.dataIndex);
      if (!col || !col.filter.isGridFilter) { continue; }
      let v = s.value;
      if (col.filter.type === 'date') {
        const conv = (x: any) => (typeof x === 'string' ? new Date(x) : x);
        v = typeof v === 'object' && v && !(v instanceof Date) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)])) : conv(v);
      }
      col.filter.value = v;
      col.filter.active = me.$hasValue(col.filter, v);
    }
    me.$applyAll(true);
  }
});
function me_hasValue(p: any, f: any) { return p.$hasValue(f, f.value); }
Ext.ClassManager.classes['Ext.ux.grid.FiltersFeature'] = Ext.ClassManager.get('Ext.grid.filters.Filters');
