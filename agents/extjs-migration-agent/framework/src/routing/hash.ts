/**
 * Hash routing: '#/d/reference.counterparties.summary?id=12&action=new'. Hash URLs need no server rewrite
 * rules, survive reloads and make every display deep-linkable.
 */
import { useEffect, useState } from 'react';
import type { Params } from '../types';

export interface Location { path: string; params: Params; action?: string }

export function parseHash(hash: string): Location {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const params: Params = {};
  let action: string | undefined;
  for (const part of query.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = decodeURIComponent(i < 0 ? part : part.slice(0, i));
    const v = decodeURIComponent(i < 0 ? '' : part.slice(i + 1));
    if (k === 'action') action = v;
    else params[k] = v;
  }
  return { path: decodeURI(path || ''), params, action };
}

export function buildHash(path: string, params: Record<string, unknown> = {}, action?: string | null): string {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  if (action) q.push(`action=${encodeURIComponent(action)}`);
  return `#/${path}${q.length ? '?' + q.join('&') : ''}`;
}

export function navigate(hash: string, replace = false): void {
  if (window.location.hash === hash) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  if (replace) window.history.replaceState(null, '', hash);
  else window.location.hash = hash;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useHashLocation(): Location {
  const [loc, setLoc] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setLoc(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return loc;
}
