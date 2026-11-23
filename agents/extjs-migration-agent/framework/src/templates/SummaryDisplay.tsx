/**
 * Summary template: browse, search, filter, export and manage a collection, on the shared DataGrid.
 * Described entirely by display.config (SummaryConfig):
 *
 *  - searchFields   a search panel above the grid; values are sent to the server as query parameters
 *  - remote         server paging and sorting (start / limit / sort); otherwise everything loads and the grid
 *                   filters, sorts and pages in the browser
 *  - toolbarActions / rowActions   New, Open, Delete, Refresh, Export and custom actions (permission-aware)
 *  - endpoint       may contain {param} placeholders filled from the display's params (child collections)
 *
 * New / Open / Delete follow the display's actions and open the configured Entry display. Reloads when another
 * display reports changes to the same entity. Embedded (Master-Slave master panel) it reports the selection.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { Problem } from '../display/DisplayHost';
import { DataGrid, fmtDate, fmtNumber } from '../grid';
import type { ColumnConfig, DataGridHandle } from '../grid';
import { useShell, type ShellApi } from '../shell/context';
import type { ActionDef, ColumnDef, DisplayProps, SearchFieldDef, SummaryConfig } from '../types';
import { useLookup } from './lookups';

type Renderer = (value: unknown, record: any) => ReactNode;
const renderers = new Map<string, Renderer>();

/** Named cell renderers that manifests can refer to (column.renderer = 'indian'). */
export function registerRenderer(name: string, fn: Renderer): void { renderers.set(name, fn); }

/** Shows the label(s) of lookup key(s), from the shared lookup cache. */
function LookupLabel({ src, value }: { src: NonNullable<ColumnDef['lookup']>; value: unknown }) {
  const shell = useShell();
  const { options } = useLookup(shell.api, src);
  const keys = Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value];
  return <>{keys.map((k) => options.find((o) => String(o.value) === String(k))?.label ?? String(k)).join(', ')}</>;
}

const fmtDateTime = (v: unknown) => (typeof v === 'string' && v.length >= 16 ? `${fmtDate(v.slice(0, 10))} ${v.slice(11, 16)}` : typeof v === 'string' ? fmtDate(v) : '');

export function toGridColumns(cols: ColumnDef[]): ColumnConfig<any>[] {
  return cols.map((c) => {
    const col: ColumnConfig<any> = {
      dataIndex: c.field, text: c.text, type: c.type, width: c.width, flex: c.flex, align: c.align, decimals: c.decimals,
      format: c.format, options: c.options, filter: c.filter, hidden: c.hidden, badgeTones: c.badgeTones,
    };
    if (c.sortable === false) col.sortable = false;
    if (c.lookup) { const src = c.lookup; col.renderer = (v) => <LookupLabel src={src} value={v} />; col.filter = false; }
    else if (c.renderer === 'badge') col.renderer = 'badge';
    else if (c.renderer?.startsWith('currency:')) {
      const code = c.renderer.slice(9);
      col.renderer = (v) => (typeof v === 'number' ? `${code} ${fmtNumber(v, c.decimals ?? 2)}` : '');
    } else if (c.renderer === 'datetime') col.renderer = (v) => fmtDateTime(v);
    else if (c.renderer === 'time') col.renderer = (v) => (typeof v === 'string' ? v.slice(0, 5) : '');
    else if (c.renderer === 'list') col.renderer = (v) => (Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '' : String(v));
    else if (c.renderer) {
      const fn = renderers.get(c.renderer);
      if (fn) col.renderer = fn;
    } else if (c.type === 'boolean' && (c.trueText || c.falseText)) {
      col.renderer = (v) => (v ? c.trueText ?? 'Yes' : c.falseText ?? 'No');
    }
    return col;
  });
}

/** Fills {name} placeholders of an endpoint; returns the names that have no value. */
export function fillEndpoint(endpoint: string, values: Record<string, unknown>): { path: string; missing: string[] } {
  const missing: string[] = [];
  const path = endpoint.replace(/\{(\w+)\}/g, (_, k) => {
    const v = values[k];
    if (v === undefined || v === null || v === '') { missing.push(k); return ''; }
    return encodeURIComponent(String(v));
  });
  return { path, missing };
}

