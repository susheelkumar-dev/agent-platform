/**
 * The files this display generates, as the generator will write them. Generated files are read-only (they are
 * rewritten every time). Developer files are written only when missing: before that, their starting content can
 * be edited here and is passed to Generate.
 */
import { useMemo, useState } from 'react';
import { transform } from 'sucrase';
import { kebab } from '../naming';
import { useStore } from '../store';
import type { GeneratedFile } from '../types';
import { Badge, Btn, Empty } from '../ui/controls';
import { CodeEditor, type Diagnostic } from '../ui/CodeEditor';
import { Icon } from '../ui/Icon';

export function syntaxCheck(path: string, text: string): Diagnostic[] {
  if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(path)) return [];
  try {
    const ts = /\.tsx?$/.test(path);
    transform(text, { transforms: [...(ts ? ['typescript' as const] : []), ...(/x$/.test(path) || ts ? ['jsx' as const] : [])], filePath: path });
    return [];
  } catch (e: any) {
    const line = e?.loc?.line ?? 1;
    const col = e?.loc?.column ?? 0;
    const lines = text.split('\n');
    let from = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) from += lines[i].length + 1;
    from = Math.min(text.length, from + col);
    return [{ from, to: Math.min(text.length, from + 1), severity: 'error', message: String(e?.message || e).replace(/\s*\(\d+:\d+\)$/, '') }];
  }
}

const langOf = (p: string) => (p.endsWith('.json') ? 'json' : p.endsWith('.tsx') ? 'tsx' : p.endsWith('.ts') ? 'ts' : 'js') as 'ts' | 'tsx' | 'js' | 'json';

export function CodeView() {
  const s = useStore();
  const files = s.preview?.files || [];
  const [key, setKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<'mine' | 'all'>('mine');
  const d = s.doc!.display;
  const mine = useMemo(() => {
    // the same paths as workspace.entity_path / display_path on the server
    const sources = new Set([`src/modules/${d.module}/ui-forge/${kebab(d.name)}.display.json`,
      ...Object.values(s.doc!.entities).map((e) => `src/modules/${e.module}/ui-forge/${kebab(e.name)}.entity.json`)]);
    return files.filter((f) => filter === 'all' || sources.has(f.source) || f.owner === 'block' || f.source === 'workspace');
  }, [files, filter, d.id, s.doc]);
  const cur = mine.find((f) => f.key === key) || mine[0];
  const groups = useMemo(() => {
    const g: Record<string, GeneratedFile[]> = {};
    for (const f of mine) (g[f.root === 'app' ? 'React app' : f.root === 'api' ? 'API' : f.root] ||= []).push(f);
    return g;
  }, [mine]);

  if (!files.length) return <Empty icon="code" title={s.previewing ? 'Generating…' : 'No files yet'}>{s.preview?.issues.some((i) => i.level === 'error') ? 'Fix the errors in the Issues panel; the generator needs a valid display.' : 'Files appear here as you design.'}</Empty>;

  const editable = cur && cur.owner === 'developer' && !cur.exists;
  const text = cur ? s.overrides[cur.key] ?? cur.content : '';
  const diags = cur ? syntaxCheck(cur.path, text) : [];
  return (
    <div className="codeview">
      <aside className="cv-files">
        <div className="cv-filter">
          <button type="button" className={filter === 'mine' ? 'on' : ''} onClick={() => setFilter('mine')}>This display</button>
          <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All ({files.length})</button>
        </div>
        {Object.entries(groups).map(([g, list]) => (
          <div key={g} className="cv-group">
            <h4>{g}</h4>
            {list.map((f) => (
              <button key={f.key} type="button" className={'cv-file' + (cur?.key === f.key ? ' on' : '')} onClick={() => setKey(f.key)} title={f.path}>
                <Icon name={f.owner === 'developer' ? 'pencil' : f.owner === 'block' ? 'link' : 'lock'} size={12} />
                <span className="cv-name">{f.path.split('/').pop()}</span>
                <span className="cv-dir">{f.path.split('/').slice(0, -1).join('/')}</span>
                {s.overrides[f.key] !== undefined && <span className="dot" title="edited here" />}
              </button>
            ))}
          </div>
        ))}
        <div className="cv-legend">
          <span><Icon name="lock" size={11} /> generated — rewritten every time</span>
          <span><Icon name="pencil" size={11} /> yours — written once, never overwritten</span>
          <span><Icon name="link" size={11} /> marked block inside your file</span>
        </div>
      </aside>
      {cur && (
        <section className="cv-main">
          <header className="cv-head">
            <span className="mono">{cur.root}/{cur.path}</span>
            {cur.owner === 'generated' && <Badge tone="blue">generated</Badge>}
            {cur.owner === 'developer' && (cur.exists ? <Badge tone="green">yours · exists, kept as is</Badge> : <Badge tone="orange">yours · created on Generate</Badge>)}
            {cur.owner === 'block' && <Badge tone="violet">block between ui-forge markers</Badge>}
            <span className="spacer" />
            {diags.length ? <span className="cv-err"><Icon name="error" size={13} /> {diags[0].message}</span> : <span className="cv-ok"><Icon name="ok" size={13} /> syntax OK</span>}
            {s.overrides[cur.key] !== undefined && <Btn small kind="ghost" icon="undo" onClick={() => s.setOverride(cur.key, null)}>Back to the template</Btn>}
            <Btn small kind="ghost" icon="copy" onClick={() => { void navigator.clipboard?.writeText(text); s.notify('Copied'); }}>Copy</Btn>
          </header>
          {cur.owner === 'developer' && cur.exists && <div className="cv-note"><Icon name="info" size={12} /> This file exists in the project and belongs to you: Generate never touches it. Shown is the starting template, for reference.</div>}
          {editable && <div className="cv-note accent"><Icon name="pencil" size={12} /> Edit the starting code here (business rules, hooks); it is written once by Generate. After that, change it in your editor.</div>}
          <div className="cv-editor">
            <CodeEditor key={cur.key} value={text} language={langOf(cur.path)} readOnly={!editable} check={(t) => syntaxCheck(cur.path, t)}
              onChange={(v) => { if (editable) s.setOverride(cur.key, v === cur.content ? null : v); }} ariaLabel={cur.path} />
          </div>
        </section>
      )}
    </div>
  );
}
