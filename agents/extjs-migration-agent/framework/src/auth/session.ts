/**
 * The signed-in session: token, user and permissions, kept in sessionStorage so a reload keeps you signed in
 * but closing the browser tab signs you out. Never in localStorage.
 */
import type { SessionInfo } from '../types';

type Listener = (s: SessionInfo | null) => void;

export class SessionStore {
  private info: SessionInfo | null = null;
  private listeners = new Set<Listener>();
  private key: string;

  constructor(appId: string) {
    this.key = `${appId}.session`;
    try {
      const raw = sessionStorage.getItem(this.key);
      if (raw) {
        const s = JSON.parse(raw) as SessionInfo;
        if (s && s.token && !expired(s)) this.info = s;
      }
    } catch { /* storage blocked: start signed out */ }
  }

  get(): SessionInfo | null {
    if (this.info && expired(this.info)) this.set(null);
    return this.info;
  }

  token(): string | null {
    return this.get()?.token ?? null;
  }

  can(permission?: string | null): boolean {
    return !permission || !!this.get()?.permissions.includes(permission);
  }

  set(info: SessionInfo | null): void {
    this.info = info;
    try {
      if (info) sessionStorage.setItem(this.key, JSON.stringify(info));
      else sessionStorage.removeItem(this.key);
    } catch { /* storage blocked: keep it in memory */ }
    this.listeners.forEach((l) => l(info));
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export function expired(s: SessionInfo, skewMs = 5000): boolean {
  const t = Date.parse(s.expiresAt);
  return !Number.isFinite(t) || t - skewMs <= Date.now();
}

/** Milliseconds until the token should be refreshed (two minutes early, or half its life when shorter). */
export function refreshDelay(s: SessionInfo, now = Date.now()): number {
  const left = Date.parse(s.expiresAt) - now;
  return Math.max(1000, left > 240_000 ? left - 120_000 : left / 2);
}
