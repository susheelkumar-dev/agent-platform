/**
 * Picker fields: Ext.form.field.Picker (floating picker aligned to the field, expand / collapse),
 * Ext.view.BoundList, Ext.form.field.ComboBox (local / remote query, anyMatch, forceSelection, typeAhead,
 * keyboard navigation, array stores, multiSelect), Ext.form.field.Tag, Ext.picker.Date and Ext.form.field.Date.
 */
import * as React from 'react';
import { Ext } from '../../core/ext';
import { define } from '../../core/class';
import { clsList, flushRender } from '../render';
import '../floating';
import './field';

// ---------------------------------------------------------------- Picker base
define('Ext.form.field.Picker', {
  extend: 'Ext.form.field.Text',
  alias: 'widget.pickerfield',
  isPickerField: true,
  matchFieldWidth: true,
  pickerAlign: 'tl-bl?',
  openCls: 'x-pickerfield-open',
  isExpanded: false,
  $builtinTriggers: ['picker'],
  $defaultTriggers: function () { return { picker: { cls: 'x-form-arrow-trigger', weight: 100, $onClick: function (this: any) { this.onTriggerClick(); } } }; },
  onTriggerClick: function () {
    const me = this;
    if (me.readOnly || me.disabled) { return; }
    if (me.isExpanded) { me.collapse(); } else { me.expand(); }
    if (me.inputEl && me.inputEl.dom && document.activeElement !== me.inputEl.dom) { me.inputEl.dom.focus(); }
  },
  $onNotEditableClick: function (re: any) { re.preventDefault(); this.onTriggerClick(); },
  getPicker: function () {
    const me = this;
    if (!me.picker || me.picker.destroyed) {
      me.picker = me.createPicker();
      me.picker.ownerCmp = me;
      me.picker.pickerField = me;
    }
    return me.picker;
  },
  createPicker: function () { return Ext.widget('component', { floating: true, hidden: true, html: '' }); },
  expand: function () {
    const me = this;
    if (me.isExpanded || me.readOnly || me.disabled) { return; }
    const picker = me.getPicker();
    if (me.matchFieldWidth) {
      flushRender();
      const wrap = me.triggerWrap || me.bodyEl || me.el;
      if (wrap) { picker.width = wrap.dom.offsetWidth; picker.minWidth = undefined; }
    }
    me.isExpanded = true;
    picker.showBy(me.triggerWrap || me.bodyEl || me, me.pickerAlign, me.pickerOffset);
    me.updateUI();
    if (me.onExpand) { me.onExpand(); }
    me.fireEvent('expand', me);
    me.$installCollapseWatch();
  },
  collapse: function () {
    const me = this;
    if (!me.isExpanded || me.destroyed) { return; }
    me.isExpanded = false;
    if (me.picker && !me.picker.destroyed) { me.picker.hide(); }
    me.updateUI();
    if (me.onCollapse) { me.onCollapse(); }
    me.fireEvent('collapse', me);
    me.$removeCollapseWatch();
  },
  $installCollapseWatch: function () {
    const me = this;
    if (me.$watch) { return; }
    me.$watch = (e: MouseEvent) => {
      const t = e.target as any;
      if (me.el && me.el.dom.contains(t)) { return; }
      if (me.picker && me.picker.el && me.picker.el.dom.contains(t)) { return; }
      me.collapse();
    };
    document.addEventListener('mousedown', me.$watch, true);
  },
  $removeCollapseWatch: function () { if (this.$watch) { document.removeEventListener('mousedown', this.$watch, true); this.$watch = null; } },
  $keepFocus: function (next: any) { return !!(next && this.picker && this.picker.el && this.picker.el.dom.contains(next)); },
  postBlur: function () { this.collapse(); },
  getRootCls: function () { return clsList(this.callParent(), this.isExpanded ? this.openCls : null); },
  doDestroy: function () { this.$removeCollapseWatch(); if (this.picker) { this.picker.destroy(); } this.callParent(); }
});

