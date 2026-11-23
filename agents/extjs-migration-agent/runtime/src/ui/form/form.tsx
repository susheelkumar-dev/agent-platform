/**
 * Ext.form.Basic and Ext.form.Panel (fields, values, records, validity, dirty tracking), and the field
 * containers: Ext.form.FieldContainer, Ext.form.CheckboxGroup, Ext.form.RadioGroup and Ext.form.FieldSet.
 */
import * as React from 'react';
import { Ext } from '../../core/ext';
import { define } from '../../core/class';
import { Collection } from '../../util/collection';
import { clsList, styleObject } from '../render';
import { errorsHtml } from './field';
import '../panel';

// ---------------------------------------------------------------- Basic
export const BasicForm: any = define('Ext.form.Basic', {
  mixins: { observable: 'Ext.mixin.Observable' },
  isForm: true,
  trackResetOnLoad: false,
  constructor: function (owner: any, config?: any) {
    const me = this;
    me.owner = owner;
    Ext.apply(me, config);
    me.mixins.observable.constructor.call(me, {});
    me.$dirty = false;
    me.$valid = undefined;
    return me;
  },
  getFields: function () {
    const c = new Collection();
    const list = this.owner.query('[isFormField]').filter((f: any) => !f.excludeForm && !f.destroyed);
    c.add(list);
    return c;
  },
  getBoundItems: function () { return this.getFields(); },
  findField: function (id: string) {
    return this.getFields().items.find((f: any) => f.id === id || f.name === id || (f.getName && f.getName() === id) || f.dataIndex === id || f.itemId === id) || null;
  },
  isValid: function () {
    let valid = true;
    for (const f of this.getFields().items) { if (!f.validate()) { valid = false; } }
    return valid;
  },
  hasInvalidField: function () { return this.getFields().items.some((f: any) => f.hasActiveError && f.hasActiveError()); },
  checkValidity: function () {
    const me = this;
    const valid = !me.getFields().items.some((f: any) => !f.disabled && f.getErrors && f.getErrors().length);
    if (valid !== me.$valid) { me.$valid = valid; me.fireEvent('validitychange', me, valid); if (me.owner) { me.owner.fireEvent('validitychange', me, valid); } }
    return valid;
  },
  isDirty: function () { return this.getFields().items.some((f: any) => f.isDirty && f.isDirty()); },
  checkDirty: function () {
    const me = this;
    const d = me.isDirty();
    if (d !== me.$dirty) { me.$dirty = d; me.fireEvent('dirtychange', me, d); if (me.owner) { me.owner.fireEvent('dirtychange', me, d); } }
  },
  getValues: function (asString?: boolean, dirtyOnly?: boolean, includeEmptyText?: boolean, useDataValues?: boolean) {
    const values: any = {};
    for (const f of this.getFields().items) {
      if (dirtyOnly && !f.isDirty()) { continue; }
      const data = useDataValues ? f.getModelData(includeEmptyText) : f.getSubmitData(includeEmptyText);
      if (!data || typeof data !== 'object') { continue; }
      for (const name in data) {
        let v = data[name];
        if (includeEmptyText && v === '') { v = f.emptyText || ''; }
        if (Object.prototype.hasOwnProperty.call(values, name)) {
          if (!Ext.isArray(values[name])) { values[name] = [values[name]]; }
          if (Ext.isArray(v)) { values[name] = values[name].concat(v); } else { values[name].push(v); }
        } else { values[name] = v; }
      }
    }
    if (asString) { return Ext.Object.toQueryString(values); }
    return values;
  },
  getFieldValues: function (dirtyOnly?: boolean) { return this.getValues(false, dirtyOnly, false, true); },
  setValues: function (values: any) {
    const me = this;
    const set = (id: string, v: any) => {
      const f = me.findField(id);
      if (!f) { return; }
      f.setValue(v);
      if (me.trackResetOnLoad) { f.resetOriginalValue(); }
    };
    if (Ext.isArray(values)) { for (const v of values) { set(v.id, v.value); } }
    else { for (const k in values) { if (Object.prototype.hasOwnProperty.call(values, k)) { set(k, values[k]); } } }
    me.checkDirty();
    return me;
  },
  loadRecord: function (record: any) {
    const me = this;
    me.$record = record;
    me.setValues(record.getData());
    me.fireEvent('loadrecord', me, record);
    return me;
  },
  getRecord: function () { return this.$record || null; },
  updateRecord: function (record?: any) {
    const me = this;
    record = record || me.$record;
    if (!record) { return me; }
    const values = me.getFieldValues();
    const fields = record.getFields ? record.getFields() : (record.self && record.self.fields) || [];
    const names = new Set(fields.map((f: any) => f.name));
    const data: any = {};
    for (const k in values) { if (names.has(k) || !fields.length) { data[k] = values[k]; } }
    record.beginEdit && record.beginEdit();
    record.set(data);
    record.endEdit && record.endEdit();
    return me;
  },
  reset: function (resetRecord?: boolean) {
    const me = this;
    for (const f of me.getFields().items) { f.reset(); }
    if (resetRecord) { me.$record = null; }
    me.checkDirty();
    return me;
  },
  clearInvalid: function () { for (const f of this.getFields().items) { f.clearInvalid(); } return this; },
  markInvalid: function (errors: any) {
    const me = this;
    const mark = (id: string, msg: any) => { const f = me.findField(id); if (f) { f.markInvalid(msg); } };
    if (Ext.isArray(errors)) { for (const e of errors) { mark(e.id || e.field || e.name, e.msg || e.message); } }
    else if (errors && errors.isModel) { /* record errors */ const v = errors.getValidation ? errors.getValidation().getData() : {}; for (const k in v) { if (v[k] !== true) { mark(k, v[k]); } } }
    else { for (const k in errors) { mark(k, errors[k]); } }
    return me;
  },
  applyToFields: function (o: any) { for (const f of this.getFields().items) { Ext.apply(f, o); f.updateUI(); } return this; },
  applyIfToFields: function (o: any) { for (const f of this.getFields().items) { Ext.applyIf(f, o); f.updateUI(); } return this; },
  submit: function (options?: any) {
    const me = this;
    options = options || {};
    if (options.clientValidation !== false && !me.isValid()) {
      if (options.failure) { options.failure.call(options.scope, me, { failureType: 'client' }); }
      return me;
    }
    Ext.Ajax.request({
      url: options.url || me.url || (me.owner && me.owner.url), method: options.method || me.method || 'POST', params: Ext.apply(me.getValues(), options.params),
      success: (resp: any) => { const r = resp.responseJson || Ext.decode(resp.responseText, true) || {}; const cb = r.success === false ? options.failure : options.success; if (r.success === false && r.errors) { me.markInvalid(r.errors); } if (cb) { cb.call(options.scope, me, { result: r, response: resp }); } },
      failure: (resp: any) => { if (options.failure) { options.failure.call(options.scope, me, { failureType: 'server', response: resp }); } }
    });
    return me;
  },
  load: function (options?: any) {
    const me = this;
    options = options || {};
    Ext.Ajax.request({
      url: options.url || me.url, method: options.method || 'GET', params: options.params,
      success: (resp: any) => { const r = resp.responseJson || Ext.decode(resp.responseText, true) || {}; if (r.data) { me.setValues(r.data); } if (options.success) { options.success.call(options.scope, me, { result: r }); } },
      failure: (resp: any) => { if (options.failure) { options.failure.call(options.scope, me, { response: resp }); } }
    });
    return me;
  },
  destroy: function () { this.destroyObservable && this.destroyObservable(); this.destroyed = true; }
});

