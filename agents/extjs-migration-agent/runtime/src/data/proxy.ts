/**
 * Ext.data.Request, Operation, ResultSet, Batch, JSON reader/writer and the proxy family (Server, Ajax, Rest,
 * Memory). Method names and call order match Ext 7 (buildRequest -> buildUrl -> getUrl, doRequest,
 * processResponse -> reader.read -> operation.process, setException -> operation.setException), so proxies
 * that override those template methods keep working.
 */
import { Ext } from '../core/ext';
import { define } from '../core/class';
import '../core/observable';
import './connection';
import './model';

// ---------------------------------------------------------------- ResultSet
export class ResultSet {
  [k: string]: any;
  isResultSet = true;
  constructor(cfg: any) { Object.assign(this, { records: [], total: 0, count: 0, success: true, message: null, loaded: true }, cfg); if (!cfg.count) { this.count = this.records.length; } }
  getRecords() { return this.records; }
  getTotal() { return this.total; }
  getCount() { return this.count; }
  getSuccess() { return this.success; }
  getMessage() { return this.message; }
  getLoaded() { return this.loaded; }
  getMetadata() { return this.metadata; }
}
Ext.data.ResultSet = ResultSet;

// ---------------------------------------------------------------- Request
export const Request: any = define('Ext.data.Request', {
  isRequest: true,
  constructor: function (config?: any) {
    this.action = null; this.params = null; this.method = 'GET'; this.url = null; this.operation = null; this.proxy = null;
    this.records = null; this.jsonData = undefined; this.headers = null; this.timeout = undefined; this.callback = null; this.scope = null;
    Ext.apply(this, config);
    return this;
  },
  getAction: function () { return this.action; },
  setAction: function (v: any) { this.action = v; },
  getParams: function () { return this.params; },
  setParams: function (v: any) { this.params = v; },
  getUrl: function () { return this.url; },
  setUrl: function (v: any) { this.url = v; },
  getMethod: function () { return this.method; },
  setMethod: function (v: any) { this.method = v; },
  getOperation: function () { return this.operation; },
  getProxy: function () { return this.proxy; },
  getRecords: function () { return this.records; },
  setRecords: function (v: any) { this.records = v; },
  getJsonData: function () { return this.jsonData; },
  setJsonData: function (v: any) { this.jsonData = v; },
  getHeaders: function () { return this.headers; },
  setHeaders: function (v: any) { this.headers = v; },
  getTimeout: function () { return this.timeout; },
  setTimeout: function (v: any) { this.timeout = v; },
  getCallback: function () { return this.callback; },
  setCallback: function (v: any) { this.callback = v; },
  getScope: function () { return this.scope; },
  setScope: function (v: any) { this.scope = v; },
  setConfig: function (cfg: any) { Ext.apply(this, cfg); return this; },
  getRawRequest: function () { return this.rawRequest; },
  getCurrentConfig: function () {
    return { url: this.url, method: this.method, params: this.params, jsonData: this.jsonData, headers: this.headers, timeout: this.timeout,
      callback: this.callback, scope: this.scope, disableCaching: false, withCredentials: this.withCredentials, binary: this.binary };
  }
});

