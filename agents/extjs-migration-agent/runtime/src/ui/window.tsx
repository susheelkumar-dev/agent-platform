/**
 * Ext.window.Window (floating panel: modal, draggable by its header, resizable, maximizable, constrain,
 * Esc to close, defaultFocus), Ext.window.MessageBox with the Ext.Msg singleton (alert, confirm, prompt,
 * show, wait, progress) and Ext.window.Toast with Ext.toast (stacked, auto-closing).
 */
import * as React from 'react';
import { Ext } from '../core/ext';
import { define } from '../core/class';
import { clsList, flushRender } from './render';
import './panel';
import './floating';
import './button';

export const Window: any = define('Ext.window.Window', {
  extend: 'Ext.panel.Panel',
  alias: 'widget.window',
  isWindow: true,
  baseCls: 'x-window',
  floating: true,
  hidden: true,
  closable: true,
  modal: false,
  draggable: true,
  resizable: true,
  maximizable: false,
  minimizable: false,
  maximized: false,
  constrain: false,
  constrainHeader: true,
  closeAction: 'destroy',
  focusable: true,
  tabIndex: -1,
  onEsc: undefined,
  minWidth: 120,
  minHeight: 60,
  initComponent: function () {
    const me = this;
    me.callParent();
    if (me.maximized) { me.$maximize(true); }
  },
  $extraTools: function () {
    const me = this;
    const t = [];
    if (me.minimizable) { t.push({ type: 'minimize', itemId: 'minimizeTool', weight: 80, handler: () => me.minimize() }); }
    if (me.maximizable) { t.push({ type: me.maximized ? 'restore' : 'maximize', itemId: 'maximizeTool', weight: 85, handler: () => me.toggleMaximize() }); }
    return t;
  },
  show: function (animateTarget?: any, cb?: any, scope?: any) {
    const me = this;
    const first = !me.$shownOnce;
    me.$shownOnce = true;
    const r = me.$showFloating(animateTarget, cb, scope);
    if (!me.hidden) {
      if (first || me.$refocus !== false) { me.$focusDefault(); }
      if (me.$activateEvt !== false) { me.fireEvent('activate', me); }
    }
    void first;
    return r;
  },
  hide: function (animateTarget?: any, cb?: any, scope?: any) {
    const r = this.$hideFloating(animateTarget, cb, scope);
    this.fireEvent('deactivate', this);
    return r;
  },
  $focusDefault: function () {
    const me = this;
    setTimeout(() => {
      if (me.destroyed || me.hidden) { return; }
      let target: any = null;
      const df = me.defaultFocus;
      if (df) {
        target = typeof df === 'string' ? (me.lookupReference && me.isReferenceHolder && me.isReferenceHolder() ? me.lookupReference(df) : null) || me.down(df.charAt(0) === '#' ? df : '#' + df) || me.down(df) : df;
      }
      if (target && target.focus) { target.focus(); return; }
      if (me.el && me.el.dom && !me.el.dom.contains(document.activeElement)) { me.el.dom.focus({ preventScroll: true }); }
    }, 10);
  },
  close: function () {
    const me = this;
    if (me.fireEvent('beforeclose', me) === false) { return; }
    me.doClose();
  },
  doClose: function () {
    const me = this;
    me.fireEvent('close', me);
    if (me.closeAction === 'hide') { me.hide(); } else { me.hide(); me.destroy(); }
  },
  minimize: function () { this.fireEvent('minimize', this); return this; },
  maximize: function () { return this.$maximize(false); },
  $maximize: function (silent: boolean) {
    const me = this;
    if (me.maximized && !silent) { return me; }
    me.$restoreBox = { x: me.x, y: me.y, width: me.width, height: me.height };
    me.maximized = true;
    me.x = 0; me.y = 0;
    me.$syncMaxTool();
    me.updateUI();
    if (!silent) { me.fireEvent('maximize', me); me.fireEvent('resize', me, window.innerWidth, window.innerHeight); }
    return me;
  },
  restore: function () {
    const me = this;
    if (!me.maximized) { return me; }
    me.maximized = false;
    const b = me.$restoreBox || {};
    me.x = b.x; me.y = b.y; me.width = b.width; me.height = b.height;
    if (me.x === undefined) { me.$positionPending = true; }
    me.$syncMaxTool();
    me.updateUI();
    me.fireEvent('restore', me);
    return me;
  },
  toggleMaximize: function () { return this.maximized ? this.restore() : this.maximize(); },
  $syncMaxTool: function () {
    const t = this.$header && this.$header.down('#maximizeTool');
    if (t) { t.setType(this.maximized ? 'restore' : 'maximize'); }
  },
  $startDrag: function (re: any) {
    const me = this;
    if (re.button !== 0 || me.maximized || me.draggable === false) { return; }
    if (re.target.closest('.x-tool, .x-btn, input, textarea, .x-form-item')) { return; }
    re.preventDefault();
    me.toFront(true);
    const sx = re.clientX, sy = re.clientY, ox = me.x || 0, oy = me.y || 0;
    let moved = false;
    const move = (ev: MouseEvent) => {
      moved = true;
      let nx = ox + ev.clientX - sx, ny = oy + ev.clientY - sy;
      if (me.constrain || me.constrainHeader) {
        const w = me.el ? me.el.dom.offsetWidth : 0;
        nx = Math.max(-(w - 60), Math.min(window.innerWidth - 60, nx));
        ny = Math.max(0, Math.min(window.innerHeight - 30, ny));
        if (me.constrain) { nx = Math.max(0, Math.min(window.innerWidth - w, nx)); ny = Math.min(window.innerHeight - (me.el ? me.el.dom.offsetHeight : 0), ny); ny = Math.max(0, ny); }
      }
      me.x = Math.round(nx); me.y = Math.round(ny);
      me.$userMoved = true;
      me.updateUI();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (moved) { me.fireEvent('move', me, me.x, me.y); }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  },
  $startResize: function (re: any, dir: string) {
    const me = this;
    re.preventDefault();
    re.stopPropagation();
    const dom = me.el.dom;
    const sx = re.clientX, sy = re.clientY;
    const ow = dom.offsetWidth, oh = dom.offsetHeight, ox = me.x || 0, oy = me.y || 0;
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let w = ow, h = oh, x = ox, y = oy;
      if (dir.indexOf('e') >= 0) { w = ow + dx; }
      if (dir.indexOf('s') >= 0) { h = oh + dy; }
      if (dir.indexOf('w') >= 0) { w = ow - dx; x = ox + dx; }
      if (dir.indexOf('n') >= 0) { h = oh - dy; y = oy + dy; }
      const minW = me.minWidth || 50, minH = me.minHeight || 40;
      if (w < minW) { if (dir.indexOf('w') >= 0) { x -= minW - w; } w = minW; }
      if (h < minH) { if (dir.indexOf('n') >= 0) { y -= minH - h; } h = minH; }
      if (me.maxWidth && w > me.maxWidth) { w = me.maxWidth; }
      if (me.maxHeight && h > me.maxHeight) { h = me.maxHeight; }
      me.width = Math.round(w); me.height = Math.round(h); me.x = Math.round(x); me.y = Math.round(y);
      me.updateUI();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      me.fireEvent('resize', me, me.width, me.height);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  },
  $renderExtra: function () {
    const me = this;
    if (!me.resizable || me.maximized) { return null; }
    const dirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    return dirs.map((d) => <div key={'rz-' + d} className={'x-resizable-handle x-resizable-handle-' + d + ' x-window-handle'} onMouseDown={(e) => me.$startResize(e, d)}
      style={handleStyle(d)} />);
  },
  getRootCls: function () {
    const me = this;
    return clsList(me.callParent(), 'x-window-default', me.maximized ? 'x-window-maximized' : null, me.modal ? 'x-window-modal' : null);
  },
  getRootStyle: function () {
    const me = this;
    const st = me.callParent();
    if (me.maximized) { st.left = '0px'; st.top = '0px'; st.width = '100vw'; st.height = '100vh'; st.position = 'fixed'; }
    else { st.position = 'fixed'; }
    if (me.height === undefined && !me.maximized) { st.maxHeight = st.maxHeight || '100vh'; }
    return st;
  },
  $extraRootProps: function () {
    const me = this;
    return {
      role: 'dialog', tabIndex: -1,
      onKeyDown: (e: any) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          const esc = me.onEsc;
          if (esc === false || esc === Ext.emptyFn) { return; }
          e.preventDefault(); e.stopPropagation();
          if (typeof esc === 'function') { esc.call(me, new Ext.event.Event(e.nativeEvent)); } else if (me.closable) { me.close(); }
        }
      },
      onMouseDown: () => { if (!me.destroyed) { me.toFront(true); } }
    };
  }
});

