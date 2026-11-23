/**
 * SVG charts for the Ext JS chart API: Ext.draw.Container, Ext.chart.CartesianChart ('cartesian' / 'chart')
 * with numeric, category and time axes, bar (grouped or stacked, several yFields), line (smooth, marker,
 * fill) and area series, a DOM legend, tooltips (renderer(tooltip, record, item)), the itemhighlight
 * interaction and crosszoom (drag a box to zoom, double-click to reset).
 */
import * as React from 'react';
import { Ext } from '../core/ext';
import { define } from '../core/class';
import { clsList } from './render';
import './component';

const DEFAULT_COLORS = ['#115fa6', '#94ae0a', '#a61120', '#ff8809', '#ffd13e', '#a61187', '#24ad9a', '#7c7474', '#a66111'];

define('Ext.draw.Container', {
  extend: 'Ext.Component',
  alias: 'widget.draw',
  baseCls: 'x-draw-container',
  config: { downloadServerUrl: null, engine: 'Ext.draw.engine.Svg' },
  getImage: function () { const svg = this.el ? this.el.dom.querySelector('svg') : null; return { data: svg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.outerHTML) : '', type: 'svg' }; },
  download: function () {
    const img = this.getImage();
    if (!img.data) { return; }
    const a = document.createElement('a');
    a.href = img.data; a.download = (this.downloadFileName || 'chart') + '.svg';
    document.body.appendChild(a); a.click(); a.remove();
  }
});

