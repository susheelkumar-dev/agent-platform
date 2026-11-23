/**
 * Floating behaviour shared by windows, menus, pickers, toasts and tips: they live in the floating layer,
 * get a z-index from the window manager, centre on first show (unless positioned), align with showBy /
 * alignTo after their size is known, constrain to the viewport and come to front on show.
 */
import { Ext } from '../core/ext';
import { Component, nextZ } from './component';
import { addFloating, removeFloating, refreshFloating, flushRender, floatingList } from './render';

const P = Component.prototype;

P.$showFloating = function (animateTarget?: any, cb?: any, scope?: any) {
  const me = this;
  void animateTarget;
  if (me.destroyed) { return me; }
  const wasHidden = me.hidden || !me.$floatAdded;
  if (wasHidden && me.fireEvent('beforeshow', me) === false) { return me; }
  me.hidden = false;
  me.$zIndex = nextZ();
  if (!me.$floatAdded) {
    me.$floatAdded = true;
    if (me.x === undefined || me.y === undefined || me.$alignOnShow) { me.$positionPending = true; }
    addFloating(me);
  } else if (me.$alignOnShow || (me.$centerEachShow && !me.$userMoved)) {
    me.$positionPending = true;
  }
  me.updateUI();
  refreshFloating();
  flushRender();
  if (me.$positionPending && me.rendered) { me.$positionNow(); }
  if (wasHidden) {
    me.fireEvent('show', me);
    if (me.onShowComplete) { me.onShowComplete(); }
  }
  if (cb) { cb.call(scope || me, me); }
  return me;
};

P.$positionNow = function () {
  const me = this;
  if (!me.el) { return; }
  const dom = me.el.dom;
  const size = { width: dom.offsetWidth, height: dom.offsetHeight };
  if (me.$alignOnShow) {
    const [target, pos, off] = me.$alignOnShow;
    me.$alignOnShow = null;
    me.$positionPending = false;
    me.alignTo(target, pos, off);
  } else if (me.$positionPending) {
    me.$positionPending = false;
    if (me.x === undefined || me.y === undefined) {
      me.x = Math.max(0, Math.round((window.innerWidth - size.width) / 2));
      me.y = Math.max(0, Math.round((window.innerHeight - size.height) / 2 - Math.min(80, window.innerHeight * 0.06)));
      if (me.y < 0) { me.y = 0; }
    }
  }
  if (me.constrain || me.constrainHeader || me.isWindow || me.isMenu) { me.$constrainToViewport(size); }
  me.updateUI();
};

P.$constrainToViewport = function (size?: any) {
  const me = this;
  const el = me.el;
  const w = size ? size.width : (el ? el.dom.offsetWidth : 0);
  const h = size ? size.height : (el ? el.dom.offsetHeight : 0);
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = me.x || 0, y = me.y || 0;
  if (x + w > vw) { x = Math.max(0, vw - w); }
  if (y + h > vh) { y = Math.max(0, me.constrainHeader && !me.constrain ? Math.min(y, vh - 30) : vh - h); }
  if (x < 0) { x = 0; }
  if (y < 0) { y = 0; }
  me.x = x; me.y = y;
};

P.$afterFloatingMount = function () { if (this.$positionPending) { this.$positionNow(); } };
P.$afterFloatingUpdate = function () { if (this.$positionPending && this.rendered) { this.$positionNow(); } };

P.$hideFloating = function (animateTarget?: any, cb?: any, scope?: any) {
  const me = this;
  void animateTarget;
  if (me.hidden || me.destroyed) { return me; }
  if (me.fireEvent('beforehide', me) === false) { return me; }
  me.hidden = true;
  me.updateUI();
  refreshFloating();
  me.fireEvent('hide', me);
  if (cb) { cb.call(scope || me, me); }
  return me;
};

P.toFront = function (preventFocus?: boolean) {
  const me = this;
  if (!me.floating) { return me; }
  me.$zIndex = nextZ();
  me.updateUI();
  refreshFloating();
  if (!preventFocus && me.focus && me.isWindow) { me.focus(); }
  me.fireEvent('tofront', me);
  return me;
};
P.toBack = function () { this.$zIndex = 18000; this.updateUI(); refreshFloating(); return this; };
P.setActive = function () { return this; };

P.showAt = function (x: any, y?: any) {
  const me = this;
  if (Ext.isArray(x)) { y = x[1]; x = x[0]; }
  if (x && typeof x === 'object') { y = x.y; x = x.x; }
  me.$alignOnShow = [[x, y], 'tl-tl?', [0, 0]];
  me.x = x; me.y = y;
  return me.show();
};
P.showBy = function (cmp: any, pos?: string, off?: number[]) {
  const me = this;
  me.$alignOnShow = [cmp, pos || me.defaultAlign || 'tl-bl?', off];
  if (!me.floating) { me.floating = true; }
  return me.show();
};

P.$removeFromFloating = function () { removeFloating(this); };

// Ext.WindowManager (Ext.ZIndexManager)
Ext.WindowManager = Ext.WindowMgr = {
  zseed: 19000,
  getActive() { const list = floatingList().filter((c) => !c.hidden && c.isWindow); return list.sort((a, b) => (b.$zIndex || 0) - (a.$zIndex || 0))[0] || null; },
  bringToFront(c: any) { if (c && c.toFront) { c.toFront(); return true; } return false; },
  sendToBack(c: any) { if (c && c.toBack) { c.toBack(); } },
  hideAll() { for (const c of floatingList()) { if (c.isWindow) { c.hide(); } } },
  each(fn: any, scope?: any) { floatingList().forEach((c) => fn.call(scope, c)); },
  getBy(fn: any) { return floatingList().filter(fn); },
  register: Ext.emptyFn,
  unregister: Ext.emptyFn
};
Ext.ZIndexManager = Ext.WindowManager;
