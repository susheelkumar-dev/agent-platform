/**
 * The application shell: sign-in, the server-driven menu bar, a tab workspace of open displays, modal
 * displays, deep links and notifications. Applications configure it; they never edit it.
 *
 *   <FrameworkApp config={{ appId: 'gridtrade', title: 'GridTrade', apiBase: '/api', registryBase: '/registry/api/v1',
 *                           home: 'dashboard' }} displays={displays} bridge={extBridge} />
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, createApiClient, type ApiClient } from '../api/client';
import { AuthProvider, passwordAuth, useAuth, type AuthAdapter } from '../auth/AuthProvider';
import { LoginPage } from '../auth/LoginPage';
import { SessionStore } from '../auth/session';
import { DisplayHost, Loading, Problem } from '../display/DisplayHost';
import { MenuBar } from '../navigation/MenuBar';
import { buildHash, navigate, useHashLocation } from '../routing/hash';
import type { DisplayMeta, DisplayRegistry, MenuItem, Navigation, Params } from '../types';
import { FrameContext, ShellContext, type DisplayFrame, type ShellApi, type ToastKind } from './context';

export interface AppConfig {
  appId: string;
  title: string;
  subtitle?: string;
  /** the application's backend, e.g. '/api' */
  apiBase: string;
  /** the display registry, e.g. '/registry/api/v1' (proxied to the registry service) */
  registryBase: string;
  /** display opened first and kept open */
  home?: string;
  auth?: { loginPath?: string; refreshPath?: string; adapter?: (api: ApiClient) => AuthAdapter };
  timeoutMs?: number;
}

/** Lets Ext-style screens (Ext.define views on @extreact/runtime) share the session and navigation (see classicBridge). */
export interface ExtBridge {
  start(shell: ShellApi): Promise<void> | void;
  stop?(): void;
}

interface Tab {
  tabId: string;
  displayId: string;
  params: Params;
  action?: string;
  actionId: number;
  title: string;
  closable: boolean;
}

interface Toast { id: number; message: string; kind: ToastKind }

const paramsKey = (p: Params) => JSON.stringify(Object.keys(p).sort().map((k) => [k, p[k]]));
const strParams = (p: Record<string, unknown> = {}): Params =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));

function titleFor(meta: DisplayMeta, params: Params): string {
  if (params.id === 'new') return `${meta.title} (new)`;
  if (params.id) return `${meta.title} #${params.id}`;
  return meta.title;
}

export function FrameworkApp({ config, displays, bridge }: { config: AppConfig; displays: DisplayRegistry; bridge?: ExtBridge }) {
  const store = useMemo(() => new SessionStore(config.appId), [config.appId]);
  const authApi = useMemo(() => createApiClient({ baseUrl: config.apiBase, getToken: () => store.token(), timeoutMs: config.timeoutMs }), [config, store]);
  const adapter = useMemo(() => (config.auth?.adapter ? config.auth.adapter(authApi) : passwordAuth(authApi, { login: config.auth?.loginPath, refresh: config.auth?.refreshPath })), [config, authApi]);
  return (
    <AuthProvider store={store} adapter={adapter}>
      <Gate config={config} displays={displays} bridge={bridge} store={store} />
    </AuthProvider>
  );
}

function Gate(props: { config: AppConfig; displays: DisplayRegistry; bridge?: ExtBridge; store: SessionStore }) {
  const { session } = useAuth();
  useEffect(() => { document.title = props.config.title; }, [props.config.title]);
  if (!session) return <LoginPage title={props.config.title} subtitle={props.config.subtitle} />;
  return <Workspace key={session.user.username} {...props} />;
}