// ---------------------------------------------------------------- Operation
export const Operation: any = define('Ext.data.operation.Operation', {
  isOperation: true,
  action: null,
  started: false,
  running: false,
  complete: false,
  success: undefined,
  exception: false,
  error: undefined,

  constructor: function (config?: any) {
    this.records = null; this.params = null; this.id = undefined;
    Ext.apply(this, config);
    if (this.records && !Ext.isArray(this.records)) { this.records = [this.records]; }
    return this;
  },
  getAction: function () { return this.action; },
  getRecords: function () { return this.records || (this.resultSet ? this.resultSet.records : null); },
  setRecords: function (r: any) { this.records = r; },
  getResultSet: function () { return this.resultSet; },
  setResultSet: function (rs: any) { this.resultSet = rs; },
  getResponse: function () { return this.response; },
  setResponse: function (r: any) { this.response = r; },
  getRequest: function () { return this.request; },
  setRequest: function (r: any) { this.request = r; },
  getError: function () { return this.error; },
  getParams: function () { return this.params; },
  setParams: function (p: any) { this.params = p; },
  getId: function () { return this.id; },
  getProxy: function () { return this.proxy; },
  getCallback: function () { return this.callback; },
  setCallback: function (c: any) { this.callback = c; },
  getScope: function () { return this.scope; },
  getFilters: function () { return this.filters; },
  getSorters: function () { return this.sorters; },
  getGrouper: function () { return this.grouper; },
  getPage: function () { return this.page; },
  getStart: function () { return this.start; },
  getLimit: function () { return this.limit; },
  getAddRecords: function () { return !!this.addRecords; },
  getRecordCreator: function () { return this.recordCreator; },
  getUrl: function () { return this.url; },
  setInternalCallback: function (fn: any) { this.internalCallback = fn; },
  setInternalScope: function (s: any) { this.internalScope = s; },
  hasException: function () { return !!this.exception; },
  wasSuccessful: function () { return this.isComplete() && this.success === true; },
  isComplete: function () { return !!this.complete; },
  isRunning: function () { return !!this.running; },
  isStarted: function () { return !!this.started; },
  allowWrite: function () { return this.action === 'create' || this.action === 'update'; },
  isReadOperation: function () { return this.action === 'read'; },
  isCreateOperation: function () { return this.action === 'create'; },
  isUpdateOperation: function () { return this.action === 'update'; },
  isDestroyOperation: function () { return this.action === 'destroy'; },

  execute: function () {
    const me = this;
    me.started = true;
    me.running = true;
    const proxy = me.proxy;
    const fn = me.action === 'destroy' ? 'erase' : me.action;
    me.request = proxy[fn](me);
    return me.request;
  },

  process: function (resultSet: any, request: any, response: any) {
    const me = this;
    me.request = request || me.request;
    me.response = response;
    me.resultSet = resultSet;
    if (resultSet && resultSet.getSuccess() === false) {
      me.setException(resultSet.getMessage());
      return;
    }
    if (me.action === 'read') {
      me.records = resultSet ? resultSet.getRecords() : [];
    } else if (me.action === 'create' || me.action === 'update') {
      const clientRecords = me.records || [];
      const serverRecords = resultSet ? resultSet.getRecords() : [];
      clientRecords.forEach((rec: any, i: number) => {
        const s = serverRecords[i];
        if (s) {
          const raw = s.isModel ? s.$raw || s.data : s;
          const data = {};
          for (const k in raw) { if (k in rec.fieldsMap || k === rec.idProperty) { data[k] = raw[k]; } }
          rec.set(data, { dirty: false, silent: true });
        }
        rec.commit();
      });
    } else if (me.action === 'destroy') {
      for (const rec of me.records || []) { rec.erased = true; }
    }
    me.setSuccessful(true);
  },

  setException: function (error: any) {
    const me = this;
    me.exception = true;
    me.success = false;
    me.running = false;
    me.complete = true;
    me.error = error;
    me.triggerCallbacks();
  },

  setSuccessful: function (complete?: boolean) {
    const me = this;
    me.success = true;
    if (complete !== false) {
      me.complete = true;
      me.running = false;
      me.triggerCallbacks();
    }
  },
  setCompleted: function () { this.complete = true; this.running = false; },
  setStarted: function () { this.started = true; this.running = true; },

  triggerCallbacks: function () {
    const me = this;
    if (me.$callbacksDone) { return; }
    me.$callbacksDone = true;
    if (me.internalCallback) { me.internalCallback.call(me.internalScope || me, me); }
    if (me.callback) { Ext.callback(me.callback, me.scope, [me.getRecords(), me, me.wasSuccessful()]); }
  },
  abort: function () { if (this.request && this.request.xhr) { this.request.xhr.abort(); } }
});
for (const a of ['Read', 'Create', 'Update', 'Destroy']) {
  define('Ext.data.operation.' + a, { extend: 'Ext.data.operation.Operation', action: a.toLowerCase() });
}

