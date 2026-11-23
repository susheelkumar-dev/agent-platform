import {
  useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode,
} from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule, themeQuartz,
  type CellContextMenuEvent, type ColDef, type GetRowIdParams, type GridApi, type GridSizeChangedEvent,
  type GridState, type IsFullWidthRowParams, type PostSortRowsParams, type RowClassParams,
  type RowHeightParams, type StateUpdatedEvent,
} from 'ag-grid-community';

import { useGridStore, nextPhantomId, NO_PAGING, type Sorter } from './store/useGridStore';
import { isDataRow, isSummaryRow, type GridRow } from './store/rows';
import { resolveFeatures } from './features';
import { buildColumnDefs, colIdOf, leafColumns, SPECIAL_COLS } from './columns';
import { displayValue, fmtSummary } from './format';
import { exportCsv, exportXlsx } from './exporter';
import { FullWidthRow, type GridContext } from './renderers/cells';
import { PagingToolbar } from './components/PagingToolbar';
import { ConfirmDialog, ContextMenu, Dropdown, Toasts, type MenuItem, type ToastMsg } from './components/Popups';
import { Icon } from './components/Icon';
import type { ColumnConfig, DataGridProps } from './types';

const MODULES = [AllCommunityModule];

/** One AG Grid theme for both modes: every colour comes from the component's --xg-* tokens. */
const THEME = themeQuartz.withParams({
  accentColor: 'var(--xg-accent)',
  backgroundColor: 'var(--xg-panel)',
  foregroundColor: 'var(--xg-text)',
  borderColor: 'var(--xg-border)',
  chromeBackgroundColor: 'var(--xg-header)',
  headerBackgroundColor: 'var(--xg-header)',
  oddRowBackgroundColor: 'var(--xg-panel)',
  rowHoverColor: 'var(--xg-hover)',
  selectedRowBackgroundColor: 'var(--xg-selected)',
  inputBackgroundColor: 'var(--xg-panel)',
  browserColorScheme: 'inherit',
  fontFamily: 'inherit',
  fontSize: 13,
  headerFontWeight: 600,
  rowHeight: 34,
  headerHeight: 36,
  spacing: 6,
  wrapperBorderRadius: 8,
});

