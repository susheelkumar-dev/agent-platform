/** Ext.util.Format: the formatting functions renderers and templates use (number, date, money, text). */
import { Ext } from '../core/ext';
import './date';

const F: any = {};
F.thousandSeparator = ',';
F.decimalSeparator = '.';
F.currencySign = '$';
F.currencyPrecision = 2;
F.currencyAtEnd = false;
F.currencySpacer = '';
F.percentSign = '%';
F.defaultDateFormat = undefined;

const cleanRe = /[^\d.#]/g;
const allHashes = /^#+$/;
const trailingZeroes = /\.?0+$/;
const formatPattern = /[\d,.#]+/;

F.number = function (v: any, formatString?: string) {
  if (!formatString) { return v; }
  if (v === null || v === undefined || v === '' || isNaN(v)) { return ''; }
  v = Number(v);
  let comma = F.thousandSeparator, dec = F.decimalSeparator;
  let precision = 0, hasComma: boolean, psplit: string[], trim = false;
  let neg: any = v < 0;
  v = Math.abs(v);
  if (formatString.substr(formatString.length - 2) === '/i') {
    formatString = formatString.substr(0, formatString.length - 2);
    const i18n = formatString.lastIndexOf(dec);
    hasComma = formatString.indexOf(comma) !== -1;
    psplit = formatString.replace(new RegExp('[^\\d#' + Ext.String.escapeRegex(dec) + ']', 'g'), '').split(dec);
    comma = F.thousandSeparator;
    void i18n;
  } else {
    hasComma = formatString.indexOf(',') !== -1;
    psplit = formatString.replace(cleanRe, '').split('.');
  }
  if (psplit.length > 2) { throw new Error('Invalid number format: ' + formatString); }
  if (psplit.length === 2) {
    precision = psplit[1].length;
    trim = allHashes.test(psplit[1]);
  }
  let fnum = Number(v).toFixed(precision);
  psplit = fnum.split('.');
  if (hasComma) {
    const cnum = psplit[0];
    const parr = [];
    const j = cnum.length;
    let n = cnum.length % 3 || 3;
    for (let i = 0; i < j; i += n) {
      if (i !== 0) { n = 3; }
      parr[parr.length] = cnum.substr(i, n);
    }
    fnum = parr.join(comma);
    if (psplit[1]) { fnum += dec + psplit[1]; }
  } else if (psplit[1]) {
    fnum = psplit[0] + dec + psplit[1];
  }
  if (trim) { fnum = fnum.replace(trailingZeroes, ''); }
  if (neg) { neg = fnum.replace(/[^1-9]/g, '') !== ''; }
  return (neg ? '-' : '') + formatString.replace(formatPattern, fnum);
};
F.numberRenderer = (format: string) => (v: any) => F.number(v, format);
F.currency = function (v: any, currencySign?: string, decimals?: number, end?: boolean, spacer?: string) {
  let negativeSign = '';
  let format = ',0';
  v = v - 0;
  if (v < 0) { v = -v; negativeSign = '-'; }
  decimals = Ext.isDefined(decimals) ? decimals : F.currencyPrecision;
  format += decimals > 0 ? '.' : '';
  for (let i = 0; i < decimals; i++) { format += '0'; }
  v = F.number(v, format);
  spacer = spacer || F.currencySpacer;
  if ((end || F.currencyAtEnd) === true) { return negativeSign + v + spacer + (currencySign || F.currencySign); }
  return negativeSign + (currencySign || F.currencySign) + spacer + v;
};
F.usMoney = (v: any) => F.currency(v, '$', 2);
F.percent = (v: any, format?: string) => F.number(v * 100, format || '0') + F.percentSign;
F.date = function (v: any, format?: string) {
  if (!v) { return ''; }
  if (!Ext.isDate(v)) { v = new Date(Date.parse(v)); }
  return Ext.Date.dateFormat(v, format || Ext.Date.defaultFormat);
};
F.dateRenderer = (format: string) => (v: any) => F.date(v, format);
F.undef = (v: any) => (v !== undefined ? v : '');
F.defaultValue = (v: any, def = '') => (v !== undefined && v !== '' ? v : def);
F.substr = (v: any, start: number, length?: number) => String(v).substr(start, length);
F.lowercase = (v: any) => String(v).toLowerCase();
F.uppercase = (v: any) => String(v).toUpperCase();
F.capitalize = Ext.String.capitalize;
F.uncapitalize = Ext.String.uncapitalize;
F.ellipsis = Ext.String.ellipsis;
F.format = Ext.String.format;
F.htmlDecode = Ext.String.htmlDecode;
F.htmlEncode = Ext.String.htmlEncode;
F.leftPad = Ext.String.leftPad;
F.trim = Ext.String.trim;
F.escapeRegex = Ext.String.escapeRegex;
F.stripTags = (v: any) => (!v ? v : String(v).replace(/<\/?[^>]+>/gi, ''));
F.stripScripts = (v: any) => (!v ? v : String(v).replace(/(?:<script.*?>)((\n|\r|.)*?)(?:<\/script>)/gi, ''));
F.fileSize = function (size: number) {
  const kb = 1024, mb = kb * 1024, gb = mb * 1024;
  if (size < kb) { return size + ' bytes'; }
  if (size < mb) { return Math.round((size * 10) / kb) / 10 + ' KB'; }
  if (size < gb) { return Math.round((size * 10) / mb) / 10 + ' MB'; }
  return Math.round((size * 10) / gb) / 10 + ' GB';
};
F.round = (v: any, precision?: number) => { const f = Math.pow(10, precision || 0); return Math.round(v * f) / f; };
F.plural = (v: number, s: string, p?: string) => v + ' ' + (v === 1 ? s : p || s + 's');
F.nl2br = (v: any) => (Ext.isEmpty(v) ? '' : String(v).replace(/(\r\n|\n)/g, '<br/>'));
F.attributes = (attributes: any) => {
  if (typeof attributes === 'object') {
    const out = [];
    for (const k in attributes) { if (Object.prototype.hasOwnProperty.call(attributes, k)) { out.push(k, '="', k === 'style' ? attributes[k] : F.htmlEncode(attributes[k]), '" '); } }
    return out.join('');
  }
  return attributes || '';
};
F.math = function () { return function (v: any, a: string) { return eval(v + a); }; }();
F.sign = (v: number, neg: string, pos?: string, zero?: string) => (v === 0 ? zero || pos || '' : v < 0 ? neg : pos || '');
F.toggle = Ext.String.toggle;
F.boolean = (v: any) => (v ? 'true' : 'false');
F.hex = (v: number, digits?: number) => { let s = Number(v).toString(16); if (digits) { s = Ext.String.leftPad(s, digits, '0'); } return s; };
F.or = (v: any, orValue: any) => v || orValue;
F.pick = (v: any, ...choices: any[]) => choices[v ? 1 : 0];
F.css = (v: any) => v;
F.resource = (url: string) => url;

Ext.util = Ext.util || {};
Ext.util.Format = F;
export default F;
