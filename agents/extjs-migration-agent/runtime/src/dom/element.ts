/**
 * Ext.dom.Element over real DOM nodes (Ext.get / Ext.fly / Ext.getDoc / Ext.getBody / Ext.select), the
 * Ext.event.Event wrapper passed to every DOM listener, alignment helpers (alignTo / getAlignToXY with
 * 'tl-bl?' style positions), masks, Ext.util.KeyMap and Ext.util.KeyNav.
 */
import { Ext } from '../core/ext';
import { define } from '../core/class';

const cache = new WeakMap<any, any>();

export function getDom(el: any): any {
  if (!el) { return null; }
  if (typeof el === 'string') { return document.getElementById(el); }
  if (el.dom) { return el.dom; }
  if (el.isComponent) { return el.el ? el.el.dom : null; }
  return el;
}
Ext.getDom = getDom;

// ---------------------------------------------------------------- Ext.event.Event
const KEYS: Record<string, number> = {
  BACKSPACE: 8, TAB: 9, NUM_CENTER: 12, ENTER: 13, RETURN: 13, SHIFT: 16, CTRL: 17, ALT: 18, PAUSE: 19, CAPS_LOCK: 20, ESC: 27,
  SPACE: 32, PAGE_UP: 33, PAGE_DOWN: 34, END: 35, HOME: 36, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, PRINT_SCREEN: 44, INSERT: 45,
  DELETE: 46, ZERO: 48, ONE: 49, TWO: 50, THREE: 51, FOUR: 52, FIVE: 53, SIX: 54, SEVEN: 55, EIGHT: 56, NINE: 57, CONTEXT_MENU: 93,
  NUM_ZERO: 96, NUM_ONE: 97, NUM_TWO: 98, NUM_THREE: 99, NUM_FOUR: 100, NUM_FIVE: 101, NUM_SIX: 102, NUM_SEVEN: 103, NUM_EIGHT: 104,
  NUM_NINE: 105, NUM_MULTIPLY: 106, NUM_PLUS: 107, NUM_MINUS: 109, NUM_PERIOD: 110, NUM_DIVISION: 111,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123
};
for (let i = 0; i < 26; i++) { KEYS[String.fromCharCode(65 + i)] = 65 + i; }

export class ExtEvent {
  [k: string]: any;
  constructor(browserEvent: any) {
    this.browserEvent = browserEvent;
    this.type = browserEvent.type;
    this.target = browserEvent.target && browserEvent.target.nodeType === 3 ? browserEvent.target.parentNode : browserEvent.target;
    this.currentTarget = browserEvent.currentTarget;
    this.relatedTarget = browserEvent.relatedTarget;
    this.button = browserEvent.button;
    this.ctrlKey = browserEvent.ctrlKey; this.shiftKey = browserEvent.shiftKey; this.altKey = browserEvent.altKey; this.metaKey = browserEvent.metaKey;
    this.keyCode = browserEvent.keyCode; this.charCode = browserEvent.charCode; this.key = browserEvent.key;
    this.pageX = browserEvent.pageX; this.pageY = browserEvent.pageY;
    this.clientX = browserEvent.clientX; this.clientY = browserEvent.clientY;
    this.which = browserEvent.which;
    this.wheelDelta = browserEvent.wheelDelta;
  }
  getTarget(selector?: string, maxDepth?: any, returnEl?: boolean) {
    let t = this.target;
    if (!selector) { return returnEl ? Ext.get(t) : t; }
    const limit = typeof maxDepth === 'number' ? maxDepth : 50;
    const stopAt = maxDepth && typeof maxDepth === 'object' ? getDom(maxDepth) : document.body;
    let depth = 0;
    while (t && t.nodeType === 1 && depth <= limit) {
      if (t.matches && t.matches(selector)) { return returnEl ? Ext.get(t) : t; }
      if (t === stopAt) { break; }
      t = t.parentNode;
      depth++;
    }
    return null;
  }
  getRelatedTarget(selector?: string, maxDepth?: number, returnEl?: boolean) {
    let t = this.relatedTarget;
    if (!selector) { return returnEl ? Ext.get(t) : t; }
    while (t && t.nodeType === 1) { if (t.matches(selector)) { return returnEl ? Ext.get(t) : t; } t = t.parentNode; }
    void maxDepth;
    return null;
  }
  getKey() { return this.keyCode || this.charCode; }
  getCharCode() { return this.charCode || this.keyCode; }
  getXY() { return [this.pageX, this.pageY]; }
  getX() { return this.pageX; }
  getY() { return this.pageY; }
  getPageX() { return this.pageX; }
  getPageY() { return this.pageY; }
  getPoint() { return { x: this.pageX, y: this.pageY }; }
  getWheelDelta() { const d = this.browserEvent.deltaY || 0; return d ? -Math.sign(d) : 0; }
  getWheelDeltas() { return { x: this.browserEvent.deltaX || 0, y: this.browserEvent.deltaY || 0 }; }
  stopEvent() { this.preventDefault(); this.stopPropagation(); return this; }
  stopPropagation() { this.browserEvent.stopPropagation(); this.isStopped = true; return this; }
  preventDefault() { if (this.browserEvent.cancelable !== false) { this.browserEvent.preventDefault(); } this.defaultPrevented = true; return this; }
  within(el: any, related?: boolean, allowEl?: boolean) {
    const dom = getDom(el);
    const t = related ? this.getRelatedTarget() : this.getTarget();
    return !!(dom && t && (allowEl || t !== dom) && (dom === t || dom.contains(t)));
  }
  isSpecialKey() { const k = this.getKey(); return k === 9 || k === 13 || k === 27 || k === 8 || (k >= 33 && k <= 40) || k === 45 || k === 46 || (k >= 112 && k <= 123); }
  isNavKeyPress() { const k = this.getKey(); return (k >= 33 && k <= 40) || k === 13 || k === 9 || k === 27; }
  hasModifier() { return !!(this.ctrlKey || this.altKey || this.shiftKey || this.metaKey); }
  injectEvent() { /* not supported */ }
}
Object.assign(ExtEvent, KEYS);
Object.assign(ExtEvent.prototype, KEYS);
Ext.event = Ext.event || {};
Ext.event.Event = ExtEvent;
Ext.EventObject = ExtEvent;
Ext.ClassManager.classes['Ext.event.Event'] = ExtEvent;

