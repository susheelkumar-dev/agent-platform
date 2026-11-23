/** Ext.state.Manager with Provider and LocalStorageProvider (component state such as grid columns and sort). */
import { Ext } from '../core/ext';
import { define } from '../core/class';
import '../core/observable';

define('Ext.state.Provider', {
  mixins: { observable: 'Ext.mixin.Observable' },
  prefix: 'ext-',
  constructor: function (config?: any) { this.state = {}; this.mixins.observable.constructor.call(this, config); return this; },
  get: function (name: string, defaultValue?: any) { return name in this.state ? this.state[name] : defaultValue; },
  set: function (name: string, value: any) { this.state[name] = value; this.fireEvent('statechange', this, name, value); },
  clear: function (name: string) { delete this.state[name]; this.fireEvent('statechange', this, name, null); },
  encodeValue: function (v: any) { return JSON.stringify(v); },
  decodeValue: function (s: string) { try { return JSON.parse(s); } catch (e) { return undefined; } }
});

define('Ext.state.LocalStorageProvider', {
  extend: 'Ext.state.Provider',
  alias: 'state.localstorage',
  constructor: function (config?: any) {
    this.callParent([config]);
    this.store = window.localStorage; // throws when storage is blocked, like Ext
    return this;
  },
  get: function (name: string, defaultValue?: any) {
    try {
      const raw = this.store.getItem(this.prefix + name);
      if (raw === null || raw === undefined) { return defaultValue; }
      const v = this.decodeValue(raw);
      return v === undefined ? defaultValue : v;
    } catch (e) { return defaultValue; }
  },
  set: function (name: string, value: any) {
    try { this.store.setItem(this.prefix + name, this.encodeValue(value)); } catch (e) { /* quota or blocked */ }
    this.fireEvent('statechange', this, name, value);
  },
  clear: function (name: string) {
    try { this.store.removeItem(this.prefix + name); } catch (e) { /* ignore */ }
    this.fireEvent('statechange', this, name, null);
  }
});
define('Ext.state.CookieProvider', { extend: 'Ext.state.Provider', alias: 'state.cookie' });

Ext.state.Manager = {
  provider: new (Ext.ClassManager.get('Ext.state.Provider'))(),
  setProvider(p: any) { this.provider = p; },
  getProvider() { return this.provider; },
  get(key: string, defaultValue?: any) { return this.provider.get(key, defaultValue); },
  set(key: string, value: any) { this.provider.set(key, value); },
  clear(key: string) { this.provider.clear(key); }
};
Ext.ClassManager.classes['Ext.state.Manager'] = Ext.state.Manager;