// ---------------------------------------------------------------- BoundList
define('Ext.view.BoundList', {
  extend: 'Ext.Component',
  alias: 'widget.boundlist',
  baseCls: 'x-boundlist',
  floating: true,
  hidden: true,
  focusable: false,
  maxHeight: 300,
  itemCls: 'x-boundlist-item',
  selectedItemCls: 'x-boundlist-selected',
  overItemCls: 'x-boundlist-item-over',
  emptyText: '',
  deferEmptyText: false,
  displayField: 'text',
  initComponent: function () {
    const me = this;
    me.callParent();
    me.highlighted = -1;
    if (me.store) { me.bindStore(me.store); }
  },
  bindStore: function (s: any) {
    const me = this;
    if (me.$storeL) { me.$storeL.destroy(); }
    me.store = s;
    if (s) { me.$storeL = me.mon(s, { datachanged: me.refresh, refresh: me.refresh, update: me.refresh, filterchange: me.refresh, load: me.refresh, scope: me, destroyable: true }); }
    me.refresh();
  },
  getStore: function () { return this.store; },
  refresh: function () { const me = this; me.highlighted = Math.min(me.highlighted, me.$records().length - 1); me.updateUI(); me.fireEvent('refresh', me); },
  $records: function () { return this.store ? this.store.getRange() : []; },
  getNodes: function () { flushRender(); return this.el ? Array.from(this.el.dom.querySelectorAll('.' + this.itemCls)) : []; },
  getNode: function (rec: any) { const i = typeof rec === 'number' ? rec : this.$records().indexOf(rec); return this.getNodes()[i] || null; },
  getRecord: function (node: any) { const d = node && node.dom ? node.dom : node; const i = this.getNodes().indexOf(d); return i >= 0 ? this.$records()[i] : null; },
  indexOf: function (rec: any) { return this.$records().indexOf(rec); },
  highlightItem: function (i: number) {
    const me = this;
    me.highlighted = i;
    me.updateUI();
    flushRender();
    const n = me.getNodes()[i] as any;
    if (n && n.scrollIntoView) { n.scrollIntoView({ block: 'nearest' }); }
    const rec = me.$records()[i];
    if (rec) { me.fireEvent('highlightitem', me, n, rec); }
  },
  getHighlighted: function () { return this.highlighted >= 0 ? this.$records()[this.highlighted] || null : null; },
  $itemHtml: function (rec: any) {
    const me = this;
    if (me.tpl || me.itemTpl) {
      const t = me.$compiledItemTpl || (me.$compiledItemTpl = Ext.XTemplate.getTpl ? (typeof me.itemTpl === 'string' || Ext.isArray(me.itemTpl) ? new Ext.XTemplate(me.itemTpl) : me.itemTpl) : null);
      if (t && t.apply) { return t.apply(rec.getData()); }
    }
    const v = rec.get(me.displayField);
    return Ext.String.htmlEncode(v === null || v === undefined ? '' : String(v));
  },
  getRootCls: function () { return clsList(this.callParent(), 'x-boundlist-default', 'x-layer', 'x-boundlist-floating'); },
  getRootStyle: function () { const st = this.callParent(); st.overflowY = 'auto'; st.position = 'fixed'; return st; },
  $extraRootProps: function () { return { role: 'listbox', onMouseDown: (e: any) => e.preventDefault() }; },
  renderContent: function () {
    const me = this;
    const recs = me.$records();
    const sel = me.pickerField ? me.pickerField.$selectedSet() : new Set();
    if (!recs.length) {
      return <div className="x-boundlist-list-ct">{me.emptyText ? <div className="x-grid-empty x-boundlist-empty" dangerouslySetInnerHTML={{ __html: me.emptyText }} /> : null}</div>;
    }
    return (
      <ul className="x-list-plain x-boundlist-list-ct" ref={me.$ref('listEl')}>
        {recs.map((r: any, i: number) => (
          <li key={r.internalId || r.id || i} role="option" className={clsList(me.itemCls, sel.has(r) ? me.selectedItemCls : null, i === me.highlighted ? me.overItemCls : null)}
            data-recordindex={i} onMouseEnter={() => { me.highlighted = i; me.updateUI(); }}
            onClick={(e) => { if (me.pickerField) { me.pickerField.$onListSelect(r, e); } me.fireEvent('itemclick', me, r, e.currentTarget, i, new Ext.event.Event(e.nativeEvent)); }}
            dangerouslySetInnerHTML={{ __html: me.$itemHtml(r) }} />
        ))}
      </ul>
    );
  },
  doDestroy: function () { if (this.$storeL) { this.$storeL.destroy(); } this.callParent(); }
});

// ---------------------------------------------------------------- ComboBox
function storeFromArray(arr: any[]) {
  const two = Ext.isArray(arr[0]);
  const fields = two ? ['field1', 'field2'] : ['field1'];
  const data = arr.map((x: any) => (two ? x : [x]));
  return Ext.create('Ext.data.ArrayStore', { fields, data, autoDestroy: true });
}

