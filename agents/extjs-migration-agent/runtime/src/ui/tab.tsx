/**
 * Ext.tab.Panel with Ext.tab.Bar and Ext.tab.Tab. The panel body is a card layout; each card gets a tab
 * (card.tab) that mirrors its title, iconCls, closable, disabled and hidden state. Closing a tab calls
 * card.close() so 'beforeclose' guards work; removing the active card activates a neighbour.
 */
import * as React from 'react';
import { Ext } from '../core/ext';
import { define } from '../core/class';
import { clsList } from './render';
import './panel';

define('Ext.tab.Tab', {
  extend: 'Ext.Component',
  alias: 'widget.tab',
  isTab: true,
  baseCls: 'x-tab',
  focusable: true,
  closable: false,
  active: false,
  closeText: 'Close Tab',
  getText: function () { return this.card ? this.card.title : this.text; },
  setText: function (t: string) { this.text = t; this.updateUI(); },
  setIconCls: function (c: string) { this.iconCls = c; this.updateUI(); },
  setClosable: function (c: boolean) { this.closable = c; this.updateUI(); },
  setActive: function (a: boolean) { this.active = a; this.updateUI(); },
  $iconCls: function () { return this.card ? (this.card.iconCls || this.iconCls) : this.iconCls; },
  $isClosable: function () { return this.card ? this.card.closable !== false && (this.closable || this.card.closable) : this.closable; },
  getRootCls: function () {
    const me = this;
    const pos = me.ownerCt && me.ownerCt.dock ? me.ownerCt.dock : 'top';
    return clsList(me.callParent(), 'x-tab-default', 'x-tab-' + pos, 'x-tab-default-' + pos, 'x-unselectable',
      me.active ? ['x-tab-active', 'x-tab-default-active'] : null, me.$over ? ['x-tab-over', 'x-tab-default-over'] : null,
      me.$isClosable() ? 'x-tab-closable' : null, me.disabled ? 'x-tab-disabled' : null);
  },
  $extraRootProps: function () {
    const me = this;
    return {
      role: 'tab', tabIndex: me.active ? 0 : -1, 'aria-selected': me.active ? 'true' : 'false',
      'data-qtip': (me.card && (me.card.tabConfig && me.card.tabConfig.tooltip)) || me.tooltip || undefined,
      onClick: (e: any) => { if (e.target.closest('.x-tab-close-btn')) { return; } if (!me.disabled) { me.fireEvent('click', me, new Ext.event.Event(e.nativeEvent)); if (me.ownerCt) { me.ownerCt.$onTabClick(me); } } },
      onMouseDown: (e: any) => { if (e.button === 1 && me.$isClosable()) { e.preventDefault(); me.onCloseClick(); } },
      onMouseEnter: () => { me.$over = true; me.updateUI(); },
      onMouseLeave: () => { me.$over = false; me.updateUI(); }
    };
  },
  onCloseClick: function () {
    const me = this;
    if (me.disabled) { return; }
    if (me.fireEvent('beforeclose', me) === false) { return; }
    if (me.card) { me.card.close(); } else if (me.ownerCt) { me.ownerCt.remove(me); }
    me.fireEvent('close', me);
  },
  renderContent: function () {
    const me = this;
    const icon = me.$iconCls();
    const text = me.getText();
    return (
      <span className="x-tab-wrap">
        <span ref={me.$ref('btnEl')} className={clsList('x-tab-button', icon ? 'x-tab-icon x-tab-icon-left' : null, text ? 'x-tab-text' : 'x-tab-no-text')}>
          {icon ? <span className={clsList('x-tab-icon-el', 'x-tab-icon-el-default', icon)} /> : null}
          <span ref={me.$ref('btnInnerEl')} className="x-tab-inner x-tab-inner-default" dangerouslySetInnerHTML={{ __html: text === undefined || text === null ? '' : String(text) }} />
        </span>
        {me.$isClosable() ? <span className="x-tab-close-btn x-fa fa-times" role="button" title={me.closeText} onClick={(e) => { e.stopPropagation(); me.onCloseClick(); }} /> : null}
      </span>
    );
  }
});

define('Ext.tab.Bar', {
  extend: 'Ext.container.Container',
  alias: 'widget.tabbar',
  isTabBar: true,
  baseCls: 'x-tab-bar',
  defaultType: 'tab',
  plain: false,
  layout: { type: 'hbox', align: 'stretch', overflow: 'visible' },
  $onTabClick: function (tab: any) {
    const tp = this.tabPanel;
    if (tp && tab.card) { tp.setActiveTab(tab.card); }
  },
  getRootCls: function () {
    const me = this;
    const pos = me.dock || 'top';
    return clsList(me.callParent(), 'x-tab-bar-default', 'x-tab-bar-' + pos, 'x-tab-bar-horizontal', 'x-docked', 'x-docked-' + pos, me.plain ? 'x-tab-bar-plain' : null);
  },
  getRootStyle: function () {
    const st = this.callParent();
    st.flexShrink = 0;
    st.overflowX = 'auto';
    st.overflowY = 'hidden';
    return st;
  },
  $extraRootProps: function () { return { role: 'tablist' }; }
});

