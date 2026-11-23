/** UI Forge: the builder shell. */
import { useEffect, useState } from 'react';
import { setForgeToken } from './api';
import { EntryCanvas } from './canvas/EntryCanvas';
import { MasterSlaveCanvas } from './canvas/MasterSlaveCanvas';
import { SummaryCanvas } from './canvas/SummaryCanvas';
import { Inspector } from './inspector/Inspector';
import { selectionForIssue } from './layout';
import { duplicateSelected, nudgeSelected, removeSelected } from './ops';
import { Preview } from './preview/Preview';
import { LeftRail } from './rail/LeftRail';
import { useStore, type Mode } from './store';
import { Badge, Btn, Confirm, Modal } from './ui/controls';
import { Icon } from './ui/Icon';
import { CodeView } from './views/CodeView';
import { GenerateView } from './views/GenerateView';
import { Home } from './views/Home';
import { NewDisplay } from './views/NewDisplay';
import { SchemaView } from './views/SchemaView';

const MODES: { value: Mode; label: string; icon: string; key: string }[] = [
  { value: 'design', label: 'Design', icon: 'pencil', key: '1' },
  { value: 'preview', label: 'Preview', icon: 'eye', key: '2' },
  { value: 'code', label: 'Code', icon: 'code', key: '3' },
  { value: 'schema', label: 'Schema', icon: 'braces', key: '4' },
  { value: 'generate', label: 'Generate', icon: 'anvil', key: '5' },
];

export function App() {
  const s = useStore();
  const [wizard, setWizard] = useState(false);
  const [leaving, setLeaving] = useState<null | (() => void)>(null);
  const [help, setHelp] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);

  // keyboard: save, undo/redo, modes, and canvas operations on the selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select, .cm-editor');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (s.doc && s.dirty) void s.save(); return; }
      if (!s.doc) return;
      if (mod && /^[1-5]$/.test(e.key)) { e.preventDefault(); s.setMode(MODES[Number(e.key) - 1].value); return; }
      if (typing) return;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); s.undo(); return; }
      if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); s.redo(); return; }
      if (s.mode !== 'design') return;
      const run = (f: typeof removeSelected) => {
        let msg: string | null = null;
        s.edit((doc) => { const r = f(doc, s.selection); if (typeof r === 'string') msg = r; else s.select(r); });
        if (msg) s.notify(msg, 'warning');
      };
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); run(removeSelected); }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); run(duplicateSelected); }
      else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); run((d, x) => nudgeSelected(d, x, -1)); }
      else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); run((d, x) => nudgeSelected(d, x, 1)); }
      else if (e.key === 'Escape') s.select({ kind: 'display' });
      else if (e.key === '?') setHelp(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (s.dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [s.dirty]);

  if (!s.ready) return <div className="boot"><Logo /> Loading…</div>;
  if (s.needsToken) return <TokenGate />;
  if (s.fatal) return <div className="boot err"><Logo /><div><b>UI Forge service is not reachable.</b><p>{s.fatal}</p><p className="muted">Start it with <code>ui-forge serve --app &lt;react app&gt; --api &lt;api root&gt;</code>.</p><Btn onClick={() => void s.reload()}>Retry</Btn></div></div>;

  const guard = (go: () => void) => { if (s.dirty) setLeaving(() => go); else go(); };
  const issues = s.preview?.issues || [];
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.length - errors;

  return (
    <div className="forge">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => guard(s.close)} title="All displays"><Logo /><span>UI Forge</span></button>
        <span className="app-chip" title={s.project?.appRoot}><Icon name="layers" size={12} /> {s.project?.appId}</span>
        {s.doc && (
          <>
            <span className="doc-title">
              <b>{s.doc.display.title}</b>
              <Badge tone={s.doc.display.type === 'summary' ? 'blue' : s.doc.display.type === 'entry' ? 'green' : 'violet'}>{s.doc.display.type}</Badge>
              {!s.origId ? <Badge tone="orange">new · unsaved</Badge> : s.dirty ? <span className="dirty" title="Unsaved changes">● unsaved</span> : <span className="muted">saved</span>}
            </span>
            <nav className="modes" role="tablist" aria-label="View">
              {MODES.map((m) => <button key={m.value} role="tab" aria-selected={s.mode === m.value} className={s.mode === m.value ? 'on' : ''} onClick={() => s.setMode(m.value)} title={`${m.label} (Ctrl+${m.key})`}><Icon name={m.icon} size={14} /><span>{m.label}</span></button>)}
            </nav>
          </>
        )}
        <span className="spacer" />
        {s.doc && (
          <>
            <button type="button" className={'issue-btn' + (errors ? ' bad' : warnings ? ' warn' : ' ok')} onClick={() => setIssuesOpen(!issuesOpen)} title="Validation">
              {s.previewing ? <Icon name="refresh" size={13} className="spin" /> : <Icon name={errors ? 'error' : warnings ? 'warn' : 'ok'} size={13} />}
              {errors ? `${errors} error${errors > 1 ? 's' : ''}` : warnings ? `${warnings} warning${warnings > 1 ? 's' : ''}` : 'Valid'}
            </button>
            <Btn small kind="ghost" icon="undo" title="Undo (Ctrl+Z)" disabled={!s.canUndo} onClick={s.undo} />
            <Btn small kind="ghost" icon="redo" title="Redo (Ctrl+Y)" disabled={!s.canRedo} onClick={s.redo} />
            {s.dirty && s.origId && <Btn small kind="ghost" onClick={() => setLeaving(() => s.discard)}>Discard</Btn>}
            <Btn small kind="primary" icon="save" disabled={!s.dirty} onClick={() => void s.save()} title="Save (Ctrl+S)">Save</Btn>
          </>
        )}
        {!s.doc && <Btn small kind="accent" icon="plus" onClick={() => setWizard(true)}>New display</Btn>}
        <Btn small kind="ghost" icon="keyboard" title="Shortcuts (?)" onClick={() => setHelp(true)} />
      </header>

      {!s.doc ? <Home /> : (
        <div className={'workspace m-' + s.mode}>
          {s.mode === 'design' && <LeftRail />}
          <main className="center" onClick={() => s.mode === 'design' && s.select({ kind: 'display' })}>
            {s.mode === 'design' && <Canvas />}
            {s.mode === 'preview' && <Preview />}
            {s.mode === 'code' && <CodeView />}
            {s.mode === 'schema' && <SchemaView />}
            {s.mode === 'generate' && <GenerateView />}
          </main>
          {s.mode === 'design' && <Inspector />}
          {issuesOpen && <IssuesPanel onClose={() => setIssuesOpen(false)} />}
        </div>
      )}

      <div className="toasts" aria-live="polite">{s.toasts.map((t) => <div key={t.id} className={'toast ' + t.kind}><Icon name={t.kind === 'error' ? 'error' : t.kind === 'warning' ? 'warn' : t.kind === 'success' ? 'ok' : 'info'} size={14} />{t.text}</div>)}</div>
      {wizard && <NewDisplay onClose={() => setWizard(false)} />}
      {leaving && <Confirm text="You have unsaved changes. Leave them?" yes="Discard changes" onNo={() => setLeaving(null)} onYes={() => { const go = leaving; setLeaving(null); go(); }} />}
      {help && <Shortcuts onClose={() => setHelp(false)} />}
    </div>
  );
}

