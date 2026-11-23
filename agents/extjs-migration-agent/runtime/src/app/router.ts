/**
 * Ext.util.History (hash tokens) and Ext.route.Router (routes declared on controllers: ':screen/:id',
 * optional '(...)' segments, conditions, before/action handlers, '|' separated multi-tokens, redirectTo).
 * As in Ext, connecting routes does not replay the current token; routes run on hash changes and on forced
 * redirects.
 */
import { Ext } from '../core/ext';
import { define } from '../core/class';
import '../core/observable';

export const History: any = new (define(null, {
  mixins: { observable: 'Ext.mixin.Observable' },
  constructor: function () {
    this.mixins.observable.constructor.call(this);
    this.currentToken = this.getToken();
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => {
        const token = this.getToken();
        if (token === this.currentToken && !this.$force) { return; }
        this.currentToken = token;
        this.fireEvent('change', token);
      });
    }
    return this;
  },
  init: function (cb?: any, scope?: any) { if (cb) { cb.call(scope || this, this); } this.ready = true; },
  getToken: function () { const h = (typeof window !== 'undefined' ? window.location.hash : '') || ''; return h ? decodeURIComponent(h.replace(/^#!?/, '')) : ''; },
  getHash: function () { return this.getToken(); },
  add: function (token: string, preventDuplicates = true) {
    if (preventDuplicates && token === this.getToken()) { return false; }
    window.location.hash = token;
    return true;
  },
  replace: function (token: string) {
    const url = window.location.href.replace(/#.*$/, '') + '#' + token;
    window.history.replaceState(null, '', url);
    this.currentToken = token;
    this.fireEvent('change', token);
    return true;
  },
  back: function () { window.history.back(); },
  forward: function () { window.history.forward(); }
}))();
Ext.util.History = History;
Ext.History = History;

const PARAM_DEFAULT = '([%a-zA-Z0-9\\-\\_\\s,]+)';

class Route {
  [k: string]: any;
  constructor(url: string, config: any, instance: any) {
    this.url = url;
    this.config = config;
    this.instance = instance;
    this.paramNames = [];
    const conditions = config.conditions || {};
    let src = '';
    let i = 0;
    while (i < url.length) {
      const ch = url.charAt(i);
      if (ch === ':') {
        let j = i + 1;
        while (j < url.length && /[\w]/.test(url.charAt(j))) { j++; }
        const name = url.substring(i + 1, j);
        this.paramNames.push(name);
        src += conditions[':' + name] || conditions[name] || PARAM_DEFAULT;
        i = j;
      } else if (ch === '(') { src += '(?:'; i++; }
      else if (ch === ')') { src += ')?'; i++; }
      else { src += Ext.String.escapeRegex(ch); i++; }
    }
    this.re = new RegExp('^' + src + '$', config.caseInsensitive ? 'i' : '');
  }
  recognize(token: string) {
    const m = this.re.exec(token);
    if (!m) { return null; }
    return m.slice(1).map((v) => (v === undefined ? undefined : decodeURIComponent(v)));
  }
  resolve(name: any) {
    if (typeof name === 'function') { return name; }
    const inst = this.instance;
    return inst && typeof inst[name] === 'function' ? inst[name].bind(inst) : null;
  }
  execute(token: string, args: any[]) {
    const cfg = this.config;
    const action = this.resolve(cfg.action);
    if (!action) { return; }
    if (cfg.before) {
      const before = this.resolve(cfg.before);
      if (before) {
        let done = false;
        const ctl = { resume: () => { if (!done) { done = true; action(...args); } }, stop: () => { done = true; } };
        before(...args, ctl);
        return;
      }
    }
    action(...args);
  }
}

export const Router: any = {
  routes: [] as Route[],
  multipleToken: '|',
  connect(url: string, config: any, instance: any) {
    if (typeof config === 'string' || typeof config === 'function') { config = { action: config }; }
    const r = new Route(url, config, instance);
    this.routes.push(r);
    return r;
  },
  disconnect(instance: any) { this.routes = this.routes.filter((r: Route) => r.instance !== instance); },
  onStateChange(token: string) {
    const tokens = String(token || '').split(this.multipleToken);
    for (const t of tokens) {
      let matched = false;
      for (const r of this.routes.slice()) {
        if (r.instance && r.instance.destroyed) { continue; }
        const args = r.recognize(t);
        if (args) { matched = true; r.execute(t, args); }
      }
      if (!matched) { Ext.GlobalEvents.fireEvent('unmatchedroute', t); }
    }
  },
  recognize(token: string) { for (const r of this.routes) { if (r.recognize(token)) { return r; } } return null; },
  suspend() { this.suspended = true; },
  resume() { this.suspended = false; }
};
History.on('change', (token: string) => { if (!Router.suspended) { Router.onStateChange(token); } });
Ext.route = Ext.route || {};
Ext.route.Router = Router;

/** redirectTo(token, options) as on Ext controllers and the application. */
export function redirectTo(token: any, options?: any) {
  if (token && token.isModel) { token = token.toUrl(); }
  const force = options === true || (options && options.force);
  const replace = options && options.replace;
  const current = History.getToken();
  if (token === current && !force) { return false; }
  if (token === current && force) { Router.onStateChange(token); return true; }
  if (replace) { History.replace(token); } else { History.add(token, false); }
  return true;
}
Ext.redirectTo = redirectTo;
