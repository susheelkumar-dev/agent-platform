/**
 * Ext.data.Store, Ext.data.ChainedStore, Ext.data.ArrayStore and Ext.data.StoreManager.
 * Local or remote sorting / filtering / grouping, paging, load / loadData / loadRecords, add / insert /
 * remove, sync with batches, rejectChanges / commitChanges, record -> store notifications, and the Ext event
 * sequence (beforeload, load, datachanged, refresh, update, add, remove, clear, filterchange, sort, groupchange).
 */
import { Ext } from '../core/ext';
import { define } from '../core/class';
import '../core/observable';
import { Collection, Filter, Sorter, Grouper } from '../util/collection';
import { implicitModel } from './model';
import './proxy';

// A read-only collection view over an array (store.getData(), getSource(), query results)
class DataView {
  [k: string]: any;
  isCollection = true;
  items: any[];
  $source: DataView | null;
  constructor(items: any[], source: DataView | null = null) { this.items = items; this.$source = source; this.length = items.length; }
  getCount() { return this.items.length; }
  getAt(i: number) { return this.items[i]; }
  get(key: any) { return this.items.find((r) => r.getId && r.getId() === key) || (typeof key === 'number' ? this.items[key] : undefined); }
  getByKey(key: any) { return this.items.find((r) => r.getId && r.getId() === key); }
  first() { return this.items[0]; }
  last() { return this.items[this.items.length - 1]; }
  indexOf(r: any) { return this.items.indexOf(r); }
  contains(r: any) { return this.items.indexOf(r) >= 0; }
  each(fn: any, scope?: any) { const a = this.items.slice(); for (let i = 0; i < a.length; i++) { if (fn.call(scope || a[i], a[i], i, a.length) === false) { break; } } }
  getRange(start = 0, end?: number) { if (!this.items.length) { return []; } end = Math.min(end === undefined || end === null ? this.items.length - 1 : end, this.items.length - 1); return this.items.slice(start, end + 1); }
  findBy(fn: any, scope?: any) { return this.items.find((r) => fn.call(scope, r, r.getId ? r.getId() : undefined)) || null; }
  findIndexBy(fn: any, scope?: any, start = 0) { for (let i = start; i < this.items.length; i++) { if (fn.call(scope, this.items[i])) { return i; } } return -1; }
  filterBy(fn: any, scope?: any) { return new DataView(this.items.filter((r) => fn.call(scope, r, r.getId ? r.getId() : undefined))); }
  collect(prop: string) { return Ext.Array.unique(this.items.map((r) => r.get(prop)).filter((v) => !Ext.isEmpty(v))); }
  getSource() { return this.$source; }
  toArray() { return this.items.slice(); }
  getValues(prop: string) { return this.items.map((r) => r.get(prop)); }
  sum(prop: string) { return this.items.reduce((s, r) => s + (Number(r.get(prop)) || 0), 0); }
}

// Mutable collections of filters / sorters that keep their store in step
function makeOwnedCollection(store: any, kind: 'filters' | 'sorters') {
  const coll = new Collection({ keyFn: (x: any) => x.id || x.property || (x.$autoId || (x.$autoId = Ext.id(null, kind + '-'))) });
  const notify = () => { if (!coll.$silent) { if (kind === 'filters') { store.$onFiltersChanged(); } else { store.$onSortersChanged(); } } };
  const origAdd = coll.add.bind(coll), origRemove = coll.remove.bind(coll), origRemoveAll = coll.removeAll.bind(coll), origInsert = coll.insert.bind(coll);
  const wrapItem = (x: any) => {
    if (kind === 'filters') { return x && x.isFilter ? x : new Filter(typeof x === 'function' ? { filterFn: x } : x); }
    return x && x.isSorter ? x : new Sorter(typeof x === 'function' ? { sorterFn: x } : x);
  };
  coll.add = function (items: any) {
    if (arguments.length === 2) { return origAdd(arguments[0], wrapItem(arguments[1])); }
    const r = origAdd(Ext.Array.from(items).map(wrapItem));
    notify();
    return Ext.isArray(items) ? r : (r && r[0] !== undefined && Ext.isArray(r) ? r[0] : r);
  };
  coll.insert = function (index: number, items: any) { const r = origInsert(index, Ext.Array.from(items).map(wrapItem)); notify(); return r; };
  coll.remove = function (items: any) {
    const list = Ext.Array.from(items).map((x: any) => (typeof x === 'string' ? coll.get(x) : x)).filter(Boolean);
    const r = origRemove(list);
    notify();
    return r;
  };
  coll.removeAll = function () { const r = origRemoveAll(); notify(); return r; };
  coll.clear = coll.removeAll;
  coll.beginUpdate = function () { coll.$silent = true; };
  coll.endUpdate = function () { coll.$silent = false; notify(); };
  coll.getFilterFn = function () { const active = coll.items.filter((f: any) => !f.disabled); return (r: any) => active.every((f: any) => f.filter(r)); };
  coll.splice = function (index: number, remove: any, add?: any) {
    coll.$silent = true;
    if (remove) { coll.remove(typeof remove === 'number' ? coll.items.slice(index, index + remove) : remove); }
    if (add) { coll.insert(index, add); }
    coll.$silent = false;
    notify();
  };
  return coll;
}

