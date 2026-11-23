import Ext from '../src/index';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const flush = async () => { await tick(0); Ext.flushRender(); await tick(0); };

afterEach(() => {
  for (const c of Ext.ComponentQuery.query('viewport, window')) { c.destroy(); }
});

describe('components render with Ext DOM structure', () => {
  test('viewport, border layout, tab panel, toolbar, buttons', async () => {
    const clicks: string[] = [];
    const vp = Ext.create('Ext.container.Viewport', {
      layout: 'border',
      items: [
        { region: 'north', xtype: 'toolbar', items: [{ text: 'One', itemId: 'one', handler: () => clicks.push('one') }, '->', { xtype: 'tbtext', html: 'hi' }] },
        { region: 'west', title: 'Nav', width: 200, split: true, collapsible: true, html: 'nav' },
        { region: 'center', xtype: 'tabpanel', reference: 'tabs', items: [{ title: 'A', itemId: 'a', html: 'aaa' }, { title: 'B', itemId: 'b', html: 'bbb', closable: true }] }
      ]
    });
    await flush();
    expect(document.querySelector('.x-viewport')).toBeTruthy();
    expect(document.querySelectorAll('.x-tab').length).toBe(2);
    expect(document.querySelector('.x-tab-active .x-tab-inner')!.textContent).toBe('A');
    const tabs = vp.down('tabpanel');
    expect(tabs.items.getAt(0).$header).toBeFalsy();
    const changes: string[] = [];
    tabs.on('tabchange', (tp: any, n: any) => changes.push(n.itemId));
    (document.querySelectorAll('.x-tab')[1] as HTMLElement).click();
    await flush();
    expect(tabs.getActiveTab().itemId).toBe('b');
    expect(changes).toEqual(['b']);
    expect(document.querySelector('.x-tab-active .x-tab-inner')!.textContent).toBe('B');
    (document.querySelector('.x-tab-close-btn') as HTMLElement).click();
    await flush();
    expect(tabs.items.getCount()).toBe(1);
    expect(tabs.getActiveTab().itemId).toBe('a');
    vp.down('#one').el.dom.click();
    expect(clicks).toEqual(['one']);
    expect(vp.down('#one').el.dom.querySelector('.x-btn-inner')!.textContent).toBe('One');
    const west = vp.down('panel[region=west]');
    west.collapse();
    await flush();
    expect(document.querySelector('.x-region-collapsed-placeholder')).toBeTruthy();
  });

  test('form fields: values, validation, records, dirty tracking', async () => {
    const M = Ext.define(null, { extend: 'Ext.data.Model', fields: ['name', { name: 'qty', type: 'int' }, 'side', { name: 'start', type: 'date', dateFormat: 'Y-m-d' }, 'cp', { name: 'ok', type: 'boolean' }] });
    const store = Ext.create('Ext.data.Store', { fields: ['id', 'name'], data: [{ id: 1, name: 'Acme' }, { id: 2, name: 'Globex' }, { id: 3, name: 'Initech' }] });
    const win = Ext.create('Ext.window.Window', {
      title: 'Edit', width: 400, modal: true,
      items: [{
        xtype: 'form', reference: 'f', trackResetOnLoad: true, fieldDefaults: { labelWidth: 80, msgTarget: 'side' },
        items: [
          { xtype: 'textfield', name: 'name', fieldLabel: 'Name', allowBlank: false },
          { xtype: 'numberfield', name: 'qty', fieldLabel: 'Qty', minValue: 1 },
          { xtype: 'radiogroup', fieldLabel: 'Side', items: [{ boxLabel: 'Buy', name: 'side', inputValue: 'Buy' }, { boxLabel: 'Sell', name: 'side', inputValue: 'Sell' }] },
          { xtype: 'datefield', name: 'start', fieldLabel: 'Start', format: 'd-M-Y', submitFormat: 'Y-m-d' },
          { xtype: 'combobox', name: 'cp', fieldLabel: 'CP', store, queryMode: 'local', displayField: 'name', valueField: 'id', forceSelection: true, anyMatch: true },
          { xtype: 'checkbox', name: 'ok', boxLabel: 'OK' }
        ]
      }]
    });
    win.show();
    await flush();
    expect(document.querySelector('.x-window .x-window-header, .x-window .x-panel-header')).toBeTruthy();
    expect(document.querySelector('.x-modal-mask')).toBeTruthy();
    const form = win.down('form').getForm();
    expect(form.isValid()).toBe(false);
    await flush();
    const nameField = form.findField('name');
    expect(nameField.getActiveError()).toContain('<li>This field is required</li>');
    expect(nameField.el.dom.querySelector('.x-form-invalid-icon')!.getAttribute('data-errorqtip')).toContain('required');
    const rec = new M({ name: 'Deal', qty: 5, side: 'Sell', start: '2026-03-01', cp: 2, ok: true });
    form.loadRecord(rec);
    await flush();
    expect(form.isValid()).toBe(true);
    expect(form.getFields().items.filter((f: any) => f.isDirty()).map((f: any) => f.name + '=' + JSON.stringify(f.getValue()) + '/' + JSON.stringify(f.originalValue))).toEqual([]);
    expect((nameField.inputEl.dom as HTMLInputElement).value).toBe('Deal');
    expect(form.findField('cp').getRawValue()).toBe('Globex');
    expect(form.findField('start').getRawValue()).toBe('01-Mar-2026');
    expect(form.getValues()).toEqual({ name: 'Deal', qty: '5', side: 'Sell', start: '2026-03-01', cp: 2, ok: 'on' });
    const fv = form.getFieldValues();
    expect(fv.side).toBe('Sell');
    expect(fv.start instanceof Date).toBe(true);
    // typing into the text field
    const input = nameField.inputEl.dom as HTMLInputElement;
    const changes: any[] = [];
    nameField.on('change', (f: any, n: any, o: any) => changes.push([n, o]));
    input.value = 'Deal 2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changes).toEqual([['Deal 2', 'Deal']]);
    expect(form.isDirty()).toBe(true);
    form.updateRecord(rec);
    expect(rec.get('name')).toBe('Deal 2');
    // radio switch through the group value
    form.findField('side').setValue('Buy');
    expect(form.getFieldValues().side).toBe('Buy');
    // combo local query
    const cp = form.findField('cp');
    cp.doQuery('ni');
    await flush();
    expect(cp.getStore().getCount()).toBe(1);
    expect(document.querySelectorAll('.x-boundlist-item').length).toBe(1);
    (document.querySelector('.x-boundlist-item') as HTMLElement).click();
    await flush();
    expect(cp.getValue()).toBe(3);
    expect(cp.getStore().getCount()).toBe(3);
    // number validation
    const qty = form.findField('qty');
    qty.setRawValue('0');
    expect(qty.isValid()).toBe(false);
    expect(qty.getActiveErrors()[0]).toContain('minimum');
    win.close();
    expect(win.destroyed).toBe(true);
  });

  test('message box, toast, menus', async () => {
    let answer = '';
    Ext.Msg.confirm('Delete?', 'Really?', (btn: string) => { answer = btn; });
    await flush();
    expect(Ext.Msg.isVisible()).toBe(true);
    expect(Ext.Msg.getTitle()).toBe('Delete?');
    expect(Ext.Msg.down('button[itemId=ok]').hidden).toBe(true);
    Ext.Msg.down('button[itemId=yes]').el.dom.click();
    expect(answer).toBe('yes');
    expect(Ext.Msg.isVisible()).toBe(false);
    let text = '';
    Ext.Msg.prompt('Name', 'Your name', (btn: string, t: string) => { text = btn + ':' + t; });
    await flush();
    Ext.Msg.down('textfield').setValue('ok');
    Ext.Msg.down('button[itemId=ok]').el.dom.click();
    expect(text).toBe('ok:ok');

    Ext.toast({ html: '<b>Saved</b>', align: 'tr', autoCloseDelay: 50 });
    await flush();
    const t = Ext.ComponentQuery.query('toast');
    expect(t.length).toBe(1);
    expect(t[0].el.dom.innerText || t[0].el.dom.textContent).toContain('Saved');
    await tick(120);
    expect(Ext.ComponentQuery.query('toast').length).toBe(0);

    const picked: string[] = [];
    const btn = Ext.create('Ext.button.Button', { text: 'Menu', renderTo: document.body, menu: [{ text: 'Alpha', handler: () => picked.push('a') }, '-', { xtype: 'menucheckitem', text: 'Check', checked: false, checkHandler: (i: any, c: boolean) => picked.push('c' + c) }] });
    await flush();
    btn.el.dom.click();
    await flush();
    expect(btn.getMenu().isVisible()).toBe(true);
    (document.querySelectorAll('.x-menu-item')[1] as HTMLElement).click();
    expect(picked).toEqual(['cfalse'.replace('false', 'true')]);
    expect(btn.getMenu().isVisible()).toBe(true);
    (document.querySelector('.x-menu-item') as HTMLElement).click();
    expect(picked).toEqual(['ctrue', 'a']);
    expect(btn.getMenu().isVisible()).toBe(false);
    btn.destroy();
  });

  test('view controller, view model binding, references, routes', async () => {
    Ext.define('T.MainController', {
      extend: 'Ext.app.ViewController', alias: 'controller.tmain',
      routes: { 'item/:id': 'onItem' },
      listen: { global: { 'tglobal': 'onGlobal' } },
      init: function () { this.inited = true; },
      onItem: function (id: string) { this.lookup('lbl').setHtml('item ' + id); },
      onGlobal: function (v: any) { this.getViewModel().set('title', v); },
      onClick: function () { this.getViewModel().set('count', this.getViewModel().get('count') + 1); }
    });
    const vp = Ext.create('Ext.container.Viewport', {
      controller: 'tmain', viewModel: { data: { title: 'Start', count: 0 }, formulas: { double: (get: any) => get('count') * 2 } },
      items: [
        { xtype: 'panel', bind: { title: '{title}' }, items: [
          { xtype: 'component', reference: 'lbl', html: '-' },
          { xtype: 'button', text: 'inc', reference: 'inc', handler: 'onClick' },
          { xtype: 'tbtext', reference: 'dbl', bind: { html: 'Double: {double}' } },
          { xtype: 'textfield', reference: 'tf', publishes: 'value', bind: '{title}' }
        ] }
      ]
    });
    await flush();
    const ctl = vp.getController();
    expect(ctl.inited).toBe(true);
    Ext.GlobalEvents.fireEvent('tglobal', 'Hello');
    await flush();
    expect(vp.down('panel').getTitle()).toBe('Hello');
    expect(ctl.lookup('tf').getValue()).toBe('Hello');
    ctl.lookup('inc').el.dom.click();
    ctl.lookup('inc').el.dom.click();
    await flush();
    expect(ctl.lookup('dbl').el.dom.textContent).toBe('Double: 4');
    const tf = ctl.lookup('tf');
    tf.inputEl.dom.value = 'Typed';
    tf.inputEl.dom.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(vp.getViewModel().get('title')).toBe('Typed');
    expect(vp.down('panel').getTitle()).toBe('Typed');
    ctl.redirectTo('item/42');
    await tick(50);
    expect(ctl.lookup('lbl').el.dom.textContent).toBe('item 42');
  });
});