function Workspace({ config, displays, bridge, store }: { config: AppConfig; displays: DisplayRegistry; bridge?: ExtBridge; store: SessionStore }) {
  const { session, logout, can } = useAuth();
  const onUnauthorized = useCallback((e: ApiError) => logout(e.message || 'Your session ended. Sign in again.'), [logout]);
  const api = useMemo(() => createApiClient({ baseUrl: config.apiBase, getToken: () => store.token(), onUnauthorized, timeoutMs: config.timeoutMs }), [config, store, onUnauthorized]);
  const registryApi = useMemo(() => createApiClient({ baseUrl: `${config.registryBase}/apps/${config.appId}`, getToken: () => store.token(), onUnauthorized, timeoutMs: config.timeoutMs }), [config, store, onUnauthorized]);

  const [nav, setNav] = useState<Navigation | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  const [bridgeState, setBridgeState] = useState<'idle' | 'starting' | 'ready' | 'failed'>(bridge ? 'idle' : 'ready');
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [modal, setModal] = useState<{ meta: DisplayMeta; params: Params; action?: string } | null>(null);
  const [routeProblem, setRouteProblem] = useState<{ title: string; text: string } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const listeners = useRef(new Map<string, Set<(d: unknown) => void>>());
  const counter = useRef(0);
  const loc = useHashLocation();

  // ---- navigation (reloaded when permissions change, e.g. after a token refresh)
  const permKey = session ? session.permissions.join(',') : '';
  const loadNav = useCallback(() => {
    setNavError(null);
    registryApi.get<Navigation>('/navigation').then(setNav, (e: ApiError) => {
      if (e.status !== 401) setNavError(e.message);
    });
  }, [registryApi]);
  useEffect(() => { loadNav(); }, [loadNav, permKey]);

  const notify = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++counter.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);

  const openTab = useCallback((meta: DisplayMeta, params: Params, action?: string) => {
    setRouteProblem(null);
    setTabs((prev) => {
      const isNew = params.id === 'new';
      const existing = isNew ? undefined : prev.find((t) => t.displayId === meta.id && paramsKey(t.params) === paramsKey(params));
      if (existing) {
        setActive(existing.tabId);
        if (!action) return prev;
        return prev.map((t) => (t === existing ? { ...t, action, actionId: t.actionId + 1 } : t));
      }
      const tabId = `${meta.id}:${isNew ? 'new-' + ++counter.current : paramsKey(params)}`;
      setActive(tabId);
      return [...prev, { tabId, displayId: meta.id, params, action, actionId: action ? 1 : 0, title: titleFor(meta, params), closable: meta.id !== config.home }];
    });
  }, [config.home]);

  const shell = useMemo<ShellApi | null>(() => {
    if (!nav || !session) return null;
    return {
      api, session, can, navigation: nav, token: () => store.token(),
      open(displayId, params, action) {
        const meta = nav.displays[displayId];
        if (!meta) { notify('You do not have access to that page.', 'warning'); return false; }
        const p = strParams(params);
        if (meta.openMode === 'window') setModal({ meta, params: p, action: action ?? undefined });
        else navigate(buildHash(meta.route, p, action));
        return true;
      },
      findDisplay(configKey, value) {
        return Object.values(nav.displays).find((d) => d.config && d.config[configKey] === value);
      },
      notify,
      emit(event, detail) { listeners.current.get(event)?.forEach((h) => h(detail)); },
      on(event, handler) {
        const set = listeners.current.get(event) ?? new Set();
        set.add(handler);
        listeners.current.set(event, set);
        return () => set.delete(handler);
      },
      signOut: (reason) => logout(reason),
    };
  }, [nav, session, api, can, notify, logout, store]);

  // ---- the Ext-style screens' bridge starts once, after the menu is known. It keeps a stable handle that always
  // reaches the current shell (the menu and the token change over time).
  const shellRef = useRef<ShellApi | null>(null);
  shellRef.current = shell;
  const stableShell = useMemo(() => new Proxy({} as ShellApi, { get: (_t, k) => (shellRef.current as any)?.[k] }), []);
  useEffect(() => {
    if (!bridge || !shell || bridgeState !== 'idle') return;
    setBridgeState('starting');
    Promise.resolve(bridge.start(stableShell)).then(() => setBridgeState('ready'), (e) => { setBridgeError(String(e?.message || e)); setBridgeState('failed'); });
  }, [bridge, shell, bridgeState, stableShell]);
  useEffect(() => () => bridge?.stop?.(), [bridge]);

  // ---- route -> tab
  useEffect(() => {
    if (!nav || bridgeState !== 'ready') return;
    const path = loc.path;
    if (!path) {
      const home = config.home && nav.displays[config.home];
      if (home) navigate(buildHash(home.route), true);
      return;
    }
    const meta = Object.values(nav.displays).find((d) => d.route === path);
    if (meta) {
      if (meta.openMode === 'window') setModal({ meta, params: loc.params, action: loc.action });
      else openTab(meta, loc.params, loc.action);
      if (loc.action) navigate(buildHash(meta.route, loc.params), true); // an action runs once, it is not a place
      return;
    }
    if (path.startsWith('d/')) {
      registryApi.get(`/displays/${encodeURIComponent(path.slice(2))}`).then(
        () => setRouteProblem({ title: 'Page not available', text: 'Reload the menu and try again.' }),
        (e: ApiError) => setRouteProblem(e.status === 403
          ? { title: 'No access', text: 'Your roles do not include this page. Ask an administrator if you need it.' }
          : { title: 'Page not found', text: 'Nothing is registered at this address.' }));
    } else {
      setRouteProblem({ title: 'Page not found', text: 'Nothing is registered at this address.' });
    }
  }, [loc, nav, bridgeState, config.home, openTab, registryApi]);

  // ---- tab -> address bar
  useEffect(() => {
    if (!nav || !active) return;
    const tab = tabs.find((t) => t.tabId === active);
    const meta = tab && nav.displays[tab.displayId];
    if (!tab || !meta) return;
    const hash = buildHash(meta.route, tab.params);
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
  }, [active, tabs, nav]);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const i = prev.findIndex((t) => t.tabId === tabId);
      if (i < 0 || !prev[i].closable) return prev;
      const next = prev.filter((t) => t.tabId !== tabId);
      setActive((a) => (a === tabId ? (next[Math.min(i, next.length - 1)]?.tabId ?? null) : a));
      return next;
    });
  }, []);

  const onMenu = (m: MenuItem) => { if (m.display && shell) shell.open(m.display, m.params, m.action); };

  if (navError) {
    return <Frame title={config.title} user={session!} onSignOut={() => logout()}>
      <Problem title="The menu could not be loaded"><p>{navError}</p><button type="button" className="xf-btn" onClick={loadNav}>Try again</button></Problem>
    </Frame>;
  }
  if (!nav || !shell) return <Frame title={config.title} user={session!} onSignOut={() => logout()}><Loading label="Loading your menu…" /></Frame>;

  return (
    <ShellContext.Provider value={shell}>
      <Frame title={config.title} user={session!} onSignOut={() => logout()} menu={<MenuBar items={nav.menu} onSelect={onMenu} />}>
        {bridgeState === 'starting' && <Loading label="Starting…" />}
        {bridgeState === 'failed' && <Problem title="The application could not start"><p>{bridgeError}</p></Problem>}
        {bridgeState === 'ready' && (
          <div className="xf-workspace">
            {tabs.length > 0 && (
              <div className="xf-tabs" role="tablist" aria-label="Open pages">
                {tabs.map((t) => (
                  <div key={t.tabId} className={'xf-tab' + (t.tabId === active ? ' xf-active' : '')}>
                    <button type="button" role="tab" aria-selected={t.tabId === active} onClick={() => { setRouteProblem(null); setActive(t.tabId); }}>{t.title}</button>
                    {t.closable && <button type="button" className="xf-tab-close" aria-label={`Close ${t.title}`} onClick={() => closeTab(t.tabId)}>×</button>}
                  </div>
                ))}
              </div>
            )}
            <div className="xf-tab-panels">
              {routeProblem && <Problem title={routeProblem.title}><p>{routeProblem.text}</p></Problem>}
              {!routeProblem && tabs.length === 0 && <div className="xf-empty">Choose a page from the menu.</div>}
              {tabs.map((t) => {
                const meta = nav.displays[t.displayId];
                const visible = t.tabId === active && !routeProblem;
                const frame: DisplayFrame = {
                  tabId: t.tabId, active: visible,
                  close: () => closeTab(t.tabId),
                  setTitle: (title) => setTabs((prev) => prev.map((x) => (x.tabId === t.tabId ? { ...x, title } : x))),
                  replaceParams: (params) => setTabs((prev) => prev.map((x) => (x.tabId === t.tabId ? { ...x, params, title: meta ? titleFor(meta, params) : x.title } : x))),
                };
                return (
                  <section key={t.tabId} className="xf-tab-panel" role="tabpanel" hidden={!visible} aria-label={t.title}>
                    <FrameContext.Provider value={frame}>
                      {meta
                        ? <DisplayHost key={paramsKey(t.params)} registry={displays} meta={meta} params={t.params} action={t.action} actionId={t.actionId} />
                        : <Problem title="No longer available"><p>Your access to this page was removed.</p></Problem>}
                    </FrameContext.Provider>
                  </section>
                );
              })}
            </div>
          </div>
        )}
        {modal && (
          <div className="xf-modal-backdrop" onKeyDown={(e) => e.key === 'Escape' && setModal(null)}>
            <div className="xf-modal" role="dialog" aria-modal="true" aria-label={modal.meta.title}>
              <header><h2>{modal.meta.title}</h2><button type="button" className="xf-tab-close" aria-label="Close" onClick={() => setModal(null)}>×</button></header>
              <FrameContext.Provider value={{ tabId: 'modal', active: true, close: () => setModal(null), setTitle: () => undefined, replaceParams: (params) => setModal((m) => (m ? { ...m, params } : m)) }}>
                <DisplayHost registry={displays} meta={modal.meta} params={modal.params} action={modal.action} />
              </FrameContext.Provider>
            </div>
          </div>
        )}
        <div className="xf-toasts" aria-live="polite">
          {toasts.map((t) => <div key={t.id} className={'xf-toast xf-toast-' + t.kind} role={t.kind === 'error' ? 'alert' : 'status'}>{t.message}</div>)}
        </div>
      </Frame>
    </ShellContext.Provider>
  );
}

function Frame({ title, user, onSignOut, menu, children }: { title: string; user: { user: { username: string; fullName?: string; roles?: string[] } }; onSignOut: () => void; menu?: ReactNode; children: ReactNode }) {
  return (
    <div className="xf-app">
      <header className="xf-header">
        <span className="xf-brand">{title}</span>
        <span className="xf-spacer" />
        <span className="xf-user" title={(user.user.roles || []).join(', ')}>{user.user.fullName || user.user.username}{user.user.roles?.length ? <small> · {user.user.roles.join(', ')}</small> : null}</span>
        <button type="button" className="xf-btn xf-btn-ghost" onClick={onSignOut}>Sign out</button>
      </header>
      {menu}
      <main className="xf-main">{children}</main>
    </div>
  );
}
