/**
 * Ext.Date: format/parse with Ext's (PHP-style) format codes, arithmetic and calendar helpers.
 * Parsing follows Ext: missing date parts default to today, missing time parts to 0; strict mode rejects
 * rolled-over dates; 'c' accepts ISO 8601 with optional time, fraction and offset.
 */
import { Ext } from '../core/ext';

const pad = (n: number, size = 2) => { let s = String(Math.abs(Math.trunc(n))); while (s.length < size) { s = '0' + s; } return (n < 0 ? '-' : '') + s; };

const D: any = {};
D.MILLI = 'ms'; D.SECOND = 's'; D.MINUTE = 'mi'; D.HOUR = 'h'; D.DAY = 'd'; D.MONTH = 'mo'; D.YEAR = 'y'; D.WEEK = 'w';
D.defaultFormat = 'm/d/Y';
D.defaultTimeFormat = 'h:i A';
D.firstDayOfWeek = 0;
D.weekendDays = [0, 6];
D.useStrict = false;
D.monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
D.dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
D.monthNumbers = {};
D.monthNames.forEach((m, i) => { D.monthNumbers[m.substring(0, 3)] = i; D.monthNumbers[m.substring(0, 3).toLowerCase()] = i; });
D.getShortMonthName = (m: number) => D.monthNames[m].substring(0, 3);
D.getShortDayName = (d: number) => D.dayNames[d].substring(0, 3);
D.getMonthNumber = (name: string) => D.monthNumbers[String(name).substring(0, 1).toUpperCase() + String(name).substring(1, 3).toLowerCase()];
D.now = () => Date.now();
D.isLeapYear = (d: Date) => { const y = d.getFullYear(); return !!((y & 3) === 0 && (y % 100 || (y % 400 === 0 && y))); };
D.getDaysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
D.getFirstDateOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
D.getLastDateOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), D.getDaysInMonth(d));
D.getFirstDayOfMonth = (d: Date) => D.getFirstDateOfMonth(d).getDay();
D.getLastDayOfMonth = (d: Date) => D.getLastDateOfMonth(d).getDay();
D.getDayOfYear = (d: Date) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 864e5);
D.getWeekOfYear = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 864e5 + 1) / 7);
};
D.getISOYear = (d: Date) => { const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 4 - (d.getDay() || 7)); return t.getFullYear(); };
D.getSuffix = (d: Date) => {
  const n = d.getDate();
  if (n >= 11 && n <= 13) { return 'th'; }
  return ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
};
D.getGMTOffset = (d: Date, colon?: boolean) => {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return sign + pad(Math.floor(a / 60)) + (colon ? ':' : '') + pad(a % 60);
};
D.getTimezone = (d: Date) => {
  const m = /\(([^)]+)\)/.exec(d.toString());
  if (m) { return m[1].replace(/[^A-Z]/g, '') || 'GMT'; }
  return 'GMT';
};
D.clone = (d: Date) => new Date(d.getTime());
D.isEqual = (a: Date, b: Date) => (a && b ? a.getTime() === b.getTime() : !(a || b));
D.isValid = (y: number, m: number, d: number, h = 0, i = 0, s = 0, ms = 0) => {
  if (h < 0 || h > 23 || i < 0 || i > 59 || s < 0 || s > 59 || ms < 0 || ms > 999) { return false; }
  const dt = new Date(y < 100 ? 2000 : y, m - 1, d, h, i, s, ms);
  if (y < 100) { dt.setFullYear(y); }
  return y === dt.getFullYear() && m === dt.getMonth() + 1 && d === dt.getDate();
};
D.clearTime = (d: Date, clone?: boolean) => {
  if (!d) { return d; }
  const t = clone ? D.clone(d) : d;
  t.setHours(0, 0, 0, 0);
  return t;
};
D.between = (d: Date, start: Date, end: Date) => { const t = d.getTime(); return start.getTime() <= t && t <= end.getTime(); };
D.add = (date: Date, interval: string, value: number) => {
  const d = D.clone(date);
  if (!interval || value === 0) { return d; }
  const v = Number(value);
  switch (String(interval).toLowerCase()) {
    case D.MILLI: d.setTime(d.getTime() + v); break;
    case D.SECOND: d.setTime(d.getTime() + v * 1000); break;
    case D.MINUTE: d.setTime(d.getTime() + v * 60000); break;
    case D.HOUR: d.setTime(d.getTime() + v * 3600000); break;
    case D.DAY: d.setDate(d.getDate() + v); break;
    case D.WEEK: d.setDate(d.getDate() + v * 7); break;
    case D.MONTH: {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + v);
      d.setDate(Math.min(day, D.getDaysInMonth(d)));
      break;
    }
    case D.YEAR: {
      const day = d.getDate();
      d.setDate(1);
      d.setFullYear(d.getFullYear() + v);
      d.setDate(Math.min(day, D.getDaysInMonth(d)));
      break;
    }
    default: break;
  }
  return d;
};
D.subtract = (date: Date, interval: string, value: number) => D.add(date, interval, -value);
D.getElapsed = (a: Date, b?: Date) => Math.abs(a.getTime() - (b || new Date()).getTime());
D.diff = (min: Date, max: Date, unit: string) => {
  const ms = max.getTime() - min.getTime();
  switch (unit) {
    case D.MILLI: return ms;
    case D.SECOND: return Math.floor(ms / 1000);
    case D.MINUTE: return Math.floor(ms / 60000);
    case D.HOUR: return Math.floor(ms / 3600000);
    case D.DAY: return Math.floor(ms / 864e5);
    case D.WEEK: return Math.floor(ms / 864e5 / 7);
    case D.MONTH: return (max.getFullYear() - min.getFullYear()) * 12 + max.getMonth() - min.getMonth();
    case D.YEAR: return max.getFullYear() - min.getFullYear();
    default: return ms;
  }
};
D.toString = (d: Date) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
D.isWeekend = (d: Date) => D.weekendDays.indexOf(d.getDay()) >= 0;