/* ---------- light/dark: theme prop → host data-theme → OS ---------- */
function useColorMode(theme: 'auto' | 'light' | 'dark') {
  const read = () => {
    if (theme !== 'auto') return theme;
    const host = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
    if (host === 'dark' || host === 'light') return host;
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const [mode, setMode] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const update = () => setMode(read());
    update();
    if (theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener('change', update); mo.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
  return mode;
}

/* ---------- Ext stateful grid (LocalStorageProvider) ---------- */
interface SavedState { grid?: GridState; groupField?: string | null; pageSize?: number }
const storage = {
  load(key: string | false): SavedState {
    if (!key) return {};
    try { return JSON.parse(localStorage.getItem(key) ?? '{}') as SavedState; } catch { return {}; }
  },
  save(key: string | false, s: SavedState) {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* storage blocked */ }
  },
  clear(key: string | false) {
    if (!key) return;
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

const get = (r: unknown, f: string) => (r as Record<string, unknown>)[f];

/**
 * <DataGrid> — a reusable, config-driven grid (the React counterpart of an Ext `xtype: 'grid'`).
 * Pass data + Ext-style column configs, then switch features on/off with `preset` and `features`.
 */
export function DataGrid<T extends object>(props: DataGridProps<T>) {
  const {
    data, idField, columns, preset, title, model, canDelete, rowClass, tbar, contextMenuItems,
    onSync, onSelectionChange, onRowDoubleClick, className, clickSelection,
  } = props;
  // React 19 passes `ref` as a prop; React 18 strips it, so `handleRef` works on both.
  const ref = props.handleRef ?? props.ref;
  const recordName = props.recordName ?? 'record';
  const recordNames: [string, string] = [recordName, props.recordNamePlural ?? `${recordName}s`];
  const uid = useId();
  const slug = (title ?? String(idField)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'grid';
  const f = useMemo(() => resolveFeatures<T>(preset, props.features, {
    stateId: props.stateId ?? `xg-${slug}`, groupField: props.groupField ?? null, fileName: props.exportFileName ?? slug,
  }),
    // features object identity changes on every parent render; compare by value
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preset, JSON.stringify(props.features, (_k, v) => (typeof v === 'function' ? String(v) : v)), slug, props.stateId, props.groupField, props.exportFileName]);
  const mode = useColorMode(props.theme ?? 'auto');

  const leaves = useMemo(() => leafColumns(columns), [columns]);
  const leafById = useMemo(() => new Map(leaves.map((c) => [colIdOf(c), c])), [leaves]);
  const saved = useMemo(() => storage.load(f.stateful), [f.stateful]);

  const defaultGroupField = f.grouping ? f.grouping.field : null;
  const defaultPageSize = f.paging ? f.paging.pageSize : NO_PAGING;

  /* ---------------- store (Ext.data.Store) ---------------- */
  const store = useGridStore<T>({
    data,
    idField,
    pageSize: f.paging ? saved.pageSize ?? defaultPageSize : NO_PAGING,
    groupField: f.grouping ? (saved.groupField !== undefined ? saved.groupField : defaultGroupField) : null,
    sorters: props.sorters ?? [],
    searchFields: (f.search && f.search.fields) ||
      leaves.filter((c) => c.dataIndex && (c.searchable ?? (c.type ?? 'string') === 'string')).map((c) => c.dataIndex!),
    summaries: Object.fromEntries(leaves.filter((c) => c.summary && c.dataIndex).map((c) => [c.dataIndex!, c.summary!])),
    calculate: model?.calculate,
    validate: model?.validate,
    onFieldChange: model?.onFieldChange,
    syncFn: onSync,
    groupSummaryRows: f.groupSummary,
  });

  // Ext store.loadData(): a new `data` array replaces the records
  const firstData = useRef(true);
  const { load } = store;
  useEffect(() => {
    if (firstData.current) { firstData.current = false; return; }
    load(data);
  }, [data, load]);

  const gridRef = useRef<AgGridReact<GridRow>>(null);
  const api = useCallback((): GridApi<GridRow> | undefined => gridRef.current?.api, []);

  const [editMode, setEditMode] = useState<'cell' | 'row'>(f.editing ? f.editing.mode : 'cell');
  const [rowEditing, setRowEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<(number | string)[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; id: number | string; colId?: string } | null>(null);
  const [confirm, setConfirm] = useState<(number | string)[] | null>(null);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [colsOpen, setColsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({});
  const [searchInput, setSearchInput] = useState('');
  const pendingEdit = useRef<number | string | null>(null);
  const lastGridState = useRef<GridState | undefined>(saved.grid);

  const toast = useCallback((text: string, tone: ToastMsg['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  /* ---------------- quick search, debounced (Ext buffer: 300) ---------------- */
  const { setSearch } = store;
  useEffect(() => {
    const h = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(h);
  }, [searchInput, setSearch]);

  /* ---------------- state persistence ---------------- */
  const persist = useCallback(() => {
    storage.save(f.stateful, { grid: lastGridState.current, groupField: store.groupField, pageSize: store.pageSize });
  }, [f.stateful, store.groupField, store.pageSize]);
  useEffect(persist, [persist]);
  const onStateUpdated = useCallback((e: StateUpdatedEvent<GridRow>) => {
    const { columnOrder, columnPinning, columnSizing, columnVisibility, sort, filter } = e.state;
    lastGridState.current = { columnOrder, columnPinning, columnSizing, columnVisibility, sort, filter };
    persist();
  }, [persist]);

  /* ---------------- commands ---------------- */
  const firstEditableCol = useMemo(() => leaves.find((c) => c.editor && c.dataIndex), [leaves]);
  const startEdit = useCallback((id: number | string) => {
    const a = api();
    const node = a?.getRowNode(`r:${id}`);
    if (!a || node?.rowIndex == null || !firstEditableCol) return;
    const colKey = colIdOf(firstEditableCol);
    a.ensureIndexVisible(node.rowIndex);
    a.setFocusedCell(node.rowIndex, colKey);
    a.startEditingCell({ rowIndex: node.rowIndex, colKey });
  }, [api, firstEditableCol]);

  const blankRecord = useCallback((): T => {
    const today = new Date().toISOString().slice(0, 10);
    const base: Record<string, unknown> = {};
    for (const c of leaves) {
      if (!c.dataIndex) continue;
      base[c.dataIndex] = c.type === 'boolean' ? false : c.type === 'date' ? today : c.type === 'number' ? null : '';
    }
    return { ...base, ...(model?.createRecord?.() ?? {}), [idField]: nextPhantomId() } as T;
  }, [leaves, model, idField]);

  const addRecord = useCallback((rec?: Partial<T>) => {
    const r = { ...blankRecord(), ...(rec ?? {}) } as T;
    pendingEdit.current = get(r, idField) as number;
    store.insert(r, 0);
  }, [blankRecord, store, idField]);

  const duplicate = useCallback((id: number | string) => {
    store.duplicate(id, (src) => ({ ...src, ...(model?.copyRecord?.(src) ?? {}), [idField]: nextPhantomId() }) as T);
    toast(`${recordNames[0][0].toUpperCase()}${recordNames[0].slice(1)} duplicated`, 'ok');
  }, [store, model, idField, toast, recordNames]);

  const deletable = useCallback((id: number | string) => {
    const r = store.getRecord(id);
    return !!r && (canDelete ? canDelete(r) : true);
  }, [store, canDelete]);

  const requestDelete = useCallback((ids: (number | string)[]) => {
    const ok = ids.filter(deletable);
    if (!ok.length) { toast(`These ${recordNames[1]} cannot be deleted`, 'error'); return; }
    setConfirm(ok);
  }, [deletable, toast, recordNames]);

  /* ---------------- renderer context ---------------- */
  const renderDetail = useCallback((row: GridRow): ReactNode => {
    const r = row as unknown as T;
    if (f.rowExpander && f.rowExpander.render) return f.rowExpander.render(r);
    return (
      <dl className="xg-detail-list">
        {leaves.map((c) => (
          <div key={colIdOf(c)}><dt>{c.text}</dt><dd>{displayValue(c, r) || '—'}</dd></div>
        ))}
      </dl>
    );
  }, [f.rowExpander, leaves]);

  const groupHeader = useCallback((row: GridRow) => {
    const col = leaves.find((c) => c.dataIndex === row.__groupField);
    const sums = leaves.filter((c) => c.summary && c.dataIndex && c.summary !== 'count' && c.summary !== 'average')
      .slice(0, 2).map((c) => `${c.text} ${fmtSummary(c, row[c.dataIndex!])}`);
    const key = row.__groupKey ?? '';
    return {
      label: col?.text ?? String(row.__groupField),
      value: key === 'true' ? 'Yes' : key === 'false' ? 'No' : key,
      summary: f.groupSummary ? sums.join(' · ') : '',
    };
  }, [leaves, f.groupSummary]);

  const context = useMemo<GridContext>(() => ({
    toggleExpanded: store.toggleExpanded,
    toggleGroup: store.toggleGroup,
    groupHeader,
    renderDetail,
    recordNames,
    actions: f.actions || { edit: false, duplicate: false, delete: false },
    canDelete: (row) => (row.__recId == null ? false : deletable(row.__recId)),
    editRecord: startEdit,
    duplicateRecord: duplicate,
    deleteRecords: requestDelete,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [store.toggleExpanded, store.toggleGroup, groupHeader, renderDetail, f.actions, deletable, startEdit, duplicate, requestDelete, recordNames[0], recordNames[1]]);

  /* ---------------- AG Grid config ---------------- */
  const columnDefs = useMemo(() => buildColumnDefs(columns, f, store.update), [columns, f, store.update]);

  const defaultColDef = useMemo<ColDef<GridRow>>(() => ({
    sortable: f.sorting,
    resizable: true,
    floatingFilter: !!(f.filters && f.filters.floating),
    minWidth: 44,
    cellClassRules: {
      'xg-cell-dirty': (p) => f.dirtyMarkers && !!p.colDef.field && !!p.data?.__dirty?.has(p.colDef.field),
      'xg-cell-invalid': (p) => !!p.colDef.field && !!p.data?.__errors?.[p.colDef.field],
    },
    tooltipValueGetter: (p) => (p.colDef && 'field' in p.colDef && p.colDef.field ? p.data?.__errors?.[p.colDef.field] : undefined),
    filterParams: { buttons: ['reset'], maxNumConditions: 2 },
  }), [f.sorting, f.filters, f.dirtyMarkers]);

  const getRowId = useCallback((p: GetRowIdParams<GridRow>) => p.data.__id, []);
  const isFullWidthRow = useCallback((p: IsFullWidthRowParams<GridRow>) => {
    const k = p.rowNode.data?.__kind;
    return k === 'group' || k === 'detail';
  }, []);
  const detailHeight = (f.rowExpander && f.rowExpander.height) || Math.ceil(leaves.length / 4) * 40 + 24;
  const getRowHeight = useCallback((p: RowHeightParams<GridRow>) => {
    const k = p.data?.__kind;
    return k === 'detail' ? detailHeight : k === 'group' ? 38 : undefined;
  }, [detailHeight]);
  const postSortRows = useCallback((p: PostSortRowsParams<GridRow>) => {
    p.nodes.sort((a, b) => (a.data?.__order ?? 0) - (b.data?.__order ?? 0));
  }, []);
  const alwaysPassFilter = useCallback(() => true, []);
  const getRowClass = useCallback((p: RowClassParams<GridRow>) => {
    const d = p.data;
    if (!d) return undefined;
    const cls: string[] = [];
    if (d.__phantom) cls.push('xg-row-new');
    if (isSummaryRow(d)) cls.push('xg-row-summary');
    if (isDataRow(d) && rowClass) { const c = rowClass(d as unknown as T); if (c) cls.push(c); }
    return cls;
  }, [rowClass]);

  const chooserCols = useMemo(() => leaves.filter((c) => c.hideable !== false), [leaves]);
  const syncVisibleCols = useCallback(() => {
    const a = api();
    if (!a) return;
    setVisibleCols(Object.fromEntries(chooserCols.map((c) => [colIdOf(c), !!a.getColumn(colIdOf(c))?.isVisible()])));
  }, [api, chooserCols]);

  const readSortFromGrid = useCallback((): Sorter[] => {
    const a = api();
    if (!a) return [];
    const s = a.getColumnState().filter((c) => c.sort).sort((x, y) => (x.sortIndex ?? 0) - (y.sortIndex ?? 0));
    return s.map((c) => ({ field: leafById.get(c.colId)?.dataIndex ?? c.colId, dir: c.sort as 'asc' | 'desc' }));
  }, [api, leafById]);

  const onGridReady = useCallback(() => {
    const a = api();
    // initial sorters → header arrows (only when nothing was restored)
    if (!saved.grid?.sort && props.sorters?.length) {
      a?.applyColumnState({
        state: props.sorters.map((s, i) => ({ colId: leaves.find((c) => c.dataIndex === s.field) ? colIdOf(leaves.find((c) => c.dataIndex === s.field)!) : s.field, sort: s.dir, sortIndex: i })),
        defaultState: { sort: null },
      });
    }
    store.setSorters(readSortFromGrid().length ? readSortFromGrid() : props.sorters ?? []);
    store.setFilterModel(a?.getFilterModel() ?? null);
    syncVisibleCols();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* responsive pinning: keep only the first locked data column pinned on narrow grids */
  const narrowRef = useRef<boolean | null>(null);
  const pinnedDefaults = useMemo(() => {
    const pinned = leaves.filter((c) => c.locked).map((c) => ({ colId: colIdOf(c), pinned: c.locked === 'right' ? 'right' as const : 'left' as const }));
    if (f.rowNumbers) pinned.push({ colId: 'xg-rownum', pinned: 'left' });
    if (f.rowExpander) pinned.push({ colId: 'xg-expander', pinned: 'left' });
    if (f.actions) pinned.push({ colId: 'xg-actions', pinned: 'right' });
    return pinned;
  }, [leaves, f.rowNumbers, f.rowExpander, f.actions]);
  const onGridSizeChanged = useCallback((e: GridSizeChangedEvent<GridRow>) => {
    if (!f.responsive) return;
    const narrow = e.clientWidth < 700;
    if (narrowRef.current === narrow) return;
    narrowRef.current = narrow;
    const keep = pinnedDefaults.find((p) => !SPECIAL_COLS.includes(p.colId) && p.pinned === 'left')?.colId;
    e.api.applyColumnState({ state: pinnedDefaults.map((p) => ({ colId: p.colId, pinned: narrow && p.colId !== keep ? null : p.pinned })) });
  }, [f.responsive, pinnedDefaults]);

  const onCellContextMenu = useCallback((e: CellContextMenuEvent<GridRow>) => {
    if (!f.contextMenu || !isDataRow(e.data)) return;
    const ev = e.event as MouseEvent | undefined;
    setMenu({ x: ev?.clientX ?? 100, y: ev?.clientY ?? 100, id: e.data!.__recId!, colId: e.column.getColId() });
  }, [f.contextMenu]);

  const onRowDataUpdated = useCallback(() => {
    if (pendingEdit.current != null) {
      const id = pendingEdit.current;
      pendingEdit.current = null;
      requestAnimationFrame(() => startEdit(id));
    }
  }, [startEdit]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!f.undo || !(e.ctrlKey || e.metaKey) || api()?.getEditingCells().length) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); store.redo(); }
  };

  /* ---------------- toolbar actions ---------------- */
  const onSave = async () => {
    api()?.stopEditing();
    const res = await store.sync();
    toast(res.message, res.ok ? 'ok' : 'error');
  };
  const onReject = () => { api()?.stopEditing(true); store.reject(); toast('Changes rejected', 'info'); };
  const onResetView = () => {
    storage.clear(f.stateful);
    lastGridState.current = undefined;
    const a = api();
    a?.resetColumnState();
    a?.setFilterModel(null);
    if (props.sorters?.length) onGridReady();
    store.setGroupField(defaultGroupField);
    store.setPageSize(defaultPageSize);
    setSearchInput('');
    narrowRef.current = null;
    syncVisibleCols();
    toast('View reset to defaults', 'info');
  };
  const exportColumns = (): ColumnConfig<T>[] =>
    (api()?.getAllDisplayedColumns() ?? [])
      .map((c) => leafById.get(c.getColId()))
      .filter((c): c is ColumnConfig<T> => !!c && c.exportable !== false);
  const onExport = async (kind: 'csv' | 'xlsx') => {
    setExportOpen(false);
    if (!f.export) return;
    const recs = store.filteredRecords;
    if (kind === 'csv') exportCsv(recs, exportColumns(), f.export.fileName);
    else await exportXlsx(recs, exportColumns(), f.export.fileName, title);
    toast(`Exported ${recs.length} ${recordNames[1]} to ${kind.toUpperCase()}`, 'ok');
  };

  const menuItems = (id: number | string, colId?: string): (MenuItem | '-')[] => {
    const rec = store.getRecord(id);
    const col = colId ? leafById.get(colId) : undefined;
    const items: (MenuItem | '-')[] = [];
    if (rec && col) {
      const text = displayValue(col, rec);
      items.push({
        text: `Copy ${col.text}`, icon: 'clipboard', disabled: !text,
        onClick: () => {
          navigator.clipboard?.writeText(text).then(() => toast('Copied', 'ok')).catch(() => toast(`Copy blocked here: ${text}`, 'info'));
        },
      });
    }
    if (f.rowExpander) items.push({ text: store.expanded.has(id) ? 'Hide details' : 'Show details', icon: 'info', onClick: () => store.toggleExpanded(id) });
    if (f.editing && firstEditableCol) items.push({ text: 'Edit', icon: 'edit', onClick: () => startEdit(id) });
    if (f.add || (f.actions && f.actions.duplicate)) items.push({ text: 'Duplicate', icon: 'copy', onClick: () => duplicate(id) });
    if (f.delete || (f.actions && f.actions.delete)) {
      items.push('-', { text: 'Delete', icon: 'trash', danger: true, disabled: !deletable(id), onClick: () => requestDelete([id]) });
    }
    if (rec && contextMenuItems) items.push('-', ...contextMenuItems(rec));
    return items;
  };

  /* ---------------- imperative handle (Ext grid methods) ---------------- */
  useImperativeHandle(ref, () => ({
    store,
    api,
    getSelection: () => selectedIds.map((id) => store.getRecord(id)).filter((r): r is T => !!r),
    getChanges: () => store.changes,
    addRecord,
  }), [store, api, selectedIds, addRecord]);

  // Ext autoSync: without Save/Reject buttons every valid change is committed straight away
  const { sync: storeSync } = store;
  const pendingChanges = store.changes.created.length + store.changes.updated.length + store.changes.removed.length;
  useEffect(() => {
    if (!f.sync && pendingChanges > 0 && store.invalidCount === 0 && store.busy === false) void storeSync();
  }, [f.sync, pendingChanges, store.invalidCount, store.busy, storeSync]);

  const { created, updated, removed } = store.changes;
  const changeCount = created.length + updated.length + removed.length;
  const pagedRecordCount = Math.max(0, Math.min(store.pageSize, store.total - store.pageStart));
  const groupOptions = useMemo(() => {
    const g = f.grouping;
    if (!g) return [];
    const list = g.fields
      ? g.fields.map((fld) => leaves.find((c) => c.dataIndex === fld)).filter((c): c is ColumnConfig<T> => !!c)
      : leaves.filter((c) => c.dataIndex && (c.groupable ?? ((c.type ?? 'string') === 'string' || c.type === 'boolean')));
    return list.map((c) => ({ field: c.dataIndex!, label: c.text }));
  }, [f.grouping, leaves]);

  const showHeader = !!title || (f.sync && (changeCount > 0 || store.invalidCount > 0));
  const showUndo = f.undo && !!f.editing;
  const hostStyle: CSSProperties = f.autoHeight ? {} : { height: props.height ?? 600 };

  return (
    <section className={`xg${className ? ` ${className}` : ''}`} data-xg-mode={mode} style={hostStyle} onKeyDown={onKeyDown}
      aria-label={title ?? 'Data grid'}>
      {showHeader && (
        <header className="xg-header">
          {title && <h2 className="xg-title">{title}</h2>}
          <div className="xg-status">
            {f.sync && changeCount > 0 && (
              <span className="xg-pill xg-pill--warn">{created.length} new · {updated.length} modified · {removed.length} deleted</span>
            )}
            {store.invalidCount > 0 && <span className="xg-pill xg-pill--error">{store.invalidCount} invalid</span>}
          </div>
        </header>
      )}

      {f.toolbar && (
        <div className="xg-toolbar" role="toolbar" aria-label="Grid actions">
          {f.search && (
            <div className="xg-search">
              <Icon name="search" />
              <input id={`${uid}-search`} value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                placeholder={f.search.placeholder ?? `Search ${recordNames[1]}…`} aria-label={`Search ${recordNames[1]}`} />
              {searchInput && (
                <button className="xg-icon-btn" aria-label="Clear search" onClick={() => setSearchInput('')}><Icon name="x" size={14} /></button>
              )}
            </div>
          )}

          {(f.add || f.delete) && (
            <div className="xg-toolbar__group">
              {f.add && <button className="xg-btn" onClick={() => addRecord()}><Icon name="plus" />Add</button>}
              {f.delete && (
                <button className="xg-btn" onClick={() => requestDelete(selectedIds)} disabled={!selectedIds.length}>
                  <Icon name="trash" />Delete{selectedIds.length ? ` (${selectedIds.length})` : ''}
                </button>
              )}
            </div>
          )}

          {f.grouping && f.grouping.switcher && (
            <div className="xg-toolbar__group">
              <label className="xg-field" htmlFor={`${uid}-group`}>Group by</label>
              <select id={`${uid}-group`} className="xg-select" value={store.groupField ?? ''}
                onChange={(e) => store.setGroupField(e.target.value || null)}>
                <option value="">(none)</option>
                {groupOptions.map((g) => <option key={g.field} value={g.field}>{g.label}</option>)}
              </select>
              <button className="xg-btn" onClick={store.expandAllGroups} disabled={!store.groupField}>Expand all</button>
              <button className="xg-btn" onClick={store.collapseAllGroups} disabled={!store.groupField}>Collapse all</button>
            </div>
          )}

          {((f.editing && f.editing.switcher) || showUndo) && (
            <div className="xg-toolbar__group">
              {f.editing && f.editing.switcher && (
                <div className="xg-segmented" role="radiogroup" aria-label="Edit mode">
                  {(['cell', 'row'] as const).map((m) => (
                    <button key={m} role="radio" aria-checked={editMode === m} className={editMode === m ? 'is-active' : ''}
                      onClick={() => { api()?.stopEditing(); setEditMode(m); }}>
                      {m === 'cell' ? 'Cell edit' : 'Row edit'}
                    </button>
                  ))}
                </div>
              )}
              {showUndo && (
                <>
                  <button className="xg-icon-btn" onClick={store.undo} disabled={!store.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" /></button>
                  <button className="xg-icon-btn" onClick={store.redo} disabled={!store.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo"><Icon name="redo" /></button>
                </>
              )}
            </div>
          )}

          {tbar && <div className="xg-toolbar__group">{tbar}</div>}
          <div className="xg-toolbar__spacer" />

          <div className="xg-toolbar__group">
            {f.columnChooser && (
              <Dropdown label="Columns" icon="columns" open={colsOpen} setOpen={setColsOpen}>
                {chooserCols.map((c) => (
                  <label key={colIdOf(c)} className="xg-check-item">
                    <input type="checkbox" checked={!!visibleCols[colIdOf(c)]}
                      onChange={(e) => { api()?.setColumnsVisible([colIdOf(c)], e.target.checked); syncVisibleCols(); }} />
                    {c.text}
                  </label>
                ))}
              </Dropdown>
            )}
            {f.export && (
              <Dropdown label="Export" icon="download" open={exportOpen} setOpen={setExportOpen}>
                {f.export.xlsx && <button className="xg-menu__item" onClick={() => onExport('xlsx')}>Excel (.xlsx)</button>}
                {f.export.csv && <button className="xg-menu__item" onClick={() => onExport('csv')}>CSV</button>}
              </Dropdown>
            )}
            {f.sync && (
              <>
                <button className="xg-btn xg-btn--primary" onClick={onSave} disabled={!changeCount || store.busy !== false}>
                  <Icon name="save" />Save{changeCount ? ` (${changeCount})` : ''}
                </button>
                <button className="xg-btn" onClick={onReject} disabled={!changeCount}><Icon name="reject" />Reject</button>
              </>
            )}
            {f.resetView && <button className="xg-btn" onClick={onResetView}><Icon name="reset" />Reset view</button>}
          </div>
        </div>
      )}

      {rowEditing && (
        <div className="xg-row-edit-bar" role="status">
          Editing row: <kbd>Enter</kbd> to update, <kbd>Esc</kbd> to cancel
          <button className="xg-btn xg-btn--primary xg-btn--sm" onClick={() => api()?.stopEditing(false)}>Update</button>
          <button className="xg-btn xg-btn--sm" onClick={() => api()?.stopEditing(true)}>Cancel</button>
        </div>
      )}

      <div className={f.autoHeight ? 'xg-grid xg-grid--auto' : 'xg-grid'}>
        <AgGridReact<GridRow>
          ref={gridRef}
          modules={MODULES}
          theme={THEME}
          context={context}
          rowData={store.rows}
          pinnedBottomRowData={f.summary && leaves.some((c) => c.summary) ? [store.totalRow] : undefined}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          initialState={saved.grid}
          getRowId={getRowId}
          isFullWidthRow={isFullWidthRow}
          fullWidthCellRenderer={FullWidthRow}
          getRowHeight={getRowHeight}
          getRowClass={getRowClass}
          postSortRows={postSortRows}
          alwaysPassFilter={alwaysPassFilter}
          onSortChanged={() => store.setSorters(readSortFromGrid())}
          onFilterChanged={(e) => store.setFilterModel(e.api.getFilterModel())}
          rowSelection={f.selection ? {
            mode: f.selection === 'single' ? 'singleRow' : 'multiRow',
            checkboxes: !f.checkboxes ? false : (p) => isDataRow(p.data),
            ...(f.selection === 'multi' && f.checkboxes ? { headerCheckbox: true } : {}),
            isRowSelectable: (n) => isDataRow(n.data),
            hideDisabledCheckboxes: true,
            // without checkboxes, a click is the only way to select a row
            enableClickSelection: (!!clickSelection || !f.checkboxes) && !f.editing,
          } : undefined}
          selectionColumnDef={{ pinned: 'left', width: 44, suppressHeaderMenuButton: true }}
          onSelectionChanged={(e) => {
            const ids = e.api.getSelectedRows().filter(isDataRow).map((r) => r.__recId!);
            setSelectedIds(ids);
            onSelectionChange?.(ids.map((id) => store.getRecord(id)).filter((r): r is T => !!r));
          }}
          onRowDoubleClicked={(e) => {
            if (onRowDoubleClick && isDataRow(e.data)) { const r = store.getRecord(e.data!.__recId!); if (r) onRowDoubleClick(r); }
          }}
          editType={f.editing && editMode === 'row' ? 'fullRow' : undefined}
          singleClickEdit={!!(f.editing && f.editing.singleClick)}
          stopEditingWhenCellsLoseFocus
          onRowEditingStarted={() => setRowEditing(true)}
          onRowEditingStopped={() => setRowEditing(false)}
          preventDefaultOnContextMenu={f.contextMenu}
          onCellContextMenu={onCellContextMenu}
          onGridReady={onGridReady}
          onGridSizeChanged={onGridSizeChanged}
          onStateUpdated={onStateUpdated}
          onColumnVisible={syncVisibleCols}
          onRowDataUpdated={onRowDataUpdated}
          loading={props.loading || store.busy !== false}
          domLayout={f.autoHeight ? 'autoHeight' : 'normal'}
          tooltipShowDelay={300}
          enableCellTextSelection
          ensureDomOrder
          animateRows={false}
          overlayNoRowsTemplate={`No ${recordNames[1]} to show`}
        />
      </div>

      {f.paging && (
        <PagingToolbar
          page={store.page}
          pageCount={store.pageCount}
          pageStart={store.pageStart}
          pageRows={pagedRecordCount}
          total={store.total}
          pageSize={store.pageSize}
          pageSizes={f.paging.pageSizes}
          recordNamePlural={recordNames[1]}
          onPage={store.setPage}
          onPageSize={store.setPageSize}
          onRefresh={async () => { await store.reload(); toast('Data refreshed', 'info'); }}
        />
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id, menu.colId)} onClose={() => setMenu(null)} />}
      {confirm && (
        <ConfirmDialog
          title="Delete"
          message={`Delete ${confirm.length} ${confirm.length === 1 ? recordNames[0] : recordNames[1]}?${f.sync ? ' You can still Reject before saving.' : ''}`}
          confirmText="Delete"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            store.remove(confirm);
            api()?.deselectAll();
            setConfirm(null);
            toast(`${confirm.length} deleted${f.sync ? ': Save to commit' : ''}`, 'info');
          }}
        />
      )}
      <Toasts items={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </section>
  );
}
