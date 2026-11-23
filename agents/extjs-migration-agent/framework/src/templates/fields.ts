/**
 * Entity field rules shared by the Entry template, generated tests and (later) the CLI: coercion of what the
 * user typed into the record's types, client-side validation, and defaults. The server validates again; these
 * rules only give faster feedback.
 */
import type { FieldDef } from '../types';

export type Values = Record<string, unknown>;
export type Errors = Record<string, string>;
export type Validator = (value: unknown, values: Values, field: FieldDef) => string | null | undefined;

const NUMERIC = new Set(['number', 'integer', 'decimal', 'currency']);
export const isNumeric = (f: FieldDef): boolean => NUMERIC.has(f.type || 'string');

export function defaults(fields: FieldDef[], overrides: Values = {}): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.defaultValue !== undefined) out[f.name] = Array.isArray(f.defaultValue) ? [...f.defaultValue] : f.defaultValue;
    else if (f.type === 'boolean') out[f.name] = false;
    else if (f.type === 'multiselect') out[f.name] = [];
  }
  return { ...out, ...overrides };
}

/** Converts a form value to the field's type; '' becomes null for non-text fields. */
export function coerce(f: FieldDef, raw: unknown): unknown {
  if (raw === undefined) return undefined;
  switch (f.type) {
    case 'number':
    case 'integer':
    case 'decimal':
    case 'currency': {
      if (raw === '' || raw === null) return null;
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
      return Number.isFinite(n) ? n : raw;
    }
    case 'boolean':
      return raw === true || raw === 'true' || raw === 'on' || raw === 1;
    case 'date':
    case 'datetime':
    case 'time':
      return raw === '' ? null : raw;
    case 'multiselect':
      if (raw === null || raw === '') return [];
      return Array.isArray(raw) ? raw : [raw];
    case 'lookup':
    case 'select': {
      if (raw === '' || raw === null) return null;
      // a <select> returns strings; numeric keys go back to numbers
      if (typeof raw === 'string' && /^-?\d+$/.test(raw) && (f.options?.some((o) => typeof o === 'number') || f.lookup)) {
        return Number(raw);
      }
      return raw;
    }
    default: {
      if (raw === null) return null;
      const s = String(raw);
      return f.upperCase ? s.toUpperCase() : s;
    }
  }
}

export function coerceAll(fields: FieldDef[], values: Values): Values {
  const out: Values = { ...values };
  for (const f of fields) if (f.name in values) out[f.name] = coerce(f, values[f.name]);
  return out;
}

const empty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/** true when the field is shown for these values (visibleWhen). Hidden fields are not validated. */
export function isVisible(f: FieldDef, values: Values): boolean {
  if (f.hidden) return false;
  if (!f.visibleWhen) return true;
  const v = values[f.visibleWhen.field];
  return f.visibleWhen.equals.some((e) => String(e) === String(v));
}

function decimalsOf(n: number): number {
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

export function validate(fields: FieldDef[], values: Values, validators: Record<string, Validator> = {}): Errors {
  const errors: Errors = {};
  for (const f of fields) {
    if (!isVisible(f, values)) continue;
    const v = values[f.name];
    if (f.required && empty(v)) { errors[f.name] = `${f.label} is required`; continue; }
    if (empty(v)) continue;
    if (isNumeric(f)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) { errors[f.name] = `${f.label} must be a number`; continue; }
      if (f.type === 'integer' && !Number.isInteger(v)) { errors[f.name] = `${f.label} must be a whole number`; continue; }
      if (f.min !== undefined && v < f.min) { errors[f.name] = `${f.label} must be at least ${f.min}`; continue; }
      if (f.max !== undefined && v > f.max) { errors[f.name] = `${f.label} must be at most ${f.max}`; continue; }
      if (f.decimals !== undefined && decimalsOf(v) > f.decimals) { errors[f.name] = `${f.label} allows ${f.decimals} decimal place(s)`; continue; }
    }
    if (f.type === 'date' && (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v) || Number.isNaN(Date.parse(v.slice(0, 10))))) {
      errors[f.name] = `${f.label} must be a date`; continue;
    }
    if (f.type === 'datetime' && (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) || Number.isNaN(Date.parse(v)))) {
      errors[f.name] = `${f.label} must be a date and time`; continue;
    }
    if (f.type === 'time' && (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))) {
      errors[f.name] = `${f.label} must be a time (hh:mm)`; continue;
    }
    if (typeof v === 'string') {
      if (f.maxLength !== undefined && v.length > f.maxLength) { errors[f.name] = `${f.label} can have at most ${f.maxLength} characters`; continue; }
      if (f.minLength !== undefined && v.length < f.minLength) { errors[f.name] = `${f.label} needs at least ${f.minLength} characters`; continue; }
      if (f.pattern && !new RegExp(f.pattern).test(v)) { errors[f.name] = f.patternMessage || `${f.label} is not in the expected format`; continue; }
    }
    if (f.options && f.type !== 'multiselect' && !f.options.map(String).includes(String(v))) {
      errors[f.name] = `${f.label} must be one of ${f.options.join(', ')}`; continue;
    }
    if (f.type === 'multiselect' && f.options && Array.isArray(v)) {
      const bad = v.filter((x) => !f.options!.map(String).includes(String(x)));
      if (bad.length) { errors[f.name] = `${f.label}: ${bad.join(', ')} is not allowed`; continue; }
    }
    if (f.validator && validators[f.validator]) {
      const msg = validators[f.validator](v, values, f);
      if (msg) errors[f.name] = msg;
    }
  }
  return errors;
}

/** Fields whose value differs from the loaded record (only those are sent on update). */
export function changedValues(fields: FieldDef[], original: Values, current: Values): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.readOnly) continue;
    const a = original[f.name] ?? null, b = current[f.name] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) out[f.name] = current[f.name];
  }
  return out;
}

/** "an asset outage", "a contract" (lower-cased, for messages) */
export function article(noun: string): string {
  const n = noun.trim().toLowerCase();
  return (/^[aeiou]/.test(n) && !/^(u[nr]i|eu|one)/.test(n) ? 'an ' : 'a ') + n;
}
