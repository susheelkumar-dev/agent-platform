/** Left rail: the control toolbox, the field library, the outline of the display and the menu. */
import { useMemo, useState } from 'react';
import { CONTROLS, type Control, type ControlGroup } from '../catalog';
import { MenuTree, useMenuTree } from '../inspector/MenuInspector';
import { actionsOf, entityNameOf, entryOf, PANEL_LABEL, panelsOf, summaryOf } from '../layout';
import { drop, endDrag, startDrag, type Payload, type Target } from '../ops';
import { useStore } from '../store';
import type { Panel } from '../types';
import { Icon } from '../ui/Icon';

type Tab = 'controls' | 'fields' | 'outline' | 'menu';

export function LeftRail() {
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem('uiforge.rail') as Tab) || 'controls'; } catch { return 'controls'; } });
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem('uiforge.rail', t); } catch { /* ignore */ } };
  return (
    <aside className="rail" aria-label="Builder tools">
      <nav className="rail-tabs" role="tablist">
        {([['controls', 'Controls', 'sparkle'], ['fields', 'Fields', 'db'], ['outline', 'Outline', 'layers'], ['menu', 'Menu', 'menu']] as const).map(([k, l, i]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pick(k)}><Icon name={i} size={15} /><span>{l}</span></button>
        ))}
      </nav>
      <div className="rail-body">
        {tab === 'controls' && <Toolbox />}
        {tab === 'fields' && <FieldLibrary />}
        {tab === 'outline' && <Outline />}
        {tab === 'menu' && <MenuPanel />}
      </div>
    </aside>
  );
}

/** Where a clicked (not dragged) control goes: next to the selection, else the first fitting place. */
function targetFor(s: ReturnType<typeof useStore>, p: Payload): Target | null {
  const d = s.doc!.display;
  const sel = s.selection;
  const panels = panelsOf(d);
  const selPanel: Panel | null = 'panel' in sel ? sel.panel : null;
  const c = p.t === 'control' ? CONTROLS.find((x) => x.id === p.id) : null;
  const creates = c?.creates ?? (p.t === 'field' ? 'field' : null);
  const entryPanel = selPanel && entryOf(d, selPanel) ? selPanel : panels.find((x) => entryOf(d, x));
  const gridPanel = selPanel && summaryOf(d, selPanel) ? selPanel : panels.find((x) => summaryOf(d, x));
  if (creates === 'field') {
    if (p.t === 'field') {
      const fitting = panels.filter((x) => entityNameOf(d, x) === p.entity);
      const pref = selPanel && fitting.includes(selPanel) ? selPanel : fitting[0];
      if (!pref) return null;
      return fieldTarget(d, pref, sel);
    }
    const pref = selPanel ?? entryPanel ?? gridPanel;
    return pref ? fieldTarget(d, pref, sel) : null;
  }
  if (creates === 'section' && entryPanel) {
    const en = entryOf(d, entryPanel)!;
    const i = sel.kind === 'section' || sel.kind === 'item' ? en.sections.findIndex((x) => x.id === sel.section) + 1 : en.sections.length;
    return { t: 'sections', panel: entryPanel, index: i };
  }
  if (creates === 'action') {
    if (sel.kind === 'action') return { t: 'actions', panel: sel.panel, list: sel.list, index: (actionsOf(structuredClone(d), sel.panel, sel.list) || []).length };
    const kind = c!.action!.kind;
    const formKinds = ['save', 'delete', 'copy', 'audit', 'reset', 'cancel', 'custom'];
    if (entryPanel && formKinds.includes(kind) && (!selPanel || entryOf(d, selPanel))) return { t: 'actions', panel: entryPanel, list: 'actions', index: 99 };
    if (gridPanel) return { t: 'actions', panel: gridPanel, list: 'toolbarActions', index: 99 };
    if (entryPanel) return { t: 'actions', panel: entryPanel, list: 'actions', index: 99 };
  }
  return null;
}

