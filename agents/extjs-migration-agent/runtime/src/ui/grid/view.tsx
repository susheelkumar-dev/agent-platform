/**
 * Ext.view.Table: the grid body. Every record renders as Ext does it, a <table class="x-grid-item"> holding a
 * <tr class="x-grid-row"> of <td class="x-grid-cell"><div class="x-grid-cell-inner">, so selectors, app CSS
 * and DOM-reading code (getNode, getCell, getRecord, getHeaderByCell) keep working. Rows are memoized React
 * components; a record update re-renders only its row. The header container is rendered at the top of the
 * same scroller (sticky), so horizontal scrolling needs no syncing; locked columns are sticky cells.
 * Features (grouping, summaries) and plugins (row expander) hook into the row model.
 */
import * as React from 'react';
import { memo, useLayoutEffect, useRef } from 'react';
import { Ext } from '../../core/ext';
import { define } from '../../core/class';
import { clsList, flushRender } from '../render';
import '../component';


function reapplyRow(dom: any) {
  if (!dom || !Ext.$reapplyCls) { return; }
  Ext.$reapplyCls(dom);
  const cells = dom.querySelectorAll ? dom.querySelectorAll('td') : [];
  for (const td of cells) { Ext.$reapplyCls(td); }
}

/** One record. Re-renders when its record version, index, selection or the column layout changes. */
const GridItem: any = memo(function GridItem(p: any) {
  const ref = useRef<any>(null);
  useLayoutEffect(() => { reapplyRow(ref.current); });
  return p.view.$renderItem(p.entry, ref);
}, (a: any, b: any) => a.entry.record === b.entry.record && a.ver === b.ver && a.index === b.index && a.sel === b.sel && a.layout === b.layout &&
  a.over === b.over && a.groupVer === b.groupVer && a.expanded === b.expanded);

