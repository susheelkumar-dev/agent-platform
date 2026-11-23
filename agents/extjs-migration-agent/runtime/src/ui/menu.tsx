/**
 * Ext.menu.Menu (floating, vertical), Ext.menu.Item (text, iconCls, handler, href, sub-menu on hover),
 * Ext.menu.CheckItem (checked, group, checkHandler), Ext.menu.Separator, Ext.menu.Manager.
 * Menus hide on an outside mousedown, on Esc and after an item click (hideOnClick).
 */
import * as React from 'react';
import { Ext } from '../core/ext';
import { define } from '../core/class';
import { clsList } from './render';
import './container';
import './floating';

const visibleMenus = new Set<any>();
let docListener = false;
function ensureDocListener() {
  if (docListener || typeof document === 'undefined') { return; }
  docListener = true;
  document.addEventListener('mousedown', (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    for (const m of Array.from(visibleMenus)) {
      if (m.destroyed || m.hidden) { visibleMenus.delete(m); continue; }
      if (m.$containsTarget(t)) { continue; }
      m.hide();
    }
  }, true);
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !visibleMenus.size) { return; }
    const list = Array.from(visibleMenus).filter((m: any) => !m.hidden);
    const topMost: any = list.sort((a: any, b: any) => (b.$zIndex || 0) - (a.$zIndex || 0))[0];
    if (topMost) { topMost.hide(); e.stopPropagation(); }
  }, true);
}

Ext.menu = Ext.menu || {};
Ext.menu.Manager = {
  hideAll() { let any = false; for (const m of Array.from(visibleMenus)) { if (!m.hidden) { m.hide(); any = true; } } return any; },
  getVisible() { return Array.from(visibleMenus).filter((m: any) => !m.hidden); }
};
Ext.menu.MenuMgr = Ext.menu.Manager;

export const Menu: any = define('Ext.menu.Menu', {
  extend: 'Ext.container.Container',
  alias: 'widget.menu',
  isMenu: true,
  baseCls: 'x-menu',
  floating: true,
  hidden: true,
  defaultType: 'menuitem',
  plain: false,
  showSeparator: true,
  allowOtherMenus: false,
  defaultAlign: 'tl-bl?',
  minWidth: 120,
  ignoreParentClicks: false,
  layout: { type: 'vbox', align: 'stretch' },
  initComponent: function () {
    const me = this;
    me.callParent();
    ensureDocListener();
  },
  $specialItem: function (s: string) {
    if (s === '-' || s === '|') { return Ext.widget('menuseparator'); }
    return Ext.widget('menuitem', { text: s, plain: true, canActivate: false });
  },
  $containsTarget: function (t: any) {
    const me = this;
    if (me.el && me.el.dom.contains(t)) { return true; }
    const owner = me.ownerCmp || me.parentMenu;
    if (owner && owner.el && owner.el.dom.contains(t) && owner.isButton) { return true; }
    for (const it of me.items ? me.items.items : []) { if (it.$subMenu && !it.$subMenu.hidden && it.$subMenu.$containsTarget(t)) { return true; } }
    return false;
  },
  show: function () {
    const me = this;
    if (!me.allowOtherMenus && !me.parentMenu) {
      for (const m of Array.from(visibleMenus)) { if (m !== me && !m.hidden && !m.$isAncestorMenuOf(me)) { m.hide(); } }
    }
    const r = me.$showFloating();
    if (!me.hidden) { visibleMenus.add(me); }
    return r;
  },
  hide: function () {
    const me = this;
    for (const it of me.items ? me.items.items : []) { if (it.$subMenu && !it.$subMenu.hidden) { it.$subMenu.hide(); } }
    visibleMenus.delete(me);
    me.$activeItem = null;
    return me.$hideFloating();
  },
  $isAncestorMenuOf: function (m: any) { let p = m.parentMenu; while (p) { if (p === this) { return true; } p = p.parentMenu; } return false; },
  $onItemClick: function (item: any, e: any) {
    const me = this;
    me.fireEvent('click', me, item, e);
    let root = me;
    while (root.parentMenu) { root.parentMenu.fireEvent('click', root.parentMenu, item, e); root = root.parentMenu; }
    if (item.hideOnClick !== false && !item.$subMenu) {
      let top = me;
      while (top.parentMenu) { top = top.parentMenu; }
      top.hide();
    }
  },
  setActiveItem: function (item: any) {
    const me = this;
    if (me.$activeItem === item) { return; }
    const old = me.$activeItem;
    me.$activeItem = item;
    if (old && old.$deactivate) { old.$deactivate(); }
    if (item && item.$activate) { item.$activate(); }
  },
  getRootCls: function () { return clsList(this.callParent(), 'x-menu-default', this.plain ? 'x-menu-plain' : null, 'x-panel', 'x-border-box'); },
  getRootStyle: function () {
    const st = this.callParent();
    st.maxHeight = st.maxHeight || (typeof window !== 'undefined' ? window.innerHeight - 10 : undefined);
    st.overflowY = 'auto';
    st.overflowX = 'hidden';
    return st;
  },
  $extraRootProps: function () { return { role: 'menu', onContextMenu: (e: any) => e.preventDefault() }; },
  doDestroy: function () { visibleMenus.delete(this); this.callParent(); }
});

