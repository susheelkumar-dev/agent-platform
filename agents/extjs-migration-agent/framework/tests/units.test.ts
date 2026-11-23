import { createApiClient, ApiError } from '../src/api/client';
import { expired, refreshDelay } from '../src/auth/session';
import { defineDisplays, mergeDisplays, resolveDisplay } from '../src/display/registry';
import { buildHash, parseHash } from '../src/routing/hash';
import { changedValues, coerceAll, defaults, validate } from '../src/templates/fields';
import type { DisplayMeta, FieldDef } from '../src/types';

const FIELDS: FieldDef[] = [
  { name: 'code', label: 'Code', required: true, maxLength: 6, upperCase: true },
  { name: 'name', label: 'Name', required: true },
  { name: 'type', label: 'Type', options: ['Industrial', 'Utility'] },
  { name: 'creditLimit', label: 'Credit Limit', type: 'number', min: 0 },
  { name: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
];

describe('entity fields', () => {
  it('coerces and validates like the server', () => {
    const v = coerceAll(FIELDS, { code: 'ab1', name: '', type: 'Retail', creditLimit: '-5', enabled: 'on' });
    expect(v).toMatchObject({ code: 'AB1', creditLimit: -5, enabled: true });
    expect(validate(FIELDS, v)).toEqual({
      name: 'Name is required', type: 'Type must be one of Industrial, Utility', creditLimit: 'Credit Limit must be at least 0',
    });
    expect(validate(FIELDS, coerceAll(FIELDS, { code: 'TOOLONG1', name: 'x', creditLimit: 'abc' }))).toEqual({
      code: 'Code can have at most 6 characters', creditLimit: 'Credit Limit must be a number',
    });
    expect(validate(FIELDS, { code: 'A', name: 'B', creditLimit: null })).toEqual({});
  });
  it('defaults and changed fields', () => {
    expect(defaults(FIELDS, { type: 'Utility' })).toEqual({ enabled: true, type: 'Utility' });
    expect(changedValues(FIELDS, { code: 'A', name: 'B', enabled: true }, { code: 'A', name: 'C', enabled: true })).toEqual({ name: 'C' });
  });
});

describe('approved display registry', () => {
  const meta = (key: string, type = 'summary'): DisplayMeta => ({ id: 'x', title: 'X', type, key, route: 'd/x', openMode: 'tab', params: [], config: {}, module: 'm', requiredPermissions: [], actions: {} });
  const reg = defineDisplays({ Grid: { load: async () => ({ default: () => null }), types: ['summary'] } });
  it('resolves only approved keys of the right type', () => {
    expect(resolveDisplay(reg, meta('Grid')).ok).toBe(true);
    const unknown = resolveDisplay(reg, meta('constructor'));
    expect(unknown.ok).toBe(false);
    expect(unknown.reason).toBe('unknown-key');
    const wrong = resolveDisplay(reg, meta('Grid', 'entry-form'));
    expect(wrong.reason).toBe('wrong-type');
  });
  it('rejects bad keys and duplicates', () => {
    expect(() => defineDisplays({ 'bad-key': { load: async () => ({ default: () => null }) } })).toThrow(/not a valid display key/);
    expect(() => mergeDisplays(reg, reg)).toThrow(/defined by two modules/);
  });
});

describe('hash routes', () => {
  it('round-trips path, params and action', () => {
    const h = buildHash('d/contracts.entry', { id: 12, tab: 'x y' }, 'new');
    expect(h).toBe('#/d/contracts.entry?id=12&tab=x%20y&action=new');
    expect(parseHash(h)).toEqual({ path: 'd/contracts.entry', params: { id: '12', tab: 'x y' }, action: 'new' });
    expect(parseHash('')).toEqual({ path: '', params: {}, action: undefined });
  });
});

describe('session timing', () => {
  it('refreshes two minutes early, or half-way for short tokens', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(refreshDelay({ token: 't', expiresAt: '2026-01-01T00:30:00Z', user: { username: 'a' }, permissions: [] }, now)).toBe(28 * 60_000);
    expect(refreshDelay({ token: 't', expiresAt: '2026-01-01T00:02:00Z', user: { username: 'a' }, permissions: [] }, now)).toBe(60_000);
    expect(expired({ token: 't', expiresAt: '2000-01-01T00:00:00Z', user: { username: 'a' }, permissions: [] })).toBe(true);
  });
});

describe('api client', () => {
  const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, statusText: 'x' });
  it('sends the token and a correlation id, unwraps envelopes', async () => {
    let seen: RequestInit | undefined, url = '';
    const api = createApiClient({ baseUrl: '/api/', getToken: () => 'T', fetchImpl: (async (u: string, init: RequestInit) => { url = u; seen = init; return new Response(JSON.stringify({ success: true, data: [1, 2], total: 2 })); }) as any });
    expect(await api.get('/things', { q: 'a b', empty: '' })).toEqual([1, 2]);
    expect(url).toBe('/api/things?q=a%20b');
    const h = seen!.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer T');
    expect(h['X-Correlation-Id']).toBeTruthy();
    expect(await api.get('/things', undefined, { raw: true })).toEqual({ success: true, data: [1, 2], total: 2 });
  });
  it('turns failures into ApiError with field errors and reports 401', async () => {
    let unauthorized = 0;
    const api = createApiClient({ baseUrl: '/api', onUnauthorized: () => unauthorized++, fetchImpl: respond(400, { success: false, message: 'Fix it', errors: { name: 'Required' } }) as any });
    await expect(api.post('/x', {})).rejects.toMatchObject({ message: 'Fix it', status: 400, fieldErrors: { name: 'Required' } });
    const api401 = createApiClient({ baseUrl: '/api', onUnauthorized: () => unauthorized++, fetchImpl: respond(401, { message: 'Session expired' }) as any });
    await expect(api401.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(unauthorized).toBe(1);
  });
  it('times out', async () => {
    const api = createApiClient({ baseUrl: '/api', timeoutMs: 20, fetchImpl: ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))))) as any });
    await expect(api.get('/slow')).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/did not answer/) });
  });
});
