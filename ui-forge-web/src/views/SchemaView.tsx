/** The raw documents (display + entities) as JSON: edit, validate, apply; import and export. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { Display, Entity, Issue } from '../types';
import { Btn, Segmented } from '../ui/controls';
import { CodeEditor, type Diagnostic } from '../ui/CodeEditor';
import { Icon } from '../ui/Icon';

export function SchemaView() {
  const s = useStore();
  const docs = useMemo(() => ({ display: s.doc!.display, ...Object.fromEntries(Object.entries(s.doc!.entities).map(([k, v]) => ['entity:' + k, v])) }), [s.doc]);
  const keys = Object.keys(docs);
  const [which, setWhich] = useState('display');
  const original = JSON.stringify((docs as any)[which] ?? null, null, 2);
  const [text, setText] = useState(original);
  const [issues, setIssues] = useState<Issue[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(original); setIssues([]); }, [original]);

  let parsed: any = null;
  let parseError: string | null = null;
  try { parsed = JSON.parse(text); } catch (e) { parseError = (e as Error).message; }

  useEffect(() => {
    if (!parsed || text === original) { setIssues([]); return; }
    const t = setTimeout(() => { api.parse(parsed).then((r) => setIssues(r.issues)).catch(() => undefined); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const check = (t: string): Diagnostic[] => {
    try { JSON.parse(t); return []; } catch (e) {
      const m = /position (\d+)/.exec((e as Error).message);
      const at = m ? Number(m[1]) : 0;
      return [{ from: at, to: Math.min(t.length, at + 1), severity: 'error', message: (e as Error).message }];
    }
  };

  const apply = () => {
    if (!parsed) return;
    s.edit((doc) => {
      if (which === 'display') doc.display = parsed as Display;
      else {
        const n = which.slice(7);
        delete doc.entities[n];
        doc.entities[(parsed as Entity).name] = parsed as Entity;
      }
    }, { select: { kind: 'display' } });
    s.notify('Applied to the design (undo with Ctrl+Z)', 'success');
  };

  const exportAll = () => {
    const bundle = { uiForge: '1.0', exportedAt: new Date().toISOString(), entities: Object.values(s.doc!.entities), displays: [s.doc!.display] };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${s.doc!.display.id}.ui-forge.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="schemaview">
      <header className="sv-head">
        <Segmented value={which} onChange={setWhich} options={keys.map((k) => ({ value: k, label: k === 'display' ? 'Display' : k.slice(7), icon: k === 'display' ? 'file' : 'db' }))} />
        <span className="spacer" />
        {parseError ? <span className="cv-err"><Icon name="error" size={13} /> {parseError}</span>
          : issues.length ? <span className="cv-err"><Icon name="warn" size={13} /> {issues.length} schema problem(s)</span>
            : <span className="cv-ok"><Icon name="ok" size={13} /> {text === original ? 'in sync with the design' : 'valid'}</span>}
        <Btn small kind="ghost" onClick={() => setText(original)} disabled={text === original}>Revert</Btn>
        <Btn small kind="primary" icon="right" onClick={apply} disabled={!!parseError || text === original || issues.some((i) => i.level === 'error')}>Apply to design</Btn>
        <Btn small kind="ghost" icon="download" onClick={exportAll}>Export bundle</Btn>
        <Btn small kind="ghost" icon="upload" onClick={() => fileRef.current?.click()}>Import</Btn>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          try {
            const b = JSON.parse(await f.text());
            const ds: Display[] = b.displays || (b.kind === 'display' ? [b] : []);
            const es: Entity[] = b.entities || (b.kind === 'entity' ? [b] : []);
            if (!ds.length && !es.length) throw new Error('no displays or entities in the file');
            if (ds.length) s.create(ds[0], es);
            else s.edit((doc) => { es.forEach((x) => { doc.entities[x.name] = x; }); });
            s.notify(`Imported ${ds.length} display(s), ${es.length} entit${es.length === 1 ? 'y' : 'ies'} — review, then Save`, 'success');
          } catch (err) { s.notify(`Import failed: ${(err as Error).message}`, 'error'); }
        }} />
      </header>
      {issues.length > 0 && <ul className="sv-issues">{issues.map((i, k) => <li key={k}><span className="mono">{i.path}</span> {i.message}</li>)}</ul>}
      <div className="cv-editor"><CodeEditor value={text} onChange={setText} language="json" check={check} ariaLabel="Schema JSON" /></div>
    </div>
  );
}
