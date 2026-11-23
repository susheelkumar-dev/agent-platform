/**
 * Entry / Summary template behaviour added for UI Forge: sections and tabs, new field types, actions
 * (delete, copy, reset, audit, custom), hooks, embedded mode, search parameters and server paging.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createApiClient } from '../src/api/client';
import { FrameContext, ShellContext, type ShellApi } from '../src/shell/context';
import { EntryFormDisplay, type EntryHooks } from '../src/templates/EntryForm';
import { SummaryDisplay, fillEndpoint, searchParams } from '../src/templates/SummaryDisplay';
import { MasterSlaveDisplay } from '../src/templates/MasterSlave';
import { coerce, validate, isVisible, defaults } from '../src/templates/fields';
import type { DisplayMeta, EntryConfig, FieldDef, SummaryConfig } from '../src/types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lacks these browser APIs the grid uses
window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) as any);
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

let root: Root;
let host: HTMLDivElement;
let calls: { method: string; url: string; body?: any }[];
let notices: string[];
let routes: Record<string, (body: any, url: string) => [number, any]>;

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const text = () => host.textContent || '';
const btn = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (el: Element | null | undefined) => { if (!el) throw new Error('element not found'); await act(async () => { (el as HTMLElement).click(); }); await flush(); };
function type(name: string, value: string) {
  const el = host.querySelector<HTMLInputElement>(name.startsWith('#') ? name : `[name="${name}"]`)!;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

function fakeFetch(url: string, init: RequestInit) {
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, url, body });
  const key = `${method} ${url.split('?')[0]}`;
  const handler = routes[key];
  const [status, json] = handler ? handler(body, url) : [404, { success: false, message: `no route ${key}` }];
  return Promise.resolve(new Response(JSON.stringify(json), { status }));
}

function shell(): ShellApi {
  const api = createApiClient({ baseUrl: '/api', fetchImpl: fakeFetch as any });
  const handlers = new Map<string, Set<(d: unknown) => void>>();
  return {
    api, session: { token: 't', expiresAt: '', user: { username: 'ann' }, permissions: [] }, token: () => 't', can: () => true,
    navigation: { app: 'a', user: 'ann', menu: [], displays: {}, etag: '' },
    open: () => true, findDisplay: () => undefined, notify: (m) => { notices.push(m); },
    emit: (e, d) => handlers.get(e)?.forEach((h) => h(d)),
    on: (e, h) => { if (!handlers.has(e)) handlers.set(e, new Set()); handlers.get(e)!.add(h); return () => handlers.get(e)!.delete(h); },
    signOut: () => undefined,
  };
}

const meta = (actions: Record<string, boolean> = {}): DisplayMeta => ({ id: 'x', title: 'Assets', type: 'entry-form', key: 'K', route: 'd/x', openMode: 'tab', params: [], config: {}, module: 'm', requiredPermissions: [], actions });
const frame = { tabId: 't1', active: true, close: vi.fn(), setTitle: vi.fn(), replaceParams: vi.fn() };

function render(node: React.ReactNode) {
  act(() => { root.render(<ShellContext.Provider value={shell()}><FrameContext.Provider value={frame}>{node}</FrameContext.Provider></ShellContext.Provider>); });
}

beforeEach(() => {
  calls = []; notices = []; routes = {};
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  frame.close.mockClear(); frame.replaceParams.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const FIELDS: FieldDef[] = [
  { name: 'code', label: 'Code', required: true, maxLength: 8, upperCase: true },
  { name: 'name', label: 'Name', required: true },
  { name: 'type', label: 'Type', type: 'select', options: ['Solar', 'Wind'], widget: 'radio', required: true },
  { name: 'capacityMw', label: 'Capacity', type: 'decimal', decimals: 2, min: 0 },
  { name: 'commissionedAt', label: 'Commissioned', type: 'datetime' },
  { name: 'tags', label: 'Tags', type: 'multiselect', options: ['A', 'B'] },
  { name: 'enabled', label: 'Enabled', type: 'boolean', widget: 'switch', defaultValue: true },
  { name: 'windNote', label: 'Wind note', visibleWhen: { field: 'type', equals: ['Wind'] } },
];
const ENTRY: EntryConfig = {
  entity: 'Asset', endpoint: '/assets', titleField: 'name', fields: FIELDS, columns: 2,
  sections: [
    { id: 'main', title: 'General', kind: 'tab', fields: ['code', 'name', 'type', 'windNote'] },
    { id: 'tech', title: 'Technical', kind: 'tab', fields: ['capacityMw', 'commissionedAt', 'tags', 'enabled'] },
  ],
  actions: [
    { id: 'save', kind: 'save' }, { id: 'copy', kind: 'copy' }, { id: 'delete', kind: 'delete' }, { id: 'audit', kind: 'audit' },
    { id: 'reset', kind: 'reset' }, { id: 'retire', kind: 'custom', label: 'Retire', path: 'retire', confirm: 'Retire this asset?' },
    { id: 'cancel', kind: 'cancel' },
  ],
  audit: { endpoint: '/audit', entityType: 'Asset' },
  copyExclude: ['code'],
};
const REC = { id: 7, code: 'SOL1', name: 'Solar One', type: 'Solar', capacityMw: 12.5, commissionedAt: '2025-01-02T10:30', tags: ['A'], enabled: true };

describe('field rules', () => {
  it('coerces and validates the new types', () => {
    const f = (o: Partial<FieldDef>) => ({ name: 'x', label: 'X', ...o }) as FieldDef;
    expect(coerce(f({ type: 'decimal' }), '1,234.5')).toBe(1234.5);
    expect(coerce(f({ type: 'multiselect' }), 'A')).toEqual(['A']);
    expect(coerce(f({ type: 'lookup', lookup: { endpoint: '/x' } }), '12')).toBe(12);
    expect(validate([f({ type: 'time' })], { x: '25:00' }).x).toMatch(/time/);
    expect(validate([f({ type: 'datetime' })], { x: '2026-01-01' }).x).toMatch(/date and time/);
    expect(validate([f({ type: 'decimal', decimals: 1 })], { x: 1.25 }).x).toMatch(/decimal/);
    expect(validate([f({ type: 'multiselect', options: ['A'] })], { x: ['Z'] }).x).toMatch(/not allowed/);
    expect(validate([f({ required: true, type: 'multiselect' })], { x: [] }).x).toMatch(/required/);
    expect(isVisible(f({ visibleWhen: { field: 'k', equals: ['y'] } }), { k: 'n' })).toBe(false);
    expect(defaults([f({ type: 'multiselect' })])).toEqual({ x: [] });
    const custom = validate([f({ validator: 'even' })], { x: 3 }, { even: (v) => (Number(v) % 2 ? 'must be even' : null) });
    expect(custom.x).toBe('must be even');
  });
  it('builds query parameters and fills endpoints', () => {
    expect(searchParams([{ name: 'd', label: 'D', type: 'date', operator: 'between' }, { name: 'q', label: 'Q', param: 'query' }], { d: ['2026-01-01', ''], q: 'abc' }))
      .toEqual({ dFrom: '2026-01-01', query: 'abc' });
    expect(searchParams([{ name: 'cap', label: 'C', type: 'decimal', operator: 'gte' }, { name: 'at', label: 'A', type: 'date', operator: 'lte' }], { cap: 50, at: '2026-12-31' }))
      .toEqual({ capFrom: '50', atTo: '2026-12-31' });
    expect(fillEndpoint('/assets/{assetId}/outages', { assetId: 4 })).toEqual({ path: '/assets/4/outages', missing: [] });
    expect(fillEndpoint('/assets/{assetId}/outages', {}).missing).toEqual(['assetId']);
  });
});

describe('Entry template', () => {
  it('creates a record from tabs with the new widgets', async () => {
    routes['POST /api/assets'] = (b) => [200, { success: true, data: { ...b, id: 9 } }];
    render(<EntryFormDisplay meta={meta()} params={{ id: 'new' }} config={ENTRY} />);
    await flush();
    expect(host.querySelectorAll('[role=tab]').length).toBe(2);
    expect(host.querySelector('[name=windNote]')).toBeNull();
    await click(btn('Save'));
    expect(text()).toContain('Code is required');
    expect(host.querySelector('.xf-form-tab.xf-has-error')).not.toBeNull();
    await act(async () => { type('code', 'abc'); type('name', 'Wind Farm'); });
    await click(host.querySelectorAll<HTMLInputElement>('[role=radiogroup] input')[1]);
    expect(host.querySelector('[name=windNote]')).not.toBeNull();
    await click(btn('Technical'));
    await act(async () => { type('capacityMw', '20.25'); type('commissionedAt', '2026-03-01T08:15'); });
    await click(host.querySelector('.xf-chip-option input'));
    await click(btn('Save'));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({ code: 'ABC', name: 'Wind Farm', type: 'Wind', capacityMw: 20.25, commissionedAt: '2026-03-01T08:15', tags: ['A'], enabled: true });
    expect(frame.replaceParams).toHaveBeenCalledWith({ id: '9' });
  });

  it('copies, resets, runs custom actions, deletes and shows history', async () => {
    routes['GET /api/assets/7'] = () => [200, { success: true, data: REC }];
    routes['POST /api/assets/7/retire'] = () => [200, { success: true, data: { ...REC, enabled: false } }];
    routes['DELETE /api/assets/7'] = () => [200, { success: true, data: null }];
    routes['GET /api/audit'] = () => [200, { success: true, data: [{ id: 1, at: '2026-01-01T00:00:00Z', user: 'ann', action: 'UPDATE', changed: 'name' }] }];
    routes['GET /api/audit/1'] = () => [200, { success: true, data: { id: 1, at: '2026-01-01T00:00:00Z', user: 'ann', action: 'UPDATE', changed: ['name'], before: { name: 'Old' }, after: { name: 'Solar One' } } }];
    const hooks: EntryHooks = { afterLoad: (r) => ({ ...r, name: String(r.name) }) };
    render(<EntryFormDisplay meta={meta({ create: true, update: true, delete: true })} params={{ id: '7' }} config={ENTRY} hooks={hooks} />);
    await flush();
    expect(text()).toContain('Asset: Solar One');

    await click(btn('History'));
    expect(calls.some((c) => c.url.startsWith('/api/audit?entityType=Asset&entityId=7'))).toBe(true);
    await click(host.querySelector('.xf-audit-head'));
    expect(text()).toContain('Old');

    await act(async () => { type('name', 'Changed'); });
    expect(text()).toContain('Unsaved');
    await click(btn('Reset'));
    expect((host.querySelector('[name=name]') as HTMLInputElement).value).toBe('Solar One');

    await click(btn('Retire'));
    expect(text()).toContain('Retire this asset?');
    await click(host.querySelector('.xf-confirm .xf-btn-primary'));
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/assets/7/retire')).toBe(true);

    await click(btn('Copy'));
    expect(text()).toContain('New Asset (copy)');
    expect((host.querySelector('[name=name]') as HTMLInputElement).value).toBe('Solar One (copy)');
    expect((host.querySelector('[name=code]') as HTMLInputElement).value).toBe('');
    await click(btn('Reset'));
    await flush();
    expect(text()).toContain('Asset: Solar One');

    await click(btn('Delete'));
    await click(host.querySelector('.xf-confirm .xf-btn-danger'));
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/assets/7')).toBe(true);
    expect(frame.close).toHaveBeenCalled();
  });

  it('hides actions the user may not use and runs read only', async () => {
    routes['GET /api/assets/7'] = () => [200, { success: true, data: REC }];
    render(<EntryFormDisplay meta={meta({ create: false, update: false, delete: false })} params={{ id: '7' }} config={ENTRY} />);
    await flush();
    expect(text()).toContain('Read only');
    expect(btn('Delete')).toBeUndefined();
    expect(btn('Copy')).toBeUndefined();
    expect((host.querySelector('[name=name]') as HTMLInputElement).disabled).toBe(true);
  });

  it('embedded: keeps fixed values and reports saves', async () => {
    routes['POST /api/outages'] = (b) => [200, { success: true, data: { ...b, id: 3 } }];
    const onSaved = vi.fn();
    const cfg: EntryConfig = { entity: 'Outage', endpoint: '/outages', fields: [{ name: 'assetId', label: 'Asset', type: 'integer' }, { name: 'reason', label: 'Reason', required: true }] };
    render(<EntryFormDisplay meta={meta()} params={{}} config={cfg} embed={{ recordId: 'new', fixedValues: { assetId: 4 }, onSaved }} />);
    await flush();
    expect((host.querySelector('[name=assetId]') as HTMLInputElement).disabled).toBe(true);
    await act(async () => { type('reason', 'Maintenance'); });
    await click(btn('Save'));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ assetId: 4, reason: 'Maintenance' });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }), true);
    expect(frame.replaceParams).not.toHaveBeenCalled();
  });
});

describe('Summary template', () => {
  const SUM: SummaryConfig = {
    entity: 'Asset', entityPlural: 'Assets', endpoint: '/assets', remote: true, pageSize: 25,
    columns: [{ field: 'code', text: 'Code' }, { field: 'capacityMw', text: 'Capacity', type: 'number', renderer: 'currency:INR' }],
    searchFields: [{ name: 'type', label: 'Type', options: ['Solar', 'Wind'] }, { name: 'commissioned', label: 'Commissioned', type: 'date', operator: 'between', param: 'commissionedAt' }],
    sorters: [{ property: 'code' }],
    toolbarActions: [{ id: 'new', kind: 'new' }, { id: 'refresh', kind: 'refresh' }],
  };
  it('sends search values and paging to the server', async () => {
    routes['GET /api/assets'] = () => [200, { success: true, data: [{ id: 1, code: 'A', capacityMw: 5 }], total: 60 }];
    render(<SummaryDisplay meta={{ ...meta(), type: 'summary' }} params={{}} config={SUM} />);
    await flush();
    expect(calls[0].url).toContain('start=0');
    expect(calls[0].url).toContain('limit=25');
    expect(text()).toContain('Page 1 of 3');
    await act(async () => { type('#sf-type', 'Wind'); });
    const from = host.querySelector<HTMLInputElement>('input[aria-label="Commissioned from"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(from, '2026-01-01'); from.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(btn('Search'));
    const last = calls[calls.length - 1].url;
    expect(last).toContain('type=Wind');
    expect(last).toContain('commissionedAtFrom=2026-01-01');
    await click(host.querySelector('[aria-label="Next page"]'));
    expect(calls[calls.length - 1].url).toContain('start=25');
  });
  it('needs its endpoint parameters', async () => {
    render(<SummaryDisplay meta={{ ...meta(), type: 'summary' }} params={{}} config={{ ...SUM, endpoint: '/assets/{assetId}/outages' }} />);
    await flush();
    expect(text()).toContain('It needs assetId');
  });
});

describe('Master-Slave template', () => {
  it('has a splitter that flips the orientation, remembers it and resets on double-click', async () => {
    routes['GET /api/assets'] = () => [200, { success: true, data: [{ id: 1, code: 'A' }], total: 1 }];
    localStorage.removeItem('xf-ms-layout:ms1');
    const cfg = { master: { entity: 'Asset', entityPlural: 'Assets', endpoint: '/assets', columns: [{ field: 'code', text: 'Code' }] }, detail: { entry: ENTRY }, relation: 'same', split: 40 } as any;
    render(<MasterSlaveDisplay meta={{ ...meta(), id: 'ms1', type: 'master-slave' }} params={{}} config={cfg} />);
    await flush();
    const ms = () => host.querySelector('.xf-ms')!;
    const sep = host.querySelector('[role="separator"]') as HTMLElement;
    expect(sep.getAttribute('aria-valuenow')).toBe('40');
    expect(ms().classList.contains('xf-ms-stacked')).toBe(false);
    await click(host.querySelector('.xf-ms-flip'));
    expect(ms().classList.contains('xf-ms-stacked')).toBe(true);
    await act(async () => { sep.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    expect(sep.getAttribute('aria-valuenow')).toBe('45');
    expect(JSON.parse(localStorage.getItem('xf-ms-layout:ms1')!)).toEqual({ split: 45, orientation: 'vertical' });
    await act(async () => { sep.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(sep.getAttribute('aria-valuenow')).toBe('40');
    expect(ms().classList.contains('xf-ms-stacked')).toBe(false);
  });
});
