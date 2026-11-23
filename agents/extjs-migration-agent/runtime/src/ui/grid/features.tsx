/**
 * Grid features: Ext.grid.feature.Grouping (group headers from the store's grouper, collapse / expand,
 * groupHeaderTpl, header menu "Group by this field" / "Show in groups"), GroupingSummary (a summary row per
 * group) and Summary (a totals row docked to the top or bottom of the view). Summary values use the
 * column's summaryType ('sum', 'average', 'count', 'min', 'max' or a function) and summaryRenderer.
 */
import * as React from 'react';
import { Ext } from '../../core/ext';
import { define } from '../../core/class';
import { clsList } from '../render';

define('Ext.grid.feature.Feature', {
  mixins: { observable: 'Ext.mixin.Observable' },
  isFeature: true,
  disabled: false,
  constructor: function (config?: any) {
    const me = this;
    me.mixins.observable.constructor.call(me, config);
    me.$ver = 0;
    return me;
  },
  init: Ext.emptyFn,
  enable: function () { this.disabled = false; this.$refresh(); },
  disable: function () { this.disabled = true; this.$refresh(); },
  $refresh: function () { this.$ver++; if (this.view) { this.view.$groupVer++; this.view.refresh(); } },
  destroy: function () { this.destroyed = true; }
});

function summaryValue(col: any, records: any[]) {
  const t = col.summaryType;
  const di = col.dataIndex;
  if (!t) { return undefined; }
  const values = records.map((r: any) => r.get(di));
  if (typeof t === 'function') { return t.call(col, records, values, di); }
  const nums = values.map((v: any) => (v === null || v === undefined || v === '' ? null : Number(v))).filter((v: any) => v !== null && !isNaN(v));
  switch (t) {
    case 'count': return records.length;
    case 'sum': return nums.reduce((s: number, v: number) => s + v, 0);
    case 'average': return nums.length ? nums.reduce((s: number, v: number) => s + v, 0) / nums.length : 0;
    case 'min': return nums.length ? Math.min(...nums) : undefined;
    case 'max': return nums.length ? Math.max(...nums) : undefined;
    default: return undefined;
  }
}

function summaryCells(view: any, records: any[], groupInfo?: any) {
  const cols = view.$cols;
  const data: any = {};
  for (const c of cols) { data[c.id] = summaryValue(c, records); data[c.dataIndex || c.id] = data[c.id]; }
  let left = 0;
  return cols.map((c: any, i: number) => {
    const v = data[c.id];
    const meta: any = { tdCls: '', tdAttr: '', style: '', align: c.align, column: c, record: null };
    let html: any;
    if (c.summaryRenderer) {
      const r = typeof c.summaryRenderer === 'string' ? (c.$resolveScope(c.summaryRenderer) || {})[c.summaryRenderer] : c.summaryRenderer;
      html = r ? r.call(c.scope || c, v, data, c.dataIndex, meta, groupInfo) : v;
    } else if (v !== undefined && c.renderer && c.summaryType && c.summaryType !== 'count') {
      html = v;
    } else {
      html = v;
    }
    if (html === undefined || html === null) { html = '&#160;'; }
    const align = meta.align === 'right' || meta.align === 'end' ? 'right' : meta.align === 'center' ? 'center' : null;
    const st: any = {};
    if (c.locked) { st.position = 'sticky'; st.left = left; st.zIndex = 1; left += c.$w; }
    return (
      <td key={c.$uid} data-columnid={c.$uid} style={st} className={clsList('x-grid-cell', 'x-grid-td', 'x-grid-cell-' + (c.id || c.$uid), c.tdCls, meta.tdCls, i === 0 ? 'x-grid-cell-first' : null, i === cols.length - 1 ? 'x-grid-cell-last' : null, c.locked ? 'x-grid-cell-locked' : null)}>
        <div className={clsList('x-grid-cell-inner', align ? 'x-grid-cell-inner-align-' + align : null)} style={{ textAlign: align || undefined }} dangerouslySetInnerHTML={{ __html: String(html) }} />
      </td>
    );
  });
}

