/** Start page: the UI Forge displays in this app, the app's other displays, and project facts. */
import { useMemo, useState } from 'react';
import { api } from '../api';
import { entitiesOf, useStore } from '../store';
import { Badge, Btn, Confirm, Empty } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { NewDisplay } from './NewDisplay';

export function Home() {
  const s = useStore();
  const [wizard, setWizard] = useState(false);
  const [del, setDel] = useState<string | null>(null);
  const [delEnt, setDelEnt] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const displays = Object.values(s.saved.displays).filter((d) => !q || (d.title + d.id + d.module).toLowerCase().includes(q.toLowerCase()));
  const byModule = useMemo(() => {
    const m: Record<string, typeof displays> = {};
    displays.forEach((d) => (m[d.module] ||= []).push(d));
    return Object.entries(m).sort();
  }, [displays]);
  const issuesFor = (id: string) => s.workspaceIssues.filter((i) => i.where === `display:${id}` && i.level === 'error').length;
  const others = (s.inventory?.displays || []).filter((d) => !d.forge);
  const p = s.project;
  let last: string | null = null;
  try { last = localStorage.getItem('uiforge.last'); } catch { /* ignore */ }

  return (
    <div className="home">
      <section className="hero">
        <div>
          <h1>Design screens. Generate the code. Keep your logic.</h1>
          <p>Summary grids, Entry forms and Master-Slave screens for <b>{p?.appId}</b>, rendered by the same framework the migrated React app runs — with a generated, permission-checked API and code you own.</p>
          <div className="hero-btns">
            <Btn kind="accent" icon="plus" onClick={() => setWizard(true)}>New display</Btn>
            {last && s.saved.displays[last] && <Btn icon="open" onClick={() => s.open(last!)}>Continue with {s.saved.displays[last].title}</Btn>}
          </div>
        </div>
        <dl className="facts">
          <dt>React app</dt><dd className="mono" title={p?.appRoot}>{p?.appRoot}</dd>
          <dt>API</dt><dd className="mono" title={p?.apiRoot || ''}>{p?.apiRoot || '— not set (frontend only)'}</dd>
          {p?.mirrorRoot && <><dt>Mirror</dt><dd className="mono">{p.mirrorRoot}</dd></>}
          <dt>Backend</dt><dd>{p?.backend === 'gridtrade-node' ? 'Node API with the UI Forge seam' : p?.backend || 'none'}</dd>
          <dt>Registry</dt><dd className="mono">{p?.registryUrl}</dd>
          <dt>Inventory</dt><dd>{s.inventory?.menus.length ?? 0} menu entries · {s.inventory?.permissions.length ?? 0} permission modules · {s.inventory?.lookups.length ?? 0} lookups</dd>
        </dl>
      </section>

      <section className="home-list">
        <header>
          <h2>UI Forge displays <span className="muted">{Object.keys(s.saved.displays).length}</span></h2>
          <div className="rail-search"><Icon name="search" size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter displays" /></div>
        </header>
        {!displays.length && <Empty icon="anvil" title="No displays yet">Create one with <b>New display</b>. Try the example: <code>ui-forge import examples/gridtrade-assets.json</code></Empty>}
        {byModule.map(([m, list]) => (
          <div key={m} className="mod">
            <h3><Icon name="folder" size={14} /> {m}</h3>
            <div className="cards">
              {list.map((d) => {
                const errs = issuesFor(d.id);
                return (
                  <article key={d.id} className="dcard" onClick={() => s.open(d.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') s.open(d.id); }}>
                    <div className={'dthumb t-' + d.type}><i /><i /><i /></div>
                    <div className="dbody">
                      <h4>{d.title}</h4>
                      <div className="mono muted">{d.id}</div>
                      <div className="dmeta">
                        <Badge tone={d.type === 'summary' ? 'blue' : d.type === 'entry' ? 'green' : 'violet'}>{d.type}</Badge>
                        <span className="muted">r{d.revision ?? 1}</span>
                        {d.menu ? <span className="muted"><Icon name="menu" size={11} /> {d.menu.title}</span> : <span className="muted">no menu</span>}
                        {errs > 0 && <Badge tone="red">{errs} error{errs > 1 ? 's' : ''}</Badge>}
                      </div>
                    </div>
                    <button type="button" className="dcard-del" title="Delete this display" onClick={(e) => { e.stopPropagation(); setDel(d.id); }}><Icon name="trash" size={14} /></button>
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="home-list">
        <header><h2>Entities <span className="muted">{Object.keys(s.saved.entities).length}</span></h2></header>
        <div className="others">
          {Object.values(s.saved.entities).map((e) => {
            const used = Object.values(s.saved.displays).filter((d) => entitiesOf(d).includes(e.name)).length;
            const kids = Object.values(s.saved.entities).filter((x) => x.parent?.entity === e.name).length;
            return (
              <span key={e.name} className="other ent">
                <Icon name="db" size={12} /><b>{e.label}</b><span className="mono muted">{e.endpoint}</span>
                <span className="muted">{used ? `${used} display${used > 1 ? 's' : ''}` : 'unused'}{e.backend?.generate === false ? ' · existing API' : ''}</span>
                {!used && !kids && <button type="button" className="mini-x" title="Delete this entity" onClick={() => setDelEnt(e.name)}><Icon name="trash" size={12} /></button>}
              </span>
            );
          })}
        </div>
      </section>

      {others.length > 0 && (
        <section className="home-list">
          <header><h2>Other displays in the app <span className="muted">{others.length}</span></h2></header>
          <p className="note">Migrated or hand-written displays. UI Forge checks new ids, routes and menu entries against these so nothing collides.</p>
          <div className="others">{others.map((d) => <span key={d.id} className="other"><b>{d.title}</b><span className="mono muted">{d.id}</span></span>)}</div>
        </section>
      )}

      {delEnt && <Confirm text={<><p>Delete the entity <b>{delEnt}</b>?</p><p className="muted">No display uses it. Generate with “delete orphans” removes its types, service and API routes and moves your hooks file to .ui-forge/retired. Stored records stay.</p></>}
        onNo={() => setDelEnt(null)} onYes={async () => { const n = delEnt; setDelEnt(null); try { const r = await api.deleteEntity(n); s.notify(`Deleted ${n}. ${r.note}`, 'success'); await s.reload(true); } catch (e) { s.notify((e as Error).message, 'error'); } }} />}
      {wizard && <NewDisplay onClose={() => setWizard(false)} />}
      {del && <Confirm text={<><p>Delete the display <b>{s.saved.displays[del]?.title}</b>?</p><p className="muted">Its schema file is removed. Generate with “delete orphans” then removes its generated files and moves your component and hooks to .ui-forge/retired (never deleted). Entities stay.</p></>}
        onNo={() => setDel(null)} onYes={() => { const id = del; setDel(null); void s.removeDisplay(id); }} />}
    </div>
  );
}
