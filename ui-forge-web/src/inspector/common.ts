import type { Doc, Store } from '../store';

/** Assign a patch; null / '' / undefined remove the key so documents stay minimal. */
export function assign<T extends object>(target: T, patch: Partial<T>) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') delete (target as any)[k];
    else (target as any)[k] = v;
  }
}

/** A patch function for one object inside the document. */
export function patcher<T extends object>(s: Store, get: (doc: Doc) => T | null | undefined) {
  return (patch: Partial<T>) => s.edit((doc) => { const t = get(doc); if (t) assign(t, patch); });
}

export function permissionSuggestions(s: Store): string[] {
  const out = new Set<string>();
  for (const p of s.inventory?.permissions || []) for (const a of p.actions) out.add(`${p.module}.${a}`);
  for (const e of Object.values(s.allEntities())) {
    const pm = e.permissionModule;
    if (pm) for (const a of pm.actions) out.add(`${pm.module}.${a}`);
    Object.values(e.permissions || {}).forEach((x) => out.add(x));
  }
  return [...out].sort();
}

export const IDENT = (v: string) => (/^[a-z][A-Za-z0-9]*$/.test(v) ? null : 'camelCase: letters and digits, starting lower-case');
export const PASCAL = (v: string) => (/^[A-Z][A-Za-z0-9]*$/.test(v) ? null : 'PascalCase: letters and digits, starting upper-case');
export const ROUTE = (v: string) => (!v || /^[a-z0-9][a-z0-9\-/]*$/.test(v) ? null : 'lower-case words separated by - or /');
export const ENDPOINT = (v: string) => (/^\/[A-Za-z0-9\-_/{}]*$/.test(v) ? null : 'an API path starting with /');
export const DOTTED = (v: string) => (/^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(v) ? null : 'dotted lower-case, e.g. assets.generation-assets');
export const MODULE = (v: string) => (/^[a-z][a-z0-9-]*$/.test(v) ? null : 'lower-case letters, digits and -');