// ---------------------------------------------------------------- Panel
define('Ext.form.Panel', {
  extend: 'Ext.panel.Panel',
  alias: ['widget.form', 'widget.formpanel'],
  isFormPanel: true,
  layout: 'anchor',
  defaultType: 'textfield',
  trackResetOnLoad: false,
  initComponent: function () {
    const me = this;
    me.form = new BasicForm(me, { trackResetOnLoad: me.trackResetOnLoad, url: me.url, method: me.method });
    me.callParent();
  },
  getForm: function () { return this.form; },
  $onFieldDirty: function () { this.form.checkDirty(); },
  $onFieldValidity: function () { this.form.checkValidity(); },
  getValues: function (a?: any, b?: any, c?: any, d?: any) { return this.form.getValues(a, b, c, d); },
  setValues: function (v: any) { return this.form.setValues(v); },
  getFieldValues: function (d?: boolean) { return this.form.getFieldValues(d); },
  isValid: function () { return this.form.isValid(); },
  isDirty: function () { return this.form.isDirty(); },
  loadRecord: function (r: any) { return this.form.loadRecord(r); },
  updateRecord: function (r?: any) { return this.form.updateRecord(r); },
  getRecord: function () { return this.form.getRecord(); },
  reset: function (r?: boolean) { return this.form.reset(r); },
  submit: function (o?: any) { return this.form.submit(o); },
  load: function (o?: any) { return this.form.load(o); },
  getRootCls: function () { return clsList(this.callParent(), 'x-form-panel'); },
  doDestroy: function () { this.callParent(); if (this.form) { this.form.destroy(); } }
});