function fieldTarget(d: ReturnType<typeof useStore>['doc'] extends infer X ? X extends { display: infer D } ? D : never : never, panel: Panel, sel: ReturnType<typeof useStore>['selection']): Target | null {
  const en = entryOf(d as any, panel);
  if (en) {
    if ((sel.kind === 'item' || sel.kind === 'section') && sel.panel === panel) {
      const sec = en.sections.find((x) => x.id === sel.section)!;
      const i = sel.kind === 'item' ? sec.items.findIndex((x) => x.field === sel.field) + 1 : sec.items.length;
      return { t: 'items', panel, section: sec.id, index: i };
    }
    const last = en.sections[en.sections.length - 1];
    return { t: 'items', panel, section: last.id, index: last.items.length };
  }
  const sm = summaryOf(d as any, panel);
  if (sm) {
    if (sel.kind === 'search' && sel.panel === panel) return { t: 'search', panel, index: (sm.searchFields || []).length };
    const i = sel.kind === 'column' && sel.panel === panel ? sm.columns.findIndex((c) => c.field === sel.field) + 1 : sm.columns.length;
    return { t: 'columns', panel, index: i };
  }
  return null;
}

function useAdd() {
  const s = useStore();
  return (p: Payload) => {
    const t = targetFor(s, p);
    if (!t) { s.notify('Select where it should go on the canvas first.', 'warning'); return; }
    let msg: string | null = null;
    s.edit((doc) => { const r = drop(doc, p, t); if (typeof r === 'string') msg = r; else s.select(r); });
    if (msg) s.notify(msg, 'warning');
  };
}