export const ComboBox: any = define('Ext.form.field.ComboBox', {
  extend: 'Ext.form.field.Picker',
  alias: ['widget.combobox', 'widget.combo'],
  fieldType: 'combobox',
  displayField: 'text',
  valueField: undefined,
  queryMode: 'remote',
  queryParam: 'query',
  queryDelay: undefined,
  minChars: undefined,
  triggerAction: 'all',
  typeAhead: false,
  anyMatch: false,
  caseSensitive: false,
  forceSelection: false,
  autoSelect: true,
  selectOnTab: true,
  multiSelect: false,
  delimiter: ', ',
  valueNotFoundText: undefined,
  autoLoadOnValue: false,
  allQuery: '',
  defaultListConfig: { loadingHeight: 70, minWidth: 70, maxHeight: 300 },
  initComponent: function () {
    const me = this;
    let store = me.store;
    if (Ext.isArray(store)) {
      const two = Ext.isArray(store[0]);
      store = storeFromArray(store);
      me.valueField = 'field1';
      me.displayField = two ? 'field2' : 'field1';
    } else if (store && !store.isStore) {
      store = Ext.data.StoreManager.lookup(store);
    } else if (!store) {
      store = Ext.create('Ext.data.Store', { fields: [], data: [] });
    }
    me.store = store;
    if (me.valueField === undefined) { me.valueField = me.displayField; }
    if (me.queryDelay === undefined) { me.queryDelay = me.queryMode === 'local' ? 10 : 500; }
    if (me.minChars === undefined) { me.minChars = me.queryMode === 'local' ? 0 : 4; }
    me.$selection = [];
    me.callParent();
    me.$bindStoreListeners();
  },
  $bindStoreListeners: function () {
    const me = this;
    if (me.$storeL) { me.$storeL.destroy(); }
    if (me.store && me.store.isStore) {
      me.$storeL = me.mon(me.store, {
        load: () => { if (!me.$querying && me.value !== null && me.value !== undefined && me.value !== '') { me.$suspendCheck = true; me.setValue(me.value); me.$suspendCheck = false; } },
        destroyable: true
      });
    }
  },
  getStore: function () { return this.store; },
  bindStore: function (store: any) {
    const me = this;
    me.store = store && !store.isStore ? Ext.data.StoreManager.lookup(store) : store;
    me.$bindStoreListeners();
    if (me.picker) { me.picker.bindStore(me.store); }
    if (me.value !== null && me.value !== undefined) { me.setValue(me.value); }
  },
  setStore: function (s: any) { this.bindStore(s); },
  createPicker: function () {
    const me = this;
    const cfg = Ext.apply({ xtype: 'boundlist', pickerField: me, store: me.store, displayField: me.displayField, ownerCmp: me }, me.listConfig, me.defaultListConfig);
    if (me.tpl && !cfg.itemTpl) { cfg.tpl = me.tpl; }
    if (me.listConfig && me.listConfig.getInnerTpl) { cfg.itemTpl = me.listConfig.getInnerTpl(me.displayField); }
    return Ext.widget('boundlist', cfg);
  },
  $selectedSet: function () { return new Set(this.$selection || []); },

  // ---- record lookup
  findRecord: function (field: string, value: any) {
    const s = this.store;
    if (!s) { return null; }
    const src = s.getData && s.getData().getSource ? (s.getData().getSource() || s.getData()) : null;
    const items = src && src.items ? src.items : s.getRange();
    for (const r of items) { if (r.get(field) === value || (value !== null && value !== undefined && r.get(field) !== null && r.get(field) !== undefined && String(r.get(field)) === String(value))) { return r; } }
    return null;
  },
  findRecordByValue: function (v: any) { return this.findRecord(this.valueField, v); },
  findRecordByDisplay: function (v: any) { return this.findRecord(this.displayField, v); },
  getSelection: function () { return this.multiSelect ? this.$selection.slice() : (this.$selection[0] || null); },
  getSelectedRecord: function () { return this.$selection[0] || null; },
  getValueRecord: function () { return this.getSelectedRecord(); },
  getDisplayValue: function () {
    const me = this;
    const v = me.value;
    const empty = v === null || v === undefined || v === '' || (Ext.isArray(v) && !v.length);
    if (!me.$selection.length) {
      if (empty) { return ''; }
      if (me.valueNotFoundText !== undefined) { return me.valueNotFoundText; }
      return Ext.isArray(v) ? v.join(me.delimiter) : String(v);
    }
    return me.$selection.map((r: any) => me.$displayOf(r)).join(me.delimiter);
  },
  $storeLoaded: function () { const s = this.store; return !s || !s.isLoaded || s.isLoaded() || s.getCount() > 0; },
  $displayOf: function (r: any) {
    const me = this;
    if (me.displayTpl) {
      const t = me.$displayTplC || (me.$displayTplC = typeof me.displayTpl === 'string' || Ext.isArray(me.displayTpl) ? new Ext.XTemplate(me.displayTpl) : me.displayTpl);
      return t.apply([r.getData()]).replace(/<[^>]*>/g, '');
    }
    const v = r.get(me.displayField);
    return v === null || v === undefined ? '' : String(v);
  },

  // ---- value
  $defaultValue: function () { return this.multiSelect ? [] : null; },
  getValue: function () {
    const me = this;
    const v = me.value;
    return v === undefined ? null : v;
  },
  setValue: function (value: any) {
    const me = this;
    if (value === undefined) { value = null; }
    const list = me.multiSelect ? (value === null || value === '' ? [] : Ext.Array.from(value)) : [value];
    const recs: any[] = [];
    const vals: any[] = [];
    for (const v of list) {
      if (v === null || v === undefined) { continue; }
      if (v && v.isModel) { recs.push(v); vals.push(v.get(me.valueField)); continue; }
      if (v === '' && !me.findRecordByValue('')) { continue; }
      const r = me.findRecordByValue(v);
      if (r) { recs.push(r); vals.push(r.get(me.valueField)); } else { vals.push(v); }
    }
    me.$selection = recs;
    me.value = me.multiSelect ? vals : (vals.length ? vals[0] : null);
    me.setRawValue(me.getDisplayValue());
    me.$lastRawSelected = me.getRawValue();
    me.checkChange();
    me.updateUI();
    if (me.reference) { me.publishState('selection', me.getSelection()); }
    return me;
  },
  getSubmitValue: function () { const v = this.getValue(); return v === null || v === undefined ? '' : v; },
  getModelData: function () { const me = this; if (me.disabled || !me.name) { return null; } return { [me.name]: me.getValue() }; },
  getErrors: function (value?: any) {
    const me = this;
    if (value === undefined) { value = me.getRawValue(); }
    return me.callParent([value]);
  },
  clearValue: function () { this.setValue(this.multiSelect ? [] : null); },
  reset: function () { this.$clearQueryFilter(); this.callParent(); },

  // ---- selection from the list
  $onListSelect: function (rec: any, e?: any) {
    const me = this;
    void e;
    if (me.fireEvent('beforeselect', me, rec, me.store.indexOf(rec)) === false) { return; }
    if (me.multiSelect) {
      const sel = me.$selection.slice();
      const i = sel.indexOf(rec);
      if (i >= 0) { sel.splice(i, 1); } else { sel.push(rec); }
      me.$clearQueryFilter();
      me.setValue(sel);
      me.fireEvent('select', me, sel);
      if (me.picker) { me.picker.updateUI(); }
      return;
    }
    me.$clearQueryFilter();
    me.setValue(rec);
    me.collapse();
    me.fireEvent('select', me, rec);
  },
  select: function (r: any) { this.setValue(r); },

  // ---- querying
  $queryFilterId: 'combo-query',
  $clearQueryFilter: function () {
    const me = this;
    if (me.$queryFilter && me.store && me.store.getFilters) {
      me.$queryFilter = null;
      me.store.removeFilter(me.$queryFilterId);
    }
  },
  doQuery: function (query: string, forceAll?: boolean) {
    const me = this;
    query = query || '';
    const plan: any = { query, forceAll: !!forceAll, combo: me, cancel: false };
    if (me.fireEvent('beforequery', plan) === false || plan.cancel) { return false; }
    query = plan.query;
    if (me.queryMode === 'local') {
      me.$clearQueryFilter();
      if (!plan.forceAll && query.length >= me.minChars && query !== '') {
        const q = me.caseSensitive ? query : query.toLowerCase();
        const df = me.displayField;
        me.$queryFilter = true;
        me.store.addFilter({ id: me.$queryFilterId, filterFn: (r: any) => {
          let v = r.get(df);
          v = v === null || v === undefined ? '' : String(v);
          if (!me.caseSensitive) { v = v.toLowerCase(); }
          return me.anyMatch ? v.indexOf(q) >= 0 : v.indexOf(q) === 0;
        } });
      }
      me.expand();
      me.$afterQuery(query);
    } else {
      if (query.length < me.minChars && !plan.forceAll) { return false; }
      const params: any = {};
      params[me.queryParam] = plan.forceAll ? me.allQuery : query;
      me.$querying = true;
      me.store.load({ params, callback: () => { me.$querying = false; me.expand(); me.$afterQuery(query); } });
    }
    return true;
  },
  $afterQuery: function (query: string) {
    const me = this;
    const p = me.getPicker();
    const recs = me.store.getRange();
    let idx = -1;
    if (me.$selection.length) { idx = recs.indexOf(me.$selection[0]); }
    if (idx < 0 && me.autoSelect && recs.length && query) { idx = 0; }
    p.highlightItem(idx);
    if (me.typeAhead && query && recs.length && me.editable !== false) {
      const disp = me.$displayOf(recs[0]);
      if (disp.toLowerCase().indexOf(query.toLowerCase()) === 0 && disp.length > query.length) {
        me.setRawValue(disp);
        const d = me.inputEl && me.inputEl.dom;
        if (d) { d.value = disp; d.setSelectionRange(query.length, disp.length); }
      }
    }
  },
  onTriggerClick: function () {
    const me = this;
    if (me.readOnly || me.disabled) { return; }
    if (me.isExpanded) { me.collapse(); }
    else {
      if (me.triggerAction === 'all') { me.doQuery(me.allQuery, true); } else if (me.triggerAction === 'last') { me.doQuery(me.$lastQuery || '', true); } else { me.doQuery(me.getRawValue(), false); }
    }
    if (me.inputEl && me.inputEl.dom && document.activeElement !== me.inputEl.dom) { me.inputEl.dom.focus(); }
  },
  $onInput: function (re: any) {
    const me = this;
    me.$raw = re.target.value;
    me.$typed = true;
    clearTimeout(me.$qTimer);
    const q = me.$raw;
    me.$qTimer = setTimeout(() => {
      if (me.destroyed) { return; }
      me.$lastQuery = q;
      if (q === '' && !me.multiSelect) {
        me.$selection = [];
        me.value = null;
        me.checkChange();
      }
      me.doQuery(me.multiSelect ? q : q, false);
    }, me.queryDelay);
    if (!me.forceSelection && !me.multiSelect) {
      const r = me.findRecordByDisplay(q);
      me.$selection = r ? [r] : [];
      me.value = r ? r.get(me.valueField) : (q === '' ? null : q);
      me.checkChange();
    }
    me.updateUI();
  },
  $onFieldKeyDown: function (e: any, re: any) {
    const me = this;
    const p = me.picker;
    const k = re.key;
    if (k === 'ArrowDown') {
      re.preventDefault();
      if (!me.isExpanded) { me.onTriggerClick(); return; }
      const n = me.store.getCount();
      if (n) { p.highlightItem(Math.min(n - 1, p.highlighted + 1)); }
    } else if (k === 'ArrowUp' && me.isExpanded) {
      re.preventDefault();
      p.highlightItem(Math.max(0, p.highlighted - 1));
    } else if (k === 'Enter' && me.isExpanded) {
      re.preventDefault();
      const r = p.getHighlighted();
      if (r) { me.$onListSelect(r); } else { me.collapse(); }
    } else if (k === 'Escape' && me.isExpanded) {
      re.preventDefault(); re.stopPropagation();
      me.collapse();
    } else if (k === 'Tab' && me.isExpanded && me.selectOnTab) {
      const r = p.getHighlighted();
      if (r && me.$typed) { me.$onListSelect(r); }
      me.collapse();
    }
  },
  onCollapse: function () {
    const me = this;
    if (me.queryMode === 'local' && !me.multiSelect) { me.$clearQueryFilter(); }
  },
  beforeBlur: function () {
    const me = this;
    clearTimeout(me.$qTimer);
    me.$assertValue();
    me.$typed = false;
  },
  $assertValue: function () {
    const me = this;
    if (me.multiSelect) { return; }
    const raw = me.getRawValue();
    if (!me.$typed) { me.setRawValue(me.getDisplayValue()); return; }
    if (me.forceSelection) {
      const r = raw ? me.findRecordByDisplay(raw) : null;
      if (r) { if (me.$selection[0] !== r) { me.setValue(r); me.fireEvent('select', me, r); } else { me.setRawValue(me.getDisplayValue()); } }
      else if (!raw) { me.setValue(null); }
      else { me.setValue(me.$lastValueBeforeTyping !== undefined ? me.$lastValueBeforeTyping : me.lastValue); }
    } else {
      const r = raw ? me.findRecordByDisplay(raw) : null;
      if (r) { me.setValue(r); } else { me.value = raw === '' ? null : raw; me.checkChange(); }
    }
    me.$clearQueryFilter();
  },
  $onFocus: function (re: any) {
    const me = this;
    me.$lastValueBeforeTyping = me.getValue();
    me.callParent([re]);
  },
  doDestroy: function () {
    const me = this;
    clearTimeout(me.$qTimer);
    if (me.$storeL) { me.$storeL.destroy(); }
    me.$clearQueryFilter();
    me.callParent();
  }
});

