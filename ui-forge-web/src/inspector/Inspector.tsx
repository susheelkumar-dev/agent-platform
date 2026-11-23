/** Properties of whatever is selected on the canvas. */
import { useState } from 'react';
import { ACTION_KINDS_FOR, DATA_TYPES, WIDGETS_FOR, defaultWidget } from '../catalog';
import { defaultActionLabel } from '../canvas/ActionBar';
import { actionsOf, entityNameOf, entryOf, PANEL_LABEL, renameField, summaryOf, usesOfField } from '../layout';
import { duplicateSelected, nudgeSelected, removeSelected } from '../ops';
import { useStore, type Store } from '../store';
import type { Action, Column, Entity, EntityField, FormItem, Panel, SearchField, Section } from '../types';
import { Btn, ChipList, Confirm, Group, Num, Row, Segmented, Select, Text, Toggle } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { assign, DOTTED, ENDPOINT, IDENT, MODULE, PASCAL, patcher, permissionSuggestions, ROUTE } from './common';
import { MenuInspector } from './MenuInspector';

export function Inspector() {
  const s = useStore();
  const sel = s.selection;
  const d = s.doc!.display;
  const run = (f: typeof removeSelected) => {
    let msg: string | null = null;
    s.edit((doc) => { const r = f(doc, sel); if (typeof r === 'string') msg = r; else s.select(r); });
    if (msg) s.notify(msg, 'warning');
  };
  const crumbs: string[] = [d.title];
  if ('panel' in sel) crumbs.push(PANEL_LABEL[sel.panel]);
  const kindLabel: Record<string, string> = { display: 'Display', menu: 'Menu & permissions', section: 'Section', item: 'Form field', column: 'Grid column', search: 'Search field', action: 'Action', grid: 'Grid', field: 'Entity field', entity: 'Entity' };
  const canMove = ['item', 'section', 'column', 'search', 'action'].includes(sel.kind);
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="insp-head">
        <div className="crumbs">{crumbs.map((c, i) => <span key={i}>{c}</span>)}</div>
        <h3><Icon name={sel.kind === 'menu' ? 'menu' : sel.kind === 'action' ? 'bolt' : sel.kind === 'column' || sel.kind === 'grid' ? 'grid' : 'settings'} size={15} /> {kindLabel[sel.kind]}</h3>
        {canMove && (
          <div className="insp-tools">
            <Btn small kind="ghost" icon="up" title="Move earlier (Alt+↑)" onClick={() => run((doc, x) => nudgeSelected(doc, x, -1))} />
            <Btn small kind="ghost" icon="down" title="Move later (Alt+↓)" onClick={() => run((doc, x) => nudgeSelected(doc, x, 1))} />
            <Btn small kind="ghost" icon="dup" title="Duplicate (Ctrl+D)" onClick={() => run(duplicateSelected)} />
            <Btn small kind="ghost" icon="trash" title="Remove from the layout (Delete)" onClick={() => run(removeSelected)} />
          </div>
        )}
      </div>
      <div className="insp-body">
        {sel.kind === 'display' && <DisplayProps />}
        {sel.kind === 'menu' && <MenuInspector />}
        {sel.kind === 'section' && <SectionProps panel={sel.panel} id={sel.section} />}
        {sel.kind === 'item' && <ItemProps panel={sel.panel} section={sel.section} field={sel.field} />}
        {sel.kind === 'column' && <ColumnProps panel={sel.panel} field={sel.field} />}
        {sel.kind === 'search' && <SearchProps panel={sel.panel} field={sel.field} />}
        {sel.kind === 'action' && <ActionProps panel={sel.panel} list={sel.list} id={sel.id} />}
        {sel.kind === 'grid' && <GridProps panel={sel.panel} />}
        {sel.kind === 'field' && <FieldProps entity={sel.entity} field={sel.field} />}
        {sel.kind === 'entity' && <EntityProps name={sel.entity} />}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ display
function DisplayProps() {
  const s = useStore();
  const d = s.doc!.display;
  const set = patcher(s, (doc) => doc.display);
  const meta = s.preview?.metas?.[d.id];
  const others = Object.values(s.saved.displays).filter((x) => x.id !== d.id);
  const perms = permissionSuggestions(s);
  return (
    <>
      <Group title="Identity">
        <Row label="Title" hint="Tab and window title"><Text value={d.title} onChange={(v) => set({ title: v })} validate={(v) => (v.trim() ? null : 'required')} /></Row>
        <Row label="Display id" hint="Registry id; menus and links use it"><Text mono value={d.id} onChange={(v) => s.edit((doc) => { doc.display.id = v; if (doc.display.menu && doc.display.menu.id === d.id) doc.display.menu.id = v; })} validate={DOTTED} /></Row>
        <Row label="Component" hint="PascalCase implementation key registered in the app"><Text mono value={d.name} onChange={(v) => set({ name: v })} validate={PASCAL} /></Row>
        <Row label="Module" hint="Folder under src/modules/"><Text mono value={d.module} onChange={(v) => set({ module: v })} validate={MODULE} /></Row>
        <Row label="Route" hint="Hash route (#/…)"><Text mono value={d.route} onChange={(v) => set({ route: v })} validate={ROUTE} placeholder={`d/${d.id}`} /></Row>
        <Row label="Opens as"><Segmented value={d.openMode || 'tab'} onChange={(v) => set({ openMode: v })} options={[{ value: 'tab', label: 'Tab' }, { value: 'window', label: 'Window' }, { value: 'page', label: 'Page' }]} /></Row>
        <Row label="Icon"><Text value={d.icon} onChange={(v) => set({ icon: v })} placeholder="e.g. bolt" /></Row>
        <Row label="Description" wide><Text multiline value={d.description} onChange={(v) => set({ description: v })} placeholder="What this display is for (goes into the generated docs)" /></Row>
      </Group>
      {d.type === 'entry' && d.entry && (
        <Group title="Form">
          <Row label="Columns"><Num value={d.entry.columns ?? 2} min={1} max={4} allowEmpty={false} onChange={(v) => s.edit((doc) => { doc.display.entry!.columns = v ?? 2; })} /></Row>
          <Row label="After Close" hint="Display opened when the form closes"><Select value={d.entry.summaryDisplay || ''} onChange={(v) => s.edit((doc) => assign(doc.display.entry!, { summaryDisplay: v || null }))}
            options={[{ value: '', label: '— none —' }, ...others.filter((x) => x.type === 'summary').map((x) => ({ value: x.id, label: x.title }))]} /></Row>
          <Row label="Copy skips" hint="Fields cleared when a record is copied"><ChipList value={d.entry.copyExclude || []} onChange={(v) => s.edit((doc) => assign(doc.display.entry!, { copyExclude: v.length ? v.map(String) : undefined }))} suggestions={(s.doc!.entities[d.entity || '']?.fields || []).map((f) => f.name)} /></Row>
        </Group>
      )}
      <Group title="Permissions">
        <Row label="To open" hint="All of these are needed to see the menu entry and open the display. Empty: the entity's view permission.">
          <ChipList value={d.permissions?.required || []} suggestions={perms} placeholder={meta?.requiredPermissions?.join(', ') || 'entity default'}
            onChange={(v) => s.edit((doc) => { doc.display.permissions = { ...(doc.display.permissions || {}), required: v.map(String) }; })} />
        </Row>
        <PermissionTable />
      </Group>
      <Group title="Generate" defaultOpen={false}>
        <Row label="Frontend"><Toggle value={d.generator?.frontend ?? true} onChange={(v) => s.edit((doc) => { doc.display.generator = { ...(doc.display.generator || {}), frontend: v }; })} label="Types, service, config, component" /></Row>
        <Row label="Backend"><Toggle value={d.generator?.backend ?? true} onChange={(v) => s.edit((doc) => { doc.display.generator = { ...(doc.display.generator || {}), backend: v }; })} label="Routes for entities with backend.generate" /></Row>
        <Row label="Tests"><Toggle value={d.generator?.tests ?? true} onChange={(v) => s.edit((doc) => { doc.display.generator = { ...(doc.display.generator || {}), tests: v }; })} label="Generated API self-test" /></Row>
      </Group>
      <EntityLinks />
    </>
  );
}

/** action key -> permission, with the entity defaults shown. */
function PermissionTable() {
  const s = useStore();
  const d = s.doc!.display;
  const meta = s.preview?.metas?.[d.id];
  const effective: Record<string, string> = meta?.actionPermissions || {};
  const own = d.permissions?.actions || {};
  const customKeys = new Set<string>();
  for (const p of ['entry', 'summary', 'master', 'detail', 'detailList'] as Panel[])
    for (const l of ['actions', 'toolbarActions', 'rowActions'] as const)
      (actionsOf(structuredClone(d), p, l) || []).forEach((a) => { if (a.permission) customKeys.add(a.permission); });
  const keys = [...new Set([...Object.keys(effective), ...Object.keys(own), ...customKeys])];
  const perms = permissionSuggestions(s);
  const setKey = (k: string, v: string) => s.edit((doc) => {
    const a = { ...(doc.display.permissions?.actions || {}) };
    if (v) a[k] = v; else delete a[k];
    doc.display.permissions = { ...(doc.display.permissions || {}), actions: a };
  });
  return (
    <div className="ptable">
      <div className="ptable-h"><span>Action key</span><span>Needs permission</span></div>
      {keys.map((k) => (
        <div key={k} className="ptable-r">
          <span className="mono">{k}</span>
          <Text mono value={own[k] ?? ''} placeholder={effective[k] || (customKeys.has(k) ? 'anyone who can open' : '')} onChange={(v) => setKey(k, v)}
            validate={(v) => (!v || perms.includes(v) ? null : 'unknown permission (declare it on the entity)')} />
        </div>
      ))}
      <p className="note"><Icon name="shield" size={12} /> The UI hides what a user may not do. The API must check the same permission on every call{s.project?.backend === 'none' ? ' (listed in each entity’s API contract)' : ''}.</p>
    </div>
  );
}

function EntityLinks() {
  const s = useStore();
  const names = Object.keys(s.doc!.entities);
  return (
    <Group title="Entities (data model)">
      {names.map((n) => {
        const e = s.doc!.entities[n];
        return (
          <button key={n} type="button" className="ent-link" onClick={() => s.select({ kind: 'entity', entity: n })}>
            <Icon name="db" size={14} /><b>{e.label}</b><span className="mono muted">{e.endpoint}</span>
            <span className="muted">{e.fields.length} fields{s.project?.backend === 'none' ? ' · API contract' : e.backend?.generate === false ? ' · existing API' : ' · generated API'}</span>
          </button>
        );
      })}
    </Group>
  );
}

// ------------------------------------------------------------------ form parts
function SectionProps({ panel, id }: { panel: Panel; id: string }) {
  const s = useStore();
  const sec = entryOf(s.doc!.display, panel)?.sections.find((x) => x.id === id);
  if (!sec) return <Gone />;
  const set = patcher<Section>(s, (doc) => entryOf(doc.display, panel)?.sections.find((x) => x.id === id));
  return (
    <Group title="Section">
      <Row label="Title"><Text value={sec.title} onChange={(v) => set({ title: v })} /></Row>
      <Row label="Id"><Text mono value={sec.id} onChange={(v) => { set({ id: v }); s.select({ kind: 'section', panel, section: v }); }} validate={(v) => (/^[a-z][a-z0-9-]{0,63}$/.test(v) ? null : 'lower-case slug')} /></Row>
      <Row label="Kind"><Segmented value={sec.kind || 'panel'} onChange={(v) => set({ kind: v })} options={[{ value: 'panel', label: 'Panel' }, { value: 'fieldset', label: 'Group' }, { value: 'tab', label: 'Tab' }, { value: 'plain', label: 'Plain' }]} /></Row>
      <Row label="Columns" hint="Override the form's column count"><Num value={sec.columns} min={1} max={4} onChange={(v) => set({ columns: v })} placeholder="form default" /></Row>
      {(sec.kind || 'panel') !== 'tab' && <Row label="Collapsible"><Toggle value={sec.collapsible} onChange={(v) => set({ collapsible: v || null } as any)} /></Row>}
      {sec.collapsible && <Row label="Starts collapsed"><Toggle value={sec.collapsed} onChange={(v) => set({ collapsed: v || null } as any)} /></Row>}
      <Row label="Help text" wide><Text multiline value={sec.description} onChange={(v) => set({ description: v })} /></Row>
      <p className="note">{sec.items.length} field(s). Removing a section moves its fields to the section before it.</p>
    </Group>
  );
}

function ItemProps({ panel, section, field }: { panel: Panel; section: string; field: string }) {
  const s = useStore();
  const d = s.doc!.display;
  const en = entryOf(d, panel);
  const it = en?.sections.find((x) => x.id === section)?.items.find((x) => x.field === field);
  const entityName = entityNameOf(d, panel) || '';
  const f = s.doc!.entities[entityName]?.fields.find((x) => x.name === field);
  if (!it || !en) return <Gone />;
  const set = patcher<FormItem>(s, (doc) => entryOf(doc.display, panel)?.sections.find((x) => x.id === section)?.items.find((x) => x.field === field));
  const otherFields = (s.doc!.entities[entityName]?.fields || []).filter((x) => x.name !== field);
  const vw = it.visibleWhen;
  return (
    <>
      <Group title="On this form">
        <Row label="Width" hint="Columns this field spans (or drag its right edge)"><Segmented value={String(Math.min(it.span || 1, en.columns || 2))} onChange={(v) => set({ span: Number(v) === 1 ? null : Number(v) } as any)}
          options={Array.from({ length: en.columns || 2 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} /></Row>
        {f && <Row label="Widget"><Select value={it.widget || defaultWidget(f)} onChange={(v) => set({ widget: v === defaultWidget(f) ? null : v })} options={WIDGETS_FOR[f.dataType].filter((w) => w !== 'multiselect' || f.multiple)} /></Row>}
        <Row label="Label"><Text value={it.label} placeholder={f?.label} onChange={(v) => set({ label: v })} /></Row>
        <Row label="Placeholder"><Text value={it.placeholder} onChange={(v) => set({ placeholder: v })} /></Row>
        <Row label="Help"><Text value={it.help} onChange={(v) => set({ help: v })} placeholder="Shown under the field" /></Row>
        <Row label="Read-only"><Toggle value={it.readOnly} onChange={(v) => set({ readOnly: v || null })} /></Row>
        <Row label="Locked after create" hint="Editable on a new record only, e.g. a code"><Toggle value={it.readOnlyOnEdit} onChange={(v) => set({ readOnlyOnEdit: v || null })} /></Row>
        <Row label="Hidden" hint="Kept in the record but not shown"><Toggle value={it.hidden} onChange={(v) => set({ hidden: v || null })} /></Row>
        <Row label="Show only when" hint="Conditional visibility">
          <div className="pair">
            <Select value={vw?.field || ''} onChange={(v) => set({ visibleWhen: v ? { field: v, equals: vw?.equals?.length ? vw.equals : [true] } : null })}
              options={[{ value: '', label: 'always' }, ...otherFields.map((x) => ({ value: x.name, label: x.label }))]} />
            {vw && <ChipList value={vw.equals as (string | number)[]} onChange={(v) => set({ visibleWhen: { field: vw.field, equals: v.map((x) => (x === 'true' ? true : x === 'false' ? false : x)) as any } })} placeholder="equals…"
              suggestions={(otherFields.find((x) => x.name === vw.field)?.options || []).map(String).concat(['true', 'false'])} />}
          </div>
        </Row>
        <Row label="Validator" hint="Name of a function in the display's hooks file (validators.<name>)"><Text mono value={it.validator} onChange={(v) => set({ validator: v })} validate={(v) => (!v || /^[A-Za-z][A-Za-z0-9_]*$/.test(v) ? null : 'identifier')} placeholder="e.g. notInPast" /></Row>
      </Group>
      {f ? <FieldProps entity={entityName} field={field} embedded /> : <p className="note bad">The entity has no field '{field}'.</p>}
    </>
  );
}

// ------------------------------------------------------------------ grid parts
function ColumnProps({ panel, field }: { panel: Panel; field: string }) {
  const s = useStore();
  const d = s.doc!.display;
  const c = summaryOf(d, panel)?.columns.find((x) => x.field === field);
  const entityName = entityNameOf(d, panel) || '';
  const f = s.doc!.entities[entityName]?.fields.find((x) => x.name === field);
  if (!c) return <Gone />;
  const set = patcher<Column>(s, (doc) => summaryOf(doc.display, panel)?.columns.find((x) => x.field === field));
  const sorter = summaryOf(d, panel)?.sorters?.find((x) => x.field === field);
  const setSort = (dir: string) => s.edit((doc) => {
    const sm = summaryOf(doc.display, panel)!;
    sm.sorters = (sm.sorters || []).filter((x) => x.field !== field);
    if (dir) sm.sorters.unshift({ field, direction: dir as 'ASC' });
  });
  const tones = c.badgeTones || {};
  return (
    <>
      <Group title="Column">
        <Row label="Header"><Text value={c.label} placeholder={f?.label} onChange={(v) => set({ label: v })} /></Row>
        <Row label="Sizing"><Segmented value={c.flex ? 'flex' : 'fixed'} onChange={(v) => set(v === 'flex' ? { flex: 1, width: null } : { flex: null, width: c.width || 140 })} options={[{ value: 'fixed', label: 'Fixed' }, { value: 'flex', label: 'Fill' }]} /></Row>
        {c.flex ? <Row label="Flex"><Num value={c.flex} min={0.5} max={10} step={0.5} onChange={(v) => set({ flex: v })} /></Row>
          : <Row label="Width (px)"><Num value={c.width} min={40} max={1200} onChange={(v) => set({ width: v })} /></Row>}
        <Row label="Align"><Segmented value={c.align || 'auto'} onChange={(v) => set({ align: v === 'auto' ? null : (v as any) })} options={[{ value: 'auto', label: 'Auto' }, { value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} /></Row>
        <Row label="Default sort"><Segmented value={sorter?.direction || ''} onChange={setSort} options={[{ value: '', label: 'None' }, { value: 'ASC', label: 'Asc' }, { value: 'DESC', label: 'Desc' }]} /></Row>
        <Row label="Sortable"><Toggle value={c.sortable !== false} onChange={(v) => set({ sortable: v ? null : false } as any)} /></Row>
        <Row label="Filter"><Select value={c.filter === false ? 'off' : c.filter === true || c.filter === undefined ? 'auto' : c.filter} onChange={(v) => set({ filter: v === 'auto' ? null : v === 'off' ? false : (v as any) } as any)}
          options={[{ value: 'auto', label: 'Automatic' }, { value: 'text', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'date', label: 'Date' }, { value: 'list', label: 'List' }, { value: 'off', label: 'Off' }]} /></Row>
        <Row label="Hidden" hint="In the column chooser but not shown at first"><Toggle value={c.hidden} onChange={(v) => set({ hidden: v || null } as any)} /></Row>
        {f && ['decimal', 'currency', 'integer'].includes(f.dataType) && <Row label="Decimals"><Num value={c.decimals} min={0} max={10} onChange={(v) => set({ decimals: v })} placeholder={String(f.decimals ?? '')} /></Row>}
        <Row label="Renderer" hint="badge, or a name registered with registerRenderer()"><Text mono value={c.renderer} onChange={(v) => set({ renderer: v })} placeholder="auto" /></Row>
      </Group>
      {f?.dataType === 'enum' && (
        <Group title="Badge colours">
          {(f.options || []).map((o) => (
            <Row key={String(o)} label={String(o)}>
              <Select value={tones[String(o)] || ''} onChange={(v) => { const t = { ...tones }; if (v) t[String(o)] = v as any; else delete t[String(o)]; set({ badgeTones: Object.keys(t).length ? t : null }); }}
                options={[{ value: '', label: 'none' }, 'gray', 'blue', 'green', 'red', 'amber']} />
            </Row>
          ))}
        </Group>
      )}
      {f && <FieldProps entity={entityName} field={field} embedded />}
    </>
  );
}

function SearchProps({ panel, field }: { panel: Panel; field: string }) {
  const s = useStore();
  const d = s.doc!.display;
  const sf = summaryOf(d, panel)?.searchFields?.find((x) => x.field === field);
  const f = s.doc!.entities[entityNameOf(d, panel) || '']?.fields.find((x) => x.name === field);
  if (!sf) return <Gone />;
  const set = patcher<SearchField>(s, (doc) => summaryOf(doc.display, panel)?.searchFields?.find((x) => x.field === field));
  const ops = f && ['string', 'text'].includes(f.dataType) ? ['eq', 'contains'] : f && ['integer', 'decimal', 'currency', 'date', 'datetime'].includes(f.dataType) ? ['eq', 'gte', 'lte', 'between'] : f?.dataType === 'enum' || f?.dataType === 'lookup' ? ['eq', 'in'] : ['eq'];
  return (
    <Group title="Search field">
      <Row label="Label"><Text value={sf.label} placeholder={f?.label} onChange={(v) => set({ label: v })} /></Row>
      <Row label="Match"><Select value={sf.operator || 'eq'} onChange={(v) => set({ operator: v === 'eq' ? null : v } as any)} options={ops.map((o) => ({ value: o, label: { eq: 'equals', contains: 'contains', gte: 'from (≥)', lte: 'up to (≤)', between: 'from – to', in: 'any of' }[o] || o }))} /></Row>
      <Row label="Query param" hint={sf.operator === 'between' ? 'Sent as <param>From and <param>To' : 'Defaults to the field name'}><Text mono value={sf.param} onChange={(v) => set({ param: v })} placeholder={field} validate={(v) => (!v || /^[A-Za-z][A-Za-z0-9]*$/.test(v) ? null : 'identifier')} /></Row>
      <Row label="Required" hint="The grid loads only once this is filled"><Toggle value={sf.required} onChange={(v) => set({ required: v || null } as any)} /></Row>
      <Row label="Placeholder"><Text value={sf.placeholder} onChange={(v) => set({ placeholder: v })} /></Row>
      <p className="note"><Icon name="info" size={12} /> {summaryOf(d, panel)?.remote ? 'Server paging is on: the API filters by these parameters.' : 'Sent to the API as query parameters; a generated API filters on them.'}</p>
    </Group>
  );
}

function ActionProps({ panel, list, id }: { panel: Panel; list: 'actions' | 'toolbarActions' | 'rowActions'; id: string }) {
  const s = useStore();
  const d = s.doc!.display;
  const a = actionsOf(structuredClone(d), panel, list)?.find((x) => x.id === id);
  if (!a) return <Gone />;
  const set = patcher<Action>(s, (doc) => actionsOf(doc.display, panel, list)?.find((x) => x.id === id));
  const ent = s.doc!.entities[entityNameOf(d, panel) || ''];
  const DESC: Record<string, string> = {
    save: 'Creates (POST) or updates (PUT) the record; needs create / update.', delete: 'Deletes after confirmation; needs delete.', copy: 'Opens a new record prefilled from this one (id and "copy skips" cleared).',
    audit: 'Opens the history drawer: who changed what, from the audit trail.', reset: 'Puts back the last loaded values.', cancel: 'Closes, asking first when there are unsaved changes.',
    new: 'Opens the entry display (or the detail form) for a new record.', open: 'Opens the selected record.', refresh: 'Reloads the grid.', custom: 'Calls POST {endpoint}/{id}/{path}; implement it in the generated hooks file.',
  };
  const setPath = (v: string) => s.edit((doc) => {
    const act = actionsOf(doc.display, panel, list)?.find((x) => x.id === id);
    if (!act) return;
    const old = act.path;
    act.path = v || null;
    const e = doc.entities[entityNameOf(doc.display, panel) || ''];
    if (e && e.backend?.generate !== false) {
      const used = new Set<string>();
      for (const p of ['entry', 'summary', 'master', 'detail', 'detailList'] as Panel[])
        if (entityNameOf(doc.display, p) === e.name) for (const l of ['actions', 'toolbarActions', 'rowActions'] as const) (actionsOf(doc.display, p, l) || []).forEach((x) => { if (x.kind === 'custom' && x.path) used.add(x.path); });
      e.backend = e.backend || {};
      e.backend.customActions = [...new Set([...(e.backend.customActions || []).filter((x) => x !== old || used.has(x)), ...used])];
    }
  });
  return (
    <Group title={`${a.kind} action`}>
      <p className="note">{DESC[a.kind]}</p>
      <Row label="Label" hint="Text on the button. Empty: the default shown here"><Text value={a.label} onChange={(v) => set({ label: v })} placeholder={defaultActionLabel(a, ent?.label)} /></Row>
      <Row label="Id"><Text mono value={a.id} onChange={(v) => { set({ id: v }); s.select({ kind: 'action', panel, list, id: v }); }} validate={(v) => (/^[a-z][a-z0-9-]{0,63}$/.test(v) ? null : 'lower-case slug')} /></Row>
      <Row label="Style"><Segmented value={a.style || 'auto'} onChange={(v) => set({ style: v === 'auto' ? null : (v as any) })} options={[{ value: 'auto', label: 'Auto' }, { value: 'primary', label: 'Primary' }, { value: 'default', label: 'Plain' }, { value: 'danger', label: 'Danger' }]} /></Row>
      <Row label="Icon"><Text value={a.icon} onChange={(v) => set({ icon: v })} /></Row>
      {a.kind === 'custom' && <Row label="API path" hint="POST {endpoint}/{id}/<path>"><Text mono value={a.path} onChange={setPath} validate={(v) => (/^[a-z][a-z0-9-]{0,63}$/.test(v) ? null : 'lower-case slug')} /></Row>}
      {a.kind === 'custom' && ent && <p className="note mono">POST {ent.endpoint}/:id/{a.path}{s.project?.backend === 'none' || ent.backend?.generate === false ? ' (your API must provide it; listed in the API contract)' : ' (generated; returns 501 until the hook is written)'}</p>}
      <Row label="Permission key" hint="Key in the display's action permissions; the button shows only when the user has it">
        <Text mono value={a.permission} onChange={(v) => set({ permission: v })} placeholder={a.kind === 'save' ? 'create / update' : ['delete', 'new', 'copy'].includes(a.kind) ? (a.kind === 'delete' ? 'delete' : 'create') : 'none'} />
      </Row>
      {a.permission && !['create', 'update', 'delete', 'detail-create', 'detail-update', 'detail-delete'].includes(a.permission) && (
        <p className="note">Map <b className="mono">{a.permission}</b> to a permission under Display → Permissions, otherwise everyone who can open the display sees it.</p>
      )}
      {['delete', 'custom', 'reset'].includes(a.kind) && <Row label="Confirm text"><Text value={a.confirm} onChange={(v) => set({ confirm: v })} placeholder={a.kind === 'delete' ? 'Delete this record?' : 'no confirmation'} /></Row>}
      <p className="note muted">Available here: {ACTION_KINDS_FOR[list].join(', ')}</p>
    </Group>
  );
}

/** What the summary grid shows when the display says nothing (the framework's 'standard' grid preset). */
const GRID_DEFAULTS = { rowNumbers: true, grouping: false, summary: false, export: true, columnChooser: true } as const;

function GridProps({ panel }: { panel: Panel }) {
  const s = useStore();
  const d = s.doc!.display;
  const sm = summaryOf(d, panel);
  if (!sm) return d.masterSlave ? <MasterSlaveProps /> : <Gone />;
  const set = patcher(s, (doc) => summaryOf(doc.display, panel));
  const entries = Object.values(s.saved.displays).filter((x) => x.type === 'entry' && x.id !== d.id);
  return (
    <>
      <Group title="Data">
        <Row label="Server paging" hint="Page, sort and filter on the server (start/limit, total)"><Toggle value={sm.remote} onChange={(v) => set({ remote: v || null, pageSize: v ? sm.pageSize || 50 : null } as any)} /></Row>
        {sm.remote && <Row label="Page size"><Num value={sm.pageSize} min={5} max={1000} onChange={(v) => set({ pageSize: v })} /></Row>}
        <Row label="Load on open" hint="Off: wait for Search"><Toggle value={sm.autoLoad !== false} onChange={(v) => set({ autoLoad: v ? null : false } as any)} /></Row>
        <Row label="Selection"><Segmented value={sm.selection || 'single'} onChange={(v) => set({ selection: v === 'single' ? null : v } as any)} options={[{ value: 'single', label: 'Single' }, { value: 'multi', label: 'Multiple' }]} /></Row>
        <Row label="Checkbox column" hint="Off: select by clicking a row (Ctrl/Shift+click for several)"><Toggle value={sm.features?.checkboxes !== false} onChange={(v) => s.edit((doc) => { const t = summaryOf(doc.display, panel)!; const f = { ...(t.features || {}) }; if (v) delete f.checkboxes; else f.checkboxes = false; t.features = f; })} /></Row>
        <Row label="Empty text"><Text value={sm.emptyText} onChange={(v) => set({ emptyText: v })} placeholder="No records" /></Row>
        {panel === 'summary' && <Row label="Opens" hint="Entry display for New / Open"><Select value={sm.entryDisplay || ''} onChange={(v) => set({ entryDisplay: v || null })} options={[{ value: '', label: '— none —' }, ...entries.map((x) => ({ value: x.id, label: `${x.title} (${x.id})` }))]} /></Row>}
      </Group>
      <Group title="Grid features" defaultOpen={false}>
        {(['rowNumbers', 'grouping', 'summary', 'export', 'columnChooser'] as const).map((k) => (
          <Row key={k} label={{ rowNumbers: 'Row numbers', grouping: 'Grouping', summary: 'Totals row', export: 'Excel export', columnChooser: 'Column chooser' }[k]}>
            <Toggle value={(sm.features?.[k] ?? GRID_DEFAULTS[k]) !== false && !!(sm.features?.[k] ?? GRID_DEFAULTS[k])} onChange={(v) => s.edit((doc) => { const t = summaryOf(doc.display, panel)!; const f = { ...(t.features || {}) }; if (v === GRID_DEFAULTS[k]) delete f[k]; else f[k] = v; t.features = f; })} />
          </Row>
        ))}
      </Group>
      {d.masterSlave && <MasterSlaveProps />}
    </>
  );
}

function MasterSlaveProps() {
  const s = useStore();
  const ms = s.doc!.display.masterSlave!;
  const set = patcher(s, (doc) => doc.display.masterSlave);
  const detail = s.doc!.entities[ms.detail.entity];
  return (
    <Group title="Master-Slave">
      <Row label="Layout"><Segmented value={ms.orientation || 'horizontal'} onChange={(v) => set({ orientation: v })} options={[{ value: 'horizontal', label: 'Side by side' }, { value: 'vertical', label: 'Stacked' }]} /></Row>
      <Row label="Master size %"><Num value={ms.split ?? 45} min={20} max={80} allowEmpty={false} onChange={(v) => set({ split: v ?? 45 })} /></Row>
      <Row label="Stack below (px)" hint="Narrower screens stack the panes"><Num value={ms.stackBelow ?? 900} min={0} max={4000} onChange={(v) => set({ stackBelow: v ?? 900 })} /></Row>
      <Row label="Unsaved changes" hint="When the user picks another master row while the form has changes">
        <Segmented value={ms.unsavedChanges || 'confirm'} onChange={(v) => set({ unsavedChanges: v })} options={[{ value: 'confirm', label: 'Ask' }, { value: 'discard', label: 'Discard' }, { value: 'block', label: 'Block' }]} />
      </Row>
      <Row label="Relation"><span className="mono">{ms.detail.relation === 'child' ? `child: ${detail?.label} rows of the master` : 'same record'}</span></Row>
      {ms.detail.relation === 'child' && (
        <Row label="Link field" hint="Child field holding the master's id">
          <Select value={ms.detail.linkField || ''} onChange={(v) => s.edit((doc) => { doc.display.masterSlave!.detail.linkField = v || null; })}
            options={[{ value: '', label: '—' }, ...(detail?.fields || []).map((f) => ({ value: f.name, label: f.name }))]} />
        </Row>
      )}
    </Group>
  );
}

// ------------------------------------------------------------------ data model
export function FieldProps({ entity, field, embedded }: { entity: string; field: string; embedded?: boolean }) {
  const s = useStore();
  const [ask, setAsk] = useState<string[] | null>(null);
  const e = s.doc!.entities[entity];
  const f = e?.fields.find((x) => x.name === field);
  if (!e || !f) return <Gone />;
  const savedEntity = s.saved.entities[entity];
  const wasSaved = !!savedEntity?.fields.some((x) => x.name === field);
  const set = patcher<EntityField>(s, (doc) => doc.entities[entity]?.fields.find((x) => x.name === field));
  const rename = (to: string) => {
    s.edit((doc) => renameField(doc.display, doc.entities, entity, field, to));
    const sel = s.selection;
    if ('field' in sel && sel.field === field) s.select({ ...sel, field: to } as any);
  };
  const lookups = [...(s.inventory?.lookups || []), ...Object.values(s.allEntities()).map((x) => x.endpoint)];
  const numeric = ['integer', 'decimal', 'currency'].includes(f.dataType);
  const remove = () => {
    const uses = usesOfField(s.doc!.display, entity, field);
    setAsk(uses);
  };
  return (
    <Group title={embedded ? `Data: ${e.label}.${f.name}` : 'Field'} aside={<button type="button" className="mini-link" onClick={() => s.select({ kind: 'entity', entity })}>{e.label}</button>}>
      <Row label="Name" hint={wasSaved ? 'Renaming a saved field renames the API property: existing data keeps the old name' : 'camelCase property name'}>
        <Text mono value={f.name} onChange={rename} validate={(v) => IDENT(v) || (v !== field && e.fields.some((x) => x.name === v) ? 'already used' : null) || (v === 'id' ? 'id is reserved' : null)} />
      </Row>
      <Row label="Label"><Text value={f.label} onChange={(v) => set({ label: v })} validate={(v) => (v.trim() ? null : 'required')} /></Row>
      <Row label="Type"><Select value={f.dataType} onChange={(v) => s.edit((doc) => {
        const t = doc.entities[entity].fields.find((x) => x.name === field)!;
        t.dataType = v;
        if (v === 'enum' && !t.options?.length) t.options = ['Option A', 'Option B'];
        if (v !== 'enum') delete t.options;
        if (v === 'lookup' && !t.lookup) t.lookup = { endpoint: s.inventory?.lookups?.[0] || '/lookups/regions', valueField: 'id', labelField: 'name' };
        if (v !== 'lookup') delete t.lookup;
        if (v !== 'enum' && v !== 'lookup') delete t.multiple;
        if (v === 'currency' && !t.currency) t.currency = 'INR';
        // widgets that no longer fit fall back to the default
        for (const p of ['entry', 'detail'] as Panel[]) entryOf(doc.display, p)?.sections.forEach((sec) => sec.items.forEach((i) => { if (i.field === field && i.widget && !WIDGETS_FOR[v].includes(i.widget)) delete i.widget; }));
      })} options={DATA_TYPES} /></Row>
      {(f.dataType === 'enum' || f.dataType === 'lookup') && <Row label="Multiple values"><Toggle value={f.multiple} onChange={(v) => set({ multiple: v || null } as any)} /></Row>}
      <Row label="Required"><Toggle value={f.required} onChange={(v) => set({ required: v || null } as any)} /></Row>
      {['string', 'integer', 'text'].includes(f.dataType) && <Row label="Unique" hint="The API must refuse duplicates (case-insensitive for text)"><Toggle value={f.unique} onChange={(v) => set({ unique: v || null } as any)} /></Row>}
      {['string', 'text'].includes(f.dataType) && (
        <>
          <Row label="Length"><div className="pair"><Num value={f.minLength} min={0} placeholder="min" onChange={(v) => set({ minLength: v })} /><Num value={f.maxLength} min={1} placeholder="max" onChange={(v) => set({ maxLength: v })} /></div></Row>
          <Row label="Upper-case"><Toggle value={f.upperCase} onChange={(v) => set({ upperCase: v || null } as any)} /></Row>
          <Row label="Pattern" hint="Regular expression the value must match"><Text mono value={f.pattern} onChange={(v) => set({ pattern: v })} validate={(v) => { try { if (v) new RegExp(v); return null; } catch { return 'not a valid regular expression'; } }} placeholder="^[A-Z]{3}-\d+$" /></Row>
          {f.pattern && <Row label="Pattern message"><Text value={f.patternMessage} onChange={(v) => set({ patternMessage: v })} /></Row>}
        </>
      )}
      {numeric && <Row label="Range"><div className="pair"><Num value={f.min} placeholder="min" onChange={(v) => set({ min: v })} /><Num value={f.max} placeholder="max" onChange={(v) => set({ max: v })} /></div></Row>}
      {(f.dataType === 'decimal' || f.dataType === 'currency') && <Row label="Decimals"><Num value={f.decimals} min={0} max={10} onChange={(v) => set({ decimals: v })} /></Row>}
      {f.dataType === 'currency' && <Row label="Currency"><Text mono value={f.currency} onChange={(v) => set({ currency: v.toUpperCase() })} validate={(v) => (/^[A-Za-z]{3}$/.test(v) ? null : 'ISO code, e.g. INR')} /></Row>}
      {f.dataType === 'enum' && <Row label="Options" wide><ChipList value={f.options || []} onChange={(v) => set({ options: v.length ? v : null })} placeholder="Add an option, Enter" /></Row>}
      {f.dataType === 'lookup' && (
        <>
          <Row label="Lookup API"><Text mono value={f.lookup?.endpoint} onChange={(v) => set({ lookup: { ...(f.lookup || {}), endpoint: v } })} validate={ENDPOINT} /></Row>
          <div className="sugg">{[...new Set(lookups)].slice(0, 12).map((l) => <button key={l} type="button" className={l === f.lookup?.endpoint ? 'on' : ''} onClick={() => set({ lookup: { ...(f.lookup || {}), endpoint: l } })}>{l}</button>)}</div>
          <Row label="Value / label"><div className="pair"><Text mono value={f.lookup?.valueField ?? 'id'} onChange={(v) => set({ lookup: { ...(f.lookup || { endpoint: '' }), valueField: v } })} /><Text mono value={f.lookup?.labelField ?? 'name'} onChange={(v) => set({ lookup: { ...(f.lookup || { endpoint: '' }), labelField: v } })} /></div></Row>
        </>
      )}
      <Row label="Default"><Text value={f.defaultValue === undefined || f.defaultValue === null ? '' : String(f.defaultValue)} onChange={(v) => set({ defaultValue: v === '' ? null : f.dataType === 'boolean' ? v === 'true' : numeric ? Number(v) : v })} placeholder="none" /></Row>
      <Row label="Read-only" hint="Shown but never changed through the API (e.g. a status a custom action sets)"><Toggle value={f.readOnly} onChange={(v) => set({ readOnly: v || null } as any)} /></Row>
      <Row label="Example" hint="A valid value: used by the generated API tests and sample data"><Text value={f.example === undefined || f.example === null ? '' : String(f.example)} onChange={(v) => set({ example: v === '' ? null : numeric ? Number(v) : f.dataType === 'boolean' ? v === 'true' : v })} /></Row>
      <Row label="Description" wide><Text multiline value={f.description} onChange={(v) => set({ description: v })} /></Row>
      <div className="danger-zone"><Btn small kind="danger" icon="trash" onClick={remove}>Delete field from {e.label}</Btn></div>
      {ask && (
        <Confirm text={<>
          <p>Delete <b>{f.label}</b> from the {e.label} entity{wasSaved ? ' (the API stops accepting it once you regenerate)' : ''}?</p>
          {ask.length > 0 && <><p>It is used in:</p><ul>{ask.map((u) => <li key={u}>{u}</li>)}</ul><p>Those places are removed too. Other displays using {e.label} are checked when you save.</p></>}
        </>} onNo={() => setAsk(null)} onYes={() => {
          setAsk(null);
          s.edit((doc) => {
            const ent = doc.entities[entity];
            ent.fields = ent.fields.filter((x) => x.name !== field);
            if (ent.titleField === field) ent.titleField = ent.fields[0]?.name ?? null;
            const d = doc.display;
            for (const p of ['entry', 'summary', 'master', 'detail', 'detailList'] as Panel[]) {
              if (entityNameOf(d, p) !== entity) continue;
              entryOf(d, p)?.sections.forEach((sec) => { sec.items = sec.items.filter((i) => i.field !== field); });
              const sm = summaryOf(d, p);
              if (sm) { sm.columns = sm.columns.filter((c) => c.field !== field); sm.searchFields = (sm.searchFields || []).filter((c) => c.field !== field); sm.sorters = (sm.sorters || []).filter((c) => c.field !== field); }
            }
          }, { select: { kind: 'entity', entity } });
        }} />
      )}
    </Group>
  );
}

function EntityProps({ name }: { name: string }) {
  const s = useStore();
  const e = s.doc!.entities[name];
  if (!e) return <Gone />;
  const set = patcher<Entity>(s, (doc) => doc.entities[name]);
  const perms = permissionSuggestions(s);
  const wasSaved = !!s.saved.entities[name];
  const usedElsewhere = Object.values(s.saved.displays).filter((x) => x.id !== s.doc!.display.id && (x.entity === name || x.masterSlave?.master.entity === name || x.masterSlave?.detail.entity === name));
  const pm = e.permissionModule;
  const roles = Object.keys(pm?.grants || {});
  const allEnts = Object.values(s.allEntities()).filter((x) => x.name !== name);
  return (
    <>
      <Group title="Entity">
        {usedElsewhere.length > 0 && <p className="note warn"><Icon name="warn" size={12} /> Also used by {usedElsewhere.map((x) => x.title).join(', ')}: changes here affect them too.</p>}
        <Row label="Name" hint={wasSaved ? 'Saved entities keep their name (files and types are named after it)' : 'PascalCase type name'}><Text mono value={e.name} disabled={wasSaved} onChange={(v) => s.edit((doc) => {
          const ent = doc.entities[name]; delete doc.entities[name]; ent.name = v; doc.entities[v] = ent;
          const d = doc.display;
          if (d.entity === name) d.entity = v;
          if (d.masterSlave?.master.entity === name) d.masterSlave.master.entity = v;
          if (d.masterSlave?.detail.entity === name) d.masterSlave.detail.entity = v;
          Object.values(doc.entities).forEach((x) => { if (x.parent?.entity === name) x.parent.entity = v; });
        }, { select: { kind: 'entity', entity: v } })} validate={(v) => PASCAL(v) || (v !== name && s.allEntities()[v] ? 'already used' : null)} /></Row>
        <Row label="Label"><Text value={e.label} onChange={(v) => set({ label: v })} /></Row>
        <Row label="Plural"><Text value={e.plural} onChange={(v) => set({ plural: v })} /></Row>
        <Row label="Endpoint"><Text mono value={e.endpoint} onChange={(v) => set({ endpoint: v })} validate={ENDPOINT} /></Row>
        <Row label="Title field" hint="Names a record in history, copy and delete messages"><Select value={e.titleField || ''} onChange={(v) => set({ titleField: v || null })} options={[{ value: '', label: '—' }, ...e.fields.map((f) => ({ value: f.name, label: f.label }))]} /></Row>
        <Row label="Description" wide><Text multiline value={e.description} onChange={(v) => set({ description: v })} /></Row>
      </Group>
      <Group title={`Fields (${e.fields.length})`}>
        <div className="flist">
          {e.fields.map((f) => (
            <button key={f.name} type="button" className="flist-i" onClick={() => s.select({ kind: 'field', entity: name, field: f.name })}>
              <span className="mono">{f.name}</span><span className="muted">{f.dataType}{f.multiple ? '[]' : ''}</span>{f.required && <span className="req">*</span>}
            </button>
          ))}
        </div>
        <p className="note">Drag fields from the Fields tab on the left onto the canvas, or drop new controls from the toolbox.</p>
      </Group>
      <Group title="Permissions (server-side)">
        {(['view', 'create', 'update', 'delete'] as const).map((k) => (
          <Row key={k} label={k[0].toUpperCase() + k.slice(1)}>
            <Text mono value={e.permissions[k]} onChange={(v) => s.edit((doc) => { doc.entities[name].permissions[k] = v; })} validate={(v) => (perms.includes(v) ? null : 'unknown — declare it in the permission module below')} />
          </Row>
        ))}
        <div className="sugg">{perms.slice(0, 18).map((p) => <span key={p} className="mono">{p}</span>)}</div>
      </Group>
      <Group title="Permission module" aside={!pm ? <button type="button" className="mini-link" onClick={() => set({ permissionModule: { module: e.module, label: e.plural, actions: ['view', 'edit', 'delete'] } })}>declare one</button> : undefined}>
        {!pm && <p className="note">Uses permissions the application already has. Declare a module to add new ones to the role editor (Admin → Roles).</p>}
        {pm && (
          <>
            <Row label="Module"><Text mono value={pm.module} onChange={(v) => s.edit((doc) => { doc.entities[name].permissionModule!.module = v; })} validate={(v) => (/^[a-z][a-z0-9_-]{0,31}$/.test(v) ? null : 'lower-case slug')} /></Row>
            <Row label="Label"><Text value={pm.label} onChange={(v) => s.edit((doc) => { doc.entities[name].permissionModule!.label = v; })} /></Row>
            <Row label="Actions"><ChipList value={pm.actions} onChange={(v) => s.edit((doc) => { doc.entities[name].permissionModule!.actions = v.map(String); })} /></Row>
            <Row label="Grant to roles" hint="Applied once when the module first appears; admins manage roles afterwards" wide>
              <div className="grants">
                {roles.map((r) => (
                  <div key={r} className="grant">
                    <span className="mono">{r}</span>
                    <ChipList value={pm.grants![r]} suggestions={pm.actions} onChange={(v) => s.edit((doc) => { const g = { ...(doc.entities[name].permissionModule!.grants || {}) }; if (v.length) g[r] = v.map(String); else delete g[r]; doc.entities[name].permissionModule!.grants = g; })} />
                  </div>
                ))}
                <ChipList value={[]} placeholder="Add a role name, Enter" suggestions={['admin', 'trader', 'viewer', 'operations', 'risk']} onChange={(v) => s.edit((doc) => { const g = { ...(doc.entities[name].permissionModule!.grants || {}) }; v.forEach((r) => { g[String(r)] = g[String(r)] || ['view']; }); doc.entities[name].permissionModule!.grants = g; })} />
              </div>
            </Row>
            <div className="danger-zone"><Btn small kind="ghost" onClick={() => set({ permissionModule: null })}>Remove module (use existing permissions)</Btn></div>
          </>
        )}
      </Group>
      <Group title="Backend">
        {s.project?.backend === 'none' && <p className="note"><Icon name="info" size={12} /> Front end only: UI Forge writes <span className="mono">src/modules/{e.module}/api/…api.md</span>, the contract your backend team implements (endpoints, fields, rules, permissions).</p>}
        {s.project?.backend !== 'none' && <Row label="Generate API" hint="Off: the API already exists at the endpoint; only the frontend is generated"><Toggle value={e.backend?.generate !== false} onChange={(v) => s.edit((doc) => { doc.entities[name].backend = { ...(doc.entities[name].backend || {}), generate: v }; })} /></Row>}
        {s.project?.backend !== 'none' && e.backend?.generate !== false && (
          <>
            <Row label="Collection"><Text mono value={e.backend?.collection} onChange={(v) => s.edit((doc) => assign(doc.entities[name].backend = doc.entities[name].backend || {}, { collection: v }))} placeholder="camelCase plural" /></Row>
            <Row label="Audit type" hint="entityType written to the audit trail"><Text value={e.backend?.auditEntityType} onChange={(v) => s.edit((doc) => assign(doc.entities[name].backend = doc.entities[name].backend || {}, { auditEntityType: v }))} placeholder={e.label} /></Row>
            <Row label="Custom actions" hint="POST {endpoint}/:id/<action>, implemented in the hooks file"><ChipList value={e.backend?.customActions || []} onChange={(v) => s.edit((doc) => { doc.entities[name].backend = { ...(doc.entities[name].backend || {}), customActions: v.map(String) }; })} /></Row>
          </>
        )}
      </Group>
      <Group title="Parent" defaultOpen={!!e.parent}>
        <Row label="Belongs to"><Select value={e.parent?.entity || ''} onChange={(v) => s.edit((doc) => {
          const ent = doc.entities[name];
          if (!v) { ent.parent = null; return; }
          const pe = s.allEntities()[v];
          const link = (pe ? pe.name[0].toLowerCase() + pe.name.slice(1) : v) + 'Id';
          if (!ent.fields.some((f) => f.name === link)) ent.fields.unshift({ name: link, label: pe?.label || v, dataType: 'lookup', required: true, lookup: { endpoint: pe?.endpoint || '/', valueField: 'id', labelField: pe?.titleField || 'name' } });
          ent.parent = { entity: v, field: link, onParentDelete: ent.parent?.onParentDelete || 'restrict' };
        })} options={[{ value: '', label: '— none —' }, ...allEnts.map((x) => ({ value: x.name, label: x.label }))]} /></Row>
        {e.parent && (
          <>
            <Row label="Link field"><Select value={e.parent.field} onChange={(v) => s.edit((doc) => { doc.entities[name].parent!.field = v; })} options={e.fields.map((f) => f.name)} /></Row>
            <Row label="When the parent is deleted"><Segmented value={e.parent.onParentDelete || 'restrict'} onChange={(v) => s.edit((doc) => { doc.entities[name].parent!.onParentDelete = v; })} options={[{ value: 'restrict', label: 'Refuse' }, { value: 'cascade', label: 'Delete these too' }]} /></Row>
          </>
        )}
      </Group>
    </>
  );
}

function Gone() {
  const s = useStore();
  return <div className="note">That item is no longer there. <button type="button" className="mini-link" onClick={() => s.select({ kind: 'display' })}>Show the display</button></div>;
}

export type { Store };