// ---------------------------------------------------------------- format
const formatCodes: Record<string, (d: Date) => string> = {
  d: (d) => pad(d.getDate()),
  D: (d) => D.getShortDayName(d.getDay()),
  j: (d) => String(d.getDate()),
  l: (d) => D.dayNames[d.getDay()],
  N: (d) => String(d.getDay() || 7),
  S: (d) => D.getSuffix(d),
  w: (d) => String(d.getDay()),
  z: (d) => String(D.getDayOfYear(d)),
  W: (d) => pad(D.getWeekOfYear(d)),
  F: (d) => D.monthNames[d.getMonth()],
  m: (d) => pad(d.getMonth() + 1),
  M: (d) => D.getShortMonthName(d.getMonth()),
  n: (d) => String(d.getMonth() + 1),
  t: (d) => String(D.getDaysInMonth(d)),
  L: (d) => (D.isLeapYear(d) ? '1' : '0'),
  o: (d) => String(D.getISOYear(d)),
  Y: (d) => pad(d.getFullYear(), 4),
  y: (d) => String(d.getFullYear()).substring(2, 4),
  a: (d) => (d.getHours() < 12 ? 'am' : 'pm'),
  A: (d) => (d.getHours() < 12 ? 'AM' : 'PM'),
  g: (d) => String(d.getHours() % 12 ? d.getHours() % 12 : 12),
  G: (d) => String(d.getHours()),
  h: (d) => pad(d.getHours() % 12 ? d.getHours() % 12 : 12),
  H: (d) => pad(d.getHours()),
  i: (d) => pad(d.getMinutes()),
  s: (d) => pad(d.getSeconds()),
  u: (d) => pad(d.getMilliseconds(), 3),
  O: (d) => D.getGMTOffset(d),
  P: (d) => D.getGMTOffset(d, true),
  T: (d) => D.getTimezone(d),
  Z: (d) => String(d.getTimezoneOffset() * -60),
  c: (d) => D.format(d, 'Y-m-d\\TH:i:sP'),
  C: (d) => D.format(d, 'Y-m-d\\TH:i:s.uP'),
  U: (d) => String(Math.round(d.getTime() / 1000))
};
D.formatCodes = formatCodes;
D.formatFunctions = {
  MS: (d: Date) => '\\/Date(' + d.getTime() + ')\\/',
  time: (d: Date) => String(d.getTime()),
  timestamp: (d: Date) => String(Math.floor(d.getTime() / 1000))
};
D.format = (date: Date, format?: string) => {
  if (!Ext.isDate(date) || isNaN(date.getTime())) { return ''; }
  format = format || D.defaultFormat;
  if (D.formatFunctions[format]) { return D.formatFunctions[format].call(date, date); }
  let out = '';
  for (let i = 0; i < format.length; i++) {
    const ch = format.charAt(i);
    if (ch === '\\') { i++; out += format.charAt(i); continue; }
    const f = formatCodes[ch];
    out += f ? f(date) : ch;
  }
  return out;
};
D.dateFormat = D.format;

