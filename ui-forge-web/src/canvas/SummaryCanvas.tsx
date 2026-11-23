/** The grid designer: search panel, toolbar, columns (drag to reorder, drag the edge to resize), row menu, paging. */
import { useMemo, useRef } from 'react';
import { entityNameOf, summaryOf } from '../layout';
import { endDrag, startDrag } from '../ops';
import { display, sampleRows } from '../sample';
import { useStore } from '../store';
import type { Column, EntityField, Panel, SearchField } from '../types';
import { Icon } from '../ui/Icon';
import { ActionBar } from './ActionBar';
import { Slot, useBeforeAfter, useDrop } from './dnd';

export function SummaryCanvas({ panel, rows = 6, compact }: { panel: Panel; rows?: number; compact?: boolean }) {
  const s = useStore();
  const d = s.doc!.display;
  const sm = summaryOf(d, panel);
  const entity = s.doc!.entities[entityNameOf(d, panel) || ''];
  const data = useMemo(() => (entity ? sampleRows(entity, rows) : []), [entity, rows]);
  if (!sm || !entity) return <div className="empty-panel">This grid has no entity.</div>;
  const fieldOf = (n: string) => entity.fields.find((f) => f.name === n);
  const sel = s.selection;
  const visibleCols = sm.columns;
  return (
    <div className={'grid-canvas' + (compact ? ' compact' : '')} onClick={(e) => { e.stopPropagation(); s.select({ kind: 'grid', panel }); }}>
      <div className="gc-head">
        <Icon name="grid" size={14} /><strong>{entity.plural}</strong>
        <span className="muted mono">GET {entity.endpoint}{panel === 'detailList' && d.masterSlave?.detail.linkField ? `?${d.masterSlave.detail.linkField}={master id}` : ''}</span>
        {sm.remote ? <span className="pill on">server paging · {sm.pageSize || 50}/page</span> : <span className="pill">client side</span>}
        {sm.selection === 'multi' && <span className="pill">multi-select</span>}
        {sm.features?.checkboxes === false && <span className="pill">no checkboxes</span>}
      </div>
      <div className="search-strip">
        <span className="ss-title"><Icon name="search" size={12} /> Search</span>
        {(sm.searchFields || []).map((sf, i) => <SearchChip key={sf.field} panel={panel} sf={sf} index={i} field={fieldOf(sf.field)} />)}
        <Slot vertical target={{ t: 'search', panel, index: (sm.searchFields || []).length }} label={(sm.searchFields || []).length ? '' : 'Drop fields to search by'} />
      </div>
      <ActionBar panel={panel} list="toolbarActions" title="Toolbar" />
      <div className="gtable" role="table" aria-label="Columns">
        <div className="gtr gth" role="row">
          {visibleCols.map((c, i) => <ColHead key={c.field} panel={panel} col={c} index={i} field={fieldOf(c.field)} selected={sel.kind === 'column' && sel.panel === panel && sel.field === c.field} sorted={sm.sorters?.find((x) => x.field === c.field)?.direction} />)}
          <Slot vertical target={{ t: 'columns', panel, index: visibleCols.length }} label="+" />
        </div>
        {data.map((r, ri) => (
          <div className="gtr" role="row" key={ri}>
            {visibleCols.map((c) => {
              const f = fieldOf(c.field);
              const v = display(f, r[c.field]);
              const align = c.align || (['integer', 'decimal', 'currency'].includes(f?.dataType || '') ? 'right' : 'left');
              return (
                <div key={c.field} role="cell" className={`gtd${c.hidden ? ' hid' : ''}`} style={cellStyle(c)}>
                  {c.renderer === 'badge' || c.badgeTones ? <span className={`gbadge t-${c.badgeTones?.[v] || 'gray'}`}>{v}</span>
                    : f?.dataType === 'boolean' ? <span className={'gbool' + (r[c.field] ? ' on' : '')}>{r[c.field] ? '✓' : ''}</span>
                      : <span style={{ textAlign: align, display: 'block' }}>{v}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="gfoot">
        {sm.remote ? <span><Icon name="pages" size={12} /> Page 1 of 4 · {data.length * 4} records (sample)</span> : <span>{data.length} records (sample)</span>}
        {sm.entryDisplay && <span className="muted">Opens <b className="mono">{sm.entryDisplay}</b></span>}
      </div>
      <ActionBar panel={panel} list="rowActions" title="Row menu (right-click)" />
    </div>
  );
}

function cellStyle(c: Column): React.CSSProperties {
  return c.flex ? { flex: `${c.flex} 1 140px`, minWidth: 120 } : { flex: `0 0 ${c.width || 140}px` };
}

function ColHead({ panel, col, index, field, selected, sorted }: { panel: Panel; col: Column; index: number; field?: EntityField; selected: boolean; sorted?: string }) {
  const s = useStore();
  const onDrop = useDrop();
  const { pos, handlers } = useBeforeAfter(true);
  const ref = useRef<HTMLDivElement>(null);
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    const x0 = e.clientX; const w0 = ref.current!.getBoundingClientRect().width;
    let w = w0;
    const cells = () => Array.from(ref.current!.closest('.gtable')!.querySelectorAll<HTMLElement>(`.gtr > :nth-child(${index + 1})`));
    const mv = (ev: PointerEvent) => { w = Math.max(60, Math.round((w0 + ev.clientX - x0) / 10) * 10); cells().forEach((c) => { c.style.flex = `0 0 ${w}px`; }); };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      if (Math.abs(w - w0) >= 10) s.edit((doc) => { const c = summaryOf(doc.display, panel)?.columns.find((x) => x.field === col.field); if (c) { c.width = w; c.flex = null; } });
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  return (
    <div ref={ref} role="columnheader" className={`gtd gcol${selected ? ' sel' : ''}${col.hidden ? ' hid' : ''}${pos ? ' drop-' + pos : ''}`} style={cellStyle(col)} draggable
      onDragStart={(e) => { e.stopPropagation(); startDrag(e, { t: 'column', panel, field: col.field }); }} onDragEnd={endDrag}
      {...handlers((w) => ({ t: 'columns', panel, index: w === 'before' ? index : index + 1 }), panel, 'columns', onDrop, s.doc)}
      onClick={(e) => { e.stopPropagation(); s.select({ kind: 'column', panel, field: col.field }); }} tabIndex={0}>
      <span className="gcol-l">{col.label || field?.label || col.field}</span>
      {sorted && <Icon name={sorted === 'DESC' ? 'down' : 'up'} size={11} />}
      {col.filter !== false && col.filter !== undefined && <Icon name="filter" size={10} className="muted" />}
      {col.hidden && <span className="fi-flag">hidden</span>}
      <span className="gcol-rs" onPointerDown={startResize} title={`Width ${col.width || 'flex'} — drag to resize`} />
    </div>
  );
}

function SearchChip({ panel, sf, index, field }: { panel: Panel; sf: SearchField; index: number; field?: EntityField }) {
  const s = useStore();
  const onDrop = useDrop();
  const { pos, handlers } = useBeforeAfter(true);
  const sel = s.selection;
  const on = sel.kind === 'search' && sel.panel === panel && sel.field === sf.field;
  return (
    <button type="button" className={`schip${on ? ' sel' : ''}${pos ? ' drop-' + pos : ''}`} draggable
      onDragStart={(e) => { e.stopPropagation(); startDrag(e, { t: 'search', panel, field: sf.field }); }} onDragEnd={endDrag}
      {...handlers((w) => ({ t: 'search', panel, index: w === 'before' ? index : index + 1 }), panel, 'search', onDrop, s.doc)}
      onClick={(e) => { e.stopPropagation(); s.select({ kind: 'search', panel, field: sf.field }); }}>
      {sf.label || field?.label || sf.field}
      <span className="op">{sf.operator === 'between' ? 'from–to' : sf.operator || 'eq'}</span>
      {sf.required && <span className="req">*</span>}
    </button>
  );
}
