import type { ReactNode, Ref } from 'react';
import type { GridApi } from 'ag-grid-community';
import type { Changes, Sorter, GridStore } from './store/useGridStore';
import type { GridRow } from './store/rows';
import type { MenuItem } from './components/Popups';

/* =====================================================================
 * Column config — mirrors Ext's `columns: [{ text, dataIndex, xtype, filter, editor, summaryType, locked }]`
 * ===================================================================== */

export type FieldType = 'string' | 'number' | 'date' | 'boolean';
export type SummaryType = 'sum' | 'average' | 'count' | 'min' | 'max';
export type BadgeTone = 'gray' | 'blue' | 'green' | 'red' | 'amber';
export type FilterKind = 'text' | 'number' | 'date' | 'list';
export type EditorKind = 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea';

export interface ColumnConfig<T = any> {
  /** record field (Ext `dataIndex`). Omit for computed `tpl` columns and give an `id`. */
  dataIndex?: Extract<keyof T, string>;
  /** unique id — defaults to dataIndex */
  id?: string;
  /** header text */
  text: string;
  /** field type: drives filter, editor, formatting, alignment. Default 'string'. Dates are ISO 'yyyy-mm-dd' strings. */
  type?: FieldType;
  width?: number;
  minWidth?: number;
  flex?: number;
  align?: 'left' | 'center' | 'right';
  /** Ext `locked: true` → pinned left. 'right' pins to the right. */
  locked?: boolean | 'left' | 'right';
  /** start hidden (can be shown from the Columns chooser) */
  hidden?: boolean;
  /** false = not listed in the Columns chooser */
  hideable?: boolean;
  sortable?: boolean;
  /** true = pick by type; a kind forces one; false = no filter. Columns with `options` default to 'list'. */
  filter?: boolean | FilterKind;
  /** allowed values: used by the list filter and the select editor (Ext combobox store) */
  options?: readonly (string | number | boolean)[];
  /** true = pick by type (select when options exist); a kind forces one; false/omitted = read-only */
  editor?: boolean | EditorKind;
  /** number columns: decimals shown and allowed (default 2) */
  decimals?: number;
  /** date columns: Ext-style format, e.g. 'd-M-Y' (default), 'Y-m-d', 'd/m/Y', 'M j, Y' */
  format?: string;
  min?: number;
  max?: number;
  /** 'badge' (status pill), 'progress' (0–100 bar) or your own renderer (Ext `renderer`) */
  renderer?: 'badge' | 'progress' | ((value: unknown, record: T) => ReactNode);
  /** colours for renderer: 'badge', by value */
  badgeTones?: Record<string, BadgeTone>;
  /** Ext `summaryType` — shown in the total row and group subtotals */
  summary?: SummaryType;
  /** Ext `summaryRenderer` */
  summaryRenderer?: (value: number) => string;
  /** Ext templatecolumn: computed display text */
  tpl?: (record: T) => string;
  /** header tooltip */
  tooltip?: string;
  /** appears in the "Group by" list (default: string/boolean columns) */
  groupable?: boolean;
  /** included in CSV/Excel export (default true) */
  exportable?: boolean;
  /** included in quick search (default: string columns) */
  searchable?: boolean;
  /** grouped header (Ext nested `columns`) */
  columns?: ColumnConfig<T>[];
}

/* =====================================================================
 * Feature switches — every one is on/off; most also take an options object
 * ===================================================================== */

export type Preset = 'full' | 'standard' | 'minimal';

