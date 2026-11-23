/**
 * Ext.Loader / Ext.require: on-demand loading of application classes.
 *
 * Ext JS loaded class files on demand by name. Here classes are ES modules bundled by Vite, so the application
 * (its generated ext-modules.ts) registers one loader per class name or alias, each a dynamic import() of the
 * modules that class needs, in load order. Ext.require then returns a promise that resolves once they are defined:
 *
 *   Ext.Loader.register({ 'widget.gt-tradeblotter': () => import('./ext-screens/gt-tradeblotter') },
 *                       () => import('./ext-screens/all'));
 *   await Ext.require('widget.gt-tradeblotter');
 *   Ext.create({ xtype: 'gt-tradeblotter' });
 *
 * A name with no registered loader that is not defined yet makes the loader load everything (the fallback), so a
 * class referenced in a way the migrator could not see still loads.
 */
import { Ext } from './ext';

type LoadFn = () => Promise<unknown>;

const loaders: Record<string, LoadFn> = {};
const pending: Record<string, Promise<void>> = {};
let loadAllFn: LoadFn | null = null;
let allLoaded: Promise<void> | null = null;

function isDefined(name: string): boolean {
  const cm = Ext.ClassManager;
  if (!cm) { return false; }
  return !!cm.isCreated(name) || !!cm.getByAlias(name);
}

function loadOne(name: string): Promise<void> {
  if (isDefined(name)) { return Promise.resolve(); }
  const fn = loaders[name] || loaders['widget.' + name];
  if (!fn) { return Loader.loadAll(); }
  const key = loaders[name] ? name : 'widget.' + name;
  if (!pending[key]) {
    pending[key] = fn().then(() => undefined, (err) => { delete pending[key]; throw err; });
  }
  return pending[key];
}

export const Loader: any = {
  /** name or alias ('GT.view.trade.TradeBlotter', 'widget.gt-tradeblotter') -> loader; and the load-everything fallback */
  register(map: Record<string, LoadFn>, loadAll?: LoadFn) {
    Object.assign(loaders, map || {});
    if (loadAll) { loadAllFn = loadAll; }
  },
  /** true when the name has a registered loader (it may or may not have run yet) */
  isLazy(name: string) { return !!(loaders[name] || loaders['widget.' + name]); },
  isLoaded(name: string) { return isDefined(name); },
  load(names: string | string[]): Promise<void> {
    const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
    return Promise.all(list.map(loadOne)).then(() => undefined);
  },
  loadAll(): Promise<void> {
    if (!loadAllFn) { return Promise.resolve(); }
    if (!allLoaded) {
      const fn = loadAllFn;
      allLoaded = fn().then(() => undefined, (err) => { allLoaded = null; throw err; });
    }
    return allLoaded;
  },
  // Ext JS configuration calls: paths mean nothing to a bundled application
  setConfig() { return Loader; },
  setPath() { return Loader; },
  getConfig() { return { enabled: true }; },
};

Ext.Loader = Loader;

/** Ext.require(names, fn?, scope?): loads the classes, then calls fn. Returns a promise as well. */
Ext.require = function (names: string | string[], fn?: () => void, scope?: unknown): Promise<void> {
  const p = Loader.load(names);
  if (typeof fn === 'function') { p.then(() => fn.call(scope)); }
  return p;
};
/** Classes are imported before they are used, so there is nothing to load synchronously. */
Ext.syncRequire = function (_names: string | string[], fn?: () => void, scope?: unknown) {
  if (typeof fn === 'function') { fn.call(scope); }
};