// ---------------------------------------------------------------- parse
interface Part { re: string; set?: (v: string, o: any) => void; }
const monthRe = '(' + D.monthNames.map((m) => m.substring(0, 3)).join('|') + ')';
const parseCodes: Record<string, Part> = {
  d: { re: '(3[01]|[12]\\d|0?[1-9])', set: (v, o) => { o.d = Number(v); } },
  j: { re: '(3[01]|[12]\\d|0?[1-9])', set: (v, o) => { o.d = Number(v); } },
  D: { re: '(?:' + D.dayNames.map((x) => x.substring(0, 3)).join('|') + ')' },
  l: { re: '(?:' + D.dayNames.join('|') + ')' },
  N: { re: '(?:[1-7])' },
  S: { re: '(?:st|nd|rd|th)' },
  w: { re: '(?:[0-6])' },
  z: { re: '(\\d{1,3})', set: (v, o) => { o.z = Number(v); } },
  W: { re: '(?:\\d{2})' },
  F: { re: '(' + D.monthNames.join('|') + ')', set: (v, o) => { o.m = D.getMonthNumber(v); } },
  M: { re: monthRe, set: (v, o) => { o.m = D.getMonthNumber(v); } },
  m: { re: '(1[0-2]|0?[1-9])', set: (v, o) => { o.m = Number(v) - 1; } },
  n: { re: '(1[0-2]|0?[1-9])', set: (v, o) => { o.m = Number(v) - 1; } },
  t: { re: '(?:\\d{2})' },
  L: { re: '(?:1|0)' },
  o: { re: '(\\d{4})', set: (v, o) => { o.y = Number(v); } },
  Y: { re: '(\\d{4})', set: (v, o) => { o.y = Number(v); } },
  y: { re: '(\\d{1,2})', set: (v, o) => { const n = Number(v); o.y = n > 50 ? 1900 + n : 2000 + n; } },
  a: { re: '(am|pm|AM|PM)', set: (v, o) => { o.ampm = v.toLowerCase(); } },
  A: { re: '(AM|PM|am|pm)', set: (v, o) => { o.ampm = v.toLowerCase(); } },
  g: { re: '(1[0-2]|0?[1-9])', set: (v, o) => { o.h = Number(v); } },
  G: { re: '(2[0-3]|1\\d|0?\\d)', set: (v, o) => { o.h = Number(v); } },
  h: { re: '(1[0-2]|0[1-9])', set: (v, o) => { o.h = Number(v); } },
  H: { re: '(2[0-3]|[0-1]\\d)', set: (v, o) => { o.h = Number(v); } },
  i: { re: '([0-5]\\d)', set: (v, o) => { o.i = Number(v); } },
  s: { re: '([0-5]\\d)', set: (v, o) => { o.s = Number(v); } },
  u: { re: '(\\d+)', set: (v, o) => { o.ms = Number((v + '00').substring(0, 3)); } },
  O: { re: '([+-]\\d{4})', set: (v, o) => { o.tz = v; } },
  P: { re: '([+-]\\d{2}:\\d{2})', set: (v, o) => { o.tz = v; } },
  T: { re: '(?:[A-Z]{1,5})' },
  Z: { re: '([+-]?\\d{1,5})', set: (v, o) => { o.tzSeconds = Number(v); } },
  U: { re: '(-?\\d+)', set: (v, o) => { o.unix = Number(v); } }
};
const ISO_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;
const compiled: Record<string, { re: RegExp; sets: Part['set'][] }> = {};

