/**
 * Ext.button.Button (text, iconCls, icon, iconAlign, scale, ui, handler/scope, menu, arrowVisible, toggle and
 * toggleGroup, href, tooltip, textAlign) and Ext.button.Segmented.
 */
import * as React from 'react';
import { Ext } from '../core/ext';
import { define } from '../core/class';
import { clsList } from './render';

const groups: Record<string, any[]> = {};
Ext.button = Ext.button || {};
Ext.button.Manager = {
  register(btn: any) { if (btn.toggleGroup) { (groups[btn.toggleGroup] = groups[btn.toggleGroup] || []).push(btn); } },
  unregister(btn: any) { if (btn.toggleGroup && groups[btn.toggleGroup]) { Ext.Array.remove(groups[btn.toggleGroup], btn); } },
  getPressed(group: string) { return (groups[group] || []).find((b) => b.pressed) || null; },
  onButtonToggle(btn: any, pressed: boolean) {
    if (!pressed || !btn.toggleGroup) { return; }
    for (const b of groups[btn.toggleGroup] || []) { if (b !== btn && b.pressed) { b.toggle(false); } }
  }
};

export const Button: any = define('Ext.button.Button', {
  extend: 'Ext.Component',
  alias: 'widget.button',
  isButton: true,
  baseCls: 'x-btn',
  focusable: true,
  text: '',
  iconCls: '',
  iconAlign: 'left',
  scale: 'small',
  ui: 'default',
  arrowAlign: 'right',
  arrowVisible: true,
  enableToggle: false,
  pressed: false,
  allowDepress: true,
  menuAlign: 'tl-bl?',
  textAlign: 'center',
  defaultBindProperty: 'text',
  renderTag: 'a',
  $tooltipOnChild: false,

  initComponent: function () {
    const me = this;
    me.callParent();
    if (me.menu) { me.setMenu(me.menu, false); }
    Ext.button.Manager.register(me);
  },
  setMenu: function (menu: any, destroyMenu = true) {
    const me = this;
    const old = me.$menuInstance;
    if (old && destroyMenu) { old.destroy(); }
    if (!menu) { me.menu = me.$menuInstance = null; me.updateUI(); return; }
    let m = menu;
    if (!m.isComponent) {
      const cfg = Ext.isArray(m) ? { items: m } : Ext.apply({}, m);
      cfg.ownerCmp = me;
      m = Ext.widget(cfg.xtype || 'menu', cfg);
    } else {
      m.ownerCmp = me;
    }
    me.menu = me.$menuInstance = m;
    m.on({ show: () => { me.$menuActive = true; me.updateUI(); me.fireEvent('menushow', me, m); }, hide: () => { me.$menuActive = false; me.updateUI(); me.fireEvent('menuhide', me, m); } });
    me.updateUI();
  },
  getMenu: function () { return this.$menuInstance || null; },
  getRefItems: function () { return this.$menuInstance ? [this.$menuInstance] : []; },
  showMenu: function (fromEvent?: any) {
    const me = this;
    const m = me.$menuInstance;
    if (!m || me.disabled) { return; }
    void fromEvent;
    if (m.isVisible()) { m.hide(); return; }
    m.showBy(me, me.menuAlign);
  },
  hideMenu: function () { if (this.$menuInstance) { this.$menuInstance.hide(); } },
  hasVisibleMenu: function () { return !!(this.$menuInstance && this.$menuInstance.isVisible()); },

  setText: function (t: string) { const old = this.text; this.text = t; this.updateUI(); this.fireEvent('textchange', this, old, t); return this; },
  getText: function () { return this.text; },
  setIconCls: function (c: string) { const old = this.iconCls; this.iconCls = c; this.updateUI(); this.fireEvent('iconchange', this, old, c); return this; },
  setIcon: function (i: string) { this.icon = i; this.updateUI(); return this; },
  setGlyph: function () { return this; },
  setHandler: function (fn: any, scope?: any) { this.handler = fn; if (scope !== undefined) { this.scope = scope; } return this; },
  setTextAlign: function (a: string) { this.textAlign = a; this.updateUI(); },
  setScale: function (s: string) { this.scale = s; this.updateUI(); },
  setArrowVisible: function (v: boolean) { this.arrowVisible = v; this.updateUI(); },
  setHref: function (h: string) { this.href = h; this.updateUI(); },
  toggle: function (state?: boolean, suppressEvent?: boolean) {
    const me = this;
    state = state === undefined ? !me.pressed : !!state;
    if (state === me.pressed) { return me; }
    if (!suppressEvent && me.fireEvent('beforetoggle', me, state) === false) { return me; }
    me.pressed = state;
    me.updateUI();
    if (!suppressEvent) {
      me.fireEvent('toggle', me, state);
      if (me.toggleHandler) { Ext.callback(me.toggleHandler, me.scope, [me, state], 0, me); }
    }
    Ext.button.Manager.onButtonToggle(me, state);
    return me;
  },
  setPressed: function (p: boolean) { return this.toggle(p); },
  isPressed: function () { return !!this.pressed; },

  $onClick: function (re: any) {
    const me = this;
    if (me.disabled) { re.preventDefault(); return; }
    if (!me.href) { re.preventDefault(); }
    const e = new Ext.event.Event(re.nativeEvent);
    if (me.enableToggle && (me.allowDepress !== false || !me.pressed)) { me.toggle(); }
    if (me.$menuInstance) { me.showMenu(e); }
    me.fireHandler(e);
  },
  fireHandler: function (e?: any) {
    const me = this;
    if (me.fireEvent('click', me, e) !== false && me.handler) {
      Ext.callback(me.handler, me.scope, [me, e], 0, me);
    }
  },
  click: function () { this.fireHandler(new Ext.event.Event(new MouseEvent('click'))); },
  onDisable: function () { if (this.$menuInstance) { this.hideMenu(); } },

  $effectiveUi: function () {
    const me = this;
    if (me.ui && me.ui !== 'default') { return me.ui; }
    const o = me.ownerCt;
    if (o && (o.isToolbar || o.isHeader) && !(o.$isFooter)) { return 'default-toolbar'; }
    return 'default';
  },
  getRootCls: function () {
    const me = this;
    const ui = me.$effectiveUi() + '-' + me.scale;
    return clsList(
      me.baseCls, 'x-unselectable', 'x-btn-' + ui, me.cls, me.userCls, me.$addedCls,
      me.$over ? ['x-btn-over', 'x-btn-' + ui + '-over'] : null,
      me.pressed ? ['x-btn-pressed', 'x-btn-' + ui + '-pressed'] : null,
      me.$menuActive ? ['x-btn-menu-active', 'x-btn-' + ui + '-menu-active'] : null,
      me.disabled ? ['x-item-disabled', 'x-btn-disabled', 'x-btn-' + ui + '-disabled'] : null,
      me.hidden ? 'x-hidden-display' : null,
      me.$ownerLayoutCls ? me.$ownerLayoutCls() : null,
      me.$focusCls ? 'x-btn-focus' : null
    );
  },
  $extraRootProps: function () {
    const me = this;
    return {
      role: 'button', tabIndex: me.disabled ? -1 : 0, href: me.href || undefined, target: me.href ? (me.hrefTarget || '_blank') : undefined,
      'aria-disabled': me.disabled ? 'true' : undefined, 'aria-pressed': me.enableToggle ? String(!!me.pressed) : undefined,
      'data-qtip': typeof me.tooltip === 'string' ? me.tooltip : (me.tooltip && me.tooltip.text) || undefined,
      onClick: (e: any) => me.$onClick(e),
      onMouseEnter: () => { me.$over = true; me.updateUI(); me.fireEvent('mouseover', me); },
      onMouseLeave: () => { me.$over = false; me.updateUI(); me.fireEvent('mouseout', me); },
      onKeyDown: (e: any) => { if ((e.key === 'Enter' || e.key === ' ') && !me.href) { e.preventDefault(); me.$onClick(e); } else if (e.key === 'ArrowDown' && me.$menuInstance) { e.preventDefault(); me.showMenu(); } }
    };
  },
  renderContent: function () {
    const me = this;
    const ui = me.$effectiveUi() + '-' + me.scale;
    const hasText = me.text !== '' && me.text !== null && me.text !== undefined;
    const hasIcon = !!(me.iconCls || me.icon);
    const arrow = me.$menuInstance && me.arrowVisible !== false;
    const icon = hasIcon ? <span key="i" ref={me.$ref('btnIconEl')} className={clsList('x-btn-icon-el', 'x-btn-icon-el-' + ui, me.iconCls)} style={me.icon ? { backgroundImage: 'url(' + me.icon + ')' } : undefined} /> : null;
    const text = hasText ? <span key="t" ref={me.$ref('btnInnerEl')} className={clsList('x-btn-inner', 'x-btn-inner-' + ui)} dangerouslySetInnerHTML={{ __html: String(me.text) }} /> : null;
    const parts = me.iconAlign === 'right' || me.iconAlign === 'bottom' ? [text, icon] : [icon, text];
    return (
      <span className={clsList('x-btn-wrap', 'x-btn-wrap-' + ui, arrow ? ['x-btn-arrow', 'x-btn-arrow-' + me.arrowAlign] : null)} style={{ justifyContent: me.textAlign === 'left' ? 'flex-start' : me.textAlign === 'right' ? 'flex-end' : 'center' }}>
        <span ref={me.$ref('btnEl')} className={clsList('x-btn-button', 'x-btn-button-' + ui, hasText ? 'x-btn-text' : 'x-btn-no-text', hasIcon ? ['x-btn-icon', 'x-btn-icon-' + me.iconAlign] : null)}
          style={{ flexDirection: me.iconAlign === 'top' || me.iconAlign === 'bottom' ? 'column' : 'row', justifyContent: me.textAlign === 'left' ? 'flex-start' : me.textAlign === 'right' ? 'flex-end' : 'center' }}>
          {parts}
        </span>
        {arrow ? <span className="x-btn-arrow-el" /> : null}
        {me.badgeText ? <span className="x-btn-badgeCls">{me.badgeText}</span> : null}
      </span>
    );
  },
  doDestroy: function () {
    Ext.button.Manager.unregister(this);
    if (this.$menuInstance) { this.$menuInstance.destroy(); }
    this.callParent();
  }
});
define('Ext.button.Split', { extend: 'Ext.button.Button', alias: 'widget.splitbutton' });
define('Ext.button.Cycle', { extend: 'Ext.button.Button', alias: 'widget.cycle' });

