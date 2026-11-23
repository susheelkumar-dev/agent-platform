import Ext from '../src/index';
const flush = async () => { await new Promise((r) => setTimeout(r, 0)); Ext.flushRender(); };
test('cartesian bar and line charts render SVG with legend and tooltip', async () => {
  const c = Ext.create('Ext.container.Viewport', { layout: 'fit', items: [{
    xtype: 'cartesian', reference: 'ch', colors: ['#0f766e', '#f59e0b'], insetPadding: '24 24 8 8',
    store: { fields: ['product', 'buy', 'sell'], data: [{ product: 'DAM', buy: 10, sell: 4 }, { product: 'RTM', buy: 6, sell: 9 }] },
    legend: { type: 'dom', docked: 'bottom' }, interactions: ['itemhighlight'],
    axes: [{ type: 'numeric', position: 'left', fields: ['buy', 'sell'], minimum: 0, grid: true, title: { text: 'MW' } }, { type: 'category', position: 'bottom', fields: 'product' }],
    series: [{ type: 'bar', xField: 'product', yField: ['buy', 'sell'], title: ['Buy', 'Sell'], stacked: true,
      tooltip: { trackMouse: true, renderer: (t: any, r: any, item: any) => t.setHtml(r.get('product') + ' ' + item.field + ' ' + r.get(item.field)) } }]
  }] });
  await flush();
  const chart = c.down('cartesian');
  expect(document.querySelectorAll('rect.x-chart-bar').length).toBe(4);
  expect(Array.from(document.querySelectorAll('.x-legend-item-text')).map((e) => e.textContent)).toEqual(['Buy', 'Sell']);
  const bar = document.querySelector('rect.x-chart-bar')!;
  bar.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }));
  await flush();
  expect(document.querySelector('.x-chart-tooltip')!.textContent).toBe('DAM buy 10');
  chart.getStore().loadData([{ product: 'X', buy: 1, sell: 2 }]);
  await flush();
  expect(document.querySelectorAll('rect.x-chart-bar').length).toBe(2);
  (document.querySelectorAll('.x-legend-item')[1] as HTMLElement).click();
  await flush();
  expect(document.querySelectorAll('rect.x-chart-bar').length).toBe(1);
  const line = Ext.create('Ext.chart.CartesianChart', { renderTo: document.body, width: 300, height: 200,
    axes: [{ type: 'numeric', position: 'left', fields: ['value'] }, { type: 'category', position: 'bottom', fields: ['label'], label: { rotate: { degrees: -45 } } }],
    series: [{ type: 'line', xField: 'label', yField: 'value', smooth: true, marker: { radius: 3 }, fill: true }] });
  line.setStore(Ext.create('Ext.data.Store', { fields: ['label', 'value'], data: [{ label: '00:00', value: 1 }, { label: '01:00', value: 3 }, { label: '02:00', value: 2 }] }));
  await flush();
  expect(document.querySelectorAll('path.x-chart-line').length).toBe(1);
  expect(document.querySelectorAll('circle.x-chart-marker').length).toBe(3);
  c.destroy(); line.destroy();
});
