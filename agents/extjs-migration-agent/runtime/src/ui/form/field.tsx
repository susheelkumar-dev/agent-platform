/**
 * Form fields. Ext.form.field.Base carries the Labelable and Field behaviour (label, error display, value,
 * dirty / validity tracking, change events, two-way binding of 'value'); concrete fields: Text (with triggers),
 * TextArea, Number (spinner), Display, Hidden, Checkbox, Radio and File.
 *
 * Inputs are uncontrolled: the component keeps the raw string in $raw and writes it to the DOM after
 * renders, so typing never fights React's re-render (which is batched to a microtask).
 */
import * as React from 'react';
import { Ext } from '../../core/ext';
import { define } from '../../core/class';
import { clsList, styleObject, flushRender, CmpView } from '../render';
import '../component';
import '../button';

// ---------------------------------------------------------------- VTypes
const emailRe = /^(")?(?:[^."\s])(?:(?:[.])?(?:[\w\-!#$%&'*+/=?^_`{|}~]))*\1@(\w[-\w]*\.){1,5}([A-Za-z]){2,63}$/;
const urlRe = /(((^https?)|(^ftp)):\/\/((([-\w]+\.)+\w{2,3}(\/[%\-\w]+(\.\w{2,})?)*(([\w\-.?\\/+@&#;`~=%!]*)(\.\w{2,})?)*)|(localhost|LOCALHOST))\/?)/i;
Ext.form = Ext.form || {};
Ext.form.field = Ext.form.field || {};
Ext.form.field.VTypes = Ext.form.VTypes = {
  email: (v: string) => emailRe.test(v), emailText: 'This field should be an e-mail address in the format "user@example.com"', emailMask: /[\w.\-@'"!#$%&'*+/=?^_`{|}~]/i,
  url: (v: string) => urlRe.test(v), urlText: 'This field should be a URL in the format "http:/' + '/www.example.com"',
  alpha: (v: string) => /^[a-zA-Z_]+$/.test(v), alphaText: 'This field should only contain letters and _', alphaMask: /[a-z_]/i,
  alphanum: (v: string) => /^[a-zA-Z0-9_]+$/.test(v), alphanumText: 'This field should only contain letters, numbers and _', alphanumMask: /[a-z0-9_]/i
};

export function errorsHtml(errors: string[]) {
  if (!errors || !errors.length) { return ''; }
  return '<ul class="x-list-plain">' + errors.map((e) => '<li>' + e + '</li>').join('') + '</ul>';
}

function isEqualValue(a: any, b: any) {
  if (a === b) { return true; }
  if (a instanceof Date && b instanceof Date) { return a.getTime() === b.getTime(); }
  if (Ext.isArray(a) && Ext.isArray(b)) { return a.length === b.length && a.every((x: any, i: number) => isEqualValue(x, b[i])); }
  if ((a === null || a === undefined || a === '') && (b === null || b === undefined || b === '')) { return true; }
  return false;
}

// ---------------------------------------------------------------- Base (Labelable + Field)
define('Ext.form.Labelable', { extend: 'Ext.Mixin' });
define('Ext.form.field.Field', { extend: 'Ext.Mixin' });
export const FieldBase: any = define('Ext.form.field.Base', {
  extend: 'Ext.Component',
  alias: 'widget.field',
  mixins: { labelable: 'Ext.form.Labelable', field: 'Ext.form.field.Field' },
  isFormField: true,
  isFieldLabelable: true,
  baseCls: 'x-field',
  fieldCls: 'x-form-field',
  focusCls: 'x-form-focus',
  invalidCls: 'x-form-invalid',
  dirtyCls: 'x-form-dirty',
  inputType: 'text',
  labelAlign: 'left',
  labelWidth: 100,
  labelPad: 5,
  labelSeparator: ':',
  hideLabel: false,
  hideEmptyLabel: true,
  msgTarget: 'qtip',
  readOnly: false,
  submitValue: true,
  validateOnChange: true,
  validateOnBlur: true,
  preventMark: false,
  checkChangeBuffer: 0,
  defaultBindProperty: 'value',
  focusable: true,
  value: undefined,
  fieldType: 'base',
  invalidText: 'The value in this field is invalid',

  initComponent: function () {
    const me = this;
    me.callParent();
    me.$errors = [];
    me.initValue();
  },
  initValue: function () {
    const me = this;
    const v = me.value;
    me.$suspendCheck = true;
    me.setValue(v === undefined ? me.$defaultValue() : v);
    me.$suspendCheck = false;
    me.originalValue = me.lastValue = me.getValue();
  },
  $defaultValue: function () { return null; },

  // ---- value
  getName: function () { return this.name; },
  getValue: function () { return this.value; },
  setValue: function (v: any) {
    const me = this;
    me.value = v;
    me.setRawValue(me.valueToRaw(v));
    me.checkChange();
    return me;
  },
  valueToRaw: function (v: any) { return v === null || v === undefined ? '' : String(v); },
  rawToValue: function (raw: any) { return raw; },
  processRawValue: function (raw: any) { return raw; },
  getRawValue: function () { return this.$raw === undefined ? '' : this.$raw; },
  setRawValue: function (raw: any) {
    const me = this;
    raw = raw === null || raw === undefined ? '' : String(raw);
    if (me.$raw === raw) { return raw; }
    me.$raw = raw;
    if (me.inputEl && me.inputEl.dom && me.inputEl.dom.value !== raw && me.inputEl.dom.type !== 'file') { me.inputEl.dom.value = raw; }
    me.updateUI();
    return raw;
  },
  getSubmitValue: function () { const v = this.processRawValue(this.getRawValue()); return v; },
  getSubmitData: function () {
    const me = this;
    if (me.disabled || !me.submitValue || !me.name) { return null; }
    const v = me.getSubmitValue();
    if (v === null) { return null; }
    return { [me.name]: v };
  },
  getModelData: function () {
    const me = this;
    if (me.disabled || !me.name || me.isFileUpload()) { return null; }
    return { [me.name]: me.getValue() };
  },
  isFileUpload: function () { return false; },
  isEqual: function (a: any, b: any) { return isEqualValue(a, b); },
  checkChange: function () {
    const me = this;
    if (me.$suspendCheck || me.destroyed) { return; }
    const nv = me.getValue();
    const ov = me.lastValue;
    if (!me.isEqual(nv, ov)) {
      me.lastValue = nv;
      if (me.onChange) { me.onChange(nv, ov); }
      me.fireEvent('change', me, nv, ov);
      if (me.validateOnChange && me.rendered !== undefined) { me.validate(); }
      me.checkDirty();
      me.$publishBinding('value', nv);
      if (me.reference) { me.publishState('value', nv); }
      me.updateUI();
    }
  },
  isDirty: function () { const me = this; return !me.disabled && !me.isEqual(me.getValue(), me.originalValue); },
  checkDirty: function () {
    const me = this;
    const d = me.isDirty();
    if (d !== me.wasDirty) { me.wasDirty = d; me.fireEvent('dirtychange', me, d); me.updateUI(); const f = me.$form(); if (f && f.$onFieldDirty) { f.$onFieldDirty(me, d); } }
  },
  resetOriginalValue: function () { this.originalValue = this.getValue(); this.checkDirty(); },
  reset: function () {
    const me = this;
    me.beforeReset();
    me.setValue(me.originalValue);
    me.clearInvalid();
    delete me.wasValid;
    me.checkDirty();
  },
  beforeReset: Ext.emptyFn,
  $form: function () { let c = this.getRefOwner(); while (c) { if (c.isFormPanel) { return c; } c = c.getRefOwner ? c.getRefOwner() : null; } return null; },

  // ---- validation
  getErrors: function (value?: any) { void value; return []; },
  isValid: function () {
    const me = this;
    const disabled = me.disabled;
    const validate = me.forceValidation || !disabled;
    return validate ? me.validateValue(me.processRawValue(me.getRawValue())) : disabled;
  },
  validateValue: function (value: any) {
    const me = this;
    const errors = me.getErrors(value);
    const valid = errors.length === 0;
    if (!me.preventMark) { if (valid) { me.clearInvalid(); } else { me.markInvalid(errors); } }
    return valid;
  },
  validate: function () {
    const me = this;
    const valid = me.isValid();
    if (valid !== me.wasValid) {
      me.wasValid = valid;
      me.fireEvent('validitychange', me, valid);
      const f = me.$form();
      if (f && f.$onFieldValidity) { f.$onFieldValidity(me, valid); }
    }
    return valid;
  },
  markInvalid: function (errors: any) {
    const me = this;
    const list = Ext.Array.from(errors).filter((e: any) => e !== null && e !== undefined && e !== '');
    const old = me.getActiveError();
    me.$errors = list;
    me.activeError = errorsHtml(list);
    if (old !== me.activeError) { me.fireEvent('errorchange', me, me.activeError); }
    me.updateUI();
  },
  clearInvalid: function () {
    const me = this;
    if (!me.$errors || !me.$errors.length) { return; }
    me.$errors = [];
    me.activeError = '';
    me.fireEvent('errorchange', me, '');
    me.updateUI();
  },
  hasActiveError: function () { return !!(this.$errors && this.$errors.length); },
  getActiveError: function () { return this.activeError || ''; },
  getActiveErrors: function () { return (this.$errors || []).slice(); },
  setActiveError: function (msg: string) { this.markInvalid(msg); },
  setActiveErrors: function (errs: string[]) { this.markInvalid(errs); },
  unsetActiveError: function () { this.clearInvalid(); },

  // ---- config setters
  setReadOnly: function (ro: boolean) { this.readOnly = !!ro; this.updateUI(); this.fireEvent('writeablechange', this, ro); },
  getReadOnly: function () { return !!this.readOnly; },
  setFieldLabel: function (l: string) { this.fieldLabel = l; this.updateUI(); },
  getFieldLabel: function () { return this.fieldLabel; },
  setHideLabel: function (h: boolean) { this.hideLabel = h; this.updateUI(); },
  setFieldStyle: function (s: any) { this.fieldStyle = s; this.updateUI(); },
  setEmptyText: function (t: string) { this.emptyText = t; this.updateUI(); },
  setAllowBlank: function (b: boolean) { this.allowBlank = b; if (this.wasValid !== undefined || this.hasActiveError()) { this.validate(); } },
  setMinValue: function (v: any) { this.minValue = v; this.updateUI(); },
  setMaxValue: function (v: any) { this.maxValue = v; this.updateUI(); },
  getInputId: function () { return this.id + '-inputEl'; },
  onDisable: function () { this.clearInvalid(); },
  onEnable: function () { if (this.wasValid === false) { this.validate(); } },
  getFocusEl: function () { flushRender(); return this.inputEl || this.el; },
  selectText: function (start?: number, end?: number) {
    const d = this.inputEl && this.inputEl.dom;
    if (d && d.setSelectionRange) { d.focus(); d.setSelectionRange(start || 0, end === undefined ? d.value.length : end); }
  },

  // ---- input events
  $onInput: function (re: any) {
    const me = this;
    const raw = re.target.value;
    me.$raw = raw;
    me.value = me.rawToValue(me.processRawValue(raw));
    if (me.checkChangeBuffer) {
      clearTimeout(me.$ccTimer);
      me.$ccTimer = setTimeout(() => me.checkChange(), me.checkChangeBuffer);
    } else { me.checkChange(); }
    me.updateUI();
  },
  $onFocus: function (re: any) {
    const me = this;
    if (me.$hasFocusCls) { return; }
    me.$hasFocusCls = true;
    me.updateUI();
    if (me.selectOnFocus && re && re.target && re.target.select) { const t = re.target; setTimeout(() => { try { t.select(); } catch (e) { /* ignore */ } }, 0); }
    me.fireEvent('focus', me, re ? new Ext.event.Event(re.nativeEvent || re) : null);
    if (me.onFocusEnter) { me.onFocusEnter(re); }
  },
  $onBlur: function (re: any) {
    const me = this;
    const next = re && re.relatedTarget;
    if (next && me.el && me.el.dom.contains(next)) { return; }
    if (me.$keepFocus && me.$keepFocus(next)) { return; }
    me.$hasFocusCls = false;
    if (me.beforeBlur) { me.beforeBlur(re); }
    me.updateUI();
    me.fireEvent('blur', me, re ? new Ext.event.Event(re.nativeEvent || re) : null);
    if (me.validateOnBlur) { me.validate(); }
    if (me.postBlur) { me.postBlur(re); }
    if (me.onFocusLeave) { me.onFocusLeave(re); }
  },
  $onKeyDown: function (re: any) {
    const me = this;
    const e = new Ext.event.Event(re.nativeEvent);
    if (e.isSpecialKey()) { me.fireEvent('specialkey', me, e); }
    if (me.enableKeyEvents || me.hasListeners && me.hasListener && me.hasListener('keydown')) { me.fireEvent('keydown', me, e); }
    if (me.$onFieldKeyDown) { me.$onFieldKeyDown(e, re); }
  },
  $onKeyPress: function (re: any) {
    const me = this;
    const mask = me.maskRe || (me.vtype && Ext.form.field.VTypes[me.vtype + 'Mask']);
    if (mask && re.key && re.key.length === 1 && !re.ctrlKey && !re.metaKey && !mask.test(re.key)) { re.preventDefault(); return; }
    if (me.enableKeyEvents) { me.fireEvent('keypress', me, new Ext.event.Event(re.nativeEvent)); }
  },
  $onKeyUp: function (re: any) { if (this.enableKeyEvents) { this.fireEvent('keyup', this, new Ext.event.Event(re.nativeEvent)); } },

  // ---- rendering: label + body + error
  $labelVisible: function () {
    const me = this;
    if (me.hideLabel) { return false; }
    if (me.hideEmptyLabel && !me.fieldLabel) { return false; }
    return true;
  },
  getRootCls: function () {
    const me = this;
    const align = me.labelAlign === 'top' ? 'top' : (me.labelAlign === 'right' ? 'right' : 'left');
    return clsList(me.callParent(), 'x-form-item', 'x-form-item-default', 'x-form-type-' + me.fieldType, 'x-field-default',
      me.$labelVisible() ? 'x-form-item-label-' + align + '-ct' : 'x-form-item-no-label',
      me.hasActiveError() ? [me.invalidCls, 'x-form-item-invalid'] : null,
      me.readOnly ? 'x-form-readonly' : null, me.wasDirty && me.$showDirty ? me.dirtyCls : null,
      me.$hasFocusCls ? me.focusCls.replace('x-form-focus', 'x-field-focus') : null,
      me.msgTarget === 'side' ? 'x-form-item-side-msg' : null);
  },
  getRootStyle: function () {
    const st = this.callParent();
    st.display = this.hidden ? 'none' : (this.labelAlign === 'top' ? 'flex' : 'flex');
    st.flexDirection = this.labelAlign === 'top' ? 'column' : 'row';
    st.alignItems = this.labelAlign === 'top' ? 'stretch' : 'flex-start';
    return st;
  },
  $labelHtml: function () {
    const me = this;
    const sep = me.fieldLabel && me.labelSeparator && !/[:?]\s*$/.test(me.fieldLabel) ? me.labelSeparator : '';
    return (me.beforeLabelTextTpl || '') + (me.fieldLabel || '') + sep + (me.afterLabelTextTpl || '');
  },
  renderLabel: function () {
    const me = this;
    if (!me.$labelVisible()) { return null; }
    const top = me.labelAlign === 'top';
    const w = top ? undefined : (me.labelWidth || 0) + (me.labelPad || 0);
    return (
      <label key="$label" htmlFor={me.getInputId()} ref={me.$ref('labelEl')} className={clsList('x-form-item-label', 'x-form-item-label-default', 'x-unselectable', 'x-form-item-label-' + (top ? 'top' : me.labelAlign), me.labelCls, me.hasActiveError() ? 'x-form-item-label-invalid' : null)}
        style={Object.assign(top ? { display: 'block', paddingBottom: 5 } : { width: w, minWidth: w, flex: '0 0 auto', paddingRight: me.labelPad, textAlign: me.labelAlign === 'right' ? 'right' : 'left', boxSizing: 'border-box' }, styleObject(me.labelStyle))}>
        <span className="x-form-item-label-inner x-form-item-label-inner-default">
          <span className="x-form-item-label-text" dangerouslySetInnerHTML={{ __html: me.$labelHtml() }} />
        </span>
      </label>
    );
  },
  renderBody: function () { return null; },
  renderError: function () {
    const me = this;
    const t = me.msgTarget;
    if (!me.hasActiveError() || t === 'none' || t === 'qtip' || t === 'title') {
      return t === 'side' ? <div key="$err" className="x-form-error-wrap x-form-error-wrap-default x-form-error-wrap-side" style={{ width: 22, flex: '0 0 22px' }} /> : null;
    }
    if (t === 'side') {
      return <div key="$err" ref={me.$ref('errorWrapEl')} className="x-form-error-wrap x-form-error-wrap-default x-form-error-wrap-side x-form-invalid-under-default" style={{ width: 22, flex: '0 0 22px' }}>
        <div className="x-form-invalid-icon x-form-invalid-icon-default x-fa fa-exclamation-circle" role="alert" data-errorqtip={me.activeError} />
      </div>;
    }
    return <div key="$err" ref={me.$ref('errorWrapEl')} className="x-form-error-wrap x-form-error-wrap-default x-form-error-wrap-under">
      <div className="x-form-error-msg x-form-invalid-under x-form-invalid-under-default" role="alert" dangerouslySetInnerHTML={{ __html: me.activeError }} />
    </div>;
  },
  renderContent: function () {
    const me = this;
    const under = me.msgTarget === 'under' && me.hasActiveError();
    const body = (
      <div key="$body" ref={me.$ref('bodyEl')} className={clsList('x-form-item-body', 'x-form-item-body-default', 'x-form-' + me.fieldType + '-field-body', me.$bodyCls)}
        style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: under ? 'column' : 'row', alignItems: 'stretch' }}
        data-errorqtip={me.msgTarget === 'qtip' && me.hasActiveError() ? me.activeError : undefined}
        title={me.msgTarget === 'title' && me.hasActiveError() ? (me.$errors || []).join('\n') : undefined}>
        {me.renderBody()}
        {under ? me.renderError() : null}
      </div>
    );
    return [me.renderLabel(), body, under ? null : me.renderError()];
  },
  $afterMount: function (dom: any) {
    this.callParent([dom]);
    this.$syncInput();
  },
  $afterUpdate: function (dom: any) {
    this.callParent([dom]);
    this.$syncInput();
  },
  $syncInput: function () {
    const me = this;
    const d = me.inputEl && me.inputEl.dom;
    if (d && d.type !== 'file' && d.type !== 'checkbox' && d.type !== 'radio' && d.value !== me.getRawValue()) { d.value = me.getRawValue(); }
  },
  doDestroy: function () { clearTimeout(this.$ccTimer); this.callParent(); }
});

// ---------------------------------------------------------------- Text + triggers
define('Ext.form.trigger.Trigger', {
  alias: 'trigger.trigger',
  isTrigger: true,
  hidden: false,
  weight: 0,
  constructor: function (cfg: any) { Ext.apply(this, cfg); return this; },
  show: function () { this.setHidden(false); },
  hide: function () { this.setHidden(true); },
  setHidden: function (h: boolean) { this.hidden = !!h; if (this.field) { this.field.updateUI(); } },
  setVisible: function (v: boolean) { this.setHidden(!v); },
  isVisible: function () { return !this.hidden && !(this.field && this.field.hideTrigger && !this.$custom); },
  getEl: function () { const f = this.field; flushRender(); return f && f.el ? f.el.down('.x-form-trigger[data-trigger="' + this.name + '"]') : null; },
  setTooltip: function (t: string) { this.tooltip = t; if (this.field) { this.field.updateUI(); } },
  destroy: Ext.emptyFn
});

// Ext triggers expose their element as trigger.el
Object.defineProperty(Ext.ClassManager.get('Ext.form.trigger.Trigger').prototype, 'el', { configurable: true, get() { return this.getEl(); } });

export const TextField: any = define('Ext.form.field.Text', {
  extend: 'Ext.form.field.Base',
  alias: ['widget.textfield'],
  fieldType: 'text',
  allowBlank: true,
  allowOnlyWhitespace: true,
  blankText: 'This field is required',
  minLength: 0,
  maxLength: Number.MAX_VALUE,
  minLengthText: 'The minimum length for this field is {0}',
  maxLengthText: 'The maximum length for this field is {0}',
  regexText: '',
  emptyText: '',
  editable: true,
  hideTrigger: false,
  selectOnFocus: false,
  enforceMaxLength: false,
  triggerWrapCls: 'x-form-trigger-wrap',
  $defaultValue: function () { return ''; },
  initComponent: function () {
    const me = this;
    me.$initTriggers();
    me.callParent();
  },
  $defaultTriggers: function () { return {}; },
  $initTriggers: function () {
    const me = this;
    const all = Ext.apply({}, me.triggers || {}, me.$defaultTriggers());
    const TriggerCls = Ext.ClassManager.get('Ext.form.trigger.Trigger');
    const out: Record<string, any> = {};
    for (const name of Object.keys(all)) {
      const cfg = all[name];
      if (!cfg) { continue; }
      const t = cfg.isTrigger ? cfg : new TriggerCls(Ext.apply({}, cfg));
      t.name = name;
      t.field = me;
      t.$custom = !(me.$builtinTriggers && me.$builtinTriggers.indexOf(name) >= 0);
      out[name] = t;
    }
    me.triggers = out;
  },
  getTrigger: function (name: string) { return this.triggers ? this.triggers[name] : null; },
  getTriggers: function () { return this.triggers || {}; },
  setHideTrigger: function (h: boolean) { this.hideTrigger = h; this.updateUI(); },
  setEditable: function (e: boolean) { this.editable = e; this.updateUI(); },
  processRawValue: function (v: any) {
    const me = this;
    if (me.stripCharsRe && v) { v = String(v).replace(me.stripCharsRe, ''); }
    return v;
  },
  getErrors: function (value?: any) {
    const me = this;
    const errors: string[] = [];
    if (value === undefined) { value = me.processRawValue(me.getRawValue()); }
    value = value === null || value === undefined ? '' : String(value);
    if (Ext.isFunction(me.validator)) {
      const msg = me.validator.call(me, value);
      if (msg !== true) { errors.push(msg); }
    }
    const trimmed = me.allowOnlyWhitespace ? value : value.trim();
    if (trimmed.length < 1) {
      if (!me.allowBlank) { errors.push(me.blankText); }
      return errors;
    }
    if (value.length < me.minLength) { errors.push(Ext.String.format(me.minLengthText, me.minLength)); }
    if (value.length > me.maxLength) { errors.push(Ext.String.format(me.maxLengthText, me.maxLength)); }
    if (me.vtype) {
      const vt = Ext.form.field.VTypes;
      if (vt[me.vtype] && !vt[me.vtype](value, me)) { errors.push(me.vtypeText || vt[me.vtype + 'Text']); }
    }
    if (me.regex && !me.regex.test(value)) { errors.push(me.regexText || me.invalidText); }
    return errors;
  },
  $isEmptyRaw: function () { const r = this.getRawValue(); return r === '' || r === null || r === undefined; },
  $inputAttrs: function () {
    const me = this;
    return {};
  },
  renderInput: function () {
    const me = this;
    const ro = me.readOnly || me.editable === false;
    const props: any = Object.assign({
      id: me.getInputId(), ref: me.$ref('inputEl'), type: me.inputType, name: me.name, autoComplete: 'off',
      className: clsList(me.fieldCls, 'x-form-text', 'x-form-text-default', me.$isEmptyRaw() && me.emptyText ? 'x-form-empty-field x-form-empty-field-default' : null,
        me.hasActiveError() ? 'x-form-invalid-field x-form-invalid-field-default' : null, me.readOnly ? 'x-form-readonly' : null, me.editable === false ? 'x-form-text-not-editable' : null, me.$inputCls),
      style: Object.assign({ width: '100%' }, styleObject(me.fieldStyle)),
      placeholder: me.emptyText || undefined, readOnly: ro, disabled: me.disabled, defaultValue: me.getRawValue(),
      maxLength: me.enforceMaxLength && me.maxLength !== Number.MAX_VALUE ? me.maxLength : undefined,
      'aria-invalid': me.hasActiveError() ? 'true' : undefined,
      onInput: (e: any) => me.$onInput(e), onFocus: (e: any) => me.$onFocus(e), onBlur: (e: any) => me.$onBlur(e),
      onKeyDown: (e: any) => me.$onKeyDown(e), onKeyPress: (e: any) => me.$onKeyPress(e), onKeyUp: (e: any) => me.$onKeyUp(e),
      onMouseDown: me.editable === false && !me.readOnly ? (e: any) => { if (me.$onNotEditableClick) { me.$onNotEditableClick(e); } } : undefined,
      onPaste: me.$onPaste ? (e: any) => me.$onPaste(e) : undefined
    }, me.$inputAttrs());
    return <input {...props} />;
  },
  $sortedTriggers: function () {
    const list = Object.values(this.triggers || {}) as any[];
    return list.filter((t) => t.isVisible()).sort((a, b) => (a.weight || 0) - (b.weight || 0));
  },
  $onTriggerClick: function (t: any, re: any) {
    const me = this;
    re.preventDefault();
    if (me.disabled || (me.readOnly && !t.$alwaysActive)) { return; }
    const e = new Ext.event.Event(re.nativeEvent);
    if (t.handler) { Ext.callback(t.handler, t.scope || me, [me, t, e], 0, me); }
    else if (t.$onClick) { t.$onClick.call(me, e); }
  },
  renderTriggers: function () {
    const me = this;
    return me.$sortedTriggers().map((t: any) => (
      <div key={'trg-' + t.name} data-trigger={t.name} data-qtip={t.tooltip || undefined}
        className={clsList('x-form-trigger', 'x-form-trigger-default', t.cls, t.extraCls, t.$baseCls, me.readOnly ? 'x-form-trigger-disabled' : null)}
        onMouseDown={(e) => { e.preventDefault(); }} onClick={(e) => me.$onTriggerClick(t, e)} role="button" />
    ));
  },
  renderBody: function () {
    const me = this;
    return (
      <div ref={me.$ref('triggerWrap')} className={clsList(me.triggerWrapCls, me.triggerWrapCls + '-default', me.hasActiveError() ? me.triggerWrapCls + '-invalid' : null, me.$hasFocusCls ? me.triggerWrapCls + '-focus x-form-trigger-wrap-focus' : null, me.readOnly ? 'x-form-trigger-wrap-readonly' : null)}
        style={{ display: 'flex', flex: '1 1 auto', minWidth: 0, alignItems: 'stretch' }}>
        <div ref={me.$ref('inputWrap')} className={clsList('x-form-text-wrap', 'x-form-text-wrap-default', me.hasActiveError() ? 'x-form-text-wrap-invalid' : null)} style={{ flex: '1 1 auto', minWidth: 0, display: 'flex' }}>
          {me.renderInput()}
        </div>
        {me.renderTriggers()}
      </div>
    );
  }
});
define('Ext.form.field.TextArea', {
  extend: 'Ext.form.field.Text',
  alias: ['widget.textareafield', 'widget.textarea'],
  fieldType: 'textarea',
  growMin: 60,
  growMax: 1000,
  enterIsSpecial: false,
  renderInput: function () {
    const me = this;
    return <textarea id={me.getInputId()} ref={me.$ref('inputEl')} name={me.name} defaultValue={me.getRawValue()} placeholder={me.emptyText || undefined}
      className={clsList(me.fieldCls, 'x-form-textarea', 'x-form-text', 'x-form-text-default', me.$isEmptyRaw() && me.emptyText ? 'x-form-empty-field' : null, me.hasActiveError() ? 'x-form-invalid-field' : null)}
      readOnly={me.readOnly} disabled={me.disabled} maxLength={me.enforceMaxLength && me.maxLength !== Number.MAX_VALUE ? me.maxLength : undefined}
      style={Object.assign({ width: '100%', height: '100%', minHeight: me.height ? undefined : 60, resize: 'none', boxSizing: 'border-box' }, styleObject(me.fieldStyle))}
      onInput={(e: any) => me.$onInput(e)} onFocus={(e: any) => me.$onFocus(e)} onBlur={(e: any) => me.$onBlur(e)}
      onKeyDown={(e: any) => { if (e.key === 'Enter' && !me.enterIsSpecial) { if (me.enableKeyEvents) { me.fireEvent('keydown', me, new Ext.event.Event(e.nativeEvent)); } return; } me.$onKeyDown(e); }} onKeyUp={(e: any) => me.$onKeyUp(e)} />;
  },
  getRootStyle: function () { const st = this.callParent(); if (this.height !== undefined) { st.alignItems = 'stretch'; } return st; },
  renderBody: function () {
    const me = this;
    return <div ref={me.$ref('inputWrap')} className={clsList('x-form-text-wrap', 'x-form-text-wrap-default', 'x-form-trigger-wrap', 'x-form-trigger-wrap-default', me.hasActiveError() ? 'x-form-text-wrap-invalid x-form-trigger-wrap-invalid' : null)}
      style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', height: me.height ? '100%' : undefined }}>{me.renderInput()}</div>;
  }
});

// ---------------------------------------------------------------- Number
define('Ext.form.field.Number', {
  extend: 'Ext.form.field.Text',
  alias: ['widget.numberfield'],
  fieldType: 'number',
  allowDecimals: true,
  decimalSeparator: '.',
  submitLocaleSeparator: true,
  decimalPrecision: 2,
  minValue: Number.NEGATIVE_INFINITY,
  maxValue: Number.MAX_VALUE,
  step: 1,
  allowExponential: true,
  keyNavEnabled: true,
  mouseWheelEnabled: true,
  spinUpEnabled: true,
  spinDownEnabled: true,
  minText: 'The minimum value for this field is {0}',
  maxText: 'The maximum value for this field is {0}',
  nanText: '{0} is not a valid number',
  negativeText: 'The value cannot be negative',
  $builtinTriggers: ['spinner'],
  $inputCls: 'x-form-number',
  $defaultValue: function () { return null; },
  $defaultTriggers: function () {
    return { spinner: { cls: 'x-form-spinner', weight: 100, $spinner: true } };
  },
  initComponent: function () {
    const me = this;
    me.callParent();
    if (!me.allowDecimals) { me.decimalPrecision = 0; }
    let allowed = '0123456789';
    if (me.allowDecimals) { allowed += me.decimalSeparator; }
    if (me.allowExponential) { allowed += 'eE+'; }
    if (me.minValue < 0) { allowed += '-'; }
    me.maskRe = new RegExp('[' + Ext.String.escapeRegex(allowed) + ']');
  },
  parseValue: function (v: any) {
    if (v === null || v === undefined || v === '') { return null; }
    if (typeof v === 'number') { return isNaN(v) ? null : v; }
    const n = parseFloat(String(v).replace(this.decimalSeparator, '.'));
    return isNaN(n) ? null : n;
  },
  fixPrecision: function (v: any) {
    const me = this;
    if (v === null || v === undefined || isNaN(v) || !me.allowDecimals || me.decimalPrecision === -1) { return v === null || v === undefined || isNaN(v) ? v : (me.allowDecimals ? v : Math.round(v)); }
    return parseFloat(Ext.Number.toFixed(parseFloat(v), me.decimalPrecision));
  },
  rawToValue: function (raw: any) {
    const me = this;
    const v = me.fixPrecision(me.parseValue(raw));
    return v === null || v === undefined || isNaN(v) ? (raw === '' || raw === null || raw === undefined ? null : null) : v;
  },
  valueToRaw: function (v: any) {
    const me = this;
    v = me.parseValue(v);
    v = me.fixPrecision(v);
    if (v === null || v === undefined || isNaN(v)) { return ''; }
    return String(v).replace('.', me.decimalSeparator);
  },
  setValue: function (v: any) {
    const me = this;
    const n = me.parseValue(v);
    me.value = n === null ? null : me.fixPrecision(n);
    me.setRawValue(me.valueToRaw(me.value));
    me.checkChange();
    return me;
  },
  getSubmitValue: function () {
    const me = this;
    let v = me.callParent();
    if (!me.submitLocaleSeparator) { v = String(v).replace(me.decimalSeparator, '.'); }
    return v;
  },
  getErrors: function (value?: any) {
    const me = this;
    if (value === undefined) { value = me.processRawValue(me.getRawValue()); }
    const errors = me.callParent([value]);
    const raw = value === null || value === undefined ? '' : String(value);
    if (raw.length < 1) { return errors; }
    const s = raw.replace(me.decimalSeparator, '.');
    const n = Number(s);
    if (isNaN(n) || s.trim() === '') { errors.push(Ext.String.format(me.nanText, raw)); return errors; }
    const val = me.fixPrecision(n);
    if (val < me.minValue) { errors.push(Ext.String.format(me.minValue === 0 && me.negativeText ? me.negativeText : me.minText, me.minValue)); }
    if (val > me.maxValue) { errors.push(Ext.String.format(me.maxText, me.maxValue)); }
    return errors;
  },
  beforeBlur: function () {
    const me = this;
    const v = me.rawToValue(me.getRawValue());
    if (v !== null && v !== undefined) { me.setRawValue(me.valueToRaw(v)); }
  },
  spin: function (up: boolean) {
    const me = this;
    if (me.readOnly || me.disabled) { return; }
    const cur = me.getValue();
    let v = (cur === null || cur === undefined ? 0 : cur) + (up ? me.step : -me.step);
    v = Math.max(me.minValue, Math.min(me.maxValue, v));
    me.setValue(v);
    me.fireEvent('spin', me, up ? 'up' : 'down');
    me.fireEvent(up ? 'spinup' : 'spindown', me);
  },
  $onFieldKeyDown: function (e: any, re: any) {
    const me = this;
    if (!me.keyNavEnabled) { return; }
    if (re.key === 'ArrowUp') { re.preventDefault(); me.spin(true); }
    else if (re.key === 'ArrowDown') { re.preventDefault(); me.spin(false); }
  },
  $inputAttrs: function () {
    const me = this;
    return { inputMode: 'decimal', onWheel: me.mouseWheelEnabled ? (e: any) => { if (me.hasFocus()) { me.spin(e.deltaY < 0); } } : undefined };
  },
  renderTriggers: function () {
    const me = this;
    const out = [];
    for (const t of me.$sortedTriggers()) {
      if (t.$spinner) {
        out.push(<div key="trg-spinner" data-trigger="spinner" className={clsList('x-form-trigger', 'x-form-trigger-default', 'x-form-spinner', 'x-form-spinner-default')} style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="x-form-spinner-up x-form-spinner-up-default x-fa fa-caret-up" onMouseDown={(e) => e.preventDefault()} onClick={() => me.spin(true)} />
          <div className="x-form-spinner-down x-form-spinner-down-default x-fa fa-caret-down" onMouseDown={(e) => e.preventDefault()} onClick={() => me.spin(false)} />
        </div>);
      } else {
        out.push(<div key={'trg-' + t.name} data-trigger={t.name} data-qtip={t.tooltip || undefined} className={clsList('x-form-trigger', 'x-form-trigger-default', t.cls)} onMouseDown={(e) => e.preventDefault()} onClick={(e) => me.$onTriggerClick(t, e)} />);
      }
    }
    return out;
  }
});
define('Ext.form.field.Spinner', { extend: 'Ext.form.field.Number', alias: 'widget.spinnerfield' });

// ---------------------------------------------------------------- Display / Hidden
define('Ext.form.field.Display', {
  extend: 'Ext.form.field.Base',
  alias: ['widget.displayfield'],
  fieldType: 'display',
  submitValue: false,
  htmlEncode: false,
  validateOnChange: false,
  focusable: false,
  fieldCls: 'x-form-display-field',
  isValid: function () { return true; },
  validate: function () { return true; },
  isDirty: function () { return false; },
  getRawValue: function () { return this.rawValue === undefined ? '' : this.rawValue; },
  setRawValue: function (v: any) { this.rawValue = v; this.updateUI(); return v; },
  valueToRaw: function (v: any) { return v === null || v === undefined ? '' : v; },
  getDisplayValue: function () {
    const me = this;
    const v = me.getRawValue();
    let d = me.renderer ? Ext.callback(me.renderer, me.scope, [v, me], 0, me) : v;
    if (d === null || d === undefined) { d = ''; }
    return me.htmlEncode ? Ext.String.htmlEncode(String(d)) : String(d);
  },
  renderBody: function () {
    const me = this;
    return <div ref={me.$ref('inputEl')} id={me.getInputId()} className={clsList(me.fieldCls, 'x-form-display-field-default', me.fieldBodyCls)} style={styleObject(me.fieldStyle)}
      dangerouslySetInnerHTML={{ __html: me.getDisplayValue() }} />;
  }
});
define('Ext.form.field.Hidden', {
  extend: 'Ext.form.field.Base',
  alias: ['widget.hiddenfield', 'widget.hidden'],
  fieldType: 'hidden',
  hidden: true,
  hideLabel: true,
  validateOnChange: false,
  getErrors: function () { return []; },
  renderContent: function () { return null; },
  getRootStyle: function () { return { display: 'none' }; }
});

// ---------------------------------------------------------------- Checkbox / Radio
export const Checkbox: any = define('Ext.form.field.Checkbox', {
  extend: 'Ext.form.field.Base',
  alias: ['widget.checkboxfield', 'widget.checkbox'],
  fieldType: 'checkbox',
  inputType: 'checkbox',
  checked: false,
  inputValue: 'on',
  uncheckedValue: undefined,
  boxLabelAlign: 'after',
  checkedCls: 'x-form-cb-checked',
  $defaultValue: function () { return !!this.checked; },
  initValue: function () {
    const me = this;
    me.$suspendCheck = true;
    me.setValue(me.value !== undefined ? me.value : !!me.checked);
    me.$suspendCheck = false;
    me.originalValue = me.lastValue = me.getValue();
  },
  getValue: function () { return !!this.checked; },
  getRawValue: function () { return !!this.checked; },
  setRawValue: function (v: any) { this.checked = this.$isChecked(v); this.updateUI(); return this.checked; },
  $isChecked: function (v: any) { return v === true || v === 'true' || v === '1' || v === 1 || v === 'on' || (this.inputValue !== undefined && v !== null && v !== undefined && v !== false && String(v) === String(this.inputValue)); },
  setValue: function (v: any) {
    const me = this;
    if (Ext.isArray(v)) { v = v.some((x: any) => String(x) === String(me.inputValue)); }
    me.checked = me.$isChecked(v);
    me.value = me.checked;
    me.updateUI();
    me.checkChange();
    return me;
  },
  getSubmitValue: function () { const me = this; return me.checked ? me.inputValue : (me.uncheckedValue === undefined ? null : me.uncheckedValue); },
  getModelData: function () { const me = this; if (me.disabled || !me.name) { return null; } return { [me.name]: me.getValue() }; },
  getErrors: function () { return []; },
  onChange: function (nv: boolean) {
    const me = this;
    if (me.handler) { Ext.callback(me.handler, me.scope, [me, nv], 0, me); }
  },
  setBoxLabel: function (l: string) { this.boxLabel = l; this.updateUI(); },
  $toggle: function () {
    const me = this;
    if (me.readOnly || me.disabled) { return; }
    if (me.isRadio && me.checked) { return; }
    if (me.fireEvent('beforechange', me, !me.checked, me.checked) === false) { return; }
    me.setValue(!me.checked);
  },
  getRootCls: function () { return clsList(this.callParent(), this.checked ? this.checkedCls : null, this.isRadio ? 'x-form-type-radio' : 'x-form-type-checkbox'); },
  renderBody: function () {
    const me = this;
    const box = (
      <span key="box" className={clsList('x-form-cb-wrap-inner')} style={{ display: 'inline-flex', alignItems: 'center' }}>
        <input id={me.getInputId()} ref={me.$ref('inputEl')} type={me.isRadio ? 'radio' : 'checkbox'} name={me.isRadio ? me.name : undefined} checked={!!me.checked} disabled={me.disabled}
          readOnly={me.readOnly} onChange={() => me.$toggle()} onFocus={(e) => me.$onFocus(e)} onBlur={(e) => me.$onBlur(e)} onKeyDown={(e: any) => me.$onKeyDown(e)}
          className={clsList('x-form-field', me.isRadio ? 'x-form-radio' : 'x-form-checkbox', me.isRadio ? 'x-form-radio-default' : 'x-form-checkbox-default', 'x-form-cb', 'x-form-cb-input')} />
        {me.boxLabel ? <label htmlFor={me.getInputId()} ref={me.$ref('boxLabelEl')} className={clsList('x-form-cb-label', 'x-form-cb-label-default', 'x-form-cb-label-' + me.boxLabelAlign, me.boxLabelCls)}
          dangerouslySetInnerHTML={{ __html: me.boxLabel }} style={{ marginLeft: me.boxLabelAlign === 'after' ? 5 : 0, marginRight: me.boxLabelAlign === 'before' ? 5 : 0, cursor: 'pointer' }} /> : null}
      </span>
    );
    return <div className={clsList('x-form-cb-wrap', 'x-form-cb-wrap-default')} style={{ display: 'flex', alignItems: 'center', minHeight: 24, flexDirection: me.boxLabelAlign === 'before' ? 'row-reverse' : 'row' }}>{box}</div>;
  }
});

define('Ext.form.field.Radio', {
  extend: 'Ext.form.field.Checkbox',
  alias: ['widget.radiofield', 'widget.radio'],
  isRadio: true,
  fieldType: 'radio',
  inputType: 'radio',
  checkedCls: 'x-form-cb-checked',
  $isChecked: function (v: any) {
    if (v === true || v === 'true') { return true; }
    if (v === false || v === null || v === undefined || v === 'false') { return false; }
    return this.inputValue !== undefined && String(v) === String(this.inputValue);
  },
  $groupScope: function () { return this.$form() || this.up('radiogroup') || this.ownerCt; },
  getManager: function () { return null; },
  $siblings: function () {
    const me = this;
    const scope = me.$groupScope();
    if (!scope || !me.name) { return []; }
    return scope.query('radiofield[name=' + JSON.stringify(me.name).slice(1, -1) + ']').filter((r: any) => r !== me && r.isRadio);
  },
  setValue: function (v: any) {
    const me = this;
    if (v !== true && v !== false && v !== null && v !== undefined && typeof v !== 'boolean') {
      // setValue('x') on any radio of the group checks the radio whose inputValue is 'x'
      const all = [me].concat(me.$siblings());
      for (const r of all) { r.$setChecked(String(r.inputValue) === String(v)); }
      return me;
    }
    me.$setChecked(me.$isChecked(v));
    return me;
  },
  $setChecked: function (c: boolean) {
    const me = this;
    me.checked = c;
    me.value = c;
    me.updateUI();
    if (c && !me.$suspendCheck) { for (const r of me.$siblings()) { if (r.checked) { r.$setChecked(false); } } }
    me.checkChange();
  },
  resetOriginalValue: function () {
    const me = this;
    for (const r of [me].concat(me.$siblings())) { r.originalValue = r.getValue(); r.checkDirty(); }
  },
  getGroupValue: function () { const me = this; const all = [me].concat(me.$siblings()); const c = all.find((r: any) => r.checked); return c ? c.inputValue : null; },
  getSubmitValue: function () { return this.checked ? this.inputValue : null; },
  getModelData: function () {
    const me = this;
    if (me.disabled || !me.name || !me.checked) { return null; }
    return { [me.name]: me.inputValue };
  }
});

// ---------------------------------------------------------------- File
define('Ext.form.field.File', {
  extend: 'Ext.form.field.Text',
  alias: ['widget.filefield', 'widget.fileuploadfield'],
  fieldType: 'file',
  buttonText: 'Browse...',
  buttonOnly: false,
  buttonMargin: 3,
  editable: false,
  submitValue: false,
  multiple: false,
  isFileUpload: function () { return true; },
  initComponent: function () {
    const me = this;
    me.callParent();
    const bc = Ext.apply({ text: me.buttonText }, me.buttonConfig);
    me.button = Ext.widget('button', Ext.apply(bc, { ownerCmp: me, cls: clsList('x-form-file-btn', bc.cls), handler: () => me.$openPicker(), disabled: me.disabled }));
  },
  getRefItems: function () { return this.button ? [this.button] : []; },
  $openPicker: function () {
    const me = this;
    if (me.disabled || me.readOnly) { return; }
    flushRender();
    if (me.fileInputEl) { me.fileInputEl.dom.click(); }
  },
  $onFileChange: function (re: any) {
    const me = this;
    const v = (re.target as HTMLInputElement).value || '';
    me.value = v;
    me.setRawValue(v.replace(/^.*[\\/]/, ''));
    me.checkChange();
    // choosing the same file again must fire 'change' again (Ext recreates the input after reset)
  },
  getValue: function () { return this.value || ''; },
  setValue: function (v: any) {
    const me = this;
    if (!v) {
      me.value = '';
      if (me.fileInputEl && me.fileInputEl.dom) { me.fileInputEl.dom.value = ''; }
      me.setRawValue('');
    }
    return me;
  },
  reset: function () {
    const me = this;
    me.value = '';
    me.lastValue = '';
    if (me.fileInputEl && me.fileInputEl.dom) { me.fileInputEl.dom.value = ''; }
    me.setRawValue('');
    me.clearInvalid();
  },
  extractFileInput: function () { flushRender(); return this.fileInputEl ? this.fileInputEl.dom : null; },
  onDisable: function () { this.callParent(); if (this.button) { this.button.disable(); } },
  onEnable: function () { this.callParent(); if (this.button) { this.button.enable(); } },
  getErrors: function (value?: any) {
    const me = this;
    if (value === undefined) { value = me.getValue(); }
    return me.callParent([value]);
  },
  renderBody: function () {
    const me = this;
    const btn = me.button;
    return (
      <div ref={me.$ref('triggerWrap')} className={clsList('x-form-trigger-wrap', 'x-form-trigger-wrap-default', me.hasActiveError() ? 'x-form-trigger-wrap-invalid' : null, me.buttonOnly ? 'x-form-file-wrap-button-only' : null)}
        style={{ display: 'flex', flex: '1 1 auto', minWidth: 0, alignItems: 'stretch', border: me.buttonOnly ? 'none' : undefined }}>
        {me.buttonOnly ? null : <div className="x-form-text-wrap x-form-text-wrap-default" style={{ flex: '1 1 auto', minWidth: 0, display: 'flex' }}>{me.renderInput()}</div>}
        <div className="x-form-file-button-wrap" style={{ position: 'relative', marginLeft: me.buttonOnly ? 0 : me.buttonMargin, display: 'flex' }}>
          {btn ? <CmpView cmp={btn} /> : null}
          <input ref={me.$ref('fileInputEl')} type="file" name={me.name} multiple={me.multiple} accept={me.accept} tabIndex={-1} className="x-form-file-input"
            style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} disabled={me.disabled}
            onChange={(e) => me.$onFileChange(e)} />
        </div>
      </div>
    );
  },
  doDestroy: function () { if (this.button) { this.button.destroy(); } this.callParent(); }
});
