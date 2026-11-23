/**
 * Grid columns and the header container.
 *
 * Ext.grid.header.Container holds the columns (grouped headers nest), computes the pixel width of every leaf
 * column (fixed widths, then flex shares of what is left), renders the header row and handles sorting, the
 * column menu, resizing and drag reordering. Leaf columns describe their cells: renderer / defaultRenderer
 * with Ext's metaData, tdCls, align, processEvent; subclasses: number, date, boolean, template, check, action,
 * rownumberer and widget.
 */
import * as React from 'react';
import { Ext } from '../../core/ext';
import { define } from '../../core/class';
import { clsList, renderCmps, flushRender } from '../render';
import '../container';
import '../menu';

let colSeed = 0;

// ---------------------------------------------------------------- Column
export const Column: any = define('Ext.grid.column.Column', {
  extend: 'Ext.container.Container',
  alias: ['widget.gridcolumn'],
  isColumn: true,
  isHeader: false,
  baseCls: 'x-column-header',
  defaultWidth: 100,
  sortable: true,
  hideable: true,
  menuDisabled: false,
  resizable: true,
  draggable: true,
  groupable: true,
  align: 'start',
  emptyCellText: '&#160;',
  defaultType: 'textfield',
  producesHTML: true,
  ignoreExport: false,
  layout: { type: 'hbox', align: 'stretch' },
  constructor: function (config?: any) {
    const me = this;
    const cfg = Ext.apply({}, config);
    if (cfg.header !== undefined && cfg.text === undefined) { cfg.text = cfg.header; }
    if (cfg.columns) { cfg.$groupColumns = cfg.columns; delete cfg.columns; }
    return me.callParent([cfg]);
  },
  initComponent: function () {
    const me = this;
    if (!me.$colId) { me.$colId = me.stateId || me.dataIndex || ('col' + (++colSeed)); }
    me.$uid = 'c' + (++colSeed);
    if (me.$groupColumns) {
      me.isGroupHeader = true;
      me.items = me.$groupColumns.map((c: any) => (c && c.isComponent ? c : Ext.apply({ xtype: c.xtype || 'gridcolumn' }, c)));
      me.layout = 'auto';
      me.defaultType = 'gridcolumn';
    }
    if (me.renderer && typeof me.renderer === 'string' && Ext.util.Format[me.renderer] && !me.$rendererIsController) { me.renderer = Ext.util.Format[me.renderer]; }
    if (me.formatter && !me.renderer) { me.renderer = parseFormatter(me.formatter); }
    if (me.editor || me.field) { me.$editorCfg = me.editor || me.field; }
    me.callParent();
  },
  // header items are components, group headers hold child columns
  getGridColumns: function () {
    if (!this.isGroupHeader) { return [this]; }
    const out: any[] = [];
    for (const c of this.items.items) { out.push(...(c.getGridColumns ? c.getGridColumns() : [])); }
    return out;
  },
  getColumns: function () { return this.isGroupHeader ? this.items.items.filter((c: any) => c.isColumn) : []; },
  getOwnerHeaderCt: function () { let c = this.ownerCt; while (c && !c.isRootHeader) { c = c.ownerCt; } return c; },
  getRootHeaderCt: function () { return this.getOwnerHeaderCt(); },
  $grid: function () { const h = this.getOwnerHeaderCt(); return h ? h.grid : null; },
  up: function (selector?: string, limit?: any) {
    // columns live under the grid's header container
    return this.callParent([selector, limit]);
  },
  getView: function () { const g = this.$grid(); return g ? g.getView() : null; },
  getIndex: function () { const h = this.getOwnerHeaderCt(); return h ? h.getGridColumns().indexOf(this) : -1; },
  getVisibleIndex: function () { const h = this.getOwnerHeaderCt(); return h ? h.getVisibleGridColumns().indexOf(this) : -1; },
  isVisible: function (deep?: boolean) {
    if (this.hidden) { return false; }
    if (deep) { let c = this.ownerCt; while (c && !c.isRootHeader) { if (c.hidden) { return false; } c = c.ownerCt; } }
    return true;
  },
  isLocked: function () { return !!this.locked; },
  getText: function () { return this.text; },
  setText: function (t: string) { this.text = t; this.updateUI(); return this; },
  getSortParam: function () { return this.dataIndex; },
  isSortable: function () { return this.sortable !== false && !!this.dataIndex && !this.isGroupHeader; },
  getEditor: function (record?: any, defaultField?: any) {
    const me = this;
    void record;
    if (me.$editor && !me.$editor.destroyed) { return me.$editor; }
    let cfg = me.$editorCfg || defaultField;
    if (!cfg) { return null; }
    if (typeof cfg === 'string') { cfg = { xtype: cfg }; }
    me.$editor = cfg.isComponent ? cfg : Ext.widget(cfg.xtype || 'textfield', Ext.apply({ hideLabel: true, isEditorField: true, excludeForm: true }, cfg));
    me.$editor.$column = me;
    return me.$editor;
  },
  setEditor: function (cfg: any) { const me = this; if (me.$editor) { me.$editor.destroy(); me.$editor = null; } me.$editorCfg = cfg; me.editor = cfg; },
  hasEditor: function () { return !!(this.$editorCfg || this.$editor); },
  getCellWidth: function () { return this.$w !== undefined ? this.$w : (this.width || this.defaultWidth); },
  getWidth: function () { return this.$w !== undefined ? this.$w : (typeof this.width === 'number' ? this.width : this.defaultWidth); },
  setWidth: function (w: any) {
    const me = this;
    me.width = w;
    me.flex = undefined;
    me.$relayoutGrid();
    const h = me.getOwnerHeaderCt();
    if (h && h.grid) { h.grid.fireEvent('columnresize', h, me, w); }
    return me;
  },
  setFlex: function (f: number) { this.flex = f; this.$relayoutGrid(); },
  setHidden: function (h: boolean) { return h ? this.hide() : this.show(); },
  show: function () {
    const me = this;
    if (!me.hidden) { return me; }
    me.hidden = false;
    me.$relayoutGrid();
    me.fireEvent('show', me);
    const h = me.getOwnerHeaderCt();
    if (h && h.grid) { h.grid.fireEvent('columnshow', h, me); }
    return me;
  },
  hide: function () {
    const me = this;
    if (me.hidden) { return me; }
    me.hidden = true;
    me.$relayoutGrid();
    me.fireEvent('hide', me);
    const h = me.getOwnerHeaderCt();
    if (h && h.grid) { h.grid.fireEvent('columnhide', h, me); }
    return me;
  },
  $relayoutGrid: function () {
    const h = this.getOwnerHeaderCt();
    if (h) { h.$invalidate(); }
    this.updateUI();
  },
  sort: function (direction?: string) {
    const me = this;
    const g = me.$grid();
    const store = g && g.getStore();
    if (!store || !me.isSortable()) { return; }
    const prop = me.getSortParam();
    const cur = store.getSorters ? store.getSorters().get ? store.getSorters().get(prop) : null : null;
    const curDir = cur ? cur.getDirection ? cur.getDirection() : cur.direction : null;
    const dir = direction || (curDir === 'ASC' ? 'DESC' : 'ASC');
    const sorter: any = { property: prop, direction: dir };
    if (me.sorter && typeof me.sorter === 'object') { Ext.apply(sorter, me.sorter); sorter.direction = dir; }
    if (typeof me.sorter === 'function') { sorter.sorterFn = me.sorter; }
    store.sort([sorter]);
    g.fireEvent('sortchange', g.headerCt, me, dir);
  },
  $sortState: function () {
    const g = this.$grid();
    const store = g && g.getStore();
    if (!store || !store.getSorters || !this.dataIndex) { return null; }
    const s = store.getSorters();
    const first = s.getAt ? s.getAt(0) : s.items && s.items[0];
    if (!first) { return null; }
    const prop = first.getProperty ? first.getProperty() : first.property;
    if (prop !== this.getSortParam()) { return null; }
    return first.getDirection ? first.getDirection() : first.direction;
  },

  // ---- cells
  /** Called with (value, metaData, record, rowIndex, colIndex, store, view); returns HTML. */
  $renderCell: function (record: any, rowIndex: number, colIndex: number, view: any) {
    const me = this;
    const value = me.dataIndex ? record.get(me.dataIndex) : undefined;
    const meta: any = { tdCls: '', tdAttr: '', tdStyle: '', style: '', record, column: me, value, rowIndex, colIndex, align: me.align, innerCls: '' };
    let out: any;
    const r = me.renderer;
    if (r) {
      let fn = r, scope = me.scope || me;
      if (typeof r === 'string') {
        const target = me.$resolveScope(r);
        fn = target ? target[r] : null;
        scope = target;
        if (!fn && Ext.util.Format[r]) { fn = Ext.util.Format[r]; scope = Ext.util.Format; }
      }
      out = fn ? fn.call(scope, value, meta, record, rowIndex, colIndex, view.getStore(), view) : value;
    } else if (me.defaultRenderer !== Column.prototype.defaultRenderer || me.$hasDefaultRenderer) {
      out = me.defaultRenderer(value, meta, record, rowIndex, colIndex, view.getStore(), view);
    } else {
      out = value;
    }
    if (out === undefined || out === null || out === '') { out = me.emptyCellText; }
    else if (out instanceof Date) { out = Ext.Date.format(out, Ext.Date.defaultFormat); }
    return { html: String(out), meta };
  },
  defaultRenderer: function (v: any) { return v; },
  $resolveScope: function (name: string) {
    const me = this;
    if (me.scope && typeof me.scope === 'object' && me.scope[name]) { return me.scope; }
    const g = me.$grid();
    let c = g ? g.lookupController() : null;
    while (c) { if (c[name]) { return c; } const v = c.getView && c.getView(); c = v && v.lookupController ? v.lookupController(true) : null; }
    if (g && g[name]) { return g; }
    return null;
  },
  processEvent: function (type: string, view: any, cell: any, recordIndex: number, cellIndex: number, e: any, record: any, row: any) {
    void type; void view; void cell; void recordIndex; void cellIndex; void e; void record; void row;
    return true;
  },
  $cellExtraCls: function () { return null; },

  // ---- header rendering
  getRootCls: function () {
    const me = this;
    const sort = me.$sortState();
    const filtered = me.filter && me.filter.active;
    return clsList(me.baseCls, 'x-column-header-default', 'x-box-item', 'x-unselectable', 'x-column-header-align-' + (me.align === 'right' || me.align === 'end' ? 'right' : me.align === 'center' ? 'center' : 'left'),
      me.isGroupHeader ? 'x-group-header' : 'x-leaf-column-header', sort ? ['x-column-header-sort-' + sort, 'x-column-header-sort-' + sort.toLowerCase()] : null,
      me.$over ? 'x-column-header-over' : null, filtered ? 'x-grid-filters-filtered-column' : null, me.locked ? 'x-column-header-locked' : null,
      me.cls, me.$addedCls, me.isCheckerHd ? 'x-column-header-checkbox' : null, me.$menuOpen ? 'x-column-header-open' : null);
  },
  $headerText: function () {
    const t = this.text;
    return t === undefined || t === null || t === '' ? '&#160;' : String(t);
  },
  $headerInner: function () { return null; },
  renderHeader: function (ref?: any) {
    const me = this;
    const left = me.$stickyLeft;
    const h = me.getOwnerHeaderCt();
    const w = me.getWidth();
    const st: any = { width: w, minWidth: w, maxWidth: w, flex: '0 0 auto', boxSizing: 'border-box', display: me.hidden ? 'none' : 'flex', flexDirection: 'column', position: me.locked ? 'sticky' : 'relative' };
    if (me.locked) { st.left = left || 0; st.zIndex = 3; }
    const leaf = !me.isGroupHeader;
    const inner = me.$headerInner();
    const showMenu = leaf && !me.menuDisabled && h && h.$menuEnabled();
    return (
      <div key={me.$uid} id={me.id} ref={ref} className={me.getRootCls()} style={st} data-columnid={me.$uid} role="columnheader"
        data-qtip={me.tooltip || undefined}
        onMouseEnter={() => { me.$over = true; me.updateUI(); if (h) { h.updateUI(); } }}
        onMouseLeave={() => { me.$over = false; me.updateUI(); if (h) { h.updateUI(); } }}
        draggable={!!(h && h.$moveEnabled() && me.draggable !== false && !me.locked)}
        onDragStart={(e) => h && h.$onDragStart(me, e)} onDragOver={(e) => h && h.$onDragOver(me, e)} onDrop={(e) => h && h.$onDrop(me, e)}>
        <div className={clsList('x-column-header-inner', leaf ? 'x-leaf-column-header' : null, me.$innerCls)}
          style={{ display: 'flex', alignItems: 'center', cursor: leaf && me.isSortable() && h && h.$sortEnabled() ? 'pointer' : 'default', flex: leaf && !me.items.getCount() ? '1 1 auto' : '0 0 auto', minHeight: 0 }}
          onClick={(e) => { if ((e.target as any).closest('.x-column-header-trigger, .x-column-header-resizer')) { return; } if (h) { h.$onHeaderClick(me, e); } }}>
          <div className="x-column-header-text-container" style={{ flex: '1 1 auto', minWidth: 0, textAlign: me.align === 'right' || me.align === 'end' ? 'right' : me.align === 'center' ? 'center' : 'left' }}>
            <div className="x-column-header-text-wrapper">
              <div className="x-column-header-text">
                {inner && typeof inner !== 'string' ? inner : <span className="x-column-header-text-inner" dangerouslySetInnerHTML={{ __html: typeof inner === 'string' ? inner : me.$headerText() }} />}
              </div>
            </div>
          </div>
          {showMenu ? <div className="x-column-header-trigger x-fa fa-caret-down" role="button" onClick={(e) => { e.stopPropagation(); h.showMenuBy(me, e.currentTarget); }} /> : null}
        </div>
        {leaf && me.items.getCount() ? <div className="x-column-header-items" style={{ display: 'flex', alignItems: 'stretch' }}
          onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} draggable={false}
          onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}>{renderCmps(me.items.items)}</div> : null}
        {me.isGroupHeader ? <div className="x-group-sub-header-ct" style={{ display: 'flex' }}>{renderCmps(me.items.items.filter((c: any) => c.isColumn))}</div> : null}
        {leaf && me.resizable !== false && h && h.$resizeEnabled() ? <div className="x-column-header-resizer" onMouseDown={(e) => h.$startResize(me, e)} onClick={(e) => e.stopPropagation()}
          style={{ position: 'absolute', right: -3, top: 0, bottom: 0, width: 7, cursor: 'col-resize', zIndex: 2 }} /> : null}
      </div>
    );
  },
  renderRoot: function (ref: any) { return this.renderHeader(ref); },
  $observeSize: Ext.emptyFn,
  doDestroy: function () { if (this.$editor) { this.$editor.destroy(); } this.callParent(); }
});

