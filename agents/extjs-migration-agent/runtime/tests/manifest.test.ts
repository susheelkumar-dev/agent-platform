/**
 * Writes manifest.json: the Ext JS surface this runtime implements (classes, aliases, Ext.* statics and the
 * methods of every class). The migration agent reads it to report framework usage the runtime lacks.
 * Run with `npm test` (it also checks a few entries).
 */
import Ext from '../src/index';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

/** Breadth-first walk of Ext, so an object reachable from several paths is listed under its shortest one. */
function statics(root: any, maxDepth: number, out: Set<string>) {
  const seen = new Set<any>([root]);
  let level: Array<[any, string]> = [[root, '']];
  for (let depth = 0; depth <= maxDepth && level.length; depth++) {
    const next: Array<[any, string]> = [];
    for (const [obj, prefix] of level) {
      const names = new Set<string>(Object.getOwnPropertyNames(obj));
      // singletons and instances (Ext.Ajax, Ext.Msg, Ext.state.Manager ...): list their methods too
      if (typeof obj === 'function') {
        // inherited statics (Ext.Promise.all comes from Promise)
        let p = Object.getPrototypeOf(obj);
        while (p && p !== Function.prototype && p !== Object.prototype) { for (const k of Object.getOwnPropertyNames(p)) { names.add(k); } p = Object.getPrototypeOf(p); }
      }
      if (obj !== root && (obj.isInstance || obj.isComponent || obj.isObservable)) {
        let p = Object.getPrototypeOf(obj);
        while (p && p !== Object.prototype) { for (const k of Object.getOwnPropertyNames(p)) { names.add(k); } p = Object.getPrototypeOf(p); }
      }
      for (const k of names) {
        if (k.startsWith('$') || k === 'global' || k === 'prototype' || k === 'length' || k === 'name' || k === 'caller' || k === 'arguments' || k === 'constructor') { continue; }
        let v: any;
        try { v = obj[k]; } catch (e) { continue; }
        const path = prefix ? prefix + '.' + k : k;
        out.add(path);
        if (v && (typeof v === 'object' || typeof v === 'function') && !v.nodeType && !seen.has(v)) { seen.add(v); next.push([v, path]); }
      }
    }
    level = next;
  }
}

test('write manifest.json', () => {
  const classes = Ext.ClassManager.getAll();
  const methods: Record<string, string[]> = {};
  const parents: Record<string, string> = {};
  const classStatics: Record<string, string[]> = {};
  for (const name of Object.keys(classes)) {
    const proto = classes[name] && classes[name].prototype;
    const cs = new Set<string>();
    let c = classes[name];
    while (c && c !== Function.prototype && c !== Object.prototype) { for (const k of Object.getOwnPropertyNames(c)) { if (!k.startsWith('$') && !['length', 'name', 'prototype', 'caller', 'arguments'].includes(k)) { cs.add(k); } } c = Object.getPrototypeOf(c); }
    classStatics[name] = Array.from(cs).sort();
    if (!proto) { continue; }
    methods[name] = Object.getOwnPropertyNames(proto).filter((k) => { if (k.startsWith('$') || k === 'constructor') { return false; } try { return typeof proto[k] === 'function'; } catch (e) { return false; } }).sort();
    const sup = Object.getPrototypeOf(proto);
    if (sup && sup.$className) { parents[name] = sup.$className; }
  }
  const st = new Set<string>();
  statics(Ext, 3, st);
  const manifest = {
    generated: 'npm test (tests/manifest.test.ts)',
    classes: Object.keys(classes).sort(),
    aliases: Object.keys(Ext.ClassManager.getAliasMap()).sort(),
    statics: Array.from(st).sort(),
    parents,
    classStatics,
    methods
  };
  writeFileSync(resolve(__dirname, '../manifest.json'), JSON.stringify(manifest));
  expect(manifest.classes).toContain('Ext.grid.Panel');
  expect(manifest.aliases).toContain('widget.cartesian');
  expect(manifest.statics).toContain('Msg');
  expect(manifest.statics).toContain('util.Format.number');
});
