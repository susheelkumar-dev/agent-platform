/**
 * Sign-in for the shell. The default adapter talks to the application's own backend:
 *
 *   POST {apiBase}{loginPath}    { username, password }  ->  { token, expiresAt, user, permissions }
 *   POST {apiBase}{refreshPath}  (Bearer token)          ->  the same shape, with current permissions
 *
 * Plain JSON or a { success, data } envelope both work. Another identity provider plugs in through AuthAdapter.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ApiClient } from '../api/client';
import type { SessionInfo } from '../types';
import { refreshDelay, SessionStore } from './session';

export interface AuthAdapter {
  login(username: string, password: string): Promise<SessionInfo>;
  refresh(current: SessionInfo): Promise<SessionInfo>;
  logout?(current: SessionInfo): Promise<void>;
}

export function passwordAuth(api: ApiClient, paths: { login?: string; refresh?: string } = {}): AuthAdapter {
  return {
    login: (username, password) => api.post<SessionInfo>(paths.login ?? '/auth/login', { username, password }),
    refresh: () => api.post<SessionInfo>(paths.refresh ?? '/auth/refresh'),
  };
}

interface AuthState {
  session: SessionInfo | null;
  login(username: string, password: string): Promise<void>;
  logout(reason?: string): void;
  can(permission?: string | null): boolean;
  /** why the user was signed out, shown on the sign-in page */
  notice: string | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ store, adapter, children }: { store: SessionStore; adapter: AuthAdapter; children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(() => store.get());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => store.subscribe(setSession), [store]);

  const logout = useCallback((reason?: string) => {
    const current = store.get();
    store.set(null);
    setNotice(reason ?? null);
    if (current) adapter.logout?.(current).catch(() => undefined);
  }, [store, adapter]);

  const login = useCallback(async (username: string, password: string) => {
    const s = await adapter.login(username, password);
    setNotice(null);
    store.set(s);
  }, [adapter, store]);

  // Refresh before expiry so permissions changed by an administrator take effect without signing in again.
  useEffect(() => {
    if (!session) return undefined;
    const t = setTimeout(() => {
      adapter.refresh(session).then((s) => store.set(s), () => logout('Your session ended. Sign in again.'));
    }, refreshDelay(session));
    return () => clearTimeout(t);
  }, [session, adapter, store, logout]);

  const value = useMemo<AuthState>(() => ({
    session, login, logout, notice, can: (p) => store.can(p),
  }), [session, login, logout, notice, store]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
