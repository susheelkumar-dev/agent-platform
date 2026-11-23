/** Reading and changing the layouts inside a display, addressed by panel. Every function mutates a draft copy. */
import type { Action, Display, Entity, EntryLayout, Panel, Selection, SummaryLayout } from './types';

export function entryOf(d: Display, panel: Panel): EntryLayout | null {
  if (panel === 'entry') return d.entry ?? null;
  if (panel === 'detail') return d.masterSlave?.detail.entry ?? null;
  return null;
}

export function summaryOf(d: Display, panel: Panel): SummaryLayout | null {
  if (panel === 'summary') return d.summary ?? null;
  if (panel === 'master') return d.masterSlave?.master.summary ?? null;
  if (panel === 'detailList') return d.masterSlave?.detail.summary ?? null;
  return null;
}

export function entityNameOf(d: Display, panel: Panel): string | null {
  if (panel === 'entry' || panel === 'summary') return d.entity ?? null;
  if (panel === 'master') return d.masterSlave?.master.entity ?? null;
  return d.masterSlave?.detail.entity ?? null;
}

export function panelsOf(d: Display): Panel[] {
  if (d.type === 'entry') return ['entry'];
  if (d.type === 'summary') return ['summary'];
  return d.masterSlave?.detail.relation === 'child' ? ['master', 'detailList', 'detail'] : ['master', 'detail'];
}

export const PANEL_LABEL: Record<Panel, string> = { entry: 'Form', summary: 'Grid', master: 'Master list', detail: 'Detail form', detailList: 'Child list' };

export function actionsOf(d: Display, panel: Panel, list: 'actions' | 'toolbarActions' | 'rowActions'): Action[] | null {
  if (list === 'actions') { const e = entryOf(d, panel); if (!e) return null; e.actions = e.actions || []; return e.actions; }
  const s = summaryOf(d, panel);
  if (!s) return null;
  s[list] = s[list] || [];
  return s[list]!;
}

export function move<T>(arr: T[], from: number, to: number): void {
  if (from < 0 || from >= arr.length) return;
  const [x] = arr.splice(from, 1);
  arr.splice(Math.max(0, Math.min(arr.length, to > from ? to - 1 : to)), 0, x);
}

/** Every field name a display uses for one entity (to warn before deleting a field). */
export function usesOfField(d: Display, entity: string, field: string): string[] {
  const out: string[] = [];
  const check = (panel: Panel) => {
    if (entityNameOf(d, panel) !== entity) return;
    const e = entryOf(d, panel);
    e?.sections.forEach((s) => s.items.forEach((i) => { if (i.field === field) out.push(`${d.title}: form (${s.title || s.id})`); }));
    const s = summaryOf(d, panel);
    if (s?.columns.some((c) => c.field === field)) out.push(`${d.title}: grid column`);
    if (s?.searchFields?.some((c) => c.field === field)) out.push(`${d.title}: search field`);
  };
  (['entry', 'summary', 'master', 'detail', 'detailList'] as Panel[]).forEach(check);
  if (d.masterSlave?.detail.linkField === field && d.masterSlave.detail.entity === entity) out.push(`${d.title}: link field`);
  return out;
}

/** Rename a field everywhere this display and the entity refer to it. */
export function renameField(d: Display, entities: Record<string, Entity>, entityName: string, from: string, to: string): void {
  const e = entities[entityName];
  if (!e) return;
  const f = e.fields.find((x) => x.name === from);
  if (f) f.name = to;
  if (e.titleField === from) e.titleField = to;
  if (e.parent?.field === from) e.parent.field = to;
  for (const panel of ['entry', 'summary', 'master', 'detail', 'detailList'] as Panel[]) {
    if (entityNameOf(d, panel) !== entityName) continue;
    const en = entryOf(d, panel);
    en?.sections.forEach((s) => s.items.forEach((i) => {
      if (i.field === from) i.field = to;
      if (i.visibleWhen?.field === from) i.visibleWhen.field = to;
    }));
    if (en?.copyExclude) en.copyExclude = en.copyExclude.map((x) => (x === from ? to : x));
    const s = summaryOf(d, panel);
    s?.columns.forEach((c) => { if (c.field === from) c.field = to; });
    s?.searchFields?.forEach((c) => { if (c.field === from) c.field = to; });
    s?.sorters?.forEach((c) => { if (c.field === from) c.field = to; });
  }
  if (d.masterSlave?.detail.entity === entityName && d.masterSlave.detail.linkField === from) d.masterSlave.detail.linkField = to;
}

/** Remove a field from every layout of this display (the entity field itself stays). */
export function unplaceField(d: Display, entityName: string, field: string): void {
  for (const panel of ['entry', 'summary', 'master', 'detail', 'detailList'] as Panel[]) {
    if (entityNameOf(d, panel) !== entityName) continue;
    const en = entryOf(d, panel);
    en?.sections.forEach((s) => { s.items = s.items.filter((i) => i.field !== field); });
    const s = summaryOf(d, panel);
    if (s) {
      s.columns = s.columns.filter((c) => c.field !== field);
      s.searchFields = (s.searchFields || []).filter((c) => c.field !== field);
      s.sorters = (s.sorters || []).filter((c) => c.field !== field);
    }
  }
}

/** Best-effort: the selection an issue path (from validation) points at. */
export function selectionForIssue(d: Display, path: string, where: string): Selection | null {
  if (where.startsWith('entity:')) {
    const entity = where.slice(7);
    const m = /^fields\.(\w+)/.exec(path);
    return m ? { kind: 'field', entity, field: m[1] } : { kind: 'entity', entity };
  }
  const panelOf = (p: string): Panel | null => p.startsWith('entry') ? 'entry' : p.startsWith('summary') ? 'summary'
    : p.startsWith('masterSlave.master') ? 'master' : p.startsWith('masterSlave.detail.summary') ? 'detailList' : p.startsWith('masterSlave.detail') ? 'detail' : null;
  if (path.startsWith('menu') || path.startsWith('folders')) return { kind: 'menu' };
  const panel = panelOf(path);
  if (!panel) return { kind: 'display' };
  let m = /sections\.(\d+)\.items\.(\d+)/.exec(path);
  const en = entryOf(d, panel);
  if (m && en) {
    const s = en.sections[Number(m[1])];
    const it = s?.items[Number(m[2])];
    if (s && it) return { kind: 'item', panel, section: s.id, field: it.field };
  }
  m = /sections\.(\d+)/.exec(path);
  if (m && en?.sections[Number(m[1])]) return { kind: 'section', panel, section: en.sections[Number(m[1])].id };
  const sm = summaryOf(d, panel);
  m = /columns\.(\d+)/.exec(path);
  if (m && sm?.columns[Number(m[1])]) return { kind: 'column', panel, field: sm.columns[Number(m[1])].field };
  m = /searchFields\.(\d+)/.exec(path);
  if (m && sm?.searchFields?.[Number(m[1])]) return { kind: 'search', panel, field: sm.searchFields[Number(m[1])].field };
  m = /(actions|toolbarActions|rowActions)\.(\d+)/.exec(path);
  if (m) {
    const list = actionsOf(d, panel, m[1] as 'actions');
    const a = list?.[Number(m[2])];
    if (a) return { kind: 'action', panel, list: m[1] as 'actions', id: a.id };
  }
  return { kind: 'grid', panel };
}
