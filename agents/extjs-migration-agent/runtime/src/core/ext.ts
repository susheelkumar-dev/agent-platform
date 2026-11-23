/**
 * The Ext namespace and its language utilities (Ext.apply, Ext.Array, Ext.Object, Ext.String, Ext.Function,
 * Ext.Number, JSON helpers). Behaviour follows the Ext JS 7 classic documentation so migrated code that calls
 * these keeps working unchanged.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const g: any = typeof window !== 'undefined' ? window : globalThis;

export const Ext: any = g.Ext || {};
g.Ext = Ext;

Ext.version = '7.2.0-react';
Ext.global = g;
Ext.isReact = true;
Ext.emptyFn = function () {};
Ext.identityFn = function (o) { return o; };
Ext.returnTrue = function () { return true; };
Ext.returnFalse = function () { return false; };
Ext.privateFn = function () {};
Ext.emptyString = '';
Ext.ariaWarn = Ext.emptyFn;
Ext.enableAria = false;
Ext.isDebugEnabled = function () { return false; };
Ext.log = function (...args) { if (args.length && typeof args[0] === 'object' && args[0].msg) { console.log(args[0].msg); } else { console.log(...args); } };
Ext.log.warn = (...a) => console.warn(...a);
Ext.log.error = (...a) => console.error(...a);
Ext.raise = function (err) { throw typeof err === 'string' ? new Error(err) : Object.assign(new Error(err && err.msg || 'Ext error'), err); };
Ext.Error = { raise: Ext.raise };
Ext.browser = { is: {}, name: 'chrome', version: { major: 120 } };
Ext.os = { is: { Desktop: true, Windows: false }, deviceType: 'Desktop' };
Ext.supports = { Touch: false, PointerEvents: true, CSS3BoxShadow: true };
Ext.isIE = Ext.isIE8 = Ext.isIE9 = Ext.isIE10 = Ext.isIE11 = Ext.isEdge = false;
Ext.isGecko = false; Ext.isWebKit = true; Ext.isChrome = true; Ext.isSafari = false; Ext.isMac = false; Ext.isWindows = false;
Ext.isModern = false; Ext.isClassic = true;
Ext.scopeCss = false;
Ext.baseCSSPrefix = 'x-';

// ---------------------------------------------------------------- type checks
const toStr = Object.prototype.toString;
Ext.isArray = Array.isArray;
Ext.isObject = (v) => !!v && toStr.call(v) === '[object Object]';
Ext.isSimpleObject = (v) => v instanceof Object && v.constructor === Object;
Ext.isString = (v) => typeof v === 'string';
Ext.isNumber = (v) => typeof v === 'number' && isFinite(v);
Ext.isNumeric = (v) => !isNaN(parseFloat(v)) && isFinite(v);
Ext.isBoolean = (v) => typeof v === 'boolean';
Ext.isFunction = (v) => typeof v === 'function';
Ext.isDate = (v) => toStr.call(v) === '[object Date]';
Ext.isDefined = (v) => typeof v !== 'undefined';
Ext.isPrimitive = (v) => { const t = typeof v; return t === 'string' || t === 'number' || t === 'boolean'; };
Ext.isElement = (v) => !!v && v.nodeType === 1;
Ext.isTextNode = (v) => !!v && v.nodeName === '#text';
Ext.isIterable = (v) => !!v && typeof v !== 'string' && typeof v.length === 'number';
Ext.isEmpty = (v, allowEmptyString?) => v == null || (!allowEmptyString ? v === '' : false) || (Ext.isArray(v) && v.length === 0);
Ext.isRegExp = (v) => toStr.call(v) === '[object RegExp]';
Ext.valueFrom = (v, def, allowBlank?) => (Ext.isEmpty(v, allowBlank) ? def : v);
Ext.typeOf = function (v) {
  if (v === null) { return 'null'; }
  const t = typeof v;
  if (t === 'undefined' || t === 'string' || t === 'number' || t === 'boolean') { return t; }
  if (Ext.isArray(v)) { return 'array'; }
  if (Ext.isDate(v)) { return 'date'; }
  if (Ext.isRegExp(v)) { return 'regexp'; }
  if (t === 'function') { return 'function'; }
  if (v.nodeType === 1) { return 'element'; }
  return 'object';
};

// ---------------------------------------------------------------- apply / clone
Ext.apply = function (object, config, defaults?) {
  if (object) {
    if (defaults) { Ext.apply(object, defaults); }
    if (config && typeof config === 'object') {
      for (const k in config) { object[k] = config[k]; }
    }
  }
  return object;
};
Ext.applyIf = function (object, config) {
  if (object && config && typeof config === 'object') {
    for (const k in config) { if (object[k] === undefined) { object[k] = config[k]; } }
  }
  return object;
};
Ext.clone = function clone(item) {
  if (item === null || item === undefined) { return item; }
  if (item.nodeType && item.cloneNode) { return item.cloneNode(true); }
  const type = toStr.call(item);
  if (type === '[object Date]') { return new Date(item.getTime()); }
  if (type === '[object Array]') { return item.map(clone); }
  if (type === '[object Object]' && item.constructor === Object) {
    const out: any = {};
    for (const k in item) { out[k] = clone(item[k]); }
    return out;
  }
  return item;
};
let idSeed = 0;
Ext.idSeed = 0;
Ext.id = function (el?, prefix?) {
  if (el && el.id) { return el.id; }
  const id = (prefix || 'ext-') + (++idSeed);
  if (el) { el.id = id; }
  return id;
};
Ext.ns = Ext.namespace = function (...names: string[]) {
  let root;
  for (const name of names) {
    root = g;
    for (const part of name.split('.')) { root = root[part] = root[part] || {}; }
  }
  return root;
};
Ext.callback = function (callback, scope?, args?, delay?, caller?, defaultScope?) {
  if (!callback) { return undefined; }
  let fn = callback;
  if (typeof callback === 'string') {
    scope = scope || (caller && caller.resolveListenerScope ? caller.resolveListenerScope(defaultScope) : null);
    if (!scope && caller && caller.lookupController) { scope = caller.lookupController(); }
    fn = scope && scope[callback];
    if (typeof fn !== 'function') {
      console.warn('Ext.callback: no method named "' + callback + '" on the resolved scope');
      return undefined;
    }
  }
  scope = scope || caller || defaultScope;
  if (delay) { return Ext.defer(fn, delay, scope, args); }
  return fn.apply(scope, args || []);
};
Ext.destroy = function (...args) {
  for (const a of args) {
    if (!a) { continue; }
    if (Ext.isArray(a)) { Ext.destroy(...a); }
    else if (typeof a.destroy === 'function' && !a.destroyed) { a.destroy(); }
  }
  return null;
};
Ext.destroyMembers = function (object, ...names) {
  for (const n of names) { Ext.destroy(object[n]); object[n] = null; }
};
Ext.defer = function (fn, millis, scope?, args?, appendArgs?) {
  const f = Ext.Function.bind(fn, scope, args, appendArgs);
  if (millis > 0) { return setTimeout(f, millis); }
  f();
  return 0;
};
Ext.undefer = function (id) { if (id) { clearTimeout(id); } };
Ext.asap = function (fn, scope?, args?) { const id = setTimeout(() => fn.apply(scope, args || [])); return id; };
Ext.unasap = Ext.undefer;
Ext.interval = function (fn, millis, scope?, args?) { return setInterval(() => fn.apply(scope, args || []), millis); };
Ext.uninterval = function (id) { clearInterval(id); };
Ext.iterate = function (obj, fn, scope?) {
  if (Ext.isIterable(obj)) { Ext.Array.each(obj, fn, scope); } else { Ext.Object.each(obj, fn, scope); }
};
Ext.toArray = function (iterable, start?, end?) { return Array.prototype.slice.call(iterable || [], start || 0, end); };
Ext.coerce = function (from, to) {
  const t = Ext.typeOf(from), tt = Ext.typeOf(to);
  if (t === tt) { return from; }
  if (tt === 'number') { return Number(from); }
  if (tt === 'boolean') { return from === 'true' || from === true || from === 1; }
  if (tt === 'string') { return String(from); }
  return from;
};

// ---------------------------------------------------------------- Ext.Array
const A: any = (Ext.Array = {});
A.each = function (array, fn, scope?, reverse?) {
  array = A.from(array);
  const n = array.length;
  if (reverse) {
    for (let i = n - 1; i > -1; i--) { if (fn.call(scope || array[i], array[i], i, array) === false) { return i; } }
  } else {
    for (let i = 0; i < n; i++) { if (fn.call(scope || array[i], array[i], i, array) === false) { return i; } }
  }
  return true;
};
A.forEach = function (array, fn, scope?) { A.from(array).forEach(fn, scope); };
A.from = function (value, newReference?) {
  if (value === undefined || value === null) { return []; }
  if (Ext.isArray(value)) { return newReference ? value.slice() : value; }
  if (typeof value !== 'string' && typeof value !== 'function' && value.length !== undefined && !value.nodeType) {
    return Array.prototype.slice.call(value);
  }
  return [value];
};
A.map = (array, fn, scope?) => A.from(array).map(fn, scope);
A.filter = (array, fn, scope?) => A.from(array).filter(fn, scope);
A.every = (array, fn, scope?) => A.from(array).every(fn, scope);
A.some = (array, fn, scope?) => A.from(array).some(fn, scope);
A.reduce = (array, fn, init) => A.from(array).reduce(fn, init);
A.contains = A.includes = (array, item) => A.from(array).indexOf(item) !== -1;
A.indexOf = (array, item, from?) => A.from(array).indexOf(item, from);
A.include = (array, item) => { if (array.indexOf(item) === -1) { array.push(item); } };
A.remove = (array, item) => { const i = array.indexOf(item); if (i !== -1) { array.splice(i, 1); } return array; };
A.removeAt = (array, index, count = 1) => { array.splice(index, count); return array; };
A.erase = (array, index, removeCount) => { array.splice(index, removeCount); return array; };
A.insert = (array, index, items) => { array.splice(index, 0, ...items); return array; };
A.replace = (array, index, removeCount, insert?) => { array.splice(index, removeCount, ...(insert || [])); return array; };
A.splice = (array, ...args) => { array.splice(...args); return array; };
A.push = (target, ...items) => { target = A.from(target); for (const i of items) { if (Ext.isArray(i)) { target.push(...i); } else { target.push(i); } } return target; };
A.clone = (array) => A.from(array).slice();
A.slice = (array, begin?, end?) => A.from(array).slice(begin, end);
A.clean = (array) => A.from(array).filter((v) => !Ext.isEmpty(v));
A.unique = (array) => { const out = []; for (const v of A.from(array)) { if (out.indexOf(v) === -1) { out.push(v); } } return out; };
A.merge = A.union = (...arrays) => A.unique([].concat(...arrays.map((a) => A.from(a))));
A.intersect = (...arrays) => {
  if (!arrays.length) { return []; }
  const [first, ...rest] = arrays.map((a) => A.from(a));
  return A.unique(first.filter((v) => rest.every((r) => r.indexOf(v) !== -1)));
};
A.difference = (a, b) => A.from(a).filter((v) => A.from(b).indexOf(v) === -1);
A.flatten = (array) => { const out = []; const walk = (a) => { for (const v of a) { if (Ext.isArray(v)) { walk(v); } else { out.push(v); } } }; walk(A.from(array)); return out; };
A.findBy = (array, fn, scope?) => { const a = A.from(array); for (let i = 0; i < a.length; i++) { if (fn.call(scope || a[i], a[i], i)) { return a[i]; } } return null; };
A.findIndexBy = (array, fn, scope?) => { const a = A.from(array); for (let i = 0; i < a.length; i++) { if (fn.call(scope || a[i], a[i], i)) { return i; } } return -1; };
A.pluck = (array, prop) => A.from(array).map((v) => v[prop]);
A.sum = (array) => A.from(array).reduce((s, v) => s + (Number(v) || 0), 0);
A.mean = (array) => { const a = A.from(array); return a.length ? A.sum(a) / a.length : undefined; };
A.min = (array, cmp?) => { const a = A.from(array); if (!a.length) { return undefined; } return a.reduce((m, v) => (cmp ? (cmp(v, m) < 0 ? v : m) : (v < m ? v : m))); };
A.max = (array, cmp?) => { const a = A.from(array); if (!a.length) { return undefined; } return a.reduce((m, v) => (cmp ? (cmp(v, m) > 0 ? v : m) : (v > m ? v : m))); };
A.sort = (array, fn?) => { array.sort(fn); return array; };
A.toArray = (iterable, start?, end?) => Ext.toArray(iterable, start, end);
A.toMap = (array, getKey?, scope?) => {
  const map = {};
  A.from(array).forEach((v, i) => {
    const key = typeof getKey === 'function' ? getKey.call(scope, v) : (getKey ? v[getKey] : v);
    map[key] = i + 1;
  });
  return map;
};
A.toValueMap = (array, getKey?) => { const map = {}; A.from(array).forEach((v) => { map[typeof getKey === 'function' ? getKey(v) : v[getKey]] = v; }); return map; };
A.equals = (a, b) => { a = A.from(a); b = A.from(b); if (a.length !== b.length) { return false; } for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } } return true; };
A.last = (array) => { const a = A.from(array); return a[a.length - 1]; };
A.numberValues = (array) => A.from(array).filter(Ext.isNumber);

// ---------------------------------------------------------------- Ext.Object
const O: any = (Ext.Object = {});
O.each = function (obj, fn, scope?) {
  if (!obj) { return; }
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      if (fn.call(scope || obj, k, obj[k], obj) === false) { return; }
    }
  }
};
O.eachValue = (obj, fn, scope?) => O.each(obj, (k, v) => fn.call(scope || obj, v));
O.getKeys = (obj) => (obj ? Object.keys(obj) : []);
O.getValues = (obj) => (obj ? Object.keys(obj).map((k) => obj[k]) : []);
O.getSize = (obj) => O.getKeys(obj).length;
O.isEmpty = (obj) => { for (const k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) { return false; } } return true; };
O.getKey = (obj, value) => { for (const k in obj) { if (obj[k] === value) { return k; } } return null; };
O.merge = function (destination, ...sources) {
  for (const object of sources) {
    if (!object) { continue; }
    for (const key in object) {
      const value = object[key];
      if (value && value.constructor === Object) {
        const sourceKey = destination[key];
        if (sourceKey && sourceKey.constructor === Object) { O.merge(sourceKey, value); }
        else { destination[key] = Ext.clone(value); }
      } else {
        destination[key] = value;
      }
    }
  }
  return destination;
};
O.mergeIf = function (destination, ...sources) {
  for (const object of sources) { for (const key in object) { if (!(key in destination)) { destination[key] = Ext.clone(object[key]); } } }
  return destination;
};
O.chain = (obj) => Object.create(obj);
O.equals = function equals(a, b) {
  if (a === b) { return true; }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') { return false; }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) { return false; }
  return ka.every((k) => a[k] === b[k]);
};
O.toQueryObjects = function (name, value, recursive?) {
  const out = [];
  if (Ext.isArray(value)) {
    value.forEach((v, i) => { if (recursive) { out.push(...O.toQueryObjects(name + '[' + i + ']', v, true)); } else { out.push({ name, value: v }); } });
  } else if (Ext.isObject(value)) {
    for (const k in value) { if (recursive) { out.push(...O.toQueryObjects(name + '[' + k + ']', value[k], true)); } else { out.push({ name, value: value[k] }); } }
  } else {
    out.push({ name, value });
  }
  return out;
};
O.toQueryString = function (object, recursive?) {
  const parts = [];
  for (const k in object) {
    for (const p of O.toQueryObjects(k, object[k], recursive)) {
      let v = p.value;
      if (v === undefined) { continue; }
      if (v === null) { v = ''; }
      if (Ext.isDate(v)) { v = Ext.Date.toString(v); }
      parts.push(encodeURIComponent(p.name) + '=' + encodeURIComponent(String(v)));
    }
  }
  return parts.join('&');
};
O.fromQueryString = function (qs) {
  const out = {};
  for (const part of String(qs || '').replace(/^\?/, '').split('&')) {
    if (!part) { continue; }
    const [k, v] = part.split('=');
    const name = decodeURIComponent(k), value = decodeURIComponent((v || '').replace(/\+/g, ' '));
    if (name in out) { out[name] = [].concat(out[name], value); } else { out[name] = value; }
  }
  return out;
};
O.freeze = Object.freeze;
O.classify = (obj) => obj;

// ---------------------------------------------------------------- Ext.String
const S: any = (Ext.String = {});
const htmlEnc = { '&': '&amp;', '>': '&gt;', '<': '&lt;', '"': '&quot;', "'": '&#39;' };
const htmlDec = { '&amp;': '&', '&gt;': '>', '&lt;': '<', '&quot;': '"', '&#39;': "'", '&#039;': "'", '&nbsp;': ' ', '&#160;': ' ' };
S.htmlEncode = (v) => (v === null || v === undefined ? v : String(v).replace(/[&><"']/g, (c) => htmlEnc[c]));
S.htmlDecode = (v) => (v === null || v === undefined ? v : String(v).replace(/&(amp|gt|lt|quot|#39|#039|nbsp|#160);|&#(\d+);/g, (m, n, code) => (code ? String.fromCharCode(Number(code)) : htmlDec[m])));
S.trim = (v) => (v === null || v === undefined ? '' : String(v).trim());
S.capitalize = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).substr(1) : v);
S.uncapitalize = (v) => (v ? String(v).charAt(0).toLowerCase() + String(v).substr(1) : v);
S.ellipsis = function (value, length, word?) {
  if (value && value.length > length) {
    if (word) {
      const vs = value.substr(0, length - 2);
      const index = Math.max(vs.lastIndexOf(' '), vs.lastIndexOf('.'), vs.lastIndexOf('!'), vs.lastIndexOf('?'));
      if (index !== -1 && index >= length - 15) { return vs.substr(0, index) + '...'; }
    }
    return value.substr(0, length - 3) + '...';
  }
  return value;
};
S.format = function (format, ...args) { return String(format).replace(/\{(\d+)\}/g, (m, i) => (args[i] === undefined ? '' : args[i])); };
S.formatEncode = function (format, ...args) { return S.format(format, ...args.map(S.htmlEncode)); };
S.leftPad = (v, size, ch = ' ') => { let s = String(v); while (s.length < size) { s = ch + s; } return s; };
S.repeat = (pattern, count, sep = '') => new Array(Math.max(0, count)).fill(pattern).join(sep);
S.toggle = (s, a, b) => (s === a ? b : a);
S.startsWith = (s, start, ignoreCase?) => (ignoreCase ? String(s).toLowerCase().indexOf(String(start).toLowerCase()) === 0 : String(s).indexOf(start) === 0);
S.endsWith = (s, end, ignoreCase?) => { s = String(s); end = String(end); if (ignoreCase) { s = s.toLowerCase(); end = end.toLowerCase(); } return s.slice(-end.length) === end; };
S.escapeRegex = (s) => String(s).replace(/([-.*+?^${}()|[\]/\\])/g, '\\$1');
S.escape = (s) => String(s).replace(/('|\\)/g, '\\$1');
S.urlAppend = (url, s) => (s ? url + (url.indexOf('?') === -1 ? '?' : '&') + s : url);
S.splitWords = (words) => (words && typeof words === 'string' ? words.replace(/^\s+|\s+$/g, '').split(/\s+/) : words || []);
S.hasHtmlCharacters = (s) => /[&<>"']/.test(s);
S.createVarName = (s) => String(s).replace(/[^\w$]/g, '_');
S.insert = (s, value, index) => { s = String(s); if (index < 0) { index = s.length + index; } return s.slice(0, index) + value + s.slice(index); };

// ---------------------------------------------------------------- Ext.Number
const N: any = (Ext.Number = {});
N.constrain = (n, min, max) => { n = parseFloat(n); if (!isNaN(min)) { n = Math.max(n, min); } if (!isNaN(max)) { n = Math.min(n, max); } return n; };
N.from = (v, def) => { const n = parseFloat(v); return isFinite(n) ? n : def; };
N.toFixed = (v, precision) => Number(v).toFixed(precision);
N.roundToPrecision = (v, precision) => { const f = Math.pow(10, precision || 0); return Math.round(v * f) / f; };
N.randomInt = (from, to) => Math.floor(Math.random() * (to - from + 1) + from);
N.correctFloat = (n) => parseFloat(Number(n).toPrecision(14));
N.sign = Math.sign;
N.isEqual = (a, b, eps) => Math.abs(a - b) <= (eps || 0);
N.parseInt = (v, def) => { const n = parseInt(v, 10); return isNaN(n) ? def : n; };
N.parseFloat = (v, def) => { const n = parseFloat(v); return isNaN(n) ? def : n; };
Ext.num = N.from;

// ---------------------------------------------------------------- Ext.Function
const F: any = (Ext.Function = {});
F.bind = function (fn, scope?, args?, appendArgs?) {
  if (arguments.length <= 2) { return scope === undefined ? fn : fn.bind(scope); }
  return function (this: any, ...callArgs) {
    let a = args || callArgs;
    if (appendArgs === true) { a = callArgs.concat(args || []); }
    else if (typeof appendArgs === 'number') { a = callArgs.slice(); a.splice(appendArgs, 0, ...(args || [])); }
    return fn.apply(scope === undefined ? this : scope, a);
  };
};
F.pass = (fn, args, scope?) => function (this: any, ...rest) { return fn.apply(scope || this, A.from(args).concat(rest)); };
F.defer = Ext.defer;
F.createDelayed = (fn, delay, scope?, args?, appendArgs?) => function (this: any, ...a) { const f = F.bind(fn, scope || this, args, appendArgs); setTimeout(() => f(...a), delay); };
F.createBuffered = function (fn, buffer, scope?, args?) {
  let timer = null;
  const buffered: any = function (this: any, ...a) {
    const me = scope || this;
    if (timer) { clearTimeout(timer); }
    timer = setTimeout(() => { timer = null; fn.apply(me, args || a); }, buffer);
  };
  buffered.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return buffered;
};
F.createThrottled = function (fn, interval, scope?) {
  let last = 0, timer = null, lastArgs;
  return function (this: any, ...a) {
    const me = scope || this, now = Date.now();
    lastArgs = a;
    if (now - last >= interval) { last = now; fn.apply(me, a); }
    else if (!timer) { timer = setTimeout(() => { timer = null; last = Date.now(); fn.apply(me, lastArgs); }, interval - (now - last)); }
  };
};
F.createInterceptor = (origFn, newFn, scope?, returnValue = null) => function (this: any, ...a) { return newFn.apply(scope || this, a) !== false ? origFn.apply(this, a) : returnValue; };
F.createSequence = (originalFn, newFn, scope?) => function (this: any, ...a) { const r = originalFn.apply(this, a); newFn.apply(scope || this, a); return r; };
F.interceptBefore = (object, methodName, fn, scope?) => { const method = object[methodName] || Ext.emptyFn; object[methodName] = function (...a) { const r = fn.apply(scope || this, a); method.apply(this, a); return r; }; return object[methodName]; };
F.interceptAfter = (object, methodName, fn, scope?) => { const method = object[methodName] || Ext.emptyFn; object[methodName] = function (...a) { method.apply(this, a); return fn.apply(scope || this, a); }; return object[methodName]; };
F.alias = (object, methodName) => function (...a) { return object[methodName].apply(object, a); };
F.clone = (method) => function (this: any, ...a) { return method.apply(this, a); };
F.flexSetter = (setter) => function (this: any, name, value) {
  if (name && typeof name === 'object') { for (const k in name) { setter.call(this, k, name[k]); } }
  else { setter.call(this, name, value); }
  return this;
};
F.memoize = (fn, scope?, hashFn?) => { const memo = {}; return function (this: any, ...a) { const key = hashFn ? hashFn.apply(scope, a) : a[0]; if (!(key in memo)) { memo[key] = fn.apply(scope || this, a); } return memo[key]; }; };
Ext.bind = F.bind;
Ext.pass = F.pass;

// ---------------------------------------------------------------- JSON
Ext.JSON = {
  encode: (o) => JSON.stringify(o, (k, v) => v),
  decode: (text, safe?) => {
    try { return JSON.parse(text); } catch (e) { if (safe) { return null; } throw e; }
  },
  encodeDate: (d) => '"' + Ext.Date.format(d, 'c') + '"'
};
Ext.encode = Ext.JSON.encode;
Ext.decode = Ext.JSON.decode;

// ---------------------------------------------------------------- ready
const readyFns = [];
let isReady = false;
Ext.isReady = false;
Ext.onReady = function (fn, scope?) {
  if (isReady) { setTimeout(() => fn.call(scope)); return; }
  readyFns.push(() => fn.call(scope));
};
Ext.$fireReady = function () {
  if (isReady) { return; }
  isReady = Ext.isReady = true;
  while (readyFns.length) { readyFns.shift()(); }
};
Ext.onDocumentReady = Ext.onReady;
// Ready fires after the current task, so every app module (evaluated in one go) is defined first.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => setTimeout(Ext.$fireReady, 0)); }
  else { setTimeout(Ext.$fireReady, 0); }
} else { setTimeout(Ext.$fireReady, 0); }

export default Ext;