// ---------------------------------------------------------------- readers
function getPath(obj: any, path: string) {
  if (!path) { return obj; }
  if (obj && path in obj) { return obj[path]; }
  return path.split('.').reduce((o: any, k: string) => (o === null || o === undefined ? undefined : o[k]), obj);
}

export const JsonReader: any = define('Ext.data.reader.Json', {
  alias: 'reader.json',
  isReader: true,
  rootProperty: '',
  totalProperty: 'total',
  successProperty: 'success',
  messageProperty: 'message',
  keepRawData: false,
  model: null,
  constructor: function (config?: any) {
    Ext.apply(this, config);
    if (config && config.root && !config.rootProperty) { this.rootProperty = config.root; }
    return this;
  },
  setModel: function (m: any) { this.model = typeof m === 'string' ? Ext.ClassManager.get(m) : m; },
  getModel: function () { return this.model; },
  getRootProperty: function () { return this.rootProperty; },
  setRootProperty: function (v: string) { this.rootProperty = v; },
  getTotalProperty: function () { return this.totalProperty; },
  getSuccessProperty: function () { return this.successProperty; },
  getMessageProperty: function () { return this.messageProperty; },
  getResponseData: function (response: any) {
    if (!response) { return null; }
    if (response.responseJson !== undefined) { return response.responseJson; }
    if (typeof response.responseText === 'string') {
      try { return response.responseText ? JSON.parse(response.responseText) : null; } catch (e) { return { $error: 'Unable to parse the JSON returned by the server' }; }
    }
    return response;
  },
  getNullResultSet: function () { return new ResultSet({ total: 0, count: 0, records: [], success: true }); },
  read: function (response: any, readOptions?: any) {
    let data = response;
    if (response && (response.responseText !== undefined || response.responseJson !== undefined || response.getResponseHeader)) {
      data = this.getResponseData(response);
    }
    if (data && data.$error) { return new ResultSet({ success: false, message: data.$error, records: [] }); }
    if (this.transform) { data = typeof this.transform === 'function' ? this.transform(data) : this.transform.fn.call(this.transform.scope, data); }
    return this.readRecords(data, readOptions);
  },
  readRecords: function (data: any, readOptions?: any) {
    const me = this;
    if (data === null || data === undefined) { return me.getNullResultSet(); }
    let root = Ext.isArray(data) ? data : getPath(data, me.rootProperty);
    let success = true, message = null, total;
    if (!Ext.isArray(data) && data && typeof data === 'object') {
      if (me.successProperty && me.successProperty in data) { success = data[me.successProperty] !== false && data[me.successProperty] !== 'false'; }
      if (me.messageProperty) { message = getPath(data, me.messageProperty); }
      if (me.totalProperty) { const t = getPath(data, me.totalProperty); if (t !== undefined) { total = Number(t); } }
    }
    if (root === undefined || root === null) { root = me.rootProperty ? [] : (Ext.isArray(data) ? data : [data]); }
    if (!Ext.isArray(root)) { root = [root]; }
    const creator = readOptions && readOptions.recordCreator;
    const Model = me.model;
    const records = root.map((raw: any) => {
      if (creator) { return creator(raw, Model); }
      if (!Model) { return raw; }
      const rec = new Model(raw);
      rec.phantom = false;
      rec.$raw = raw;
      return rec;
    });
    return new ResultSet({ records, total: total === undefined ? records.length : total, count: records.length, success, message, metadata: data && data.metaData });
  }
});
define('Ext.data.reader.Reader', { extend: 'Ext.data.reader.Json', alias: 'reader.base' });
define('Ext.data.reader.Array', {
  extend: 'Ext.data.reader.Json',
  alias: 'reader.array',
  readRecords: function (data: any, readOptions?: any) {
    const me = this;
    const rows = Ext.isArray(data) ? data : getPath(data, me.rootProperty) || [];
    const Model = me.model;
    const fields = Model ? Model.prototype.fields.filter((f: any) => !f.isCalculated && !f.$auto) : [];
    const objs = rows.map((r: any) => {
      if (!Ext.isArray(r)) { return r; }
      const o = {};
      fields.forEach((f: any, i: number) => { const idx = f.mapping !== undefined && typeof f.mapping === 'number' ? f.mapping : i; o[f.name] = r[idx]; });
      return o;
    });
    return JsonReader.prototype.readRecords.call(me, objs, readOptions);
  }
});

