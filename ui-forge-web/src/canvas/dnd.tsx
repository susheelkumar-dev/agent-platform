/** Drop handling shared by the canvases. */
import { useEffect, useState } from 'react';
import { accepts, drop, dragged, endDrag, payloadOf, type Payload, type Target } from '../ops';
import { useStore } from '../store';

export function useDrop() {
  const s = useStore();
  return (target: Target) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const p = payloadOf(e);
    endDrag();
    if (!p) return;
    let msg: string | null = null;
    s.edit((doc) => {
      const r = drop(doc, p, target);
      if (typeof r === 'string') msg = r; else s.select(r);
    });
    if (msg) s.notify(msg, 'warning');
  };
}

/** Re-render while something is dragged (drop zones depend on what it is). */
export function useDragging() {
  const [, set] = useState(0);
  useEffect(() => {
    const h = () => set((x) => x + 1);
    window.addEventListener('uiforge-drag', h);
    return () => window.removeEventListener('uiforge-drag', h);
  }, []);
  return dragged();
}

/** A slot between things that lights up when what is being dragged may land there. */
export function Slot({ target, vertical, label }: { target: Target; vertical?: boolean; label?: string }) {
  const s = useStore();
  const onDrop = useDrop();
  const [over, setOver] = useState(false);
  const ok = accepts(useDragging(), target.t, s.doc, target.panel);
  return (
    <div className={`slot${vertical ? ' v' : ''}${ok ? ' ok' : ''}${over && ok ? ' over' : ''}`}
      onDragOver={(e) => { if (ok) { e.preventDefault(); e.dataTransfer.dropEffect = dragged()?.t === 'control' || dragged()?.t === 'field' ? 'copy' : 'move'; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); if (ok) onDrop(target)(e); }}>
      {label && <span>{label}</span>}
    </div>
  );
}

/** Hover tracking for "drop before / after this element". */
export function useBeforeAfter(horizontal: boolean) {
  const [pos, setPos] = useState<'before' | 'after' | null>(null);
  const handlers = (target: (where: 'before' | 'after') => Target, panel: Target['panel'], kind: Target['t'], onDrop: (t: Target) => (e: React.DragEvent) => void, doc: ReturnType<typeof useStore>['doc']) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!accepts(dragged(), kind, doc, panel)) return;
      e.preventDefault(); e.stopPropagation();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setPos(horizontal ? (e.clientX < r.left + r.width / 2 ? 'before' : 'after') : (e.clientY < r.top + r.height / 2 ? 'before' : 'after'));
    },
    onDragLeave: () => setPos(null),
    onDrop: (e: React.DragEvent) => { const p = pos || 'after'; setPos(null); if (accepts(dragged() as Payload, kind, doc, panel)) onDrop(target(p))(e); },
  });
  return { pos, handlers };
}
