/**
 * Evaluates an AG Grid filter model against a plain record.
 *
 * Why: in Ext JS the *Store* owns filtering (store.filter / gridfilters push filters
 * into the store). We keep that split: AG Grid renders the filter UI and produces the
 * filter model; our store applies it BEFORE paging and grouping — which AG Grid
 * Community cannot do itself once group-header rows are part of rowData.
 *
 * Supports: text / number / date (dateString) simple + combined (AND/OR) models,
 * and our custom `list` filter (Ext `filter: { type: 'list' }` / `'boolean'`).
 */

export type FilterModel = Record<string, ColumnFilterModel>;

type SimpleModel = {
  filterType?: 'text' | 'number' | 'date';
  type?: string | null;
  filter?: string | number | null;
  filterTo?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};
type CombinedModel = { filterType?: string; operator: 'AND' | 'OR'; conditions: SimpleModel[] };
export type ListModel = { filterType: 'list'; values: unknown[] };
export type ColumnFilterModel = SimpleModel | CombinedModel | ListModel;

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

function textPasses(m: SimpleModel, raw: unknown): boolean {
  if (m.type === 'blank') return isBlank(raw);
  if (m.type === 'notBlank') return !isBlank(raw);
  const v = String(raw ?? '').toLowerCase();
  const f = String(m.filter ?? '').toLowerCase();
  switch (m.type) {
    case 'equals': return v === f;
    case 'notEqual': return v !== f;
    case 'startsWith': return v.startsWith(f);
    case 'endsWith': return v.endsWith(f);
    case 'notContains': return !v.includes(f);
    case 'contains':
    default: return v.includes(f);
  }
}

function numberPasses(m: SimpleModel, raw: unknown): boolean {
  if (m.type === 'blank') return isBlank(raw);
  if (m.type === 'notBlank') return !isBlank(raw);
  if (isBlank(raw)) return false;
  const v = Number(raw);
  const f = Number(m.filter);
  switch (m.type) {
    case 'notEqual': return v !== f;
    case 'greaterThan': return v > f;
    case 'greaterThanOrEqual': return v >= f;
    case 'lessThan': return v < f;
    case 'lessThanOrEqual': return v <= f;
    case 'inRange': return v > f && v < Number(m.filterTo); // AG Grid default: exclusive
    case 'equals':
    default: return v === f;
  }
}

function datePasses(m: SimpleModel, raw: unknown): boolean {
  if (m.type === 'blank') return isBlank(raw);
  if (m.type === 'notBlank') return !isBlank(raw);
  if (isBlank(raw)) return false;
  const v = String(raw).slice(0, 10); // ISO dates compare correctly as strings
  const from = (m.dateFrom ?? '').slice(0, 10);
  const to = (m.dateTo ?? '').slice(0, 10);
  switch (m.type) {
    case 'notEqual': return v !== from;
    case 'lessThan': return v < from;
    case 'greaterThan': return v > from;
    case 'inRange': return v > from && v < to;
    case 'equals':
    default: return v === from;
  }
}

function simplePasses(m: SimpleModel, raw: unknown, filterType?: string): boolean {
  switch (m.filterType ?? filterType) {
    case 'number': return numberPasses(m, raw);
    case 'date': return datePasses(m, raw);
    default: return textPasses(m, raw);
  }
}

export function columnPasses(model: ColumnFilterModel, raw: unknown): boolean {
  if ('values' in model && model.filterType === 'list') {
    return model.values.some((x) => x === raw);
  }
  if ('conditions' in model) {
    const results = model.conditions.map((c) => simplePasses(c, raw, model.filterType));
    return model.operator === 'OR' ? results.some(Boolean) : results.every(Boolean);
  }
  return simplePasses(model as SimpleModel, raw);
}

export function recordPasses<T extends object>(rec: T, model: FilterModel | null | undefined): boolean {
  if (!model) return true;
  for (const [colId, m] of Object.entries(model)) {
    if (m && !columnPasses(m, (rec as Record<string, unknown>)[colId])) return false;
  }
  return true;
}
