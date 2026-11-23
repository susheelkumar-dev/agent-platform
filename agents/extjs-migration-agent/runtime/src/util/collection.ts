/**
 * Ext.util.Collection / Ext.util.MixedCollection (one implementation, both APIs), Ext.util.Filter,
 * Ext.util.Sorter and Ext.util.Grouper. getRange(start, end) is end-inclusive (the MixedCollection / Store contract).
 */
import { Ext } from '../core/ext';
import { define } from '../core/class';
import '../core/observable';

const getKeyDefault = (item: any) => (item && (item.isModel ? item.getId() : (item.itemId || item.id || (item.getId && item.getId()))));

export const Collection: any = define('Ext.util.Collection', {
  mixins: { observable: 'Ext.mixin.Observable' },
  isCollection: true,
  isMixedCollection: true,

  constructor: function (config?: any, keyFn?: any) {
    const me = this;
    me.items = [];
    me.map = {};
    me.keys = [];
    me.length = 0;
    if (typeof config === 'boolean') { me.allowFunctions = config; config = keyFn ? { keyFn } : null; }
    else if (typeof config === 'function') { config = { keyFn: config }; }
    if (config && config.keyFn) { me.getKey = config.keyFn; }
    if (config && config.getKey) { me.getKey = config.getKey; }
    me.mixins.observable.constructor.call(me, config && config.listeners ? { listeners: config.listeners } : undefined);
    if (config && config.items) { me.add(config.items); }
    return me;
  },

  getKey: getKeyDefault,

  $reindex: function () {
    const me = this;
    me.map = {};
    me.keys = [];
    for (const item of me.items) {
      const k = me.getKey(item);
      me.keys.push(k);
      if (k !== undefined && k !== null) { me.map[k] = item; }
    }
    me.length = me.items.length;
  },

  add: function (key: any, item?: any) {
    const me = this;
    let items;
    if (arguments.length === 2 && (typeof key === 'string' || typeof key === 'number')) {
      items = [item];
      if (item && typeof item === 'object') { item.$collectionKey = key; }
      const k = key;
      me.$customKeys = me.$customKeys || {};
      me.$customKeys[k] = item;
    } else {
      items = Ext.Array.from(key);
    }
    if (!items.length) { return Ext.isArray(key) ? [] : undefined; }
    const index = me.items.length;
    for (const it of items) {
      const k = me.$keyOf(it);
      if (k !== undefined && k !== null && me.map[k] !== undefined && me.map[k] !== it) {
        // same key: replace in place (Ext.util.Collection semantics)
        const i = me.items.indexOf(me.map[k]);
        me.items[i] = it;
      } else if (me.items.indexOf(it) < 0) {
        me.items.push(it);
      }
    }
    me.$reindex();
    me.fireEvent('add', me, { items, at: index });
    return Ext.isArray(key) ? items : items[0];
  },

  $keyOf: function (item: any) {
    if (item && typeof item === 'object' && item.$collectionKey !== undefined) { return item.$collectionKey; }
    return this.getKey(item);
  },

  addAll: function (items: any) { return this.add(Ext.Array.from(items)); },

  insert: function (index: number, key: any, item?: any) {
    const me = this;
    let items;
    if (arguments.length === 3) { items = [item]; if (item && typeof item === 'object') { item.$collectionKey = key; } }
    else { items = Ext.Array.from(key); }
    const fresh = items.filter((i) => me.items.indexOf(i) < 0);
    me.items.splice(Math.max(0, Math.min(index, me.items.length)), 0, ...fresh);
    me.$reindex();
    me.fireEvent('add', me, { items: fresh, at: index });
    return Ext.isArray(key) ? fresh : fresh[0];
  },

  remove: function (item: any) {
    const me = this;
    const items = Ext.Array.from(item);
    const removed = [];
    for (const it of items) {
      const i = me.items.indexOf(it);
      if (i >= 0) { me.items.splice(i, 1); removed.push(it); }
    }
    if (removed.length) {
      me.$reindex();
      me.fireEvent('remove', me, { items: removed });
    }
    return Ext.isArray(item) ? removed : removed[0];
  },

  removeAt: function (index: number, count = 1) {
    const me = this;
    const removed = me.items.splice(index, count);
    me.$reindex();
    if (removed.length) { me.fireEvent('remove', me, { items: removed, at: index }); }
    return count === 1 ? removed[0] : removed;
  },

  removeByKey: function (key: any) { const it = this.get(key); return it ? this.remove(it) : undefined; },
  removeAll: function (items?: any) {
    if (items) { return this.remove(items); }
    const removed = this.items.slice();
    this.items = [];
    this.$reindex();
    if (removed.length) { this.fireEvent('remove', this, { items: removed }); this.fireEvent('clear', this); }
    return removed;
  },
  clear: function () { return this.removeAll(); },

  replace: function (key: any, item: any) {
    const old = this.get(key);
    if (old) { this.items[this.items.indexOf(old)] = item; this.$reindex(); } else { this.add(item); }
    return item;
  },

  get: function (key: any) {
    if (key === undefined || key === null) { return undefined; }
    const v = this.map[key];
    if (v !== undefined) { return v; }
    if (typeof key === 'number') { return this.items[key]; }
    return undefined;
  },
  getByKey: function (key: any) { return this.map[key]; },
  getAt: function (index: number) { return this.items[index]; },
  first: function () { return this.items[0]; },
  last: function () { return this.items[this.items.length - 1]; },
  getCount: function () { return this.items.length; },
  count: function () { return this.items.length; },
  indexOf: function (item: any) { return this.items.indexOf(item); },
  indexOfKey: function (key: any) { return this.keys.indexOf(key); },
  contains: function (item: any) { return this.items.indexOf(item) >= 0; },
  containsKey: function (key: any) { return this.map[key] !== undefined; },
  getRange: function (start?: number, end?: number) {
    const items = this.items;
    if (!items.length) { return []; }
    start = start || 0;
    end = Math.min(end === undefined || end === null ? items.length - 1 : end, items.length - 1);
    return items.slice(start, end + 1);
  },
  getValues: function (property: string, root?: string) {
    return this.items.map((i) => (root ? i[root][property] : (i && i.isModel ? i.get(property) : i[property])));
  },
  each: function (fn: any, scope?: any) {
    const items = this.items.slice();
    for (let i = 0; i < items.length; i++) {
      if (fn.call(scope || items[i], items[i], i, items.length) === false) { break; }
    }
  },
  eachKey: function (fn: any, scope?: any) {
    const items = this.items.slice();
    for (let i = 0; i < items.length; i++) { fn.call(scope, this.$keyOf(items[i]), items[i], i, items.length); }
  },
  findBy: function (fn: any, scope?: any) {
    for (let i = 0; i < this.items.length; i++) { if (fn.call(scope || this, this.items[i], this.$keyOf(this.items[i]))) { return this.items[i]; } }
    return null;
  },
  findIndexBy: function (fn: any, scope?: any, start = 0) {
    for (let i = start; i < this.items.length; i++) { if (fn.call(scope || this, this.items[i], this.$keyOf(this.items[i]))) { return i; } }
    return -1;
  },
  findIndex: function (property: string, value: any, start = 0, anyMatch?: boolean, caseSensitive?: boolean) {
    const filter = new Filter({ property, value, anyMatch, caseSensitive });
    for (let i = start; i < this.items.length; i++) { if (filter.filter(this.items[i])) { return i; } }
    return -1;
  },
  find: function (property: string, value: any, start?: number, anyMatch?: boolean, caseSensitive?: boolean) {
    const i = this.findIndex(property, value, start, anyMatch, caseSensitive);
    return i >= 0 ? this.items[i] : null;
  },
  filterBy: function (fn: any, scope?: any) {
    const out = new Collection({ keyFn: this.getKey });
    out.add(this.items.filter((it) => fn.call(scope || this, it, this.$keyOf(it))));
    return out;
  },
  filter: function (property: any, value?: any, anyMatch?: boolean, caseSensitive?: boolean) {
    let filters = [];
    if (typeof property === 'string') { filters = [new Filter({ property, value, anyMatch, caseSensitive })]; }
    else if (typeof property === 'function') { return this.filterBy(property, value); }
    else { filters = Ext.Array.from(property).map((f) => (f.isFilter ? f : new Filter(f))); }
    return this.filterBy((item) => filters.every((f) => f.filter(item)));
  },
  collect: function (property: string, root?: string, allowBlank?: boolean) {
    const seen = new Set(), out = [];
    for (const it of this.items) {
      const v = root ? it[root][property] : (it && it.isModel ? it.get(property) : it[property]);
      if ((allowBlank || !Ext.isEmpty(v)) && !seen.has(v)) { seen.add(v); out.push(v); }
    }
    return out;
  },
  sum: function (property: string, root?: string, start = 0, end?: number) {
    let s = 0;
    const items = this.getRange(start, end);
    for (const it of items) { const v = root ? it[root][property] : (it && it.isModel ? it.get(property) : it[property]); s += Number(v) || 0; }
    return s;
  },
  sort: function (sorters: any, direction?: string) {
    const me = this;
    let fn: (a: any, b: any) => number;
    if (typeof sorters === 'function') { fn = sorters; }
    else {
      const list = typeof sorters === 'string' ? [new Sorter({ property: sorters, direction: direction || 'ASC' })] : Ext.Array.from(sorters).map((s) => (s.isSorter ? s : new Sorter(s)));
      fn = (a, b) => { for (const s of list) { const r = s.sort(a, b); if (r) { return r; } } return 0; };
    }
    const indexed = me.items.map((it, i) => [it, i]);
    indexed.sort((x, y) => fn(x[0], y[0]) || x[1] - y[1]);
    me.items = indexed.map((x) => x[0]);
    me.$reindex();
    me.fireEvent('sort', me);
    return me;
  },
  sortBy: function (fn: any) { return this.sort(fn); },
  sortByKey: function (direction = 'ASC') { const d = direction === 'DESC' ? -1 : 1; return this.sort((a, b) => (this.$keyOf(a) > this.$keyOf(b) ? d : this.$keyOf(a) < this.$keyOf(b) ? -d : 0)); },
  clone: function () { const c = new Collection({ keyFn: this.getKey }); c.add(this.items.slice()); return c; },
  getSource: function () { return this.$source || null; },
  extractValues: function (property: string, root?: string) { return this.getValues(property, root); },
  toArray: function () { return this.items.slice(); },
  destroy: function () { this.items = []; this.map = {}; this.destroyObservable(); this.callParent(); }
});
Ext.util.MixedCollection = Collection;
Ext.ClassManager.classes['Ext.util.MixedCollection'] = Collection;
Ext.util.AbstractMixedCollection = Collection;
Ext.ClassManager.classes['Ext.util.ItemCollection'] = Collection;