export interface GridFeatures<T = any> {
  /** top toolbar */
  toolbar?: boolean;
  /** quick search box (Ext search field + store filterFn) */
  search?: boolean | { fields?: string[]; placeholder?: string };
  /** column header filters (Ext gridfilters) */
  filters?: boolean | { floating?: boolean };
  /** click-to-sort headers */
  sorting?: boolean;
  /** paging toolbar (Ext pagingtoolbar) */
  paging?: boolean | { pageSize?: number; pageSizes?: number[] };
  /** grouping (Ext grouping feature). `switcher` shows the Group-by picker. */
  grouping?: boolean | { field?: string | null; fields?: string[]; switcher?: boolean };
  /** subtotal row per group (Ext groupingsummary) */
  groupSummary?: boolean;
  /** pinned grand-total row (Ext summary feature) */
  summary?: boolean;
  /** checkbox selection (Ext checkboxmodel). true = 'multi'. */
  selection?: boolean | 'single' | 'multi';
  /** show the checkbox column for the selection (default true). false: select by clicking rows
   *  (Ctrl/Shift+click for several when selection is 'multi'). */
  checkboxes?: boolean;
  /** row number column (Ext rownumberer) */
  rowNumbers?: boolean;
  /** row expander (Ext rowexpander). true = automatic field list. */
  rowExpander?: boolean | { render?: (record: T) => ReactNode; height?: number };
  /** editing (Ext cellediting / rowediting). `switcher` shows the Cell/Row toggle. */
  editing?: boolean | 'cell' | 'row' | { mode?: 'cell' | 'row'; switcher?: boolean; singleClick?: boolean };
  /** Add button */
  add?: boolean;
  /** Delete button for selected rows (needs selection) */
  delete?: boolean;
  /** action column (Ext actioncolumn) */
  actions?: boolean | { edit?: boolean; duplicate?: boolean; delete?: boolean };
  /** right-click row menu */
  contextMenu?: boolean;
  /** Export menu (Ext gridexporter) */
  export?: boolean | { csv?: boolean; xlsx?: boolean; fileName?: string };
  /** Columns show/hide menu */
  columnChooser?: boolean;
  /** undo / redo buttons and Ctrl+Z / Ctrl+Y */
  undo?: boolean;
  /** batch Save / Reject with change counts (Ext store.sync / rejectChanges) */
  sync?: boolean;
  /** red corner on changed cells (Ext markDirty) */
  dirtyMarkers?: boolean;
  /** remember columns, sort, filters, grouping, page size. A string is the state id. */
  stateful?: boolean | string;
  /** Reset view button */
  resetView?: boolean;
  /** unpin side columns on narrow screens */
  responsive?: boolean;
  /** grow to fit all rows instead of scrolling inside a fixed height */
  autoHeight?: boolean;
}

/** Ext model behaviour */
export interface DataGridModel<T> {
  /** calculated fields (Ext `calculate`) */
  calculate?: (record: T) => T;
  /** field validators → { field: message } */
  validate?: (record: T) => Record<string, string>;
  /** side effects of an edit (Ext `edit` listener), returns extra field changes */
  onFieldChange?: (record: T, field: string, value: unknown) => Partial<T> | void;
  /** defaults for a new record (Add button) */
  createRecord?: () => Partial<T>;
  /** fields to change on Duplicate */
  copyRecord?: (source: T) => Partial<T>;
}

export interface DataGridHandle<T extends object> {
  /** the store (Ext grid.getStore()) */
  store: GridStore<T>;
  /** AG Grid API, for anything not wrapped */
  api: () => GridApi<GridRow> | undefined;
  getSelection: () => T[];
  getChanges: () => Changes<T>;
  addRecord: (record?: Partial<T>) => void;
}

export interface DataGridProps<T extends object> {
  data: T[];
  idField: Extract<keyof T, string>;
  columns: ColumnConfig<T>[];
  /** starting set of features; `features` switches override it. Default 'standard'. */
  preset?: Preset;
  features?: GridFeatures<T>;
  title?: string;
  /** used in messages: "Displaying trades 1 - 50 of 500" */
  recordName?: string;
  recordNamePlural?: string;
  /** grid height when not autoHeight (default 600) */
  height?: number | string;
  theme?: 'auto' | 'light' | 'dark';
  /** field to group by when grouping is on (Ext store groupField) */
  groupField?: string | null;
  /** key for remembering the view when `stateful` is on (Ext stateId) */
  stateId?: string;
  /** export file name without extension (default: title) */
  exportFileName?: string;
  /** initial sort (Ext store sorters) */
  sorters?: Sorter[];
  model?: DataGridModel<T>;
  /** Ext isActionDisabled for delete */
  canDelete?: (record: T) => boolean;
  /** Ext getRowClass. Built-in classes: xg-row-muted, xg-row-warn, xg-row-danger, xg-row-success */
  rowClass?: (record: T) => string | undefined;
  /** extra toolbar items (Ext tbar items) */
  tbar?: ReactNode;
  /** extra right-click menu items */
  contextMenuItems?: (record: T) => (MenuItem | '-')[];
  loading?: boolean;
  /** called by Save with created/updated/removed records (Ext store.sync → proxy) */
  onSync?: (changes: Changes<T>) => Promise<void> | void;
  onSelectionChange?: (records: T[]) => void;
  /** select a row by clicking it, not only its checkbox (Ext grids select on click) */
  clickSelection?: boolean;
  onRowDoubleClick?: (record: T) => void;
  className?: string;
  ref?: Ref<DataGridHandle<T>>;
  /** same as `ref`, for React 18 (which does not pass `ref` to function components) */
  handleRef?: Ref<DataGridHandle<T>>;
}