function handleStyle(d: string): any {
  const s: any = { position: 'absolute', zIndex: 5 };
  const edge = 6;
  if (d.indexOf('n') >= 0) { s.top = -3; s.height = edge; }
  if (d.indexOf('s') >= 0) { s.bottom = -3; s.height = edge; }
  if (d.indexOf('e') >= 0) { s.right = -3; s.width = edge; }
  if (d.indexOf('w') >= 0) { s.left = -3; s.width = edge; }
  if (d === 'n' || d === 's') { s.left = 6; s.right = 6; }
  if (d === 'e' || d === 'w') { s.top = 6; s.bottom = 6; }
  s.cursor = d + '-resize';
  return s;
}

// ---------------------------------------------------------------- MessageBox
const ICON: Record<string, string> = {
  'x-message-box-info': 'fa-info-circle', 'x-message-box-warning': 'fa-exclamation-triangle',
  'x-message-box-question': 'fa-question-circle', 'x-message-box-error': 'fa-times-circle'
};
export const MessageBox: any = define('Ext.window.MessageBox', {
  extend: 'Ext.window.Window',
  alias: 'widget.messagebox',
  OK: 1, YES: 2, NO: 4, CANCEL: 8,
  OKCANCEL: 9, YESNO: 6, YESNOCANCEL: 14,
  INFO: 'x-message-box-info', WARNING: 'x-message-box-warning', QUESTION: 'x-message-box-question', ERROR: 'x-message-box-error',
  buttonText: { ok: 'OK', yes: 'Yes', no: 'No', cancel: 'Cancel' },
  closeAction: 'hide',
  modal: true,
  resizable: false,
  maximizable: false,
  minWidth: 250,
  maxWidth: 600,
  cls: 'x-message-box',
  layout: { type: 'vbox', align: 'stretch' },
  bodyPadding: 10,
  title: '&#160;',
  initComponent: function () {
    const me = this;
    me.items = [
      { xtype: 'container', itemId: 'topContainer', layout: { type: 'hbox', align: 'begin' }, items: [
        { xtype: 'component', itemId: 'iconComponent', cls: 'x-message-box-icon', hidden: true, width: 0 },
        { xtype: 'container', itemId: 'promptContainer', flex: 1, layout: { type: 'vbox', align: 'stretch' }, items: [
          { xtype: 'component', itemId: 'msg', cls: 'x-window-text x-message-box-msg' },
          { xtype: 'textfield', itemId: 'textfield', hidden: true, margin: '8 0 0 0', enableKeyEvents: true,
            listeners: { specialkey: (f: any, e: any) => { if (e.getKey() === 13) { me.$btnClick('ok'); } } } },
          { xtype: 'textareafield', itemId: 'textarea', hidden: true, height: 75, margin: '8 0 0 0' }
        ] }
      ] },
      { xtype: 'component', itemId: 'progressBar', hidden: true, cls: 'x-progress x-progress-default', margin: '8 0 0 0' }
    ];
    me.fbar = { itemId: 'buttonBar', items: ['ok', 'yes', 'no', 'cancel'].map((id) => ({ xtype: 'button', itemId: id, text: me.buttonText[id], hidden: true, minWidth: 75, handler: () => me.$btnClick(id) })) };
    me.buttonAlign = 'center';
    me.callParent();
    me.msgCmp = me.down('#msg');
    me.textField = me.down('#textfield');
    me.textArea = me.down('#textarea');
    me.iconComponent = me.down('#iconComponent');
    me.progressBar = me.down('#progressBar');
  },
  $btnClick: function (id: string) {
    const me = this;
    const cfg = me.cfg || {};
    const value = cfg.multiline ? me.textArea.getValue() : me.textField.getValue();
    me.hide();
    if (cfg.fn) { Ext.callback(cfg.fn, cfg.scope || window, [id, value, cfg], 0); }
  },
  show: function (cfg?: any) {
    const me = this;
    if (!cfg || !cfg.isComponent && typeof cfg !== 'object') { return me.callParent(arguments); }
    cfg = Ext.apply({}, cfg);
    me.cfg = cfg;
    if (cfg.title !== undefined) { me.setTitle(cfg.title || '&#160;'); } else { me.setTitle('&#160;'); }
    me.msgCmp.setHtml(cfg.msg || cfg.message || '');
    const prompt = !!cfg.prompt;
    me.textField.setHidden(!prompt || !!cfg.multiline);
    me.textArea.setHidden(!prompt || !cfg.multiline);
    if (prompt) { (cfg.multiline ? me.textArea : me.textField).setValue(cfg.value || ''); }
    const icon = cfg.icon || cfg.iconCls || '';
    me.iconComponent.setHidden(!icon);
    me.iconComponent.setWidth(icon ? 44 : 0);
    me.iconComponent.setHtml(icon ? '<span class="x-fa ' + (ICON[icon] || '') + '" style="font-size:28px"></span>' : '');
    me.iconComponent.setUserCls(icon);
    const buttons = cfg.buttons === undefined ? 0 : cfg.buttons;
    const texts = Ext.apply({}, cfg.buttonText, me.buttonText);
    const flags: Record<string, number> = { ok: 1, yes: 2, no: 4, cancel: 8 };
    let anyBtn = false;
    for (const id of ['ok', 'yes', 'no', 'cancel']) {
      const b = me.down('#' + id);
      const show = typeof buttons === 'number' ? (buttons & flags[id]) !== 0 : !!(buttons && buttons[id]);
      b.setHidden(!show);
      b.setText(typeof buttons === 'object' && buttons && typeof buttons[id] === 'string' ? buttons[id] : texts[id]);
      anyBtn = anyBtn || show;
    }
    me.down('#buttonBar').setHidden(!anyBtn);
    me.progressBar.setHidden(!cfg.progress && !cfg.wait);
    if (cfg.wait || cfg.progress) { me.updateProgress(cfg.wait ? 1 : 0, cfg.progressText || cfg.waitText || ''); }
    me.closable = cfg.closable !== false;
    me.width = cfg.width;
    me.height = cfg.height;
    me.modal = cfg.modal !== false;
    me.$positionPending = true;
    me.x = undefined; me.y = undefined;
    me.defaultFocus = prompt ? (cfg.multiline ? '#textarea' : '#textfield') : (buttons & 2 ? '#yes' : buttons & 1 ? '#ok' : null);
    me.callParent([]);
    return me;
  },
  alert: function (title: string, msg: string, fn?: any, scope?: any) {
    if (title && typeof title === 'object') { return this.show(Ext.apply({ buttons: this.OK }, title)); }
    return this.show({ title, msg, buttons: this.OK, fn, scope, minWidth: this.minWidth });
  },
  confirm: function (title: any, msg?: string, fn?: any, scope?: any) {
    if (title && typeof title === 'object') { return this.show(Ext.apply({ buttons: this.YESNO, icon: this.QUESTION }, title)); }
    return this.show({ title, msg, buttons: this.YESNO, icon: this.QUESTION, fn, scope });
  },
  prompt: function (title: any, msg?: string, fn?: any, scope?: any, multiline?: any, value?: string) {
    if (title && typeof title === 'object') { return this.show(Ext.apply({ buttons: this.OKCANCEL, prompt: true }, title)); }
    return this.show({ title, msg, buttons: this.OKCANCEL, fn, scope, prompt: true, multiline: !!multiline, value });
  },
  wait: function (msg: string, title?: string, cfg?: any) { return this.show(Ext.apply({ title, msg, closable: false, wait: true, modal: true, buttons: 0 }, cfg)); },
  progress: function (title: string, msg?: string, progressText?: string) { return this.show({ title, msg, progress: true, progressText, closable: false, buttons: 0 }); },
  updateProgress: function (value: number, text?: string, msg?: string) {
    const me = this;
    if (msg) { me.updateText(msg); }
    const pct = Math.round(Math.max(0, Math.min(1, value || 0)) * 100);
    me.progressBar.setHtml('<div class="x-progress-bar x-progress-bar-default" style="width:' + pct + '%"></div><div class="x-progress-text">' + (text || '') + '</div>');
    return me;
  },
  updateText: function (t: string) { this.msgCmp.setHtml(t || ''); return this; },
  setIcon: function (icon: string) { this.iconComponent.setUserCls(icon); this.iconComponent.setHidden(!icon); return this; }
});