function parseFormatter(f: string) {
  // 'number("0,000.00")', 'date("d-M-Y")', 'usMoney'
  const m = /^\s*(\w+)\s*(?:\((.*)\))?\s*$/.exec(f);
  if (!m) { return null; }
  const fn = Ext.util.Format[m[1]];
  if (!fn) { return null; }
  let args: any[] = [];
  if (m[2]) { try { args = JSON.parse('[' + m[2].replace(/'/g, '"') + ']'); } catch (e) { args = [m[2].replace(/['"]/g, '')]; } }
  return (v: any) => fn(v, ...args);
}

// ---------------------------------------------------------------- subclasses
define('Ext.grid.column.Number', {
  extend: 'Ext.grid.column.Column',
  alias: ['widget.numbercolumn'],
  format: '0,000.00',
  align: 'right',
  $hasDefaultRenderer: true,
  defaultRenderer: function (v: any) { return v === null || v === undefined || v === '' ? '' : Ext.util.Format.number(v, this.format); }
});
define('Ext.grid.column.Date', {
  extend: 'Ext.grid.column.Column',
  alias: ['widget.datecolumn'],
  format: undefined,
  $hasDefaultRenderer: true,
  defaultRenderer: function (v: any) {
    if (v === null || v === undefined || v === '') { return ''; }
    const d = v instanceof Date ? v : Ext.Date.parse(v, 'c') || new Date(v);
    return Ext.Date.format(d, this.format || Ext.Date.defaultFormat);
  }
});
define('Ext.grid.column.Boolean', {
  extend: 'Ext.grid.column.Column',
  alias: ['widget.booleancolumn'],
  trueText: 'true',
  falseText: 'false',
  undefinedText: '&#160;',
  $hasDefaultRenderer: true,
  defaultRenderer: function (v: any) {
    if (v === undefined || v === null) { return this.undefinedText; }
    if (!v || v === 'false') { return this.falseText; }
    return this.trueText;
  }
});
define('Ext.grid.column.Template', {
  extend: 'Ext.grid.column.Column',
  alias: ['widget.templatecolumn'],
  $hasDefaultRenderer: true,
  initComponent: function () {
    const me = this;
    me.$tpl = me.tpl && me.tpl.isTemplate ? me.tpl : new Ext.XTemplate(me.tpl);
    me.tpl = null;
    me.callParent();
  },
  defaultRenderer: function (v: any, meta: any, rec: any) { const d = Ext.apply({}, rec.getData ? rec.getData() : rec.data); return this.$tpl.apply(d); }
});
define('Ext.grid.column.RowNumberer', {
  extend: 'Ext.grid.column.Column',
  alias: ['widget.rownumberer'],
  isRowNumberer: true,
  text: '&#160;',
  width: 40,
  sortable: false,
  hideable: false,
  menuDisabled: true,
  draggable: false,
  resizable: false,
  align: 'right',
  tdCls: 'x-grid-cell-row-numberer x-grid-cell-special',
  innerCls: 'x-grid-cell-inner-row-numberer',
  $hasDefaultRenderer: true,
  defaultRenderer: function (v: any, meta: any, rec: any, rowIndex: number, colIndex: number, store: any) {
    let n = rowIndex + 1;
    if (store && store.currentPage && store.pageSize && !store.isTreeStore) { n += (store.currentPage - 1) * store.pageSize; }
    return String(n);
  }
});
define('Ext.grid.column.Check', {
  extend: 'Ext.grid.column.Column',
  alias: ['widget.checkcolumn'],
  isCheckColumn: true,
  align: 'center',
  stopSelection: true,
  headerCheckbox: false,
  tdCls: 'x-grid-cell-checkcolumn',
  innerCls: 'x-grid-cell-inner-checkcolumn',
  $hasDefaultRenderer: true,
  defaultRenderer: function (value: any, meta?: any) {
    const me = this;
    const disabled = me.disabled || (meta && meta.record && me.isRecordChecked === undefined && false);
    let cls = 'x-grid-checkcolumn';
    if (value) { cls += ' x-grid-checkcolumn-checked'; }
    if (meta) { meta.tdCls = (meta.tdCls || '') + (disabled ? ' x-item-disabled' : ''); }
    return '<span class="' + cls + '" role="button" tabIndex="0"></span>';
  },
  processEvent: function (type: string, view: any, cell: any, recordIndex: number, cellIndex: number, e: any, record: any) {
    const me = this;
    if (me.disabled) { return !me.stopSelection; }
    if ((type === 'click' && e.getTarget('.x-grid-checkcolumn')) || (type === 'keydown' && (e.getKey() === 32 || e.getKey() === 13))) {
      const checked = !me.isRecordChecked(record);
      if (me.fireEvent('beforecheckchange', me, recordIndex, checked, record, e) !== false) {
        me.setRecordCheck(record, recordIndex, checked, cell, e);
        me.fireEvent('checkchange', me, recordIndex, checked, record, e);
      }
      return !me.stopSelection;
    }
    if (type === 'mousedown' || type === 'click') { return !me.stopSelection || !e.getTarget('.x-grid-checkcolumn'); }
    return true;
  },
  isRecordChecked: function (rec: any) { const v = rec.get(this.dataIndex); return !!v; },
  setRecordCheck: function (rec: any, idx: number, checked: boolean) { rec.set(this.dataIndex, checked); },
  setDisabled: function (d: boolean) { this.disabled = d; this.$relayoutGrid(); }
});
define('Ext.grid.column.Action', {
  extend: 'Ext.grid.column.Column',
  alias: ['widget.actioncolumn'],
  isActionColumn: true,
  sortable: false,
  menuDisabled: false,
  align: 'center',
  stopSelection: true,
  innerCls: 'x-grid-cell-inner-action-col',
  tdCls: 'x-action-col-cell',
  $hasDefaultRenderer: true,
  initComponent: function () {
    const me = this;
    me.$actions = me.items && me.items.length !== undefined && !me.items.isCollection ? me.items.slice() : (me.items && !me.items.isCollection ? [me.items] : []);
    if (!me.$actions.length && (me.handler || me.iconCls || me.icon)) { me.$actions = [{ handler: me.handler, iconCls: me.iconCls, icon: me.icon, tooltip: me.tooltip, getClass: me.getClass, isDisabled: me.isDisabled, scope: me.scope }]; }
    me.items = [];
    me.callParent();
  },
  defaultRenderer: function (v: any, meta: any, rec: any, rowIndex: number, colIndex: number, store: any, view: any) {
    const me = this;
    let html = '';
    me.$actions.forEach((it: any, i: number) => {
      const scope = it.scope || me.scope || me;
      const cls = it.getClass ? (typeof it.getClass === 'string' ? (me.$resolveScope(it.getClass) || {})[it.getClass] : it.getClass).call(scope, v, meta, rec, rowIndex, colIndex, store, view) : '';
      const disabled = it.disabled || (it.isDisabled ? it.isDisabled.call(scope, view, rowIndex, colIndex, it, rec) : false);
      const tip = it.tooltip || (it.getTip ? it.getTip.call(scope, v, meta, rec, rowIndex, colIndex, store) : '');
      const icon = it.iconCls || '';
      html += '<span role="button" class="x-action-col-icon x-action-col-' + i + ' ' + icon + ' ' + (cls || '') + (disabled ? ' x-item-disabled' : '') + '"' +
        (tip ? ' data-qtip="' + Ext.String.htmlEncode(tip) + '"' : '') + (it.icon ? ' style="background-image:url(' + it.icon + ')"' : '') + '></span>';
    });
    return html;
  },
  processEvent: function (type: string, view: any, cell: any, recordIndex: number, cellIndex: number, e: any, record: any, row: any) {
    const me = this;
    const target = e.getTarget('.x-action-col-icon');
    if (target) {
      const m = /x-action-col-(\d+)/.exec(target.className);
      const it = m ? me.$actions[Number(m[1])] : null;
      if (it) {
        const scope = it.scope || me.scope || me;
        const disabled = target.classList.contains('x-item-disabled');
        if (type === 'click' && !disabled) {
          const h = it.handler || me.handler;
          if (h) {
            const fn = typeof h === 'string' ? (me.$resolveScope(h) || {})[h] : h;
            const sc = typeof h === 'string' ? me.$resolveScope(h) : scope;
            if (fn) { fn.call(sc, view, recordIndex, cellIndex, it, e, record, row); }
          }
        }
        if (type === 'click' || type === 'mousedown') { return !me.stopSelection; }
      }
    }
    return true;
  },
  getRefItems: function () { return []; }
});
define('Ext.grid.column.Widget', {
  extend: 'Ext.grid.column.Column',
  alias: ['widget.widgetcolumn'],
  $hasDefaultRenderer: true,
  defaultRenderer: function (v: any) { return v === null || v === undefined ? '' : String(v); }
});

