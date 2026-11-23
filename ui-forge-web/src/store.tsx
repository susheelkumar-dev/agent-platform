/**
 * Builder state: the saved workspace, the document being edited (one display plus the entities it uses), its
 * undo/redo history, the selection and the latest preview from the service.
 *
 * Edits always go through `edit()`, which works on a structured clone so every history entry is an immutable
 * snapshot. Saving sends the display and every entity that changed; generation always works from saved files.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ServiceError, type PreviewResult, type Workspace } from './api';
import type { Display, Entity, Inventory, Issue, ProjectInfo, Selection } from './types';

export type Mode = 'design' | 'preview' | 'code' | 'schema' | 'generate';

export interface Doc { entities: Record<string, Entity>; display: Display }

interface Toast { id: number; text: string; kind: 'info' | 'success' | 'warning' | 'error' }

export interface Store {
  ready: boolean;
  fatal: string | null;
  needsToken: boolean;
  project: ProjectInfo | null;
  inventory: Inventory | null;
  version: string;
  saved: { entities: Record<string, Entity>; displays: Record<string, Display>; files: Record<string, string> };
  workspaceIssues: Issue[];
  doc: Doc | null;
  origId: string | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selection: Selection;
  mode: Mode;
  preview: PreviewResult | null;
  previewing: boolean;
  overrides: Record<string, string>;
  toasts: Toast[];
  appUser: string | null;

  reload(refreshInventory?: boolean): Promise<void>;
  open(displayId: string): void;
  /** open a display as soon as the reloaded workspace has it */
  openSoon(displayId: string): void;
  create(display: Display, entities: Entity[]): void;
  close(): void;
  edit(fn: (doc: Doc) => void, opts?: { select?: Selection }): void;
  undo(): void;
  redo(): void;
  select(sel: Selection): void;
  setMode(m: Mode): void;
  save(): Promise<boolean>;
  discard(): void;
  removeDisplay(id: string): Promise<void>;
  setOverride(key: string, content: string | null): void;
  notify(text: string, kind?: Toast['kind']): void;
  setAppUser(u: string | null): void;
  refreshPreview(): void;
  /** entities (saved + edited) for pickers */
  allEntities(): Record<string, Entity>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = (): Store => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
};

const clone = <T,>(x: T): T => structuredClone(x);
const byName = (list: Entity[]) => Object.fromEntries(list.map((e) => [e.name, e]));
const byId = (list: Display[]) => Object.fromEntries(list.map((d) => [d.id, d]));
const HISTORY = 150;