// ---------------------------------------------------------------- Grouping
define('Ext.grid.feature.Grouping', {
  extend: 'Ext.grid.feature.Feature',
  alias: 'feature.grouping',
  ftype: 'grouping',
  $isGrouping: true,
  groupHeaderTpl: '{columnName}: {name}',
  startCollapsed: false,
  collapsible: true,
  enableGroupingMenu: true,
  enableNoGroups: true,
  groupByText: 'Group by this field',
  showGroupsText: 'Show in groups',
  hideGroupedHeader: false,
  init: function (grid: any) {
    const me = this;
    me.$collapsed = new Map();
    me.$tpl = me.groupHeaderTpl && me.groupHeaderTpl.isTemplate ? me.groupHeaderTpl : new Ext.XTemplate(me.groupHeaderTpl);
    grid.getStore().on({ groupchange: () => { me.$collapsed = new Map(); me.$ver++; }, scope: me });
  },
  $groupColumn: function () {
    const store = this.grid.getStore();
    const field = store.getGroupField();
    return this.grid.headerCt.getGridColumns().find((c: any) => c.dataIndex === field) || null;
  },
  $isCollapsed: function (key: string) {
    const m = this.$collapsed;
    if (m.has(key)) { return m.get(key); }
    return !!this.startCollapsed;
  },
  isExpanded: function (key: string) { return !this.$isCollapsed(String(key)); },
  expand: function (key: string, focus?: any) { void focus; this.$setCollapsed(String(key), false); },
  collapse: function (key: string, focus?: any) { void focus; this.$setCollapsed(String(key), true); },
  toggle: function (key: string) { this.$setCollapsed(String(key), !this.$isCollapsed(String(key))); },
  expandAll: function () { const me = this; for (const g of me.$groups()) { me.$collapsed.set(String(g.$key), false); } me.$changed(); me.fireEvent('expandall', me); },
  collapseAll: function () { const me = this; for (const g of me.$groups()) { me.$collapsed.set(String(g.$key), true); } me.$changed(); me.fireEvent('collapseall', me); },
  $groups: function () { const s = this.grid.getStore(); return s.isGrouped() ? s.getGroups().items || s.getGroups().getRange() : []; },
  $setCollapsed: function (key: string, c: boolean) {
    const me = this;
    if (me.$isCollapsed(key) === c) { return; }
    me.$collapsed.set(key, c);
    me.$changed();
    const g = me.$groups().find((x: any) => String(x.$key) === key);
    me.view.fireEvent(c ? 'groupcollapse' : 'groupexpand', me.view, null, key, g);
  },
  $changed: function () { this.$ver++; this.view.$groupVer++; this.view.updateUI(); },
  $entries: function (recs: any[]) {
    const me = this;
    const store = me.grid.getStore();
    const out: any[] = [];
    const groups = me.$groups();
    for (const g of groups) {
      const items = g.items;
      const key = String(g.$key);
      const collapsed = me.collapsible !== false && me.$isCollapsed(key);
      if (collapsed) {
        out.push({ record: items[0], index: store.indexOf(items[0]), group: g, feature: me, groupStart: true, groupEnd: true, collapsed: true });
        continue;
      }
      items.forEach((r: any, i: number) => out.push({ record: r, index: store.indexOf(r), group: g, feature: me, groupStart: i === 0, groupEnd: i === items.length - 1 }));
    }
    void recs;
    return out;
  },
  $groupData: function (g: any) {
    const me = this;
    const store = me.grid.getStore();
    const col = me.$groupColumn();
    let name: any = g.$key;
    if (col) {
      const rec = g.items[0];
      const r = col.$renderCell(rec, store.indexOf(rec), 0, me.view);
      name = r.html === '&#160;' ? g.$key : r.html;
    }
    return { name, groupValue: g.$key, renderedGroupValue: name, groupField: store.getGroupField(), columnName: col ? String(col.text || '').replace(/<[^>]*>/g, '') : store.getGroupField(), rows: g.items, children: g.items, groupId: String(g.$key), group: g };
  },
  $renderGroupHeader: function (entry: any, colCount: number) {
    const me = this;
    const g = entry.group;
    const collapsed = entry.collapsed;
    let html = '';
    try { html = me.$tpl.apply(me.$groupData(g)); } catch (e) { html = String(g.$key); }
    return (
      <tr key="$ghd" className={clsList('x-group-hd-container')}>
        <td className="x-group-hd-container" colSpan={colCount} style={{ padding: 0 }}>
          <div className={clsList('x-grid-group-hd', me.collapsible !== false ? 'x-grid-group-hd-collapsible' : 'x-grid-group-hd-not-collapsible', collapsed ? 'x-grid-group-hd-collapsed' : null)}
            data-groupname={String(g.$key)} role="button" tabIndex={-1} style={{ position: 'sticky', left: 0 }}>
            <div className="x-grid-group-title" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </td>
      </tr>
    );
  },
  $onGroupHeaderEvent: function (type: string, hd: any, e: any) {
    const me = this;
    const key = hd.getAttribute('data-groupname');
    const g = me.$groups().find((x: any) => String(x.$key) === key);
    me.view.fireEvent('group' + type, me.view, hd, key, e, g);
    if (type === 'click' && me.collapsible !== false) { me.toggle(key); }
  },
  $extendHeaderMenu: function (items: any[], col: any) {
    const me = this;
    if (!me.enableGroupingMenu || !col.dataIndex || col.groupable === false) { return; }
    const store = me.grid.getStore();
    items.push('-', { text: me.groupByText, iconCls: 'x-fa fa-layer-group', itemId: 'groupMenuItem', handler: () => { me.disabled = false; store.group(col.dataIndex); } });
    if (me.enableNoGroups) {
      items.push({ xtype: 'menucheckitem', text: me.showGroupsText, itemId: 'groupToggleMenuItem', checked: store.isGrouped() && !me.disabled, disabled: !store.isGrouped() && !me.$lastGroupField,
        checkHandler: (i: any, checked: boolean) => {
          if (checked) { store.group(me.$lastGroupField || col.dataIndex); } else { me.$lastGroupField = store.getGroupField(); store.clearGrouping(); }
        } });
    }
  }
});

