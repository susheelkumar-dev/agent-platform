/**
 * Ext.ComponentQuery: xtype, '*', '#itemId', '[attr]', '[attr=value]' (also != ^= $= *= ~= /=, with quoted
 * values and getter fallback), ':not(...)', ':first', ':last', ':nth-child(n|odd|even)', ':focusable',
 * ':visible', member-function '{fn()}' filters, 'xtype(true)' (shallow), and the combinators ' ', '>', '^'
 * (ancestor) and '~' (sibling); comma-separated selector groups.
 */
import { Ext } from '../core/ext';

type Step = { xtype?: string; shallow?: boolean; id?: string; attrs: any[]; pseudos: any[]; combinator: string };

const cache = new Map<string, Step[][]>();

function parseGroup(sel: string): Step[] {
  const steps: Step[] = [];
  let i = 0;
  const n = sel.length;
  let combinator = ' ';
  const ws = () => { while (i < n && /\s/.test(sel[i])) { i++; } };
  ws();
  while (i < n) {
    const c = sel[i];
    if (c === '>' || c === '^' || c === '~') { combinator = c; i++; ws(); continue; }
    const step: Step = { attrs: [], pseudos: [], combinator };
    combinator = ' ';
    // xtype
    let m = /^(\*|[\w.\-]+)(\(true\))?/.exec(sel.slice(i));
    if (m) { step.xtype = m[1]; if (m[2]) { step.shallow = true; } i += m[0].length; }
    // modifiers
    for (;;) {
      if (sel[i] === '#') {
        m = /^#([\w.\-]+)/.exec(sel.slice(i));
        if (!m) { break; }
        step.id = m[1]; i += m[0].length;
      } else if (sel[i] === '[') {
        // [attr op value]
        let depth = 0, j = i;
        let inQ: string | null = null;
        for (; j < n; j++) {
          const ch = sel[j];
          if (inQ) { if (ch === inQ && sel[j - 1] !== '\\') { inQ = null; } continue; }
          if (ch === '"' || ch === "'") { inQ = ch; continue; }
          if (ch === '[') { depth++; }
          if (ch === ']') { depth--; if (depth === 0) { break; } }
        }
        const body = sel.slice(i + 1, j);
        i = j + 1;
        const am = /^\s*(@?[\w\-$.?]+)\s*(?:(=|!=|\^=|\$=|\*=|~=|\/=|<=|>=|<|>)\s*([\s\S]*?))?\s*$/.exec(body);
        if (am) {
          let v: any = am[3];
          if (v !== undefined) {
            v = v.trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) { v = v.slice(1, -1); }
          }
          step.attrs.push({ name: am[1].replace(/^\?/, ''), op: am[2], value: v });
        }
      } else if (sel[i] === ':') {
        m = /^:([\w\-]+)(?:\(([^()]*(?:\([^()]*\)[^()]*)*)\))?/.exec(sel.slice(i));
        if (!m) { break; }
        step.pseudos.push({ name: m[1], arg: m[2] });
        i += m[0].length;
      } else if (sel[i] === '{') {
        const j = sel.indexOf('}', i);
        step.pseudos.push({ name: '$fn', arg: sel.slice(i + 1, j) });
        i = j + 1;
      } else if (sel[i] === '.') {
        // '.cls' is not Ext syntax, treat as [cls~=...] for convenience
        m = /^\.([\w\-]+)/.exec(sel.slice(i));
        if (!m) { break; }
        step.attrs.push({ name: 'cls', op: '~=', value: m[1] });
        i += m[0].length;
      } else {
        break;
      }
    }
    steps.push(step);
    ws();
    if (i < n && !/[>^~]/.test(sel[i]) && steps.length && step === steps[steps.length - 1]) {
      // descendant combinator implied by whitespace
    }
    // guard against unparsable input
    if (i < n && !/[\w*#[:{.>^~]/.test(sel[i])) { i++; }
  }
  return steps;
}

function splitGroups(sel: string) {
  const out: string[] = [];
  let depth = 0, start = 0, q: string | null = null;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (q) { if (c === q) { q = null; } continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '(' || c === '[') { depth++; }
    if (c === ')' || c === ']') { depth--; }
    if (c === ',' && depth === 0) { out.push(sel.slice(start, i)); start = i + 1; }
  }
  out.push(sel.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

function parse(selector: string): Step[][] {
  let p = cache.get(selector);
  if (!p) { p = splitGroups(selector).map(parseGroup); cache.set(selector, p); }
  return p;
}

function attrValue(cmp: any, name: string) {
  if (name.charAt(0) === '@') { name = name.substr(1); return cmp[name]; }
  if (name.indexOf('.') > 0) { return name.split('.').reduce((o: any, k: string) => (o === null || o === undefined ? undefined : o[k]), cmp); }
  let v = cmp[name];
  if (v === undefined) {
    const getter = cmp['get' + Ext.String.capitalize(name)];
    if (typeof getter === 'function' && getter.length === 0) { try { v = getter.call(cmp); } catch (e) { v = undefined; } }
  }
  return v;
}

function matchAttr(cmp: any, a: any) {
  const v = attrValue(cmp, a.name);
  if (!a.op) { return v !== undefined && v !== null && v !== false && v !== ''; }
  const want = a.value;
  const sv = v === undefined || v === null ? '' : (Ext.isArray(v) ? v.join(' ') : String(v));
  switch (a.op) {
    case '=': return v !== undefined && v !== null && (sv === want || (typeof v === 'boolean' && String(v) === want) || (typeof v === 'number' && Number(want) === v));
    case '!=': return sv !== want;
    case '^=': return sv.indexOf(want) === 0;
    case '$=': return sv.slice(-want.length) === want;
    case '*=': return sv.indexOf(want) >= 0;
    case '~=': return (' ' + sv + ' ').indexOf(' ' + want + ' ') >= 0 || (typeof v === 'string' && v.split(/\s+/).indexOf(want) >= 0);
    case '/=': return new RegExp(want).test(sv);
    case '<': return Number(v) < Number(want);
    case '>': return Number(v) > Number(want);
    case '<=': return Number(v) <= Number(want);
    case '>=': return Number(v) >= Number(want);
    default: return false;
  }
}

function siblingsOf(cmp: any) {
  const owner = cmp.ownerCt;
  if (owner && owner.items && owner.items.items) { return owner.items.items; }
  return [cmp];
}

function matchStep(cmp: any, step: Step): boolean {
  if (!cmp || cmp.destroyed) { return false; }
  if (step.xtype && step.xtype !== '*') {
    if (step.shallow ? cmp.xtype !== step.xtype : !(cmp.isXType ? cmp.isXType(step.xtype) : false)) { return false; }
  }
  if (step.id && cmp.itemId !== step.id && cmp.id !== step.id && (!cmp.getItemId || cmp.getItemId() !== step.id)) { return false; }
  for (const a of step.attrs) { if (!matchAttr(cmp, a)) { return false; } }
  for (const p of step.pseudos) {
    switch (p.name) {
      case 'not': if (is(cmp, p.arg)) { return false; } break;
      case 'first': if (siblingsOf(cmp)[0] !== cmp) { return false; } break;
      case 'last': { const s = siblingsOf(cmp); if (s[s.length - 1] !== cmp) { return false; } break; }
      case 'nth-child': {
        const idx = siblingsOf(cmp).indexOf(cmp) + 1;
        const arg = String(p.arg).trim();
        if (arg === 'odd' ? idx % 2 !== 1 : arg === 'even' ? idx % 2 !== 0 : Number(arg) !== idx) { return false; }
        break;
      }
      case 'focusable': if (!(cmp.isFocusable ? cmp.isFocusable() : !cmp.disabled && !cmp.hidden)) { return false; } break;
      case 'visible': if (!(cmp.isVisible && cmp.isVisible(p.arg === 'true'))) { return false; } break;
      case 'hidden': if (!cmp.hidden) { return false; } break;
      case 'disabled': if (!cmp.disabled) { return false; } break;
      case '$fn': {
        const m = /^\s*([\w$]+)\(\)\s*$/.exec(p.arg);
        if (m) { const fn = cmp[m[1]]; if (!(typeof fn === 'function' && fn.call(cmp))) { return false; } }
        break;
      }
      default: break;
    }
  }
  return true;
}

/**
 * Structural parent for selectors, as Ext's query sees it: the owner only counts when the owner's
 * getRefItems lists the component (a window merely owned by a grid through ownerCmp is not inside it).
 */
function parentOf(cmp: any) {
  if (cmp.ownerCt) { return cmp.ownerCt; }
  const p = cmp.getRefOwner ? cmp.getRefOwner() : (cmp.ownerCmp || cmp.floatParent || null);
  if (!p || !p.getRefItems) { return null; }
  const items = p.getRefItems(false) || [];
  return items.indexOf(cmp) >= 0 ? p : null;
}

/** Does cmp match the compound group (checking ancestors for combinators)? */
function matchGroup(cmp: any, steps: Step[], root: any): boolean {
  let idx = steps.length - 1;
  if (!matchStep(cmp, steps[idx])) { return false; }
  let current = cmp;
  while (idx > 0) {
    const comb = steps[idx].combinator;
    const prev = steps[idx - 1];
    if (comb === '>') {
      current = parentOf(current);
      if (!current || !matchStep(current, prev)) { return false; }
    } else if (comb === '~') {
      const sibs = siblingsOf(current);
      const i = sibs.indexOf(current);
      const found = sibs.slice(0, i).reverse().find((s: any) => matchStep(s, prev));
      if (!found) { return false; }
      current = found;
    } else if (comb === '^') {
      // "a ^ b": b is an ancestor of a (handled when evaluating from the left side)
      return false;
    } else {
      let p = parentOf(current);
      while (p && !matchStep(p, prev)) { if (root && p === root) { p = null; break; } p = parentOf(p); }
      if (!p) { return false; }
      current = p;
    }
    idx--;
  }
  if (steps[0].combinator === '>' && root) {
    // leading '>' (e.g. container.query('> panel')): the first step must be a direct child of root
    if (parentOf(current) !== root) { return false; }
  }
  if (root && root !== cmp) {
    // must be within root
    let p = parentOf(cmp);
    while (p && p !== root) { p = parentOf(p); }
    if (!p) { return false; }
  }
  return true;
}

export function descendantsOf(root: any): any[] {
  const out: any[] = [];
  const seen = new Set();
  const walk = (c: any) => {
    const kids = c.getRefItems ? c.getRefItems(false) : [];
    for (const k of kids) {
      if (!k || seen.has(k) || k.destroyed) { continue; }
      seen.add(k);
      out.push(k);
      walk(k);
    }
  };
  walk(root);
  return out;
}

export function query(selector: string, root?: any): any[] {
  if (!selector) { return []; }
  const groups = parse(selector);
  const result: any[] = [];
  const seen = new Set();
  for (const steps of groups) {
    if (!steps.length) { continue; }
    if (steps.some((s) => s.combinator === '^')) {
      // ancestor axis: evaluate left part, then walk up
      const caretIdx = steps.findIndex((s) => s.combinator === '^');
      const left = query(stepsToString(steps.slice(0, caretIdx)), root);
      const right = steps.slice(caretIdx);
      right[0] = Object.assign({}, right[0], { combinator: ' ' });
      for (const l of left) {
        let p = parentOf(l);
        while (p) { if (matchStep(p, right[0]) && !seen.has(p)) { seen.add(p); result.push(p); break; } p = parentOf(p); }
      }
      continue;
    }
    const candidates = root ? descendantsOf(root) : Ext.ComponentManager.getAll();
    for (const c of candidates) {
      if (seen.has(c)) { continue; }
      if (matchGroup(c, steps, root || null)) { seen.add(c); result.push(c); }
    }
  }
  return result;
}

function stepsToString(steps: Step[]) {
  return steps.map((s, i) => (i ? (s.combinator === ' ' ? ' ' : ' ' + s.combinator + ' ') : '') + (s.xtype || '*') + (s.id ? '#' + s.id : '') +
    s.attrs.map((a) => '[' + a.name + (a.op ? a.op + '"' + a.value + '"' : '') + ']').join('')).join('');
}

export function is(cmp: any, selector: string): boolean {
  if (!selector) { return true; }
  return parse(selector).some((steps) => matchGroup(cmp, steps, null));
}

export const ComponentQuery = {
  query,
  is,
  queryBy(fn: any, root?: any) { return (root ? descendantsOf(root) : Ext.ComponentManager.getAll()).filter(fn); },
  cache
};
Ext.ComponentQuery = ComponentQuery;
export default ComponentQuery;