/** the entities a display refers to */
export function entitiesOf(d: Display): string[] {
  const out = new Set<string>();
  if (d.entity) out.add(d.entity);
  if (d.masterSlave) { out.add(d.masterSlave.master.entity); out.add(d.masterSlave.detail.entity); }
  return [...out];
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [version, setVersion] = useState('');
  const [saved, setSaved] = useState<Store['saved']>({ entities: {}, displays: {}, files: {} });
  const [workspaceIssues, setWorkspaceIssues] = useState<Issue[]>([]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [origId, setOrigId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState('');
  const [past, setPast] = useState<Doc[]>([]);
  const [future, setFuture] = useState<Doc[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: 'display' });
  const [mode, setModeState] = useState<Mode>('design');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [appUser, setAppUser] = useState<string | null>(null);
  const [previewTick, setPreviewTick] = useState(0);
  const docRef = useRef<Doc | null>(null);
  docRef.current = doc;
  const toastId = useRef(0);

  const notify = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);

  const applyWorkspace = (w: Workspace) => {
    setSaved({ entities: byName(w.entities), displays: byId(w.displays), files: w.files });
    setWorkspaceIssues(w.issues);
  };

  const reload = useCallback(async (refreshInventory = false) => {
    try {
      const [p, w] = await Promise.all([api.project(refreshInventory), api.workspace()]);
      setProject(p.project); setInventory(p.inventory); setVersion(p.version);
      applyWorkspace(w);
      setNeedsToken(false); setFatal(null); setReady(true);
    } catch (e) {
      if (e instanceof ServiceError && e.status === 401) { setNeedsToken(true); setReady(true); return; }
      setFatal((e as Error).message); setReady(true);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const startDoc = (d: Doc, orig: string | null) => {
    setDoc(d); setOrigId(orig); setBaseline(orig ? JSON.stringify(d) : '');
    setPast([]); setFuture([]); setSelection({ kind: 'display' }); setPreview(null); setOverrides({});
    setModeState('design');
  };

  const open = useCallback((id: string) => {
    const d = saved.displays[id];
    if (!d) return;
    const ents: Record<string, Entity> = {};
    for (const n of entitiesOf(d)) if (saved.entities[n]) ents[n] = clone(saved.entities[n]);
    startDoc({ display: clone(d), entities: ents }, id);
    try { localStorage.setItem('uiforge.last', id); } catch { /* storage may be unavailable */ }
  }, [saved]);

  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  useEffect(() => {
    if (pendingOpen && saved.displays[pendingOpen]) { open(pendingOpen); setPendingOpen(null); }
  }, [pendingOpen, saved, open]);

  const create = useCallback((display: Display, entities: Entity[]) => {
    const ents: Record<string, Entity> = {};
    for (const n of entitiesOf(display)) {
      const e = entities.find((x) => x.name === n) || saved.entities[n];
      if (e) ents[n] = clone(e);
    }
    startDoc({ display: clone(display), entities: ents }, null);
  }, [saved]);

  const close = useCallback(() => { setDoc(null); setOrigId(null); setPast([]); setFuture([]); setPreview(null); }, []);

  const edit = useCallback((fn: (d: Doc) => void, opts?: { select?: Selection }) => {
    const cur = docRef.current;
    if (!cur) return;
    const next = clone(cur);
    fn(next);
    // a display that starts using another saved entity brings it along
    for (const n of entitiesOf(next.display)) if (!next.entities[n] && saved.entities[n]) next.entities[n] = clone(saved.entities[n]);
    if (JSON.stringify(next) === JSON.stringify(cur)) { if (opts?.select) setSelection(opts.select); return; }
    setPast((p) => [...p.slice(-HISTORY + 1), cur]);
    setFuture([]);
    setDoc(next);
    if (opts?.select) setSelection(opts.select);
  }, [saved]);

  const pastRef = useRef(past); pastRef.current = past;
  const futureRef = useRef(future); futureRef.current = future;

  const undo = useCallback(() => {
    const p = pastRef.current, cur = docRef.current;
    if (!p.length || !cur) return;
    setPast(p.slice(0, -1));
    setFuture([cur, ...futureRef.current].slice(0, HISTORY));
    setDoc(p[p.length - 1]);
  }, []);

  const redo = useCallback(() => {
    const f = futureRef.current, cur = docRef.current;
    if (!f.length || !cur) return;
    setFuture(f.slice(1));
    setPast([...pastRef.current, cur].slice(-HISTORY));
    setDoc(f[0]);
  }, []);

  const dirty = useMemo(() => !!doc && JSON.stringify(doc) !== baseline, [doc, baseline]);

  /** entities changed relative to the saved workspace (or new) */
  const changedEntities = (d: Doc) => Object.values(d.entities).filter((e) => JSON.stringify(e) !== JSON.stringify(saved.entities[e.name] ?? null));

  const replaceMap = (d: Doc): Record<string, string> => (origId && origId !== d.display.id ? { ['display:' + d.display.id]: 'display:' + origId } : {});

  // debounced preview of the draft: issues, framework configs, generated files
  useEffect(() => {
    if (!doc) return;
    let stale = false;
    const t = setTimeout(() => {
      setPreviewing(true);
      const usedOnly = Object.values(doc.entities);
      api.preview({ entities: usedOnly, displays: [doc.display], replace: replaceMap(doc), focus: [doc.display.id] })
        .then((r) => { if (!stale) setPreview(r); })
        .catch((e) => { if (!stale) setPreview({ issues: [{ level: 'error', where: 'service', path: '', message: (e as Error).message }], configs: {}, metas: {}, files: [] }); })
        .finally(() => { if (!stale) setPreviewing(false); });
    }, 450);
    return () => { stale = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, previewTick]);

  const save = useCallback(async (): Promise<boolean> => {
    const d = docRef.current;
    if (!d) return false;
    try {
      const r = await api.save({ entities: changedEntities(d), displays: [d.display], replace: replaceMap(d) });
      applyWorkspace(r.workspace);
      const fresh = byId(r.workspace.displays)[d.display.id];
      const ents = byName(r.workspace.entities);
      const nd: Doc = { display: fresh ? clone(fresh) : d.display, entities: Object.fromEntries(Object.keys(d.entities).map((n) => [n, clone(ents[n] ?? d.entities[n])])) };
      setDoc(nd); setOrigId(nd.display.id); setBaseline(JSON.stringify(nd));
      const errs = r.issues.filter((i) => i.level === 'error').length;
      notify(errs ? `Saved ${r.saved.length} file(s). ${errs} error(s) block generation.` : `Saved ${r.saved.length} file(s).`, errs ? 'warning' : 'success');
      try { localStorage.setItem('uiforge.last', nd.display.id); } catch { /* ignore */ }
      void api.project(true).then((p) => setInventory(p.inventory)).catch(() => undefined);
      return true;
    } catch (e) {
      notify(`Save failed: ${(e as Error).message}`, 'error');
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, origId, notify]);

  const discard = useCallback(() => {
    if (origId) { const o = origId; setDoc(null); setTimeout(() => open(o), 0); } else close();
  }, [origId, open, close]);

  const removeDisplay = useCallback(async (id: string) => {
    try {
      const r = await api.deleteDisplay(id);
      notify(`Deleted ${id}. ${r.note}`, 'success');
      if (origId === id) close();
      await reload(true);
    } catch (e) { notify(`Delete failed: ${(e as Error).message}`, 'error'); }
  }, [origId, close, reload, notify]);

  const setOverride = useCallback((key: string, content: string | null) => {
    setOverrides((o) => { const n = { ...o }; if (content === null) delete n[key]; else n[key] = content; return n; });
  }, []);

  const allEntities = useCallback(() => ({ ...saved.entities, ...(doc?.entities || {}) }), [saved, doc]);

  const value: Store = {
    ready, fatal, needsToken, project, inventory, version, saved, workspaceIssues, doc, origId, dirty,
    canUndo: past.length > 0, canRedo: future.length > 0, selection, mode, preview, previewing, overrides, toasts, appUser,
    reload, open, openSoon: setPendingOpen, create, close, edit, undo, redo, select: setSelection, setMode: setModeState, save, discard, removeDisplay,
    setOverride, notify, setAppUser, refreshPreview: () => setPreviewTick((x) => x + 1), allEntities,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
