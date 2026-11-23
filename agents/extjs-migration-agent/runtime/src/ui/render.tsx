/**
 * React rendering infrastructure for Ext-style components.
 *
 * Every component instance is an observable "store" (version counter) rendered by <CmpView>, a memoized React
 * component subscribed with useSyncExternalStore, so a change re-renders only that component. Changes are
 * batched (markDirty) and flushed in a microtask with flushSync; code that reads the DOM (getEl(), view.getNode
 * ...) calls flushRender() first, so imperative Ext code sees an up-to-date DOM, as it does in Ext.
 * Floating components (windows, menus, pickers, toasts, tips) render in a body-level layer.
 */
import * as React from 'react';
import { useLayoutEffect, useRef, useSyncExternalStore, memo } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Ext } from '../core/ext';

const pending = new Set<any>();
let scheduled = false;
let commitDepth = 0;
let rendering = 0;

export function markDirty(cmp: any) {
  pending.add(cmp);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flushRender);
  }
}

export function flushRender() {
  scheduled = false;
  if (!pending.size) { return; }
  const list = Array.from(pending);
  pending.clear();
  const notify = () => { for (const c of list) { c.$notifyUI(); } };
  if (commitDepth > 0 || rendering > 0) {
    notify();
  } else {
    try { flushSync(notify); } catch (e) { notify(); }
  }
}
export function isPending(cmp?: any) { return cmp ? pending.has(cmp) : pending.size > 0; }
export function inCommit<T>(fn: () => T): T { commitDepth++; try { return fn(); } finally { commitDepth--; } }
Ext.flushRender = flushRender;

/** Renders one component; re-renders when the component calls markDirty(). */
export const CmpView: any = memo(function CmpView({ cmp }: { cmp: any }) {
  useSyncExternalStore(cmp.$subscribeUI, cmp.$getUIVersion);
  const ref = useRef<any>(null);
  useLayoutEffect(() => {
    const dom = ref.current;
    inCommit(() => cmp.$afterMount(dom));
    return () => { inCommit(() => cmp.$beforeUnmount(dom)); };
  }, [cmp]);
  useLayoutEffect(() => { if (Ext.$reapplyCls) { Ext.$reapplyCls(ref.current); } inCommit(() => cmp.$afterUpdate(ref.current)); });
  if (cmp.destroyed) { return null; }
  rendering++;
  try {
    return cmp.$renderUI(ref);
  } catch (e) {
    console.error('Render failed for ' + cmp.$className + ' (' + cmp.id + ')', e);
    return <div ref={ref} className="x-render-error">Render error in {String(cmp.$className)}: {String(e && (e as any).message)}</div>;
  } finally {
    rendering--;
  }
});

export function renderCmps(list: any[]) {
  return list.filter((c) => c && !c.destroyed).map((c) => <CmpView key={c.id} cmp={c} />);
}

// ---------------------------------------------------------------- floating layer + roots
const floating: { list: any[]; v: number; subs: Set<() => void> } = { list: [], v: 0, subs: new Set() };
const top: { list: any[]; v: number; subs: Set<() => void> } = { list: [], v: 0, subs: new Set() };

function bump(s: any) { s.v++; for (const cb of Array.from(s.subs) as any[]) { cb(); } }
const subFloat = (cb: () => void) => { floating.subs.add(cb); return () => floating.subs.delete(cb); };
const verFloat = () => floating.v;
const subTop = (cb: () => void) => { top.subs.add(cb); return () => top.subs.delete(cb); };
const verTop = () => top.v;

export function addFloating(cmp: any) {
  if (floating.list.indexOf(cmp) < 0) { floating.list.push(cmp); }
  ensureRoot();
  bump(floating);
}
export function removeFloating(cmp: any) {
  const i = floating.list.indexOf(cmp);
  if (i >= 0) { floating.list.splice(i, 1); bump(floating); }
}
export function floatingList() { return floating.list.slice(); }
export function refreshFloating() { bump(floating); }

