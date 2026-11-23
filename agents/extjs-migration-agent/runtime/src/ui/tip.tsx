/**
 * Quick tips: data-qtip / data-qtitle / data-errorqtip attributes anywhere in the page show a tooltip on hover
 * (Ext.tip.QuickTipManager). Ext.tip.ToolTip gives a target-bound tooltip with html, showDelay, trackMouse,
 * delegate and 'beforeshow' (used to set content dynamically).
 */
import * as React from 'react';
import { Ext } from '../core/ext';
import { define } from '../core/class';
import { clsList } from './render';
import './floating';

let tipEl: HTMLDivElement | null = null;
let showTimer: any = null, hideTimer: any = null;
let current: Element | null = null;
let enabled = true;

function ensureTipEl() {
  if (tipEl || typeof document === 'undefined') { return tipEl; }
  tipEl = document.createElement('div');
  tipEl.className = 'x-tip x-tip-default x-layer x-quicktip';
  tipEl.setAttribute('role', 'tooltip');
  Object.assign(tipEl.style, { position: 'fixed', display: 'none', zIndex: '29000', maxWidth: '400px', pointerEvents: 'none' });
  document.body.appendChild(tipEl);
  return tipEl;
}
function placeTip(x: number, y: number) {
  const el = ensureTipEl()!;
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = x + 12, top = y + 18;
  if (left + w > window.innerWidth - 4) { left = Math.max(4, window.innerWidth - w - 4); }
  if (top + h > window.innerHeight - 4) { top = Math.max(4, y - h - 8); }
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}
function showQuickTip(target: Element, x: number, y: number) {
  const el = ensureTipEl();
  if (!el) { return; }
  const err = target.getAttribute('data-errorqtip');
  const text = err || target.getAttribute('data-qtip');
  if (!text) { return; }
  const title = target.getAttribute('data-qtitle');
  const w = target.getAttribute('data-qwidth');
  el.className = clsList('x-tip x-tip-default x-layer x-quicktip', err ? 'x-tip-form-invalid' : null, target.getAttribute('data-qclass'));
  el.innerHTML = (title ? '<div class="x-tip-header"><div class="x-title-text">' + title + '</div></div>' : '') + '<div class="x-tip-body x-tip-body-default">' + text + '</div>';
  el.style.width = w ? w + 'px' : '';
  el.style.display = 'block';
  placeTip(x, y);
}
function hideQuickTip() { if (tipEl) { tipEl.style.display = 'none'; } current = null; }

let installed = false;
function install() {
  if (installed || typeof document === 'undefined') { return; }
  installed = true;
  let lastX = 0, lastY = 0;
  document.addEventListener('mouseover', (e) => {
    if (!enabled) { return; }
    const t = (e.target as Element).closest ? (e.target as Element).closest('[data-qtip],[data-errorqtip]') : null;
    if (t === current) { return; }
    clearTimeout(showTimer);
    if (!t) { hideTimer = setTimeout(hideQuickTip, 100); return; }
    clearTimeout(hideTimer);
    current = t;
    const wasVisible = tipEl && tipEl.style.display === 'block';
    showTimer = setTimeout(() => { if (current === t && document.body.contains(t)) { showQuickTip(t, lastX, lastY); } }, wasVisible ? 50 : 500);
  }, true);
  document.addEventListener('mousemove', (e) => { lastX = e.clientX; lastY = e.clientY; }, true);
  document.addEventListener('mousedown', () => { clearTimeout(showTimer); hideQuickTip(); }, true);
  document.addEventListener('scroll', () => { clearTimeout(showTimer); hideQuickTip(); }, true);
}

Ext.tip = Ext.tip || {};
Ext.tip.QuickTipManager = Ext.QuickTips = {
  init(autoRender?: boolean, cfg?: any) { void autoRender; void cfg; install(); },
  enable() { enabled = true; },
  disable() { enabled = false; hideQuickTip(); },
  isEnabled() { return enabled; },
  register(cfg: any) { const t = Ext.get(cfg.target); if (t) { t.dom.setAttribute('data-qtip', cfg.text || ''); if (cfg.title) { t.dom.setAttribute('data-qtitle', cfg.title); } } },
  unregister(el: any) { const t = Ext.get(el); if (t) { t.dom.removeAttribute('data-qtip'); } },
  getQuickTip() { return { hide: hideQuickTip, register: Ext.tip.QuickTipManager.register }; }
};