define('Ext.grid.feature.GroupingSummary', {
  extend: 'Ext.grid.feature.Grouping',
  alias: 'feature.groupingsummary',
  ftype: 'groupingsummary',
  showSummaryRow: true,
  $onRecordUpdate: function () { this.$ver++; this.view.$groupVer++; },
  $renderGroupSummary: function (entry: any, view: any) {
    const me = this;
    if (!me.showSummaryRow) { return null; }
    const g = entry.group;
    return <tr key="$gsum" className="x-grid-row-summary x-grid-row x-grid-group-summary">{summaryCells(view, g.items, me.$groupData(g))}</tr>;
  },
  toggleSummaryRow: function (v?: boolean) { this.showSummaryRow = v === undefined ? !this.showSummaryRow : !!v; this.$changed(); }
});

define('Ext.grid.feature.Summary', {
  extend: 'Ext.grid.feature.Feature',
  alias: 'feature.summary',
  ftype: 'summary',
  dock: undefined,
  showSummaryRow: true,
  $renderDocked: function (view: any) {
    const me = this;
    if (!me.showSummaryRow) { return null; }
    const store = view.getStore();
    const recs = store ? store.getRange() : [];
    return (
      <div key={'$summary-' + (me.dock || 'end')} className={clsList('x-grid-docked-summary', me.dock ? 'x-docked-summary x-docked-' + me.dock : 'x-grid-summary-row-ct')}
        style={{ width: view.$tableWidth, minWidth: '100%' }}>
        <table role="presentation" className="x-grid-table-summary x-grid-item-summary" style={{ width: view.$tableWidth, tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }} cellPadding={0} cellSpacing={0}>
          {view.$colgroup}
          <tbody><tr className="x-grid-row-summary x-grid-row">{summaryCells(view, recs)}</tr></tbody>
        </table>
      </div>
    );
  },
  init: function (grid: any) {
    const me = this;
    if (me.dock) { me.$bar = Ext.widget('gridsummarybar', { feature: me, grid, $refOwner: grid }); }
  },
  getSummary: function (store: any, type: any, field: string) {
    const recs = (store || this.grid.getStore()).getRange();
    return summaryValue({ summaryType: type, dataIndex: field }, recs);
  },
  toggleSummaryRow: function (v?: boolean) { this.showSummaryRow = v === undefined ? !this.showSummaryRow : !!v; this.view.updateUI(); }
});
/** A docked summary row: sits above or below the view like Ext's docked summary, scrolled with it. */
define('Ext.grid.SummaryBar', {
  extend: 'Ext.Component',
  alias: 'widget.gridsummarybar',
  baseCls: 'x-grid-summary-bar',
  renderContent: function () {
    const f = this.feature;
    const view = f && f.view;
    if (!view || !view.$cols) { return null; }
    return f.$renderDocked(view);
  },
  getRootStyle: function () { const st = this.callParent(); st.overflow = 'hidden'; st.flex = '0 0 auto'; return st; },
  getRootCls: function () { return clsList(this.callParent(), 'x-docked', 'x-docked-' + (this.feature ? this.feature.dock : 'bottom'), 'x-docked-summary'); }
});

define('Ext.grid.feature.RowBody', { extend: 'Ext.grid.feature.Feature', alias: 'feature.rowbody', ftype: 'rowbody' });
export { summaryValue };