// ---------------------------------------------------------------- alignment
function parseAlign(pos: string) {
  pos = pos || 'tl-bl';
  const constrain = /\?$/.test(pos) || pos.indexOf('?') >= 0;
  pos = pos.replace('?', '');
  if (pos.indexOf('-') < 0) { pos = 'tl-' + pos; }
  const [a, b] = pos.split('-');
  return { el: a, target: b, constrain };
}
function anchorPoint(box: any, spec: string) {
  const w = box.width, h = box.height;
  switch (spec) {
    case 'tl': return [0, 0];
    case 't': return [w / 2, 0];
    case 'tr': return [w, 0];
    case 'l': return [0, h / 2];
    case 'c': return [w / 2, h / 2];
    case 'r': return [w, h / 2];
    case 'bl': return [0, h];
    case 'b': return [w / 2, h];
    case 'br': return [w, h];
    default: return [0, 0];
  }
}
export function alignXY(elSize: { width: number; height: number }, targetBox: any, position?: string, offsets?: number[]) {
  const p = parseAlign(position || 'tl-bl?');
  const tp = anchorPoint(targetBox, p.target);
  const ep = anchorPoint(elSize, p.el);
  let x = targetBox.x + tp[0] - ep[0] + ((offsets && offsets[0]) || 0);
  let y = targetBox.y + tp[1] - ep[1] + ((offsets && offsets[1]) || 0);
  if (p.constrain || true) {
    const vw = window.innerWidth + window.scrollX, vh = window.innerHeight + window.scrollY;
    if (x + elSize.width > vw - 2) {
      // try the other side of the target horizontally
      x = Math.max(window.scrollX + 2, Math.min(x, vw - elSize.width - 2));
    }
    if (y + elSize.height > vh - 2) {
      const above = targetBox.y - elSize.height - ((offsets && offsets[1]) || 0);
      y = above >= window.scrollY + 2 && p.target.charAt(0) === 'b' ? above : Math.max(window.scrollY + 2, vh - elSize.height - 2);
    }
    x = Math.max(window.scrollX + 2, x);
    y = Math.max(window.scrollY + 2, y);
  }
  return [Math.round(x), Math.round(y)];
}