function Canvas() {
  const s = useStore();
  const d = s.doc!.display;
  return (
    <div className="canvas-wrap">
      <div className={'canvas t-' + d.type}>
        <div className="canvas-title" onClick={(e) => { e.stopPropagation(); s.select({ kind: 'display' }); }}>
          <Icon name="file" size={14} /> <b>{d.title}</b>
          <button type="button" className="mini-link" onClick={(e) => { e.stopPropagation(); s.select({ kind: 'menu' }); }}><Icon name="menu" size={12} /> {d.menu ? d.menu.title : 'not in the menu'}</button>
          <span className="mono muted">#/{d.route || 'd/' + d.id}</span>
        </div>
        {d.type === 'entry' && <EntryCanvas panel="entry" />}
        {d.type === 'summary' && <SummaryCanvas panel="summary" />}
        {d.type === 'master-slave' && d.masterSlave && <MasterSlaveCanvas />}
      </div>
    </div>
  );
}

function IssuesPanel({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const issues = s.preview?.issues || [];
  return (
    <section className="issues" aria-label="Issues">
      <header><b>Issues</b><span className="muted">checked against the app as you type</span><span className="spacer" /><Btn small kind="ghost" icon="close" title="Close" onClick={onClose} /></header>
      {!issues.length && <p className="ok-line"><Icon name="ok" size={14} /> No problems: the display, its entities, menu, permissions and routes are consistent with the app.</p>}
      <ul>
        {issues.map((i, k) => (
          <li key={k} className={i.level}>
            <button type="button" onClick={() => { const sel = selectionForIssue(s.doc!.display, i.path, i.where); if (sel) { s.setMode('design'); s.select(sel); } }}>
              <Icon name={i.level === 'error' ? 'error' : 'warn'} size={13} />
              <span className="mono where">{i.where}{i.path ? ' · ' + i.path : ''}</span>
              <span>{i.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TokenGate() {
  const s = useStore();
  const [t, setT] = useState('');
  return (
    <div className="boot">
      <form className="gate" onSubmit={(e) => { e.preventDefault(); setForgeToken(t); void s.reload(); }}>
        <Logo /><h2>UI Forge</h2>
        <p>This builder is protected by <code>UI_FORGE_TOKEN</code>. Enter the token configured on the server.</p>
        <input className="in" type="password" value={t} onChange={(e) => setT(e.target.value)} aria-label="Token" autoFocus />
        <Btn kind="primary" type="submit">Continue</Btn>
      </form>
    </div>
  );
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Ctrl+S', 'Save'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+1…5', 'Design, Preview, Code, Schema, Generate'],
    ['Delete', 'Remove the selection from the layout'], ['Ctrl+D', 'Duplicate (a field becomes a new entity field)'], ['Alt+↑ / Alt+↓', 'Move the selection'],
    ['Esc', 'Select the display'], ['Click a control', 'Add it next to the selection (no dragging needed)'], ['Double-click a field', 'Place it on the form or grid'],
    ['Drag a field edge', 'Change how many columns it spans'], ['Drag a column edge', 'Change the column width'], ['Arrow keys on the splitter', 'Resize Master-Slave panes'],
  ];
  return <Modal title="Keyboard and mouse" onClose={onClose}><table className="keys"><tbody>{rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table></Modal>;
}

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden className="logo">
      <rect width="32" height="32" rx="7" fill="#121a24" />
      <path d="M8 21h16l-3 4H11z" fill="#f08a24" />
      <path d="M10 9h12v3H14v3h7v3h-7v3h-4z" fill="#fff" />
    </svg>
  );
}
