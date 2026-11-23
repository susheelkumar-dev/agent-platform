import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Closes on outside click / Escape / scroll — shared by menus and dropdowns. */
function useDismiss(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, ref]);
}

/* ---------- Ext.menu.Menu (itemcontextmenu) ---------- */
export interface MenuItem { text: string; icon?: IconName; disabled?: boolean; danger?: boolean; onClick: () => void }

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: (MenuItem | '-')[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, onClose, ref);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('resize', close);
    ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    return () => window.removeEventListener('resize', close);
  }, [onClose]);
  // keep inside the viewport
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - items.length * 36 - 16);
  return (
    <div ref={ref} className="xg-menu" role="menu" style={{ left, top }}>
      {items.map((it, i) =>
        it === '-' ? <div key={i} className="xg-menu__sep" role="separator" /> : (
          <button key={i} role="menuitem" className={`xg-menu__item${it.danger ? ' xg-menu__item--danger' : ''}`}
            disabled={it.disabled} onClick={() => { it.onClick(); onClose(); }}>
            {it.icon && <Icon name={it.icon} />}{it.text}
          </button>
        ),
      )}
    </div>
  );
}

/* ---------- dropdown button (Ext button with `menu`) ---------- */
export function Dropdown({ label, icon, open, setOpen, children }: {
  label: string; icon?: IconName; open: boolean; setOpen: (o: boolean) => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  return (
    <div className="xg-dropdown" ref={ref}>
      <button className="xg-btn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon && <Icon name={icon} />}{label}
      </button>
      {open && <div className="xg-dropdown__panel">{children}</div>}
    </div>
  );
}

/* ---------- Ext.Msg.confirm ---------- */
export function ConfirmDialog({ title, message, confirmText = 'Yes', onConfirm, onCancel }: {
  title: string; message: string; confirmText?: string; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('.xg-btn--primary')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="xg-modal-backdrop" onClick={onCancel}>
      <div ref={ref} className="xg-modal" role="alertdialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId}>{title}</h2>
        <p>{message}</p>
        <div className="xg-modal__actions">
          <button className="xg-btn" onClick={onCancel}>No</button>
          <button className="xg-btn xg-btn--primary xg-btn--danger" onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Ext.toast ---------- */
export interface ToastMsg { id: number; text: string; tone: 'ok' | 'error' | 'info' }

export function Toasts({ items, onDismiss }: { items: ToastMsg[]; onDismiss: (id: number) => void }) {
  return (
    <div className="xg-toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`xg-toast xg-toast--${t.tone}`}>
          <span>{t.text}</span>
          <button className="xg-icon-btn" aria-label="Dismiss" onClick={() => onDismiss(t.id)}><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}
