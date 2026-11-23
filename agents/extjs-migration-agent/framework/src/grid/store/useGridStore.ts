import { useCallback, useMemo, useRef, useState } from 'react';
import { recordPasses, type FilterModel } from './filterEngine';
import type { GridRow } from './rows';

/**
 * useGridStore — the React counterpart of Ext.data.Store (+ the grid-view state Ext
 * keeps in features/plugins). Generic: nothing here knows about trades.
 *
 * Ext responsibility              → here
 * ------------------------------------------------------------------
 * store data / insert / remove     → records, insert(), duplicate(), remove()
 * record.set + calculated fields   → update() + config.calculate
 * model validators / isValid()     → config.validate → errors per record
 * getModifiedRecords / phantom     → dirty fields, phantom flag, changes
 * store.sync() / rejectChanges()   → sync(), reject()
 * sorters / filters / remote paging → sorters, filterModel, search, page/pageSize
 * groupField + grouping feature    → groupField, collapsed groups
 * groupingsummary / summary        → config.summaries → groupSummary + total rows
 * rowexpander state                → expanded set → detail rows
 */

export type SortDir = 'asc' | 'desc';
export interface Sorter { field: string; dir: SortDir }
export type SummaryType = 'sum' | 'average' | 'count' | 'min' | 'max';

export interface StoreConfig<T extends object> {
  data: T[];
  idField: keyof T & string;
  pageSize?: number;
  groupField?: string | null;
  sorters?: Sorter[];
  searchFields?: string[];
  summaries?: Partial<Record<string, SummaryType>>;
  calculate?: (rec: T) => T;
  validate?: (rec: T) => Record<string, string>;
  onFieldChange?: (rec: T, field: string, value: unknown) => Partial<T> | void;
  syncFn?: (changes: Changes<T>) => Promise<void> | void;
  historyLimit?: number;
  /** add a subtotal row under each group (Ext groupingsummary) */
  groupSummaryRows?: boolean;
}

/** Unsaved records get negative ids, like Ext's Ext.data.identifier.Negative */
let phantomSeq = -1;
export const nextPhantomId = () => phantomSeq--;
/** pageSize that effectively disables paging */
export const NO_PAGING = Number.MAX_SAFE_INTEGER;

export interface Changes<T> { created: T[]; updated: T[]; removed: T[] }

interface RecordState<T> { records: T[]; committed: T[]; past: T[][]; future: T[][] }

const get = (rec: object, f: string) => (rec as Record<string, unknown>)[f];