export const Store: any = define('Ext.data.Store', {
  mixins: { observable: 'Ext.mixin.Observable' },
  alias: 'store.store',
  isStore: true,
  isDataStore: true,
  pageSize: 25,
  currentPage: 1,
  remoteSort: false,
  remoteFilter: false,
  remoteGroup: false,
  autoLoad: false,
  autoSync: false,
  autoDestroy: false,
  trackRemoved: true,
  groupField: undefined,
  groupDir: 'ASC',
  loading: false,
  loadCount: 0,
  totalCount: 0,

  constructor: function (config?: any) {
    const me = this;
    config = Ext.apply({}, config);
    const listeners = config.listeners;
    delete config.listeners;
    const sorters = 'sorters' in config ? config.sorters : me.sorters;
    const filters = 'filters' in config ? config.filters : me.filters;
    const data = 'data' in config ? config.data : me.data;
    const proxyCfg = 'proxy' in config ? config.proxy : me.proxy;
    const fields = 'fields' in config ? config.fields : me.fields;
    const grouper = 'grouper' in config ? config.grouper : me.grouper;
    for (const k of ['sorters', 'filters', 'data', 'proxy', 'fields', 'grouper']) { delete config[k]; }
    Ext.apply(me, config);
    me.$all = [];
    me.$view = [];
    me.removed = [];
    me.$idMap = new Map();
    me.mixins.observable.constructor.call(me, listeners ? { listeners } : undefined);
    // model
    let model = me.model;
    if (typeof model === 'string') {
      const cls = Ext.ClassManager.get(model);
      if (!cls) { throw new Error('Store: model "' + model + '" is not defined'); }
      model = cls;
    }
    if (!model && fields) { model = implicitModel(fields); }
    if (!model) { model = implicitModel([]); }
    me.model = model;
    // proxy
    me.$setupProxy(proxyCfg);
    me.$sorters = makeOwnedCollection(me, 'sorters');
    me.$filters = makeOwnedCollection(me, 'filters');
    me.$sorters.$silent = true; me.$filters.$silent = true;
    if (sorters) { me.$sorters.add(Ext.Array.from(sorters).map((s: any) => (typeof s === 'string' ? { property: s } : s))); }
    if (filters) { me.$filters.add(Ext.Array.from(filters)); }
    me.$sorters.$silent = false; me.$filters.$silent = false;
    if (grouper) { me.$grouper = grouper.isGrouper ? grouper : new Grouper(grouper); }
    else if (me.groupField) { me.$grouper = new Grouper({ property: me.groupField, direction: me.groupDir || 'ASC' }); }
    if (me.storeId) { StoreManager.register(me); }
    if (data && data.length !== undefined) {
      me.$loadArray(data, false, true);
    } else if (data && typeof data === 'object' && !Ext.isArray(data)) {
      me.$loadArray(me.getProxy().getReader().read(data).getRecords(), false, true);
    }
    if (me.autoLoad) {
      const opts = typeof me.autoLoad === 'object' ? me.autoLoad : undefined;
      setTimeout(() => { if (!me.destroyed && !me.loadCount && !me.loading) { me.load(opts); } }, 1);
    }
    return me;
  },

  $setupProxy: function (cfg: any) {
    const me = this;
    let proxy;
    if (cfg && cfg.isProxy) { proxy = cfg; }
    else if (cfg) { proxy = Ext.Factory.proxy(typeof cfg === 'string' ? { type: cfg } : Ext.clone(cfg), 'ajax'); }
    else if (me.model.getProxy && me.model.getProxy()) { proxy = me.model.getProxy(); }
    else { proxy = Ext.Factory.proxy({ type: 'memory' }); }
    if (!proxy.getModel() || cfg) { proxy.setModel(me.model); }
    me.$proxy = proxy;
  },
  getProxy: function () { return this.$proxy; },
  setProxy: function (cfg: any) { this.$setupProxy(cfg); return this.$proxy; },
  getModel: function () { return this.model; },
  setModel: function (m: any) { this.model = typeof m === 'string' ? Ext.ClassManager.get(m) : m; if (this.$proxy) { this.$proxy.setModel(this.model); } },
  getStoreId: function () { return this.storeId; },
  setStoreId: function (id: string) { this.storeId = id; StoreManager.register(this); },
  getPageSize: function () { return this.pageSize; },
  setPageSize: function (s: number) { this.pageSize = s; },
  getRemoteSort: function () { return this.remoteSort; },
  setRemoteSort: function (v: boolean) { this.remoteSort = v; },
  getRemoteFilter: function () { return this.remoteFilter; },
  setRemoteFilter: function (v: boolean) { this.remoteFilter = v; },
  getAutoLoad: function () { return this.autoLoad; },
  setAutoLoad: function (v: any) { this.autoLoad = v; },
  getAutoSync: function () { return this.autoSync; },
  setAutoSync: function (v: boolean) { this.autoSync = v; },

  // ---------------------------------------------------------------- record creation
  $toRecord: function (r: any) {
    if (r && r.isModel) { return r; }
    return new this.model(r);
  },
  createModel: function (data: any) { return this.$toRecord(data); },

  // ---------------------------------------------------------------- data access
  getData: function () {
    const me = this;
    const filtered = me.isFiltered();
    return new DataView(me.$view, filtered ? new DataView(me.$all) : null);
  },
  setData: function (data: any) { this.loadData(data); },
  getCount: function () { return this.$view.length; },
  getTotalCount: function () { return this.totalCount || this.$all.length; },
  getAt: function (i: number) { return this.$view[i]; },
  first: function (grouped?: boolean) { void grouped; return this.$view[0]; },
  last: function () { return this.$view[this.$view.length - 1]; },
  getRange: function (start = 0, end?: number) {
    const v = this.$view;
    if (!v.length) { return []; }
    end = Math.min(end === undefined || end === null ? v.length - 1 : end, v.length - 1);
    return v.slice(start, end + 1);
  },
  getById: function (id: any) { return this.$idMap.get(id) || this.$idMap.get(String(id)) || (typeof id === 'string' && !isNaN(Number(id)) ? this.$idMap.get(Number(id)) : undefined) || null; },
  getByInternalId: function (id: any) { return this.$all.find((r: any) => r.internalId === id) || null; },
  indexOf: function (r: any) { return this.$view.indexOf(r); },
  indexOfId: function (id: any) { return this.$view.indexOf(this.getById(id)); },
  indexOfTotal: function (r: any) { return this.$all.indexOf(r); },
  contains: function (r: any) { return this.$all.indexOf(r) >= 0; },
  each: function (fn: any, scope?: any, includeOptions?: any) {
    void includeOptions;
    const a = this.$view.slice();
    for (let i = 0; i < a.length; i++) { if (fn.call(scope || a[i], a[i], i, a.length) === false) { break; } }
  },
  eachRecord: function (fn: any, scope?: any) { this.each(fn, scope); },
  collect: function (dataIndex: string, allowNull?: boolean, bypassFilter?: boolean) {
    const src = bypassFilter ? this.$all : this.$view;
    const out: any[] = [];
    const seen = new Set();
    for (const r of src) {
      const v = r.get(dataIndex);
      if ((allowNull || !Ext.isEmpty(v)) && !seen.has(Ext.isDate(v) ? v.getTime() : v)) { seen.add(Ext.isDate(v) ? v.getTime() : v); out.push(v); }
    }
    return out;
  },
  sum: function (field: string) { return this.$view.reduce((s: number, r: any) => s + (Number(r.get(field)) || 0), 0); },
  average: function (field: string) { const n = this.$view.length; return n ? this.sum(field) / n : 0; },
  min: function (field: string) { let m; for (const r of this.$view) { const v = r.get(field); if (v !== null && v !== undefined && (m === undefined || v < m)) { m = v; } } return m; },
  max: function (field: string) { let m; for (const r of this.$view) { const v = r.get(field); if (v !== null && v !== undefined && (m === undefined || v > m)) { m = v; } } return m; },
  count: function () { return this.$view.length; },
  aggregate: function (fn: any, scope?: any) { return fn.call(scope || this, this.$view); },
  find: function (property: string, value: any, start = 0, anyMatch?: boolean, caseSensitive?: boolean, exactMatch?: boolean) {
    const f = new Filter({ property, value, anyMatch, caseSensitive, exactMatch });
    for (let i = start; i < this.$view.length; i++) { if (f.filter(this.$view[i])) { return i; } }
    return -1;
  },
  findRecord: function (...args: any[]) { const i = this.find(...args); return i >= 0 ? this.$view[i] : null; },
  findExact: function (property: string, value: any, start = 0) {
    for (let i = start; i < this.$view.length; i++) { const v = this.$view[i].get(property); if (v === value || (Ext.isDate(v) && Ext.isDate(value) && v.getTime() === value.getTime())) { return i; } }
    return -1;
  },
  findBy: function (fn: any, scope?: any, start = 0) {
    for (let i = start; i < this.$view.length; i++) { const r = this.$view[i]; if (fn.call(scope || r, r, r.getId())) { return i; } }
    return -1;
  },
  queryBy: function (fn: any, scope?: any) { return new DataView(this.$all.filter((r: any) => fn.call(scope || r, r, r.getId()))); },
  query: function (property: string, value: any, anyMatch?: boolean, caseSensitive?: boolean, exactMatch?: boolean) {
    const f = new Filter({ property, value, anyMatch, caseSensitive, exactMatch });
    return new DataView(this.$all.filter((r: any) => f.filter(r)));
  },
  queryRecords: function (field: string, value: any) {
    return this.$all.filter((r: any) => { const v = r.get(field); return v === value || (v !== null && v !== undefined && value !== null && value !== undefined && String(v) === String(value) && typeof v === typeof value); });
  },
  byValue: function (field: string, value: any) { return this.queryRecords(field, value); },
  isEmptyStore: false,
  isLoaded: function () { return this.loadCount > 0; },
  isLoading: function () { return !!this.loading; },
  hasPendingLoad: function () { return !!this.loading; },
  isSource: false,
  getSource: function () { return null; },

  // ---------------------------------------------------------------- internal recompute
  $reindex: function () {
    const map = new Map();
    for (const r of this.$all) { map.set(r.getId(), r); }
    this.$idMap = map;
  },
  $combinedSorter: function () {
    const me = this;
    const list = [];
    if (me.$grouper && !me.remoteGroup) { list.push(me.$grouper); }
    if (!me.remoteSort) { for (const s of me.$sorters.items) { list.push(s); } }
    if (!list.length) { return null; }
    return (a: any, b: any) => { for (const s of list) { const r = s.sort(a, b); if (r) { return r; } } return 0; };
  },
  $applySort: function () {
    const fn = this.$combinedSorter();
    if (!fn) { return false; }
    const indexed = this.$all.map((r: any, i: number) => [r, i]);
    indexed.sort((x: any, y: any) => fn(x[0], y[0]) || x[1] - y[1]);
    this.$all = indexed.map((x: any) => x[0]);
    return true;
  },
  $applyFilter: function () {
    const me = this;
    if (me.remoteFilter || !me.$filters.getCount()) { me.$view = me.$all.slice(); return; }
    const fn = me.$filters.getFilterFn();
    me.$view = me.$all.filter(fn);
  },
  $recompute: function () { this.$applySort(); this.$applyFilter(); },
  $fireRefresh: function () { this.fireEvent('datachanged', this); this.fireEvent('refresh', this); },

  // ---------------------------------------------------------------- load
  load: function (options?: any) {
    const me = this;
    if (typeof options === 'function') { options = { callback: options }; }
    options = Ext.apply({}, options);
    const page = options.page || me.currentPage || 1;
    const pageSize = options.limit !== undefined ? options.limit : me.pageSize;
    const opCfg: any = {
      params: options.params,
      addRecords: options.addRecords,
      callback: options.callback,
      scope: options.scope,
      internalScope: me,
      internalCallback: me.onProxyLoad,
      filters: me.remoteFilter ? me.$filters.items.filter((f: any) => !f.disabled && !f.filterFn) : undefined,
      sorters: me.remoteSort ? me.$sorters.items.slice() : undefined,
      grouper: me.remoteGroup ? me.$grouper : undefined
    };
    if (pageSize) {
      opCfg.page = page;
      opCfg.start = options.start !== undefined ? options.start : (page - 1) * pageSize;
      opCfg.limit = pageSize;
      me.currentPage = page;
    }
    const operation = me.getProxy().createOperation('read', opCfg);
    if (me.fireEvent('beforeload', me, operation) === false) { return me; }
    me.loading = true;
    me.$lastOperation = operation;
    operation.execute();
    return me;
  },
  onProxyLoad: function (operation: any) {
    const me = this;
    if (me.destroyed) { return; }
    if (operation !== me.$lastOperation && me.$lastOperation && me.$lastOperation.isRunning()) {
      // a newer load is in flight: ignore this stale response (Ext aborts the previous request)
      return;
    }
    const success = operation.wasSuccessful();
    const records = operation.getRecords() || [];
    const rs = operation.getResultSet();
    me.loading = false;
    if (success) {
      me.totalCount = rs && rs.getTotal ? rs.getTotal() : records.length;
      me.loadRecords(records, { addRecords: operation.getAddRecords() });
    }
    me.loadCount++;
    me.fireEvent('load', me, records, success, operation);
  },
  reload: function (options?: any) { return this.load(Ext.apply({ page: this.currentPage }, options)); },
  loadPage: function (page: number, options?: any) { this.currentPage = page; return this.load(Ext.apply({ page }, options)); },
  nextPage: function (options?: any) { return this.loadPage(this.currentPage + 1, options); },
  previousPage: function (options?: any) { return this.loadPage(Math.max(1, this.currentPage - 1), options); },
  loadRecords: function (records: any[], options?: any) {
    const me = this;
    const add = options && options.addRecords;
    if (!add) {
      for (const r of me.$all) { r.unjoin(me); }
      me.$all = [];
      me.removed = [];
    }
    for (const r of records) { r.join(me); me.$all.push(r); }
    me.$reindex();
    me.$recompute();
    me.$fireRefresh();
  },
  $loadArray: function (data: any[], append: boolean, silent?: boolean) {
    const me = this;
    const reader = me.getProxy() && me.getProxy().getReader ? me.getProxy().getReader() : null;
    let records;
    if (data.length && Ext.isArray(data[0]) && reader) {
      records = reader.read(data).getRecords();
    } else {
      records = data.map((d: any) => { const r = me.$toRecord(d); if (!d || !d.isModel) { r.phantom = false; } return r; });
    }
    if (!append) { for (const r of me.$all) { r.unjoin(me); } me.$all = []; me.removed = []; }
    for (const r of records) { r.join(me); me.$all.push(r); }
    me.$reindex();
    me.$recompute();
    if (!silent) { me.$fireRefresh(); }
  },
  loadData: function (data: any, append?: boolean) { this.$loadArray(Ext.Array.from(data), !!append); this.loadCount = Math.max(this.loadCount, 1); },
  loadRawData: function (data: any, options?: any) {
    const rs = this.getProxy().getReader().read(data);
    this.loadRecords(rs.getRecords(), options);
    this.fireEvent('load', this, rs.getRecords(), true);
  },

  // ---------------------------------------------------------------- add / insert / remove
  add: function (...args: any[]) {
    let records = args.length === 1 ? Ext.Array.from(args[0]) : args;
    const me = this;
    records = records.map((r: any) => me.$toRecord(r));
    const fn = me.$combinedSorter();
    if (fn) {
      for (const r of records) {
        let i = 0;
        while (i < me.$all.length && fn(me.$all[i], r) <= 0) { i++; }
        me.$all.splice(i, 0, r);
        r.join(me);
      }
      me.$reindex();
      me.$applyFilter();
      me.fireEvent('add', me, records, me.$view.indexOf(records[0]));
      me.fireEvent('datachanged', me);
      if (me.autoSync) { me.sync(); }
      return records;
    }
    return me.insert(me.$view.length, records);
  },
  insert: function (index: number, records: any) {
    const me = this;
    const list = Ext.Array.from(records).map((r: any) => me.$toRecord(r));
    let pos = me.$all.length;
    if (index < me.$view.length) { pos = me.$all.indexOf(me.$view[index]); if (pos < 0) { pos = me.$all.length; } }
    me.$all.splice(pos, 0, ...list);
    for (const r of list) { r.join(me); }
    me.$reindex();
    me.$applyFilter();
    me.fireEvent('add', me, list, index);
    me.fireEvent('datachanged', me);
    if (me.autoSync) { me.sync(); }
    return list;
  },
  remove: function (records: any, isMove?: boolean, silent?: boolean) {
    const me = this;
    const list = Ext.Array.from(records).map((r: any) => (typeof r === 'number' ? me.$view[r] : r)).filter((r: any) => r && me.$all.indexOf(r) >= 0);
    if (!list.length) { return []; }
    const index = me.$view.indexOf(list[0]);
    for (const r of list) {
      Ext.Array.remove(me.$all, r);
      Ext.Array.remove(me.$view, r);
      if (!isMove) {
        if (me.trackRemoved && !r.phantom && !r.erased && me.removed.indexOf(r) < 0) { me.removed.push(r); }
        r.unjoin(me);
      }
    }
    me.$reindex();
    if (!silent) {
      me.fireEvent('remove', me, list, index, !!isMove);
      me.fireEvent('datachanged', me);
    }
    if (me.autoSync && !isMove) { me.sync(); }
    return list;
  },
  removeAt: function (index: number, count = 1) { return this.remove(this.$view.slice(index, index + count)); },
  removeAll: function (silent?: boolean) {
    const me = this;
    const had = me.$all.length;
    for (const r of me.$all) { r.unjoin(me); }
    me.$all = [];
    me.$view = [];
    me.$idMap = new Map();
    if (!silent) {
      me.fireEvent('clear', me, []);
      if (had) { me.fireEvent('datachanged', me); me.fireEvent('refresh', me); } else { me.fireEvent('datachanged', me); }
    }
    return [];
  },

  // ---------------------------------------------------------------- record notifications
  afterEdit: function (record: any, modifiedFieldNames: string[]) {
    const me = this;
    // Ext collections keep sorted / filtered order in step with edits
    if (!me.remoteFilter && me.$filters.getCount()) {
      const inView = me.$view.indexOf(record) >= 0;
      const passes = me.$filters.getFilterFn()(record);
      if (inView !== passes) { me.$applyFilter(); me.fireEvent('update', me, record, 'edit', modifiedFieldNames); me.$fireRefresh(); return; }
    }
    const sortProps = me.$sorters.items.map((s: any) => s.property).concat(me.$grouper ? [me.$grouper.property] : []);
    if (!me.remoteSort && modifiedFieldNames && modifiedFieldNames.some((n) => sortProps.indexOf(n) >= 0)) {
      const before = me.$view.slice();
      me.$recompute();
      if (before.some((r: any, i: number) => r !== me.$view[i])) {
        me.fireEvent('update', me, record, 'edit', modifiedFieldNames);
        me.$fireRefresh();
        return;
      }
    }
    me.fireEvent('update', me, record, 'edit', modifiedFieldNames, {});
    if (me.autoSync && !me.$syncing) { me.sync(); }
  },
  afterCommit: function (record: any, modifiedFieldNames: string[]) { this.fireEvent('update', this, record, 'commit', modifiedFieldNames); },
  afterReject: function (record: any, modifiedFieldNames?: string[]) { this.fireEvent('update', this, record, 'reject', modifiedFieldNames || null); },
  afterDrop: function (record: any) { this.remove(record); },
  afterErase: function (record: any) { Ext.Array.remove(this.removed, record); if (this.$all.indexOf(record) >= 0) { this.remove(record); Ext.Array.remove(this.removed, record); } },
  onIdChanged: function () { this.$reindex(); },

  // ---------------------------------------------------------------- sorting
  getSorters: function () { return this.$sorters; },
  setSorters: function (s: any) { this.$sorters.$silent = true; this.$sorters.removeAll(); this.$sorters.add(Ext.Array.from(s)); this.$sorters.$silent = false; this.$onSortersChanged(); },
  isSorted: function () { return this.$sorters.getCount() > 0; },
  sort: function (field?: any, direction?: string, mode?: string) {
    const me = this;
    if (field === undefined) { me.$onSortersChanged(); return me; }
    const coll = me.$sorters;
    coll.$silent = true;
    if (typeof field === 'string') {
      const existing = coll.items.find((s: any) => s.property === field);
      if (!direction && existing) { existing.toggle(); }
      const dir = direction || (existing ? existing.direction : 'ASC');
      if (mode === 'append' || mode === 'multi') {
        if (existing) { existing.setDirection(dir); } else { coll.add({ property: field, direction: dir }); }
      } else if (mode === 'prepend') {
        if (existing) { coll.remove(existing); }
        coll.insert(0, { property: field, direction: dir });
      } else {
        coll.removeAll();
        coll.add({ property: field, direction: dir });
      }
    } else if (typeof field === 'function') {
      coll.removeAll(); coll.add({ sorterFn: field, direction: direction || 'ASC' });
    } else {
      coll.removeAll(); coll.add(Ext.Array.from(field).map((s: any) => (typeof s === 'string' ? { property: s } : s)));
    }
    coll.$silent = false;
    me.$onSortersChanged();
    return me;
  },
  $onSortersChanged: function () {
    const me = this;
    if (me.remoteSort) { if (me.loadCount || me.loading) { me.load(); } me.fireEvent('sort', me, me.$sorters.items); return; }
    me.$recompute();
    me.fireEvent('sort', me, me.$sorters.items);
    me.$fireRefresh();
  },

  // ---------------------------------------------------------------- filtering
  getFilters: function () { return this.$filters; },
  setFilters: function (f: any) { this.$filters.$silent = true; this.$filters.removeAll(); this.$filters.add(Ext.Array.from(f)); this.$filters.$silent = false; this.$onFiltersChanged(); },
  isFiltered: function () { return this.$filters.items.some((f: any) => !f.disabled); },
  addFilter: function (filters: any, suppressEvent?: boolean) {
    const me = this;
    me.$suppressFilterEvent = !!suppressEvent;
    me.$filters.add(Ext.Array.from(filters));
    me.$suppressFilterEvent = false;
    return me.$filters;
  },
  removeFilter: function (filter: any, suppressEvent?: boolean) {
    const me = this;
    const f = typeof filter === 'string' ? me.$filters.get(filter) : filter;
    if (!f) { return; }
    me.$suppressFilterEvent = !!suppressEvent;
    me.$filters.remove(f);
    me.$suppressFilterEvent = false;
  },
  clearFilter: function (suppressEvent?: boolean) {
    const me = this;
    if (!me.$filters.getCount()) { return; }
    me.$suppressFilterEvent = !!suppressEvent;
    me.$filters.removeAll();
    me.$suppressFilterEvent = false;
  },
  filter: function (filters: any, value?: any, suppressEvent?: boolean) {
    if (filters === undefined) { this.$onFiltersChanged(); return; }
    if (typeof filters === 'string') { filters = { property: filters, value }; }
    if (typeof filters === 'function') { filters = { filterFn: filters }; }
    this.addFilter(filters, suppressEvent);
  },
  filterBy: function (fn: any, scope?: any) {
    const me = this;
    me.$filters.$silent = true;
    const old = me.$filters.get('$filterBy');
    if (old) { me.$filters.remove(old); }
    me.$filters.add({ id: '$filterBy', filterFn: fn, scope });
    me.$filters.$silent = false;
    me.$onFiltersChanged();
  },
  $onFiltersChanged: function () {
    const me = this;
    if (me.remoteFilter) {
      me.currentPage = 1;
      if (me.loadCount || me.loading) { me.load(); }
      if (!me.$suppressFilterEvent) { me.fireEvent('filterchange', me, me.$filters.items); }
      return;
    }
    me.$applyFilter();
    if (!me.$suppressFilterEvent) { me.fireEvent('filterchange', me, me.$filters.items); }
    me.$fireRefresh();
  },

  // ---------------------------------------------------------------- grouping
  group: function (groupers: any, direction?: string) {
    const me = this;
    if (!groupers) { return me.clearGrouping(); }
    const cfg = typeof groupers === 'string' ? { property: groupers, direction: direction || 'ASC' } : (Ext.isArray(groupers) ? groupers[0] : groupers);
    me.$grouper = cfg && cfg.isGrouper ? cfg : new Grouper(typeof cfg === 'string' ? { property: cfg, direction: direction || 'ASC' } : cfg);
    me.groupField = me.$grouper.property;
    if (me.remoteGroup) { me.load(); } else { me.$recompute(); }
    me.fireEvent('groupchange', me, me.$grouper);
    if (!me.remoteGroup) { me.$fireRefresh(); }
    return me;
  },
  setGroupField: function (f: string) { return f ? this.group(f) : this.clearGrouping(); },
  setGrouper: function (g: any) { return g ? this.group(g) : this.clearGrouping(); },
  clearGrouping: function () {
    const me = this;
    if (!me.$grouper) { return me; }
    me.$grouper = null;
    me.groupField = null;
    me.$recompute();
    me.fireEvent('groupchange', me, null);
    me.$fireRefresh();
    return me;
  },
  isGrouped: function () { return !!this.$grouper; },
  getGrouper: function () { return this.$grouper || null; },
  getGroupField: function () { return this.$grouper ? this.$grouper.property : ''; },
  getGroupString: function (record: any) { return this.$grouper ? this.$grouper.getGroupString(record) : ''; },
  getGroups: function () {
    const me = this;
    const groups: any[] = [];
    if (!me.$grouper) { return new DataView(groups); }
    const map = new Map();
    for (const r of me.$view) {
      const key = me.$grouper.getGroupString(r);
      const k = Ext.isDate(key) ? key.getTime() : key;
      let g = map.get(k);
      if (!g) {
        g = { isGroup: true, $key: key, items: [], getGroupKey() { return this.$key; }, getCount() { return this.items.length; }, getRange() { return this.items.slice(); }, first() { return this.items[0]; }, last() { return this.items[this.items.length - 1]; }, getAt(i: number) { return this.items[i]; }, indexOf(x: any) { return this.items.indexOf(x); }, each(fn: any, s?: any) { this.items.forEach(fn, s); } };
        map.set(k, g);
        groups.push(g);
      }
      g.items.push(r);
    }
    const view: any = new DataView(groups);
    view.getByKey = (key: any) => map.get(Ext.isDate(key) ? key.getTime() : key);
    view.get = view.getByKey;
    return view;
  },

  // ---------------------------------------------------------------- sync / changes
  getNewRecords: function () { return this.$all.filter((r: any) => r.phantom && r.isValid()); },
  getUpdatedRecords: function () { return this.$all.filter((r: any) => !r.phantom && r.dirty && r.isValid()); },
  getModifiedRecords: function () { return this.getNewRecords().concat(this.getUpdatedRecords()); },
  getRemovedRecords: function () { return this.removed.slice(); },
  needsSync: function () { return !!(this.getModifiedRecords().length || this.removed.length); },
  sync: function (options?: any) {
    const me = this;
    options = Ext.apply({}, options);
    const ops: any = {};
    const create = me.getNewRecords(), update = me.getUpdatedRecords(), destroy = me.removed.slice();
    if (create.length) { ops.create = create; }
    if (update.length) { ops.update = update; }
    if (destroy.length) { ops.destroy = destroy; }
    if (!create.length && !update.length && !destroy.length) {
      if (options.callback) { Ext.callback(options.callback, options.scope, [null, options]); }
      return null;
    }
    if (me.fireEvent('beforesync', ops) === false) { return null; }
    me.$syncing = true;
    const batch = me.getProxy().batch({
      operations: ops,
      listeners: {
        operationcomplete: function (b: any, op: any) {
          if (op.wasSuccessful() && op.action === 'destroy') {
            for (const r of op.getRecords()) { Ext.Array.remove(me.removed, r); r.erased = true; }
          }
          if (op.wasSuccessful()) { me.fireEvent('write', me, op); }
        },
        complete: function (b: any) {
          me.$syncing = false;
          if (b.hasException()) { Ext.callback(options.failure, options.scope, [b, options]); } else { Ext.callback(options.success, options.scope, [b, options]); }
          Ext.callback(options.callback, options.scope, [b, options]);
          me.fireEvent('datachanged', me);
        }
      }
    });
    return batch;
  },
  rejectChanges: function () {
    const me = this;
    for (const r of me.$all.slice()) {
      if (r.phantom) { Ext.Array.remove(me.$all, r); r.unjoin(me); }
      else if (r.dirty) { r.reject(); }
    }
    for (const r of me.removed) { r.dropped = false; r.join(me); me.$all.push(r); }
    me.removed = [];
    me.$reindex();
    me.$recompute();
    me.$fireRefresh();
  },
  commitChanges: function () {
    for (const r of this.$all) { if (r.dirty || r.phantom) { r.commit(); } }
    this.removed = [];
  },

  beginUpdate: function () { this.$updating = (this.$updating || 0) + 1; if (this.$updating === 1) { this.fireEvent('beginupdate'); } },
  endUpdate: function () { if (this.$updating) { this.$updating--; if (!this.$updating) { this.fireEvent('endupdate'); } } },

  destroy: function () {
    const me = this;
    if (me.destroyed) { return; }
    me.fireEvent('destroy', me);
    for (const r of me.$all) { r.unjoin(me); }
    me.$all = []; me.$view = [];
    if (me.storeId) { StoreManager.unregister(me); }
    me.destroyObservable();
    me.callParent();
  }
});
define('Ext.data.AbstractStore', { extend: 'Ext.data.Store' });
define('Ext.data.ProxyStore', { extend: 'Ext.data.Store' });
define('Ext.data.JsonStore', { extend: 'Ext.data.Store', alias: 'store.json', constructor: function (c?: any) { c = Ext.apply({}, c); if (c.proxy && typeof c.proxy === 'object' && !c.proxy.isProxy) { c.proxy = Ext.apply({ reader: { type: 'json' } }, c.proxy); } return this.callParent([c]); } });
define('Ext.data.ArrayStore', {
  extend: 'Ext.data.Store',
  alias: 'store.array',
  constructor: function (config?: any) {
    config = Ext.apply({}, config);
    if (!config.proxy) { config.proxy = { type: 'memory', reader: { type: 'array' } }; }
    return this.callParent([config]);
  },
  loadData: function (data: any, append?: boolean) {
    const reader = this.getProxy().getReader();
    const records = reader.read(Ext.Array.from(data)).getRecords();
    this.loadRecords(records, { addRecords: append });
    this.loadCount = Math.max(this.loadCount, 1);
  }
});
define('Ext.data.BufferedStore', { extend: 'Ext.data.Store', alias: 'store.buffered' });
define('Ext.data.TreeStore', { extend: 'Ext.data.Store', alias: 'store.tree' });

