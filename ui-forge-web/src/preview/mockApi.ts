/**
 * An in-memory API that behaves like a generated one: list (filters, sort, start/limit envelope), get, create,
 * update, delete, custom actions, lookups and an audit trail. The preview runs the real framework templates on it,
 * so a display can be tried before any file is written.
 */
import { ApiError, type ApiClient, type RequestOptions } from '@extreact/framework';
import { sampleRows } from '../sample';
import type { Entity } from '../types';

interface AuditRow { id: number; at: string; user: string; action: string; entityType: string; entityId: number; entityName: string; changed: string[]; before: any; after: any }

export interface MockApi extends ApiClient { log: { method: string; path: string; status: number; at: string }[]; reset(): void; onLog?: () => void }

export function createMockApi(entities: Entity[], opts: { rows?: number; latency?: number; user?: string } = {}): MockApi {
  const n = opts.rows ?? 24;
  const user = opts.user ?? 'preview';
  let tables: Record<string, any[]> = {};
  let audit: AuditRow[] = [];
  let seq = 1000;
  const byEndpoint = new Map(entities.map((e) => [e.endpoint.replace(/\/+$/, ''), e]));

  const reset = () => {
    tables = {};
    audit = [];
    for (const e of entities) {
      // children: two or three per parent, so Master-Slave shows something for every master row
      const rows = sampleRows(e, e.parent ? Math.round(n * 2.5) : n);
      if (e.parent) rows.forEach((r, i) => { r[e.parent!.field] = 1 + (i % n); });
      for (const f of e.fields) if (f.example !== undefined && f.example !== null) rows[0][f.name] = f.example;
      tables[e.endpoint] = rows;
    }
  };
  reset();

  const titleOf = (e: Entity, r: any) => String(r?.[e.titleField || 'name'] ?? r?.code ?? r?.id ?? '');
  const record = (e: Entity, action: string, before: any, after: any) => {
    const changed = after ? e.fields.map((f) => f.name).filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) : [];
    audit.push({ id: ++seq, at: new Date().toISOString().slice(0, 19), user, action, entityType: e.backend?.auditEntityType || e.label, entityId: Number((after || before).id), entityName: titleOf(e, after || before), changed, before, after });
  };

  const validate = (e: Entity, body: any, id: number | null) => {
    const errors: Record<string, string> = {};
    for (const f of e.fields) {
      const v = body[f.name];
      const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
      if (f.required && empty) errors[f.name] = `${f.label} is required`;
      if (!empty && f.unique && tables[e.endpoint].some((r) => r.id !== id && String(r[f.name]).toLowerCase() === String(v).toLowerCase())) errors[f.name] = `${f.label} '${v}' is already used`;
      if (!empty && f.options?.length && !f.multiple && !f.options.map(String).includes(String(v))) errors[f.name] = `${f.label} must be one of ${f.options.join(', ')}`;
    }
    if (Object.keys(errors).length) throw new ApiError('Please correct the highlighted fields', 400, errors, 'mock');
  };

  const listOf = (e: Entity, q: Record<string, any>) => {
    let rows = tables[e.endpoint].slice();
    for (const [k, raw] of Object.entries(q)) {
      if (raw === undefined || raw === '' || ['start', 'limit', 'sort', 'page', 'query', '_dc'].includes(k)) continue;
      const base = k.replace(/(From|To)$/, '');
      const f = e.fields.find((x) => x.name === k || x.name === base) || (k === 'id' ? { name: 'id' } as any : null);
      if (!f) continue;
      const v = String(raw);
      if (k.endsWith('From') && f.name === base) rows = rows.filter((r) => String(r[base] ?? '') >= v);
      else if (k.endsWith('To') && f.name === base) rows = rows.filter((r) => String(r[base] ?? '').slice(0, v.length) <= v);
      else if (['string', 'text'].includes(f.dataType)) rows = rows.filter((r) => String(r[f.name] ?? '').toLowerCase().includes(v.toLowerCase()));
      else if (v.includes(',')) rows = rows.filter((r) => v.split(',').includes(String(r[f.name])));
      else rows = rows.filter((r) => (Array.isArray(r[f.name]) ? r[f.name].map(String).includes(v) : String(r[f.name]) === v));
    }
    if (q.query) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(String(q.query).toLowerCase()));
    if (q.sort) {
      try {
        const s = JSON.parse(q.sort) as { property: string; direction?: string }[];
        rows.sort((a, b) => { for (const x of s) { const c = String(a[x.property] ?? '').localeCompare(String(b[x.property] ?? ''), undefined, { numeric: true }); if (c) return x.direction === 'DESC' ? -c : c; } return 0; });
      } catch { /* ignore a bad sort */ }
    }
    const total = rows.length;
    if (q.limit !== undefined) rows = rows.slice(Number(q.start || 0), Number(q.start || 0) + Number(q.limit));
    return { success: true, data: rows, total };
  };

  const log: MockApi['log'] = [];
  const api: MockApi = {
    baseUrl: 'mock:',
    log,
    reset,
    async request<T>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
      await new Promise((r) => setTimeout(r, opts.latency ?? 120));
      const p = path.split('?')[0].replace(/\/+$/, '');
      const q = { ...Object.fromEntries(new URLSearchParams(path.split('?')[1] || '')), ...(o.params || {}) };
      let status = 200;
      try {
        const out = route(method, p, q, o.body);
        const env = out && typeof out === 'object' && 'success' in (out as any) ? out : { success: true, data: out };
        return (o.raw ? env : (env as any).data) as T;
      } catch (e) {
        status = e instanceof ApiError ? e.status : 500;
        throw e;
      } finally {
        log.unshift({ method, path: p + (Object.keys(q).length ? '?' + new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString() : ''), status, at: new Date().toLocaleTimeString() });
        log.length = Math.min(log.length, 60);
        api.onLog?.();
      }
    },
    get(path, params, o) { return api.request('GET', path, { ...o, params }); },
    post(path, body, o) { return api.request('POST', path, { ...o, body }); },
    put(path, body, o) { return api.request('PUT', path, { ...o, body }); },
    del(path, o) { return api.request('DELETE', path, o); },
  };

  function route(method: string, p: string, q: Record<string, any>, body: any): unknown {
    if (p === '/audit') {
      const rows = audit.filter((a) => (!q.entityType || a.entityType === q.entityType) && (!q.entityId || a.entityId === Number(q.entityId))).slice().reverse();
      return rows.map(({ before, after, changed, ...r }) => ({ ...r, changed: changed.join(', ') }));
    }
    const am = /^\/audit\/(\d+)$/.exec(p);
    if (am) { const a = audit.find((x) => x.id === Number(am[1])); if (!a) throw new ApiError('Audit entry not found', 404, null, 'mock'); return a; }

    const e = byEndpoint.get(p);
    if (e) {
      if (method === 'GET') return listOf(e, q);
      if (method === 'POST') {
        validate(e, body || {}, null);
        const r = { ...body, id: Math.max(0, ...tables[e.endpoint].map((x) => Number(x.id))) + 1 };
        tables[e.endpoint].push(r);
        record(e, 'INSERT', null, r);
        return r;
      }
    }
    const m = /^(.*)\/([^/]+)(?:\/([a-z][a-z0-9-]*))?$/.exec(p);
    const ent = m && byEndpoint.get(m[1]);
    if (m && ent) {
      const rows = tables[ent.endpoint];
      const i = rows.findIndex((r) => String(r.id) === m[2]);
      if (i < 0) throw new ApiError(`${ent.label} ${m[2]} not found`, 404, null, 'mock');
      const before = rows[i];
      if (m[3]) {
        if (method !== 'POST') throw new ApiError('Method not allowed', 405, null, 'mock');
        record(ent, m[3].toUpperCase(), before, before);
        return { ...before, _note: `custom action '${m[3]}' (the preview does not run your hook)` };
      }
      if (method === 'GET') return before;
      if (method === 'PUT') {
        const merged = { ...before, ...body, id: before.id };
        for (const f of ent.fields) if (f.readOnly) merged[f.name] = before[f.name];
        validate(ent, merged, before.id);
        rows[i] = merged;
        record(ent, 'UPDATE', before, merged);
        return merged;
      }
      if (method === 'DELETE') {
        const kids = entities.filter((c) => c.parent?.entity === ent.name);
        for (const c of kids) {
          const has = tables[c.endpoint].filter((r) => String(r[c.parent!.field]) === String(before.id));
          if (has.length && (c.parent!.onParentDelete || 'restrict') === 'restrict') throw new ApiError(`${ent.label} has ${has.length} ${c.plural.toLowerCase()}; delete them first`, 409, null, 'mock');
          tables[c.endpoint] = tables[c.endpoint].filter((r) => !has.includes(r));
        }
        rows.splice(i, 1);
        record(ent, 'DELETE', before, null);
        return { id: before.id };
      }
    }
    // any other GET: a lookup list
    if (method === 'GET') {
      const label = p.split('/').pop() || 'option';
      const one = label.replace(/-/g, ' ').replace(/ies$/, 'y').replace(/([^s])s$/, '$1');
      return Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `${one} ${i + 1}`.replace(/^\w/, (c) => c.toUpperCase()) }));
    }
    throw new ApiError(`No mock route for ${method} ${p}`, 404, null, 'mock');
  }

  return api;
}
