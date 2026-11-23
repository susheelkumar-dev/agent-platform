/**
 * Ext.data.Connection and the Ext.Ajax singleton over XMLHttpRequest, with Ext's options (url, method, params,
 * jsonData, rawData, headers, timeout, disableCaching, success/failure/callback/scope), the beforerequest /
 * requestcomplete / requestexception events and Ext-style response objects (responseText and responseJson).
 */
import { Ext } from '../core/ext';
import { define } from '../core/class';
import '../core/observable';

let requestId = 0;

function buildResponse(xhr: XMLHttpRequest | null, request: any, extra?: any) {
  const text = xhr ? xhr.responseText : '';
  let json;
  const ct = xhr && xhr.getResponseHeader ? (xhr.getResponseHeader('Content-Type') || '') : '';
  if (text && (ct.indexOf('json') >= 0 || /^\s*[{[]/.test(text))) {
    try { json = JSON.parse(text); } catch (e) { json = undefined; }
  }
  return Ext.apply({
    request,
    requestId: request.id,
    status: xhr ? xhr.status : 0,
    statusText: xhr ? xhr.statusText : '',
    responseText: text,
    responseJson: json,
    responseXML: xhr ? (xhr as any).responseXML : null,
    responseType: xhr ? xhr.responseType : '',
    getResponseHeader: (name: string) => (xhr ? xhr.getResponseHeader(name) : null),
    getAllResponseHeaders: () => {
      const out = {};
      if (!xhr) { return out; }
      for (const line of xhr.getAllResponseHeaders().split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i > 0) { out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
      }
      return out;
    }
  }, extra);
}

export const Connection: any = define('Ext.data.Connection', {
  mixins: { observable: 'Ext.mixin.Observable' },
  isConnection: true,
  timeout: 30000,
  disableCaching: true,
  disableCachingParam: '_dc',
  useDefaultXhrHeader: true,
  defaultXhrHeader: 'XMLHttpRequest',
  defaultHeaders: null,
  extraParams: null,
  withCredentials: false,
  autoAbort: false,
  method: null,

  constructor: function (config?: any) {
    this.mixins.observable.constructor.call(this, config);
    this.requests = {};
    return this;
  },

  setTimeout: function (t: number) { this.timeout = t; },
  getTimeout: function () { return this.timeout; },
  setDefaultHeaders: function (h: any) { this.defaultHeaders = h; },
  getDefaultHeaders: function () { return this.defaultHeaders; },
  setExtraParams: function (p: any) { this.extraParams = p; },
  getExtraParams: function () { return this.extraParams; },
  setUseDefaultXhrHeader: function (v: boolean) { this.useDefaultXhrHeader = v; },
  setDisableCaching: function (v: boolean) { this.disableCaching = v; },
  setWithCredentials: function (v: boolean) { this.withCredentials = v; },
  setMethod: function (m: string) { this.method = m; },

  request: function (options: any) {
    const me = this;
    options = options || {};
    const request: any = { id: ++requestId, options, aborted: false, timedout: false };
    if (me.fireEvent('beforerequest', me, options) === false) {
      const resp = buildResponse(null, request, { status: -1, statusText: 'cancelled', aborted: true });
      me.$finish(options, false, resp);
      return me.$thenable(Promise.reject(resp), request);
    }
    let url = typeof options.url === 'function' ? options.url.call(options.scope || window, options) : (options.url || me.url);
    let params = options.params;
    if (typeof params === 'function') { params = params.call(options.scope || window, options); }
    const extra = Ext.apply({}, me.extraParams, options.extraParams);
    let paramObj = Ext.apply({}, typeof params === 'object' && params ? params : {}, extra);
    let paramStr = typeof params === 'string' ? params : '';
    const jsonData = options.jsonData;
    const rawData = options.rawData || options.xmlData;
    let method = (options.method || me.method || (jsonData !== undefined || rawData !== undefined || paramStr || Object.keys(paramObj).length ? 'POST' : 'GET')).toUpperCase();
    const disableCaching = options.disableCaching !== undefined ? options.disableCaching : me.disableCaching;
    if (method === 'GET' && disableCaching) { paramObj[options.disableCachingParam || me.disableCachingParam] = Date.now(); }
    let qs = Ext.Object.toQueryString(paramObj);
    if (paramStr) { qs = qs ? qs + '&' + paramStr : paramStr; }
    let body: any = null;
    const headers = Ext.apply({}, me.defaultHeaders, options.headers);
    if (jsonData !== undefined) {
      body = typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData);
      if (!hasHeader(headers, 'Content-Type')) { headers['Content-Type'] = 'application/json'; }
      if (qs) { url = Ext.String.urlAppend(url, qs); }
    } else if (rawData !== undefined) {
      body = rawData;
      if (!hasHeader(headers, 'Content-Type')) { headers['Content-Type'] = 'text/plain'; }
      if (qs) { url = Ext.String.urlAppend(url, qs); }
    } else if (method === 'GET' || method === 'DELETE' || method === 'HEAD') {
      if (qs) { url = Ext.String.urlAppend(url, qs); }
    } else {
      body = qs;
      if (!hasHeader(headers, 'Content-Type')) { headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; }
    }
    if (me.useDefaultXhrHeader && !hasHeader(headers, 'X-Requested-With')) { headers['X-Requested-With'] = me.defaultXhrHeader; }
    const xhr = new XMLHttpRequest();
    request.xhr = xhr;
    xhr.open(method, url, options.async !== false);
    for (const k in headers) { if (headers[k] !== undefined && headers[k] !== null) { xhr.setRequestHeader(k, headers[k]); } }
    if (options.withCredentials || me.withCredentials) { xhr.withCredentials = true; }
    if (options.binary || options.responseType) { xhr.responseType = options.responseType || 'arraybuffer'; }
    const timeout = options.timeout !== undefined ? options.timeout : me.timeout;
    let timer = null;
    let resolveP: any, rejectP: any;
    const promise = new Promise((res, rej) => { resolveP = res; rejectP = rej; });
    const done = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      delete me.requests[request.id];
      const status = xhr.status;
      const success = (status >= 200 && status < 300) || status === 304;
      const resp = buildResponse(xhr, request, { timedout: request.timedout, aborted: request.aborted });
      if (request.timedout) { resp.status = 0; resp.statusText = 'communication failure'; }
      me.$finish(options, success && !request.timedout && !request.aborted, resp);
      if (success && !request.timedout) { resolveP(resp); } else { rejectP(resp); }
    };
    xhr.onreadystatechange = () => { if (xhr.readyState === 4) { done(); } };
    if (timeout) {
      timer = setTimeout(() => { request.timedout = true; xhr.abort(); }, timeout);
    }
    me.requests[request.id] = request;
    xhr.send(body);
    return me.$thenable(promise, request);
  },

  $thenable: function (promise: Promise<any>, request: any) {
    const me = this;
    promise.catch(Ext.emptyFn);
    return Ext.apply(request, {
      then: (a: any, b: any) => promise.then(a, b),
      otherwise: (b: any) => promise.then(undefined, b),
      abort: () => me.abort(request)
    });
  },

  $finish: function (options: any, success: boolean, response: any) {
    const me = this;
    const scope = options.scope;
    if (success) {
      me.fireEvent('requestcomplete', me, response, options);
      if (options.success) { Ext.callback(options.success, scope, [response, options]); }
    } else {
      me.fireEvent('requestexception', me, response, options);
      if (options.failure) { Ext.callback(options.failure, scope, [response, options]); }
    }
    if (options.callback) { Ext.callback(options.callback, scope, [options, success, response]); }
  },

  abort: function (request?: any) {
    const reqs = request ? [request] : Object.values(this.requests);
    for (const r of reqs as any[]) { if (r && r.xhr) { r.aborted = true; r.xhr.abort(); } }
  },
  abortAll: function () { this.abort(); },
  isLoading: function (request?: any) { return request ? !!this.requests[request.id] : Object.keys(this.requests).length > 0; }
});

function hasHeader(headers: any, name: string) {
  const n = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === n);
}

Ext.Ajax = new Connection();
Ext.ClassManager.classes['Ext.Ajax'] = Ext.Ajax;
Ext.data.request = Ext.data.request || {};

export default Connection;
