/** The form designer: sections in a grid, fields that can be dragged, dropped, resized and reordered. */
import { useRef } from 'react';
import { defaultWidget } from '../catalog';
import { entityNameOf, entryOf } from '../layout';
import { endDrag, startDrag } from '../ops';
import { sampleValue, display } from '../sample';
import { useStore } from '../store';
import type { EntityField, FormItem, Panel, Section } from '../types';
import { Icon } from '../ui/Icon';
import { ActionBar } from './ActionBar';
import { Slot, useBeforeAfter, useDrop } from './dnd';

export function EntryCanvas({ panel, compact }: { panel: Panel; compact?: boolean }) {
  const s = useStore();
  const d = s.doc!.display;
  const en = entryOf(d, panel);
  const entity = s.doc!.entities[entityNameOf(d, panel) || ''];
  if (!en) return null;
  const cols = en.columns || 2;
  const linkField = panel === 'detail' ? d.masterSlave?.detail.linkField : null;
  const sel = s.selection;
  return (
    <div className={'form-canvas' + (compact ? ' compact' : '')} aria-label="Form designer">
      <div className="fc-head">
        <Icon name="layers" size={14} />
        <strong>{entity?.label ?? '?'}</strong>
        <span className="muted">{cols} column{cols > 1 ? 's' : ''} · {en.sections.reduce((n, x) => n + x.items.length, 0)} fields</span>
        {linkField && <span className="link-chip" title="Filled from the selected master record; not shown on the form"><Icon name="link" size={12} /> {linkField} = master id</span>}
      </div>
      {en.sections.map((sec, si) => (
        <div key={sec.id}>
          <Slot target={{ t: 'sections', panel, index: si }} />
          {sec.kind === 'tab' && (si === 0 || en.sections[si - 1].kind !== 'tab') && (
            <div className="tabstrip-hint">{en.sections.slice(si).filter((x, k, arr) => arr.slice(0, k + 1).every((y) => y.kind === 'tab')).map((t) => <span key={t.id}>{t.title || t.id}</span>)}</div>
          )}
          <SectionBox panel={panel} sec={sec} cols={sec.columns || cols} entityFields={entity?.fields || []} selected={sel.kind === 'section' && sel.panel === panel && sel.section === sec.id} />
        </div>
      ))}
      <Slot target={{ t: 'sections', panel, index: en.sections.length }} label="Drop a panel, group, tab or label here" />
      <ActionBar panel={panel} list="actions" title="Form actions" />
    </div>
  );
}

function SectionBox({ panel, sec, cols, entityFields, selected }: { panel: Panel; sec: Section; cols: number; entityFields: EntityField[]; selected: boolean }) {
  const s = useStore();
  const onDrop = useDrop();
  const kind = sec.kind || 'panel';
  return (
    <section className={`fsec k-${kind}${selected ? ' sel' : ''}`} onClick={(e) => { e.stopPropagation(); s.select({ kind: 'section', panel, section: sec.id }); }}>
      <header draggable onDragStart={(e) => startDrag(e, { t: 'section', panel, section: sec.id })} onDragEnd={endDrag}>
        <Icon name="drag" size={14} className="grip" />
        <span className="fsec-title">{sec.title || <em className="muted">untitled {kind}</em>}</span>
        <span className="kind">{kind}{sec.collapsible ? ' · collapsible' : ''}</span>
      </header>
      {sec.description && <p className="fsec-desc">{sec.description}</p>}
      <div className="fgrid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => onDrop({ t: 'items', panel, section: sec.id, index: sec.items.length })(e)}>
        {sec.items.map((it, i) => (
          <ItemCard key={it.field} panel={panel} sec={sec} item={it} index={i} cols={cols} field={entityFields.find((f) => f.name === it.field)} />
        ))}
        <div className="fdrop-end" style={{ gridColumn: `span ${cols}` }}>
          <Slot target={{ t: 'items', panel, section: sec.id, index: sec.items.length }} label={sec.items.length ? 'Drop fields here' : 'Empty — drag controls or fields into this section'} />
        </div>
      </div>
    </section>
  );
}

