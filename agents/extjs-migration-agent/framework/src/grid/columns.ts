import type { ColDef, ColGroupDef, EditableCallbackParams, ValueSetterParams } from 'ag-grid-community';
import { isDataRow, isSummaryRow, type GridRow } from './store/rows';
import type { ColumnConfig, EditorKind, FilterKind } from './types';
import type { ResolvedFeatures } from './features';
import { fmtDate, fmtNumber, fmtSummary } from './format';
import { ListFilter, ListFloatingFilter, type ListFilterParams } from './components/ListFilter';
import { ActionsCell, BadgeCell, EmptyCell, ExpanderCell, FnCell, ProgressCell } from './renderers/cells';

type Col = ColDef<GridRow>;
export type OnEdit = (id: number | string, field: string, value: unknown) => void;

export const colIdOf = <T,>(c: ColumnConfig<T>) => c.id ?? c.dataIndex ?? c.text;

/** All leaf columns, in order (grouped headers flattened). */
export function leafColumns<T>(cols: ColumnConfig<T>[]): ColumnConfig<T>[] {
  return cols.flatMap((c) => (c.columns ? leafColumns(c.columns) : [c]));
}

export const SPECIAL_COLS = ['xg-rownum', 'xg-expander', 'xg-actions'];

function filterKind<T>(c: ColumnConfig<T>): FilterKind | false {
  if (c.filter === false || (!c.dataIndex && !c.tpl)) return false;
  if (typeof c.filter === 'string') return c.filter;
  if (c.tpl && !c.dataIndex) return false;
  if (c.options || c.type === 'boolean') return 'list';
  return c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text';
}

function editorKind<T>(c: ColumnConfig<T>): EditorKind | false {
  if (!c.editor || !c.dataIndex) return false;
  if (typeof c.editor === 'string') return c.editor;
  if (c.options) return 'select';
  return c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : c.type === 'boolean' ? 'checkbox' : 'text';
}

const AG_FILTER: Record<Exclude<FilterKind, 'list'>, string> = {
  text: 'agTextColumnFilter', number: 'agNumberColumnFilter', date: 'agDateColumnFilter',
};
const AG_TYPE = { string: 'text', number: 'number', date: 'dateString', boolean: 'boolean' } as const;

/** Renderers run for data rows only; summary rows show their own text (or nothing). */
const dataOnly = (component: unknown, params?: object, summaryText = false) =>
  (p: { data?: GridRow }) => isDataRow(p.data) ? { component, params } : summaryText ? undefined : { component: EmptyCell };