// ---------------------------------------------------------------- Tag
define('Ext.form.field.Tag', {
  extend: 'Ext.form.field.ComboBox',
  alias: 'widget.tagfield',
  fieldType: 'tag',
  multiSelect: true,
  filterPickList: false,
  stacked: false,
  createNewOnEnter: false,
  createNewOnBlur: false,
  growMax: false,
  selectOnFocus: true,
  triggerAction: 'all',
  delimiter: ',',
  initComponent: function () {
    const me = this;
    me.callParent();
    if (me.filterPickList) { me.$pickFilterId = 'tag-picklist'; }
  },
  setValue: function (value: any) {
    const me = this;
    if (typeof value === 'string' && value !== '') { value = value.split(me.delimiter).map((s: string) => s.trim()); }
    me.callParent([value]);
    me.setRawValue('');
    me.$syncPickFilter();
    return me;
  },
  getDisplayValue: function () { return ''; },
  $syncPickFilter: function () {
    const me = this;
    if (!me.filterPickList || !me.store || !me.store.addFilter) { return; }
    const sel = new Set(me.$selection);
    me.store.removeFilter(me.$pickFilterId, true);
    if (sel.size) { me.store.addFilter({ id: me.$pickFilterId, filterFn: (r: any) => !sel.has(r) }); }
  },
  findRecord: function (field: string, value: any) {
    // look in unfiltered data so selected (filtered out) records still resolve
    const s = this.store;
    if (!s) { return null; }
    const src = s.getData && s.getData().getSource ? s.getData().getSource() : null;
    const items = src && src.items ? src.items : (s.queryRecords ? null : s.getRange());
    if (!items && s.queryRecords) {
      const found = s.queryRecords(field, value);
      if (found && found.length) { return found[0]; }
      return s.getRange().find((r: any) => String(r.get(field)) === String(value)) || null;
    }
    return (items || []).find((r: any) => r.get(field) === value || String(r.get(field)) === String(value)) || null;
  },
  $onListSelect: function (rec: any) {
    const me = this;
    if (me.fireEvent('beforeselect', me, rec) === false) { return; }
    const sel = me.$selection.slice();
    const i = sel.indexOf(rec);
    if (i >= 0) { sel.splice(i, 1); } else { sel.push(rec); }
    me.$clearQueryFilter();
    me.setValue(sel);
    me.fireEvent('select', me, sel);
    if (me.inputEl) { me.inputEl.dom.value = ''; }
    if (me.picker) { me.picker.refresh(); }
    if (me.filterPickList && !me.store.getCount()) { me.collapse(); }
  },
  removeValue: function (rec: any) {
    const me = this;
    const sel = me.$selection.filter((r: any) => r !== rec);
    const vals = Ext.Array.from(me.value).filter((v: any) => !rec || (rec.isModel ? String(v) !== String(rec.get(me.valueField)) : String(v) !== String(rec)));
    me.setValue(sel.length === vals.length ? sel : vals);
  },
  addValue: function (v: any) { this.setValue(Ext.Array.from(this.getValue()).concat(Ext.Array.from(v))); },
  $onInput: function (re: any) {
    const me = this;
    me.$raw = re.target.value;
    clearTimeout(me.$qTimer);
    const q = me.$raw;
    me.$qTimer = setTimeout(() => { if (!me.destroyed) { me.doQuery(q, false); } }, me.queryDelay);
  },
  $onFieldKeyDown: function (e: any, re: any) {
    const me = this;
    if (re.key === 'Backspace' && !re.target.value && me.$selection.length && !me.readOnly) {
      me.removeValue(me.$selection[me.$selection.length - 1]);
      return;
    }
    if (re.key === 'Enter' && me.createNewOnEnter && re.target.value && !(me.isExpanded && me.picker && me.picker.getHighlighted())) {
      re.preventDefault();
      me.addValue(re.target.value);
      re.target.value = '';
      return;
    }
    me.callParent([e, re]);
  },
  beforeBlur: function () {
    const me = this;
    clearTimeout(me.$qTimer);
    if (me.inputEl) { me.inputEl.dom.value = ''; }
    me.$raw = '';
    me.$clearQueryFilter();
  },
  getErrors: function () {
    const me = this;
    const errors: string[] = [];
    const v = me.getValue();
    if (Ext.isFunction(me.validator)) { const m = me.validator.call(me, v); if (m !== true) { errors.push(m); } }
    if (!me.allowBlank && (!v || !v.length)) { errors.push(me.blankText); }
    return errors;
  },
  isValid: function () { const me = this; return me.disabled ? true : me.validateValue(me.getValue()); },
  validateValue: function () {
    const me = this;
    const errs = me.getErrors();
    if (!me.preventMark) { if (errs.length) { me.markInvalid(errs); } else { me.clearInvalid(); } }
    return !errs.length;
  },
  renderBody: function () {
    const me = this;
    const chips = me.$selection.length ? me.$selection : Ext.Array.from(me.value).filter((v: any) => v !== null && v !== undefined && v !== '');
    return (
      <div ref={me.$ref('triggerWrap')} className={clsList('x-form-trigger-wrap', 'x-form-trigger-wrap-default', me.hasActiveError() ? 'x-form-trigger-wrap-invalid' : null, me.$hasFocusCls ? 'x-form-trigger-wrap-focus' : null)}
        style={{ display: 'flex', flex: '1 1 auto', minWidth: 0, alignItems: 'stretch' }}>
        <div className={clsList('x-tagfield', 'x-form-text-wrap', 'x-form-text-wrap-default', me.stacked ? 'x-tagfield-stacked' : null)} style={{ flex: '1 1 auto', minWidth: 0, display: 'flex' }}
          onMouseDown={(e) => { if ((e.target as any).closest('.x-tagfield-item-close')) { e.preventDefault(); } }}
          onClick={(e) => { if (!(e.target as any).closest('.x-tagfield-item-close') && me.inputEl) { me.inputEl.dom.focus(); } }}>
          <ul className="x-tagfield-list x-list-plain" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', flex: '1 1 auto', margin: 0, padding: '1px 2px', gap: 2, minWidth: 0 }}>
            {chips.map((r: any, i: number) => {
              const label = r && r.isModel ? me.$displayOf(r) : String(r);
              return <li key={'tag-' + (r && r.isModel ? r.internalId || r.id : r) + '-' + i} className="x-tagfield-item" title={label}>
                <div className="x-tagfield-item-text">{label}</div>
                {me.readOnly ? null : <div className="x-tagfield-item-close x-fa fa-times" onClick={(e) => { e.stopPropagation(); me.removeValue(r); }} />}
              </li>;
            })}
            <li className="x-tagfield-input" style={{ flex: '1 1 40px', minWidth: 40 }}>
              <input id={me.getInputId()} ref={me.$ref('inputEl')} className={clsList('x-tagfield-input-field', 'x-form-field', 'x-form-text', 'x-form-text-default')} autoComplete="off" readOnly={me.readOnly || me.editable === false}
                placeholder={chips.length ? undefined : me.emptyText || undefined} disabled={me.disabled} defaultValue="" style={{ width: '100%', border: 0 }}
                onInput={(e: any) => me.$onInput(e)} onFocus={(e: any) => me.$onFocus(e)} onBlur={(e: any) => me.$onBlur(e)} onKeyDown={(e: any) => me.$onKeyDown(e)} />
            </li>
          </ul>
        </div>
        {me.renderTriggers()}
      </div>
    );
  },
  $syncInput: Ext.emptyFn
});