// ---------------------------------------------------------------- writers
export const JsonWriter: any = define('Ext.data.writer.Json', {
  alias: 'writer.json',
  isWriter: true,
  writeAllFields: false,
  writeRecordId: true,
  allowSingle: true,
  rootProperty: undefined,
  encode: false,
  expandData: false,
  dateFormat: undefined,
  constructor: function (config?: any) { Ext.apply(this, config); return this; },
  getWriteAllFields: function () { return this.writeAllFields; },
  getWriteRecordId: function () { return this.writeRecordId; },
  getAllowSingle: function () { return this.allowSingle; },
  write: function (request: any) {
    const me = this;
    const operation = request.getOperation();
    const records = request.getRecords() || [];
    const data = records.map((r: any) => me.getRecordData(r, operation));
    return me.writeRecords(request, data);
  },
  getRecordData: function (record: any, operation?: any) {
    const me = this;
    let data: any;
    if (me.writeAllFields || record.phantom) {
      data = record.getData({ persist: true, serialize: true });
    } else {
      data = {};
      const changes = record.getChanges();
      for (const k in changes) {
        const f = record.fieldsMap[k];
        if (f && !f.persist) { continue; }
        data[k] = f ? f.serializeValue(changes[k], record) : changes[k];
      }
      for (const f of record.fields) { if (f.critical) { data[f.name] = f.serializeValue(record.get(f.name), record); } }
      if (me.writeRecordId) { data[record.idProperty] = record.getId(); }
    }
    if (!me.writeRecordId || (record.phantom && me.writeRecordId === false)) { delete data[record.idProperty]; }
    if (me.transform) { data = typeof me.transform === 'function' ? me.transform(data, operation) : me.transform.fn.call(me.transform.scope, data, operation); }
    return data;
  },
  writeRecords: function (request: any, data: any[]) {
    const me = this;
    let out: any = data;
    if (me.allowSingle && data.length === 1) { out = data[0]; }
    if (me.encode) {
      const params = request.getParams() || {};
      params[me.rootProperty || 'data'] = JSON.stringify(out);
      request.setParams(params);
    } else {
      if (me.rootProperty) { out = { [me.rootProperty]: out }; }
      request.setJsonData(out);
    }
    return request;
  }
});
define('Ext.data.writer.Writer', { extend: 'Ext.data.writer.Json', alias: 'writer.base' });

