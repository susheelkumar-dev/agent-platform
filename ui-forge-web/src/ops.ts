/**
 * Drag-and-drop and keyboard operations on the document. A payload says what is dragged, a target where it goes;
 * `drop` changes the draft and returns what to select (or a message when the drop is not allowed).
 */
import { CONTROL, newAction, newField, newSection } from './catalog';
import { actionsOf, entityNameOf, entryOf, move, summaryOf } from './layout';
import { uniqueName } from './naming';
import type { Doc } from './store';
import type { Action, Column, EntityField, Panel, SearchField, Selection } from './types';

export type Payload =
  | { t: 'control'; id: string }
  | { t: 'field'; entity: string; field: string }
  | { t: 'item'; panel: Panel; section: string; field: string }
  | { t: 'section'; panel: Panel; section: string }
  | { t: 'column'; panel: Panel; field: string }
  | { t: 'search'; panel: Panel; field: string }
  | { t: 'action'; panel: Panel; list: 'actions' | 'toolbarActions' | 'rowActions'; id: string };

export type Target =
  | { t: 'items'; panel: Panel; section: string; index: number }
  | { t: 'sections'; panel: Panel; index: number }
  | { t: 'columns'; panel: Panel; index: number }
  | { t: 'search'; panel: Panel; index: number }
  | { t: 'actions'; panel: Panel; list: 'actions' | 'toolbarActions' | 'rowActions'; index: number };

let current: Payload | null = null;
export const MIME = 'application/x-ui-forge';

export function startDrag(e: React.DragEvent, p: Payload) {
  current = p;
  e.dataTransfer.effectAllowed = p.t === 'control' || p.t === 'field' ? 'copy' : 'move';
  e.dataTransfer.setData(MIME, JSON.stringify(p));
  e.dataTransfer.setData('text/plain', p.t === 'control' ? CONTROL[p.id]?.label ?? p.id : 'field' in p ? p.field : p.t);
  document.body.classList.add('dragging');
  // let drop zones re-render after the browser has taken its drag image
  setTimeout(() => window.dispatchEvent(new Event('uiforge-drag')), 0);
}
export function endDrag() { current = null; document.body.classList.remove('dragging'); window.dispatchEvent(new Event('uiforge-drag')); }
export const dragged = () => current;
export function payloadOf(e: React.DragEvent): Payload | null {
  try { const raw = e.dataTransfer.getData(MIME); return raw ? JSON.parse(raw) : current; } catch { return current; }
}

/** Can this payload land on this target? (used to light up drop zones while dragging) */
export function accepts(p: Payload | null, t: Target['t'], doc: Doc | null, panel: Panel): boolean {
  if (!p || !doc) return false;
  const c = p.t === 'control' ? CONTROL[p.id] : null;
  const panelEntity = entityNameOf(doc.display, panel);
  switch (t) {
    case 'items': return (c?.creates === 'field') || (p.t === 'field' && p.entity === panelEntity) || (p.t === 'item' && p.panel === panel);
    case 'sections': return c?.creates === 'section' || (p.t === 'section' && p.panel === panel);
    case 'columns': return c?.creates === 'field' || (p.t === 'field' && p.entity === panelEntity) || (p.t === 'column' && p.panel === panel);
    case 'search': return c?.creates === 'field' || (p.t === 'field' && p.entity === panelEntity) || (p.t === 'search' && p.panel === panel) || (p.t === 'column' && p.panel === panel);
    case 'actions': return c?.creates === 'action' || (p.t === 'action' && p.panel === panel);
  }
}

function fieldFor(doc: Doc, panel: Panel, p: Payload): { field: EntityField; created: boolean } | string {
  const en = entityNameOf(doc.display, panel);
  const entity = en ? doc.entities[en] : null;
  if (!entity) return 'This part of the display has no entity yet.';
  if (p.t === 'control') {
    const c = CONTROL[p.id];
    if (c?.creates !== 'field') return `${c?.label ?? p.id} cannot go here.`;
    const f = newField(entity, c);
    entity.fields.push(f);
    return { field: f, created: true };
  }
  const name = 'field' in p ? p.field : null;
  const f = entity.fields.find((x) => x.name === name);
  return f ? { field: f, created: false } : `Field ${name} is not in ${entity.name}.`;
}