Ext.ClassManager.classes['Ext.tip.QuickTipManager'] = Ext.tip.QuickTipManager;
Ext.ClassManager.classes['Ext.QuickTips'] = Ext.tip.QuickTipManager;

// ---------------------------------------------------------------- ToolTip
define('Ext.tip.Tip', {
  extend: 'Ext.panel.Panel',
  alias: 'widget.tip',
  baseCls: 'x-tip',
  floating: true,
  hidden: true,
  focusable: false,
  bodyPadding: 6,
  shadow: false,
  maxWidth: 500,
  getRootStyle: function () { const st = this.callParent(); st.position = 'fixed'; st.pointerEvents = 'none'; return st; }
});
define('Ext.tip.ToolTip', {
  extend: 'Ext.tip.Tip',
  alias: 'widget.tooltip',
  showDelay: 500,
  hideDelay: 200,
  dismissDelay: 5000,
  trackMouse: false,
  anchorToTarget: true,
  mouseOffset: [15, 18],
  initComponent: function () {
    const me = this;
    me.callParent();
    if (me.target) { me.setTarget(me.target); }
  },
  setTarget: function (t: any) {
    const me = this;
    if (me.$targetListeners) { me.$targetListeners.forEach((f: any) => f()); }
    const el = t && t.isComponent ? t.getEl() : Ext.get(t);
    me.target = el;
    if (!el) { return; }
    const dom = el.dom;
    const over = (e: MouseEvent) => {
      const trig = me.delegate ? (e.target as Element).closest(me.delegate) : dom;
      if (!trig || !dom.contains(trig as any)) { return; }
      me.triggerElement = trig;
      me.$xy = [e.clientX, e.clientY];
      clearTimeout(me.$hideT);
      clearTimeout(me.$showT);
      me.$showT = setTimeout(() => me.$showAtMouse(), me.showDelay);
    };
    const out = (e: MouseEvent) => {
      if (me.delegate && e.relatedTarget && (e.relatedTarget as Element).closest && (e.relatedTarget as Element).closest(me.delegate) === me.triggerElement) { return; }
      clearTimeout(me.$showT);
      me.$hideT = setTimeout(() => me.hide(), me.hideDelay);
    };
    const move = (e: MouseEvent) => { me.$xy = [e.clientX, e.clientY]; if (me.trackMouse && !me.hidden) { me.$place(); } };
    dom.addEventListener('mouseover', over);
    dom.addEventListener('mouseout', out);
    dom.addEventListener('mousemove', move);
    me.$targetListeners = [() => dom.removeEventListener('mouseover', over), () => dom.removeEventListener('mouseout', out), () => dom.removeEventListener('mousemove', move)];
  },
  $showAtMouse: function () {
    const me = this;
    if (me.destroyed) { return; }
    me.x = -10000; me.y = -10000;
    me.$showFloating();
    if (me.hidden) { return; }
    me.$place();
    if (me.dismissDelay) { clearTimeout(me.$dismissT); me.$dismissT = setTimeout(() => me.hide(), me.dismissDelay); }
  },
  $place: function () {
    const me = this;
    const [x, y] = me.$xy || [0, 0];
    const dom = me.el ? me.el.dom : null;
    const w = dom ? dom.offsetWidth : 200, h = dom ? dom.offsetHeight : 40;
    let left = x + me.mouseOffset[0], top = y + me.mouseOffset[1];
    if (left + w > window.innerWidth) { left = Math.max(0, x - w - 5); }
    if (top + h > window.innerHeight) { top = Math.max(0, y - h - 5); }
    me.x = left; me.y = top;
    me.updateUI();
  },
  getRootCls: function () { return clsList(this.callParent(), 'x-tip-default'); },
  doDestroy: function () {
    const me = this;
    clearTimeout(me.$showT); clearTimeout(me.$hideT); clearTimeout(me.$dismissT);
    if (me.$targetListeners) { me.$targetListeners.forEach((f: any) => f()); }
    me.callParent();
  }
});
void React;