function leafColDef<T>(c: ColumnConfig<T>, f: ResolvedFeatures<T>, onEdit: OnEdit, labelColId: string | null): Col {
  const id = colIdOf(c);
  const type = c.type ?? 'string';
  const fk = f.filters ? filterKind(c) : false;
  const ek = f.editing ? editorKind(c) : false;
  const decimals = c.decimals ?? 2;

  const def: Col = {
    colId: id,
    field: c.dataIndex,
    headerName: c.text,
    headerTooltip: c.tooltip,
    width: c.width ?? (type === 'date' ? 140 : type === 'boolean' ? 110 : type === 'number' ? 130 : 150),
    minWidth: c.minWidth,
    flex: c.flex,
    hide: !!c.hidden,
    pinned: c.locked === 'right' ? 'right' : c.locked ? 'left' : undefined,
    sortable: f.sorting && c.sortable !== false && !!c.dataIndex,
    cellDataType: c.dataIndex ? AG_TYPE[type] : false,
    cellClass: c.align === 'center' ? 'xg-center' : undefined,
    type: c.align === 'right' || (type === 'number' && c.align !== 'left' && c.align !== 'center') ? 'rightAligned' : undefined,
  };

  // value: tpl columns, summary labels
  if (c.tpl) {
    def.valueGetter = (p) => (isDataRow(p.data) ? c.tpl!(p.data as unknown as T) : '');
  } else if (id === labelColId) {
    def.valueGetter = (p) => {
      const d = p.data;
      if (d?.__kind === 'total') return `Total (${d.__groupCount})`;
      if (d?.__kind === 'groupSummary') return `Subtotal · ${d.__groupKey}`;
      return c.dataIndex ? d?.[c.dataIndex] : undefined;
    };
  }

  // formatting
  if (type === 'number') {
    def.valueFormatter = (p) => (isSummaryRow(p.data) ? fmtSummary(c, p.value) : fmtNumber(p.value, decimals));
  } else if (type === 'date') {
    def.valueFormatter = (p) => (isSummaryRow(p.data) ? String(p.value ?? '') : fmtDate(p.value, c.format));
  } else if (c.summary) {
    def.valueFormatter = (p) => (isSummaryRow(p.data) ? fmtSummary(c, p.value) : String(p.value ?? ''));
  }

  // renderer — summary rows keep their text only where there is one to show
  const keepSummary = !!c.summary || id === labelColId;
  if (c.renderer === 'badge') def.cellRendererSelector = dataOnly(BadgeCell, { tones: c.badgeTones }, keepSummary);
  else if (c.renderer === 'progress') def.cellRendererSelector = dataOnly(ProgressCell, undefined, keepSummary);
  else if (typeof c.renderer === 'function') def.cellRendererSelector = dataOnly(FnCell, { render: c.renderer }, keepSummary);
  else if (type === 'boolean') def.cellRendererSelector = dataOnly('agCheckboxCellRenderer', undefined, keepSummary);

  // filter
  if (!fk) def.filter = false;
  else if (fk === 'list') {
    const values = c.options ? [...c.options] : [true, false];
    const filterParams: ListFilterParams = { values, formatter: (v) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)) };
    Object.assign(def, { filter: ListFilter, filterParams, floatingFilterComponent: ListFloatingFilter });
  } else def.filter = AG_FILTER[fk];

  // editor (Ext `editor`) — writes through the store, like record.set()
  if (ek && c.dataIndex) {
    const field = c.dataIndex;
    def.editable = (p: EditableCallbackParams<GridRow>) => isDataRow(p.data);
    def.valueSetter = (p: ValueSetterParams<GridRow>) => {
      if (p.data?.__recId == null) return false;
      onEdit(p.data.__recId, field, p.newValue === undefined ? null : p.newValue);
      return true;
    };
    switch (ek) {
      case 'number':
        Object.assign(def, { cellEditor: 'agNumberCellEditor', cellEditorParams: { min: c.min, max: c.max, precision: decimals } });
        break;
      case 'date': def.cellEditor = 'agDateStringCellEditor'; break;
      case 'select': Object.assign(def, { cellEditor: 'agSelectCellEditor', cellEditorParams: { values: [...(c.options ?? [])] } }); break;
      case 'checkbox': def.cellEditor = 'agCheckboxCellEditor'; break;
      case 'textarea': Object.assign(def, { cellEditor: 'agLargeTextCellEditor', cellEditorPopup: true }); break;
      default: def.cellEditor = 'agTextCellEditor';
    }
  }
  return def;
}

function build<T>(cols: ColumnConfig<T>[], f: ResolvedFeatures<T>, onEdit: OnEdit, labelColId: string | null): (Col | ColGroupDef<GridRow>)[] {
  return cols.map((c) =>
    c.columns
      ? { headerName: c.text, headerClass: 'xg-header-group', children: build(c.columns, f, onEdit, labelColId) }
      : leafColDef(c, f, onEdit, labelColId),
  );
}

export function buildColumnDefs<T>(cols: ColumnConfig<T>[], f: ResolvedFeatures<T>, onEdit: OnEdit): (Col | ColGroupDef<GridRow>)[] {
  const leaves = leafColumns(cols);
  const hasSummary = (f.summary || f.groupSummary) && leaves.some((c) => c.summary);
  // the first column without a summary carries the "Total (n)" label
  const labelCol = hasSummary ? leaves.find((c) => !c.summary && c.dataIndex && (c.type ?? 'string') === 'string') : undefined;
  const out: (Col | ColGroupDef<GridRow>)[] = [];
  const fixed = { sortable: false, filter: false, resizable: false, suppressMovable: true, suppressHeaderMenuButton: true, cellDataType: false } as const;

  if (f.rowNumbers) {
    out.push({
      ...fixed, colId: 'xg-rownum', headerName: '#', width: 58, pinned: 'left', lockPosition: 'left',
      valueGetter: (p) => (isDataRow(p.data) ? p.data!.__rowNum : null), cellClass: 'xg-rownum',
    });
  }
  if (f.rowExpander) {
    out.push({ ...fixed, colId: 'xg-expander', headerName: '', width: 44, pinned: 'left', lockPosition: 'left', cellRenderer: ExpanderCell });
  }
  out.push(...build(cols, f, onEdit, labelCol ? colIdOf(labelCol) : null));
  if (f.actions) {
    const n = Number(f.actions.edit) + Number(f.actions.duplicate) + Number(f.actions.delete);
    if (n) out.push({ ...fixed, colId: 'xg-actions', headerName: 'Actions', width: Math.max(80, 30 * n + 26), pinned: 'right', cellRenderer: ActionsCell });
  }
  return out;
}