define('Ext.menu.Separator', {
  extend: 'Ext.Component',
  alias: 'widget.menuseparator',
  baseCls: 'x-menu-item-separator',
  isMenuSeparator: true,
  text: '&#160;', // as in Ext (a separator is a plain menu item)
  hideOnClick: false,
  renderContent: function () { return <div className="x-menu-item-separator-line" />; }
});

export const MenuItem: any = define('Ext.menu.Item', {
  extend: 'Ext.Component',
  alias: 'widget.menuitem',
  isMenuItem: true,
  baseCls: 'x-menu-item',
  canActivate: true,
  hideOnClick: true,
  text: '',
  focusable: true,
  menuAlign: 'tl-tr?',
  menuShowDelay: 150,
  initComponent: function () {
    const me = this;
    me.callParent();
    if (me.menu) { me.setMenu(me.menu); }
  },
  setMenu: function (menu: any) {
    const me = this;
    if (me.$subMenu) { me.$subMenu.destroy(); me.$subMenu = null; }
    if (!menu) { me.menu = null; me.updateUI(); return; }
    let m = menu;
    if (!m.isComponent) { const cfg = Ext.isArray(m) ? { items: m } : Ext.apply({}, m); m = Ext.widget(cfg.xtype || 'menu', cfg); }
    m.parentMenu = null;
    m.ownerCmp = me;
    me.$subMenu = me.menu = m;
    me.updateUI();
  },
  getMenu: function () { return this.$subMenu || null; },
  getRefItems: function () { return this.$subMenu ? [this.$subMenu] : []; },
  $parentMenu: function () { return this.ownerCt && this.ownerCt.isMenu ? this.ownerCt : null; },
  $activate: function () {
    const me = this;
    me.activated = true;
    me.updateUI();
    me.fireEvent('activate', me);
    if (me.$subMenu) {
      clearTimeout(me.$menuTimer);
      me.$menuTimer = setTimeout(() => me.$showSubMenu(), me.menuShowDelay);
    }
  },
  $deactivate: function () {
    const me = this;
    me.activated = false;
    clearTimeout(me.$menuTimer);
    if (me.$subMenu && !me.$subMenu.hidden) { me.$subMenu.hide(); }
    me.updateUI();
    me.fireEvent('deactivate', me);
  },
  $showSubMenu: function () {
    const me = this;
    const m = me.$subMenu;
    if (!m || me.destroyed || me.disabled) { return; }
    m.parentMenu = me.$parentMenu();
    m.showBy(me, me.menuAlign);
  },
  $onClick: function (re: any) {
    const me = this;
    const e = new Ext.event.Event(re.nativeEvent);
    if (me.disabled) { re.preventDefault(); return; }
    if (!me.href) { re.preventDefault(); }
    if (me.$subMenu) { me.$showSubMenu(); if (me.$parentMenu() && me.$parentMenu().ignoreParentClicks) { return; } }
    if (me.$beforeHandler) { me.$beforeHandler(e); }
    if (me.fireEvent('click', me, e) !== false && me.handler) {
      Ext.callback(me.handler, me.scope, [me, e], 0, me);
    }
    const pm = me.$parentMenu();
    if (pm) { pm.$onItemClick(me, e); }
  },
  setText: function (t: string) { this.text = t; this.updateUI(); return this; },
  getText: function () { return this.text; },
  setIconCls: function (c: string) { this.iconCls = c; this.updateUI(); return this; },
  setHandler: function (fn: any, scope?: any) { this.handler = fn; this.scope = scope; },
  getRootCls: function () {
    const me = this;
    return clsList(me.callParent(), 'x-menu-item-default', me.activated ? 'x-menu-item-active' : null, me.plain ? 'x-menu-item-plain' : null,
      me.$subMenu ? 'x-menu-item-menu' : null, me.$checkCls ? me.$checkCls() : null);
  },
  $extraRootProps: function () {
    const me = this;
    return {
      role: me.$role || 'menuitem', tabIndex: -1, 'aria-disabled': me.disabled ? 'true' : undefined,
      onClick: (e: any) => me.$onClick(e),
      onMouseEnter: () => { const pm = me.$parentMenu(); if (pm && me.canActivate && !me.disabled) { pm.setActiveItem(me); } },
      onMouseLeave: () => { const pm = me.$parentMenu(); if (pm && pm.$activeItem === me && !me.$subMenu) { pm.setActiveItem(null); } }
    };
  },
  $iconEl: function () {
    const me = this;
    return <div key="icon" ref={me.$ref('iconEl')} className={clsList('x-menu-item-icon', 'x-menu-item-icon-default', me.iconCls, me.icon || me.iconCls ? null : 'x-menu-item-icon-none')}
      style={me.icon ? { backgroundImage: 'url(' + me.icon + ')' } : undefined} />;
  },
  renderContent: function () {
    const me = this;
    return (
      <a className={clsList('x-menu-item-link')} href={me.href || undefined} target={me.href ? me.hrefTarget : undefined} tabIndex={-1} onClick={me.href ? undefined : (e) => e.preventDefault()}>
        {me.$iconEl()}
        <span ref={me.$ref('textEl')} className={clsList('x-menu-item-text', 'x-menu-item-text-default', me.iconCls || me.icon || me.$checkCls ? 'x-menu-item-indent' : null)}
          dangerouslySetInnerHTML={{ __html: me.text === undefined || me.text === null ? '' : String(me.text) }} />
        {me.$subMenu ? <div className="x-menu-item-arrow x-fa fa-angle-right" /> : null}
      </a>
    );
  },
  doDestroy: function () { clearTimeout(this.$menuTimer); if (this.$subMenu) { this.$subMenu.destroy(); } this.callParent(); }
});