export function drop(doc: Doc, p: Payload, t: Target): Selection | string {
  const d = doc.display;
  const panel = t.panel;

  if (t.t === 'items') {
    const en = entryOf(d, panel);
    const sec = en?.sections.find((s) => s.id === t.section);
    if (!en || !sec) return 'No such section.';
    if (p.t === 'item') {
      const from = en.sections.find((s) => s.id === p.section);
      const i = from?.items.findIndex((x) => x.field === p.field) ?? -1;
      if (!from || i < 0) return 'Nothing to move.';
      if (from === sec) { move(sec.items, i, t.index); }
      else { const [it] = from.items.splice(i, 1); sec.items.splice(Math.min(t.index, sec.items.length), 0, it); }
      return { kind: 'item', panel, section: sec.id, field: p.field };
    }
    const got = fieldFor(doc, panel, p);
    if (typeof got === 'string') return got;
    for (const s of en.sections) if (s.items.some((x) => x.field === got.field.name)) return `${got.field.label} is already on the form (${s.title || s.id}).`;
    const ctl = p.t === 'control' ? CONTROL[p.id] : null;
    const item: { field: string; span?: number; widget?: any } = { field: got.field.name };
    if (got.field.dataType === 'text') item.span = Math.min(2, en.columns || 2);
    if (ctl?.field?.widget && !['input', 'select', 'checkbox', 'textarea'].includes(ctl.field.widget)) item.widget = ctl.field.widget;
    sec.items.splice(Math.min(t.index, sec.items.length), 0, item);
    return { kind: 'item', panel, section: sec.id, field: got.field.name };
  }

  if (t.t === 'sections') {
    const en = entryOf(d, panel);
    if (!en) return 'No form here.';
    if (p.t === 'section') {
      const i = en.sections.findIndex((s) => s.id === p.section);
      move(en.sections, i, t.index);
      return { kind: 'section', panel, section: p.section };
    }
    const c = p.t === 'control' ? CONTROL[p.id] : null;
    if (c?.creates !== 'section') return 'Drop panels, groups, tabs and labels between sections.';
    const s = newSection(en, c);
    en.sections.splice(Math.min(t.index, en.sections.length), 0, s);
    return { kind: 'section', panel, section: s.id };
  }

  if (t.t === 'columns') {
    const sm = summaryOf(d, panel);
    if (!sm) return 'No grid here.';
    if (p.t === 'column') { move(sm.columns, sm.columns.findIndex((c) => c.field === p.field), t.index); return { kind: 'column', panel, field: p.field }; }
    const got = fieldFor(doc, panel, p);
    if (typeof got === 'string') return got;
    if (sm.columns.some((c) => c.field === got.field.name)) return `${got.field.label} is already a column.`;
    const col: Column = { field: got.field.name, width: ['integer', 'decimal', 'currency'].includes(got.field.dataType) ? 130 : 150 };
    sm.columns.splice(Math.min(t.index, sm.columns.length), 0, col);
    return { kind: 'column', panel, field: got.field.name };
  }

  if (t.t === 'search') {
    const sm = summaryOf(d, panel);
    if (!sm) return 'No grid here.';
    sm.searchFields = sm.searchFields || [];
    if (p.t === 'search') { move(sm.searchFields, sm.searchFields.findIndex((c) => c.field === p.field), t.index); return { kind: 'search', panel, field: p.field }; }
    const got = p.t === 'column' ? fieldFor(doc, panel, { t: 'field', entity: entityNameOf(d, panel) || '', field: p.field }) : fieldFor(doc, panel, p);
    if (typeof got === 'string') return got;
    if (sm.searchFields.some((c) => c.field === got.field.name)) return `${got.field.label} is already a search field.`;
    const sf: SearchField = { field: got.field.name };
    if (['date', 'datetime'].includes(got.field.dataType)) sf.operator = 'between';
    else if (['string', 'text'].includes(got.field.dataType)) sf.operator = 'contains';
    sm.searchFields.splice(Math.min(t.index, sm.searchFields.length), 0, sf);
    return { kind: 'search', panel, field: got.field.name };
  }

  // actions
  const list = actionsOf(d, panel, t.list);
  if (!list) return 'No action bar here.';
  if (p.t === 'action') {
    if (p.list !== t.list) return 'Actions move within their own bar.';
    move(list, list.findIndex((a) => a.id === p.id), t.index);
    return { kind: 'action', panel, list: t.list, id: p.id };
  }
  const c = p.t === 'control' ? CONTROL[p.id] : null;
  if (c?.creates !== 'action') return 'Only actions go in an action bar.';
  const allowed: Record<string, string[]> = {
    actions: ['save', 'delete', 'copy', 'audit', 'reset', 'cancel', 'custom'],
    toolbarActions: ['new', 'open', 'delete', 'refresh', 'custom'],
    rowActions: ['open', 'delete', 'custom'],
  };
  if (!allowed[t.list].includes(c.action!.kind)) return `${c.label} is not available in this bar (${allowed[t.list].join(', ')}).`;
  if (c.action!.kind !== 'custom' && list.some((a) => a.kind === c.action!.kind)) return `${c.label} is already there.`;
  const a: Action = newAction(list, c.action!.kind, c.action!.label);
  if (a.kind === 'custom') {
    a.id = uniqueName('custom-action', list.map((x) => x.id));
    a.path = a.id;
    // a generated API needs a route for it: POST {endpoint}/:id/<path>, implemented in the developer hooks
    const ent = doc.entities[entityNameOf(d, panel) || ''];
    if (ent && ent.backend?.generate !== false) {
      ent.backend = ent.backend || {};
      ent.backend.customActions = [...new Set([...(ent.backend.customActions || []), a.path])];
    }
  }
  list.splice(Math.min(t.index, list.length), 0, a);
  return { kind: 'action', panel, list: t.list, id: a.id };
}

