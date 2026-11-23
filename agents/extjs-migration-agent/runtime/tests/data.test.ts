import { Ext } from '../src/core/ext';
import '../src/core/class';
import '../src/core/observable';
import '../src/util/date';
import '../src/util/format';
import '../src/util/template';
import '../src/util/collection';
import '../src/util/task';
import '../src/dom/element';
import '../src/data/connection';
import '../src/data/model';
import '../src/data/proxy';
import '../src/data/store';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Set GRIDTRADE_WEB to the GridTrade Ext JS app's web/ folder; the suite is skipped when it is not found.
const GT_APP = resolve(process.env.GRIDTRADE_WEB || '../../../../gridtrade-contracts-extjs/web', 'app') + '/';
const HAVE_GT = existsSync(GT_APP + 'core/RestProxy.js');
const load = (f: string) => (0, eval)(readFileSync(GT_APP + f, 'utf8'));

// fake server
const db: any = { contracts: [{ id: 1, name: 'Alpha', type: 'PPA', counterpartyId: 3, startDate: '2026-01-01', status: 'Draft', commodities: ['Energy'] }, { id: 2, name: 'Beta', type: 'Swap', counterpartyId: 4, startDate: '2026-02-01', status: 'Approved', commodities: [] }] };
const calls: any[] = [];
Ext.Ajax.request = function (o: any) {
  calls.push({ url: o.url, method: o.method, params: o.params, jsonData: o.jsonData, headers: o.headers });
  const respond = (status: number, body: any) => setTimeout(() => o.callback(o, status < 400, { status, statusText: '', responseText: JSON.stringify(body), responseJson: body }), 0);
  const m = /api\/contracts(?:\/(\d+))?(?:\/components)?/.exec(o.url);
  if (o.url.indexOf('/components') > 0) { respond(200, { success: true, data: [{ id: 9, contractId: Number(m[1]), name: 'Leg', type: 'Fixed Price', price: 4500 }] }); return {}; }
  if (o.method === 'GET' && m && m[1]) { respond(200, { success: true, data: db.contracts.find((c: any) => c.id === Number(m[1])) }); return {}; }
  if (o.method === 'GET') { respond(200, { success: true, data: db.contracts, total: 2 }); return {}; }
  if (o.method === 'POST') { if (!o.jsonData.name) { respond(400, { success: false, message: 'Please correct the highlighted fields', errors: { name: 'Required' } }); return {}; } const rec = Object.assign({ id: 77, status: 'Draft', version: 1 }, o.jsonData); db.contracts.push(rec); respond(200, { success: true, data: rec }); return {}; }
  if (o.method === 'PUT') { const c = db.contracts.find((x: any) => x.id === Number(m[1])); Object.assign(c, o.jsonData, { version: 2 }); respond(200, { success: true, data: c }); return {}; }
  if (o.method === 'DELETE') { respond(200, { success: true, data: null }); return {}; }
  respond(404, { success: false, message: 'nope' });
  return {};
};

beforeAll(() => {
  if (!HAVE_GT) return;
  (Ext.global as any).GT = { util: { Toast: { error: (m: string) => calls.push({ toast: m }) } } };
  load('core/RestProxy.js'); load('core/BaseModel.js'); load('core/BaseStore.js');
  load('model/Contract.js'); load('model/Component.js'); load('store/Contracts.js'); load('store/Components.js');
});