export function addTopLevel(cmp: any) {
  if (top.list.indexOf(cmp) < 0) { top.list.push(cmp); }
  ensureRoot();
  bump(top);
}
export function removeTopLevel(cmp: any) {
  const i = top.list.indexOf(cmp);
  if (i >= 0) { top.list.splice(i, 1); bump(top); }
}

function FloatingLayer() {
  useSyncExternalStore(subFloat, verFloat);
  const list = floating.list.filter((c) => !c.destroyed);
  const sorted = list.slice().sort((a, b) => (a.$zIndex || 0) - (b.$zIndex || 0));
  const masks = sorted.filter((c) => c.modal && !c.hidden && c.rendered !== undefined);
  const topModal = masks.length ? masks[masks.length - 1] : null;
  return (
    <div className="x-floating-layer" style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'visible', zIndex: 19000 }}>
      {topModal ? <div className="x-mask x-mask-fixed x-modal-mask" style={{ position: 'fixed', inset: 0, zIndex: (topModal.$zIndex || 1) - 1 }}
        onMouseDown={(e) => { e.preventDefault(); if (topModal.focus) { topModal.focus(); } }} /> : null}
      {renderCmps(sorted)}
    </div>
  );
}

function TopLevel() {
  useSyncExternalStore(subTop, verTop);
  return <>{renderCmps(top.list)}</>;
}

function ExtRoot() {
  return <><TopLevel /><FloatingLayer /></>;
}

let root: any = null;
export function ensureRoot() {
  if (root || typeof document === 'undefined') { return; }
  let host = document.getElementById('ext-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ext-root';
    document.body.appendChild(host);
  }
  root = createRoot(host);
  try { flushSync(() => root.render(<ExtRoot />)); } catch (e) { root.render(<ExtRoot />); }
}

/** renderTo support: a component rendered into a specific element gets its own React root. */
export function renderInto(cmp: any, el: any) {
  const dom = el && el.dom ? el.dom : (typeof el === 'string' ? document.getElementById(el) : el);
  if (!dom) { throw new Error('renderTo: element not found'); }
  if (dom === document.body) { addTopLevel(cmp); return; }
  const host = document.createElement('div');
  host.className = 'x-render-host';
  dom.appendChild(host);
  const r = createRoot(host);
  cmp.$ownRoot = r;
  try { flushSync(() => r.render(<CmpView cmp={cmp} />)); } catch (e) { r.render(<CmpView cmp={cmp} />); }
}

// ---------------------------------------------------------------- helpers for render code
/** Ext margin/padding shorthand ('0 0 10 0', 5, '5 10') to CSS. */
export function boxValue(v: any): string | undefined {
  if (v === undefined || v === null || v === '') { return undefined; }
  if (typeof v === 'number') { return v + 'px'; }
  if (typeof v === 'object') { return [v.top, v.right, v.bottom, v.left].map((x) => (x || 0) + 'px').join(' '); }
  return String(v).trim().split(/\s+/).map((p) => (/^-?\d+(\.\d+)?$/.test(p) ? p + 'px' : p)).join(' ');
}
export function sizeValue(v: any): any {
  if (v === undefined || v === null || v === '') { return undefined; }
  if (typeof v === 'number') { return v + 'px'; }
  if (/^\d+(\.\d+)?$/.test(String(v))) { return v + 'px'; }
  return v;
}
/** CSS text ('a:b;c:d') or object to a React style object. */
export function styleObject(s: any): any {
  if (!s) { return {}; }
  if (typeof s === 'object') { return Object.assign({}, s); }
  const out: any = {};
  for (const part of String(s).split(';')) {
    const i = part.indexOf(':');
    if (i < 0) { continue; }
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) { continue; }
    out[k.replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = v;
  }
  return out;
}
export function clsList(...parts: any[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) { continue; }
    if (Array.isArray(p)) { out.push(clsList(...p)); } else { out.push(String(p)); }
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
export function html(v: any) { return { __html: v === undefined || v === null ? '' : String(v) }; }