/** Delete the selected thing from the layout. Returns the next selection. */
export function removeSelected(doc: Doc, sel: Selection): Selection | string {
  const d = doc.display;
  switch (sel.kind) {
    case 'item': {
      const s = entryOf(d, sel.panel)?.sections.find((x) => x.id === sel.section);
      if (!s) return 'Nothing selected.';
      s.items = s.items.filter((i) => i.field !== sel.field);
      return { kind: 'section', panel: sel.panel, section: s.id };
    }
    case 'section': {
      const en = entryOf(d, sel.panel);
      if (!en) return 'Nothing selected.';
      if (en.sections.length <= 1) return 'A form needs at least one section.';
      const i = en.sections.findIndex((s) => s.id === sel.section);
      const [gone] = en.sections.splice(i, 1);
      // its fields move to the neighbouring section rather than disappearing
      en.sections[Math.max(0, i - 1)].items.push(...gone.items);
      return { kind: 'section', panel: sel.panel, section: en.sections[Math.max(0, i - 1)].id };
    }
    case 'column': {
      const sm = summaryOf(d, sel.panel);
      if (!sm) return 'Nothing selected.';
      if (sm.columns.length <= 1) return 'A grid needs at least one column.';
      sm.columns = sm.columns.filter((c) => c.field !== sel.field);
      return { kind: 'grid', panel: sel.panel };
    }
    case 'search': {
      const sm = summaryOf(d, sel.panel);
      if (!sm) return 'Nothing selected.';
      sm.searchFields = (sm.searchFields || []).filter((c) => c.field !== sel.field);
      return { kind: 'grid', panel: sel.panel };
    }
    case 'action': {
      const list = actionsOf(d, sel.panel, sel.list);
      if (!list) return 'Nothing selected.';
      list.splice(list.findIndex((a) => a.id === sel.id), 1);
      return { kind: sel.list === 'actions' ? 'display' : 'grid', panel: sel.panel } as Selection;
    }
    default:
      return 'Select a field, section, column or action to remove it.';
  }
}

