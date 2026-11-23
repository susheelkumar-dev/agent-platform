import type { ColumnConfig } from './types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const numCache = new Map<number, Intl.NumberFormat>();

/** Ext numbercolumn '0,000.00' equivalent */
export function fmtNumber(v: unknown, decimals = 2): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  let f = numCache.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    numCache.set(decimals, f);
  }
  return f.format(v);
}

/**
 * Ext.Date.format subset for ISO 'yyyy-mm-dd' values.
 * d=05 j=5 D=Thu l=Thursday m=03 n=3 M=Mar F=March Y=2026 y=26; '\\' escapes.
 */
export function fmtDate(v: unknown, format = 'd-M-Y'): string {
  if (typeof v !== 'string' || v.length < 10) return '';
  const [y, m, d] = v.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  const date = new Date(y, m - 1, d);
  const p2 = (n: number) => String(n).padStart(2, '0');
  let out = '';
  for (let i = 0; i < format.length; i++) {
    const c = format[i];
    if (c === '\\') { out += format[++i] ?? ''; continue; }
    switch (c) {
      case 'd': out += p2(d); break;
      case 'j': out += d; break;
      case 'D': out += DAYS[date.getDay()].slice(0, 3); break;
      case 'l': out += DAYS[date.getDay()]; break;
      case 'm': out += p2(m); break;
      case 'n': out += m; break;
      case 'M': out += MONTHS[m - 1].slice(0, 3); break;
      case 'F': out += MONTHS[m - 1]; break;
      case 'Y': out += y; break;
      case 'y': out += String(y).slice(2); break;
      default: out += c;
    }
  }
  return out;
}

/** Plain-text display value for a column (used by detail rows, group headers, export of tpl columns). */
export function displayValue<T>(col: ColumnConfig<T>, record: T): string {
  if (col.tpl) return col.tpl(record);
  const v = col.dataIndex ? (record as Record<string, unknown>)[col.dataIndex] : undefined;
  if (v === null || v === undefined || v === '') return '';
  switch (col.type) {
    case 'number': return fmtNumber(v, col.decimals ?? 2);
    case 'date': return fmtDate(v, col.format);
    case 'boolean': return v ? 'Yes' : 'No';
    default: return String(v);
  }
}

export function fmtSummary<T>(col: ColumnConfig<T>, value: unknown): string {
  if (typeof value !== 'number') return '';
  if (col.summaryRenderer) return col.summaryRenderer(value);
  if (col.summary === 'count') return String(value);
  const s = fmtNumber(value, col.decimals ?? 2);
  return col.summary === 'average' ? `avg ${s}` : s;
}
