/** Believable sample values for the canvas and the preview's mock API (deterministic: same field, same rows). */
import type { Entity, EntityField } from './types';

const WORDS = ['North', 'Ridge', 'Solar', 'Delta', 'Harbor', 'Summit', 'Cedar', 'Falcon', 'Orion', 'Willow', 'Granite', 'Aurora'];
const PEOPLE = ['A. Sharma', 'R. Iyer', 'M. Khan', 'S. Rao', 'P. Nair', 'D. Mehta'];

function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function sampleValue(f: EntityField, i: number, entity = ''): unknown {
  const h = hash(entity + f.name + i);
  const pick = <T,>(arr: T[]) => arr[h % arr.length];
  if (f.options?.length) return f.multiple ? f.options.filter((_, j) => (h >> j) & 1).slice(0, 2) : pick(f.options);
  switch (f.dataType) {
    case 'boolean': return h % 3 !== 0;
    case 'integer': return (f.min ?? 1) + (h % Math.max(1, (f.max ?? 500) - (f.min ?? 1)));
    case 'decimal': case 'currency': return Math.round(((f.min ?? 0) + (h % 900000) / 100) * 100) / 100;
    case 'date': return `2026-${String(1 + (h % 12)).padStart(2, '0')}-${String(1 + (h % 28)).padStart(2, '0')}`;
    case 'datetime': return `2026-${String(1 + (h % 12)).padStart(2, '0')}-${String(1 + (h % 28)).padStart(2, '0')}T${String(h % 24).padStart(2, '0')}:${h % 2 ? '30' : '00'}`;
    case 'time': return `${String(6 + (h % 14)).padStart(2, '0')}:${h % 2 ? '30' : '00'}`;
    case 'lookup': return f.multiple ? [1 + (h % 4)] : 1 + (h % 4);
    case 'text': return `${pick(WORDS)} notes for record ${i + 1}.`;
    default: {
      const n = f.name.toLowerCase();
      if (n.includes('code')) return (pick(WORDS).slice(0, 3) + '-' + String(100 + i)).toUpperCase();
      if (n.includes('email')) return `user${i + 1}@example.com`;
      if (n.includes('owner') || n.includes('user') || n.includes('by')) return pick(PEOPLE);
      if (n.includes('name') || n.includes('title')) return `${pick(WORDS)} ${pick(['Park', 'Plant', 'Station', 'Unit', 'Block'])} ${i + 1}`;
      return `${pick(WORDS)} ${i + 1}`;
    }
  }
}

export function sampleRows(e: Entity, n = 6): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => {
    const r: Record<string, unknown> = { [e.idField || 'id']: i + 1 };
    for (const f of e.fields) r[f.name] = sampleValue(f, i, e.name);
    return r;
  });
}

export function display(f: EntityField | undefined, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (f?.dataType === 'boolean') return v ? 'Yes' : 'No';
  if (f?.dataType === 'lookup') return `#${v}`;
  if (f?.dataType === 'currency' && typeof v === 'number') return `${f.currency || ''} ${v.toLocaleString(undefined, { minimumFractionDigits: f.decimals ?? 2, maximumFractionDigits: f.decimals ?? 2 })}`.trim();
  if (f?.dataType === 'decimal' && typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: f.decimals ?? 2 });
  return String(v);
}
