/**
 * The approved display registry. The database names a display's implementation by key; only keys listed here
 * can be rendered, and each one is a static import the bundler can see. A registry entry never comes from the
 * server, so a database record cannot make the browser load arbitrary code.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { DisplayImplementation, DisplayMeta, DisplayProps, DisplayRegistry } from '../types';

export function defineDisplays(map: DisplayRegistry): DisplayRegistry {
  for (const [key, impl] of Object.entries(map)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw new Error(`defineDisplays: '${key}' is not a valid display key`);
    if (typeof impl.load !== 'function') throw new Error(`defineDisplays: '${key}' needs a load() function`);
  }
  return Object.freeze({ ...map });
}

/** Combine registries from several modules; a key defined twice is an error, not a silent override. */
export function mergeDisplays(...registries: DisplayRegistry[]): DisplayRegistry {
  const out: DisplayRegistry = {};
  for (const r of registries) {
    for (const [k, v] of Object.entries(r)) {
      if (out[k]) throw new Error(`Display key '${k}' is defined by two modules`);
      out[k] = v;
    }
  }
  return Object.freeze(out);
}

/** Plain (non-union) shape so it narrows the same with or without strictNullChecks in the host app. */
export interface Resolution {
  ok: boolean;
  component?: LazyExoticComponent<ComponentType<DisplayProps>>;
  impl?: DisplayImplementation;
  reason?: 'unknown-key' | 'wrong-type';
  message?: string;
}

const cache = new WeakMap<DisplayImplementation, LazyExoticComponent<ComponentType<DisplayProps>>>();

export function resolveDisplay(registry: DisplayRegistry, meta: DisplayMeta): Resolution {
  const impl = Object.prototype.hasOwnProperty.call(registry, meta.key) ? registry[meta.key] : undefined;
  if (!impl) {
    return { ok: false, reason: 'unknown-key', message: `“${meta.title}” is registered with implementation “${meta.key}”, which this build of the application does not include. Deploy the module that provides it.` };
  }
  if (impl.types && !impl.types.includes(meta.type)) {
    return { ok: false, reason: 'wrong-type', message: `Implementation “${meta.key}” serves ${impl.types.join(', ')} displays, not “${meta.type}”.` };
  }
  let component = cache.get(impl);
  if (!component) {
    component = lazy(impl.load);
    cache.set(impl, component);
  }
  return { ok: true, component, impl };
}