// ---------------------------------------------------------------- proxies
export const Proxy: any = define('Ext.data.proxy.Proxy', {
  mixins: { observable: 'Ext.mixin.Observable' },
  alias: 'proxy.proxy',
  isProxy: true,
  isSynchronous: false,
  batchActions: true,
  batchOrder: 'create,update,destroy',
  constructor: function (config?: any) {
    const me = this;
    config = Ext.apply({}, config);
    const reader = config.reader !== undefined ? config.reader : me.reader;
    const writer = config.writer !== undefined ? config.writer : me.writer;
    delete config.reader; delete config.writer;
    me.mixins.observable.constructor.call(me, config);
    me.$readerCfg = reader;
    me.$writerCfg = writer;
    if (config.model) { me.setModel(config.model); }
    return me;
  },
  setModel: function (model: any) {
    this.model = typeof model === 'string' ? Ext.ClassManager.get(model) : model;
    if (this.$reader) { this.$reader.setModel(this.model); }
  },
  getModel: function () { return this.model; },
  getReader: function () {
    const me = this;
    if (!me.$reader) {
      let cfg = me.$readerCfg;
      if (typeof cfg === 'string') { cfg = { type: cfg }; }
      me.$reader = cfg && cfg.isReader ? cfg : Ext.Factory.reader(Ext.apply({}, cfg), 'json');
      if (me.model) { me.$reader.setModel(me.model); }
    }
    return me.$reader;
  },
  setReader: function (r: any) { this.$reader = null; this.$readerCfg = r; return this.getReader(); },
  getWriter: function () {
    const me = this;
    if (!me.$writer) {
      let cfg = me.$writerCfg;
      if (typeof cfg === 'string') { cfg = { type: cfg }; }
      me.$writer = cfg && cfg.isWriter ? cfg : Ext.Factory.writer(Ext.apply({}, cfg), 'json');
    }
    return me.$writer;
  },
  setWriter: function (w: any) { this.$writer = null; this.$writerCfg = w; return this.getWriter(); },
  createOperation: function (action: string, config?: any) {
    const cls = Ext.ClassManager.get('Ext.data.operation.' + Ext.String.capitalize(action)) || Operation;
    return new cls(Ext.apply({ action, proxy: this }, config));
  },
  create: function (op: any) { return this.doRequest(op); },
  read: function (op: any) { return this.doRequest(op); },
  update: function (op: any) { return this.doRequest(op); },
  erase: function (op: any) { return this.doRequest(op); },
  doRequest: function () { throw new Error('doRequest not implemented'); },
  batch: function (options: any) {
    const me = this;
    const batch = new Batch({ proxy: me, listeners: options.listeners || {} });
    const ops = options.operations || {};
    for (const action of me.batchOrder.split(',')) {
      const records = ops[action];
      if (!records || !records.length) { continue; }
      if (me.batchActions) {
        batch.add(me.createOperation(action, { records }));
      } else {
        for (const r of records) { batch.add(me.createOperation(action, { records: [r] })); }
      }
    }
    batch.start();
    return batch;
  },
  destroy: function () { this.destroyObservable(); this.callParent(); }
});