function compile(format: string) {
  if (compiled[format]) { return compiled[format]; }
  let re = '';
  const sets: Part['set'][] = [];
  for (let i = 0; i < format.length; i++) {
    const ch = format.charAt(i);
    if (ch === '\\') { i++; re += Ext.String.escapeRegex(format.charAt(i)); continue; }
    const p = parseCodes[ch];
    if (p) {
      re += p.re;
      if (p.set) { sets.push(p.set); }
    } else {
      re += Ext.String.escapeRegex(ch);
    }
  }
  return (compiled[format] = { re: new RegExp('^' + re + '$'), sets });
}

function buildDate(o: any, strict: boolean) {
  if (o.unix !== undefined) { return new Date(o.unix * 1000); }
  // Ext: date parts missing from the format default to today, time parts to zero
  const today = new Date();
  const y = o.y !== undefined ? o.y : today.getFullYear();
  let m = o.m !== undefined ? o.m : today.getMonth();
  let d = o.d !== undefined ? o.d : today.getDate();
  let h = o.h || 0;
  if (o.ampm) { if (o.ampm === 'pm' && h < 12) { h += 12; } if (o.ampm === 'am' && h === 12) { h = 0; } }
  const i = o.i || 0, s = o.s || 0, ms = o.ms || 0;
  if (o.z !== undefined) { m = 0; d = o.z + 1; }
  if (strict && !D.isValid(y, m + 1, d, h, i, s, ms)) { return null; }
  let dt: Date;
  if (o.tz !== undefined || o.tzSeconds !== undefined) {
    let offMin = 0;
    if (o.tz !== undefined) {
      if (o.tz === 'Z') { offMin = 0; } else {
        const t = o.tz.replace(':', '');
        offMin = (t.charAt(0) === '-' ? -1 : 1) * (Number(t.substr(1, 2)) * 60 + Number(t.substr(3, 2)));
      }
    } else {
      offMin = o.tzSeconds / 60;
    }
    dt = new Date(Date.UTC(y, m, d, h, i, s, ms) - offMin * 60000);
  } else {
    dt = new Date(y, m, d, h, i, s, ms);
    if (y < 100) { dt.setFullYear(y); }
  }
  return dt;
}

D.parse = (input: any, format?: string, strict?: boolean) => {
  if (input === null || input === undefined || input === '') { return null; }
  if (Ext.isDate(input)) { return input; }
  const str = String(input).trim();
  strict = strict === undefined ? D.useStrict : strict;
  if (!format) {
    const t = Date.parse(str);
    return isNaN(t) ? null : new Date(t);
  }
  if (format === 'c' || format === 'C') {
    const m = ISO_RE.exec(str);
    if (!m) { return null; }
    const o: any = { y: Number(m[1]), m: m[2] ? Number(m[2]) - 1 : 0, d: m[3] ? Number(m[3]) : 1 };
    if (m[4]) { o.h = Number(m[4]); o.i = Number(m[5]); }
    if (m[6]) { o.s = Number(m[6]); }
    if (m[7]) { o.ms = Number((m[7] + '00').substring(0, 3)); }
    if (m[8]) { o.tz = m[8]; }
    return buildDate(o, !!strict);
  }
  if (format === 'MS') { const m = /\/Date\((-?\d+)/.exec(str); return m ? new Date(Number(m[1])) : null; }
  if (format === 'time') { return new Date(Number(str)); }
  if (format === 'timestamp') { return new Date(Number(str) * 1000); }
  const c = compile(format);
  const match = c.re.exec(str);
  if (!match) { return null; }
  const o: any = {};
  for (let k = 0; k < c.sets.length; k++) { c.sets[k](match[k + 1], o); }
  return buildDate(o, !!strict);
};
D.parseDate = D.parse;
D.isValidFormat = (s: string, f: string) => !!D.parse(s, f, true);
D.formatContainsHourInfo = (f: string) => /[gGhHisuU]/.test(String(f).replace(/\\./g, ''));
D.formatContainsDateInfo = (f: string) => /[djDlNwSzWFmMntoyYLcCU]/.test(String(f).replace(/\\./g, ''));

Ext.Date = D;
export default D;
