/**
 * Live preview: the display rendered by the real @extreact/framework templates (the code the app runs), on a
 * mock API or the application's own API, with the permissions of a pretend user switched on and off.
 */
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createApiClient, EntryFormDisplay, FrameContext, MasterSlaveDisplay, ShellContext, SummaryDisplay, clearLookupCache, type ApiClient, type ShellApi } from '@extreact/framework';
import { api as forge, getAppToken, setAppToken } from '../api';
import { useStore } from '../store';
import { Btn, Segmented, Text } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { createMockApi, type MockApi } from './mockApi';

type Source = 'mock' | 'live';
type Viewport = 'desktop' | 'tablet' | 'phone';

export function Preview() {
  const s = useStore();
  const d = s.doc!.display;
  const cfg = s.preview?.configs?.[d.id];
  const meta0 = s.preview?.metas?.[d.id];
  const [source, setSource] = useState<Source>('mock');
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [granted, setGranted] = useState<Set<string> | null>(null);
  const [recordId, setRecordId] = useState('new');
  const [nonce, setNonce] = useState(0);
  const [, setLogTick] = useState(0);
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: string }[]>([]);

  const perms = useMemo(() => [...new Set([...(meta0?.requiredPermissions || []), ...Object.values<string>(meta0?.actionPermissions || {})])].sort(), [meta0]);
  useEffect(() => { if (perms.length) setGranted((g) => g ?? new Set(perms)); }, [perms]);
  const has = (p: string) => (granted ? granted.has(p) : true);

  const entities = Object.values(s.doc!.entities);
  const mock = useMemo<MockApi>(() => createMockApi(entities, { user: 'preview.user' }), [JSON.stringify(entities), nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  mock.onLog = () => setLogTick((x) => x + 1);
  const live = useMemo<ApiClient>(() => createApiClient({
    baseUrl: '/app-api',
    fetchImpl: (url, init) => {
      const h = new Headers(init?.headers);
      const t = sessionStorage.getItem('uiforge.token');
      if (t) h.set('X-UI-Forge-Token', t);
      if (getAppToken()) h.set('X-App-Token', getAppToken());
      h.delete('Authorization');
      return fetch(url, { ...init, headers: h });
    },
  }), []);
  const client = source === 'mock' ? mock : live;

  const toast = (text: string, kind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  };

  const bus = useRef(new Map<string, Set<(d: unknown) => void>>());
  const shell: ShellApi = useMemo(() => ({
    api: client,
    session: { token: 'preview', expiresAt: '2099-01-01T00:00:00Z', user: { username: s.appUser || 'preview.user', fullName: 'Preview user' }, permissions: [...(granted || [])] },
    token: () => null,
    can: (p?: string | null) => !p || has(p),
    navigation: { app: s.project?.appId || 'app', user: 'preview', menu: [], displays: {}, etag: 'preview' },
    open: (id: string, params?: Record<string, unknown>) => {
      if (id === d.id && params?.id !== undefined) { setRecordId(String(params.id)); return true; }
      toast(`Opens ${id}${params?.id !== undefined ? ` (id ${params.id})` : ''} — another display`, 'info');
      return true;
    },
    findDisplay: () => undefined,
    notify: (m: string, k?: string) => toast(m, k || 'info'),
    emit: (ev: string, detail?: unknown) => bus.current.get(ev)?.forEach((h) => h(detail)),
    on: (ev: string, h: (x: unknown) => void) => { if (!bus.current.has(ev)) bus.current.set(ev, new Set()); bus.current.get(ev)!.add(h); return () => bus.current.get(ev)?.delete(h); },
    signOut: () => toast('Sign out (ignored in the preview)'),
  }) as ShellApi, [client, granted, d.id, s.appUser, s.project]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = useMemo(() => meta0 && ({
    ...meta0,
    config: {},
    actions: Object.fromEntries(Object.entries<string>(meta0.actionPermissions || {}).map(([k, p]) => [k, has(p)])),
  }), [meta0, granted]); // eslint-disable-line react-hooks/exhaustive-deps

  const frame = useMemo(() => ({ tabId: 'preview', active: true, close: () => toast('Close (the preview stays open)'), setTitle: () => undefined, replaceParams: (p: Record<string, string>) => { if (p.id) setRecordId(p.id); } }), []);
  useEffect(() => { clearLookupCache(); }, [client, nonce]);

  const canOpen = (meta0?.requiredPermissions || []).every((p: string) => has(p));
  const blocking = s.preview?.issues.filter((i) => i.level === 'error') || [];
  const width = viewport === 'phone' ? 390 : viewport === 'tablet' ? 820 : undefined;

  return (
    <div className="preview">
      <div className="pv-bar">
        <Segmented ariaLabel="Data source" value={source} onChange={setSource} options={[{ value: 'mock', label: 'Sample data', icon: 'db' }, { value: 'live', label: 'Live API', icon: 'link' }]} />
        <Segmented ariaLabel="Screen size" value={viewport} onChange={setViewport} options={[{ value: 'desktop', label: 'Desktop', icon: 'desktop' }, { value: 'tablet', label: 'Tablet', icon: 'tablet' }, { value: 'phone', label: 'Phone', icon: 'phone' }]} />
        {d.type === 'entry' && (
          <label className="pv-rec">Record <input className="in" value={recordId} onChange={(e) => setRecordId(e.target.value)} aria-label="Record id" /><Btn small kind="ghost" onClick={() => setRecordId('new')}>new</Btn></label>
        )}
        <Btn small icon="refresh" onClick={() => { mock.reset(); setNonce((x) => x + 1); }} title="Reset the sample data and reload">Reset</Btn>
        {source === 'live' && <LiveSignIn />}
      </div>
      <div className="pv-main">
        <div className="pv-stage">
          {blocking.length > 0 && !cfg ? (
            <div className="pv-blocked"><Icon name="error" size={20} /><b>The preview needs a valid display.</b><ul>{blocking.slice(0, 6).map((i, k) => <li key={k}>{i.message}</li>)}</ul></div>
          ) : !cfg || !meta ? (
            <div className="pv-blocked"><Icon name="refresh" size={20} className="spin" /> Building the preview…</div>
          ) : !canOpen ? (
            <div className="pv-blocked"><Icon name="lock" size={20} /><b>This user cannot open the display.</b> It needs {meta0.requiredPermissions.join(', ')}; the menu entry is hidden and the registry refuses it.</div>
          ) : (
            <div className="pv-device" style={{ width }}>
              <div className="pv-tab"><Icon name="file" size={12} /> {d.title}{d.type === 'entry' ? ` · ${recordId === 'new' ? 'new record' : '#' + recordId}` : ''}</div>
              <div className="pv-frame app-theme">
                <ShellContext.Provider value={shell}>
                  <FrameContext.Provider value={frame}>
                    <Boundary key={`${nonce}-${source}-${JSON.stringify(cfg).length}`}>
                      {d.type === 'summary' && <SummaryDisplay meta={meta as any} params={{}} config={cfg} />}
                      {d.type === 'entry' && <EntryFormDisplay key={recordId} meta={meta as any} params={{ id: recordId }} config={cfg} />}
                      {d.type === 'master-slave' && <MasterSlaveDisplay meta={meta as any} params={{}} config={cfg} />}
                    </Boundary>
                  </FrameContext.Provider>
                </ShellContext.Provider>
              </div>
              <div className="pv-toasts">{toasts.map((t) => <div key={t.id} className={`pv-toast ${t.kind}`}>{t.text}</div>)}</div>
            </div>
          )}
        </div>
        <aside className="pv-side">
          <h4><Icon name="user" size={13} /> Pretend user has</h4>
          <p className="note">Switch permissions off to see what each role gets. The API must enforce the same ones.</p>
          {perms.map((p) => (
            <label key={p} className="pv-perm">
              <input type="checkbox" checked={has(p)} onChange={(e) => setGranted((g) => { const n = new Set(g || perms); if (e.target.checked) n.add(p); else n.delete(p); return n; })} />
              <span className="mono">{p}</span>
              <span className="muted">{(meta0?.requiredPermissions || []).includes(p) ? 'open' : Object.entries<string>(meta0?.actionPermissions || {}).filter(([, v]) => v === p).map(([k]) => k).join(', ')}</span>
            </label>
          ))}
          <div className="pv-quick">
            <Btn small kind="ghost" onClick={() => setGranted(new Set(perms))}>All</Btn>
            <Btn small kind="ghost" onClick={() => setGranted(new Set(meta0?.requiredPermissions || []))}>Read-only</Btn>
          </div>
          {source === 'mock' && (
            <>
              <h4><Icon name="terminal" size={13} /> API calls</h4>
              <div className="pv-log">
                {mock.log.length === 0 && <span className="muted">none yet</span>}
                {mock.log.map((l, i) => <div key={i} className={l.status >= 400 ? 'bad' : ''}><b>{l.method}</b> <span className="mono">{l.path}</span> <i>{l.status}</i></div>)}
              </div>
            </>
          )}
          <p className="note"><Icon name="info" size={12} /> Developer hooks (validators, custom actions) run in the app, not here.</p>
        </aside>
      </div>
    </div>
  );
}

function LiveSignIn() {
  const s = useStore();
  const [user, setUser] = useState('admin');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  if (s.appUser) return <span className="pv-signed"><Icon name="user" size={12} /> {s.appUser} <Btn small kind="ghost" onClick={() => { setAppToken(''); s.setAppUser(null); }}>Sign out</Btn></span>;
  return (
    <form className="pv-signin" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      try { const r = await forge.session(user, pw); setAppToken(r.token); s.setAppUser(user); s.notify(`Signed in to ${s.project?.appId} as ${user}`, 'success'); }
      catch (err) { s.notify(`Sign-in failed: ${(err as Error).message}`, 'error'); }
      finally { setBusy(false); }
    }}>
      <Text value={user} onChange={setUser} ariaLabel="User" />
      <input className="in" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="password" aria-label="Password" autoComplete="current-password" />
      <Btn small kind="primary" type="submit" busy={busy}>Sign in</Btn>
    </form>
  );
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return <div className="pv-blocked"><Icon name="error" size={20} /><b>The display failed to render.</b><pre>{this.state.error.message}</pre></div>;
    return this.props.children;
  }
}
