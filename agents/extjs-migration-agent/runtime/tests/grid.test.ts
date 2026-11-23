import Ext from '../src/index';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const flush = async () => { await tick(0); Ext.flushRender(); await tick(0); };
const mouse = (el: Element, type: string, opts: any = {}) => el.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, button: 0 }, opts)));

function makeStore() {
  return Ext.create('Ext.data.Store', {
    fields: ['id', 'name', { name: 'qty', type: 'number' }, { name: 'at', type: 'date', dateFormat: 'Y-m-d' }, { name: 'ok', type: 'boolean' }, 'side'],
    data: [
      { id: 1, name: 'Alpha', qty: 10, at: '2026-01-05', ok: true, side: 'Buy' },
      { id: 2, name: 'Beta', qty: 20, at: '2026-02-05', ok: false, side: 'Sell' },
      { id: 3, name: 'Gamma', qty: 30, at: '2026-03-05', ok: true, side: 'Buy' },
      { id: 4, name: 'Delta', qty: 5, at: '2026-04-05', ok: false, side: 'Sell' }
    ]
  });
}

afterEach(() => { for (const c of Ext.ComponentQuery.query('viewport, grid')) { if (!c.destroyed) { c.destroy(); } } });

describe('grid', () => {
  test('renders Ext DOM, sorts, selects, edits, summary', async () => {
    const store = makeStore();
    const events: string[] = [];
    const vp = Ext.create('Ext.container.Viewport', {
      layout: 'fit',
      items: [{
        xtype: 'grid', title: 'Deals', store, columnLines: true,
        selModel: { type: 'checkboxmodel', checkOnly: true },
        features: [{ ftype: 'summary', dock: 'bottom' }],
        plugins: [{ ptype: 'cellediting', clicksToEdit: 1 }, { ptype: 'gridfilters' }],
        columns: [
          { xtype: 'rownumberer' },
          { text: 'Name', dataIndex: 'name', flex: 1, editor: 'textfield', filter: 'string', summaryRenderer: () => '<b>Total</b>' },
          { text: 'Qty', dataIndex: 'qty', xtype: 'numbercolumn', format: '0.0', editor: { xtype: 'numberfield' }, summaryType: 'sum', summaryRenderer: (v: number) => 'Sum ' + v },
          { text: 'At', dataIndex: 'at', xtype: 'datecolumn', format: 'd-M-Y' },
          { text: 'OK', dataIndex: 'ok', xtype: 'booleancolumn', trueText: 'Yes', falseText: 'No' },
          { xtype: 'actioncolumn', width: 30, items: [{ iconCls: 'x-fa fa-eye', tooltip: 'View', handler: (v: any, ri: number, ci: number, it: any, e: any, rec: any) => events.push('view ' + rec.get('name')) }] },
          { text: 'Side', dataIndex: 'side', renderer: (v: string, meta: any) => { meta.tdCls = 'side-' + v; return v.toUpperCase(); } }
        ],
        listeners: {
          selectionchange: (sm: any, sel: any[]) => events.push('sel ' + sel.length),
          itemdblclick: (v: any, rec: any) => events.push('dbl ' + rec.get('name')),
          edit: (ed: any, ctx: any) => events.push('edit ' + ctx.field + '=' + ctx.value)
        }
      }]
    });
    await flush();
    const grid = vp.down('grid');
    const items = document.querySelectorAll('.x-grid-item-container > .x-grid-item');
    expect(items.length).toBe(4);
    const firstCells = items[0].querySelectorAll('td.x-grid-cell');
    expect(firstCells.length).toBe(8);
    expect(firstCells[1].textContent).toBe('1');
    expect(firstCells[2].textContent).toBe('Alpha');
    expect(firstCells[3].textContent).toBe('10.0');
    expect(firstCells[4].textContent).toBe('05-Jan-2026');
    expect(firstCells[5].textContent).toBe('Yes');
    expect(firstCells[7].classList.contains('side-Buy')).toBe(true);
    expect(firstCells[7].textContent).toBe('BUY');
    expect(document.querySelector('.x-grid-row-summary')!.textContent).toContain('Sum 65');
    expect(document.querySelectorAll('.x-column-header').length).toBe(8);
    expect(grid.headerCt.getGridColumns().length).toBe(8);
    // view API
    const view = grid.getView();
    expect(view.getRecord(view.getNode(2))).toBe(store.getAt(2));
    const cell = view.getCell(store.getAt(1), grid.down('gridcolumn[dataIndex=qty]'));
    expect(cell.dom.textContent).toBe('20.0');
    expect(view.getHeaderByCell(cell.dom)).toBe(grid.down('gridcolumn[dataIndex=qty]'));
    // sort by header click
    (document.querySelectorAll('.x-column-header')[3].querySelector('.x-column-header-inner') as HTMLElement).click();
    await flush();
    expect(store.getAt(0).get('name')).toBe('Delta');
    expect(document.querySelectorAll('.x-column-header')[3].className).toContain('x-column-header-sort-ASC');
    expect(document.querySelectorAll('.x-grid-item')[0].querySelectorAll('td')[2].textContent).toBe('Delta');
    // checkbox selection (checkOnly)
    mouse(document.querySelectorAll('.x-grid-item')[1].querySelector('td.x-grid-cell-row-checker')!, 'mousedown');
    await flush();
    expect(grid.getSelection().map((r: any) => r.get('name'))).toEqual(['Alpha']);
    expect(document.querySelectorAll('.x-grid-item')[1].classList.contains('x-grid-item-selected')).toBe(true);
    mouse(document.querySelectorAll('.x-grid-item')[2].querySelector('td')!.nextElementSibling!.nextElementSibling!, 'mousedown');
    expect(grid.getSelection().length).toBe(1);
    // action column
    (document.querySelectorAll('.x-grid-item')[0].querySelector('.x-action-col-icon') as HTMLElement).click();
    expect(events).toContain('view Delta');
    // cell editing
    const qtyCell = view.getCell(store.getAt(0), grid.down('gridcolumn[dataIndex=qty]')).dom;
    mouse(qtyCell, 'mousedown'); mouse(qtyCell, 'mouseup'); mouse(qtyCell, 'click');
    await flush();
    await tick(5);
    const input = document.querySelector('.x-editor input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('5');
    input.value = '7.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await flush();
    expect(store.getAt(0).get('qty')).toBe(7.5);
    expect(events).toContain('edit qty=7.5');
    expect(view.getCell(store.getAt(0), grid.down('gridcolumn[dataIndex=qty]')).dom.classList.contains('x-grid-dirty-cell')).toBe(true);
    expect(document.querySelector('.x-grid-row-summary')!.textContent).toContain('Sum 67.5');
    // filters plugin
    const fp = grid.findPlugin('gridfilters');
    grid.down('gridcolumn[dataIndex=name]').filter.value = 'ta';
    grid.down('gridcolumn[dataIndex=name]').filter.active = true;
    fp.$applyAll();
    await flush();
    expect(store.getCount()).toBe(2);
    expect(document.querySelectorAll('.x-grid-item').length).toBe(2);
    expect(grid.down('gridcolumn[dataIndex=name]').el.dom.className).toContain('x-grid-filters-filtered-column');
    fp.clearFilters();
    await flush();
    expect(store.getCount()).toBe(4);
    // dblclick
    mouse(document.querySelectorAll('.x-grid-item')[3].querySelectorAll('td')[2], 'dblclick');
    expect(events.some((e) => e.indexOf('dbl ') === 0)).toBe(true);
    // header menu
    const hd = grid.down('gridcolumn[dataIndex=name]');
    grid.headerCt.showMenuBy(hd, hd.el.dom);
    await flush();
    expect(grid.headerCt.getMenu().down('#ascItem')).toBeTruthy();
    expect(grid.headerCt.getMenu().down('#filters')).toBeTruthy();
    grid.headerCt.getMenu().hide();
    // hide a column
    grid.down('gridcolumn[dataIndex=at]').hide();
    await flush();
    expect(document.querySelectorAll('.x-grid-item')[0].querySelectorAll('td.x-grid-cell').length).toBe(7);
    // reconfigure
    grid.reconfigure(null, [{ text: 'Only', dataIndex: 'name' }]);
    await flush();
    expect(document.querySelectorAll('.x-grid-item')[0].querySelectorAll('td.x-grid-cell').length).toBe(2);
  });

  test('grouping summary and row expander', async () => {
    const store = makeStore();
    store.group('side');
    const vp = Ext.create('Ext.container.Viewport', {
      layout: 'fit',
      items: [{
        xtype: 'grid', store,
        features: [{ ftype: 'groupingsummary', id: 'grouping', groupHeaderTpl: '{name} ({rows.length})' }],
        plugins: [{ ptype: 'rowexpander', pluginId: 'expander', rowBodyTpl: new Ext.XTemplate('<p>Detail {name}</p>') }],
        columns: [{ text: 'Name', dataIndex: 'name' }, { text: 'Qty', dataIndex: 'qty', summaryType: 'sum' }, { text: 'Side', dataIndex: 'side' }]
      }]
    });
    await flush();
    const grid = vp.down('grid');
    const titles = Array.from(document.querySelectorAll('.x-grid-group-title')).map((e) => e.textContent);
    expect(titles).toEqual(['Buy (2)', 'Sell (2)']);
    expect(document.querySelectorAll('.x-grid-row-summary').length).toBe(2);
    expect(document.querySelectorAll('.x-grid-row-summary')[0].textContent).toContain('40');
    // collapse a group
    (document.querySelector('.x-grid-group-hd') as HTMLElement).click();
    await flush();
    expect(document.querySelectorAll('.x-grid-item').length).toBe(3);
    grid.getView().getFeature('grouping').expandAll();
    await flush();
    expect(document.querySelectorAll('.x-grid-item').length).toBe(4);
    // expander
    grid.getPlugin('expander').toggleRow(0, store.getAt(0));
    await flush();
    expect(document.querySelector('.x-grid-rowbody')!.textContent).toBe('Detail ' + store.getAt(0).get('name'));
  });
});