function compareValues(a: unknown, b: unknown): number {
  const aBlank = a === null || a === undefined || a === '';
  const bBlank = b === null || b === undefined || b === '';
  if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1; // blanks last
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function summarize<T extends object>(recs: T[], summaries: Partial<Record<string, SummaryType>>) {
  const out: Record<string, number> = {};
  for (const [field, type] of Object.entries(summaries)) {
    const nums = recs.map((r) => get(r, field)).filter((v): v is number => typeof v === 'number');
    switch (type) {
      case 'count': out[field] = recs.length; break;
      case 'min': out[field] = nums.length ? Math.min(...nums) : 0; break;
      case 'max': out[field] = nums.length ? Math.max(...nums) : 0; break;
      case 'average': out[field] = nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0; break;
      default: out[field] = nums.reduce((s, n) => s + n, 0);
    }
  }
  return out;
}

export function useGridStore<T extends object>(config: StoreConfig<T>) {
  const cfgRef = useRef(config);
  cfgRef.current = config;
  const { idField } = config;
  const calc = useCallback((r: T) => (cfgRef.current.calculate ? cfgRef.current.calculate(r) : r), []);
  const idOf = useCallback((r: T) => get(r, idField) as number | string, [idField]);

  const [state, setState] = useState<RecordState<T>>(() => {
    const records = config.data.map((r) => (config.calculate ? config.calculate(r) : r));
    return { records, committed: records, past: [], future: [] };
  });
  const [sorters, setSortersRaw] = useState<Sorter[]>(config.sorters ?? []);
  const [filterModel, setFilterModelRaw] = useState<FilterModel>({});
  const [search, setSearchRaw] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSizeRaw] = useState(config.pageSize ?? 50);
  const [groupField, setGroupFieldRaw] = useState<string | null>(config.groupField ?? null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<number | string>>(new Set());
  const [busy, setBusy] = useState<false | 'loading' | 'saving'>(false);

  /** Every data mutation goes through here so undo/redo history stays consistent. */
  const mutate = useCallback((fn: (records: T[]) => T[]) => {
    setState((s) => {
      const next = fn(s.records);
      if (next === s.records) return s;
      const limit = cfgRef.current.historyLimit ?? 50;
      return { ...s, records: next, past: [...s.past, s.records].slice(-limit), future: [] };
    });
  }, []);

  /* ---------------- derived: change tracking ---------------- */
  const { records, committed } = state;
  const committedById = useMemo(() => new Map(committed.map((r) => [idOf(r), r])), [committed, idOf]);

  const meta = useMemo(() => {
    const dirty = new Map<number | string, Set<string>>();
    const errors = new Map<number | string, Record<string, string>>();
    const created: T[] = [];
    const updated: T[] = [];
    let invalid = 0;
    for (const r of records) {
      const id = idOf(r);
      const orig = committedById.get(id);
      if (!orig) created.push(r);
      else if (orig !== r) {
        const fields = new Set<string>();
        for (const k of Object.keys(r)) if (!Object.is(get(r, k), get(orig, k))) fields.add(k);
        if (fields.size) { dirty.set(id, fields); updated.push(r); }
      }
      const e = cfgRef.current.validate?.(r) ?? {};
      if (Object.keys(e).length) {
        errors.set(id, e);
        if (!orig || dirty.has(id)) invalid++; // only unsaved work blocks a sync, like Ext
      }
    }
    const liveIds = new Set(records.map(idOf));
    const removed = committed.filter((r) => !liveIds.has(idOf(r)));
    return { dirty, errors, changes: { created, updated, removed } as Changes<T>, invalid };
  }, [records, committed, committedById, idOf]);

  /* ---------------- derived: filter → sort → page → group ---------------- */
  const pipeline = useMemo(() => {
    const cfg = cfgRef.current;
    const q = search.trim().toLowerCase();
    const isPhantom = (r: T) => !committedById.has(idOf(r));
    const filtered = records.filter(
      (r) =>
        isPhantom(r) || // unsaved rows always stay visible (Ext inserts them at the top)
        (recordPasses(r, filterModel) &&
          (!q || (cfg.searchFields ?? []).some((f) => String(get(r, f) ?? '').toLowerCase().includes(q)))),
    );
    const sorted = filtered
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const pa = isPhantom(a.r), pb = isPhantom(b.r);
        if (pa !== pb) return pa ? -1 : 1;
        if (groupField) {
          const g = compareValues(get(a.r, groupField), get(b.r, groupField));
          if (g) return g;
        }
        for (const s of sorters) {
          const c = compareValues(get(a.r, s.field), get(b.r, s.field));
          if (c) return s.dir === 'asc' ? c : -c;
        }
        return a.i - b.i; // stable
      })
      .map((x) => x.r);

    const total = sorted.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, pageCount - 1);
    const start = safePage * pageSize;
    const pageRecs = sorted.slice(start, start + pageSize);
    return { filtered: sorted, total, pageCount, safePage, start, pageRecs };
  }, [records, filterModel, search, sorters, groupField, page, pageSize, committedById, idOf]);

  const rows = useMemo<GridRow[]>(() => {
    const cfg = cfgRef.current;
    const summaries = cfg.summaries ?? {};
    const out: GridRow[] = [];
    let order = 0;
    const pushRecord = (r: T, idx: number) => {
      const id = idOf(r);
      out.push({
        ...(r as Record<string, unknown>),
        __kind: 'data',
        __id: `r:${id}`,
        __order: order++,
        __recId: id,
        __rowNum: pipeline.start + idx + 1,
        __dirty: meta.dirty.get(id),
        __errors: meta.errors.get(id),
        __phantom: !committedById.has(id),
        __expanded: expanded.has(id),
      });
      if (expanded.has(id)) {
        out.push({ ...(r as Record<string, unknown>), __kind: 'detail', __id: `d:${id}`, __order: order++, __recId: id });
      }
    };

    if (!groupField) {
      pipeline.pageRecs.forEach(pushRecord);
      return out;
    }
    // group the *current page*, exactly like Ext's grouping feature over a paged store
    const groups = new Map<string, { recs: T[]; idx: number[] }>();
    pipeline.pageRecs.forEach((r, i) => {
      const key = String(get(r, groupField) ?? '(blank)');
      const g = groups.get(key) ?? { recs: [], idx: [] };
      g.recs.push(r);
      g.idx.push(i);
      groups.set(key, g);
    });
    for (const [key, g] of groups) {
      const isCollapsed = collapsed.has(key);
      const sum = summarize(g.recs, summaries);
      out.push({
        ...sum,
        __kind: 'group', __id: `g:${key}`, __order: order++,
        __groupField: groupField, __groupKey: key, __groupCount: g.recs.length, __collapsed: isCollapsed,
      });
      if (isCollapsed) continue;
      g.recs.forEach((r, j) => pushRecord(r, g.idx[j]));
      if (cfg.groupSummaryRows !== false) out.push({ ...sum, __kind: 'groupSummary', __id: `s:${key}`, __order: order++, __groupKey: key, __groupCount: g.recs.length });
    }
    return out;
  }, [pipeline, groupField, collapsed, expanded, meta, committedById, idOf]);

  const totalRow = useMemo<GridRow>(
    () => ({
      ...summarize(pipeline.filtered, cfgRef.current.summaries ?? {}),
      __kind: 'total', __id: 'total', __order: 0, __groupCount: pipeline.total,
    }),
    [pipeline],
  );

  /* ---------------- commands ---------------- */
  const update = useCallback((id: number | string, field: string, value: unknown) => {
    mutate((recs) => {
      let changed = false;
      const next = recs.map((r) => {
        if (idOf(r) !== id || Object.is(get(r, field), value)) return r;
        changed = true;
        const extra = cfgRef.current.onFieldChange?.(r, field, value) ?? {};
        return calc({ ...r, [field]: value, ...extra } as T);
      });
      return changed ? next : recs;
    });
  }, [mutate, idOf, calc]);

  const insert = useCallback((rec: T, index = 0) => {
    mutate((recs) => [...recs.slice(0, index), calc(rec), ...recs.slice(index)]);
    setPage(0);
  }, [mutate, calc]);

  const duplicate = useCallback((id: number | string, makeCopy: (src: T) => T) => {
    mutate((recs) => {
      const i = recs.findIndex((r) => idOf(r) === id);
      return i < 0 ? recs : [...recs.slice(0, i + 1), calc(makeCopy(recs[i])), ...recs.slice(i + 1)];
    });
  }, [mutate, idOf, calc]);

  const remove = useCallback((ids: (number | string)[]) => {
    const set = new Set(ids);
    mutate((recs) => recs.filter((r) => !set.has(idOf(r))));
  }, [mutate, idOf]);

  const undo = useCallback(() => setState((s) =>
    s.past.length ? { ...s, records: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.records, ...s.future] } : s), []);
  const redo = useCallback(() => setState((s) =>
    s.future.length ? { ...s, records: s.future[0], past: [...s.past, s.records], future: s.future.slice(1) } : s), []);

  const reject = useCallback(() => setState((s) => ({ ...s, records: s.committed, past: [...s.past, s.records], future: [] })), []);

  const sync = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    const { created, updated, removed } = meta.changes;
    if (meta.invalid) return { ok: false, message: `${meta.invalid} trade(s) have errors. Fix them before saving.` };
    if (!created.length && !updated.length && !removed.length) return { ok: true, message: 'Nothing to save' };
    setBusy('saving');
    try {
      await (cfgRef.current.syncFn?.(meta.changes) ?? Promise.resolve());
      setState((s) => ({ records: s.records, committed: s.records, past: [], future: [] }));
      return { ok: true, message: `Saved: ${created.length} created, ${updated.length} updated, ${removed.length} deleted` };
    } catch (e) {
      return { ok: false, message: `Save failed: ${(e as Error).message}` };
    } finally {
      setBusy(false);
    }
  }, [meta]);

  /** Ext store.loadData(): replace all records and clear change tracking */
  const load = useCallback((data: T[]) => {
    const recs = data.map((r) => calc(r));
    setState({ records: recs, committed: recs, past: [], future: [] });
    setExpanded(new Set());
    setPage(0);
  }, [calc]);

  const reload = useCallback(async () => {
    setBusy('loading');
    await new Promise((r) => setTimeout(r, 400));
    setBusy(false);
  }, []);

  /* ---------------- view-state setters (reset to page 1 like Ext) ---------------- */
  const setSorters = useCallback((s: Sorter[]) => setSortersRaw(s), []);
  const setFilterModel = useCallback((m: FilterModel | null) => { setFilterModelRaw(m ?? {}); setPage(0); }, []);
  const setSearch = useCallback((q: string) => { setSearchRaw(q); setPage(0); }, []);
  const setPageSize = useCallback((n: number) => { setPageSizeRaw(n); setPage(0); }, []);
  const setGroupField = useCallback((f: string | null) => { setGroupFieldRaw(f); setCollapsed(new Set()); setPage(0); }, []);

  const toggleGroup = useCallback((key: string) => setCollapsed((c) => {
    const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n;
  }), []);
  const expandAllGroups = useCallback(() => setCollapsed(new Set()), []);
  const collapseAllGroups = useCallback(() => {
    if (!groupField) return;
    setCollapsed(new Set(pipeline.pageRecs.map((r) => String(get(r, groupField) ?? '(blank)'))));
  }, [groupField, pipeline.pageRecs]);
  const toggleExpanded = useCallback((id: number | string) => setExpanded((e) => {
    const n = new Set(e); if (n.has(id)) n.delete(id); else n.add(id); return n;
  }), []);

  const getRecord = useCallback((id: number | string) => records.find((r) => idOf(r) === id), [records, idOf]);

  return {
    // data
    rows, totalRow, filteredRecords: pipeline.filtered, getRecord,
    total: pipeline.total, page: pipeline.safePage, pageCount: pipeline.pageCount, pageStart: pipeline.start,
    pageSize, groupField, sorters, filterModel, search, busy, expanded,
    changes: meta.changes, invalidCount: meta.invalid,
    isDirty: meta.changes.created.length + meta.changes.updated.length + meta.changes.removed.length > 0,
    canUndo: state.past.length > 0, canRedo: state.future.length > 0,
    // commands
    update, insert, duplicate, remove, undo, redo, reject, sync, reload, load,
    setSorters, setFilterModel, setSearch, setPage, setPageSize, setGroupField,
    toggleGroup, expandAllGroups, collapseAllGroups, toggleExpanded,
  };
}

export type GridStore<T extends object> = ReturnType<typeof useGridStore<T>>;