// ---------------------------------------------------------------- Segmented
define('Ext.button.Segmented', {
  extend: 'Ext.container.Container',
  alias: 'widget.segmentedbutton',
  baseCls: 'x-segmented-button',
  defaultType: 'button',
  allowMultiple: false,
  allowDepress: false,
  allowToggle: true,
  vertical: false,
  defaultBindProperty: 'value',
  layout: { type: 'hbox', align: 'stretch' },
  initComponent: function () {
    const me = this;
    me.callParent();
    me.items.each((b: any, i: number) => me.$setupButton(b, i));
    if (me.value !== undefined && me.value !== null) { me.setValue(me.value, true); } else { me.value = me.getValue(); }
  },
  onAdd: function (b: any) { if (this.items && this.$ready) { this.$setupButton(b, this.items.indexOf(b)); } },
  $setupButton: function (b: any, i: number) {
    const me = this;
    me.$ready = true;
    b.enableToggle = me.allowToggle;
    b.allowDepress = me.allowMultiple || me.allowDepress;
    if (b.value === undefined) { b.value = i; }
    b.addCls('x-segmented-button-item');
    b.on('toggle', (btn: any, pressed: boolean) => {
      if (me.$syncing) { return; }
      if (!me.allowMultiple && pressed) {
        me.$syncing = true;
        me.items.each((o: any) => { if (o !== btn && o.pressed) { o.toggle(false); } });
        me.$syncing = false;
      }
      const old = me.value;
      me.value = me.getValue();
      me.fireEvent('toggle', me, btn, pressed);
      if (!Ext.Object.equals(Ext.Array.from(old), Ext.Array.from(me.value))) { me.fireEvent('change', me, me.value, old); }
    });
  },
  getValue: function () {
    const pressed = this.items.items.filter((b: any) => b.pressed).map((b: any) => b.value);
    return this.allowMultiple ? pressed : (pressed.length ? pressed[0] : null);
  },
  setValue: function (v: any, silent?: boolean) {
    const me = this;
    const vals = Ext.Array.from(v);
    me.$syncing = true;
    me.items.each((b: any) => { b.toggle(vals.indexOf(b.value) >= 0, true); });
    me.$syncing = false;
    const old = me.value;
    me.value = me.getValue();
    if (!silent) { me.fireEvent('change', me, me.value, old); }
    return me;
  }
});