// ---------------------------------------------------------------- FieldContainer
const labelableProto = (): any => Ext.ClassManager.get('Ext.form.field.Base').prototype;

export const FieldContainer: any = define('Ext.form.FieldContainer', {
  extend: 'Ext.container.Container',
  alias: 'widget.fieldcontainer',
  isFieldLabelable: true,
  isFieldContainer: true,
  baseCls: 'x-form-fieldcontainer',
  fieldType: 'fieldcontainer',
  labelAlign: 'left',
  labelWidth: 100,
  labelPad: 5,
  labelSeparator: ':',
  hideLabel: false,
  hideEmptyLabel: true,
  msgTarget: 'qtip',
  combineErrors: false,
  combineLabels: false,
  layout: 'autocontainer',
  $labelVisible: function () { return labelableProto().$labelVisible.call(this); },
  $labelHtml: function () { return labelableProto().$labelHtml.call(this); },
  getInputId: function () { return this.id + '-innerCt'; },
  hasActiveError: function () { return !!(this.$errors && this.$errors.length); },
  getActiveError: function () { return this.activeError || ''; },
  markInvalid: function (e: any) { this.$errors = Ext.Array.from(e); this.activeError = errorsHtml(this.$errors); this.updateUI(); },
  clearInvalid: function () { this.$errors = []; this.activeError = ''; this.updateUI(); },
  setFieldLabel: function (l: string) { this.fieldLabel = l; this.updateUI(); },
  getFieldLabel: function () { return this.fieldLabel; },
  setReadOnly: function (ro: boolean) { this.readOnly = !!ro; for (const f of this.query('[isFormField]')) { if (f.setReadOnly) { f.setReadOnly(ro); } } this.updateUI(); },
  renderLabel: function () { return labelableProto().renderLabel.call(this); },
  renderError: function () { return labelableProto().renderError.call(this); },
  getRootCls: function () {
    const me = this;
    const align = me.labelAlign === 'top' ? 'top' : (me.labelAlign === 'right' ? 'right' : 'left');
    return clsList(me.callParent(), 'x-form-item', 'x-form-item-default', 'x-field', me.$labelVisible() ? 'x-form-item-label-' + align + '-ct' : 'x-form-item-no-label', me.hasActiveError() ? 'x-form-invalid' : null);
  },
  renderRoot: function (ref: any) {
    const me = this;
    const props = me.getRootProps(ref);
    const top = me.labelAlign === 'top';
    props.style = Object.assign({}, props.style, { display: me.hidden ? 'none' : 'flex', flexDirection: top ? 'column' : 'row', alignItems: top ? 'stretch' : 'flex-start' });
    const t = me.getLayoutTargetProps();
    return (
      <div {...props}>
        {me.renderLabel()}
        <div className={clsList('x-form-item-body', 'x-form-item-body-default', 'x-form-container-body')} style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div id={me.getInputId()} ref={me.$ref('containerEl')} className={clsList('x-form-fieldcontainer-innerCt', t.className)} style={Object.assign({}, t.style, { width: '100%' })}>
            {me.renderItemsUI()}
          </div>
        </div>
        {me.renderError()}
      </div>
    );
  }
});