// ---------------------------------------------------------------- ChainedStore
export const ChainedStore: any = define('Ext.data.ChainedStore', {
  extend: 'Ext.data.Store',
  alias: 'store.chained',
  isChainedStore: true,
  constructor: function (config?: any) {
    const me = this;
    config = Ext.apply({}, config);
    let source = config.source;
    delete config.source;
    if (typeof source === 'string') { source = StoreManager.lookup(source); }
    me.$source = source;
    config.model = source ? source.getModel() : config.model;
    config.proxy = { type: 'memory' };
    me.callParent([config]);
    me.$bindSource(source);
    return me;
  },
  $bindSource: function (source: any) {
    const me = this;
    Ext.destroy(me.$sourceListeners);
    me.$source = source;
    if (!source) { return; }
    me.$sourceListeners = source.on({
      refresh: me.$onSourceRefresh, datachanged: me.$onSourceRefresh, add: me.$onSourceRefresh, remove: me.$onSourceRefresh, clear: me.$onSourceRefresh,
      update: me.$onSourceUpdate, load: me.$onSourceLoad, scope: me, destroyable: true
    });
    me.$pull();
  },
  $pull: function () {
    const me = this;
    me.$all = me.$source ? me.$source.$view.slice() : [];
    me.$reindex();
    me.$recompute();
  },
  $onSourceRefresh: function () {
    this.$pull();
    this.$fireRefresh();
  },
  $onSourceUpdate: function (store: any, record: any, operation: any, names: any) {
    const me = this;
    if (me.$all.indexOf(record) < 0) { return; }
    const before = me.$view.length;
    me.$recompute();
    if (me.$view.length !== before) { me.$fireRefresh(); }
    me.fireEvent('update', me, record, operation, names);
  },
  $onSourceLoad: function (store: any, records: any, success: boolean, op: any) {
    this.$pull();
    this.$fireRefresh();
    this.fireEvent('load', this, this.$view, success, op);
  },
  getSource: function () { return this.$source; },
  setSource: function (s: any) { this.$bindSource(typeof s === 'string' ? StoreManager.lookup(s) : s); this.$fireRefresh(); },
  isLoaded: function () { return this.$source ? this.$source.isLoaded() : false; },
  isLoading: function () { return this.$source ? this.$source.isLoading() : false; },
  load: function (options?: any) { if (this.$source) { this.$source.load(options); } return this; },
  getProxy: function () { return this.$source ? this.$source.getProxy() : this.$proxy; },
  add: function (...args: any[]) { return this.$source ? this.$source.add(...args) : []; },
  insert: function (i: number, r: any) { return this.$source ? this.$source.insert(i, r) : []; },
  remove: function (r: any) { return this.$source ? this.$source.remove(r) : []; },
  removeAll: function () { return this.$source ? this.$source.removeAll() : []; },
  destroy: function () { Ext.destroy(this.$sourceListeners); this.$all = []; this.callParent(); }
});

