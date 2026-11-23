/**
 * Master-Slave template: a master list and a linked detail panel in one display, composed from the Summary and
 * Entry templates (nothing is duplicated). Described by display.config (MasterSlaveConfig):
 *
 *   relation 'same'   the detail is the selected master record's form (list + form of one entity)
 *   relation 'child'  the detail lists the selected master's child records and edits one of them; new child
 *                     records get the master's key in `linkField`, and the child list is filtered by it
 *
 * The master's key reaches child operations as a query parameter ({linkField}=<key>) or through a {placeholder}
 * in the child endpoint (e.g. '/assets/{assetId}/outages'). Changing the master while the detail form has
 * unsaved changes follows `unsavedChanges`: confirm (default), discard, or block.
 *
 * Child permissions use the action keys detail-create / detail-update / detail-delete when the manifest declares
 * them, otherwise the display's create / update / delete.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useShell } from '../shell/context';
import type { DisplayMeta, DisplayProps, MasterSlaveConfig } from '../types';
import { article } from './fields';
import { EntryFormDisplay, type EntryHooks } from './EntryForm';
import { SummaryDisplay, type SummaryHooks } from './SummaryDisplay';

export interface MasterSlaveHooks { master?: SummaryHooks; detailList?: SummaryHooks; detail?: EntryHooks }

type Pending = { run: () => void } | null;

function childMeta(meta: DisplayMeta): DisplayMeta {
  const a = meta.actions || {};
  const pick = (k: string) => (`detail-${k}` in a ? a[`detail-${k}`] : a[k]);
  const actions: Record<string, boolean> = {};
  for (const k of ['create', 'update', 'delete']) { const v = pick(k); if (v !== undefined) actions[k] = v; }
  return { ...meta, actions };
}

export function MasterSlaveDisplay({ meta, params = {}, action, actionId, config, hooks = {} }: DisplayProps & { config?: Partial<MasterSlaveConfig>; hooks?: MasterSlaveHooks }) {
  const cfg = useMemo(() => ({ ...(meta.config || {}), ...(config || {}) }) as MasterSlaveConfig, [meta.config, config]);
  const shell = useShell();
  const masterId = cfg.master.idField || 'id';
  const keyField = cfg.masterKey || masterId;
  const child = cfg.relation === 'child';
  const [master, setMaster] = useState<any | null>(null);
  const [creatingMaster, setCreatingMaster] = useState(false);
  const [childId, setChildId] = useState<string | number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [masterRefresh, setMasterRefresh] = useState(0);
  const [childRefresh, setChildRefresh] = useState(0);
  // the user's split and orientation are remembered per display (browser storage, best effort)
  const layoutKey = `xf-ms-layout:${meta.id}`;
  const saved = useMemo(() => { try { return JSON.parse(localStorage.getItem(layoutKey) || 'null') as { split?: number; orientation?: string } | null; } catch { return null; } }, [layoutKey]);
  const defaultSplit = Math.min(80, Math.max(20, cfg.split ?? 45));
  const [split, setSplit] = useState(saved?.split ?? defaultSplit);
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>(saved?.orientation === 'vertical' || saved?.orientation === 'horizontal' ? saved.orientation : cfg.orientation || 'horizontal');
  const [narrow, setNarrow] = useState(false);
  useEffect(() => { try { localStorage.setItem(layoutKey, JSON.stringify({ split, orientation })); } catch { /* storage unavailable */ } }, [layoutKey, split, orientation]);
  const box = useRef<HTMLDivElement>(null);
  const policy = cfg.unsavedChanges || 'confirm';

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < (cfg.stackBelow ?? 900)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [cfg.stackBelow]);

  // the menu's "New ..." entry (action 'new') starts a new master record
  useEffect(() => { if (action === 'new' && !child) { setMaster(null); setCreatingMaster(true); } }, [action, actionId, child]);

  /** run `fn` now, or after the user agrees to drop unsaved changes */
  const guard = useCallback((fn: () => void): boolean => {
    if (!dirty || policy === 'discard') { setDirty(false); fn(); return true; }
    if (policy === 'block') { shell.notify('Save or reset your changes before selecting another record.', 'warning'); return false; }
    setPending({ run: () => { setPending(null); setDirty(false); fn(); } });
    return false;
  }, [dirty, policy, shell]);

  const selectMaster = (rec: any | null): boolean => guard(() => { setMaster(rec); setCreatingMaster(false); setChildId(null); });
  const masterKey = master ? master[keyField] : null;
  const childParams = useMemo(() => (child && masterKey !== null && masterKey !== undefined ? { [cfg.linkField || 'parentId']: masterKey } : undefined), [child, masterKey, cfg.linkField]);
  const cMeta = useMemo(() => childMeta(meta), [meta]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setSplit((s) => Math.max(20, s - 5)); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setSplit((s) => Math.min(80, s + 5)); }
  };
  const startDrag = (e: ReactPointerEvent) => {
    const el = box.current;
    if (!el) return;
    const vertical = stacked;
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const pct = vertical ? ((ev.clientY - rect.top) / rect.height) * 100 : ((ev.clientX - rect.left) / rect.width) * 100;
      setSplit(Math.round(Math.min(80, Math.max(20, pct))));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('xf-resizing'); };
    document.body.classList.add('xf-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  };
  const stacked = narrow || orientation === 'vertical';
  const flip = () => setOrientation((o) => (o === 'vertical' ? 'horizontal' : 'vertical'));
  const reset = () => { setSplit(defaultSplit); setOrientation(cfg.orientation || 'horizontal'); };
  const masterTitle = master ? String(master[cfg.master.titleField || ''] ?? master.name ?? master.code ?? master[masterId]) : '';

  const masterPanel = (
    <SummaryDisplay meta={meta} params={params} config={cfg.master} hooks={hooks.master}
      embed={{
        title: cfg.master.entityPlural || meta.title,
        selectedId: master ? master[masterId] : null,
        onSelect: (rec) => selectMaster(rec),
        onNew: child ? undefined : () => guard(() => { setMaster(null); setCreatingMaster(true); }),
        refreshKey: masterRefresh,
      }} />
  );

  let detail;
  if (!child) {
    detail = (
      <EntryFormDisplay meta={meta} params={{}} config={cfg.detail.entry} hooks={hooks.detail}
        embed={{
          recordId: creatingMaster ? 'new' : master ? master[masterId] : null,
          emptyText: `Select ${article(cfg.master.entity)} in the list, or create a new one.`,
          onDirtyChange: setDirty,
          onSaved: (rec, created) => { setDirty(false); setMasterRefresh((k) => k + 1); if (created) { setCreatingMaster(false); setMaster(rec); } else setMaster(rec); },
          onDeleted: () => { setDirty(false); setMaster(null); setMasterRefresh((k) => k + 1); },
          onClose: () => { setDirty(false); setCreatingMaster(false); setMaster(null); },
        }} />
    );
  } else if (!master) {
    detail = <div className="xf-empty">Select {article(cfg.master.entity)} to see its {(cfg.detail.summary?.entityPlural || cfg.detail.entry.entity + 's').toLowerCase()}.</div>;
  } else {
    const childList = cfg.detail.summary || { entity: cfg.detail.entry.entity, endpoint: cfg.detail.entry.endpoint, columns: [] };
    detail = (
      <div className="xf-ms-child">
        <div className="xf-ms-context" aria-live="polite"><span className="xf-muted">{cfg.master.entity}</span> <strong>{masterTitle}</strong></div>
        <div className="xf-ms-child-list">
          <SummaryDisplay meta={cMeta} params={params} config={childList} hooks={hooks.detailList}
            embed={{
              title: childList.entityPlural || childList.entity + 's',
              selectedId: childId === 'new' ? null : childId,
              params: childParams,
              onSelect: (rec) => guard(() => setChildId(rec ? rec[childList.idField || 'id'] : null)),
              onNew: () => guard(() => setChildId('new')),
              refreshKey: childRefresh,
            }} />
        </div>
        <div className="xf-ms-child-form">
          <EntryFormDisplay meta={cMeta} params={{}} config={cfg.detail.entry} hooks={hooks.detail}
            embed={{
              recordId: childId,
              fixedValues: childParams,
              emptyText: `Select ${article(cfg.detail.entry.entity)} or create a new one.`,
              onDirtyChange: setDirty,
              onSaved: (rec, created) => { setDirty(false); setChildRefresh((k) => k + 1); if (created) setChildId(rec[cfg.detail.entry.idField || "id"] as string | number); },
              onDeleted: () => { setDirty(false); setChildId(null); setChildRefresh((k) => k + 1); },
              onClose: () => { setDirty(false); setChildId(null); },
            }} />
        </div>
      </div>
    );
  }

  return (
    <div className={'xf-ms' + (stacked ? ' xf-ms-stacked' : '')} ref={box}>
      {pending && (
        <div className="xf-confirm xf-ms-confirm" role="alertdialog" aria-label="Unsaved changes">
          <span>The {(child ? cfg.detail.entry.entity : cfg.master.entity).toLowerCase()} form has unsaved changes. Discard them?</span>
          <button type="button" className="xf-btn xf-btn-danger" onClick={pending.run}>Discard</button>
          <button type="button" className="xf-btn" onClick={() => { setPending(null); setMasterRefresh((k) => k); }}>Keep editing</button>
        </div>
      )}
      <div className="xf-ms-panes" style={stacked ? { gridTemplateRows: `${split}% 12px minmax(0, 1fr)` } : { gridTemplateColumns: `${split}% 12px minmax(0, 1fr)` }}>
        <section className="xf-ms-master" aria-label={cfg.master.entityPlural || cfg.master.entity}>{masterPanel}</section>
        <div className="xf-ms-resizer" role="separator" tabIndex={0} aria-orientation={stacked ? 'horizontal' : 'vertical'}
          aria-valuenow={split} aria-valuemin={20} aria-valuemax={80} aria-label="Resize panels (drag, or arrow keys; double-click to reset)"
          title="Drag to resize · double-click to reset" onKeyDown={onKey} onPointerDown={startDrag} onDoubleClick={reset}>
          <span className="xf-ms-grip" aria-hidden="true" />
          <button type="button" className="xf-ms-flip" onPointerDown={(e) => e.stopPropagation()} onClick={flip} disabled={narrow}
            title={narrow ? 'Stacked: the window is too narrow for side by side' : stacked ? 'Show side by side' : 'Show one above the other'}
            aria-label={stacked ? 'Show side by side' : 'Show one above the other'}>{stacked ? '⇆' : '⇅'}</button>
        </div>
        <section className="xf-ms-detail" aria-label={child ? (cfg.detail.summary?.entityPlural || cfg.detail.entry.entity) : cfg.detail.entry.entity}>{detail}</section>
      </div>
    </div>
  );
}

/** A Master-Slave display whose configuration lives in code (a module's schema). */
export function createMasterSlaveDisplay(config: MasterSlaveConfig, hooks?: MasterSlaveHooks) {
  const View = (props: DisplayProps) => <MasterSlaveDisplay {...props} config={config} hooks={hooks} />;
  View.displayName = `MasterSlave(${config.master.entity})`;
  return View;
}

export default MasterSlaveDisplay;