// ---------------------------------------------------------------- CheckboxGroup / RadioGroup
define('Ext.form.CheckboxGroup', {
  extend: 'Ext.form.FieldContainer',
  alias: 'widget.checkboxgroup',
  isFormField: true,
  isCheckboxGroup: true,
  defaultType: 'checkboxfield',
  columns: 'auto',
  vertical: false,
  allowBlank: true,
  blankText: 'You must select at least one item in this group',
  submitValue: false,
  validateOnChange: true,
  fieldType: 'checkboxgroup',
  initComponent: function () {
    const me = this;
    me.layout = { type: 'autocontainer' };
    me.callParent();
    me.lastValue = me.originalValue = me.getValue();
  },
  onAdd: function (item: any) {
    const me = this;
    item.on('change', () => me.$onChildChange(), me);
  },
  $boxes: function () { return this.query('[isCheckbox],checkboxfield,radiofield').filter((b: any) => b.ownerCt && (b.ownerCt === this || b.isDescendantOf(this))); },
  getBoxes: function (q?: string) { return q ? this.query(q) : this.$boxes(); },
  getChecked: function () { return this.$boxes().filter((b: any) => b.checked); },
  getValue: function () {
    const out: any = {};
    for (const b of this.$boxes()) {
      if (!b.checked || !b.name) { continue; }
      const v = b.inputValue;
      if (Object.prototype.hasOwnProperty.call(out, b.name)) { out[b.name] = Ext.Array.from(out[b.name]).concat(v); } else { out[b.name] = this.isRadioGroup ? v : v; }
    }
    return out;
  },
  setValue: function (value: any) {
    const me = this;
    me.$settingValue = true;
    for (const b of me.$boxes()) {
      if (!b.name) { continue; }
      if (value && Object.prototype.hasOwnProperty.call(value, b.name)) {
        const vals = Ext.Array.from(value[b.name]).map((x: any) => String(x));
        if (b.isRadio) { if (vals.indexOf(String(b.inputValue)) >= 0) { b.$setChecked(true); } else if (b.checked) { b.$setChecked(false); } }
        else { b.setValue(vals.indexOf(String(b.inputValue)) >= 0 || vals.indexOf('true') >= 0 && b.inputValue === 'on'); }
      } else if (!me.isRadioGroup) { b.setValue(false); }
    }
    me.$settingValue = false;
    me.$onChildChange();
    return me;
  },
  $onChildChange: function () {
    const me = this;
    if (me.$settingValue) { return; }
    const nv = me.getValue();
    const ov = me.lastValue;
    if (!Ext.Object.equals(nv, ov || {})) {
      me.lastValue = nv;
      me.fireEvent('change', me, nv, ov);
      if (me.validateOnChange) { me.validate(); }
      me.$publishBinding('value', nv);
    }
  },
  getErrors: function () { return !this.allowBlank && !this.getChecked().length ? [this.blankText] : []; },
  isValid: function () {
    const me = this;
    if (me.disabled) { return true; }
    const errs = me.getErrors();
    if (errs.length) { me.markInvalid(errs); } else { me.clearInvalid(); }
    return !errs.length;
  },
  validate: function () {
    const me = this;
    const v = me.isValid();
    if (v !== me.wasValid) { me.wasValid = v; me.fireEvent('validitychange', me, v); }
    return v;
  },
  isDirty: function () { return this.$boxes().some((b: any) => b.isDirty()); },
  resetOriginalValue: function () { this.originalValue = this.getValue(); for (const b of this.$boxes()) { b.resetOriginalValue(); } },
  reset: function () { this.$settingValue = true; for (const b of this.$boxes()) { b.reset(); } this.$settingValue = false; this.$onChildChange(); this.clearInvalid(); },
  getSubmitData: function () { return null; },
  getModelData: function () { return null; },
  getName: function () { return this.name; },
  $columnStyle: function () {
    const me = this;
    const cols = me.columns;
    if (cols === 'auto' || !cols) { return { display: 'flex', flexWrap: 'wrap', columnGap: 12 }; }
    const n = typeof cols === 'number' ? cols : cols.length;
    const tpl = typeof cols === 'number' ? 'repeat(' + n + ', 1fr)' : cols.map((c: any) => (c < 1 ? (c * 100) + '%' : c + 'px')).join(' ');
    return { display: 'grid', gridTemplateColumns: tpl, gridAutoFlow: me.vertical ? 'column' : 'row', gridTemplateRows: me.vertical ? 'repeat(' + Math.ceil(me.items.getCount() / n) + ', auto)' : undefined, columnGap: 8 };
  },
  getLayoutTargetProps: function () { return { className: 'x-form-checkboxgroup-body', style: this.$columnStyle() }; },
  getRootCls: function () { return clsList(this.callParent(), this.isRadioGroup ? 'x-form-radio-group' : 'x-form-checkbox-group'); }
});
define('Ext.form.RadioGroup', {
  extend: 'Ext.form.CheckboxGroup',
  alias: 'widget.radiogroup',
  isRadioGroup: true,
  defaultType: 'radiofield',
  allowBlank: true,
  blankText: 'You must select one item in this group',
  simpleValue: false,
  getValue: function () {
    const me = this;
    const v = me.callParent();
    if (me.simpleValue) { const k = Object.keys(v); return k.length ? v[k[0]] : null; }
    return v;
  },
  setValue: function (v: any) {
    const me = this;
    if (me.simpleValue || (v !== null && typeof v !== 'object')) {
      const b = me.$boxes()[0];
      const name = b ? b.name : null;
      if (name) { return me.callParent([{ [name]: v }]); }
    }
    return me.callParent([v]);
  }
});
Ext.form.field = Ext.form.field || {};