// ---------------------------------------------------------------- Filter
const operators: Record<string, (a: any, b: any) => boolean> = {
  '<': (a, b) => a < b,
  'lt': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  'le': (a, b) => a <= b,
  '=': (a, b) => a == b, // eslint-disable-line eqeqeq
  'eq': (a, b) => a == b, // eslint-disable-line eqeqeq
  '==': (a, b) => a == b, // eslint-disable-line eqeqeq
  '===': (a, b) => a === b,
  '>=': (a, b) => a >= b,
  'ge': (a, b) => a >= b,
  '>': (a, b) => a > b,
  'gt': (a, b) => a > b,
  '!=': (a, b) => a != b, // eslint-disable-line eqeqeq
  'ne': (a, b) => a != b, // eslint-disable-line eqeqeq
  '!==': (a, b) => a !== b,
  'in': (a, b) => Ext.Array.from(b).indexOf(a) !== -1,
  'notin': (a, b) => Ext.Array.from(b).indexOf(a) === -1,
  'like': (a, b) => String(a).toLowerCase().indexOf(String(b).toLowerCase()) !== -1,
  '/=': (a, b) => (b instanceof RegExp ? b : new RegExp(b)).test(a)
};

export const Filter: any = define('Ext.util.Filter', {
  isFilter: true,
  property: null,
  value: null,
  operator: null,
  anyMatch: false,
  exactMatch: false,
  caseSensitive: false,
  disabled: false,
  disableOnEmpty: false,
  root: null,
  filterFn: null,
  scope: null,
  constructor: function (config?: any) {
    Ext.apply(this, config);
    if (!this.id && this.property) { this.id = this.property + (this.operator ? '-' + this.operator : ''); }
    return this;
  },
  getId: function () { return this.id; },
  getProperty: function () { return this.property; },
  setProperty: function (p: string) { this.property = p; this.$fn = null; },
  getValue: function () { return this.value; },
  setValue: function (v: any) { this.value = v; this.$fn = null; },
  getOperator: function () { return this.operator; },
  setOperator: function (o: string) { this.operator = o; this.$fn = null; },
  getDisabled: function () { return this.disabled; },
  setDisabled: function (d: boolean) { this.disabled = d; },
  getFilterFn: function () { return this.filterFn; },
  setFilterFn: function (fn: any) { this.filterFn = fn; this.$fn = null; },
  getRoot: function () { return this.root; },
  isDisabled: function () { return this.disabled; },
  getPropertyValue: function (item: any) {
    const p = this.property;
    if (this.root) { const r = item[this.root]; return r ? r[p] : undefined; }
    if (item && item.isModel) { return item.get(p); }
    return item ? item[p] : undefined;
  },
  getCandidateValue: function (item: any) { return this.getPropertyValue(item); },
  filter: function (item: any) {
    const me = this;
    if (me.disabled) { return true; }
    if (!me.$fn) { me.$fn = me.$createFn(); }
    return me.$fn(item);
  },
  $createFn: function () {
    const me = this;
    if (me.filterFn) { return (item: any) => !!me.filterFn.call(me.scope || me, item); }
    const value = me.value;
    if (me.disableOnEmpty && (value === null || value === undefined || value === '')) { return () => true; }
    if (me.operator) {
      const op = operators[me.operator];
      if (!op) { throw new Error('Unknown filter operator ' + me.operator); }
      return (item: any) => {
        let v = me.getPropertyValue(item);
        let cmp = value;
        if (Ext.isDate(v) && Ext.isDate(cmp)) { v = v.getTime(); cmp = cmp.getTime(); }
        if (!me.caseSensitive && typeof v === 'string' && typeof cmp === 'string' && me.operator !== '/=') { v = v.toLowerCase(); cmp = cmp.toLowerCase(); }
        return op(v, cmp);
      };
    }
    let re: RegExp;
    if (value instanceof RegExp) { re = value; }
    else if (value === null || value === undefined) { return (item: any) => { const v = me.getPropertyValue(item); return v === null || v === undefined; }; }
    else {
      let src = Ext.String.escapeRegex(String(value));
      if (!me.anyMatch) { src = '^' + src; }
      if (me.exactMatch) { src = (me.anyMatch ? '^' : '') + src + '$'; }
      re = new RegExp(src, me.caseSensitive ? '' : 'i');
    }
    return (item: any) => re.test(String(me.getPropertyValue(item)));
  },
  serialize: function () {
    return { property: this.property, value: this.value, operator: this.operator };
  },
  getState: function () { return this.serialize(); },
  statics: {
    createFilterFn: function (filters: any[]) {
      return (item: any) => filters.every((f) => f.filter(item));
    }
  }
});