define('Ext.tab.Panel', {
  extend: 'Ext.panel.Panel',
  alias: ['widget.tabpanel'],
  isTabPanel: true,
  baseCls: 'x-panel',
  layout: 'card',
  tabPosition: 'top',
  plain: false,
  removePanelHeader: true,
  deferredRender: true,
  defaultType: 'panel',
  initComponent: function () {
    const me = this;
    const barCfg = Ext.apply({}, me.tabBar);
    const extra = barCfg.items ? Ext.Array.from(barCfg.items) : [];
    delete barCfg.items;
    me.$tabBar = Ext.widget('tabbar', Ext.apply(barCfg, { dock: me.tabPosition, plain: me.plain, tabPanel: me, ui: me.ui }));
    me.$extraBarItems = extra;
    if (me.activeTab !== undefined && me.activeItem === undefined) { me.activeItem = me.activeTab; }
    me.callParent();
    me.addDocked(me.$tabBar, 0);
    if (extra.length) { me.$tabBar.add(extra); }
    const active = me.getActiveTab();
    if (active) { me.$syncTabs(active); }
  },
  getTabBar: function () { return this.$tabBar; },
  onBeforeAdd: function (item: any) {
    const me = this;
    if (me.removePanelHeader && item.isPanel !== undefined) { item.$hideHeaderForOwner = true; }
    if (item.tabConfig === undefined) { item.tabConfig = {}; }
    // Ext keeps inactive tabs laid out off screen (hideMode offsets) so their layout and scroll survive
    if (!item.$hideModeSet && (item.hideMode === undefined || item.hideMode === 'display')) { item.hideMode = 'offsets'; item.$hideModeSet = true; }
  },
  onAdd: function (item: any, index: number) {
    const me = this;
    const bar = me.$tabBar;
    const cfg = Ext.apply({ xtype: 'tab', card: item, closable: item.closable, disabled: item.disabled, hidden: item.hidden && item.$tabHidden, tabPanel: me }, item.tabConfig);
    // tabs come before extra items in the bar
    const tabs = bar.items.items.filter((c: any) => c.isTab);
    const pos = Math.min(index, tabs.length);
    item.tab = bar.insert(pos, cfg);
    item.on({
      titlechange: () => { if (item.tab) { item.tab.updateUI(); } },
      iconchange: () => { if (item.tab) { item.tab.updateUI(); } },
      disable: () => { if (item.tab) { item.tab.disable(); } },
      enable: () => { if (item.tab) { item.tab.enable(); } },
      scope: me
    });
    if (!me.$initialAdd && !me.getActiveTab()) { me.setActiveTab(item); }
    else if (!me.$initialAdd) { item.hidden = item !== me.getActiveTab(); }
  },
  onRemove: function (item: any) {
    const me = this;
    if (item.tab && !item.tab.destroyed) { const t = item.tab; item.tab = null; me.$tabBar.remove(t, true); }
    item.$hideHeaderForOwner = false;
  },
  /** Like Ext's doRemove: activate the next (else previous) enabled tab before the active card goes. */
  $detach: function (c: any, destroying?: boolean) {
    const me = this;
    if (!me.destroying && me.items && me.items.contains(c) && me.getActiveTab() === c) {
      const items = me.items.items;
      const i = items.indexOf(c);
      const ok = (x: any) => x && x !== c && !x.disabled && !(x.tab && x.tab.hidden);
      let next = null;
      for (let j = i + 1; j < items.length && !next; j++) { if (ok(items[j])) { next = items[j]; } }
      for (let j = i - 1; j >= 0 && !next; j--) { if (ok(items[j])) { next = items[j]; } }
      if (next) { me.setActiveTab(next); } else { me.activeTab = null; }
    }
    me.callParent([c, destroying]);
  },
  setActiveTab: function (card: any) {
    const me = this;
    if (typeof card === 'number' || typeof card === 'string') { card = me.getComponent(card); }
    else if (card && !card.isComponent) { card = me.add(card); }
    if (!card) { return null; }
    const old = me.getActiveTab();
    if (card === old && !card.hidden) { me.$syncTabs(card); return card; }
    if (me.fireEvent('beforetabchange', me, card, old) === false) { return old; }
    const l = me.getLayout();
    const res = l.setActiveItem(card);
    if (!res) { return old; }
    me.activeTab = card;
    me.$lastActiveIndex = me.items.indexOf(card);
    me.$syncTabs(card);
    me.fireEvent('tabchange', me, card, old);
    return card;
  },
  getActiveTab: function () {
    const me = this;
    const l = me.getLayout();
    const a = l && l.getActiveItem ? l.getActiveItem() : null;
    return a && me.items.contains(a) && !a.hidden ? a : (a && me.items.contains(a) ? a : null);
  },
  $syncTabs: function (active: any) {
    for (const c of this.items.items) { if (c.tab) { c.tab.setActive(c === active); } }
  },
  getRootCls: function () { return clsList(this.callParent(), 'x-tabpanel', this.plain ? 'x-tabpanel-plain' : null); },
  $bodyExtraCls: function () { return 'x-tabpanel-body'; },
  doDestroy: function () {
    const me = this;
    me.destroying = true;
    me.callParent();
  }
});