// ---------------------------------------------------------------- FieldSet
define('Ext.form.FieldSet', {
  extend: 'Ext.container.Container',
  alias: 'widget.fieldset',
  isFieldSet: true,
  baseCls: 'x-fieldset',
  collapsible: false,
  collapsed: false,
  checkboxToggle: false,
  toggleOnTitleClick: true,
  layout: 'anchor',
  defaultType: 'textfield',
  setTitle: function (t: string) { this.title = t; this.updateUI(); return this; },
  getTitle: function () { return this.title; },
  collapse: function () { return this.setExpanded(false); },
  expand: function () { return this.setExpanded(true); },
  toggle: function () { return this.setExpanded(!!this.collapsed); },
  setCollapsed: function (c: boolean) { return this.setExpanded(!c); },
  setExpanded: function (exp: boolean) {
    const me = this;
    if (!!me.collapsed === !exp) { return me; }
    if (me.fireEvent(exp ? 'beforeexpand' : 'beforecollapse', me) === false) { return me; }
    me.collapsed = !exp;
    me.updateUI();
    me.fireEvent(exp ? 'expand' : 'collapse', me);
    return me;
  },
  isCollapsed: function () { return !!this.collapsed; },
  getRootCls: function () { return clsList(this.callParent(), 'x-fieldset-default', this.collapsed ? 'x-fieldset-collapsed' : null, this.title || this.collapsible || this.checkboxToggle ? 'x-fieldset-with-title x-fieldset-with-legend' : null); },
  renderRoot: function (ref: any) {
    const me = this;
    const props = me.getRootProps(ref);
    const t = me.getLayoutTargetProps();
    const legend = me.title || me.collapsible || me.checkboxToggle;
    return (
      <fieldset {...props} style={Object.assign({ minWidth: 0 }, props.style)}>
        {legend ? <legend className="x-fieldset-header x-fieldset-header-default" ref={me.$ref('legend')}>
          {me.checkboxToggle ? <input type="checkbox" className="x-form-checkbox x-fieldset-header-checkbox" checked={!me.collapsed} onChange={() => me.toggle()} /> : null}
          {me.collapsible && !me.checkboxToggle ? <span className={clsList('x-tool', 'x-tool-toggle', 'x-fa', me.collapsed ? 'fa-plus-square' : 'fa-minus-square')} role="button" onClick={() => me.toggle()} style={{ cursor: 'pointer', marginRight: 4 }} /> : null}
          <div className="x-fieldset-header-text x-fieldset-header-text-collapsible" style={{ display: 'inline', cursor: me.collapsible && me.toggleOnTitleClick ? 'pointer' : 'default' }}
            onClick={() => { if (me.collapsible && me.toggleOnTitleClick) { me.toggle(); } }} dangerouslySetInnerHTML={{ __html: me.title || '' }} />
        </legend> : null}
        <div ref={me.$ref('body')} className={clsList('x-fieldset-body', t.className, me.bodyCls)} style={Object.assign({}, t.style, styleObject(me.bodyStyle), me.collapsed ? { display: 'none' } : null)}>
          {me.renderItemsUI()}
        </div>
      </fieldset>
    );
  }
});