export const TableView: any = define('Ext.view.Table', {
  extend: 'Ext.Component',
  alias: ['widget.tableview', 'widget.gridview'],
  isTableView: true,
  isGridView: true,
  baseCls: 'x-grid-view',
  itemSelector: '.x-grid-item',
  rowSelector: '.x-grid-row',
  cellSelector: 'td.x-grid-cell',
  dataRowSelector: '.x-grid-row',
  itemCls: 'x-grid-item',
  selectedItemCls: 'x-grid-item-selected',
  overItemCls: 'x-grid-item-over',
  altRowCls: 'x-grid-item-alt',
  dirtyCls: 'x-grid-dirty-cell',
  stripeRows: true,
  markDirty: true,
  trackOver: true,
  enableTextSelection: false,
  emptyText: '',
  deferEmptyText: true,
  loadMask: true,
  focusable: true,
  initComponent: function () {
    const me = this;
    me.callParent();
    me.$rowVer = new WeakMap();
    me.$layoutVer = 0;
    me.$groupVer = 0;
    me.$pending = { refresh: true, updated: new Set(), added: [] };
    me.$refreshedOnce = false;
    me.features = [];
  },
  getStore: function () { return this.grid ? this.grid.getStore() : this.store; },
  getSelectionModel: function () { return this.grid ? this.grid.getSelectionModel() : null; },
  getGridColumns: function () { return this.grid ? this.grid.headerCt.getGridColumns() : []; },
  getVisibleColumnManager: function () { const h = this.grid.headerCt; return { getColumns: () => h.getVisibleGridColumns() }; },
  getHeaderCt: function () { return this.grid ? this.grid.headerCt : null; },
  getFeature: function (id: string) { return this.features.find((f: any) => f.id === id || f.ftype === id) || null; },
  getRowClass: null,
  bindStore: function (store: any) {
    const me = this;
    if (me.$storeL) { me.$storeL.destroy(); }
    if (!store) { return; }
    me.$storeL = me.mon(store, {
      datachanged: me.$onDataChanged, refresh: me.$onDataChanged, sort: me.$onDataChanged, filterchange: me.$onDataChanged, groupchange: me.$onGroupChange,
      add: me.$onAdd, remove: me.$onRemove, update: me.$onUpdate, clear: me.$onDataChanged,
      beforeload: me.$onBeforeLoad, load: me.$onLoad,
      scope: me, destroyable: true
    });
    me.$onDataChanged();
  },
  $onBeforeLoad: function () {
    const me = this;
    const g = me.grid;
    if (g && g.loadMask !== false && me.loadMask !== false) { me.$loadMasked = true; me.mask(typeof g.loadMask === 'string' ? g.loadMask : 'Loading...'); }
  },
  $onLoad: function () { if (this.$loadMasked) { this.$loadMasked = false; this.unmask(); } this.$onDataChanged(); },
  $onDataChanged: function () { this.$pending.refresh = true; this.updateUI(); },
  $onGroupChange: function () { this.$groupVer++; this.$onDataChanged(); },
  $onAdd: function (store: any, records: any[], index: number) { this.$pending.added.push({ records, index }); this.updateUI(); },
  $onRemove: function () { this.$pending.refresh = true; this.updateUI(); },
  $onUpdate: function (store: any, record: any) {
    const me = this;
    me.$rowVer.set(record, (me.$rowVer.get(record) || 0) + 1);
    me.$pending.updated.add(record);
    for (const f of me.features) { if (f.$onRecordUpdate) { f.$onRecordUpdate(record); } }
    me.updateUI();
  },
  /** Ext.view.Table#refresh: re-render everything now (also re-runs renderers). */
  refresh: function () {
    const me = this;
    me.$layoutVer++;
    me.$pending.refresh = true;
    me.updateUI();
    flushRender();
  },
  refreshNode: function (rec: any) {
    const me = this;
    if (typeof rec === 'number') { rec = me.getStore().getAt(rec); }
    if (!rec) { return; }
    me.$rowVer.set(rec, (me.$rowVer.get(rec) || 0) + 1);
    me.$pending.updated.add(rec);
    me.updateUI();
    flushRender();
  },
  $columnsChanged: function () { this.$relayout(true); },
  /** Header and docked summary bars live outside the scroller: keep them aligned horizontally. */
  $syncScrollLeft: function (x: number) {
    const g = this.grid;
    if (!g) { return; }
    const h = g.headerCt;
    if (h && h.el) { h.el.dom.scrollLeft = x; }
    for (const f of this.features) { if (f.$bar && f.$bar.el) { f.$bar.el.dom.scrollLeft = x; } }
  },
  updateUI: function () {
    this.callParent();
    for (const f of this.features || []) { if (f.$bar) { f.$bar.updateUI(); } }
  },
  /** Column pixel widths from the view's width; done outside render, then the header and rows re-render. */
  $relayout: function (force?: boolean) {
    const me = this;
    const h = me.grid && me.grid.headerCt;
    if (!h) { return; }
    const avail = me.el ? me.el.dom.clientWidth : (me.$lastWidth || 0);
    if (!force && h.$layoutDone && h.$lastAvail === avail) { return; }
    const before = h.getVisibleGridColumns().map((c: any) => c.$w).join(',');
    h.$layoutColumns(avail);
    const after = h.getVisibleGridColumns().map((c: any) => c.$w).join(',');
    if (before !== after || force) {
      for (const c of h.query('gridcolumn')) { c.updateUI(); }
      h.updateUI();
    }
    me.$layoutVer++;
    me.updateUI();
  },

  // ---- row model (features can group / add rows)
  $entries: function () {
    const me = this;
    const store = me.getStore();
    const recs = store ? store.getRange() : [];
    const grouping = me.features.find((f: any) => f.$isGrouping && !f.disabled);
    if (grouping && store && store.isGrouped && store.isGrouped()) { return grouping.$entries(recs); }
    return recs.map((r: any, i: number) => ({ record: r, index: i }));
  },

  // ---- DOM accessors
  $itemDom: function () { flushRender(); return this.$itemsCt ? this.$itemsCt.dom : (this.el ? this.el.dom : null); },
  getNodes: function (start?: number, end?: number) {
    const ct = this.$itemDom();
    if (!ct) { return []; }
    const all = Array.from(ct.querySelectorAll(':scope > .x-grid-item')) as any[];
    return start === undefined ? all : all.slice(start, end === undefined ? undefined : end + 1);
  },
  all: null,
  getNode: function (nodeInfo: any, dataRow?: boolean) {
    const me = this;
    if (nodeInfo === null || nodeInfo === undefined) { return null; }
    let node: any = null;
    if (typeof nodeInfo === 'number') {
      const rec = me.getStore().getAt(nodeInfo);
      node = rec ? me.$nodeForRecord(rec) : null;
    } else if (nodeInfo.isModel) {
      node = me.$nodeForRecord(nodeInfo);
    } else {
      const d = nodeInfo.dom || nodeInfo;
      node = d && d.closest ? d.closest('.x-grid-item') : null;
    }
    if (node && dataRow) { node = node.querySelector('.x-grid-row'); }
    return node || null;
  },
  getNodeByRecord: function (rec: any) { return this.$nodeForRecord(rec); },
  $nodeForRecord: function (rec: any) {
    const ct = this.$itemDom();
    if (!ct || !rec) { return null; }
    return ct.querySelector(':scope > .x-grid-item[data-recordkey="' + rec.internalId + '"]');
  },
  getRow: function (rec: any) { return this.getNode(rec, true); },
  getRecord: function (node: any) {
    const me = this;
    if (node === null || node === undefined) { return null; }
    if (node.isModel) { return node; }
    if (typeof node === 'number') { return me.getStore().getAt(node); }
    const d = node.dom || node;
    const item = d && d.closest ? d.closest('.x-grid-item') : null;
    if (!item) { return null; }
    const key = item.getAttribute('data-recordkey');
    return me.$recByKey ? me.$recByKey.get(key) || null : null;
  },
  getRecords: function (nodes: any[]) { return Ext.Array.from(nodes).map((n: any) => this.getRecord(n)).filter(Boolean); },
  indexOf: function (node: any) { const r = this.getRecord(node); return r ? this.getStore().indexOf(r) : -1; },
  getCell: function (record: any, column: any) {
    const me = this;
    if (typeof column === 'number') { column = me.grid.headerCt.getHeaderAtIndex(column); }
    const row = me.getNode(record, true);
    if (!row || !column) { return null; }
    const td = row.querySelector(':scope > td[data-columnid="' + column.$uid + '"]');
    return td ? Ext.get(td) : null;
  },
  getCellByPosition: function (pos: any, returnDom?: boolean) {
    if (!pos) { return null; }
    const rec = pos.record || (typeof pos.row === 'number' ? this.getStore().getAt(pos.row) : pos.row);
    const col = pos.column && pos.column.isColumn ? pos.column : this.grid.headerCt.getHeaderAtIndex(pos.column);
    const el = this.getCell(rec, col);
    return el ? (returnDom ? el.dom : el) : null;
  },
  getHeaderByCell: function (cell: any) {
    const d = cell && (cell.dom || cell);
    const td = d && d.closest ? d.closest('td.x-grid-cell') : null;
    const id = td ? td.getAttribute('data-columnid') : null;
    return id && this.$colByUid ? this.$colByUid.get(id) || null : null;
  },
  getCellInclusive: function (pos: any) { return this.getCellByPosition(pos); },
  focusRow: function (rec: any) { const n = this.getNode(rec); if (n && n.scrollIntoView) { n.scrollIntoView({ block: 'nearest' }); } },
  focusNode: function (rec: any) { this.focusRow(rec); },
  focusCell: function (pos: any) { const c = this.getCellByPosition(pos); if (c && c.dom.scrollIntoView) { c.dom.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } },
  scrollRowIntoView: function (rec: any) { this.focusRow(rec); },
  ensureVisible: function (rec: any) { this.focusRow(typeof rec === 'number' ? this.getStore().getAt(rec) : rec); },
  getScrollY: function () { return this.el ? this.el.dom.scrollTop : 0; },
  setScrollY: function (y: number) { if (this.el) { this.el.dom.scrollTop = y; } },
  $scrollEl: function () { flushRender(); return this.el; },
  getTargetEl: function () { return this.getEl(); },
  isRecordExpanded: function () { return false; },

  // ---- events
  $onDomEvent: function (re: any) {
    const me = this;
    const type = re.type;
    const t = re.target as HTMLElement;
    if (!t || !t.closest) { return; }
    if (t.closest('.x-grid-header-ct') || t.closest('.x-editor') || t.closest('.x-grid-row-editor')) { return; }
    const item = t.closest('.x-grid-item') as HTMLElement;
    const e = new Ext.event.Event(re.nativeEvent || re);
    if (!item || !me.el.dom.contains(item)) {
      if (t.closest('.x-grid-group-hd')) { return; }
      if (type === 'click' || type === 'dblclick' || type === 'contextmenu' || type === 'mousedown') {
        me.fireEvent('container' + type, me, e);
      }
      return;
    }
    const groupHd = t.closest('.x-grid-group-hd');
    if (groupHd) {
      const grouping = me.features.find((f: any) => f.$isGrouping);
      if (grouping && grouping.$onGroupHeaderEvent) { grouping.$onGroupHeaderEvent(type, groupHd, e); }
      return;
    }
    if (t.closest('.x-grid-row-summary') || t.closest('.x-grid-rowbody-tr')) {
      if (type === 'click' && t.closest('.x-grid-rowbody-tr')) { me.fireEvent('rowbodyclick', me, t.closest('.x-grid-rowbody-tr'), e); }
      return;
    }
    const record = me.getRecord(item);
    if (!record) { return; }
    const recordIndex = me.getStore().indexOf(record);
    const row = item.querySelector('.x-grid-row');
    const td = t.closest('td.x-grid-cell') as any;
    const column = td ? me.getHeaderByCell(td) : null;
    const cellIndex = column ? me.grid.headerCt.getVisibleGridColumns().indexOf(column) : -1;
    if (type === 'mouseover' || type === 'mouseout') {
      const rel = re.relatedTarget as any;
      if (rel && item.contains(rel)) { return; }
      if (me.trackOver) { me.$overRecord = type === 'mouseover' ? record : (me.$overRecord === record ? null : me.$overRecord); me.updateUI(); }
      me.fireEvent(type === 'mouseover' ? 'itemmouseenter' : 'itemmouseleave', me, record, item, recordIndex, e);
      return;
    }
    if (column) {
      const res = column.processEvent(type, me, td, recordIndex, cellIndex, e, record, row);
      if (res === false) { return; }
      if (me.fireEvent('cell' + type, me, td, cellIndex, record, row, recordIndex, e) === false) { return; }
    }
    // plugins / features that need item events before the selection model
    if (me.fireEvent('beforeitem' + type, me, record, item, recordIndex, e) === false) { return; }
    const sm = me.getSelectionModel();
    if (sm && sm.$onItemEvent) { sm.$onItemEvent(type, me, record, item, recordIndex, e, column, td); }
    me.fireEvent('item' + type, me, record, item, recordIndex, e);
    if (type === 'click' || type === 'dblclick' || type === 'contextmenu' || type === 'mousedown' || type === 'mouseup') {
      me.fireEvent('row' + type, me, record, row, recordIndex, e);
    }
    if (type === 'keydown') { me.$onKeyNav(e, record, recordIndex); }
  },
  $onKeyNav: function (e: any, record: any, index: number) {
    const me = this;
    const sm = me.getSelectionModel();
    const store = me.getStore();
    const k = e.getKey();
    let target = null;
    if (k === e.DOWN) { target = store.getAt(Math.min(store.getCount() - 1, index + 1)); }
    else if (k === e.UP) { target = store.getAt(Math.max(0, index - 1)); }
    else if (k === e.HOME && e.ctrlKey) { target = store.getAt(0); }
    else if (k === e.END && e.ctrlKey) { target = store.getAt(store.getCount() - 1); }
    else if (k === e.ENTER) { me.fireEvent('itemkeyenter', me, record, index, e); }
    if (target && sm && !sm.$isCheckOnly()) {
      e.preventDefault();
      sm.select(target, e.shiftKey && sm.mode !== 'SINGLE');
      me.focusRow(target);
      const n = me.getNode(target);
      if (n) { n.focus({ preventScroll: true }); }
    }
  },

  // ---- rendering
  $renderCells: function (record: any, index: number) {
    const me = this;
    const cols = me.$cols;
    const store = me.getStore();
    const cells = [];
    let left = 0;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const { html, meta } = c.$renderCell(record, index, i, me);
      const dirty = me.markDirty !== false && c.dataIndex && record.isModified && record.isModified(c.dataIndex);
      const align = meta.align === 'right' || meta.align === 'end' ? 'right' : meta.align === 'center' ? 'center' : null;
      const st: any = {};
      if (c.locked) { st.position = 'sticky'; st.left = left; st.zIndex = 1; left += c.$w; }
      if (meta.tdStyle) { Object.assign(st, cssToObj(meta.tdStyle)); }
      const extraAttr = meta.tdAttr ? attrToObj(meta.tdAttr) : null;
      cells.push(
        <td key={c.$uid} role="gridcell" data-columnid={c.$uid} tabIndex={-1} style={st} {...extraAttr}
          className={clsList('x-grid-cell', 'x-grid-td', 'x-grid-cell-' + (c.id || c.$uid), c.tdCls, meta.tdCls, i === 0 ? 'x-grid-cell-first' : null, i === cols.length - 1 ? 'x-grid-cell-last' : null,
            dirty ? me.dirtyCls : null, c.locked ? 'x-grid-cell-locked' : null, me.enableTextSelection ? null : 'x-unselectable', c.$cellExtraCls(record))}>
          <div className={clsList('x-grid-cell-inner', c.innerCls, meta.innerCls, c.cellWrap ? 'x-wrap-cell' : null, align ? 'x-grid-cell-inner-align-' + align : null)}
            style={Object.assign({ textAlign: align || undefined }, meta.style ? cssToObj(meta.style) : null)}
            dangerouslySetInnerHTML={{ __html: html }} />
        </td>
      );
    }
    void store;
    return cells;
  },
  $renderItem: function (entry: any, ref: any) {
    const me = this;
    const { record, index } = entry;
    const store = me.getStore();
    const sm = me.getSelectionModel();
    const selected = sm ? sm.isSelected(record) : false;
    let rowCls = '';
    if (me.getRowClass) { try { rowCls = me.getRowClass.call(me.$rowClassScope || me, record, index, {}, store) || ''; } catch (e) { console.error(e); } }
    const grouping = entry.group;
    const pre = [];
    const post = [];
    if (entry.groupStart && grouping) { pre.push(entry.feature.$renderGroupHeader(entry, me.$cols.length)); }
    const hidden = entry.collapsed;
    const body = me.$rowBodyHtml ? me.$rowBodyHtml(record, index) : null;
    if (entry.groupEnd && entry.feature && entry.feature.$renderGroupSummary) { post.push(entry.feature.$renderGroupSummary(entry, me)); }
    return (
      <table ref={ref} key={record.internalId} role="presentation" data-recordindex={index} data-recordid={record.id} data-recordkey={record.internalId} data-boundview={me.id} tabIndex={-1}
        className={clsList(me.itemCls, 'x-grid-item-container-row', me.stripeRows && index % 2 === 1 ? me.altRowCls : null, selected ? me.selectedItemCls : null,
          me.$overRecord === record ? me.overItemCls : null, rowCls, record.phantom ? 'x-grid-item-phantom' : null,
          me.$isExpanded ? (me.$isExpanded(record) ? 'x-grid-row-expanded' : 'x-grid-row-collapsed') : null)}
        style={{ width: me.$tableWidth, tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }} cellPadding={0} cellSpacing={0}>
        {me.$colgroup}
        <tbody>
          {pre}
          {hidden ? null : <tr role="row" className={clsList('x-grid-row', selected ? 'x-grid-row-selected' : null)}>{me.$renderCells(record, index)}</tr>}
          {!hidden && body !== null && body !== undefined ? body : null}
          {post}
        </tbody>
      </table>
    );
  },
  renderRoot: function (ref: any) {
    const me = this;
    const g = me.grid;
    const h = g.headerCt;
    if (!h.$layoutDone) { h.$layoutColumns(me.el ? me.el.dom.clientWidth : (me.$lastWidth || 0)); }
    const cols = h.getVisibleGridColumns();
    me.$cols = cols;
    me.$colByUid = new Map(h.getGridColumns().map((c: any) => [c.$uid, c]));
    me.$tableWidth = h.getTotalWidth();
    me.$colgroup = <colgroup>{cols.map((c: any) => <col key={c.$uid} style={{ width: c.$w }} />)}</colgroup>;
    const entries = me.$entries();
    const recByKey = new Map();
    for (const en of entries) { recByKey.set(String(en.record.internalId), en.record); }
    me.$recByKey = recByKey;
    const sm = me.getSelectionModel();
    const store = me.getStore();
    const empty = !store || !store.getCount();
    const showEmpty = empty && me.emptyText && (!me.deferEmptyText || me.$refreshedOnce || (store && store.isLoaded && store.isLoaded()));
    const on = (e: any) => me.$onDomEvent(e);
    const handlers: any = { onScroll: (e: any) => { if (e.target === me.el.dom) { me.$syncScrollLeft(e.target.scrollLeft); me.fireEvent('scroll', me, e.target.scrollLeft, e.target.scrollTop); } }, onClick: on, onDoubleClick: on, onContextMenu: on, onMouseDown: on, onMouseUp: on, onMouseOver: on, onMouseOut: on, onKeyDown: on };
    const props = me.getRootProps(ref);
    props.className = clsList(props.className, 'x-grid-view-default', 'x-scroller', 'x-fit-item', me.enableTextSelection ? null : 'x-unselectable');
    props.style = Object.assign({}, props.style, { overflow: 'auto', position: 'relative', flex: '1 1 auto', minHeight: 0, minWidth: 0, outline: 'none' });
    props.tabIndex = -1;
    Object.assign(props, handlers);
    // docked summaries render outside the scroller (see Ext.grid.SummaryBar); an undocked one ends the rows
    const bottom = me.features.filter((f: any) => f.$renderDocked && !f.dock);
    return (
      <div {...props}>
        <div ref={me.$ref('$itemsCt')} className="x-grid-item-container" role="rowgroup" style={{ width: me.$tableWidth, minWidth: '100%' }}>
          {entries.map((en: any) => <GridItem key={en.record.internalId} view={me} entry={en} index={en.index} ver={me.$rowVer.get(en.record) || 0}
            sel={sm ? sm.isSelected(en.record) : false} layout={me.$layoutVer} over={me.$overRecord === en.record} groupVer={en.groupStart || en.groupEnd || en.collapsed ? me.$groupVer + ':' + (en.feature ? en.feature.$ver : 0) : 0}
            expanded={me.$isExpanded ? me.$isExpanded(en.record) : false} />)}
        </div>
        {showEmpty ? <div className="x-grid-empty" dangerouslySetInnerHTML={{ __html: me.emptyText }} /> : null}
        {bottom.map((f: any) => f.$renderDocked(me))}
      </div>
    );
  },
  $afterMount: function (dom: any) {
    const me = this;
    me.callParent([dom]);
    me.$lastWidth = dom.clientWidth;
    if (typeof ResizeObserver !== 'undefined') {
      me.$wro = new ResizeObserver(() => {
        if (me.destroyed || !me.el) { return; }
        const w = me.el.dom.clientWidth;
        if (w !== me.$lastWidth) { me.$lastWidth = w; me.$relayout(); }
      });
      me.$wro.observe(dom);
    }
    // first layout with the real width
    if (me.grid.headerCt.$lastAvail !== dom.clientWidth) { me.$relayout(); }
    me.$firePending();
    if (!me.viewReady) {
      setTimeout(() => {
        if (me.destroyed) { return; }
        me.viewReady = true;
        me.fireEvent('viewready', me);
        if (me.grid) { me.grid.fireEvent('viewready', me.grid); }
      }, 0);
    }
  },
  $afterUpdate: function () { this.callParent(arguments); this.$firePending(); },
  $firePending: function () {
    const me = this;
    const p = me.$pending;
    me.$pending = { refresh: false, updated: new Set(), added: [] };
    if (p.refresh) {
      me.$refreshedOnce = me.$refreshedOnce || !!(me.getStore() && me.getStore().isLoaded && me.getStore().isLoaded());
      me.fireEvent('refresh', me, me.getStore() ? me.getStore().getRange() : []);
      if (me.grid) { me.grid.$afterViewRefresh(); }
      return;
    }
    for (const a of p.added) { me.fireEvent('itemadd', a.records, a.index, a.records.map((r: any) => me.getNode(r))); }
    for (const r of p.updated) {
      const node = me.getNode(r);
      if (node) { me.fireEvent('itemupdate', r, me.getStore().indexOf(r), node); }
    }
  },
  $beforeUnmount: function () { if (this.$wro) { this.$wro.disconnect(); this.$wro = null; } this.callParent(arguments); },
  getRefItems: function () { return []; },
  doDestroy: function () {
    const me = this;
    if (me.$storeL) { me.$storeL.destroy(); }
    if (me.$wro) { me.$wro.disconnect(); }
    me.callParent();
  }
});

function cssToObj(s: any) {
  if (!s) { return {}; }
  if (typeof s === 'object') { return s; }
  const out: any = {};
  for (const part of String(s).split(';')) {
    const i = part.indexOf(':');
    if (i < 0) { continue; }
    const k = part.slice(0, i).trim().replace(/-([a-z])/g, (m, c) => c.toUpperCase());
    if (k) { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}
/** metaData.tdAttr ('data-qtip="..." title="..."') to props */
function attrToObj(s: string) {
  const out: any = {};
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/g;
  let m;
  while ((m = re.exec(s))) {
    const name = m[1] === 'class' ? 'className' : m[1];
    out[name] = Ext.String.htmlDecode ? Ext.String.htmlDecode(m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5]) : (m[3] || m[4] || m[5]);
  }
  return out;
}
export { cssToObj, attrToObj };