function ItemCard({ panel, sec, item, index, cols, field }: { panel: Panel; sec: Section; item: FormItem; index: number; cols: number; field?: EntityField }) {
  const s = useStore();
  const onDrop = useDrop();
  const { pos, handlers } = useBeforeAfter(true);
  const ref = useRef<HTMLDivElement>(null);
  const span = Math.min(item.span || 1, cols);
  const sel = s.selection;
  const selected = sel.kind === 'item' && sel.panel === panel && sel.section === sec.id && sel.field === item.field;
  const widget = item.widget || (field ? defaultWidget(field) : 'input');
  const label = item.label || field?.label || item.field;
  const sample = field ? display(field, sampleValue(field, 0, '')) : '';
  const issue = s.preview?.issues.find((x) => x.path.includes(`items`) && x.message.includes(`'${item.field}'`));

  // drag the right edge to change how many columns the field spans
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    const grid = ref.current?.parentElement;
    if (!grid) return;
    const colW = grid.getBoundingClientRect().width / cols;
    const left = ref.current!.getBoundingClientRect().left;
    let last = span;
    const mv = (ev: PointerEvent) => {
      const n = Math.max(1, Math.min(cols, Math.round((ev.clientX - left) / colW)));
      if (n !== last) { last = n; ref.current!.style.gridColumn = `span ${n}`; }
    };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      if (last !== span) s.edit((doc) => { const it = doc.display && findItem(doc.display, panel, sec.id, item.field); if (it) it.span = last; });
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };

  return (
    <div ref={ref} className={`fitem${selected ? ' sel' : ''}${item.hidden ? ' hidden' : ''}${pos ? ' drop-' + pos : ''}${issue ? ' has-issue' : ''}`} style={{ gridColumn: `span ${span}` }}
      draggable tabIndex={0} role="button" aria-label={`${label} field`} aria-pressed={selected}
      onDragStart={(e) => { e.stopPropagation(); startDrag(e, { t: 'item', panel, section: sec.id, field: item.field }); }} onDragEnd={endDrag}
      {...handlers((w) => ({ t: 'items', panel, section: sec.id, index: w === 'before' ? index : index + 1 }), panel, 'items', onDrop, s.doc)}
      onClick={(e) => { e.stopPropagation(); s.select({ kind: 'item', panel, section: sec.id, field: item.field }); }}
      onKeyDown={(e) => { if (e.key === 'Enter') s.select({ kind: 'item', panel, section: sec.id, field: item.field }); }}>
      <div className="fi-label">
        {label}{field?.required && <span className="req">*</span>}
        {item.visibleWhen && <span className="fi-flag" title={`Shown when ${item.visibleWhen.field} is ${item.visibleWhen.equals.join(' / ')}`}>if</span>}
        {(item.readOnly || field?.readOnly) && <span className="fi-flag" title="Read-only">ro</span>}
        {item.readOnlyOnEdit && <span className="fi-flag" title="Read-only after the record is created">ro edit</span>}
        {field?.unique && <span className="fi-flag" title="Unique">uniq</span>}
      </div>
      <WidgetMock widget={widget} field={field} sample={sample} placeholder={item.placeholder} />
      {item.help && <div className="fi-help">{item.help}</div>}
      <div className="fi-meta"><span>{field?.dataType ?? 'missing field'}</span><span>{item.field}</span></div>
      {issue && <div className="fi-issue" title={issue.message}><Icon name="warn" size={12} /></div>}
      <div className="fi-resize" onPointerDown={startResize} title="Drag to change the width (columns)" aria-hidden />
    </div>
  );
}

function findItem(d: import('../types').Display, panel: Panel, section: string, field: string) {
  return entryOf(d, panel)?.sections.find((x) => x.id === section)?.items.find((x) => x.field === field);
}

function WidgetMock({ widget, field, sample, placeholder }: { widget: string; field?: EntityField; sample: string; placeholder?: string | null }) {
  const opts = (field?.options || []).map(String);
  switch (widget) {
    case 'textarea': return <div className="wm wm-area">{placeholder || sample}</div>;
    case 'checkbox': return <div className="wm-check"><span className="box on" /> {field?.label}</div>;
    case 'switch': return <div className="wm-switch"><span className="trk"><span /></span></div>;
    case 'radio': return <div className="wm-radio">{(opts.length ? opts : ['A', 'B']).slice(0, 4).map((o, i) => <span key={o}><i className={i === 0 ? 'on' : ''} />{o}</span>)}</div>;
    case 'multiselect': return <div className="wm wm-chips">{(opts.length ? opts : ['One', 'Two']).slice(0, 2).map((o) => <b key={o}>{o}</b>)}</div>;
    case 'select': return <div className="wm wm-select">{opts[0] || (field?.dataType === 'lookup' ? `${field.lookup?.endpoint ?? 'lookup'}` : placeholder || 'Select…')}<Icon name="chevron" size={11} /></div>;
    default:
      return (
        <div className={'wm' + (['integer', 'decimal', 'currency'].includes(field?.dataType || '') ? ' num' : '')}>
          {field?.dataType === 'currency' && <i className="affix">{field.currency || '¤'}</i>}
          <span>{placeholder || sample}</span>
          {['date', 'datetime'].includes(field?.dataType || '') && <Icon name="calendar" size={12} />}
          {field?.dataType === 'time' && <Icon name="clock" size={12} />}
        </div>
      );
  }
}