// ---------------------------------------------------------------- Date picker
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function clearTime(d: Date) { const x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x; }

define('Ext.picker.Date', {
  extend: 'Ext.Component',
  alias: 'widget.datepicker',
  baseCls: 'x-datepicker',
  focusable: true,
  startDay: 0,
  showToday: true,
  todayText: 'Today',
  minText: 'This date is before the minimum date',
  maxText: 'This date is after the maximum date',
  disabledDaysText: 'Disabled',
  format: 'm/d/Y',
  initComponent: function () {
    const me = this;
    me.callParent();
    me.value = me.value ? clearTime(me.value) : clearTime(new Date());
    me.$active = new Date(me.value.getFullYear(), me.value.getMonth(), 1);
  },
  setValue: function (v: Date) { const me = this; me.value = v ? clearTime(v) : null; me.$active = new Date((me.value || new Date()).getFullYear(), (me.value || new Date()).getMonth(), 1); me.updateUI(); return me; },
  getValue: function () { return this.value; },
  setMinDate: function (d: Date) { this.minDate = d; this.updateUI(); },
  setMaxDate: function (d: Date) { this.maxDate = d; this.updateUI(); },
  setDisabledDays: function (d: number[]) { this.disabledDays = d; this.updateUI(); },
  showPrevMonth: function () { const a = this.$active; this.$active = new Date(a.getFullYear(), a.getMonth() - 1, 1); this.updateUI(); },
  showNextMonth: function () { const a = this.$active; this.$active = new Date(a.getFullYear(), a.getMonth() + 1, 1); this.updateUI(); },
  showPrevYear: function () { const a = this.$active; this.$active = new Date(a.getFullYear() - 1, a.getMonth(), 1); this.updateUI(); },
  showNextYear: function () { const a = this.$active; this.$active = new Date(a.getFullYear() + 1, a.getMonth(), 1); this.updateUI(); },
  $isDisabled: function (d: Date) {
    const me = this;
    if (me.minDate && d < clearTime(me.minDate)) { return me.minText; }
    if (me.maxDate && d > clearTime(me.maxDate)) { return me.maxText; }
    if (me.disabledDays && me.disabledDays.indexOf(d.getDay()) >= 0) { return me.disabledDaysText; }
    if (me.disabledDatesRE && me.disabledDatesRE.test(Ext.Date.format(d, me.format))) { return me.disabledDatesText || 'Disabled'; }
    return null;
  },
  $select: function (d: Date) {
    const me = this;
    if (me.$isDisabled(d) || me.disabled) { return; }
    me.value = d;
    me.updateUI();
    me.fireEvent('select', me, d);
    if (me.handler) { Ext.callback(me.handler, me.scope, [me, d], 0, me); }
  },
  selectToday: function () { this.$active = new Date(new Date().getFullYear(), new Date().getMonth(), 1); this.$select(clearTime(new Date())); },
  $extraRootProps: function () {
    const me = this;
    return {
      tabIndex: 0, role: 'grid',
      onKeyDown: (e: any) => {
        const cur = me.value || clearTime(new Date());
        const step = (n: number) => { const d = new Date(cur.getTime()); d.setDate(d.getDate() + n); me.value = d; me.$active = new Date(d.getFullYear(), d.getMonth(), 1); me.updateUI(); e.preventDefault(); };
        if (e.key === 'ArrowLeft') { step(-1); } else if (e.key === 'ArrowRight') { step(1); } else if (e.key === 'ArrowUp') { step(-7); } else if (e.key === 'ArrowDown') { step(7); }
        else if (e.key === 'Enter') { e.preventDefault(); me.$select(cur); } else if (e.key === 'PageUp') { e.preventDefault(); me.showPrevMonth(); } else if (e.key === 'PageDown') { e.preventDefault(); me.showNextMonth(); }
      },
      onMouseDown: (e: any) => { if (me.pickerField) { e.preventDefault(); } }
    };
  },
  getRootCls: function () { return clsList(this.callParent(), 'x-datepicker-default', this.floating ? 'x-layer' : null); },
  getRootStyle: function () { const st = this.callParent(); if (this.floating) { st.position = 'fixed'; } return st; },
  renderContent: function () {
    const me = this;
    const a = me.$active;
    const first = new Date(a.getFullYear(), a.getMonth(), 1);
    const offset = (first.getDay() - me.startDay + 7) % 7;
    const start = new Date(first.getTime()); start.setDate(1 - offset);
    const today = clearTime(new Date()).getTime();
    const sel = me.value ? me.value.getTime() : null;
    const rows = [];
    for (let w = 0; w < 6; w++) {
      const cells = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(start.getTime()); day.setDate(start.getDate() + w * 7 + d);
        const dis = me.$isDisabled(day);
        const t = day.getTime();
        const inMonth = day.getMonth() === a.getMonth();
        cells.push(<td key={d} role="gridcell" title={dis || undefined}
          className={clsList('x-datepicker-cell', inMonth ? 'x-datepicker-active' : (day < first ? 'x-datepicker-prevday' : 'x-datepicker-nextday'), t === today ? 'x-datepicker-today' : null, t === sel ? 'x-datepicker-selected' : null, dis ? 'x-datepicker-disabled' : null)}
          onClick={() => me.$select(day)}>
          <div className="x-datepicker-date">{day.getDate()}</div>
        </td>);
      }
      rows.push(<tr key={w}>{cells}</tr>);
    }
    const dayNames = [];
    for (let i = 0; i < 7; i++) { const n = DAYS[(i + me.startDay) % 7]; dayNames.push(<th key={i} className="x-datepicker-column-header" title={n}><div className="x-datepicker-column-header-inner">{n.charAt(0)}</div></th>); }
    return [
      <div key="h" className="x-datepicker-header" style={{ display: 'flex', alignItems: 'center' }}>
        <div className="x-datepicker-prev x-fa fa-angle-left" role="button" title="Previous Month (Control+Left)" onClick={(e) => (e.ctrlKey ? me.showPrevYear() : me.showPrevMonth())} />
        <div className="x-datepicker-month" style={{ flex: 1, textAlign: 'center' }}>
          <span className="x-btn-inner">{MONTHS[a.getMonth()] + ' ' + a.getFullYear()}</span>
        </div>
        <div className="x-datepicker-next x-fa fa-angle-right" role="button" title="Next Month (Control+Right)" onClick={(e) => (e.ctrlKey ? me.showNextYear() : me.showNextMonth())} />
      </div>,
      <table key="t" className="x-datepicker-inner" cellSpacing={0} role="presentation">
        <thead><tr>{dayNames}</tr></thead>
        <tbody>{rows}</tbody>
      </table>,
      me.showToday ? <div key="f" className="x-datepicker-footer" style={{ textAlign: 'center' }}>
        <a className="x-btn x-btn-default-small x-datepicker-today-btn" role="button" onClick={(e) => { e.preventDefault(); me.selectToday(); }}><span className="x-btn-inner">{me.todayText}</span></a>
      </div> : null
    ];
  }
});
define('Ext.picker.Month', { extend: 'Ext.Component', alias: 'widget.monthpicker' });