let msgInstance: any = null;
Object.defineProperty(Ext, 'Msg', { configurable: true, get() { if (!msgInstance || msgInstance.destroyed) { msgInstance = new MessageBox({ id: 'ext-messagebox' }); } return msgInstance; } });
Object.defineProperty(Ext, 'MessageBox', { configurable: true, get() { return Ext.Msg; } });

// ---------------------------------------------------------------- Toast
const toasts: any[] = [];
define('Ext.window.Toast', {
  extend: 'Ext.window.Window',
  alias: 'widget.toast',
  isToast: true,
  cls: 'x-toast',
  baseCls: 'x-toast',
  closable: false,
  draggable: false,
  resizable: false,
  modal: false,
  constrainHeader: false,
  autoClose: true,
  autoCloseDelay: 3000,
  closeOnMouseDown: false,
  align: 't',
  minWidth: 150,
  maxWidth: 600,
  slideInDuration: 250,
  bodyPadding: 10,
  focusable: false,
  closeAction: 'destroy',
  $refocus: false,
  $activateEvt: false,
  initComponent: function () {
    const me = this;
    if (me.title === undefined && me.header === undefined) { me.header = false; }
    me.callParent();
  },
  $focusDefault: Ext.emptyFn,
  show: function () {
    const me = this;
    toasts.push(me);
    me.x = -10000; me.y = -10000;
    me.$positionPending = false;
    me.callParent([]);
    flushRender();
    me.$layoutToasts();
    if (me.autoClose) {
      me.$timer = setTimeout(() => { if (!me.destroyed) { me.close(); } }, me.autoCloseDelay);
    }
    return me;
  },
  $layoutToasts: function () {
    // stack toasts of the same alignment from the edge inwards
    const byAlign: Record<string, any[]> = {};
    for (const t of toasts) { if (!t.destroyed && !t.hidden) { (byAlign[t.align] = byAlign[t.align] || []).push(t); } }
    for (const align in byAlign) {
      let offset = 10;
      for (const t of byAlign[align]) {
        const dom = t.el ? t.el.dom : null;
        const w = dom ? dom.offsetWidth : 300, h = dom ? dom.offsetHeight : 50;
        const vw = window.innerWidth, vh = window.innerHeight;
        let x = Math.round((vw - w) / 2), y = offset;
        if (align.indexOf('b') === 0 || align === 'b') { y = vh - h - offset; }
        if (align === 'l' || align === 'r') { y = offset; }
        if (align.indexOf('r') >= 0) { x = vw - w - 10; }
        if (align.indexOf('l') >= 0) { x = 10; }
        if (align === 'tr' || align === 'tl' || align === 't') { y = offset; }
        t.x = x; t.y = y;
        t.updateUI();
        offset += h + 6;
      }
    }
  },
  $extraRootProps: function () {
    const me = this;
    return { role: 'alert', onMouseDown: () => { if (me.closeOnMouseDown) { me.close(); } }, onMouseEnter: () => { clearTimeout(me.$timer); }, onMouseLeave: () => { if (me.autoClose && !me.destroyed) { me.$timer = setTimeout(() => { if (!me.destroyed) { me.close(); } }, 1200); } } };
  },
  doDestroy: function () {
    const me = this;
    clearTimeout(me.$timer);
    Ext.Array.remove(toasts, me);
    me.callParent();
    setTimeout(() => { if (toasts[0]) { toasts[0].$layoutToasts(); } }, 0);
  }
});

Ext.toast = function (message: any, title?: string, align?: string, iconCls?: string) {
  let cfg = message;
  if (typeof message === 'string') { cfg = { html: message, title, align: align || 't', iconCls }; }
  else { cfg = Ext.apply({}, message); if (cfg.html === undefined && cfg.message !== undefined) { cfg.html = cfg.message; } }
  const t = Ext.widget('toast', cfg);
  t.show();
  return t;
};
