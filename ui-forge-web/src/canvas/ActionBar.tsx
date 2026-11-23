/** A bar of action buttons (form actions, grid toolbar, row menu) that accepts dropped actions. */
import { actionsOf, entityNameOf } from '../layout';
import { endDrag, startDrag } from '../ops';
import { useStore } from '../store';
import type { Action, Panel } from '../types';
import { Icon } from '../ui/Icon';
import { Slot, useBeforeAfter, useDrop } from './dnd';

const ICON: Record<string, string> = { save: 'save', delete: 'trash', copy: 'copy', audit: 'history', reset: 'undo', cancel: 'close', new: 'plus', open: 'open', refresh: 'refresh', custom: 'bolt' };
const LABEL: Record<string, string> = { save: 'Save', delete: 'Delete', copy: 'Copy', audit: 'History', reset: 'Reset', cancel: 'Close', new: 'New', open: 'Open', refresh: 'Refresh' };

/** The text the app shows when an action has no Label of its own (same rules as @extreact/framework). */
export function defaultActionLabel(a: Action, entityLabel?: string): string {
  if (a.kind === 'new') return entityLabel ? `New ${entityLabel}` : 'New';
  return LABEL[a.kind] || a.id;
}

export function ActionBar({ panel, list, title }: { panel: Panel; list: 'actions' | 'toolbarActions' | 'rowActions'; title: string }) {
  const s = useStore();
  const actions = actionsOf(structuredClone(s.doc!.display), panel, list) || [];
  return (
    <div className={`abar l-${list}`} aria-label={title}>
      <span className="abar-title">{title}</span>
      <div className="abar-items">
        {actions.map((a, i) => <ActionChip key={a.id} panel={panel} list={list} a={a} index={i} />)}
        <Slot vertical target={{ t: 'actions', panel, list, index: actions.length }} label={actions.length ? '' : 'Drop actions'} />
      </div>
    </div>
  );
}

function ActionChip({ panel, list, a, index }: { panel: Panel; list: 'actions' | 'toolbarActions' | 'rowActions'; a: Action; index: number }) {
  const s = useStore();
  const onDrop = useDrop();
  const { pos, handlers } = useBeforeAfter(true);
  const sel = s.selection;
  const on = sel.kind === 'action' && sel.panel === panel && sel.list === list && sel.id === a.id;
  const entity = s.doc!.entities[entityNameOf(s.doc!.display, panel) || ''];
  const style = a.style || (a.kind === 'save' ? 'primary' : a.kind === 'delete' ? 'danger' : 'default');
  return (
    <button type="button" className={`achip st-${style}${on ? ' sel' : ''}${pos ? ' drop-' + pos : ''}`} draggable
      onDragStart={(e) => { e.stopPropagation(); startDrag(e, { t: 'action', panel, list, id: a.id }); }} onDragEnd={endDrag}
      {...handlers((w) => ({ t: 'actions', panel, list, index: w === 'before' ? index : index + 1 }), panel, 'actions', onDrop, s.doc)}
      onClick={(e) => { e.stopPropagation(); s.select({ kind: 'action', panel, list, id: a.id }); }}
      title={[a.permission && `needs ${a.permission}`, a.confirm && 'asks for confirmation', a.path && `POST …/{id}/${a.path}`].filter(Boolean).join(' · ') || a.kind}>
      <Icon name={a.icon || ICON[a.kind] || 'bolt'} size={13} />
      {a.label || defaultActionLabel(a, entity?.label)}
      {a.permission && <Icon name="lock" size={11} className="lockic" />}
    </button>
  );
}
