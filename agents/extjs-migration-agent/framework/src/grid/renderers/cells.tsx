import type { ReactNode } from 'react';
import type { CustomCellRendererProps } from 'ag-grid-react';
import { isDataRow, type GridRow } from '../store/rows';
import type { BadgeTone } from '../types';
import { Icon } from '../components/Icon';

/** Passed to AG Grid as `context` so renderers can call back into the grid (Ext: controller handlers). */
export interface GridContext {
  toggleExpanded: (id: number | string) => void;
  toggleGroup: (key: string) => void;
  groupHeader: (row: GridRow) => { label: string; value: string; summary: string };
  renderDetail: (row: GridRow) => ReactNode;
  recordNames: [string, string];
  actions: { edit: boolean; duplicate: boolean; delete: boolean };
  canDelete: (row: GridRow) => boolean;
  editRecord: (id: number | string) => void;
  duplicateRecord: (id: number | string) => void;
  deleteRecords: (ids: (number | string)[]) => void;
}

type P<Extra = object> = CustomCellRendererProps<GridRow, unknown, GridContext> & Extra;

const AUTO_TONES: BadgeTone[] = ['blue', 'green', 'amber', 'gray', 'red'];
const autoTone = (v: string) => AUTO_TONES[[...v].reduce((h, c) => h + c.charCodeAt(0), 0) % AUTO_TONES.length];

export const EmptyCell = () => null;

/** renderer: 'badge' */
export function BadgeCell({ value, tones }: P<{ tones?: Record<string, BadgeTone> }>) {
  if (value == null || value === '') return null;
  const v = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  return <span className={`xg-badge xg-badge--${tones?.[v] ?? autoTone(v)}`}>{v}</span>;
}

/** renderer: 'progress' (Ext progressbarwidget) */
export function ProgressCell({ value }: P) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="xg-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="xg-progress__bar" style={{ width: `${pct}%` }} />
      <span className="xg-progress__text">{Math.round(pct)}%</span>
    </div>
  );
}

/** renderer: (value, record) => ReactNode */
export function FnCell({ value, data, render }: P<{ render: (v: unknown, r: unknown) => ReactNode }>) {
  return <>{render(value, data)}</>;
}

/** Ext rowexpander toggle */
export function ExpanderCell({ data, context }: P) {
  if (!isDataRow(data)) return null;
  const open = !!data!.__expanded;
  return (
    <button className="xg-icon-btn" aria-label={open ? 'Collapse details' : 'Expand details'} aria-expanded={open}
      onClick={(e) => { e.stopPropagation(); context.toggleExpanded(data!.__recId!); }}>
      <Icon name={open ? 'minus' : 'plus'} />
    </button>
  );
}

/** Ext actioncolumn */
export function ActionsCell({ data, context }: P) {
  if (!isDataRow(data)) return null;
  const id = data!.__recId!;
  const { actions } = context;
  const deletable = context.canDelete(data!);
  return (
    <div className="xg-actions">
      {actions.edit && (
        <button className="xg-icon-btn" title="Edit" aria-label="Edit" onClick={() => context.editRecord(id)}><Icon name="edit" /></button>
      )}
      {actions.duplicate && (
        <button className="xg-icon-btn" title="Duplicate" aria-label="Duplicate" onClick={() => context.duplicateRecord(id)}><Icon name="copy" /></button>
      )}
      {actions.delete && (
        <button className="xg-icon-btn xg-icon-btn--danger" title={deletable ? 'Delete' : 'This record cannot be deleted'}
          aria-label="Delete" disabled={!deletable} onClick={() => context.deleteRecords([id])}><Icon name="trash" /></button>
      )}
    </div>
  );
}

/** Full-width rows: group header (Ext groupHeaderTpl) and row-expander body (Ext rowBodyTpl) */
export function FullWidthRow({ data, context }: P) {
  if (!data) return null;
  if (data.__kind === 'group') {
    const n = data.__groupCount ?? 0;
    const h = context.groupHeader(data);
    return (
      <button className="xg-group-row" onClick={() => context.toggleGroup(data.__groupKey!)} aria-expanded={!data.__collapsed}>
        <Icon name={data.__collapsed ? 'chevronRight' : 'chevronDown'} />
        <span className="xg-muted">{h.label}:</span>
        <strong>{h.value}</strong>
        <span className="xg-muted">({n} {n === 1 ? context.recordNames[0] : context.recordNames[1]})</span>
        {h.summary && <span className="xg-group-row__sum">{h.summary}</span>}
      </button>
    );
  }
  return <div className="xg-detail-row">{context.renderDetail(data)}</div>;
}