function niceStep(range: number, ticks: number) {
  if (range <= 0) { return 1; }
  const raw = range / Math.max(1, ticks);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  const n = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10;
  return n * mag;
}
function fmtNum(v: number) {
  const a = Math.abs(v);
  if (a >= 1e9) { return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B'; }
  if (a >= 1e6) { return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M'; }
  if (a >= 1e4) { return (v / 1e3).toFixed(0) + 'K'; }
  return String(Math.round(v * 1000) / 1000);
}
function boxPad(p: any) {
  if (p === undefined || p === null) { return [10, 10, 10, 10]; }
  if (typeof p === 'number') { return [p, p, p, p]; }
  if (typeof p === 'object') { return [p.top || 0, p.right || 0, p.bottom || 0, p.left || 0]; }
  const a = String(p).trim().split(/\s+/).map(Number);
  if (a.length === 1) { return [a[0], a[0], a[0], a[0]]; }
  if (a.length === 2) { return [a[0], a[1], a[0], a[1]]; }
  if (a.length === 3) { return [a[0], a[1], a[2], a[1]]; }
  return a;
}
function smoothPath(pts: number[][]) {
  if (pts.length < 3) { return pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(' '); }
  let d = 'M' + pts[0][0] + ',' + pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ' C' + c1x + ',' + c1y + ' ' + c2x + ',' + c2y + ' ' + p2[0] + ',' + p2[1];
  }
  return d;
}

// ---------------------------------------------------------------- axes / series configs as light classes
define('Ext.chart.axis.Axis', {
  mixins: { observable: 'Ext.mixin.Observable' },
  alias: 'axis.axis',
  isAxis: true,
  grid: false,
  constructor: function (config?: any) { this.mixins.observable.constructor.call(this, config); return this; },
  getFields: function () { return Ext.Array.from(this.fields); },
  setMinimum: function (v: number) { this.minimum = v; if (this.chart) { this.chart.redraw(); } },
  setMaximum: function (v: number) { this.maximum = v; if (this.chart) { this.chart.redraw(); } },
  setTitle: function (t: any) { this.title = t; if (this.chart) { this.chart.redraw(); } },
  getTitle: function () { return this.title; },
  getChart: function () { return this.chart; },
  getPosition: function () { return this.position; },
  setFields: function (f: any) { this.fields = f; if (this.chart) { this.chart.redraw(); } },
  getRange: function () { return this.$range || null; }
});
define('Ext.chart.axis.Numeric', { extend: 'Ext.chart.axis.Axis', alias: 'axis.numeric', type: 'numeric' });
define('Ext.chart.axis.Category', { extend: 'Ext.chart.axis.Axis', alias: 'axis.category', type: 'category' });
define('Ext.chart.axis.Time', { extend: 'Ext.chart.axis.Numeric', alias: 'axis.time', type: 'time', dateFormat: 'M d' });

define('Ext.chart.series.Series', {
  mixins: { observable: 'Ext.mixin.Observable' },
  alias: 'series.series',
  isSeries: true,
  showInLegend: true,
  hidden: false,
  constructor: function (config?: any) { this.mixins.observable.constructor.call(this, config); this.$hidden = new Set(); return this; },
  getYFields: function () { return Ext.Array.from(this.yField); },
  getXField: function () { return this.xField; },
  getTitle: function () { return this.title; },
  setTitle: function (t: any) { this.title = t; if (this.chart) { this.chart.redraw(); } },
  getChart: function () { return this.chart; },
  setHiddenByIndex: function (i: number, h: boolean) { const f = this.getYFields()[i]; if (h) { this.$hidden.add(f); } else { this.$hidden.delete(f); } if (this.chart) { this.chart.redraw(); } },
  getHiddenByIndex: function (i: number) { return this.$hidden.has(this.getYFields()[i]); },
  setStyle: function (s: any) { this.style = Ext.apply({}, s, this.style); if (this.chart) { this.chart.redraw(); } }
});
define('Ext.chart.series.Cartesian', { extend: 'Ext.chart.series.Series', alias: 'series.cartesian' });
define('Ext.chart.series.Bar', { extend: 'Ext.chart.series.Cartesian', alias: 'series.bar', type: 'bar', stacked: true });
define('Ext.chart.series.Line', { extend: 'Ext.chart.series.Cartesian', alias: 'series.line', type: 'line' });
define('Ext.chart.series.Area', { extend: 'Ext.chart.series.Cartesian', alias: 'series.area', type: 'area', stacked: true });
define('Ext.chart.series.Scatter', { extend: 'Ext.chart.series.Cartesian', alias: 'series.scatter', type: 'scatter' });
define('Ext.chart.legend.Legend', { alias: ['legend.legend', 'legend.dom'] });
define('Ext.chart.legend.SpriteLegend', { alias: 'legend.sprite' });
define('Ext.chart.interactions.ItemHighlight', { alias: 'interaction.itemhighlight' });
define('Ext.chart.interactions.CrossZoom', { alias: 'interaction.crosszoom' });
define('Ext.chart.interactions.PanZoom', { alias: 'interaction.panzoom' });

// ---------------------------------------------------------------- Cartesian chart
export const CartesianChart: any = define('Ext.chart.CartesianChart', {
  extend: 'Ext.draw.Container',
  alias: ['widget.cartesian', 'widget.chart'],
  alternateClassName: ['Ext.chart.Chart', 'Ext.chart.AbstractChart'],
  isChart: true,
  baseCls: 'x-chart',
  insetPadding: 10,
  animation: false,
  flipXY: false,
  defaultBindProperty: 'store',
  initComponent: function () {
    const me = this;
    me.callParent();
    me.$size = { w: 0, h: 0 };
    me.$hl = null;
    me.$tip = null;
    me.$zoom = null;
    me.colors = me.colors || DEFAULT_COLORS;
    me.axes = Ext.Array.from(me.axes).map((a: any) => {
      if (a && a.isAxis) { a.chart = me; return a; }
      const cls = Ext.ClassManager.getByAlias('axis.' + (a.type || 'numeric')) || Ext.ClassManager.get('Ext.chart.axis.Numeric');
      const inst = new cls(a); inst.chart = me; return inst;
    });
    me.series = Ext.Array.from(me.series).map((s: any) => {
      if (s && s.isSeries) { s.chart = me; return s; }
      const cls = Ext.ClassManager.getByAlias('series.' + (s.type || 'line')) || Ext.ClassManager.get('Ext.chart.series.Line');
      const inst = new cls(s); inst.chart = me; return inst;
    });
    me.interactions = Ext.Array.from(me.interactions).map((i: any) => (typeof i === 'string' ? { type: i } : i));
    me.bindStore(me.store);
  },
  bindStore: function (store: any) {
    const me = this;
    if (me.$storeL) { me.$storeL.destroy(); }
    if (store && !store.isStore) { store = Ext.data.StoreManager.lookup(store) || Ext.create('Ext.data.Store', store); }
    me.store = store || Ext.create('Ext.data.Store', { fields: [], data: [] });
    me.$storeL = me.mon(me.store, { datachanged: me.redraw, refresh: me.redraw, update: me.redraw, load: me.redraw, add: me.redraw, remove: me.redraw, filterchange: me.redraw, scope: me, destroyable: true });
    me.$zoom = null;
    me.redraw();
  },
  setStore: function (s: any) { this.bindStore(s); this.fireEvent('storechange', this, this.store); return this; },
  getStore: function () { return this.store; },
  getAxes: function () { return this.axes; },
  getAxis: function (x: any) { const me = this; if (typeof x === 'number') { return me.axes[x]; } return me.axes.find((a: any) => a.id === x || a.position === x || a.reference === x) || null; },
  getSeries: function () { return this.series; },
  setColors: function (c: string[]) { this.colors = c; this.redraw(); },
  getColors: function () { return this.colors; },
  redraw: function () { this.updateUI(); this.fireEvent('redraw', this); },
  performLayout: function () { this.redraw(); },
  $afterMount: function (dom: any) {
    const me = this;
    me.callParent([dom]);
    const measure = () => {
      const plot = dom.querySelector('.x-chart-plot-host') || dom;
      const w = plot.clientWidth, h = plot.clientHeight;
      if (w !== me.$size.w || h !== me.$size.h) { me.$size = { w, h }; me.updateUI(); }
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') { me.$cro = new ResizeObserver(measure); me.$cro.observe(dom); }
  },
  $beforeUnmount: function () { if (this.$cro) { this.$cro.disconnect(); this.$cro = null; } this.callParent(arguments); },
  $color: function (i: number) { return this.colors[i % this.colors.length]; },

  // ---- layout model
  $model: function () {
    const me = this;
    const W = me.$size.w || 400, H = me.$size.h || 250;
    const [pt, pr, pb, pl] = boxPad(me.insetPadding);
    const recs = me.store.getRange();
    const catAxis = me.axes.find((a: any) => a.type === 'category');
    const numAxis = me.axes.find((a: any) => a.type === 'numeric' || a.type === 'time');
    const xField = (me.series[0] && me.series[0].xField) || (catAxis && catAxis.getFields()[0]);
    let cats: any[] = recs.map((r: any) => r.get(xField));
    let first = 0, last = cats.length - 1;
    if (me.$zoom && me.$zoom.x) { first = Math.max(0, me.$zoom.x[0]); last = Math.min(cats.length - 1, me.$zoom.x[1]); }
    const vis = recs.slice(first, last + 1);
    cats = cats.slice(first, last + 1);
    // numeric range
    let min = Infinity, max = -Infinity;
    for (const s of me.series) {
      const ys = s.getYFields().filter((f: string) => !s.$hidden.has(f));
      if (s.type === 'bar' || s.type === 'area') {
        if (s.stacked !== false) {
          for (const r of vis) { let pos = 0, neg = 0; for (const f of ys) { const v = Number(r.get(f)) || 0; if (v >= 0) { pos += v; } else { neg += v; } } max = Math.max(max, pos); min = Math.min(min, neg); }
        } else { for (const r of vis) { for (const f of ys) { const v = Number(r.get(f)) || 0; max = Math.max(max, v); min = Math.min(min, v); } } }
        min = Math.min(min, 0);
      } else {
        for (const r of vis) { for (const f of ys) { const v = r.get(f); if (v === null || v === undefined || v === '') { continue; } max = Math.max(max, Number(v)); min = Math.min(min, Number(v)); } }
      }
    }
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (numAxis && numAxis.minimum !== undefined) { min = numAxis.minimum; }
    if (numAxis && numAxis.maximum !== undefined) { max = numAxis.maximum; }
    if (me.$zoom && me.$zoom.y) { min = me.$zoom.y[0]; max = me.$zoom.y[1]; }
    if (max === min) { max = min + 1; }
    const plotH0 = H - pt - pb;
    const ticks = Math.max(2, Math.min(10, Math.floor(plotH0 / 40)));
    const step = niceStep(max - min, ticks);
    const nmin = numAxis && numAxis.minimum !== undefined ? min : Math.floor(min / step) * step;
    const nmax = numAxis && numAxis.maximum !== undefined ? max : Math.ceil(max / step) * step;
    if (numAxis) { numAxis.$range = [nmin, nmax]; }
    const tickVals: number[] = [];
    for (let v = nmin; v <= nmax + step / 1e6; v += step) { tickVals.push(Math.round(v * 1e9) / 1e9); }
    // margins for labels / titles
    const numTitle = numAxis && numAxis.title ? (typeof numAxis.title === 'string' ? numAxis.title : numAxis.title.text) : null;
    const catTitle = catAxis && catAxis.title ? (typeof catAxis.title === 'string' ? catAxis.title : catAxis.title.text) : null;
    const rot = catAxis && catAxis.label && catAxis.label.rotate ? Number(catAxis.label.rotate.degrees || 0) : 0;
    const labelW = Math.max(...tickVals.map((v) => me.$numLabel(numAxis, v).length)) * 7 + 8;
    const left = pl + labelW + (numTitle ? 18 : 0);
    const maxCat = cats.reduce((m: number, c: any) => Math.max(m, String(me.$catLabel(catAxis, c)).length), 0);
    const bottom = pb + (rot ? Math.min(80, Math.abs(Math.sin(rot * Math.PI / 180)) * maxCat * 6.5 + 14) : 20) + (catTitle ? 18 : 0);
    const plot = { x: left, y: pt, w: Math.max(10, W - left - pr), h: Math.max(10, H - pt - bottom) };
    const yOf = (v: number) => plot.y + plot.h - ((v - nmin) / (nmax - nmin)) * plot.h;
    const band = cats.length ? plot.w / cats.length : plot.w;
    const xOf = (i: number) => plot.x + band * i + band / 2;
    return { W, H, plot, cats, vis, first, tickVals, yOf, xOf, band, nmin, nmax, numAxis, catAxis, numTitle, catTitle, rot };
  },
  $numLabel: function (axis: any, v: number) {
    if (axis && axis.renderer) { try { return String(axis.renderer.call(axis, axis, v, { value: v })); } catch (e) { /* fallthrough */ } }
    if (axis && axis.label && axis.label.renderer) { try { return String(axis.label.renderer(v)); } catch (e) { /* ignore */ } }
    return fmtNum(v);
  },
  $catLabel: function (axis: any, v: any) {
    if (axis && axis.renderer) { try { return String(axis.renderer.call(axis, axis, v, { value: v })); } catch (e) { /* ignore */ } }
    if (v instanceof Date) { return Ext.Date.format(v, (axis && axis.dateFormat) || 'M d'); }
    return v === null || v === undefined ? '' : String(v);
  },

  // ---- interactions
  $hasInteraction: function (t: string) { return this.interactions.some((i: any) => i.type === t); },
  $showTip: function (e: any, series: any, record: any, field: string, index: number) {
    const me = this;
    const cfg = series.tooltip;
    me.$hl = { series, record, field };
    if (cfg) {
      const tip: any = { html: '', setHtml(h: string) { this.html = h; }, setTitle(t: string) { this.title = t; } };
      const item = { series, record, field, index, category: 'items' };
      if (cfg.renderer) { try { cfg.renderer.call(cfg.scope || series, tip, record, item); } catch (x) { tip.html = ''; } }
      else { tip.html = String(record.get(field)); }
      const host = me.el ? me.el.dom.getBoundingClientRect() : { left: 0, top: 0 };
      me.$tip = { html: tip.html, x: e.clientX - host.left + 14, y: e.clientY - host.top + 14 };
    }
    me.fireEvent('itemhighlight', me, { series, record, field }, null);
    me.updateUI();
  },
  $hideTip: function () { if (this.$tip || this.$hl) { this.$tip = null; this.$hl = null; this.updateUI(); } },
  $onPlotMouseDown: function (re: any, m: any) {
    const me = this;
    if (!me.$hasInteraction('crosszoom') || re.button !== 0) { return; }
    const svg = re.currentTarget.ownerSVGElement || re.currentTarget;
    const b = svg.getBoundingClientRect();
    const sx = re.clientX - b.left, sy = re.clientY - b.top;
    me.$drag = { sx, sy, ex: sx, ey: sy };
    const move = (e: MouseEvent) => { me.$drag.ex = e.clientX - b.left; me.$drag.ey = e.clientY - b.top; me.updateUI(); };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      const d = me.$drag;
      me.$drag = null;
      if (Math.abs(d.ex - d.sx) > 8 && Math.abs(d.ey - d.sy) > 8) {
        const p = m.plot;
        const i0 = Math.max(0, Math.floor((Math.min(d.sx, d.ex) - p.x) / m.band)), i1 = Math.min(m.cats.length - 1, Math.floor((Math.max(d.sx, d.ex) - p.x) / m.band));
        const v = (y: number) => m.nmin + (p.y + p.h - y) / p.h * (m.nmax - m.nmin);
        me.$zoom = { x: [m.first + i0, m.first + i1], y: [v(Math.max(d.sy, d.ey)), v(Math.min(d.sy, d.ey))] };
        me.fireEvent('zoom', me);
      }
      me.updateUI();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  },
  undoZoom: function () { this.$zoom = null; this.updateUI(); },

  // ---- rendering
  $renderSeries: function (m: any) {
    const me = this;
    const out: any[] = [];
    let colorIdx = 0;
    const hlOn = me.$hasInteraction('itemhighlight');
    for (const s of me.series) {
      if (s.hidden) { colorIdx += s.getYFields().length; continue; }
      const ys = s.getYFields();
      const st = s.style || {};
      if (s.type === 'bar') {
        const visibleYs = ys.filter((f: string) => !s.$hidden.has(f));
        const stacked = s.stacked !== false;
        const gap = Math.min(st.minGapWidth !== undefined ? st.minGapWidth : 10, m.band * 0.6);
        const barW = Math.max(1, m.band - gap);
        m.vis.forEach((r: any, i: number) => {
          let pos = 0, neg = 0;
          visibleYs.forEach((f: string, k: number) => {
            const v = Number(r.get(f)) || 0;
            const ci = colorIdx + ys.indexOf(f);
            let y0, y1, x, w;
            if (stacked) {
              const base = v >= 0 ? pos : neg;
              y0 = m.yOf(base); y1 = m.yOf(base + v);
              if (v >= 0) { pos += v; } else { neg += v; }
              x = m.xOf(i) - barW / 2; w = barW;
            } else {
              w = barW / visibleYs.length; x = m.xOf(i) - barW / 2 + w * k;
              y0 = m.yOf(Math.max(m.nmin, 0)); y1 = m.yOf(v);
            }
            const hl = hlOn && me.$hl && me.$hl.record === r && me.$hl.field === f;
            const fill = hl && s.highlight && s.highlight.fillStyle ? s.highlight.fillStyle : (st.fillStyle || me.$color(ci));
            out.push(<rect key={'b' + s.$uidx + i + f} x={x} y={Math.min(y0, y1)} width={Math.max(0, w)} height={Math.abs(y1 - y0)} fill={fill} stroke={st.strokeStyle || 'none'}
              className={clsList('x-chart-bar', hl ? 'x-chart-highlight' : null)} opacity={st.opacity}
              onMouseMove={(e) => me.$showTip(e, s, r, f, m.first + i)} onMouseLeave={() => me.$hideTip()}
              onClick={(e) => me.fireEvent('itemclick', me, { series: s, record: r, field: f, index: m.first + i }, new Ext.event.Event(e.nativeEvent))} />);
          });
        });
        colorIdx += ys.length;
      } else {
        ys.forEach((f: string) => {
          const ci = colorIdx++;
          if (s.$hidden.has(f)) { return; }
          const color = st.strokeStyle || me.$color(ci);
          const pts: number[][] = [];
          const idx: number[] = [];
          m.vis.forEach((r: any, i: number) => { const v = r.get(f); if (v === null || v === undefined || v === '') { return; } pts.push([m.xOf(i), m.yOf(Number(v))]); idx.push(i); });
          if (!pts.length) { return; }
          const d = s.smooth ? smoothPath(pts) : pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(' ');
          if (s.fill || s.type === 'area') {
            const base = m.yOf(Math.max(m.nmin, Math.min(0, m.nmax)));
            const area = d + ' L' + pts[pts.length - 1][0] + ',' + base + ' L' + pts[0][0] + ',' + base + ' Z';
            out.push(<path key={'a' + f} d={area} fill={st.fillStyle || color} fillOpacity={st.fillOpacity !== undefined ? st.fillOpacity : 0.3} stroke="none" className="x-chart-area" />);
          }
          if (s.type !== 'scatter') { out.push(<path key={'l' + f} d={d} fill="none" stroke={color} strokeWidth={st.lineWidth || 2} className="x-chart-line" />); }
          const marker = s.marker || s.type === 'scatter';
          const radius = marker && marker.radius ? marker.radius : 3;
          pts.forEach((p, k) => {
            const r = m.vis[idx[k]];
            const hl = me.$hl && me.$hl.record === r && me.$hl.field === f;
            out.push(<circle key={'m' + f + k} cx={p[0]} cy={p[1]} r={hl ? radius + 2 : (marker ? radius : Math.max(6, m.band / 2))} fill={marker || hl ? (hl ? color : '#fff') : 'transparent'}
              stroke={marker || hl ? color : 'none'} strokeWidth={marker ? 1.5 : 0} className="x-chart-marker"
              onMouseMove={(e) => me.$showTip(e, s, r, f, m.first + idx[k])} onMouseLeave={() => me.$hideTip()}
              onClick={(e) => me.fireEvent('itemclick', me, { series: s, record: r, field: f, index: m.first + idx[k] }, new Ext.event.Event(e.nativeEvent))} />);
          });
        });
      }
    }
    return out;
  },
  $renderAxes: function (m: any) {
    const me = this;
    const p = m.plot;
    const out: any[] = [];
    const numAxis = m.numAxis;
    // grid + numeric labels
    m.tickVals.forEach((v: number, i: number) => {
      const y = m.yOf(v);
      if (numAxis && numAxis.grid) { out.push(<line key={'g' + i} x1={p.x} x2={p.x + p.w} y1={y} y2={y} stroke="#e5e7eb" strokeWidth={1} className="x-chart-grid" />); }
      out.push(<text key={'t' + i} x={p.x - 6} y={y + 4} textAnchor="end" fontSize={11} fill="#555" className="x-chart-axis-label">{me.$numLabel(numAxis, v)}</text>);
    });
    out.push(<line key="ax-y" x1={p.x} x2={p.x} y1={p.y} y2={p.y + p.h} stroke="#bbb" />);
    out.push(<line key="ax-x" x1={p.x} x2={p.x + p.w} y1={p.y + p.h} y2={p.y + p.h} stroke="#bbb" />);
    // categories (thin out when crowded)
    const every = Math.max(1, Math.ceil(m.cats.length / Math.max(1, Math.floor(p.w / (m.rot ? 16 : 60)))));
    m.cats.forEach((c: any, i: number) => {
      if (i % every) { return; }
      const x = m.xOf(i), y = p.y + p.h + 14;
      const label = me.$catLabel(m.catAxis, c);
      out.push(m.rot
        ? <text key={'c' + i} x={x} y={y} fontSize={11} fill="#555" textAnchor={m.rot < 0 ? 'end' : 'start'} transform={'rotate(' + m.rot + ' ' + x + ' ' + y + ')'} className="x-chart-axis-label">{label}</text>
        : <text key={'c' + i} x={x} y={y} fontSize={11} fill="#555" textAnchor="middle" className="x-chart-axis-label">{label}</text>);
    });
    if (m.numTitle) {
      const fs = (numAxis.title && numAxis.title.fontSize) || 12;
      out.push(<text key="nt" x={12} y={p.y + p.h / 2} fontSize={fs} fill="#333" textAnchor="middle" transform={'rotate(-90 12 ' + (p.y + p.h / 2) + ')'} className="x-chart-axis-title">{m.numTitle}</text>);
    }
    if (m.catTitle) { out.push(<text key="ct" x={p.x + p.w / 2} y={m.H - 4} fontSize={12} fill="#333" textAnchor="middle" className="x-chart-axis-title">{m.catTitle}</text>); }
    return out;
  },
  $legendItems: function () {
    const me = this;
    const items: any[] = [];
    let ci = 0;
    for (const s of me.series) {
      const ys = s.getYFields();
      const titles = Ext.Array.from(s.title);
      ys.forEach((f: string, k: number) => {
        if (s.showInLegend !== false) { items.push({ series: s, index: k, text: titles[k] || f, color: me.$color(ci), hidden: s.$hidden.has(f) }); }
        ci++;
      });
    }
    return items;
  },
  renderContent: function () {
    const me = this;
    const m = me.$model();
    const legend = me.legend;
    const dock = legend ? (legend.docked || 'bottom') : null;
    const legendEl = legend ? (
      <div key="lg" className={clsList('x-legend', 'x-legend-dom', 'x-legend-' + dock)} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, padding: 6, flexDirection: dock === 'left' || dock === 'right' ? 'column' : 'row' }}>
        {me.$legendItems().map((it: any, i: number) => (
          <div key={i} className={clsList('x-legend-item', it.hidden ? 'x-legend-inactive' : null)} role="button" style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', opacity: it.hidden ? 0.45 : 1 }}
            onClick={() => it.series.setHiddenByIndex(it.index, !it.hidden)}>
            <span className="x-legend-item-marker" style={{ width: 10, height: 10, borderRadius: 5, background: it.color, display: 'inline-block' }} />
            <span className="x-legend-item-text">{it.text}</span>
          </div>
        ))}
      </div>
    ) : null;
    const drag = me.$drag;
    const svg = (
      <div key="plot" className="x-chart-plot-host" style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, minWidth: 0 }}
        onDoubleClick={() => { if (me.$zoom) { me.undoZoom(); } }}>
        <svg width={m.W} height={m.H} style={{ position: 'absolute', left: 0, top: 0, display: 'block' }} className="x-surface">
          {me.$renderAxes(m)}
          <rect x={m.plot.x} y={m.plot.y} width={m.plot.w} height={m.plot.h} fill="transparent" onMouseDown={(e) => me.$onPlotMouseDown(e, m)} className="x-chart-plot-bg" />
          {me.$renderSeries(m)}
          {drag ? <rect x={Math.min(drag.sx, drag.ex)} y={Math.min(drag.sy, drag.ey)} width={Math.abs(drag.ex - drag.sx)} height={Math.abs(drag.ey - drag.sy)} fill="rgba(15,118,110,0.12)" stroke="#0f766e" strokeDasharray="4 3" /> : null}
        </svg>
        {me.$tip ? <div className="x-tip x-tip-default x-chart-tooltip" style={{ position: 'absolute', left: me.$tip.x, top: me.$tip.y, pointerEvents: 'none', zIndex: 5, whiteSpace: 'nowrap' }}>
          <div className="x-tip-body x-tip-body-default" dangerouslySetInnerHTML={{ __html: me.$tip.html }} /></div> : null}
        {me.$zoom ? <div className="x-chart-zoom-reset" role="button" style={{ position: 'absolute', right: 6, top: 4, fontSize: 11, cursor: 'pointer', background: 'rgba(255,255,255,0.85)', padding: '1px 6px', borderRadius: 3 }}
          onClick={() => me.undoZoom()}>Reset zoom</div> : null}
      </div>
    );
    const vertical = dock === 'left' || dock === 'right';
    return (
      <div className="x-chart-inner" style={{ display: 'flex', flexDirection: vertical ? 'row' : 'column', width: '100%', height: '100%' }}>
        {dock === 'top' || dock === 'left' ? legendEl : null}
        {svg}
        {dock === 'bottom' || dock === 'right' ? legendEl : null}
      </div>
    );
  },
  getRootStyle: function () { const st = this.callParent(); st.position = 'relative'; st.overflow = 'hidden'; if (st.display !== 'none') { st.display = 'flex'; } return st; },
  doDestroy: function () { if (this.$storeL) { this.$storeL.destroy(); } if (this.$cro) { this.$cro.disconnect(); } this.callParent(); }
});
define('Ext.chart.PolarChart', { extend: 'Ext.chart.CartesianChart', alias: 'widget.polar' });
