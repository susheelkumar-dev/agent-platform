import { Ext } from '../src/core/ext';
import '../src/core/class';
import '../src/core/observable';
import '../src/core/loader';

describe('class system', () => {
  it('extends, callParent, statics, singleton, override, mixins, config', () => {
    Ext.define('T.A', { x: 1, constructor: function (cfg) { this.log = ['A']; this.callParent([cfg]); }, hello: function (n) { return 'A' + n; }, statics: { s: function () { return 'sa'; } } });
    Ext.define('T.B', { extend: 'T.A', xtype: 'tb', hello: function (n) { return 'B' + this.callParent([n]); } });
    Ext.define('T.C', { extend: 'T.B', alias: 'widget.tc', hello: function (n) { const self = this; return [1].map(function () { return 'C'; })[0] + this.callParent(arguments); } });
    const c = new (Ext.ClassManager.get('T.C'))({ y: 2 });
    expect(c.hello(5)).toBe('CBA5');
    expect(c.y).toBe(2);
    expect(c.log).toEqual(['A']);
    expect(c.isXType('tb')).toBe(true);
    expect(c.isXType('tc')).toBe(true);
    expect((Ext.global as any).T.A.s()).toBe('sa');
    Ext.define('T.Ov', { override: 'T.B', hello: function (n) { return 'O' + this.callParent(arguments); } });
    expect(c.hello(1)).toBe('COBA1');
    Ext.define('T.M', { extend: 'Ext.Mixin', mixinConfig: { id: 'mm' }, mixed: function () { return 'm' + this.y; }, hello: function () { return 'nope'; } });
    Ext.define('T.D', { extend: 'T.C', mixins: ['T.M'], constructor: function (c) { this.callParent([c]); } });
    const d = Ext.create('T.D', { y: 7 });
    expect(d.mixed()).toBe('m7');
    expect(d.hello(2)).toBe('COBA2');
    expect(d.mixins.mm.mixed).toBeTypeOf('function');
    Ext.define('T.S', { singleton: true, v: 3, get: function () { return this.v; } });
    expect((Ext.global as any).T.S.get()).toBe(3);
    Ext.define('T.Cfg', { config: { color: 'red' }, updateColor: function (n, o) { this.changes = (this.changes || 0) + 1; } });
    const k = Ext.create('T.Cfg', { color: 'blue' });
    expect(k.getColor()).toBe('blue');
    k.setColor('green');
    expect(k.color).toBe('green');
    expect(k.changes).toBe(2);
    expect(Ext.widget('tc').$className).toBe('T.C');
  });
  it('observable', () => {
    const o = new Ext.util.Observable();
    const seen = [];
    o.on('Ping', (a, b) => { seen.push(a + b); });
    o.on({ pong: function (x) { seen.push('p' + x + this.k); }, scope: { k: 'K' }, single: true });
    o.fireEvent('ping', 1, 2);
    o.fireEvent('pong', 1); o.fireEvent('pong', 2);
    expect(seen).toEqual([3, 'p1K']);
    o.on('stop', () => false);
    expect(o.fireEvent('stop')).toBe(false);
    const d = o.on('x', () => seen.push('x'), null, { destroyable: true });
    d.destroy(); o.fireEvent('x');
    expect(seen.length).toBe(2);
    const o2 = new Ext.util.Observable();
    o2.relayEvents(o, ['ping'], 'r');
    o2.on('rping', (a, b) => seen.push('r' + a + b));
    o.fireEvent('ping', 'a', 'b');
    expect(seen).toContain('rab');
  });
});

describe('Ext.Loader / Ext.require', () => {
  it('loads a registered class on first use, once', async () => {
    let runs = 0;
    Ext.Loader.register({
      'widget.lz-screen': async () => { runs++; Ext.define('LZ.Screen', { alias: 'widget.lz-screen' }); },
    });
    expect(Ext.ClassManager.getByAlias('widget.lz-screen')).toBeUndefined();
    await Promise.all([Ext.require('widget.lz-screen'), Ext.require('lz-screen')]);
    expect(runs).toBe(1);
    expect(Ext.ClassManager.getByAlias('widget.lz-screen')).toBeTruthy();
    await Ext.require('widget.lz-screen');
    expect(runs).toBe(1);
  });

  it('falls back to loading everything for an unknown name, and calls the callback', async () => {
    let all = 0;
    Ext.Loader.register({}, async () => { all++; Ext.define('LZ.Other', { alias: 'widget.lz-other' }); });
    const done: string[] = [];
    await Ext.require('LZ.Other', () => done.push('cb'));
    expect(all).toBe(1);
    expect(done).toEqual(['cb']);
    await Ext.require('widget.not-there');  // already loaded everything: resolves without loading again
    expect(all).toBe(1);
  });

  it('a failed load can be retried', async () => {
    let n = 0;
    Ext.Loader.register({ 'widget.lz-flaky': async () => { n++; if (n === 1) throw new Error('offline'); Ext.define('LZ.Flaky', { alias: 'widget.lz-flaky' }); } });
    await expect(Ext.require('widget.lz-flaky')).rejects.toThrow('offline');
    await Ext.require('widget.lz-flaky');
    expect(Ext.ClassManager.getByAlias('widget.lz-flaky')).toBeTruthy();
  });
});