// ---------------------------------------------------------------- Header container
export const HeaderContainer: any = define('Ext.grid.header.Container', {
  extend: 'Ext.container.Container',
  alias: 'widget.headercontainer',
  isRootHeader: true,
  isGroupHeader: false,
  baseCls: 'x-grid-header-ct',
  defaultType: 'gridcolumn',
  sortable: true,
  enableColumnHide: true,
  enableColumnMove: true,
  enableColumnResize: true,
  layout: 'auto',
  initComponent: function () {
    const me = this;
    me.callParent();
    me.$availWidth = 0;
  },
  lookupComponent: function (cfg: any) {
    if (cfg && !cfg.isComponent && this.columnDefaults) { cfg = Ext.applyIf(Ext.apply({}, cfg), this.columnDefaults); }
    return this.callParent([cfg]);
  },
  getGridColumns: function () {
    const out: any[] = [];
    for (const c of this.items.items) { if (c.getGridColumns) { out.push(...c.getGridColumns()); } }
    return out;
  },
  getVisibleGridColumns: function () { return this.getGridColumns().filter((c: any) => c.isVisible(true)); },
  getColumnCount: function () { return this.getGridColumns().length; },
  getHeaderAtIndex: function (i: number) { return this.getVisibleGridColumns()[i] || null; },
  getHeaderIndex: function (c: any) { return this.getVisibleGridColumns().indexOf(c); },
  getColumns: function () { return this.items.items; },
  getMenu: function () { return this.$menu; },
  $sortEnabled: function () { return this.sortable !== false && (!this.grid || this.grid.sortableColumns !== false); },
  $menuEnabled: function () { return !this.grid || (this.grid.enableColumnHide !== false || this.$hasMenuItems()); },
  $hasMenuItems: function () { return true; },
  $moveEnabled: function () { return !this.grid || this.grid.enableColumnMove !== false; },
  $resizeEnabled: function () { return !this.grid || this.grid.enableColumnResize !== false; },
  $invalidate: function () {
    const me = this;
    me.$layoutDone = false;
    for (const c of me.query('gridcolumn')) { c.updateUI(); }
    if (me.grid) { me.grid.$columnsChanged(); }
    me.updateUI();
  },
  /** Pixel widths: fixed columns keep theirs, flex columns share the remainder (respecting minWidth). */
  $layoutColumns: function (avail: number) {
    const me = this;
    const cols = me.getVisibleGridColumns();
    let fixed = 0, flexSum = 0;
    for (const c of cols) {
      if (c.flex) { flexSum += c.flex; } else {
        const w = typeof c.width === 'number' ? c.width : (parseInt(c.width, 10) || c.defaultWidth);
        c.$w = Math.max(c.minWidth || 0, c.maxWidth ? Math.min(c.maxWidth, w) : w);
        fixed += c.$w;
      }
    }
    let rest = Math.max(0, avail - fixed);
    const flexCols = cols.filter((c: any) => c.flex);
    // minWidth pass
    let again = true;
    const done = new Set();
    while (again) {
      again = false;
      for (const c of flexCols) {
        if (done.has(c)) { continue; }
        const share = flexSum ? Math.floor(rest * c.flex / flexSum) : 0;
        if (c.minWidth && share < c.minWidth) { c.$w = c.minWidth; rest -= c.minWidth; flexSum -= c.flex; done.add(c); again = true; }
      }
    }
    let used = 0;
    const left = flexCols.filter((c: any) => !done.has(c));
    left.forEach((c: any, i: number) => {
      let w = flexSum ? Math.floor(rest * c.flex / flexSum) : 0;
      if (i === left.length - 1) { w = Math.max(0, rest - used); }
      if (c.maxWidth) { w = Math.min(c.maxWidth, w); }
      c.$w = Math.max(w, c.minWidth || (avail ? 20 : 100));
      used += c.$w;
    });
    me.$totalWidth = cols.reduce((s: number, c: any) => s + c.$w, 0);
    me.$layoutDone = true;
    me.$lastAvail = avail;
    return cols;
  },
  getTotalWidth: function () { return this.$totalWidth || 0; },
  $invalidateSortCls: function () { for (const c of this.query('gridcolumn')) { c.updateUI(); } },
  getFullWidth: function () { return this.getTotalWidth(); },

  // ---- interactions
  $onHeaderClick: function (col: any, e: any) {
    const me = this;
    const g = me.grid;
    if (g && g.fireEvent('headerclick', me, col, new Ext.event.Event(e.nativeEvent)) === false) { return; }
    if (col.isCheckerHd && g) { g.getSelectionModel().$toggleAll(); return; }
    if (col.isSortable() && me.$sortEnabled()) { col.sort(); }
  },
  $startResize: function (col: any, re: any) {
    const me = this;
    re.preventDefault();
    re.stopPropagation();
    const sx = re.clientX;
    const sw = col.getWidth();
    const move = (e: MouseEvent) => {
      const w = Math.max(col.minWidth || 20, Math.min(col.maxWidth || 4000, sw + e.clientX - sx));
      col.width = w; col.flex = undefined; col.$w = w;
      me.$invalidate();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (me.grid) { me.grid.fireEvent('columnresize', me, col, col.width); }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  },
  $onDragStart: function (col: any, e: any) {
    if (!this.$moveEnabled() || col.draggable === false) { e.preventDefault(); return; }
    this.$dragCol = col;
    try { e.dataTransfer.setData('text/plain', col.$uid); e.dataTransfer.effectAllowed = 'move'; } catch (x) { /* ignore */ }
  },
  $onDragOver: function (col: any, e: any) { if (this.$dragCol && this.$dragCol !== col && this.$dragCol.ownerCt === col.ownerCt) { e.preventDefault(); } },
  $onDrop: function (col: any, e: any) {
    const me = this;
    const src = me.$dragCol;
    me.$dragCol = null;
    if (!src || src === col || src.ownerCt !== col.ownerCt) { return; }
    e.preventDefault();
    const owner = col.ownerCt;
    const from = owner.items.indexOf(src);
    const box = e.currentTarget.getBoundingClientRect();
    let to = owner.items.indexOf(col);
    if (e.clientX > box.left + box.width / 2) { to++; }
    if (from < to) { to--; }
    owner.items.remove(src);
    owner.items.insert(to, src);
    me.$invalidate();
    if (me.grid) { me.grid.fireEvent('columnmove', me, src, from, to); }
  },
  showMenuBy: function (col: any, el: any) {
    const me = this;
    const g = me.grid;
    if (me.$menu) { me.$menu.destroy(); }
    const items: any[] = [];
    if (col.isSortable() && me.$sortEnabled()) {
      items.push({ text: 'Sort Ascending', iconCls: 'x-fa fa-sort-amount-up-alt', itemId: 'ascItem', handler: () => col.sort('ASC') },
        { text: 'Sort Descending', iconCls: 'x-fa fa-sort-amount-down', itemId: 'descItem', handler: () => col.sort('DESC') });
    }
    if (g && g.enableColumnHide !== false) {
      const colItems = me.getGridColumns().filter((c: any) => c.hideable !== false && !c.isCheckerHd && c.text && !c.isRowNumberer).map((c: any) => ({
        xtype: 'menucheckitem', text: String(c.text).replace(/<[^>]*>/g, ''), checked: !c.hidden, hideOnClick: false,
        checkHandler: (i: any, checked: boolean) => {
          if (!checked && me.getVisibleGridColumns().length <= 1) { i.setChecked(true, true); return; }
          c.setHidden(!checked);
        }
      }));
      if (colItems.length) { if (items.length) { items.push('-'); } items.push({ text: 'Columns', iconCls: 'x-fa fa-columns', itemId: 'columnItem', menu: colItems }); }
    }
    if (g) { g.$extendHeaderMenu(items, col); }
    if (!items.length) { return; }
    me.$menu = Ext.widget('menu', { items, ownerCmp: col, cls: 'x-grid-header-menu', listeners: { hide: () => { col.$menuOpen = false; col.updateUI(); } } });
    col.$menuOpen = true;
    col.updateUI();
    if (g) { g.fireEvent('headermenucreate', g, me.$menu, me); }
    me.$menu.showBy(el, 'tl-bl?');
  },
  renderRoot: function (ref: any) {
    const me = this;
    const props = me.getRootProps(ref);
    let left = 0;
    for (const c of me.items.items) { c.$stickyLeft = left; if (c.locked && !c.hidden) { left += c.getWidth(); } }
    const tops = renderCmps(me.items.items);
    // As in Ext the header sits above the view (outside its scroller); the view syncs scrollLeft into it.
    props.style = Object.assign({}, props.style, { display: me.hidden ? 'none' : 'block', overflow: 'hidden', flex: '0 0 auto', position: 'relative' });
    props.className = clsList(props.className, 'x-grid-header-ct-default', 'x-docked', 'x-docked-top');
    return (
      <div {...props}>
        <div className="x-box-inner x-grid-header-ct-inner" role="row" style={{ display: 'flex', width: me.$totalWidth || undefined, minWidth: '100%' }}>
          {tops}<div className="x-column-header-fill" style={{ flex: '1 1 auto' }} />
        </div>
      </div>
    );
  },
  getRootStyle: function () { return {}; },
  doDestroy: function () { if (this.$menu) { this.$menu.destroy(); } this.callParent(); }
});
void flushRender;