const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!HAVE_GT)('GridTrade data layer on the runtime', () => {
  it('loads a store through the REST proxy, sorts, converts dates', async () => {
    const store = Ext.create('GT.store.Contracts');
    await store.loadPromise();
    expect(store.getCount()).toBe(2);
    expect(store.getAt(0).get('name')).toBe('Alpha');
    expect(Ext.isDate(store.getAt(0).get('startDate'))).toBe(true);
    expect(store.getAt(0).get('commodityList')).toBe('Energy');
    expect(calls[calls.length - 1].url).toBe('api/contracts');
    store.addFilter({ id: 'q', filterFn: (r: any) => r.get('status') === 'Approved' });
    expect(store.getCount()).toBe(1);
    expect(store.getData().getSource().getCount()).toBe(2);
    store.removeFilter('q');
    expect(store.isFiltered()).toBe(false);
    store.sort('name', 'DESC');
    expect(store.getAt(0).get('name')).toBe('Beta');
    expect(store.findRecord('name', 'alp').get('id')).toBe(1);
    expect(store.findRecord('name', 'alp', 0, false, true, true)).toBe(null);
  });
  it('saves (create / update / destroy), commits and reports server field errors', async () => {
    const rec = Ext.create('GT.model.Contract', { name: 'Gamma', type: 'PPA', counterpartyId: 5, legalEntityId: 1 });
    expect(rec.phantom).toBe(true);
    expect(rec.getId()).toBeLessThan(0);
    const saved = await rec.savePromise();
    expect(saved.getId()).toBe(77);
    expect(rec.phantom).toBe(false);
    expect(rec.dirty).toBe(false);
    const post = calls.filter((c) => c.method === 'POST').pop();
    expect(post.url).toBe('api/contracts');
    expect(post.jsonData.id).toBeUndefined();
    expect(post.jsonData.status).toBeUndefined();
    rec.set('contractedMw', 12.5);
    expect(rec.dirty).toBe(true);
    await rec.savePromise();
    const put = calls.filter((c) => c.method === 'PUT').pop();
    expect(put.url).toBe('api/contracts/77');
    expect(put.jsonData).toEqual({ contractedMw: 12.5 });
    expect(rec.get('version')).toBe(2);
    const bad = Ext.create('GT.model.Contract', { type: 'PPA' });
    let err: any = null;
    try { await bad.savePromise(); } catch (e) { err = e; }
    expect(err.message).toBe('Please correct the highlighted fields');
    expect(err.fieldErrors).toEqual({ name: 'Required' });
    expect(calls.some((c) => c.toast === 'Please correct the highlighted fields')).toBe(true);
  });
  it('fills nested URL templates from the record and from extraParams', async () => {
    const comp = Ext.create('GT.model.Component', { contractId: 5, name: 'X' });
    await comp.savePromise().catch(() => null);
    expect(calls.filter((c) => c.method === 'POST').pop().url).toBe('api/contracts/5/components');
    const s = Ext.create('GT.store.Components');
    await s.loadWith({ contractId: 2 });
    const get = calls[calls.length - 1];
    expect(get.url).toBe('api/contracts/2/components');
    expect(get.params.contractId).toBeUndefined();
    expect(s.getAt(0).get('pricing')).toBe('₹ 4500 /MWh');
  });
  it('Model.load, validation, reject', async () => {
    const r: any = await new Promise((res) => (Ext.global as any).GT.model.Contract.load(2, { success: res }));
    expect(r.get('name')).toBe('Beta');
    const v = Ext.create('GT.model.Contract', { name: '' });
    expect(v.isValid()).toBe(false);
    expect(v.getValidation(true).get('name')).toBe('Must be present');
    r.set('name', 'Changed'); r.reject();
    expect(r.get('name')).toBe('Beta');
  });
  it('chained store, array store, grouping, xtemplate, dates', () => {
    const src = Ext.create('Ext.data.Store', { fields: ['id', 'name', 'enabled'], data: [{ id: 1, name: 'b', enabled: true }, { id: 2, name: 'a', enabled: false }, { id: 3, name: 'c', enabled: true }] });
    const ch = Ext.create('Ext.data.ChainedStore', { source: src, filters: [{ property: 'enabled', value: true }], sorters: ['name'] });
    expect(ch.getCount()).toBe(2);
    expect(ch.getAt(0).get('name')).toBe('b');
    src.add({ id: 4, name: 'aa', enabled: true });
    expect(ch.getCount()).toBe(3);
    const arr = Ext.data.StoreManager.lookup([['x', 'X'], ['y', 'Y']]);
    expect(arr.getAt(1).get('field2')).toBe('Y');
    src.group('enabled');
    expect(src.getGroups().getCount()).toBe(2);
    const tpl = new Ext.XTemplate('<tpl for=".">{name}{[xindex < xcount ? "," : ""]}</tpl>', '<tpl if="x &gt; 1">big</tpl>');
    expect(tpl.apply([{ name: 'a' }, { name: 'b' }])).toBe('a,b');
    const t2 = new Ext.XTemplate('{name} · {rows.length} trade{[values.rows.length === 1 ? "" : "s"]} {v:number("0,000.0")} {d:date("d-M-Y")}<tpl if="x">X<tpl elseif="y">Y<tpl else>Z</tpl>');
    expect(t2.apply({ name: 'DAM', rows: [1, 2], v: 1234.5, d: new Date(2026, 9, 21), y: 1 })).toBe('DAM · 2 trades 1,234.5 21-Oct-2026Y');
    expect(Ext.Date.format(Ext.Date.parse('21-Oct-2026', 'd-M-Y'), 'Y-m-d')).toBe('2026-10-21');
    expect(Ext.Date.parse('2026-10-21T10:00:00Z', 'c').getTime()).toBe(Date.UTC(2026, 9, 21, 10));
    expect(Ext.util.Format.number(-1234567.891, '0,000.00')).toBe('-1,234,567.89');
    expect(Ext.util.Format.number(0.5, '0%')).toBe('1%');
  });
});
