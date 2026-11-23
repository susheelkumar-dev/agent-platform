/** Master-Slave designer: master grid on one side, the linked detail (child list + form) on the other. */
import { useRef } from 'react';
import { useStore } from '../store';
import { Icon } from '../ui/Icon';
import { EntryCanvas } from './EntryCanvas';
import { SummaryCanvas } from './SummaryCanvas';

export function MasterSlaveCanvas() {
  const s = useStore();
  const ms = s.doc!.display.masterSlave!;
  const box = useRef<HTMLDivElement>(null);
  const vertical = ms.orientation === 'vertical';
  const split = ms.split ?? 45;
  const child = ms.detail.relation === 'child';
  const master = s.doc!.entities[ms.master.entity];
  const detail = s.doc!.entities[ms.detail.entity];

  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const r = box.current!.getBoundingClientRect();
    let pct = split;
    const mv = (ev: PointerEvent) => {
      pct = Math.round(Math.max(20, Math.min(80, vertical ? ((ev.clientY - r.top) / r.height) * 100 : ((ev.clientX - r.left) / r.width) * 100)));
      box.current!.style.setProperty('--split', pct + '%');
    };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      if (pct !== split) s.edit((doc) => { doc.display.masterSlave!.split = pct; });
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const key = (e: React.KeyboardEvent) => {
    const d = e.key === (vertical ? 'ArrowUp' : 'ArrowLeft') ? -5 : e.key === (vertical ? 'ArrowDown' : 'ArrowRight') ? 5 : 0;
    if (d) { e.preventDefault(); s.edit((doc) => { doc.display.masterSlave!.split = Math.max(20, Math.min(80, split + d)); }); }
  };

  return (
    <div ref={box} className={'ms-canvas' + (vertical ? ' vert' : '')} style={{ ['--split' as any]: split + '%' }}>
      <div className="ms-pane ms-master">
        <div className="ms-label"><Icon name="grid" size={12} /> Master · {master?.plural}</div>
        <SummaryCanvas panel="master" rows={7} compact />
      </div>
      <div className="ms-split" role="separator" aria-orientation={vertical ? 'horizontal' : 'vertical'} aria-valuenow={split} aria-valuemin={20} aria-valuemax={80}
        tabIndex={0} onPointerDown={drag} onKeyDown={key} title="Drag (or use the arrow keys) to change the split">
        <span className="ms-link" title={child ? `${detail?.label}.${ms.detail.linkField} = selected ${master?.label}.id` : 'The form edits the selected record'}>
          <Icon name="link" size={12} />
        </span>
        <button type="button" className="ms-flip" title={vertical ? 'Show side by side' : 'Show one above the other'} aria-label="Change the layout"
          onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); s.edit((doc) => { doc.display.masterSlave!.orientation = vertical ? 'horizontal' : 'vertical'; }); }}>
          {vertical ? '⇆' : '⇅'}
        </button>
      </div>
      <div className="ms-pane ms-detail">
        <div className="ms-label">
          <Icon name="layers" size={12} /> Detail · {child ? `${detail?.plural} of the selected ${master?.label?.toLowerCase()}` : `the selected ${master?.label?.toLowerCase()}`}
          <span className="pill">{ms.unsavedChanges || 'confirm'} on unsaved changes</span>
        </div>
        {child && ms.detail.summary && <SummaryCanvas panel="detailList" rows={3} compact />}
        <EntryCanvas panel="detail" compact />
      </div>
    </div>
  );
}