/** What a module's hooks receive with a Summary action. */
export interface SummaryContext { shell: ShellApi; config: SummaryConfig; selection: any[]; reload: () => void; params: Record<string, unknown> }

export interface SummaryHooks {
  /** custom toolbar / row actions without a path */
  onAction?: (actionId: string, ctx: SummaryContext) => void | Promise<void>;
  /** change rows after loading (e.g. computed columns) */
  transformRows?: (rows: any[]) => any[];
  /** CSS class per row: xg-row-muted, xg-row-warn, xg-row-danger, xg-row-success */
  rowClass?: (record: any) => string | undefined;
}

/** Host callbacks when the grid is the master panel of a Master-Slave display. */
export interface SummaryEmbedding {
  selectedId?: unknown;
  /** called with the newly selected record (or null); return false to keep the old selection */
  onSelect: (record: any | null) => boolean | void;
  /** New from the toolbar */
  onNew?: () => void;
  /** reload when this number changes */
  refreshKey?: number;
  /** values for {param} placeholders and extra query parameters (e.g. the master key of a child list) */
  params?: Record<string, unknown>;
  title?: string;
}

function SearchField({ f, value, onChange }: { f: SearchFieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const shell = useShell();
  const { options } = useLookup(shell.api, f.lookup);
  const id = `sf-${f.name}`;
  const opts = f.lookup ? options : (f.options || []).map((o) => ({ value: o, label: String(o) }));
  let input: ReactNode;
  if (f.operator === 'between' && (f.type === 'date' || f.type === 'datetime' || f.type === 'number' || f.type === 'decimal' || f.type === 'integer' || f.type === 'currency')) {
    const v = (value as [unknown, unknown]) || ['', ''];
    const t = f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : 'text';
    input = (
      <span className="xf-range">
        <input id={id} type={t} aria-label={`${f.label} from`} value={String(v[0] ?? '')} onChange={(e) => onChange([e.target.value, v[1]])} />
        <span aria-hidden="true">–</span>
        <input type={t} aria-label={`${f.label} to`} value={String(v[1] ?? '')} onChange={(e) => onChange([v[0], e.target.value])} />
      </span>
    );
  } else if (f.type === 'boolean') {
    input = (
      <select id={id} value={value === undefined || value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option><option value="true">Yes</option><option value="false">No</option>
      </select>
    );
  } else if (opts.length || f.lookup || f.options) {
    input = (
      <select id={id} value={value === undefined || value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.placeholder || 'Any'}</option>
        {opts.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    );
  } else {
    const t = f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : 'text';
    input = <input id={id} type={t} placeholder={f.placeholder} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
  return <div className="xf-field xf-search-field"><label htmlFor={id}>{f.label}{f.required && <span className="xf-req" aria-hidden="true"> *</span>}</label>{input}</div>;
}

/** Query parameters for the search values ({param}; {param}From / {param}To for between, gte and lte). */
export function searchParams(fields: SearchFieldDef[], values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.name];
    const p = f.param || f.name;
    if (f.operator === 'between') {
      const [a, b] = (v as [unknown, unknown]) || [];
      if (a !== undefined && a !== null && a !== '') out[`${p}From`] = String(a);
      if (b !== undefined && b !== null && b !== '') out[`${p}To`] = String(b);
    } else if (v !== undefined && v !== null && v !== '') {
      // gte / lte use the same From / To parameters as a range, so one API contract serves all three
      const key = f.operator === 'gte' ? `${p}From` : f.operator === 'lte' ? `${p}To` : p;
      out[key] = Array.isArray(v) ? v.join(',') : String(v);
    }
  }
  return out;
}

const DEFAULT_TOOLBAR: ActionDef[] = [{ id: 'new', kind: 'new' }, { id: 'open', kind: 'open' }, { id: 'delete', kind: 'delete' }, { id: 'refresh', kind: 'refresh' }];

export function SummaryDisplay({ meta, params = {}, config, hooks = {}, embed }: DisplayProps & { config?: Partial<SummaryConfig>; hooks?: SummaryHooks; embed?: SummaryEmbedding }) {
  const cfg = useMemo(() => ({ ...(meta.config || {}), ...(config || {}) }) as SummaryConfig, [meta.config, config]);
  const shell = useShell();
  const idField = cfg.idField || 'id';
  const gridRef = useRef<DataGridHandle<any>>(null);
  const searchFields = cfg.searchFields || [];
  const initialSearch = useMemo(() => Object.fromEntries(searchFields.filter((f) => f.defaultValue !== undefined).map((f) => [f.name, f.defaultValue])), [searchFields]);
  const [search, setSearch] = useState<Record<string, unknown>>(initialSearch);
  const [applied, setApplied] = useState<Record<string, unknown>>(initialSearch);
  const [rows, setRows] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(cfg.pageSize || 50);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any[]>([]);
  const [confirm, setConfirm] = useState<{ text: string; run: () => void; ok?: string } | null>(null);
  const [started, setStarted] = useState(cfg.autoLoad !== false || !searchFields.some((f) => f.required));
  const columns = useMemo(() => toGridColumns(cfg.columns), [cfg.columns]);
  const can = (a: string) => meta.actions?.[a] ?? true;
  const allParams = useMemo(() => ({ ...(cfg.baseParams || {}), ...params, ...(embed?.params || {}) }), [cfg.baseParams, params, embed?.params]);
  const { path: endpoint, missing } = fillEndpoint(cfg.endpoint, allParams);
  const placeholderKeys = useMemo(() => new Set([...cfg.endpoint.matchAll(/\{(\w+)\}/g)].map((m) => m[1])), [cfg.endpoint]);

  const load = useCallback(() => {
    if (missing.length || !started) return;
    setLoading(true);
    const query: Record<string, string | number | undefined> = {};
    for (const [k, v] of Object.entries({ ...(cfg.baseParams || {}), ...(embed?.params || {}) })) if (!placeholderKeys.has(k)) query[k] = String(v);
    Object.assign(query, searchParams(searchFields, applied));
    if (cfg.sorters?.length) query.sort = JSON.stringify(cfg.sorters.map((s) => ({ property: s.property, direction: s.direction || 'ASC' })));
    if (cfg.remote) { query.start = (page - 1) * pageSize; query.limit = pageSize; }
    shell.api.get<any>(endpoint, query, { raw: true }).then((env) => {
      const data = Array.isArray(env) ? env : env?.data ?? [];
      setRows(hooks.transformRows ? hooks.transformRows(data) : data);
      setTotal(Array.isArray(env) ? data.length : Number(env?.total ?? data.length));
      setError(null);
    }, (e: ApiError) => setError(e.message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.api, endpoint, missing.length, started, applied, page, pageSize, cfg.remote, cfg.sorters, cfg.baseParams, embed?.params]);

  useEffect(() => { load(); }, [load, embed?.refreshKey]);
  useEffect(() => shell.on('records-changed', (d: any) => { if (!d || d.entity === cfg.entity) load(); }), [shell, cfg.entity, load]);

  // keep the grid's selection on the host's selected record (Master-Slave)
  const syncSelection = useCallback(() => {
    if (!embed) return;
    const api = gridRef.current?.api();
    if (!api) return;
    const want = embed.selectedId === undefined || embed.selectedId === null ? null : String(embed.selectedId);
    api.forEachNode((n: any) => {
      if (n.data?.__kind !== 'data') return;
      const on = want !== null && String(n.data.__recId) === want;
      if (n.isSelected() !== on) n.setSelected(on);
    });
  }, [embed]);
  useEffect(() => { if (rows) setTimeout(syncSelection, 0); }, [syncSelection, embed?.selectedId, rows]);

  const open = (rec?: any) => {
    if (embed) { if (rec) embed.onSelect(rec); else embed.onNew?.(); return; }
    if (cfg.entryDisplay) shell.open(cfg.entryDisplay, { ...(rec ? { id: rec[idField] } : { id: 'new' }) });
  };
  const ctx = (): SummaryContext => ({ shell, config: cfg, selection: selected, reload: load, params: allParams });
  const label = (rec: any) => String(rec?.[cfg.titleField || ''] ?? rec?.name ?? rec?.code ?? rec?.[idField]);

  async function remove(recs: any[]) {
    setConfirm(null);
    let ok = 0;
    for (const rec of recs) {
      try {
        await shell.api.del(`${endpoint}/${encodeURIComponent(rec[idField])}`);
        ok++;
      } catch (e) {
        shell.notify(`${label(rec)}: ${(e as ApiError).message}`, 'error');
      }
    }
    if (ok) {
      shell.notify(ok === 1 ? `${cfg.entity} deleted` : `${ok} ${(cfg.entityPlural || cfg.entity + 's').toLowerCase()} deleted`, 'success');
      shell.emit('records-changed', { entity: cfg.entity });
      if (embed) embed.onSelect(null);
    }
  }

  async function custom(a: ActionDef, recs: any[]) {
    setConfirm(null);
    if (!a.path) { await hooks.onAction?.(a.id, ctx()); return; }
    try {
      for (const rec of recs) await shell.api.post(`${endpoint}/${encodeURIComponent(rec[idField])}/${a.path}`, {});
      shell.notify(`${a.label || a.id} done`, 'success');
      shell.emit('records-changed', { entity: cfg.entity });
    } catch (e) { shell.notify((e as ApiError).message, 'error'); }
  }

  const ask = (a: ActionDef, text: string | undefined, fn: () => void) => (text ? setConfirm({ text, run: fn, ok: a.label }) : fn());

  const toolbarActions = cfg.toolbarActions?.length ? cfg.toolbarActions : DEFAULT_TOOLBAR;
  const one = selected.length === 1;
  const btn = (a: ActionDef): ReactNode => {
    const cls = 'xf-btn' + (a.style === 'primary' ? ' xf-btn-primary' : a.style === 'danger' ? ' xf-btn-danger' : '');
    const icon = a.icon ? <i className={a.icon} aria-hidden="true" /> : null;
    switch (a.kind) {
      case 'new':
        if (!(cfg.entryDisplay || embed?.onNew) || !can(a.permission || 'create')) return null;
        return <button key={a.id} type="button" className={'xf-btn xf-btn-primary'} onClick={() => open()}>{icon}{a.label || `New ${cfg.entity}`}</button>;
      case 'open':
        if (!cfg.entryDisplay || embed) return null;
        return <button key={a.id} type="button" className={cls} disabled={!one} onClick={() => open(selected[0])}>{icon}{a.label || 'Open'}</button>;
      case 'delete':
        if (!can(a.permission || 'delete') || meta.actions?.delete === undefined) return null;
        return <button key={a.id} type="button" className={cls} disabled={!selected.length}
          onClick={() => setConfirm({ text: a.confirm || (one ? `Delete ${cfg.entity.toLowerCase()} “${label(selected[0])}”? This cannot be undone.` : `Delete ${selected.length} ${(cfg.entityPlural || cfg.entity + 's').toLowerCase()}? This cannot be undone.`), run: () => remove(selected), ok: 'Delete' })}>{icon}{a.label || 'Delete'}</button>;
      case 'refresh':
        return <button key={a.id} type="button" className={cls} onClick={load} disabled={loading}>{icon}{a.label || 'Refresh'}</button>;
      case 'custom':
        if (a.permission && !can(a.permission)) return null;
        return <button key={a.id} type="button" className={cls} disabled={!!a.path && !selected.length}
          onClick={() => ask(a, a.confirm, () => custom(a, selected))}>{icon}{a.label || a.id}</button>;
      default:
        return null;
    }
  };

  if (missing.length) return <Problem title={`“${meta.title}” cannot open`}><p>It needs {missing.join(', ')}.</p></Problem>;
  if (error && !rows) return <Problem title={`Cannot load ${cfg.entityPlural || meta.title}`}><p>{error}</p><button type="button" className="xf-btn" onClick={load}>Try again</button></Problem>;

  function runSearch(e?: FormEvent) {
    e?.preventDefault();
    const req = searchFields.filter((f) => f.required && (search[f.name] === undefined || search[f.name] === '' || (Array.isArray(search[f.name]) && !(search[f.name] as unknown[]).some(Boolean))));
    if (req.length) { setSearchError(`Enter ${req.map((f) => f.label).join(', ')} to search.`); return; }
    setSearchError(null);
    setPage(1);
    setApplied({ ...search });
    setStarted(true);
  }
  function resetSearch() {
    setSearch(initialSearch);
    setApplied(initialSearch);
    setSearchError(null);
    setPage(1);
  }

  const rowActions = cfg.rowActions || [];
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className={'xf-summary' + (embed ? ' xf-summary-embedded' : '')}>
      {searchFields.length > 0 && (
        <form className="xf-search" onSubmit={runSearch} aria-label={`Search ${cfg.entityPlural || cfg.entity}`}>
          <div className="xf-search-fields">
            {searchFields.map((f) => <SearchField key={f.name} f={f} value={search[f.name]} onChange={(v) => setSearch((s) => ({ ...s, [f.name]: v }))} />)}
          </div>
          <div className="xf-search-buttons">
            <button type="submit" className="xf-btn xf-btn-primary">Search</button>
            <button type="button" className="xf-btn" onClick={resetSearch}>Reset</button>
          </div>
          {searchError && <p className="xf-error" role="alert">{searchError}</p>}
        </form>
      )}
      {confirm && (
        <div className="xf-confirm" role="alertdialog" aria-label="Confirm">
          <span>{confirm.text}</span>
          <button type="button" className="xf-btn xf-btn-danger" onClick={confirm.run}>{confirm.ok || 'OK'}</button>
          <button type="button" className="xf-btn" onClick={() => setConfirm(null)}>Cancel</button>
        </div>
      )}
      {!started ? <div className="xf-empty">{cfg.emptyText || 'Enter search criteria and press Search.'}</div> : (
        <div className="xf-summary-grid">
          <DataGrid
            data={rows || []}
            idField={idField as never}
            columns={columns}
            preset="standard"
            title={embed?.title ?? meta.title}
            recordName={cfg.entity.toLowerCase()}
            recordNamePlural={(cfg.entityPlural || cfg.entity + 's').toLowerCase()}
            features={{
              selection: cfg.selection || 'single', paging: cfg.remote || !cfg.pageSize ? false : { pageSize }, export: { csv: true, xlsx: true, fileName: meta.title },
              ...(cfg.remote ? { sorting: false, filters: false } : {}), ...(cfg.features || {}),
            }}
            height="100%"
            loading={loading && !rows}
            tbar={<>{toolbarActions.map(btn)}</>}
            handleRef={gridRef}
            clickSelection
            rowClass={hooks.rowClass}
            onSelectionChange={(recs) => {
              if (embed) {
                const next = recs[0] ?? null;
                const prevId = embed.selectedId;
                if ((next ? String(next[idField]) : null) !== (prevId === undefined || prevId === null ? null : String(prevId)) && next) {
                  if (embed.onSelect(next) === false) { setTimeout(syncSelection, 0); return; }
                }
              }
              setSelected(recs);
            }}
            onRowDoubleClick={(rec) => open(rec)}
            contextMenuItems={rowActions.length ? (rec: any) => rowActions.filter((a) => !a.permission || can(a.permission)).map((a) => ({
              text: a.label || a.id,
              danger: a.kind === 'delete',
              onClick: () => {
                if (a.kind === 'open') open(rec);
                else if (a.kind === 'delete') setConfirm({ text: `Delete ${cfg.entity.toLowerCase()} “${label(rec)}”? This cannot be undone.`, run: () => remove([rec]), ok: 'Delete' });
                else ask(a, a.confirm, () => custom(a, [rec]));
              },
            })) : undefined}
            stateId={`${meta.id}`}
          />
        </div>
      )}
      {started && rows && rows.length === 0 && !loading && <p className="xf-muted xf-summary-empty">{cfg.emptyText || `No ${(cfg.entityPlural || cfg.entity + 's').toLowerCase()} found.`}</p>}
      {cfg.remote && started && (
        <nav className="xf-pager" aria-label="Pages">
          <button type="button" className="xf-btn" disabled={page <= 1} onClick={() => setPage(1)} aria-label="First page">«</button>
          <button type="button" className="xf-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">‹</button>
          <span>Page {page} of {pages}</span>
          <button type="button" className="xf-btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">›</button>
          <button type="button" className="xf-btn" disabled={page >= pages} onClick={() => setPage(pages)} aria-label="Last page">»</button>
          <label className="xf-muted">Rows <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
          <span className="xf-spacer" />
          <span className="xf-muted">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : 'No records'}</span>
        </nav>
      )}
    </div>
  );
}

/** A Summary display whose configuration lives in code (a module's schema), not in the database. */
export function createSummaryDisplay(config: SummaryConfig, hooks?: SummaryHooks) {
  const View = (props: DisplayProps) => <SummaryDisplay {...props} config={config} hooks={hooks} />;
  View.displayName = `Summary(${config.entity})`;
  return View;
}

export default SummaryDisplay;
