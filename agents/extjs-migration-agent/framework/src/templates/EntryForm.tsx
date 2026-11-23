/**
 * Entry Form template: create or edit one record, described entirely by display.config (EntryConfig).
 *
 *   params.id = 'new' (or absent)  create, starting from the fields' defaults
 *   params.id = '12'               load GET {endpoint}/12, save with PUT {endpoint}/12 (changed fields only)
 *
 * Optional parts of the config: sections (panels, field sets, tabs), actions (Save, Delete, Copy, Audit, Reset,
 * Cancel, custom), and audit history. Hooks let a module add code without touching generated files. Field
 * errors from the server ({ errors: { field: message } }) appear next to the fields. Which actions are offered
 * comes from the display's actions (create / update / delete ...); the API still enforces the permission.
 *
 * The same component runs embedded (Master-Slave): `embed` replaces the tab frame with callbacks.
 */
import { useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { Loading, Problem } from '../display/DisplayHost';
import { FrameContext, useShell, type ShellApi } from '../shell/context';
import type { ActionDef, DisplayProps, EntryConfig, FieldDef, SectionDef } from '../types';
import { article, changedValues, coerceAll, defaults, isNumeric, isVisible, validate, type Errors, type Validator, type Values } from './fields';
import { useLookup } from './lookups';

/** What a module's hooks receive with an action or a save. */
export interface EntryContext {
  shell: ShellApi;
  config: EntryConfig;
  record: Values | null;
  values: Values;
  isNew: boolean;
  setValues: (patch: Values) => void;
  reload: () => void;
}

/** Code a module adds to a generated Entry display (kept in a developer-owned file). */
export interface EntryHooks {
  /** turn the loaded record into form values (e.g. derive a field) */
  afterLoad?: (record: Values) => Values;
  /** last chance to change or refuse what is sent; throw an Error to stop with its message */
  beforeSave?: (values: Values, ctx: EntryContext) => Values | Promise<Values>;
  afterSave?: (saved: Values, ctx: EntryContext) => void;
  /** named validators referenced by FieldDef.validator */
  validators?: Record<string, Validator>;
  /** cross-field rules: return { field: message } */
  validate?: (values: Values) => Errors;
  /** custom actions without a path */
  onAction?: (actionId: string, ctx: EntryContext) => void | Promise<void>;
  /** extra content under the form (e.g. a related list) */
  renderExtra?: (ctx: EntryContext) => ReactNode;
}

/** Host callbacks when the form is a panel inside another display (Master-Slave). */
export interface EntryEmbedding {
  /** record id, 'new' or null (nothing selected) */
  recordId: string | number | null;
  /** values every new record starts with and keeps (e.g. the master's key) */
  fixedValues?: Values;
  onSaved?: (record: Values, created: boolean) => void;
  onDeleted?: (id: unknown) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onClose?: () => void;
  /** text shown when recordId is null */
  emptyText?: string;
}

const DEFAULT_ACTIONS: ActionDef[] = [{ id: 'save', kind: 'save' }, { id: 'cancel', kind: 'cancel', label: 'Close' }];

function toInputValue(f: FieldDef, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (f.type === 'datetime' && typeof value === 'string') return value.slice(0, 16);
  if (f.type === 'date' && typeof value === 'string') return value.slice(0, 10);
  return String(value);
}

function Field({ f, value, error, disabled, onChange }: { f: FieldDef; value: unknown; error?: string; disabled: boolean; onChange: (v: unknown) => void }) {
  const shell = useShell();
  const id = useId();
  const { options: lookupOptions, error: lookupError } = useLookup(shell.api, f.lookup);
  const describedBy = error ? id + '-err' : f.help ? id + '-help' : undefined;
  const common = { id, name: f.name, disabled, 'aria-invalid': !!error, 'aria-describedby': describedBy, required: f.required };
  const opts = f.lookup ? lookupOptions : (f.options || []).map((o) => ({ value: o, label: String(o) }));
  const widget = f.widget || (f.type === 'boolean' ? 'checkbox' : f.type === 'multiselect' ? 'multiselect'
    : f.type === 'text' ? 'textarea' : (f.lookup || f.options || f.type === 'select' || f.type === 'lookup') ? 'select' : 'input');
  let input: ReactNode;
  let inline = false;
  if (widget === 'checkbox' || widget === 'switch') {
    inline = true;
    input = <input type="checkbox" role={widget === 'switch' ? 'switch' : undefined} className={widget === 'switch' ? 'xf-switch' : undefined}
      {...common} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  } else if (widget === 'radio') {
    input = (
      <div className="xf-radio-group" role="radiogroup" aria-labelledby={id + '-lbl'} aria-invalid={!!error}>
        {opts.map((o) => (
          <label key={String(o.value)} className="xf-check">
            <input type="radio" name={`${id}-${f.name}`} disabled={disabled} checked={String(value ?? '') === String(o.value)} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    );
  } else if (widget === 'multiselect') {
    const current = Array.isArray(value) ? value.map(String) : [];
    input = (
      <div className="xf-multi" role="group" aria-labelledby={id + '-lbl'} aria-invalid={!!error}>
        {opts.map((o) => {
          const on = current.includes(String(o.value));
          return (
            <label key={String(o.value)} className={'xf-chip-option' + (on ? ' xf-on' : '')}>
              <input type="checkbox" disabled={disabled} checked={on}
                onChange={(e) => onChange(e.target.checked ? [...current, String(o.value)].map((x) => opts.find((k) => String(k.value) === x)?.value ?? x)
                  : current.filter((x) => x !== String(o.value)).map((x) => opts.find((k) => String(k.value) === x)?.value ?? x))} />
              <span>{o.label}</span>
            </label>
          );
        })}
        {!opts.length && <span className="xf-muted">No options</span>}
      </div>
    );
  } else if (widget === 'select') {
    input = (
      <select {...common} value={value === null || value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.placeholder || (f.required ? 'Select…' : '(none)')}</option>
        {opts.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    );
  } else if (widget === 'textarea') {
    input = <textarea {...common} rows={3} maxLength={f.maxLength} placeholder={f.placeholder} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  } else {
    const type = f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : f.type === 'time' ? 'time' : 'text';
    const el = (
      <input type={type} {...common} inputMode={isNumeric(f) ? (f.type === 'integer' ? 'numeric' : 'decimal') : undefined}
        maxLength={f.maxLength} placeholder={f.placeholder} style={f.upperCase ? { textTransform: 'uppercase' } : undefined}
        value={toInputValue(f, value)} onChange={(e) => onChange(e.target.value)} />
    );
    input = f.type === 'currency' && f.currency ? <div className="xf-affix"><span aria-hidden="true">{f.currency}</span>{el}</div> : el;
  }
  const label = <>{f.label}{f.required && <span className="xf-req" aria-hidden="true"> *</span>}</>;
  return (
    <div className={'xf-field' + (inline ? ' xf-field-check' : '') + (error ? ' xf-field-invalid' : '')}
      style={f.span && f.span > 1 ? { gridColumn: `span ${f.span}` } : undefined} data-field={f.name}>
      {inline
        ? <label htmlFor={id} className="xf-check">{input}<span>{label}</span></label>
        : <><label htmlFor={widget === 'radio' || widget === 'multiselect' ? undefined : id} id={id + '-lbl'}>{label}</label>{input}</>}
      {f.help && !error && <small id={id + '-help'} className="xf-muted">{f.help}</small>}
      {error && <small id={id + '-err'} className="xf-error">{error}</small>}
      {lookupError && <small className="xf-error">List not available: {lookupError}</small>}
    </div>
  );
}

interface AuditEntry { id: number; at: string; user: string; action: string; changed?: string[] | string; before?: Values | null; after?: Values | null; reason?: string }
const changedList = (c: AuditEntry['changed']): string[] => (Array.isArray(c) ? c : typeof c === 'string' && c ? c.split(/,\s*/) : []);

function AuditDrawer({ shell, cfg, id, fields, onClose }: { shell: ShellApi; cfg: EntryConfig; id: unknown; fields: FieldDef[]; onClose: () => void }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, AuditEntry>>({});
  const a = cfg.audit!;
  const expand = (r: AuditEntry) => {
    const next = open === r.id ? null : r.id;
    setOpen(next);
    // list rows may leave out before/after; the entry itself has them ({endpoint}/{id})
    if (next !== null && !details[r.id] && r.before === undefined && r.after === undefined) {
      shell.api.get<AuditEntry>(`${a.endpoint}/${r.id}`).then((d) => setDetails((m) => ({ ...m, [r.id]: d })), () => setDetails((m) => ({ ...m, [r.id]: r })));
    }
  };
  useEffect(() => {
    let live = true;
    shell.api.get<AuditEntry[]>(a.endpoint, { [a.entityTypeParam || 'entityType']: a.entityType, [a.idParam || 'entityId']: String(id), sort: JSON.stringify([{ property: 'at', direction: 'DESC' }]) })
      .then((r) => live && setRows([...(r || [])].sort((x, y) => String(y.at).localeCompare(String(x.at)))), (e: ApiError) => live && setError(e.message));
    return () => { live = false; };
  }, [shell.api, a.endpoint, a.entityType, a.entityTypeParam, a.idParam, id]);
  const label = (name: string) => fields.find((f) => f.name === name)?.label || name;
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v));
  return (
    <aside className="xf-drawer" aria-label="Change history">
      <header><h3>History</h3><button type="button" className="xf-tab-close" aria-label="Close history" onClick={onClose}>×</button></header>
      {error && <p className="xf-error">{error}</p>}
      {!rows && !error && <Loading label="Loading history…" />}
      {rows && !rows.length && <p className="xf-muted">No changes recorded.</p>}
      <ol className="xf-audit">
        {(rows || []).map((r) => (
          <li key={r.id}>
            <button type="button" className="xf-audit-head" aria-expanded={open === r.id} onClick={() => expand(r)}>
              <span className={'xf-pill xf-pill-' + r.action.toLowerCase()}>{r.action}</span>
              <span>{new Date(r.at).toLocaleString()}</span><span className="xf-muted">{r.user}</span>
            </button>
            {open === r.id && (() => {
              const d = details[r.id] || (r.before !== undefined || r.after !== undefined ? r : null);
              if (!d) return <Loading label="Loading change…" />;
              const keys = d.action === 'UPDATE' ? changedList(d.changed) : Object.keys(d.after || d.before || {}).filter((k) => k !== 'id');
              return (
                <table className="xf-audit-diff">
                  <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
                  <tbody>{keys.map((k) => <tr key={k}><td>{label(k)}</td><td>{show(d.before?.[k])}</td><td>{show(d.after?.[k])}</td></tr>)}</tbody>
                </table>
              );
            })()}
            {r.reason && <small className="xf-muted">Reason: {r.reason}</small>}
          </li>
        ))}
      </ol>
    </aside>
  );
}

function sectionsOf(cfg: EntryConfig, fields: FieldDef[]): SectionDef[] {
  if (!cfg.sections?.length) return [{ id: '_all', kind: 'plain', fields: fields.map((f) => f.name) }];
  const used = new Set(cfg.sections.flatMap((s) => s.fields));
  const rest = fields.filter((f) => !used.has(f.name)).map((f) => f.name);
  return rest.length ? [...cfg.sections, { id: '_rest', kind: 'plain', fields: rest }] : cfg.sections;
}

export function EntryFormDisplay({ meta, params, config, hooks = {}, embed }: DisplayProps & { config?: Partial<EntryConfig>; hooks?: EntryHooks; embed?: EntryEmbedding }) {
  const cfg = useMemo(() => ({ ...(meta.config || {}), ...(config || {}) }) as EntryConfig, [meta.config, config]);
  const shell = useShell();
  const frame = useContext(FrameContext);
  const idField = cfg.idField || 'id';
  const requested = embed ? embed.recordId : (params.id ?? 'new');
  const [copyOf, setCopyOf] = useState<Values | null>(null);
  const isNew = copyOf !== null || requested === null || requested === 'new' || requested === undefined;
  const recordId = isNew ? null : String(requested);
  const can = (key: string) => meta.actions?.[key] ?? true;
  const allowed = isNew ? can('create') : can('update');
  const visible = useMemo(() => cfg.fields.filter((f) => !f.hidden), [cfg.fields]);
  const fixed = embed?.fixedValues;
  const startValues = () => defaults(cfg.fields, fixed || {});

  const [original, setOriginal] = useState<Values | null>(isNew ? startValues() : null);
  const [values, setValuesState] = useState<Values>(isNew ? startValues() : {});
  const [errors, setErrors] = useState<Errors>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ text: string; run: () => void; danger?: boolean; ok?: string } | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [tab, setTab] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => Object.fromEntries((cfg.sections || []).filter((s) => s.collapsed).map((s) => [s.id, true])));
  const [reloadKey, setReloadKey] = useState(0);

  // load the record (or start a new one) whenever the requested id changes
  useEffect(() => {
    setErrors({}); setFormError(null); setLoadError(null);
    if (copyOf) return undefined;
    if (recordId === null) { const v = startValues(); setOriginal(v); setValuesState(v); return undefined; }
    let live = true;
    setOriginal(null);
    shell.api.get<Values>(`${cfg.endpoint}/${encodeURIComponent(recordId)}`).then((rec) => {
      if (!live) return;
      const v = hooks.afterLoad ? hooks.afterLoad(rec) : rec;
      setOriginal(v);
      setValuesState(v);
      if (!embed && cfg.titleField && rec[cfg.titleField]) frame?.setTitle(`${cfg.entity}: ${rec[cfg.titleField]}`);
    }, (e: ApiError) => live && setLoadError(e.status === 404 ? `${cfg.entity} ${recordId} does not exist.` : e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, reloadKey, cfg.endpoint, copyOf === null]);

  const typed = coerceAll(cfg.fields, values);
  const dirty = original ? (copyOf !== null || Object.keys(changedValues(cfg.fields, original, typed)).length > 0) : false;
  const dirtyRef = useRef(dirty);
  useEffect(() => { if (dirtyRef.current !== dirty) { dirtyRef.current = dirty; embed?.onDirtyChange?.(dirty); } }, [dirty, embed]);

  const setValues = (patch: Values) => {
    setValuesState((prev) => ({ ...prev, ...patch }));
    setErrors((prev) => { const keys = Object.keys(patch).filter((k) => prev[k]); if (!keys.length) return prev; const n = { ...prev }; keys.forEach((k) => delete n[k]); return n; });
  };
  const ctx = (): EntryContext => ({ shell, config: cfg, record: original, values: typed, isNew, setValues, reload: () => setReloadKey((k) => k + 1) });

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!allowed) return;
    setFormError(null);
    const errs = { ...validate(cfg.fields, typed, hooks.validators), ...(hooks.validate ? hooks.validate(typed) : {}) };
    setErrors(errs);
    if (Object.keys(errs).length) { setFormError('Please correct the highlighted fields.'); return; }
    setBusy('save');
    try {
      let body: Values = isNew ? { ...typed, ...(fixed || {}) } : changedValues(cfg.fields, original || {}, typed);
      if (isNew) delete body[idField];
      if (!isNew && !Object.keys(body).length) { shell.notify('Nothing to save: no changes.', 'info'); return; }
      if (hooks.beforeSave) body = await hooks.beforeSave(body, ctx());
      const saved = isNew
        ? await shell.api.post<Values>(cfg.endpoint, body)
        : await shell.api.put<Values>(`${cfg.endpoint}/${encodeURIComponent(recordId!)}`, body);
      shell.notify(`${cfg.entity} saved`, 'success');
      shell.emit('records-changed', { entity: cfg.entity, id: saved?.[idField] });
      hooks.afterSave?.(saved, ctx());
      setCopyOf(null);
      if (embed) {
        embed.onSaved?.(saved, isNew);
        if (!isNew) { setOriginal(saved); setValuesState(saved); }
      } else if (isNew && saved && saved[idField] !== undefined) {
        frame?.replaceParams({ id: String(saved[idField]) });
        setOriginal(saved); setValuesState(saved);
      } else {
        setOriginal(saved); setValuesState(saved);
      }
    } catch (err) {
      const ae = err as ApiError;
      if (ae.fieldErrors) setErrors(ae.fieldErrors);
      setFormError(ae.message || 'Saving failed');
    } finally {
      setBusy(null);
    }
  }

  function leave() {
    if (embed) { embed.onClose?.(); return; }
    frame?.close();
    if (cfg.summaryDisplay) shell.open(cfg.summaryDisplay);
  }

  async function remove() {
    setConfirm(null);
    setBusy('delete');
    try {
      await shell.api.del(`${cfg.endpoint}/${encodeURIComponent(recordId!)}`);
      shell.notify(`${cfg.entity} deleted`, 'success');
      shell.emit('records-changed', { entity: cfg.entity, id: recordId });
      if (embed) embed.onDeleted?.(recordId); else leave();
    } catch (err) {
      setFormError((err as ApiError).message);
    } finally { setBusy(null); }
  }

  function copy() {
    const src = { ...typed };
    delete src[idField];
    for (const k of cfg.copyExclude || []) delete src[k];
    const titleF = cfg.titleField;
    if (titleF && typeof src[titleF] === 'string') src[titleF] = `${src[titleF]} (copy)`;
    setCopyOf(src);
    setOriginal(defaults(cfg.fields, fixed || {}));
    setValuesState({ ...src, ...(fixed || {}) });
    setErrors({});
    shell.notify(`Copy of ${cfg.entity.toLowerCase()} ready: review and Save to create it.`, 'info');
  }

  async function custom(a: ActionDef) {
    setConfirm(null);
    if (!a.path) { await hooks.onAction?.(a.id, ctx()); return; }
    setBusy(a.id);
    try {
      await shell.api.post(`${cfg.endpoint}/${encodeURIComponent(recordId!)}/${a.path}`, {});
      shell.notify(`${a.label || a.id} done`, 'success');
      shell.emit('records-changed', { entity: cfg.entity, id: recordId });
      if (a.reload !== false) setReloadKey((k) => k + 1);
    } catch (err) {
      setFormError((err as ApiError).message);
    } finally { setBusy(null); }
  }

  if (embed && requested === null && copyOf === null) return <div className="xf-empty">{embed.emptyText || `Select ${article(cfg.entity)} to see its details.`}</div>;
  if (loadError) return <Problem title={`Cannot open ${cfg.entity}`}><p>{loadError}</p></Problem>;
  if (!original) return <Loading label={`Loading ${cfg.entity}…`} />;

  const actions = cfg.actions?.length ? cfg.actions : DEFAULT_ACTIONS;
  const run = (a: ActionDef, fn: () => void) => (a.confirm ? setConfirm({ text: a.confirm, run: fn, ok: a.label }) : fn());
  const button = (a: ActionDef): ReactNode => {
    const cls = 'xf-btn' + (a.style === 'primary' ? ' xf-btn-primary' : a.style === 'danger' ? ' xf-btn-danger' : '');
    const icon = a.icon ? <i className={a.icon} aria-hidden="true" /> : null;
    switch (a.kind) {
      case 'save':
        if (!allowed) return <span key={a.id} className="xf-badge">Read only</span>;
        return <button key={a.id} type="submit" className={'xf-btn xf-btn-primary'} disabled={!!busy || (!isNew && !dirty)}>{icon}{busy === 'save' ? 'Saving…' : a.label || 'Save'}</button>;
      case 'delete':
        if (isNew || !can(a.permission || 'delete')) return null;
        return <button key={a.id} type="button" className={cls} disabled={!!busy}
          onClick={() => setConfirm({ text: a.confirm || `Delete this ${cfg.entity.toLowerCase()}? This cannot be undone.`, run: remove, danger: true, ok: 'Delete' })}>{icon}{a.label || 'Delete'}</button>;
      case 'copy':
        if (isNew || !can(a.permission || 'create')) return null;
        return <button key={a.id} type="button" className={cls} disabled={!!busy || dirty} title={dirty ? 'Save or reset your changes first' : undefined} onClick={() => run(a, copy)}>{icon}{a.label || 'Copy'}</button>;
      case 'audit':
        if (isNew || !cfg.audit || (a.permission && !can(a.permission))) return null;
        return <button key={a.id} type="button" className={cls} aria-pressed={auditOpen} onClick={() => setAuditOpen((o) => !o)}>{icon}{a.label || 'History'}</button>;
      case 'reset':
        return <button key={a.id} type="button" className={cls} disabled={!dirty || !!busy}
          onClick={() => run(a, () => { if (copyOf) { setCopyOf(null); } else { setValuesState(original); setErrors({}); setFormError(null); } })}>{icon}{a.label || 'Reset'}</button>;
      case 'cancel':
        return <button key={a.id} type="button" className={cls} onClick={() => (dirty ? setConfirm({ text: 'Discard your unsaved changes?', run: () => { setConfirm(null); if (copyOf) setCopyOf(null); leave(); }, danger: true, ok: 'Discard' }) : leave())}>{icon}{a.label || 'Close'}</button>;
      case 'custom':
        if (a.permission && !can(a.permission)) return null;
        if (a.path && isNew) return null;
        return <button key={a.id} type="button" className={cls} disabled={!!busy || (!!a.path && dirty)} onClick={() => run(a, () => custom(a))}>{icon}{busy === a.id ? 'Working…' : a.label || a.id}</button>;
      default:
        return null;
    }
  };

  const disabledFor = (f: FieldDef) => !allowed || !!f.readOnly || (!isNew && !!f.readOnlyOnEdit) || !!(fixed && f.name in fixed);
  const fieldEl = (name: string) => {
    const f = cfg.fields.find((x) => x.name === name);
    if (!f || !isVisible(f, typed)) return null;
    return <Field key={f.name} f={f} value={values[f.name]} error={errors[f.name]} disabled={disabledFor(f)} onChange={(v) => setValues({ [f.name]: v })} />;
  };
  const grid = (s: SectionDef) => (
    <div className="xf-form-grid" style={{ gridTemplateColumns: `repeat(${s.columns || cfg.columns || 2}, minmax(0, 1fr))` }}>
      {s.fields.map(fieldEl)}
    </div>
  );
  const sections = sectionsOf(cfg, visible);
  const blocks: ReactNode[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (s.kind === 'tab') {
      const group: SectionDef[] = [];
      while (i < sections.length && sections[i].kind === 'tab') group.push(sections[i++]);
      i--;
      const gid = group[0].id;
      const active = tab[gid] && group.some((g) => g.id === tab[gid]) ? tab[gid] : group[0].id;
      const errIn = (g: SectionDef) => g.fields.some((f) => errors[f]);
      blocks.push(
        <div key={'tabs-' + gid} className="xf-form-tabs">
          <div role="tablist" className="xf-form-tablist">
            {group.map((g) => (
              <button key={g.id} type="button" role="tab" id={`tab-${g.id}`} aria-selected={active === g.id} aria-controls={`panel-${g.id}`}
                className={'xf-form-tab' + (active === g.id ? ' xf-active' : '') + (errIn(g) ? ' xf-has-error' : '')}
                onClick={() => setTab((t) => ({ ...t, [gid]: g.id }))}>{g.title || g.id}{errIn(g) && <span className="xf-dot" aria-label="has errors" />}</button>
            ))}
          </div>
          {group.map((g) => <div key={g.id} role="tabpanel" id={`panel-${g.id}`} aria-labelledby={`tab-${g.id}`} hidden={active !== g.id}>{g.description && <p className="xf-muted xf-section-desc">{g.description}</p>}{grid(g)}</div>)}
        </div>,
      );
    } else if (s.kind === 'plain' || !s.title) {
      blocks.push(<div key={s.id} className="xf-section xf-section-plain">{grid(s)}</div>);
    } else {
      const isCollapsed = !!collapsed[s.id];
      const head = s.collapsible
        ? <button type="button" className="xf-section-toggle" aria-expanded={!isCollapsed} onClick={() => setCollapsed((c) => ({ ...c, [s.id]: !isCollapsed }))}><span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>{s.title}</button>
        : <span>{s.title}</span>;
      blocks.push(
        s.kind === 'fieldset'
          ? <fieldset key={s.id} className="xf-section xf-section-fieldset"><legend>{head}</legend>{!isCollapsed && <>{s.description && <p className="xf-muted xf-section-desc">{s.description}</p>}{grid(s)}</>}</fieldset>
          : <section key={s.id} className="xf-section xf-section-panel" aria-label={s.title}><h3 className="xf-section-title">{head}</h3>{!isCollapsed && <>{s.description && <p className="xf-muted xf-section-desc">{s.description}</p>}{grid(s)}</>}</section>,
      );
    }
  }

  const title = isNew
    ? copyOf ? `New ${cfg.entity} (copy)` : `New ${cfg.entity}`
    : `${cfg.entity}${cfg.titleField && original[cfg.titleField] ? ': ' + original[cfg.titleField] : ''}`;

  return (
    <form className={'xf-entry' + (embed ? ' xf-entry-embedded' : '')} onSubmit={save} noValidate aria-label={embed ? title : meta.title}>
      <div className="xf-toolbar">
        <h2 className="xf-display-title">{title}</h2>
        {dirty && <span className="xf-badge xf-badge-warn" title="Unsaved changes">Unsaved</span>}
        <span className="xf-spacer" />
        {actions.map(button)}
      </div>
      {confirm && (
        <div className="xf-confirm" role="alertdialog" aria-label="Confirm">
          <span>{confirm.text}</span>
          <button type="button" className={'xf-btn ' + (confirm.danger ? 'xf-btn-danger' : 'xf-btn-primary')} onClick={confirm.run}>{confirm.ok || 'OK'}</button>
          <button type="button" className="xf-btn" onClick={() => setConfirm(null)}>Cancel</button>
        </div>
      )}
      {formError && <p className="xf-error xf-form-error" role="alert">{formError}</p>}
      <div className="xf-entry-body">
        <fieldset className="xf-entry-fields" disabled={busy === 'save'}>
          {blocks}
          {hooks.renderExtra?.(ctx())}
        </fieldset>
        {auditOpen && recordId !== null && <AuditDrawer shell={shell} cfg={cfg} id={original[idField] ?? recordId} fields={cfg.fields} onClose={() => setAuditOpen(false)} />}
      </div>
    </form>
  );
}

/** An Entry display whose fields live in code (a module's schema), not in the database. */
export function createEntryDisplay(config: EntryConfig, hooks?: EntryHooks) {
  const View = (props: DisplayProps) => <EntryFormDisplay {...props} config={config} hooks={hooks} />;
  View.displayName = `Entry(${config.entity})`;
  return View;
}

export default EntryFormDisplay;