// ---------------------------------------------------------------- StoreManager
const stores = new Map<string, any>();
export const StoreManager: any = {
  register(store: any) { if (store.storeId) { stores.set(store.storeId, store); } },
  unregister(store: any) { if (typeof store === 'string') { stores.delete(store); } else if (store && store.storeId && stores.get(store.storeId) === store) { stores.delete(store.storeId); } },
  lookup(store: any, defaultType?: string) {
    if (!store) { return null; }
    if (store.isStore) { return store; }
    if (typeof store === 'string') { return stores.get(store) || null; }
    if (Ext.isArray(store)) {
      const first = store[0];
      const fields = Ext.isArray(first) ? first.map((_v: any, i: number) => 'field' + (i + 1)) : ['field1'];
      const data = store.map((v: any) => (Ext.isArray(v) ? v : [v]));
      return new (Ext.ClassManager.get('Ext.data.ArrayStore'))({ data, fields, autoDestroy: true, $fromArray: true });
    }
    return Ext.Factory.store(store, defaultType || 'store');
  },
  getCount() { return stores.size; },
  each(fn: any) { stores.forEach((s) => fn(s)); },
  get(id: string) { return stores.get(id); }
};
Ext.data.StoreManager = Ext.StoreManager = Ext.StoreMgr = StoreManager;
Ext.getStore = (id: any) => StoreManager.lookup(id);

// The empty store grids use when none is configured
define('Ext.data.EmptyStore', { extend: 'Ext.data.Store', alias: 'store.empty', isEmptyStore: true, add: function () { return []; } });

export default Store;