function boxOf(dom: any) {
  if (!dom || !dom.getBoundingClientRect) { return { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
  const r = dom.getBoundingClientRect();
  const x = r.left + window.scrollX, y = r.top + window.scrollY;
  return { x, y, left: x, top: y, width: r.width, height: r.height, right: x + r.width, bottom: y + r.height, 0: x, 1: y };
}

// ---------------------------------------------------------------- Element
export const Element: any = define('Ext.dom.Element', {
  isElement: true,
  constructor: function (dom: any) {
    this.dom = dom;
    this.id = dom && dom.id;
    return this;
  },
  getId: function () { return this.dom.id || (this.dom.id = Ext.id()); },
  addCls: function (cls: any) {
    const dom = this.dom;
    if (!dom || !dom.classList) { return this; }
    const keep = dom.$extCls || (dom.$extCls = new Set());
    for (const c of Ext.Array.from(cls)) { for (const p of String(c || '').split(/\s+/)) { if (p) { dom.classList.add(p); keep.add(p); } } }
    return this;
  },
  removeCls: function (cls: any) {
    const dom = this.dom;
    if (!dom || !dom.classList) { return this; }
    for (const c of Ext.Array.from(cls)) { for (const p of String(c || '').split(/\s+/)) { if (p) { dom.classList.remove(p); if (dom.$extCls) { dom.$extCls.delete(p); } } } }
    return this;
  },
  toggleCls: function (cls: string, state?: boolean) { if (state === undefined) { state = !this.hasCls(cls); } return state ? this.addCls(cls) : this.removeCls(cls); },
  hasCls: function (cls: string) { return !!(this.dom && this.dom.classList && this.dom.classList.contains(cls)); },
  replaceCls: function (oldCls: string, newCls: string) { return this.removeCls(oldCls).addCls(newCls); },
  radioCls: function (cls: string) { const p = this.dom.parentNode; if (p) { for (const s of p.children) { s.classList.remove(cls); } } return this.addCls(cls); },
  setStyle: function (prop: any, value?: any) {
    const st = this.dom.style;
    if (typeof prop === 'string' && value === undefined && prop.indexOf(':') > 0) {
      for (const part of prop.split(';')) { const [k, v] = part.split(':'); if (k && v !== undefined) { st.setProperty(k.trim(), v.trim()); } }
      return this;
    }
    const set = (k: string, v: any) => {
      if (typeof v === 'number' && !/^(opacity|zIndex|z-index|flex|fontWeight|lineHeight|order)$/.test(k)) { v = v + 'px'; }
      if (k.indexOf('-') > 0) { st.setProperty(k, v === null ? '' : v); } else { st[k] = v === null ? '' : v; }
    };
    if (typeof prop === 'object') { for (const k in prop) { set(k, prop[k]); } } else { set(prop, value); }
    return this;
  },
  applyStyles: function (s: any) { return this.setStyle(s); },
  getStyle: function (prop: any) {
    const cs = window.getComputedStyle(this.dom);
    if (Ext.isArray(prop)) { const out = {}; for (const p of prop) { out[p] = cs[p]; } return out; }
    return cs[prop];
  },
  setHtml: function (html: any) { this.dom.innerHTML = html === undefined || html === null ? '' : html; return this; },
  update: function (html: any) { return this.setHtml(html); },
  getHtml: function () { return this.dom.innerHTML; },
  getText: function () { return this.dom.textContent; },
  getBox: function (contentBox?: boolean, local?: boolean) {
    const b = boxOf(this.dom);
    if (local) { b.x = b.left = this.dom.offsetLeft; b.y = b.top = this.dom.offsetTop; b.right = b.x + b.width; b.bottom = b.y + b.height; }
    void contentBox;
    return b;
  },
  getRegion: function () {
    const b = boxOf(this.dom);
    return Object.assign(b, {
      contains: (r: any) => r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom,
      containsPoint: (p: any) => p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom
    });
  },
  getViewRegion: function () { return this.getRegion(); },
  getXY: function () { const b = boxOf(this.dom); return [b.x, b.y]; },
  getX: function () { return this.getXY()[0]; },
  getY: function () { return this.getXY()[1]; },
  setXY: function (xy: number[]) {
    const st = this.dom.style;
    if (window.getComputedStyle(this.dom).position === 'static') { st.position = 'absolute'; }
    const parent = this.dom.offsetParent;
    const pb = parent && parent !== document.body ? boxOf(parent) : { x: 0, y: 0 };
    if (xy[0] !== undefined && xy[0] !== null) { st.left = (xy[0] - pb.x) + 'px'; }
    if (xy[1] !== undefined && xy[1] !== null) { st.top = (xy[1] - pb.y) + 'px'; }
    return this;
  },
  setX: function (x: number) { return this.setXY([x, null]); },
  setY: function (y: number) { return this.setXY([null, y]); },
  setLeft: function (v: any) { this.dom.style.left = typeof v === 'number' ? v + 'px' : v; return this; },
  setTop: function (v: any) { this.dom.style.top = typeof v === 'number' ? v + 'px' : v; return this; },
  getLeft: function (local?: boolean) { return local ? this.dom.offsetLeft : this.getX(); },
  getTop: function (local?: boolean) { return local ? this.dom.offsetTop : this.getY(); },
  getWidth: function (contentWidth?: boolean) { return contentWidth ? this.dom.clientWidth : this.dom.offsetWidth; },
  getHeight: function (contentHeight?: boolean) { return contentHeight ? this.dom.clientHeight : this.dom.offsetHeight; },
  getSize: function () { return { width: this.dom.offsetWidth, height: this.dom.offsetHeight }; },
  getViewSize: function () {
    if (this.dom === document || this.dom === document.body || this.dom === document.documentElement) { return { width: window.innerWidth, height: window.innerHeight }; }
    return { width: this.dom.clientWidth, height: this.dom.clientHeight };
  },
  setWidth: function (w: any) { this.dom.style.width = typeof w === 'number' ? w + 'px' : w; return this; },
  setHeight: function (h: any) { this.dom.style.height = typeof h === 'number' ? h + 'px' : h; return this; },
  setSize: function (w: any, h?: any) { if (typeof w === 'object') { h = w.height; w = w.width; } if (w !== undefined) { this.setWidth(w); } if (h !== undefined) { this.setHeight(h); } return this; },
  getScroll: function () { const d = this.dom; if (d === document || d === document.body) { return { left: window.scrollX, top: window.scrollY }; } return { left: d.scrollLeft, top: d.scrollTop }; },
  getScrollTop: function () { return this.dom.scrollTop; },
  getScrollLeft: function () { return this.dom.scrollLeft; },
  setScrollTop: function (v: number) { this.dom.scrollTop = v; return this; },
  setScrollLeft: function (v: number) { this.dom.scrollLeft = v; return this; },
  scrollTo: function (side: string, value: number) { if (/top/i.test(side)) { this.dom.scrollTop = value; } else { this.dom.scrollLeft = value; } return this; },
  scrollBy: function (x: any, y?: number) { if (Ext.isArray(x)) { y = x[1]; x = x[0]; } this.dom.scrollLeft += x || 0; this.dom.scrollTop += y || 0; return this; },
  scrollIntoView: function (container?: any, hscroll?: boolean) { if (this.dom.scrollIntoView) { this.dom.scrollIntoView({ block: 'nearest', inline: hscroll === false ? 'nearest' : 'nearest' }); } void container; return this; },
  isScrollable: function () { const d = this.dom; return d.scrollHeight > d.clientHeight || d.scrollWidth > d.clientWidth; },
  show: function () { this.dom.style.display = ''; return this; },
  hide: function () { this.dom.style.display = 'none'; return this; },
  setVisible: function (v: boolean) { return v ? this.show() : this.hide(); },
  setDisplayed: function (v: any) { this.dom.style.display = v === false || v === 'none' ? 'none' : (typeof v === 'string' ? v : ''); return this; },
  isDisplayed: function () { return window.getComputedStyle(this.dom).display !== 'none'; },
  isVisible: function (deep?: boolean) {
    const d = this.dom;
    if (!d || !d.isConnected) { return false; }
    if (deep) { return !!(d.offsetWidth || d.offsetHeight || d.getClientRects().length); }
    const cs = window.getComputedStyle(d);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  },
  setOpacity: function (o: number) { this.dom.style.opacity = String(o); return this; },
  // ---- traversal
  select: function (selector: string) { return new CompositeElement(Array.from(this.dom.querySelectorAll(selector))); },
  query: function (selector: string, asDom = true) { const nodes = Array.from(this.dom.querySelectorAll(selector)); return asDom ? nodes : nodes.map((n) => Ext.get(n)); },
  down: function (selector: string, returnDom?: boolean) { const n = this.dom.querySelector(selector); return returnDom ? n : (n ? Ext.get(n) : null); },
  child: function (selector: string, returnDom?: boolean) {
    const n = Array.from(this.dom.children).find((c: any) => c.matches(selector));
    return returnDom ? n || null : (n ? Ext.get(n) : null);
  },
  up: function (selector: string, limit?: any, returnDom?: boolean) {
    let n = this.dom.parentNode, depth = 0;
    const max = typeof limit === 'number' ? limit : 50;
    const stop = limit && typeof limit === 'object' ? getDom(limit) : null;
    while (n && n.nodeType === 1 && depth < max) {
      if (n.matches(selector)) { return returnDom ? n : Ext.get(n); }
      if (n === stop) { break; }
      n = n.parentNode; depth++;
    }
    return null;
  },
  findParent: function (selector: string, limit?: any, returnEl?: boolean) {
    let n = this.dom, depth = 0;
    const max = typeof limit === 'number' ? limit : 50;
    while (n && n.nodeType === 1 && depth <= max) { if (n.matches(selector)) { return returnEl ? Ext.get(n) : n; } n = n.parentNode; depth++; }
    return null;
  },
  findParentNode: function (selector: string, limit?: any, returnEl?: boolean) { return Ext.get(this.dom.parentNode).findParent(selector, limit, returnEl); },
  parent: function (selector?: string, returnDom?: boolean) {
    let n = this.dom.parentNode;
    if (selector) { while (n && n.nodeType === 1 && !n.matches(selector)) { n = n.parentNode; } }
    return returnDom ? n : (n && n.nodeType === 1 ? Ext.get(n) : null);
  },
  first: function (selector?: string, returnDom?: boolean) { const n = Array.from(this.dom.children).find((c: any) => !selector || c.matches(selector)); return returnDom ? n : (n ? Ext.get(n) : null); },
  last: function (selector?: string, returnDom?: boolean) { const n = Array.from(this.dom.children).reverse().find((c: any) => !selector || c.matches(selector)); return returnDom ? n : (n ? Ext.get(n) : null); },
  next: function (selector?: string, returnDom?: boolean) { let n = this.dom.nextElementSibling; while (n && selector && !n.matches(selector)) { n = n.nextElementSibling; } return returnDom ? n : (n ? Ext.get(n) : null); },
  prev: function (selector?: string, returnDom?: boolean) { let n = this.dom.previousElementSibling; while (n && selector && !n.matches(selector)) { n = n.previousElementSibling; } return returnDom ? n : (n ? Ext.get(n) : null); },
  is: function (selector: string) { return !!(this.dom.matches && this.dom.matches(selector)); },
  contains: function (el: any) { const d = getDom(el); return !!d && (this.dom === d || this.dom.contains(d)); },
  isAncestor: function (el: any) { return this.contains(el); },
  // ---- attributes / values
  getAttribute: function (name: string) { return this.dom.getAttribute(name); },
  set: function (attrs: any) {
    for (const k in attrs) { const v = attrs[k]; if (k === 'style') { this.setStyle(v); } else if (v === undefined || v === null) { this.dom.removeAttribute(k); } else { this.dom.setAttribute(k, v); } }
    return this;
  },
  getValue: function (asNumber?: boolean) { const v = this.dom.value; return asNumber ? parseInt(v, 10) : v; },
  focus: function (defer?: number) { const d = this.dom; if (defer) { setTimeout(() => d.focus && d.focus(), defer); } else if (d.focus) { d.focus(); } return this; },
  blur: function () { if (this.dom.blur) { this.dom.blur(); } return this; },
  // ---- dom building
  appendChild: function (el: any) {
    if (typeof el === 'string' || (el && !el.nodeType && !el.dom)) { return this.createChild(el); }
    this.dom.appendChild(getDom(el));
    return Ext.get(el);
  },
  createChild: function (config: any, insertBefore?: any, returnDom?: boolean) {
    const node = typeof config === 'string' ? htmlToNode(config) : Ext.DomHelper.createDom(config);
    if (insertBefore) { this.dom.insertBefore(node, getDom(insertBefore)); } else { this.dom.appendChild(node); }
    return returnDom ? node : Ext.get(node);
  },
  insertHtml: function (where: string, html: string, returnEl?: boolean) {
    const map = { beforebegin: 'beforebegin', afterbegin: 'afterbegin', beforeend: 'beforeend', afterend: 'afterend' };
    this.dom.insertAdjacentHTML(map[String(where).toLowerCase()] || 'beforeend', html);
    return returnEl ? Ext.get(this.dom.lastChild) : this.dom.lastChild;
  },
  insertFirst: function (el: any) { const d = getDom(el) || htmlToNode(el); this.dom.insertBefore(d, this.dom.firstChild); return Ext.get(d); },
  insertBefore: function (el: any) { const d = getDom(el); d.parentNode.insertBefore(this.dom, d); return this; },
  insertAfter: function (el: any) { const d = getDom(el); d.parentNode.insertBefore(this.dom, d.nextSibling); return this; },
  remove: function () { if (this.dom && this.dom.parentNode) { this.dom.parentNode.removeChild(this.dom); } return this; },
  destroy: function () { this.remove(); this.destroyed = true; },
  // ---- events
  on: function (ename: any, fn?: any, scope?: any, options?: any) { return elementOn(this, ename, fn, scope, options); },
  addListener: function (ename: any, fn?: any, scope?: any, options?: any) { return elementOn(this, ename, fn, scope, options); },
  un: function (ename: any, fn?: any, scope?: any) { elementUn(this, ename, fn, scope); return this; },
  removeListener: function (ename: any, fn?: any, scope?: any) { elementUn(this, ename, fn, scope); return this; },
  clearListeners: function () { for (const l of this.$listeners || []) { this.dom.removeEventListener(l.type, l.handler, l.capture); } this.$listeners = []; },
  // ---- masks / effects
  mask: function (msg?: string, msgCls?: string) {
    const dom = this.dom;
    if (window.getComputedStyle(dom).position === 'static') { dom.style.position = 'relative'; }
    this.unmask();
    const m = document.createElement('div');
    m.className = 'x-mask' + (msg ? '' : ' x-mask-transparent');
    if (msg) { m.innerHTML = '<div class="x-mask-msg ' + (msgCls || '') + '"><div class="x-mask-msg-inner"><div class="x-mask-msg-text">' + msg + '</div></div></div>'; }
    dom.appendChild(m);
    this.$mask = m;
    dom.classList.add('x-masked');
    return Ext.get(m);
  },
  unmask: function () { if (this.$mask) { this.$mask.remove(); this.$mask = null; } if (this.dom) { this.dom.classList.remove('x-masked'); } },
  isMasked: function () { return !!this.$mask; },
  fadeOut: function (o?: any) {
    o = o || {};
    const dom = this.dom;
    const dur = o.duration === undefined ? 300 : o.duration;
    dom.style.transition = 'opacity ' + dur + 'ms';
    dom.style.opacity = '0';
    setTimeout(() => {
      if (o.remove || o.destroy) { this.remove(); } else if (o.useDisplay !== false) { dom.style.display = 'none'; }
      if (o.callback) { o.callback.call(o.scope || this); }
    }, dur);
    return this;
  },
  fadeIn: function (o?: any) { o = o || {}; const dom = this.dom; dom.style.display = ''; dom.style.opacity = '0'; dom.style.transition = 'opacity ' + (o.duration || 300) + 'ms'; requestAnimationFrame(() => { dom.style.opacity = '1'; }); if (o.callback) { setTimeout(() => o.callback.call(o.scope || this), o.duration || 300); } return this; },
  animate: function (cfg: any) { if (cfg && cfg.to) { this.setStyle(cfg.to); } if (cfg && cfg.callback) { setTimeout(() => cfg.callback.call(cfg.scope || this), 0); } return this; },
  slideIn: function () { return this.show(); },
  slideOut: function () { return this.hide(); },
  highlight: function () { return this; },
  frame: function () { return this; },
  // ---- alignment
  getAlignToXY: function (target: any, position?: string, offsets?: number[]) {
    const t = target && target.length === 2 && typeof target[0] === 'number' ? { x: target[0], y: target[1], width: 0, height: 0 } : boxOf(getDom(target));
    return alignXY({ width: this.dom.offsetWidth, height: this.dom.offsetHeight }, t, position, offsets);
  },
  alignTo: function (target: any, position?: string, offsets?: number[]) { return this.setXY(this.getAlignToXY(target, position, offsets)); },
  getAnchorXY: function (anchor?: string) { const b = boxOf(this.dom); const p = anchorPoint(b, anchor || 'tl'); return [b.x + p[0], b.y + p[1]]; },
  center: function (centerIn?: any) { void centerIn; const w = this.dom.offsetWidth, h = this.dom.offsetHeight; return this.setXY([Math.max(0, (window.innerWidth - w) / 2), Math.max(0, (window.innerHeight - h) / 2)]); },
  getScrollParent: function () { let n = this.dom.parentNode; while (n && n.nodeType === 1) { const cs = window.getComputedStyle(n); if (/(auto|scroll)/.test(cs.overflow + cs.overflowY + cs.overflowX)) { return Ext.get(n); } n = n.parentNode; } return Ext.getBody(); },
  statics: {
    get: (el: any) => Ext.get(el),
    fly: (el: any) => Ext.fly(el),
    getViewportWidth: () => window.innerWidth,
    getViewportHeight: () => window.innerHeight,
    getViewSize: () => ({ width: window.innerWidth, height: window.innerHeight }),
    getDocumentWidth: () => Math.max(document.documentElement.scrollWidth, window.innerWidth),
    getDocumentHeight: () => Math.max(document.documentElement.scrollHeight, window.innerHeight),
    select: (selector: string, root?: any) => new CompositeElement(Array.from((getDom(root) || document).querySelectorAll(selector))),
    query: (selector: string, asDom = true, root?: any) => { const n = Array.from((getDom(root) || document).querySelectorAll(selector)); return asDom ? n : n.map((x) => Ext.get(x)); }
  }
});
Ext.Element = Element;
Ext.dom.Element = Element;

function htmlToNode(html: string) { const t = document.createElement('div'); t.innerHTML = html; return t.firstChild; }

// ---- DOM event plumbing (Ext semantics: Ext.event.Event, delegate, single, buffer, delay, stopEvent ...)
function elementOn(el: any, ename: any, fn?: any, scope?: any, options?: any) {
  if (ename && typeof ename === 'object') {
    const cfg = ename;
    const shared: any = {};
    for (const k of ['scope', 'delegate', 'single', 'buffer', 'delay', 'stopEvent', 'preventDefault', 'stopPropagation', 'capture', 'destroyable', 'args']) { if (k in cfg) { shared[k] = cfg[k]; } }
    const ds = [];
    for (const name in cfg) {
      if (name in shared) { continue; }
      const v = cfg[name];
      if (typeof v === 'function' || typeof v === 'string') { ds.push(elementOn(el, name, v, shared.scope, Ext.apply({}, shared, { destroyable: true }))); }
      else if (v && typeof v === 'object') { ds.push(elementOn(el, name, v.fn, v.scope !== undefined ? v.scope : shared.scope, Ext.apply({}, v, shared, { destroyable: true }))); }
    }
    return shared.destroyable ? { destroy: () => ds.forEach((d) => d && d.destroy && d.destroy()) } : el;
  }
  options = options || {};
  const dom = el.dom;
  if (!dom) { return options.destroyable ? { destroy: Ext.emptyFn } : el; }
  let type = String(ename).toLowerCase();
  const map = { mouseenter: 'mouseenter', mouseleave: 'mouseleave', dblclick: 'dblclick', contextmenu: 'contextmenu', mousewheel: 'wheel' };
  type = map[type] || type;
  let timer = null;
  const handler = function (be: any) {
    const e = be.$extEvent || (be.$extEvent = new ExtEvent(be));
    let t = dom;
    if (options.delegate) {
      t = e.getTarget(options.delegate, dom);
      if (!t || !dom.contains(t)) { return; }
      e.delegatedTarget = t;
    }
    if (options.stopEvent) { e.stopEvent(); }
    if (options.preventDefault) { e.preventDefault(); }
    if (options.stopPropagation) { e.stopPropagation(); }
    let f = fn, s = scope;
    if (typeof f === 'string') { s = s || el; f = s[f]; }
    const call = () => f.apply(s || el, (options.args || []).concat([e, options.delegate ? t : e.getTarget(), options]));
    if (options.single) { elementUn(el, ename, fn, scope); }
    if (options.buffer) { if (timer) { clearTimeout(timer); } timer = setTimeout(call, options.buffer); }
    else if (options.delay) { setTimeout(call, options.delay); }
    else { call(); }
  };
  dom.addEventListener(type, handler, !!options.capture);
  (el.$listeners = el.$listeners || []).push({ ename: String(ename).toLowerCase(), type, fn, scope, handler, capture: !!options.capture });
  if (options.destroyable) { return { destroy: () => elementUn(el, ename, fn, scope) }; }
  return el;
}
function elementUn(el: any, ename: any, fn?: any, scope?: any) {
  if (ename && typeof ename === 'object') { for (const n in ename) { if (n !== 'scope') { const v = ename[n]; elementUn(el, n, typeof v === 'object' && v ? v.fn : v, ename.scope); } } return; }
  const list = el.$listeners || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const l = list[i];
    if (l.ename === String(ename).toLowerCase() && (!fn || l.fn === fn) && (scope === undefined || !l.scope || l.scope === scope)) {
      el.dom && el.dom.removeEventListener(l.type, l.handler, l.capture);
      list.splice(i, 1);
      if (fn) { break; }
    }
  }
}

// ---------------------------------------------------------------- CompositeElement (Ext.select results)
export class CompositeElement {
  elements: any[];
  isComposite = true;
  constructor(nodes: any[]) { this.elements = nodes; }
  getCount() { return this.elements.length; }
  item(i: number) { return this.elements[i] ? Ext.get(this.elements[i]) : null; }
  first() { return this.item(0); }
  last() { return this.item(this.elements.length - 1); }
  each(fn: any, scope?: any) { this.elements.forEach((n, i) => fn.call(scope || n, Ext.get(n), this, i)); return this; }
  indexOf(el: any) { return this.elements.indexOf(getDom(el)); }
  addCls(c: any) { return this.each((e) => e.addCls(c)); }
  removeCls(c: any) { return this.each((e) => e.removeCls(c)); }
  toggleCls(c: any, s?: boolean) { return this.each((e) => e.toggleCls(c, s)); }
  setStyle(p: any, v?: any) { return this.each((e) => e.setStyle(p, v)); }
  setHtml(h: any) { return this.each((e) => e.setHtml(h)); }
  set(a: any) { return this.each((e) => e.set(a)); }
  show() { return this.each((e) => e.show()); }
  hide() { return this.each((e) => e.hide()); }
  setDisplayed(v: any) { return this.each((e) => e.setDisplayed(v)); }
  on(n: any, f?: any, s?: any, o?: any) { return this.each((e) => e.on(n, f, s, o)); }
  un(n: any, f?: any, s?: any) { return this.each((e) => e.un(n, f, s)); }
  remove() { return this.each((e) => e.remove()); }
  destroy() { this.remove(); }
  slice(a?: number, b?: number) { return this.elements.slice(a, b); }
}
Ext.dom.CompositeElementLite = Ext.dom.CompositeElement = Ext.CompositeElementLite = CompositeElement;

// ---------------------------------------------------------------- Ext.get / fly / doc / body
Ext.get = function (el: any) {
  if (!el) { return null; }
  if (el.isElement) { return el; }
  if (el.isComponent) { return el.getEl ? el.getEl() : null; }
  let dom = el;
  if (typeof el === 'string') { dom = document.getElementById(el); if (!dom) { return null; } }
  if (dom === window) { dom = document; }
  let wrapped = cache.get(dom);
  if (!wrapped) { wrapped = new Element(dom); cache.set(dom, wrapped); }
  return wrapped;
};
Ext.fly = function (el: any) { return Ext.get(el); };
Ext.getDoc = function () { return Ext.get(document); };
Ext.getBody = function () { return Ext.get(document.body); };
Ext.getHead = function () { return Ext.get(document.head); };
Ext.select = (selector: string, root?: any) => Element.select(selector, root);
Ext.query = (selector: string, asDom = true, root?: any) => Element.query(selector, asDom, root);
Ext.removeNode = (n: any) => { const d = getDom(n); if (d && d.parentNode) { d.parentNode.removeChild(d); } };

// Ext.DomHelper: create elements from {tag, cls, html, children, ...} specs
Ext.DomHelper = Ext.dom.Helper = {
  markup(spec: any): string {
    if (typeof spec === 'string') { return spec; }
    if (Ext.isArray(spec)) { return spec.map((s) => Ext.DomHelper.markup(s)).join(''); }
    const tag = spec.tag || 'div';
    let attrs = '';
    for (const k in spec) {
      if (k === 'tag' || k === 'children' || k === 'cn' || k === 'html' || k === 'tpl' || spec[k] === undefined || spec[k] === null) { continue; }
      const name = k === 'cls' ? 'class' : k;
      const v = k === 'style' && typeof spec[k] === 'object' ? Object.keys(spec[k]).map((s) => s + ':' + spec[k][s]).join(';') : spec[k];
      attrs += ' ' + name + '="' + Ext.String.htmlEncode(String(v)) + '"';
    }
    const kids = spec.children || spec.cn;
    return '<' + tag + attrs + '>' + (spec.html || '') + (kids ? Ext.DomHelper.markup(kids) : '') + '</' + tag + '>';
  },
  createDom(spec: any) { return htmlToNode(Ext.DomHelper.markup(spec)); },
  append(el: any, spec: any, returnEl?: boolean) { const n = Ext.DomHelper.createDom(spec); getDom(el).appendChild(n); return returnEl ? Ext.get(n) : n; },
  overwrite(el: any, spec: any, returnEl?: boolean) { const d = getDom(el); d.innerHTML = Ext.DomHelper.markup(spec); return returnEl ? Ext.get(d.firstChild) : d.firstChild; },
  insertHtml(where: string, el: any, html: string) { getDom(el).insertAdjacentHTML(where, html); }
};

// ---------------------------------------------------------------- KeyMap / KeyNav
function keyMatches(binding: any, e: ExtEvent) {
  const k = e.getKey();
  const keys = Ext.Array.from(binding.key).map((x: any) => (typeof x === 'string' ? (x.length === 1 ? x.toUpperCase().charCodeAt(0) : KEYS[x.toUpperCase()]) : x));
  if (binding.key !== undefined && keys.indexOf(k) < 0) { return false; }
  if (binding.ctrl !== undefined && !!binding.ctrl !== !!(e.ctrlKey || e.metaKey)) { return false; }
  if (binding.shift !== undefined && !!binding.shift !== !!e.shiftKey) { return false; }
  if (binding.alt !== undefined && !!binding.alt !== !!e.altKey) { return false; }
  return true;
}
export const KeyMap: any = define('Ext.util.KeyMap', {
  eventName: 'keydown',
  constructor: function (config: any, binding?: any, eventName?: string) {
    const me = this;
    if (config && (config.nodeType || config.dom || typeof config === 'string' || config.isComponent) && binding !== undefined) {
      config = { target: config, binding, eventName };
    }
    Ext.apply(me, config);
    me.bindings = [];
    if (me.binding) { for (const b of Ext.Array.from(me.binding)) { me.addBinding(b); } }
    if (me.key !== undefined || me.fn) { me.addBinding({ key: me.key, fn: me.fn || me.handler, scope: me.scope, ctrl: me.ctrl, shift: me.shift, alt: me.alt, defaultEventAction: me.defaultEventAction }); }
    let target = me.target;
    if (target && target.isComponent) { target = target.getEl(); }
    me.$el = Ext.get(target) || Ext.getDoc();
    me.$handler = (be: any) => me.handleTargetEvent(be);
    me.$el.dom.addEventListener(me.eventName, me.$handler);
    me.enabled = true;
    return me;
  },
  addBinding: function (b: any) { for (const x of Ext.Array.from(b)) { this.bindings.push(x); } },
  removeBinding: function (b: any) { Ext.Array.remove(this.bindings, b); },
  handleTargetEvent: function (be: any) {
    const me = this;
    if (!me.enabled) { return; }
    const e = be.$extEvent || (be.$extEvent = new ExtEvent(be));
    for (const b of me.bindings) {
      if (keyMatches(b, e)) {
        const fn = b.fn || b.handler;
        if (b.defaultEventAction) { e[b.defaultEventAction](); }
        if (fn) { fn.call(b.scope || me.scope || me, e.getKey(), e); }
      }
    }
  },
  enable: function () { this.enabled = true; },
  disable: function () { this.enabled = false; },
  setDisabled: function (d: boolean) { this.enabled = !d; },
  isEnabled: function () { return this.enabled; },
  on: function (key: any, fn: any, scope?: any) { this.addBinding({ key, fn, scope }); },
  destroy: function () { if (this.$el && this.$el.dom) { this.$el.dom.removeEventListener(this.eventName, this.$handler); } this.bindings = []; this.destroyed = true; }
});

const NAV_KEYS: Record<string, number> = { left: 37, right: 39, up: 38, down: 40, space: 32, pageUp: 33, pageDown: 34, del: 46, backspace: 8, home: 36, end: 35, enter: 13, esc: 27, tab: 9 };
export const KeyNav: any = define('Ext.util.KeyNav', {
  constructor: function (config: any) {
    const me = this;
    Ext.apply(me, config);
    let target = me.target;
    if (target && target.isComponent) { target = target.getEl(); }
    me.$el = Ext.get(target);
    me.$handler = (be: any) => {
      if (me.disabled) { return; }
      const e = be.$extEvent || (be.$extEvent = new ExtEvent(be));
      for (const name in NAV_KEYS) {
        if (NAV_KEYS[name] === e.getKey() && typeof me[name] === 'function') {
          if (me.defaultEventAction) { e[me.defaultEventAction](); }
          if (me[name].call(me.scope || me, e) === false) { /* handled */ }
        }
      }
    };
    if (me.$el) { me.$el.dom.addEventListener(me.eventName || 'keydown', me.$handler); }
    return me;
  },
  enable: function () { this.disabled = false; },
  disable: function () { this.disabled = true; },
  setDisabled: function (d: boolean) { this.disabled = d; },
  destroy: function () { if (this.$el) { this.$el.dom.removeEventListener(this.eventName || 'keydown', this.$handler); } this.destroyed = true; }
});

export default Element;

/**
 * Classes added through Ext.dom.Element#addCls on a React-owned node are recorded on the node; React replaces the
 * whole class attribute when it re-renders, so render code calls this afterwards to put them back.
 */
export function reapplyCls(dom: any) {
  const keep = dom && dom.$extCls;
  if (!keep || !keep.size || !dom.classList) { return; }
  for (const c of keep) { if (!dom.classList.contains(c)) { dom.classList.add(c); } }
}
Ext.$reapplyCls = reapplyCls;
