/**
 * Ext.Template and Ext.XTemplate. XTemplate supports <tpl for|foreach|if|elseif|else|switch|case|default|exec>,
 * {field}, {a.b}, {.}, {#}, {[ inline expression ]}, {% statement %}, {field:formatter(args)} with
 * Ext.util.Format or this.member formatters, and member functions passed in a config object.
 */
import { Ext } from '../core/ext';
import { define } from '../core/class';
import './format';

function decodeAttr(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function splitArgs(html: any[]) {
  const parts = [];
  let cfg = null;
  for (const a of html) {
    if (Ext.isArray(a)) { parts.push(a.join('')); }
    else if (a && typeof a === 'object' && !a.isTemplate) { cfg = Ext.apply(cfg || {}, a); }
    else if (a !== undefined && a !== null) { parts.push(String(a)); }
  }
  return { html: parts.join(''), cfg };
}

// ---------------------------------------------------------------- Ext.Template
const tokenRe = /\{([\w\-.#$]+)(?::([\w.]*)(?:\((.*?)?\))?)?\}/g;

export const Template: any = define('Ext.Template', {
  isTemplate: true,
  disableFormats: false,
  compiled: false,

  constructor: function (...args) {
    const { html, cfg } = splitArgs(args);
    if (cfg) { Ext.apply(this, cfg); }
    this.html = html;
    return this;
  },

  apply: function (values: any) {
    const me = this;
    const useFormat = !me.disableFormats;
    if (Ext.isArray(values) === false && (values === null || values === undefined)) { values = {}; }
    return me.html.replace(tokenRe, function (m, name, format, args) {
      let v = name in Object(values) ? values[name] : undefined;
      if (v === undefined && name.indexOf('.') > 0) {
        v = name.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), values);
      }
      if (format && useFormat) {
        const fargs = args ? (new Function('return [' + args + '];'))() : [];
        if (format.indexOf('this.') === 0) { v = me[format.substr(5)].apply(me, [v].concat(fargs)); }
        else { v = Ext.util.Format[format].apply(Ext.util.Format, [v].concat(fargs)); }
      }
      return v === undefined || v === null ? '' : v;
    });
  },
  applyTemplate: function (values: any) { return this.apply(values); },
  applyOut: function (values: any, out: any[]) { out.push(this.apply(values)); return out; },
  set: function (html: string) { this.html = html; this.$fn = null; return this; },
  compile: function () { return this; },
  overwrite: function (el: any, values: any, returnElement?: boolean) {
    const dom = el && el.dom ? el.dom : (typeof el === 'string' ? document.getElementById(el) : el);
    dom.innerHTML = this.apply(values);
    const first = dom.firstChild;
    return returnElement ? Ext.get(first) : first;
  },
  append: function (el: any, values: any, returnElement?: boolean) { return this.$insert('beforeend', el, values, returnElement); },
  insertFirst: function (el: any, values: any, returnElement?: boolean) { return this.$insert('afterbegin', el, values, returnElement); },
  insertBefore: function (el: any, values: any, returnElement?: boolean) { return this.$insert('beforebegin', el, values, returnElement); },
  insertAfter: function (el: any, values: any, returnElement?: boolean) { return this.$insert('afterend', el, values, returnElement); },
  $insert: function (where: InsertPosition, el: any, values: any, returnElement?: boolean) {
    const dom = el && el.dom ? el.dom : (typeof el === 'string' ? document.getElementById(el) : el);
    const tmp = document.createElement('div');
    tmp.innerHTML = this.apply(values);
    const node = tmp.firstElementChild || tmp.firstChild;
    dom.insertAdjacentHTML(where, tmp.innerHTML);
    return returnElement ? Ext.get(node) : node;
  },
  statics: {
    from: function (el: any, config?: any) {
      const dom = typeof el === 'string' ? document.getElementById(el) : (el.dom || el);
      return new this(dom.value || dom.innerHTML, config || '');
    }
  }
});

// ---------------------------------------------------------------- Ext.XTemplate compiler
const tagRe = /<tpl\b([^>]*)>|<\/tpl>/g;
const attrRe = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const exprRe = /\{\[([\s\S]+?)\]\}|\{%([\s\S]+?)%\}|\{(#|\.|[\w\-$]+(?:\.[\w\-$]+)*)(?::([\w.$]+)(?:\(([\s\S]*?)\))?)?\}/g;

function compileText(text: string, body: string[], disableFormats: boolean) {
  let last = 0;
  exprRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = exprRe.exec(text))) {
    if (m.index > last) { body.push('out.push(' + JSON.stringify(text.slice(last, m.index)) + ');'); }
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      body.push('{ var $v = (function(){ with ($scope(values, parent, xindex, xcount, xkey, out)) { return (' + decodeAttr(m[1]) + '); } }).call(this); if ($v !== undefined && $v !== null) out.push($v); }');
    } else if (m[2] !== undefined) {
      body.push('(function(){ with ($scope(values, parent, xindex, xcount, xkey, out)) { ' + decodeAttr(m[2]) + ' } }).call(this);');
    } else {
      const name = m[3];
      let getter: string;
      if (name === '#') { getter = 'xindex'; }
      else if (name === '.') { getter = 'values'; }
      else if (name === 'xindex' || name === 'xcount' || name === 'xkey') { getter = name; }
      else if (name.indexOf('values.') === 0 || name.indexOf('parent.') === 0) { getter = '$path(' + (name.indexOf('values.') === 0 ? 'values' : 'parent') + ', ' + JSON.stringify(name.substr(name.indexOf('.') + 1)) + ')'; }
      else { getter = '$path(values, ' + JSON.stringify(name) + ')'; }
      const fmt = m[4];
      if (fmt && !disableFormats) {
        const args = m[5] ? ', ' + decodeAttr(m[5]) : '';
        if (fmt.indexOf('this.') === 0) {
          getter = 'this.' + fmt.substr(5) + '(' + getter + args + ')';
        } else {
          getter = 'fm.' + fmt + '(' + getter + args + ')';
        }
      }
      body.push('{ var $v = ' + getter + '; if ($v !== undefined && $v !== null) out.push($v); }');
    }
  }
  if (last < text.length) { body.push('out.push(' + JSON.stringify(text.slice(last)) + ');'); }
}

function compileXTemplate(html: string, disableFormats: boolean) {
  const body: string[] = [];
  const stack: { kind: string; hasElse?: boolean; switchVar?: string; caseOpen?: boolean }[] = [];
  let last = 0, loop = 0;
  tagRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  const cond = (expr: string) => '(function(){ with ($scope(values, parent, xindex, xcount, xkey, out)) { return (' + decodeAttr(expr) + '); } }).call(this)';
  while ((m = tagRe.exec(html))) {
    compileText(html.slice(last, m.index), body, disableFormats);
    last = m.index + m[0].length;
    if (m[0] === '</tpl>') {
      const top = stack.pop();
      if (!top) { continue; }
      if (top.kind === 'for' || top.kind === 'foreach') {
        body.push('}', 'values = $sv' + loop + '; parent = $sp' + loop + '; xindex = $si' + loop + '; xcount = $sc' + loop + '; xkey = $sk' + loop + '; })();');
        loop--;
      } else if (top.kind === 'if') {
        body.push('}');
      } else if (top.kind === 'switch') {
        if (top.caseOpen) { body.push('}'); }
        body.push('})();');
      } else if (top.kind === 'case') {
        // closing of a case/default: handled when the next case opens or the switch closes
        const sw = stack[stack.length - 1];
        if (sw && sw.kind === 'switch') { sw.caseOpen = true; }
      } else if (top.kind === 'plain') {
        // <tpl> with no directive
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(m[1]))) { attrs[a[1]] = a[2] !== undefined ? a[2] : a[3]; }
    if (attrs.for !== undefined || attrs.foreach !== undefined) {
      const isEach = attrs.foreach !== undefined;
      const expr = isEach ? attrs.foreach : attrs.for;
      loop++;
      const target = expr === '.' ? 'values' : (/^[\w$.]+$/.test(expr) ? (expr.indexOf('parent.') === 0 ? '$path(parent, ' + JSON.stringify(expr.substr(7)) + ')' : '$path(values, ' + JSON.stringify(expr) + ')') : cond(expr));
      const between = attrs.between !== undefined ? JSON.stringify(attrs.between) : null;
      body.push('(function(){ var $sv' + loop + ' = values, $sp' + loop + ' = parent, $si' + loop + ' = xindex, $sc' + loop + ' = xcount, $sk' + loop + ' = xkey;');
      body.push('var $list = ' + target + ';');
      if (isEach) {
        body.push('var $keys = $list ? Object.keys($list) : []; parent = values; xcount = $keys.length;');
        body.push('for (var $i = 0; $i < $keys.length; $i++) { xkey = $keys[$i]; values = $list[xkey]; xindex = $i + 1;' + (between ? ' if ($i) out.push(' + between + ');' : ''));
      } else {
        body.push('if ($list === null || $list === undefined) { $list = []; } else if (!Array.isArray($list)) { $list = (typeof $list === "object" && typeof $list.length === "number") ? Array.prototype.slice.call($list) : [$list]; }');
        body.push('parent = values; xcount = $list.length;');
        body.push('for (var $i = 0; $i < $list.length; $i++) { values = $list[$i]; xindex = $i + 1;' + (between ? ' if ($i) out.push(' + between + ');' : ''));
      }
      stack.push({ kind: isEach ? 'foreach' : 'for' });
    } else if (attrs.if !== undefined) {
      body.push('if (' + cond(attrs.if) + ') {');
      stack.push({ kind: 'if' });
    } else if (attrs.elseif !== undefined) {
      body.push('} else if (' + cond(attrs.elseif) + ') {');
      // self-closing semantics: no push; Ext writes <tpl elseif> without a closing tag
      if (/\/\s*$/.test(m[1])) { /* explicit self close */ }
    } else if (/\belse\b/.test(m[1]) && attrs.if === undefined) {
      body.push('} else {');
    } else if (attrs.switch !== undefined) {
      body.push('(function(){ var $sw = ' + (/^[\w$.]+$/.test(attrs.switch) ? '$path(values, ' + JSON.stringify(attrs.switch) + ')' : cond(attrs.switch)) + '; var $matched = false;');
      stack.push({ kind: 'switch', caseOpen: false });
    } else if (attrs.case !== undefined || /\bdefault\b/.test(m[1])) {
      const sw = stack[stack.length - 1];
      if (sw && sw.kind === 'switch') {
        if (sw.caseOpen) { body.push('}'); }
        if (attrs.case !== undefined) {
          body.push('if (!$matched && $sw == ' + JSON.stringify(decodeAttr(attrs.case)) + ') { $matched = true;');
        } else {
          body.push('if (!$matched) { $matched = true;');
        }
        sw.caseOpen = true;
      }
    } else if (attrs.exec !== undefined) {
      body.push('(function(){ with ($scope(values, parent, xindex, xcount, xkey, out)) { ' + decodeAttr(attrs.exec) + ' } }).call(this);');
      stack.push({ kind: 'plain' });
    } else {
      stack.push({ kind: 'plain' });
    }
  }
  compileText(html.slice(last), body, disableFormats);
  const src = 'var fm = Ext.util.Format;\n' +
    // identifiers in conditions / inline code resolve to the current values, then the template locals, then
    // globals; anything else is undefined (Ext semantics: a missing property is falsy, not an error)
    'function $scope(v, parent, xindex, xcount, xkey, out) { var target = (v === null || v === undefined) ? {} : Object(v); var locals = { values: v, parent: parent, xindex: xindex, xcount: xcount, xkey: xkey, fm: fm, out: out, Ext: Ext }; return new Proxy(target, { has: function (t, k) { return typeof k === "string"; }, get: function (t, k) { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; if (k in locals) return locals[k]; return globalThis[k]; } }); }\n' +
    'function $path(o, p) { if (o === null || o === undefined) return undefined; var parts = p.split("."); for (var i = 0; i < parts.length; i++) { if (o === null || o === undefined) return undefined; o = (typeof o.get === "function" && o.isModel) ? o.get(parts[i]) : o[parts[i]]; } return o; }\n' +
    'parent = parent || null; xindex = xindex || 1; xcount = xcount || 1; var xkey;\n' +
    body.join('\n') + '\nreturn out;';
  // eslint-disable-next-line no-new-func
  return new Function('Ext', 'out', 'values', 'parent', 'xindex', 'xcount', src);
}

export const XTemplate: any = define('Ext.XTemplate', {
  extend: 'Ext.Template',
  emptyObj: {},
  strict: false,

  apply: function (values: any, parent?: any) {
    return this.applyOut(values, [], parent).join('');
  },
  applyOut: function (values: any, out: any[], parent?: any) {
    const me = this;
    if (!me.$fn) { me.$fn = compileXTemplate(me.html, !!me.disableFormats); }
    try {
      me.$fn.call(me, Ext, out, values, parent, 1, 1);
    } catch (e) {
      if (me.strict) { throw e; }
      console.warn('XTemplate error: ' + (e && e.message), me.html.substring(0, 200));
    }
    return out;
  },
  set: function (html: string) { this.html = html; this.$fn = null; return this; },
  statics: {
    getTpl: function (instance: any, name: string) {
      let tpl = instance[name];
      if (tpl && !tpl.isTemplate) {
        tpl = Ext.XTemplate.get(tpl);
        if (Object.prototype.hasOwnProperty.call(instance, name) || instance.isInstance) { instance[name] = tpl; }
      }
      return tpl || null;
    },
    get: function (config: any) {
      if (!config) { return null; }
      if (config.isTemplate) { return config; }
      if (Ext.isArray(config) || typeof config === 'string') { return new Ext.XTemplate(config); }
      return new Ext.XTemplate(config.html || config.tpl || '', config);
    }
  }
});

export default XTemplate;
