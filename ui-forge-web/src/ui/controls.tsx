/** Compact property controls. Text inputs commit on blur / Enter so one edit is one undo step. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Row({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  const id = useId();
  return (
    <div className={'prow' + (wide ? ' wide' : '')}>
      <label htmlFor={id} title={hint}>{label}{hint && <span className="q" aria-hidden>?</span>}</label>
      <div className="pval" data-for={id}>{children}</div>
    </div>
  );
}

export function Group({ title, children, defaultOpen = true, aside }: { title: string; children: ReactNode; defaultOpen?: boolean; aside?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={'pgroup' + (open ? ' open' : '')}>
      <header>
        <button type="button" className="pg-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="chevron" size={12} className="chev" />{title}
        </button>
        {aside}
      </header>
      {open && <div className="pg-body">{children}</div>}
    </section>
  );
}

export function Text({ value, onChange, placeholder, mono, disabled, validate, ariaLabel, multiline }: {
  value: string | null | undefined; onChange: (v: string) => void; placeholder?: string; mono?: boolean; disabled?: boolean;
  validate?: (v: string) => string | null; ariaLabel?: string; multiline?: boolean;
}) {
  const [v, setV] = useState(value ?? '');
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef(value);
  useEffect(() => { if (value !== ref.current) { ref.current = value; setV(value ?? ''); setErr(null); } }, [value]);
  const commit = () => {
    if (v === (value ?? '')) return;
    const e = validate?.(v) ?? null;
    setErr(e);
    if (!e) { ref.current = v; onChange(v); }
  };
  const common = {
    className: 'in' + (mono ? ' mono' : '') + (err ? ' bad' : ''), value: v, placeholder, disabled, 'aria-label': ariaLabel, 'aria-invalid': !!err,
    onBlur: commit,
  };
  return (
    <span className="in-wrap">
      {multiline
        ? <textarea {...common} rows={3} onChange={(e) => setV(e.target.value)} />
        : <input {...common} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') setV(value ?? ''); }} />}
      {err && <span className="in-err">{err}</span>}
    </span>
  );
}

export function Num({ value, onChange, min, max, step, placeholder, ariaLabel, allowEmpty = true }: {
  value: number | null | undefined; onChange: (v: number | null) => void; min?: number; max?: number; step?: number; placeholder?: string; ariaLabel?: string; allowEmpty?: boolean;
}) {
  const [v, setV] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => { setV(value === null || value === undefined ? '' : String(value)); }, [value]);
  const commit = () => {
    if (v.trim() === '') { if (allowEmpty && value !== null && value !== undefined) onChange(null); else if (!allowEmpty) setV(String(value ?? '')); return; }
    let n = Number(v);
    if (!Number.isFinite(n)) { setV(String(value ?? '')); return; }
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    if (n !== value) onChange(n);
    setV(String(n));
  };
  return <input className="in num" inputMode="decimal" value={v} placeholder={placeholder} aria-label={ariaLabel} step={step}
    onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />;
}

export function Select<T extends string>({ value, onChange, options, ariaLabel, disabled }: {
  value: T | null | undefined; onChange: (v: T) => void; options: (T | { value: T; label: string })[]; ariaLabel?: string; disabled?: boolean;
}) {
  return (
    <select className="in" value={value ?? ''} aria-label={ariaLabel} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value;
        const lab = typeof o === 'string' ? o : o.label;
        return <option key={val} value={val}>{lab}</option>;
      })}
    </select>
  );
}

export function Toggle({ value, onChange, label, disabled }: { value: boolean | null | undefined; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <label className={'tog' + (disabled ? ' dis' : '')}>
      <input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="tog-track" aria-hidden><span className="tog-knob" /></span>
      {label && <span className="tog-label">{label}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: string }[]; ariaLabel?: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} title={o.label}>
          {o.icon && <Icon name={o.icon} size={14} />}<span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A list of strings edited as chips (options of an enum, required permissions, roles). */
export function ChipList({ value, onChange, placeholder, suggestions }: { value: (string | number)[]; onChange: (v: (string | number)[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const add = () => {
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean).filter((s) => !value.map(String).includes(s));
    if (parts.length) onChange([...value, ...parts]);
    setDraft('');
  };
  const move = (i: number, d: number) => { const n = [...value]; const [x] = n.splice(i, 1); n.splice(Math.max(0, Math.min(n.length, i + d)), 0, x); onChange(n); };
  return (
    <div className="chiplist">
      {value.map((v, i) => (
        <span key={String(v) + i} className="chip">
          <button type="button" className="chip-mv" onClick={() => move(i, -1)} aria-label={`Move ${v} left`} disabled={i === 0}>‹</button>
          {String(v)}
          <button type="button" className="chip-x" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove ${v}`}>×</button>
        </span>
      ))}
      <input className="chip-in" value={draft} list={suggestions ? listId : undefined} placeholder={placeholder || 'Add…'} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1)); }} onBlur={add} />
      {suggestions && <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  );
}

export function Btn({ children, onClick, kind = 'default', icon, disabled, title, small, type = 'button', busy }: {
  children?: ReactNode; onClick?: () => void; kind?: 'default' | 'primary' | 'danger' | 'ghost' | 'accent'; icon?: string; disabled?: boolean; title?: string; small?: boolean; type?: 'button' | 'submit'; busy?: boolean;
}) {
  return (
    <button type={type} className={`btn ${kind}${small ? ' sm' : ''}${busy ? ' busy' : ''}`} onClick={onClick} disabled={disabled || busy} title={title} aria-label={!children ? title : undefined}>
      {icon && <Icon name={icon} size={small ? 13 : 15} />}{children && <span>{children}</span>}
    </button>
  );
}

export function Modal({ title, children, onClose, footer, wide }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><Btn kind="ghost" icon="close" title="Close" onClick={onClose} /></header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'blue' | 'green' | 'red' | 'amber' | 'orange' | 'violet' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return <div className="empty"><Icon name={icon} size={28} /><strong>{title}</strong>{children && <div>{children}</div>}</div>;
}

/** Ask before doing something destructive (no browser confirm dialogs). */
export function Confirm({ text, onYes, onNo, yes = 'Delete', danger = true }: { text: ReactNode; onYes: () => void; onNo: () => void; yes?: string; danger?: boolean }) {
  return (
    <Modal title="Please confirm" onClose={onNo} footer={<><Btn onClick={onNo}>Cancel</Btn><Btn kind={danger ? 'danger' : 'primary'} onClick={onYes}>{yes}</Btn></>}>
      <div className="confirm-text">{text}</div>
    </Modal>
  );
}
