/**
 * Menu bar rendered from the server's navigation tree: folders open drop-downs (nested folders open to the
 * side), entries open their display. Nothing about the business menu is written in the front-end.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { MenuItem } from '../types';

function Icon({ icon }: { icon?: string | null }) {
  if (!icon) return null;
  return <i className={'xf-icon ' + icon} aria-hidden="true" />;
}

function Entries({ items, onSelect, close }: { items: MenuItem[]; onSelect: (m: MenuItem) => void; close: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="xf-menu" role="menu">
      {items.map((m) => (
        <li key={m.id} role="none" className={m.children ? 'xf-has-sub' : undefined}
          onMouseEnter={() => m.children && setOpen(m.id)} onMouseLeave={() => m.children && setOpen(null)}>
          <button type="button" role="menuitem" aria-haspopup={m.children ? 'menu' : undefined}
            aria-expanded={m.children ? open === m.id : undefined}
            onClick={() => { if (m.children) setOpen(open === m.id ? null : m.id); else { onSelect(m); close(); } }}>
            <Icon icon={m.icon} /><span>{m.title}</span>{m.children && <span className="xf-caret-right" aria-hidden="true">›</span>}
          </button>
          {m.children && open === m.id && <Entries items={m.children} onSelect={onSelect} close={close} />}
        </li>
      ))}
    </ul>
  );
}

export function MenuBar({ items, onSelect }: { items: MenuItem[]; onSelect: (m: MenuItem) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };

  if (!items.length) {
    return <nav className="xf-menubar" aria-label="Main menu"><span className="xf-muted">No menu entries are available to you.</span></nav>;
  }
  return (
    <nav className="xf-menubar" aria-label="Main menu" ref={ref} onKeyDown={onKey}>
      {items.map((m) => (
        <div key={m.id} className="xf-menubar-item">
          <button type="button" className={'xf-menubar-btn' + (open === m.id ? ' xf-open' : '')}
            aria-haspopup={m.children ? 'menu' : undefined} aria-expanded={m.children ? open === m.id : undefined}
            onClick={() => (m.children ? setOpen(open === m.id ? null : m.id) : onSelect(m))}>
            <Icon icon={m.icon} /><span>{m.title}</span>{m.children && <span className="xf-caret" aria-hidden="true">▾</span>}
          </button>
          {m.children && open === m.id && <Entries items={m.children} onSelect={onSelect} close={() => setOpen(null)} />}
        </div>
      ))}
    </nav>
  );
}