function Toolbox() {
  const [q, setQ] = useState('');
  const add = useAdd();
  const groups = useMemo(() => {
    const m = new Map<ControlGroup, Control[]>();
    for (const c of CONTROLS) {
      if (q && !(c.label + ' ' + c.hint).toLowerCase().includes(q.toLowerCase())) continue;
      if (!m.has(c.group)) m.set(c.group, []);
      m.get(c.group)!.push(c);
    }
    return [...m.entries()];
  }, [q]);
  return (
    <div className="toolbox">
      <div className="rail-search"><Icon name="search" size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a control" aria-label="Find a control" /></div>
      {groups.map(([g, list]) => (
        <div key={g} className="tb-group">
          <h4>{g}</h4>
          <div className="tb-grid">
            {list.map((c) => c.creates === 'grid-feature' ? (
              <div key={c.id} className="tb-item feature" title={c.hint}><Icon name={c.icon} size={16} /><span>{c.label}</span></div>
            ) : (
              <button key={c.id} type="button" className="tb-item" draggable title={`${c.hint} — drag onto the canvas, or click to add next to the selection`}
                onDragStart={(e) => startDrag(e, { t: 'control', id: c.id })} onDragEnd={endDrag} onClick={() => add({ t: 'control', id: c.id })}>
                <Icon name={c.icon} size={16} /><span>{c.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="note"><Icon name="info" size={12} /> Grid features are switched on in the grid's properties (click the grid header).</p>
    </div>
  );
}

function FieldLibrary() {
  const s = useStore();
  const add = useAdd();
  const d = s.doc!.display;
  const panels = panelsOf(d);
  return (
    <div className="fieldlib">
      {Object.values(s.doc!.entities).map((e) => {
        const placed = new Set<string>();
        for (const p of panels) {
          if (entityNameOf(d, p) !== e.name) continue;
          entryOf(d, p)?.sections.forEach((sec) => sec.items.forEach((i) => placed.add(i.field)));
          summaryOf(d, p)?.columns.forEach((c) => placed.add(c.field));
        }
        return (
          <div key={e.name} className="fl-ent">
            <button type="button" className="fl-head" onClick={() => s.select({ kind: 'entity', entity: e.name })}>
              <Icon name="db" size={13} /><b>{e.label}</b><span className="mono muted">{e.endpoint}</span>
            </button>
            {e.fields.map((f) => (
              <button key={f.name} type="button" className={'fl-f' + (placed.has(f.name) ? ' placed' : '')} draggable
                onDragStart={(ev) => startDrag(ev, { t: 'field', entity: e.name, field: f.name })} onDragEnd={endDrag}
                onClick={() => s.select({ kind: 'field', entity: e.name, field: f.name })} onDoubleClick={() => add({ t: 'field', entity: e.name, field: f.name })}
                title={placed.has(f.name) ? 'On the canvas. Drag to place it elsewhere (grid / search).' : 'Not placed yet — drag it onto the form or grid, or double-click'}>
                <Icon name="drag" size={12} className="grip" />
                <span>{f.label}</span>
                <span className="mono muted">{f.dataType}{f.multiple ? '[]' : ''}</span>
                {f.required && <span className="req">*</span>}
                {!placed.has(f.name) && <span className="dot" aria-label="not placed" />}
              </button>
            ))}
            <button type="button" className="fl-add" onClick={() => {
              const name = 'newField' + (e.fields.length + 1);
              s.edit((doc) => { doc.entities[e.name].fields.push({ name, label: 'New field', dataType: 'string', maxLength: 80 }); }, { select: { kind: 'field', entity: e.name, field: name } });
            }}><Icon name="plus" size={12} /> Add a field (data only)</button>
          </div>
        );
      })}
    </div>
  );
}

function Outline() {
  const s = useStore();
  const d = s.doc!.display;
  const sel = s.selection;
  const is = (x: object) => JSON.stringify(x) === JSON.stringify(sel);
  const row = (label: React.ReactNode, target: any, icon: string, depth: number, key: string) => (
    <button key={key} type="button" className={'ol-row' + (is(target) ? ' on' : '')} style={{ paddingLeft: 6 + depth * 12 }} onClick={() => s.select(target)}>
      <Icon name={icon} size={12} /><span>{label}</span>
    </button>
  );
  const out: JSX.Element[] = [row(d.title, { kind: 'display' }, 'file', 0, 'd'), row('Menu & permissions', { kind: 'menu' }, 'menu', 1, 'm')];
  for (const p of panelsOf(d)) {
    out.push(<div key={'h' + p} className="ol-head">{PANEL_LABEL[p]}</div>);
    const en = entryOf(d, p);
    if (en) {
      en.sections.forEach((sec) => {
        out.push(row(sec.title || `(${sec.kind || 'panel'})`, { kind: 'section', panel: p, section: sec.id }, sec.kind === 'tab' ? 'tabs' : 'panel', 1, p + sec.id));
        sec.items.forEach((it) => out.push(row(it.label || it.field, { kind: 'item', panel: p, section: sec.id, field: it.field }, 'input', 2, p + sec.id + it.field)));
      });
      (en.actions || []).forEach((a) => out.push(row(`${a.label || a.kind} (action)`, { kind: 'action', panel: p, list: 'actions', id: a.id }, 'bolt', 1, p + 'a' + a.id)));
    }
    const sm = summaryOf(d, p);
    if (sm) {
      out.push(row('Grid settings', { kind: 'grid', panel: p }, 'grid', 1, p + 'g'));
      (sm.searchFields || []).forEach((x) => out.push(row(`${x.label || x.field} (search)`, { kind: 'search', panel: p, field: x.field }, 'search', 2, p + 's' + x.field)));
      sm.columns.forEach((c) => out.push(row(c.label || c.field, { kind: 'column', panel: p, field: c.field }, 'row', 2, p + 'c' + c.field)));
      (sm.toolbarActions || []).forEach((a) => out.push(row(`${a.label || a.kind} (toolbar)`, { kind: 'action', panel: p, list: 'toolbarActions', id: a.id }, 'bolt', 2, p + 't' + a.id)));
      (sm.rowActions || []).forEach((a) => out.push(row(`${a.label || a.kind} (row menu)`, { kind: 'action', panel: p, list: 'rowActions', id: a.id }, 'bolt', 2, p + 'r' + a.id)));
    }
  }
  return <div className="outline">{out}</div>;
}

function MenuPanel() {
  const s = useStore();
  const nodes = useMenuTree();
  return (
    <div className="menupanel">
      <p className="note">The application menu with this display in it (orange). Click to edit where it goes.</p>
      <MenuTree nodes={nodes} compact />
      <button type="button" className="fl-add" onClick={() => s.select({ kind: 'menu' })}><Icon name="pencil" size={12} /> Edit menu entry</button>
    </div>
  );
}
