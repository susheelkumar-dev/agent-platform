/**
 * Generate: plan (what changes, with diffs) → apply (writes files, keeps backups) → register the menu →
 * build and API tests → integration checklist. Generation always works from the saved documents.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, type ChecklistItem, type StageResult } from '../api';
import { useStore } from '../store';
import type { PlanChange, PlanResult } from '../types';
import { Badge, Btn, Empty, Toggle } from '../ui/controls';
import { Icon } from '../ui/Icon';

const TONE: Record<string, 'green' | 'blue' | 'gray' | 'red' | 'amber' | 'violet'> = { create: 'green', update: 'blue', unchanged: 'gray', conflict: 'red', keep: 'violet', orphan: 'amber', retire: 'amber' };
const WHAT: Record<string, string> = {
  create: 'new file', update: 'regenerated (you have not edited it)', unchanged: 'no change', conflict: 'generated file you edited — skipped unless you overwrite it',
  keep: 'your file — never overwritten', orphan: 'no longer generated — deleted only with “delete orphans”',
  retire: 'your file, but its display or entity is gone — “delete orphans” moves it to .ui-forge/retired (never deleted)',
};

export function GenerateView() {
  const s = useStore();
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [blocked, setBlocked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prune, setPrune] = useState(false);
  const [force, setForce] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [result, setResult] = useState<{ written: string[]; skipped: string[]; deleted: string[]; backups: string[]; retired?: string[] } | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; output: string }>>({});
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [staged, setStaged] = useState<StageResult | null>(null);

  const doStage = async () => {
    if (!s.doc) return;
    setBusy('stage');
    try {
      const r = await api.stage(s.doc.display.id, s.overrides);
      setStaged(r);
      s.notify(`Staged ${r.files.length} file(s) for review in ${r.folder}`, 'success');
    } catch (e) { s.notify(`Staging failed: ${(e as Error).message}`, 'error'); } finally { setBusy(null); }
  };
  const [reg, setReg] = useState<any[] | null>(null);

  const doPlan = async (keepResult = false) => {
    setBusy('plan'); if (!keepResult) setResult(null);
    try {
      const r = await api.plan({ prune, overrides: s.overrides });
      if (r.blocked) { setBlocked(r.issues.filter((i) => i.level === 'error').map((i) => `${i.where} ${i.path}: ${i.message}`)); setPlan(null); }
      else { setBlocked(null); setPlan(r.plan!); setForce(new Set()); }
    } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  useEffect(() => { if (!s.dirty) void doPlan(); }, [prune]); // eslint-disable-line react-hooks/exhaustive-deps

  const doApply = async () => {
    if (!plan) return;
    setBusy('apply');
    try {
      const r = await api.apply({ hash: plan.hash, force: [...force], prune, overrides: s.overrides });
      setResult(r.result);
      await doPlan(true); // the plan after writing: everything should now be unchanged / keep
      s.notify(`Wrote ${r.result.written.length} file(s)${r.result.backups.length ? `, ${r.result.backups.length} backup(s)` : ''}`, 'success');
      for (const k of Object.keys(s.overrides)) if (r.result.written.includes(k)) s.setOverride(k, null);
      void s.reload(true);
      void runChecklist();
    } catch (e) {
      s.notify(`Apply failed: ${(e as Error).message}`, 'error');
      if ((e as any).status === 409) void doPlan();
    } finally { setBusy(null); }
  };

  const runTest = async (k: 'build' | 'api') => {
    setBusy(k);
    try { const r = await api.test(k); setTests((t) => ({ ...t, [k]: r })); s.notify(`${k === 'build' ? 'Type check' : 'API tests'} ${r.ok ? 'passed' : 'failed'}`, r.ok ? 'success' : 'error'); }
    catch (e) { setTests((t) => ({ ...t, [k]: { ok: false, output: (e as Error).message } })); } finally { setBusy(null); }
  };
  const runChecklist = async () => { try { setChecklist((await api.checklist()).items); } catch (e) { s.notify((e as Error).message, 'error'); } };
  const doRegister = async (dry: boolean) => {
    setBusy('register');
    try { const r = await api.register(dry); setReg(r.results); s.notify(dry ? 'Registration checked (dry run)' : 'Registered with the display registry', 'success'); void runChecklist(); }
    catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(null); }
  };

  const visible = useMemo(() => (plan?.changes || []).filter((c) => showAll || (c.status !== 'unchanged' && c.status !== 'keep')), [plan, showAll]);
  const conflicts = plan?.changes.filter((c) => c.status === 'conflict') || [];
  const toWrite = (plan?.changes || []).filter((c) => c.status === 'create' || c.status === 'update' || (c.status === 'conflict' && force.has(c.key)) || ((c.status === 'orphan' || c.status === 'retire') && prune));

  return (
    <div className="genview">
      <ol className="gen-steps">
        <Step n={1} title="Save the design" done={!s.dirty} active={s.dirty}>
          {s.dirty ? <><p>Generation uses saved documents.</p><Btn kind="primary" icon="save" onClick={() => void s.save().then((ok) => { if (ok) void doPlan(); })}>Save now</Btn></> : <p className="muted">Saved{s.origId ? ` as ${s.origId}` : ''}.</p>}
        </Step>
        <Step n={2} title="Review the plan" done={!!plan && !blocked} active={!s.dirty && !result}>
          <p className="muted">Every file, its owner and a diff. Nothing is written yet.</p>
          <Toggle value={prune} onChange={setPrune} label="Delete orphans (files no longer generated)" />
          <Btn icon="refresh" busy={busy === 'plan'} onClick={() => doPlan()} disabled={s.dirty}>Re-plan</Btn>
        </Step>
        <Step n={3} title="Generate the code" done={!!result || !!staged} active={!!plan && !result && !staged}>
          <p className="muted"><b>Stage for review</b> writes this display's code and a README (what each file is, where it goes,
            how to register and test) to <span className="mono">ui-forge-out/</span>: nothing goes into the project.</p>
          <Btn kind="accent" icon="download" busy={busy === 'stage'} disabled={s.dirty || !s.origId} onClick={doStage}>Stage for review</Btn>
          <p className="muted">Or write straight into the project ({toWrite.length} file(s); overwritten files are backed up):</p>
          <Btn icon="anvil" busy={busy === 'apply'} disabled={!plan || s.dirty || !!blocked} onClick={doApply}>Apply to project</Btn>
        </Step>
        <Step n={4} title="Register the menu" done={!!reg?.every((r) => r.status < 300)} active={!!result}>
          <p className="muted">Sends the manifest to the display registry so the menu entry appears.</p>
          {!s.appUser && <p className="warn-text"><Icon name="lock" size={12} /> Sign in to the app first (Preview → Live API).</p>}
          <div className="row-btns"><Btn small busy={busy === 'register'} disabled={!s.appUser} onClick={() => doRegister(true)}>Dry run</Btn><Btn small kind="primary" busy={busy === 'register'} disabled={!s.appUser} onClick={() => doRegister(false)}>Register</Btn></div>
        </Step>
        <Step n={5} title="Verify" done={!!tests.build?.ok && !!tests.api?.ok} active={!!result}>
          <div className="row-btns">
            <Btn small icon="code" busy={busy === 'build'} onClick={() => runTest('build')}>Type-check app</Btn>
            {s.project?.backend !== 'none' && <Btn small icon="shield" busy={busy === 'api'} onClick={() => runTest('api')}>API tests</Btn>}
            <Btn small icon="checklist" onClick={runChecklist}>Checklist</Btn>
          </div>
          <a className="btn ghost sm" href={api.packageUrl()} download><Icon name="download" size={13} /><span>Download package (.zip)</span></a>
        </Step>
      </ol>

      <section className="gen-main">
        {s.dirty && <Empty icon="save" title="Unsaved changes">Save to plan the generation. The Code tab shows the files of the unsaved design.</Empty>}
        {blocked && (
          <div className="gen-block"><h3><Icon name="error" size={16} /> Generation is blocked</h3><p>The saved workspace has errors (all displays are checked, not only this one):</p><ul>{blocked.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
        )}
        {staged && (
          <div className="gen-result staged">
            <h3><Icon name="ok" size={16} /> Staged for review</h3>
            <p>Folder: <span className="mono">{staged.folder}</span>{staged.previous && <span className="muted"> (previous staging kept in <span className="mono">{staged.previous}</span>)</span>}</p>
            <table className="stage-table">
              <thead><tr><th>File</th><th>Owner</th><th>What to do</th></tr></thead>
              <tbody>{staged.files.map((f) => (
                <tr key={f.root + f.path} title={f.role}><td className="mono">{f.root}/{f.path}</td><td><Badge tone={f.owner === 'developer' ? 'violet' : f.owner === 'shared' ? 'amber' : f.owner === 'design' ? 'gray' : 'blue'}>{f.owner}</Badge></td><td>{f.action}</td></tr>
              ))}</tbody>
            </table>
            <details open><summary>README.md (in the folder)</summary><pre className="out readme">{staged.readme}</pre></details>
          </div>
        )}
        {result && (
          <div className="gen-result">
            <h3><Icon name="ok" size={16} /> Generated</h3>
            <div className="gr-cols">
              <div><b>{result.written.length}</b> written</div><div><b>{result.skipped.length}</b> skipped</div><div><b>{result.deleted.length}</b> deleted</div><div><b>{result.backups.length}</b> backups</div>{!!result.retired?.length && <div><b>{result.retired.length}</b> moved aside</div>}
            </div>
            {result.skipped.length > 0 && <details><summary>Skipped</summary><ul className="mono">{result.skipped.map((x) => <li key={x}>{x}</li>)}</ul></details>}
            {!!result.retired?.length && <details open><summary>Your files moved to .ui-forge/retired</summary><ul className="mono">{result.retired.map((x) => <li key={x}>{x}</li>)}</ul></details>}
            {result.backups.length > 0 && <details><summary>Backups</summary><ul className="mono">{result.backups.map((x) => <li key={x}>{x}</li>)}</ul></details>}
            <p className="muted">Next: register the menu and type-check the app{s.project?.backend === 'none' ? '; give the API contracts (src/modules/…/api/*.api.md) to the backend team' : ' and run the API tests'}. Business rules go in the files marked “yours”.</p>
          </div>
        )}
        {plan && !s.dirty && (
          <div className="plan">
            <div className="plan-head">
              {Object.entries(plan.counts).filter(([, n]) => n).map(([k, n]) => <span key={k} className="plan-count"><Badge tone={TONE[k]}>{k}</Badge> {n}</span>)}
              <span className="spacer" />
              <label className="tog-inline"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show unchanged and kept</label>
              <span className="mono muted" title="Plan hash: Generate refuses if the files changed after this plan">#{plan.hash.slice(0, 10)}</span>
            </div>
            {plan.problems.length > 0 && <ul className="plan-problems">{plan.problems.map((p, i) => <li key={i}><Icon name="warn" size={12} /> {p}</li>)}</ul>}
            {conflicts.length > 0 && <p className="plan-conflict"><Icon name="warn" size={13} /> {conflicts.length} generated file(s) were edited by hand. They are skipped unless you tick “overwrite” (a backup is kept). Better: move the change into the hooks file.</p>}
            <div className="plan-list">
              {visible.map((c) => <ChangeRow key={c.key} c={c} open={open === c.key} onToggle={() => setOpen(open === c.key ? null : c.key)} forced={force.has(c.key)}
                onForce={(v) => setForce((f) => { const n = new Set(f); if (v) n.add(c.key); else n.delete(c.key); return n; })} />)}
              {!visible.length && <p className="muted">Everything is up to date.</p>}
            </div>
          </div>
        )}
        {(reg || Object.keys(tests).length > 0 || checklist) && (
          <div className="verify">
            {reg && <div className="vbox"><h4>Registry</h4>{reg.map((r, i) => <div key={i} className={r.status < 300 ? 'okline' : 'badline'}><span className="mono">{r.file}</span> → {r.status} {r.report?.message || r.report?.status || ''}</div>)}</div>}
            {Object.entries(tests).map(([k, t]) => <div key={k} className="vbox"><h4>{k === 'build' ? 'Type check (tsc)' : 'API tests'} <Badge tone={t.ok ? 'green' : 'red'}>{t.ok ? 'passed' : 'failed'}</Badge></h4><pre className="out">{t.output.slice(-6000) || '(no output)'}</pre></div>)}
            {checklist && (
              <div className="vbox">
                <h4>Integration checklist</h4>
                {checklist.map((c) => (
                  <div key={c.id} className={'ck ck-' + c.status}>
                    <Icon name={c.status === 'ok' ? 'ok' : c.status === 'todo' ? 'warn' : 'info'} size={14} />
                    <div><b>{c.title}</b><div className="muted">{c.detail}</div>{c.status !== 'ok' && c.fix && <div className="ck-fix">{c.fix}</div>}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children: React.ReactNode }) {
  return (
    <li className={'gstep' + (done ? ' done' : '') + (active ? ' active' : '')}>
      <span className="gnum">{done ? <Icon name="ok" size={14} /> : n}</span>
      <div><h4>{title}</h4>{children}</div>
    </li>
  );
}

function ChangeRow({ c, open, onToggle, forced, onForce }: { c: PlanChange; open: boolean; onToggle: () => void; forced: boolean; onForce: (v: boolean) => void }) {
  return (
    <div className={'chg s-' + c.status + (open ? ' open' : '')}>
      <button type="button" className="chg-row" onClick={onToggle} aria-expanded={open}>
        <Icon name="chevron" size={12} className="chev" />
        <Badge tone={TONE[c.status]}>{c.status}</Badge>
        <span className="mono chg-path">{c.root}/{c.path}</span>
        <span className="chg-owner">{c.owner}</span>
      </button>
      {c.status === 'conflict' && <label className="chg-force"><input type="checkbox" checked={forced} onChange={(e) => onForce(e.target.checked)} /> overwrite (backup kept)</label>}
      {open && (
        <div className="chg-body">
          <p className="muted">{WHAT[c.status]}{c.note ? ` · ${c.note}` : ''}</p>
          {c.diff ? <Diff text={c.diff} /> : <p className="muted">No diff.</p>}
        </div>
      )}
    </div>
  );
}

export function Diff({ text }: { text: string }) {
  const lines = text.split('\n').slice(0, 1500);
  return (
    <pre className="diff">{lines.map((l, i) => <div key={i} className={l.startsWith('+++') || l.startsWith('---') ? 'dh' : l.startsWith('@@') ? 'dat' : l.startsWith('+') ? 'dadd' : l.startsWith('-') ? 'ddel' : ''}>{l || ' '}</div>)}</pre>
  );
}