const checkGroups: Record<string, any[]> = {};
define('Ext.menu.CheckItem', {
  extend: 'Ext.menu.Item',
  alias: 'widget.menucheckitem',
  isMenuCheckItem: true,
  checked: false,
  hideOnClick: false,
  $role: 'menuitemcheckbox',
  initComponent: function () {
    const me = this;
    me.callParent();
    if (me.group) { (checkGroups[me.group] = checkGroups[me.group] || []).push(me); me.$role = 'menuitemradio'; }
  },
  $checkCls: function () { return clsList(this.group ? 'x-menu-item-checkitem x-menu-item-radio' : 'x-menu-item-checkitem', this.checked ? 'x-menu-item-checked' : 'x-menu-item-unchecked'); },
  $iconEl: function () {
    const me = this;
    const icon = me.group ? (me.checked ? 'fa-dot-circle' : 'fa-circle') : (me.checked ? 'fa-check-square' : 'fa-square');
    return [
      <div key="check" ref={me.$ref('checkEl')} className={clsList('x-menu-item-checkbox', 'x-fa', me.group ? null : null, icon, me.checked ? null : 'x-menu-item-check-off')} style={{ fontWeight: me.checked ? 900 : 400 }} />,
      me.iconCls ? <div key="icon" className={clsList('x-menu-item-icon', me.iconCls)} style={{ left: 24 }} /> : null
    ];
  },
  $beforeHandler: function () {
    const me = this;
    if (me.group && me.checked) { return; }
    me.setChecked(!me.checked);
  },
  setChecked: function (checked: boolean, suppressEvents?: boolean) {
    const me = this;
    checked = !!checked;
    if (me.checked === checked) { return me; }
    if (!suppressEvents && me.fireEvent('beforecheckchange', me, checked) === false) { return me; }
    me.checked = checked;
    if (checked && me.group) { for (const o of checkGroups[me.group] || []) { if (o !== me && o.checked && !o.destroyed) { o.setChecked(false, false); } } }
    me.updateUI();
    if (!suppressEvents) {
      me.fireEvent('checkchange', me, checked);
      if (me.checkHandler) { Ext.callback(me.checkHandler, me.scope, [me, checked], 0, me); }
    }
    return me;
  },
  isChecked: function () { return !!this.checked; },
  doDestroy: function () { if (this.group && checkGroups[this.group]) { Ext.Array.remove(checkGroups[this.group], this); } this.callParent(); }
});
define('Ext.menu.ColorPicker', { extend: 'Ext.menu.Menu', alias: 'widget.colormenu' });