export const ServerProxy: any = define('Ext.data.proxy.Server', {
  extend: 'Ext.data.proxy.Proxy',
  alias: 'proxy.server',
  url: '',
  api: null,
  extraParams: null,
  noCache: true,
  cacheString: '_dc',
  timeout: 30000,
  headers: null,
  pageParam: 'page',
  startParam: 'start',
  limitParam: 'limit',
  groupParam: 'group',
  groupDirectionParam: 'groupDir',
  sortParam: 'sort',
  filterParam: 'filter',
  directionParam: 'dir',
  idParam: 'id',
  simpleSortMode: false,
  simpleGroupMode: false,
  constructor: function (config?: any) {
    this.callParent([config]);
    this.extraParams = Ext.apply({}, this.extraParams);
    return this;
  },
  getExtraParams: function () { return this.extraParams; },
  setExtraParams: function (p: any) { this.extraParams = p || {}; },
  setExtraParam: function (name: string, value: any) { this.extraParams[name] = value; },
  getApi: function () { return this.api || {}; },
  setApi: function (a: any) { this.api = a; },
  getNoCache: function () { return this.noCache; },
  getCacheString: function () { return this.cacheString; },
  getTimeout: function () { return this.timeout; },
  getHeaders: function () { return this.headers; },
  setHeaders: function (h: any) { this.headers = h; },
  getIdParam: function () { return this.idParam; },
  setUrl: function (u: string) { this.url = u; },
  getParams: function (operation: any) {
    const me = this;
    if (!operation.isReadOperation()) { return {}; }
    const params: any = {};
    const page = operation.getPage(), start = operation.getStart(), limit = operation.getLimit();
    if (me.pageParam && page !== undefined && page !== null) { params[me.pageParam] = page; }
    if (me.startParam && start !== undefined && start !== null) { params[me.startParam] = start; }
    if (me.limitParam && limit !== undefined && limit !== null) { params[me.limitParam] = limit; }
    const sorters = operation.getSorters(), filters = operation.getFilters(), grouper = operation.getGrouper();
    if (sorters && sorters.length && me.sortParam) {
      if (me.simpleSortMode) { params[me.sortParam] = sorters[0].property; params[me.directionParam] = sorters[0].direction; }
      else { params[me.sortParam] = JSON.stringify(sorters.map((s: any) => s.serialize())); }
    }
    if (filters && filters.length && me.filterParam) { params[me.filterParam] = JSON.stringify(filters.map((f: any) => f.serialize())); }
    if (grouper && me.groupParam) {
      if (me.simpleGroupMode) { params[me.groupParam] = grouper.property; params[me.groupDirectionParam] = grouper.direction; }
      else { params[me.groupParam] = JSON.stringify(grouper.serialize()); }
    }
    return params;
  },
  buildRequest: function (operation: any) {
    const me = this;
    const params = Ext.apply({}, operation.getParams());
    Ext.applyIf(params, me.getExtraParams() || {});
    Ext.applyIf(params, me.getParams(operation));
    const id = operation.getId();
    if (id !== undefined && params[me.idParam] === undefined) { params[me.idParam] = id; }
    const request = new Request({
      params, action: operation.getAction(), records: operation.getRecords(), url: operation.getUrl(), operation, proxy: me
    });
    request.setUrl(me.buildUrl(request));
    operation.setRequest(request);
    return request;
  },
  buildUrl: function (request: any) {
    const me = this;
    let url = me.getUrl(request);
    if (!url) { throw new Error('You are using a ServerProxy but have not supplied it with a url.'); }
    if (me.getNoCache()) { url = Ext.String.urlAppend(url, me.getCacheString() + '=' + Date.now()); }
    return url;
  },
  getUrl: function (request?: any) {
    let url;
    if (request) { url = request.getUrl() || this.getApi()[request.getAction()]; }
    return url ? url : this.url;
  },
  getMethod: function (request: any) {
    const methods = this.getActionMethods();
    return methods[request.getAction()] || 'GET';
  },
  getActionMethods: function () { return this.actionMethods || { create: 'POST', read: 'GET', update: 'POST', destroy: 'POST' }; },
  setActionMethods: function (m: any) { this.actionMethods = m; },
  doRequest: function (operation: any) {
    const me = this;
    const writer = me.getWriter();
    let request = me.buildRequest(operation);
    const method = me.getMethod(request);
    if (writer && operation.allowWrite()) { request = writer.write(request); }
    request.setConfig({
      headers: me.getHeaders(), timeout: me.getTimeout(), method, scope: me,
      callback: me.createRequestCallback(request, operation)
    });
    return me.sendRequest(request);
  },
  sendRequest: function (request: any) {
    request.rawRequest = Ext.Ajax.request(request.getCurrentConfig());
    return request;
  },
  createRequestCallback: function (request: any, operation: any) {
    const me = this;
    return function (options: any, success: boolean, response: any) {
      if (request === me.lastRequest) { me.lastRequest = null; }
      me.processResponse(success, operation, request, response);
    };
  },
  processResponse: function (success: boolean, operation: any, request: any, response: any) {
    const me = this;
    let exception = false;
    me.fireEvent('beginprocessresponse', me, response, operation);
    if (success === true) {
      const reader = me.getReader();
      const resultSet = response.status === 204 ? reader.getNullResultSet() : reader.read(me.extractResponseData(response), { recordCreator: operation.getRecordCreator() });
      operation.process(resultSet, request, response);
      exception = !operation.wasSuccessful();
    } else {
      me.setException(operation, response);
      exception = true;
    }
    if (exception) { me.fireEvent('exception', me, response, operation); }
    me.afterRequest(request, success);
    me.fireEvent('endprocessresponse', me, response, operation);
  },
  setException: function (operation: any, response: any) {
    operation.setException({ status: response.status, statusText: response.statusText, response });
  },
  extractResponseData: function (response: any) { return response; },
  afterRequest: Ext.emptyFn,
  abort: function () { /* in-flight requests complete on their own */ }
});

define('Ext.data.proxy.Ajax', {
  extend: 'Ext.data.proxy.Server',
  alias: 'proxy.ajax',
  actionMethods: { create: 'POST', read: 'GET', update: 'POST', destroy: 'POST' },
  binary: false,
  paramsAsJson: false
});