/** Duplicate the selected thing. A duplicated form field becomes a new entity field (name2) with the same settings. */
export function duplicateSelected(doc: Doc, sel: Selection): Selection | string {
  const d = doc.display;
  if (sel.kind === 'section') {
    const en = entryOf(d, sel.panel);
    const i = en?.sections.findIndex((s) => s.id === sel.section) ?? -1;
    if (!en || i < 0) return 'Nothing selected.';
    const copy = structuredClone(en.sections[i]);
    copy.id = uniqueName(copy.id, en.sections.map((s) => s.id));
    copy.title = (copy.title || 'Section') + ' (copy)';
    copy.items = [];
    en.sections.splice(i + 1, 0, copy);
    return { kind: 'section', panel: sel.panel, section: copy.id };
  }
  if (sel.kind === 'item' || sel.kind === 'column') {
    const en = entityNameOf(d, sel.panel);
    const entity = en ? doc.entities[en] : null;
    const f = entity?.fields.find((x) => x.name === sel.field);
    if (!entity || !f) return 'Nothing selected.';
    const nf = structuredClone(f);
    nf.name = uniqueName(f.name, entity.fields.map((x) => x.name).concat('id'));
    nf.label = f.label + ' (copy)';
    nf.unique = false;
    entity.fields.splice(entity.fields.indexOf(f) + 1, 0, nf);
    if (sel.kind === 'item') {
      const s = entryOf(d, sel.panel)!.sections.find((x) => x.id === sel.section)!;
      const idx = s.items.findIndex((x) => x.field === sel.field);
      s.items.splice(idx + 1, 0, { ...structuredClone(s.items[idx]), field: nf.name });
      return { kind: 'item', panel: sel.panel, section: s.id, field: nf.name };
    }
    const sm = summaryOf(d, sel.panel)!;
    const idx = sm.columns.findIndex((c) => c.field === sel.field);
    sm.columns.splice(idx + 1, 0, { ...structuredClone(sm.columns[idx]), field: nf.name, label: null });
    return { kind: 'column', panel: sel.panel, field: nf.name };
  }
  if (sel.kind === 'action') {
    const list = actionsOf(d, sel.panel, sel.list);
    const a = list?.find((x) => x.id === sel.id);
    if (!list || !a) return 'Nothing selected.';
    if (a.kind !== 'custom') return 'Only custom actions can be duplicated.';
    const c = { ...structuredClone(a), id: uniqueName(a.id, list.map((x) => x.id)), label: (a.label || 'Action') + ' (copy)' };
    list.splice(list.indexOf(a) + 1, 0, c);
    return { kind: 'action', panel: sel.panel, list: sel.list, id: c.id };
  }
  return 'Select a section, field, column or custom action to duplicate it.';
}

/** Move the selected thing one step earlier (-1) or later (+1). */
export function nudgeSelected(doc: Doc, sel: Selection, dir: -1 | 1): Selection | string {
  const d = doc.display;
  const step = <T,>(arr: T[], i: number) => { if (i < 0) return; const j = i + dir; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
  if (sel.kind === 'item') {
    const en = entryOf(d, sel.panel)!;
    const si = en.sections.findIndex((s) => s.id === sel.section);
    const s = en.sections[si];
    const i = s.items.findIndex((x) => x.field === sel.field);
    // at the edge of a section the field hops into the neighbouring one
    if ((dir < 0 && i === 0 && si > 0) || (dir > 0 && i === s.items.length - 1 && si < en.sections.length - 1)) {
      const [it] = s.items.splice(i, 1);
      const to = en.sections[si + dir];
      if (dir < 0) to.items.push(it); else to.items.unshift(it);
      return { ...sel, section: to.id };
    }
    step(s.items, i);
    return sel;
  }
  if (sel.kind === 'section') { const en = entryOf(d, sel.panel)!; step(en.sections, en.sections.findIndex((s) => s.id === sel.section)); return sel; }
  if (sel.kind === 'column') { const sm = summaryOf(d, sel.panel)!; step(sm.columns, sm.columns.findIndex((c) => c.field === sel.field)); return sel; }
  if (sel.kind === 'search') { const sm = summaryOf(d, sel.panel)!; step(sm.searchFields!, sm.searchFields!.findIndex((c) => c.field === sel.field)); return sel; }
  if (sel.kind === 'action') { const l = actionsOf(d, sel.panel, sel.list)!; step(l, l.findIndex((a) => a.id === sel.id)); return sel; }
  return sel;
}
