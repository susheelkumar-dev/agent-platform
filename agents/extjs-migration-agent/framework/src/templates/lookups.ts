import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import type { LookupSource } from '../types';

export interface Option { value: string | number; label: string }

const cache = new Map<string, Promise<Option[]>>();

/** Loads a lookup list once per session (shared by every form that uses it). */
export function loadLookup(api: ApiClient, src: LookupSource): Promise<Option[]> {
  const key = api.baseUrl + '|' + src.endpoint + '|' + (src.valueField || '') + '|' + (src.labelField || '');
  let p = cache.get(key);
  if (!p) {
    p = api.get<any[]>(src.endpoint).then((rows) => (rows || []).map((r: any) => {
      if (typeof r !== 'object' || r === null) return { value: r, label: String(r) };
      const value = r[src.valueField || ('id' in r ? 'id' : 'name')];
      const label = r[src.labelField || ('name' in r ? 'name' : 'text')] ?? String(value);
      return { value, label: String(label) };
    }));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export function clearLookupCache(): void { cache.clear(); }

export function useLookup(api: ApiClient, src?: LookupSource): { options: Option[]; error: string | null } {
  const [options, setOptions] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!src) return undefined;
    let live = true;
    loadLookup(api, src).then((o) => live && setOptions(o), (e) => live && setError(String(e?.message || e)));
    return () => { live = false; };
  }, [api, src?.endpoint, src?.valueField, src?.labelField]);
  return { options, error };
}