define('Ext.form.field.Date', {
  extend: 'Ext.form.field.Picker',
  alias: 'widget.datefield',
  fieldType: 'date',
  format: 'm/d/Y',
  altFormats: 'm/d/Y|n/j/Y|n/j/y|m/j/y|n/d/y|m/j/Y|n/d/Y|m-d-y|m-d-Y|m/d|m-d|md|mdy|mdY|d|Y-m-d|n-j|n/j',
  submitFormat: undefined,
  startDay: 0,
  showToday: true,
  useStrict: undefined,
  invalidText: '{0} is not a valid date - it must be in the format {1}',
  minText: 'The date in this field must be equal to or after {0}',
  maxText: 'The date in this field must be equal to or before {0}',
  disabledDaysText: 'Disabled',
  disabledDatesText: 'Disabled',
  matchFieldWidth: false,
  pickerAlign: 'tl-bl?',
  $builtinTriggers: ['picker'],
  $defaultTriggers: function () { return { picker: { cls: 'x-form-date-trigger', weight: 100, $onClick: function (this: any) { this.onTriggerClick(); } } }; },
  initComponent: function () {
    const me = this;
    if (typeof me.minValue === 'string') { me.minValue = me.parseDate(me.minValue); }
    if (typeof me.maxValue === 'string') { me.maxValue = me.parseDate(me.maxValue); }
    me.callParent();
  },
  $defaultValue: function () { return null; },
  parseDate: function (v: any) {
    const me = this;
    if (!v || v instanceof Date) { return v || null; }
    let d = Ext.Date.parse(v, me.format, me.useStrict);
    if (!d && me.altFormats) {
      for (const f of String(me.altFormats).split('|')) { d = Ext.Date.parse(v, f, me.useStrict); if (d) { break; } }
    }
    return d || null;
  },
  formatDate: function (d: any) { return d instanceof Date ? Ext.Date.format(d, this.format) : d; },
  rawToValue: function (raw: any) { return this.parseDate(raw) || raw || null; },
  valueToRaw: function (v: any) { return this.formatDate(this.parseDate(v)) || ''; },
  getValue: function () { const v = this.value; return v instanceof Date ? v : (v ? this.parseDate(v) : null); },
  setValue: function (v: any) {
    const me = this;
    const d = me.parseDate(v);
    me.value = d;
    me.setRawValue(d ? me.formatDate(d) : (typeof v === 'string' ? v : ''));
    me.checkChange();
    return me;
  },
  $onInput: function (re: any) {
    const me = this;
    const raw = re.target.value;
    me.$raw = raw;
    me.value = me.parseDate(raw);
    if (!me.value && raw) { me.value = null; }
    me.checkChange();
    me.updateUI();
  },
  getSubmitValue: function () {
    const me = this;
    const d = me.getValue();
    return d ? Ext.Date.format(d, me.submitFormat || me.format) : '';
  },
  getErrors: function (value?: any) {
    const me = this;
    if (value === undefined) { value = me.getRawValue(); }
    const errors = me.callParent([value]);
    value = me.formatDate(value || me.processRawValue(me.getRawValue()));
    if (value === null || value === undefined || String(value).length < 1) { return errors; }
    const d = me.parseDate(value);
    if (!d) { errors.push(Ext.String.format(me.invalidText, value, me.format)); return errors; }
    const t = clearTime(d).getTime();
    if (me.minValue && t < clearTime(me.minValue).getTime()) { errors.push(Ext.String.format(me.minText, me.formatDate(me.minValue))); }
    if (me.maxValue && t > clearTime(me.maxValue).getTime()) { errors.push(Ext.String.format(me.maxText, me.formatDate(me.maxValue))); }
    if (me.disabledDays && me.disabledDays.indexOf(d.getDay()) >= 0) { errors.push(me.disabledDaysText); }
    return errors;
  },
  beforeBlur: function () {
    const me = this;
    const d = me.parseDate(me.getRawValue());
    if (d) { me.setValue(d); }
  },
  setMinValue: function (v: any) { this.minValue = this.parseDate(v); if (this.picker) { this.picker.setMinDate(this.minValue); } },
  setMaxValue: function (v: any) { this.maxValue = this.parseDate(v); if (this.picker) { this.picker.setMaxDate(this.maxValue); } },
  createPicker: function () {
    const me = this;
    return Ext.widget('datepicker', {
      floating: true, hidden: true, pickerField: me, ownerCmp: me, format: me.format, startDay: me.startDay, showToday: me.showToday,
      minDate: me.minValue, maxDate: me.maxValue, disabledDays: me.disabledDays, disabledDatesRE: me.disabledDatesRE,
      listeners: { select: (p: any, d: Date) => me.onSelect(p, d) }
    });
  },
  onExpand: function () {
    const me = this;
    const p = me.picker;
    p.minDate = me.minValue; p.maxDate = me.maxValue;
    p.setValue(me.getValue() || new Date());
  },
  onSelect: function (p: any, d: Date) {
    const me = this;
    me.setValue(d);
    me.fireEvent('select', me, d);
    me.collapse();
    if (me.inputEl) { me.inputEl.dom.focus(); }
  },
  $onFieldKeyDown: function (e: any, re: any) {
    const me = this;
    if (re.key === 'ArrowDown' && !me.isExpanded) { re.preventDefault(); me.expand(); }
    else if (re.key === 'Escape' && me.isExpanded) { re.preventDefault(); re.stopPropagation(); me.collapse(); }
  },
  isEqual: function (a: any, b: any) {
    if (a instanceof Date && b instanceof Date) { return a.getTime() === b.getTime(); }
    return (a === null || a === undefined || a === '') && (b === null || b === undefined || b === '') ? true : a === b;
  }
});
define('Ext.form.field.Time', { extend: 'Ext.form.field.ComboBox', alias: 'widget.timefield', format: 'g:i A', queryMode: 'local' });
void flushRender;