// ---------------------------------------------------------------- Sorter
export const Sorter: any = define('Ext.util.Sorter', {
  isSorter: true,
  property: null,
  direction: 'ASC',
  root: null,
  sorterFn: null,
  transform: null,
  constructor: function (config?: any) {
    if (typeof config === 'string') { config = { property: config }; }
    Ext.apply(this, config);
    this.direction = String(this.direction || 'ASC').toUpperCase();
    if (!this.id && this.property) { this.id = this.property; }
    return this;
  },
  getId: function () { return this.id; },
  getProperty: function () { return this.property; },
  getDirection: function () { return this.direction; },
  setDirection: function (d: string) { this.direction = String(d).toUpperCase(); },
  toggle: function () { this.direction = this.direction === 'ASC' ? 'DESC' : 'ASC'; },
  getRoot: function () { return this.root; },
  getTransform: function () { return this.transform; },
  getSorterFn: function () { return this.sorterFn; },
  $value: function (item: any) {
    let v;
    if (this.root) { v = item[this.root] ? item[this.root][this.property] : undefined; }
    else if (item && item.isModel) { v = item.get(this.property); }
    else { v = item ? item[this.property] : undefined; }
    if (this.transform) { v = this.transform(v); }
    return v;
  },
  sort: function (a: any, b: any) {
    const me = this;
    const dir = me.direction === 'DESC' ? -1 : 1;
    if (me.sorterFn) { return dir * me.sorterFn(a, b); }
    let x = me.$value(a), y = me.$value(b);
    if (Ext.isDate(x)) { x = x.getTime(); }
    if (Ext.isDate(y)) { y = y.getTime(); }
    if (x === y) { return 0; }
    if (x === null || x === undefined || x === '') { return -1 * dir; }
    if (y === null || y === undefined || y === '') { return 1 * dir; }
    return dir * (x > y ? 1 : x < y ? -1 : 0);
  },
  serialize: function () { return { property: this.property, direction: this.direction }; },
  getState: function () { return this.serialize(); }
});

// ---------------------------------------------------------------- Grouper
export const Grouper: any = define('Ext.util.Grouper', {
  extend: 'Ext.util.Sorter',
  isGrouper: true,
  groupFn: null,
  getGroupString: function (item: any) {
    if (this.groupFn) { return this.groupFn(item); }
    const v = item && item.isModel ? item.get(this.property) : item[this.property];
    return v;
  },
  sort: function (a: any, b: any) {
    if (this.sorterFn) { return this.callParent([a, b]); }
    const dir = this.direction === 'DESC' ? -1 : 1;
    let x = this.getGroupString(a), y = this.getGroupString(b);
    if (Ext.isDate(x)) { x = x.getTime(); }
    if (Ext.isDate(y)) { y = y.getTime(); }
    if (x === y) { return 0; }
    if (x === null || x === undefined || x === '') { return -dir; }
    if (y === null || y === undefined || y === '') { return dir; }
    return dir * (x > y ? 1 : -1);
  }
});

export default Collection;