define('Ext.data.proxy.Rest', {
  extend: 'Ext.data.proxy.Ajax',
  alias: 'proxy.rest',
  appendId: true,
  format: null,
  batchActions: false,
  actionMethods: { create: 'POST', read: 'GET', update: 'PUT', destroy: 'DELETE' },
  slashRe: /\/$/,
  getAppendId: function () { return this.appendId; },
  getFormat: function () { return this.format; },
  isValidId: function (id: any) { return id !== undefined && id !== null && id !== ''; },
  buildUrl: function (request: any) {
    const me = this;
    const operation = request.getOperation();
    const records = operation.getRecords();
    const record = records ? records[0] : null;
    let url = me.getUrl(request);
    let id;
    if (record && !record.phantom) { id = record.getId(); } else { id = operation.getId(); }
    if (me.getAppendId() && me.isValidId(id) && (operation.action !== 'read' || operation.getId() !== undefined || (record && !record.phantom))) {
      if (!url.match(me.slashRe)) { url += '/'; }
      url += encodeURIComponent(id);
      const params = request.getParams();
      if (params) { delete params[me.getIdParam()]; }
    }
    if (me.format) {
      if (!url.match(/\.$/)) { url += '.'; }
      url += me.format;
    }
    request.setUrl(url);
    return me.callParent([request]);
  }
});

define('Ext.data.proxy.Memory', {
  extend: 'Ext.data.proxy.Proxy',
  alias: 'proxy.memory',
  isMemoryProxy: true,
  isSynchronous: true,
  enablePaging: false,
  data: null,
  constructor: function (config?: any) { this.callParent([config]); return this; },
  setData: function (d: any) { this.data = d; },
  getData: function () { return this.data; },
  read: function (operation: any) {
    const me = this;
    const reader = me.getReader();
    const resultSet = reader.read(me.data || [], { recordCreator: operation.getRecordCreator() });
    operation.process(resultSet, null, null);
    return null;
  },
  doRequest: function (operation: any) {
    const me = this;
    if (operation.action === 'read') { return me.read(operation); }
    operation.process(new ResultSet({ records: [], success: true }), null, null);
    return null;
  }
});
define('Ext.data.proxy.Client', { extend: 'Ext.data.proxy.Memory', alias: 'proxy.client' });
define('Ext.data.proxy.LocalStorage', { extend: 'Ext.data.proxy.Memory', alias: 'proxy.localstorage' });
define('Ext.data.proxy.SessionStorage', { extend: 'Ext.data.proxy.Memory', alias: 'proxy.sessionstorage' });

// ---------------------------------------------------------------- Batch
export const Batch: any = define('Ext.data.Batch', {
  mixins: { observable: 'Ext.mixin.Observable' },
  isBatch: true,
  pauseOnException: false,
  constructor: function (config?: any) {
    this.operations = [];
    this.exceptions = [];
    this.current = -1;
    this.complete = false;
    this.running = false;
    this.mixins.observable.constructor.call(this, config);
    return this;
  },
  add: function (op: any) { for (const o of Ext.Array.from(op)) { this.operations.push(o); } return this; },
  getOperations: function () { return this.operations; },
  getExceptions: function () { return this.exceptions; },
  hasException: function () { return this.exceptions.length > 0; },
  isComplete: function () { return this.complete; },
  isRunning: function () { return this.running; },
  getTotal: function () { return this.operations.length; },
  start: function () {
    const me = this;
    me.running = true;
    me.current = -1;
    if (!me.operations.length) { me.$finish(); return me; }
    me.runNext();
    return me;
  },
  runNext: function () {
    const me = this;
    me.current++;
    const op = me.operations[me.current];
    if (!op) { me.$finish(); return; }
    const prev = op.internalCallback;
    op.internalCallback = function (o: any) {
      if (prev) { prev.call(this, o); }
      if (o.hasException()) { me.exceptions.push(o); me.fireEvent('exception', me, o); }
      me.fireEvent('operationcomplete', me, o);
      if (o.hasException() && me.pauseOnException) { me.running = false; return; }
      me.runNext();
    };
    op.execute();
  },
  $finish: function () { this.running = false; this.complete = true; this.fireEvent('complete', this, this.operations[this.operations.length - 1]); },
  retry: function () { this.current--; this.runNext(); },
  pause: function () { this.running = false; }
});

export default Proxy;
