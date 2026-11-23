/** New display wizard: what kind, which data, where in the menu and who may use it. */
import { useMemo, useState } from 'react';
import { api } from '../api';
import { newDisplay, newEntity } from '../catalog';
import { MenuTree, type TreeNode } from '../inspector/MenuInspector';
import { kebab, pascal, pluralLabel, singularLabel } from '../naming';
import { useStore } from '../store';
import type { DisplayType, Entity, EntityField } from '../types';
import { Btn, Modal, Segmented, Text, Toggle } from '../ui/controls';
import { Icon } from '../ui/Icon';

type Source = 'new' | 'existing';
type Start = 'basic' | 'infer' | 'blank';

const KINDS: { value: DisplayType; title: string; text: string }[] = [
  { value: 'summary', title: 'Summary', text: 'A searchable grid of records with server paging, filters, toolbar and row actions.' },
  { value: 'entry', title: 'Entry', text: 'A form to create and edit one record: sections, tabs, validation, Save / Delete / Copy / History.' },
  { value: 'master-slave', title: 'Master-Slave', text: 'A grid and a linked form on one screen: edit the selected record, or its child records.' },
];

export function NewDisplay({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [step, setStep] = useState(0);
  const [type, setType] = useState<DisplayType>('summary');
  const [src, setSrc] = useState<Source>('new');
  const [label, setLabel] = useState('');
  const [existing, setExisting] = useState('');
  const [module, setModule] = useState('');
  const [generate, setGenerate] = useState(true);
  const [endpoint, setEndpoint] = useState('');
  const [start, setStart] = useState<Start>('basic');
  const [inferred, setInferred] = useState<EntityField[] | null>(null);
  const [inferBusy, setInferBusy] = useState(false);
  const [relation, setRelation] = useState<'same' | 'child'>('child');
  const [childSrc, setChildSrc] = useState<Source>('new');
  const [childLabel, setChildLabel] = useState('');
  const [childExisting, setChildExisting] = useState('');
  const [title, setTitle] = useState('');
  const [withMenu, setWithMenu] = useState(true);
  const [parent, setParent] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState('');
  const [permMode, setPermMode] = useState<'new' | 'existing'>('new');
  const [permModule, setPermModule] = useState('');
  const [companion, setCompanion] = useState(true);
  const [busy, setBusy] = useState(false);

  const saved = s.saved.entities;
  const inv = s.inventory;
  const ent0 = src === 'existing' ? saved[existing] : null;
  const mod = module || ent0?.module || kebab(label.split(' ')[0] || '') || 'app';
  const perm = permModule || mod;
  // entities are named in the singular ("Item"); titles and menus use the plural ("Items")
  const entityLabel = ent0?.label || singularLabel(label.trim());
  const childName = childSrc === 'existing' ? saved[childExisting]?.label || 'Item' : singularLabel(childLabel.trim() || 'Item');
  const autoTitle = type === 'entry' ? entityLabel : type === 'summary' ? pluralLabel(entityLabel) : `${pluralLabel(entityLabel)}${relation === 'child' ? ' & ' + pluralLabel(childName) : ''}`;
  const finalTitle = title || autoTitle;

  const nodes: TreeNode[] = useMemo(() => {
    const out = (inv?.menus || []).map((m) => ({ id: m.id, title: m.title, parent: m.parent ?? null, folder: m.folder, sortOrder: m.sortOrder ?? 100 }));
    for (const d of Object.values(s.saved.displays)) {
      (d.folders || []).forEach((f) => out.push({ id: f.id, title: f.title, parent: f.parent ?? null, folder: true, sortOrder: f.sortOrder ?? 100 }));
      if (d.menu) out.push({ id: d.menu.id, title: d.menu.title, parent: d.menu.parent ?? null, folder: false, sortOrder: d.menu.sortOrder ?? 100 });
    }
    // the app's registration manifests already contain generated UI Forge entries: keep one row per id (the newest)
    return [...new Map(out.map((n) => [n.id, n])).values()];
  }, [inv, s.saved]);

  const children = Object.values(saved).filter((e) => ent0 && e.parent?.entity === ent0.name);
  const permModules = inv?.permissions || [];

  const infer = async () => {
    if (!endpoint) { s.notify('Enter the API path first', 'warning'); return; }
    setInferBusy(true);
    try { const r = await api.infer(endpoint); setInferred(r.fields as EntityField[]); s.notify(`Read ${r.count} record(s): ${r.fields.length} fields`, 'success'); }
    catch (e) { s.notify(`${(e as Error).message}${s.appUser ? '' : ' — sign in to the app first (Preview → Live API)'}`, 'error'); }
    finally { setInferBusy(false); }
  };

  const valid = [
    true,
    src === 'existing' ? !!existing : !!label.trim() && (start !== 'infer' || !!inferred?.length) && (generate || !!endpoint),
    !!finalTitle.trim(),
    true,
  ];

  const finish = async () => {
    setBusy(true);
    try {
      const permsFromExisting = permMode === 'existing' && permModules.find((m) => m.module === perm);
      const existingPerms = permsFromExisting ? {
        view: `${perm}.view`,
        create: permsFromExisting.actions.includes('create') ? `${perm}.create` : `${perm}.edit`,
        update: permsFromExisting.actions.includes('update') ? `${perm}.update` : `${perm}.edit`,
        delete: permsFromExisting.actions.includes('delete') ? `${perm}.delete` : `${perm}.edit`,
      } : null;
      const created: Entity[] = [];
      const main: Entity = ent0 ?? newEntity({ label: entityLabel, module: mod, permissionsModule: perm, existingPermissions: existingPerms, generate, endpoint: endpoint || undefined, fields: start === 'infer' ? inferred! : start === 'blank' ? [{ name: 'name', label: 'Name', dataType: 'string', required: true, maxLength: 80 }] : undefined });
      if (!ent0) {
        if (main.permissionModule) main.permissionModule.grants = { admin: main.permissionModule.actions };
        created.push(main);
      }
      let detail: Entity | null = null;
      if (type === 'master-slave' && relation === 'child') {
        detail = childSrc === 'existing' ? saved[childExisting] : newEntity({
          label: childName, module: mod, existingPermissions: main.permissions, generate: main.backend?.generate !== false,
          fields: [{ name: 'name', label: 'Name', dataType: 'string', required: true, maxLength: 80 }, { name: 'notes', label: 'Notes', dataType: 'text', maxLength: 1000 }],
          parent: { entity: main },
        });
        if (childSrc === 'new') { detail.permissionModule = null; created.push(detail); }
      }
      const folderId = newFolder.trim() ? `${mod}.${kebab(newFolder)}` : null;
      const folder = folderId ? { id: folderId, title: newFolder.trim(), parent } : null;
      const slug = kebab(finalTitle);
      const companionType: DisplayType | null = companion && type !== 'master-slave' ? (type === 'summary' ? 'entry' : 'summary') : null;
      const companionTitle = companionType === 'entry' ? main.label : pluralLabel(main.label);
      const companionId = companionType ? `${mod}.${kebab(companionTitle) === slug ? kebab(companionTitle) + '-' + companionType : kebab(companionTitle)}` : null;
      const d = newDisplay({
        type, title: finalTitle, module: mod, entity: main, detail, relation, menuParent: parent, newFolder: folder, withMenu,
        entryDisplay: companionType === 'entry' ? companionId : null, summaryDisplay: companionType === 'summary' ? companionId : null,
      });
      if (companionType && companionId) {
        const c = newDisplay({
          type: companionType, title: companionTitle, module: mod, entity: main, menuParent: folderId || parent, newFolder: null, withMenu,
          entryDisplay: type === 'entry' ? d.id : null, summaryDisplay: type === 'summary' ? d.id : null,
          menuTitle: companionType === 'entry' ? `New ${main.label}` : undefined,
        });
        c.id = companionId; c.route = `${mod}/${companionId.split('.').slice(1).join('.')}`; c.name = pascal(companionTitle) + (companionType === 'entry' ? 'Entry' : 'Summary');
        if (c.menu) { c.menu.id = companionId; c.menu.sortOrder = companionType === 'entry' ? 110 : 90; }
        // the pair is saved together so each can link to the other
        const r = await api.save({ entities: created, displays: [d, c] });
        await s.reload(true);
        const errors = r.issues.filter((i) => i.level === 'error');
        s.notify(`Created ${d.title} and ${c.title}${errors.length ? ` (${errors.length} issue(s) to fix)` : ''}`, errors.length ? 'warning' : 'success');
        s.openSoon(d.id);
        onClose();
        return;
      }
      s.create(d, created.concat(detail && childSrc === 'existing' ? [detail] : []));
      onClose();
    } catch (e) { s.notify(`Could not create: ${(e as Error).message}`, 'error'); }
    finally { setBusy(false); }
  };

  const STEPS = ['Kind', 'Data', 'Menu & access', 'Review'];
  return (
    <Modal wide title="New display" onClose={onClose} footer={
      <>
        <span className="wiz-dots">{STEPS.map((x, i) => <span key={x} className={i === step ? 'on' : i < step ? 'done' : ''}>{i + 1}. {x}</span>)}</span>
        <span className="spacer" />
        {step > 0 && <Btn onClick={() => setStep(step - 1)}>Back</Btn>}
        {step < 3 ? <Btn kind="primary" disabled={!valid[step]} onClick={() => setStep(step + 1)}>Next</Btn>
          : <Btn kind="accent" icon="anvil" busy={busy} onClick={finish}>Create display</Btn>}
      </>
    }>
      {step === 0 && (
        <div className="kinds">
          {KINDS.map((k) => (
            <button key={k.value} type="button" className={'kind-card' + (type === k.value ? ' on' : '')} onClick={() => setType(k.value)} onDoubleClick={() => { setType(k.value); setStep(1); }}>
              <KindArt kind={k.value} />
              <h3>{k.title}</h3>
              <p>{k.text}</p>
            </button>
          ))}
        </div>
      )}
      {step === 1 && (
        <div className="wiz-grid">
          <div>
            <h4>{type === 'master-slave' ? 'Master records' : 'Records'}</h4>
            <Segmented value={src} onChange={setSrc} options={[{ value: 'new', label: 'New entity' }, { value: 'existing', label: `Existing (${Object.keys(saved).length})` }]} />
            {src === 'existing' ? (
              <div className="pick-list">
                {Object.values(saved).map((e) => (
                  <button key={e.name} type="button" className={existing === e.name ? 'on' : ''} onClick={() => setExisting(e.name)}>
                    <b>{e.label}</b><span className="mono muted">{e.endpoint}</span><span className="muted">{e.fields.length} fields</span>
                  </button>
                ))}
                {!Object.keys(saved).length && <p className="muted">No UI Forge entities yet.</p>}
              </div>
            ) : (
              <>
                <label className="wl">Name (singular)<Text value={label} onChange={setLabel} placeholder="e.g. Generation Asset" ariaLabel="Entity name" /></label>
                {label.trim() && entityLabel !== label.trim() && <p className="note">Saved as <b>{entityLabel}</b> (one record); lists and menus use <b>{pluralLabel(entityLabel)}</b>.</p>}
                <label className="wl">Module<Text mono value={module} onChange={(v) => setModule(kebab(v))} placeholder={mod} ariaLabel="Module" /></label>
                <Toggle value={generate} onChange={setGenerate} label="Generate the API (routes, validation, permissions, audit)" />
                <label className="wl">API path {generate ? '(optional)' : '(existing API)'}<Text mono value={endpoint} onChange={setEndpoint} placeholder={label ? '/' + kebab(pluralLabel(label)) : '/my-records'} ariaLabel="Endpoint" /></label>
                <h4>Start with</h4>
                <Segmented value={start} onChange={setStart} options={[{ value: 'basic', label: 'Code + Name' }, { value: 'infer', label: 'Read from the API' }, { value: 'blank', label: 'Name only' }]} />
                {start === 'infer' && (
                  <div className="infer">
                    <p className="note">Reads up to 50 records from the API path and proposes fields (types, options, required). {!s.appUser && 'Sign in to the app in Preview → Live API first.'}</p>
                    <Btn small icon="wand" busy={inferBusy} onClick={infer}>Read fields</Btn>
                    {inferred && <ul className="infer-list">{inferred.map((f) => <li key={f.name}><span className="mono">{f.name}</span> {f.dataType}{f.required ? ' · required' : ''}{f.options ? ` · ${f.options.length} options` : ''}</li>)}</ul>}
                  </div>
                )}
              </>
            )}
          </div>
          {type === 'master-slave' && (
            <div>
              <h4>Detail</h4>
              <Segmented value={relation} onChange={setRelation} options={[{ value: 'same', label: 'Same record (edit the selected row)' }, { value: 'child', label: 'Child records' }]} />
              {relation === 'child' && (
                <>
                  <Segmented value={childSrc} onChange={setChildSrc} options={[{ value: 'new', label: 'New child entity' }, { value: 'existing', label: `Existing children (${children.length})` }]} />
                  {childSrc === 'new' ? <label className="wl">Child name (singular)<Text value={childLabel} onChange={setChildLabel} placeholder="e.g. Asset Outage (default: Item)" ariaLabel="Child name" /></label> : (
                    <div className="pick-list">{children.map((e) => <button key={e.name} type="button" className={childExisting === e.name ? 'on' : ''} onClick={() => setChildExisting(e.name)}><b>{e.label}</b><span className="mono muted">{e.parent?.field}</span></button>)}
                      {!children.length && <p className="muted">No saved entity has the master as its parent.</p>}</div>
                  )}
                  <p className="note"><Icon name="link" size={12} /> The child gets a link field to the master; the API should refuse to delete a master that still has children (configurable).</p>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {step === 2 && (
        <div className="wiz-grid">
          <div>
            <label className="wl">Display title<Text value={finalTitle} onChange={setTitle} ariaLabel="Display title" /></label>
            <Toggle value={withMenu} onChange={setWithMenu} label="Add it to the menu" />
            {withMenu && (
              <>
                <h4>Menu folder</h4>
                <MenuTree nodes={nodes} picked={parent} onPick={setParent} />
                <label className="wl">…or a new folder inside it<Text value={newFolder} onChange={setNewFolder} placeholder="e.g. Assets" ariaLabel="New folder" /></label>
              </>
            )}
            {type !== 'master-slave' && <Toggle value={companion} onChange={setCompanion} label={`Also create the matching ${type === 'summary' ? 'Entry form' : 'Summary grid'} and link them`} />}
          </div>
          <div>
            <h4>Who may use it</h4>
            {src === 'existing' ? <p className="note">Uses {ent0?.label}'s permissions: {Object.values(ent0?.permissions || {}).join(', ')}.</p> : (
              <>
                <Segmented value={permMode} onChange={setPermMode} options={[{ value: 'new', label: 'New permission module' }, { value: 'existing', label: 'Existing permissions' }]} />
                {permMode === 'new' ? (
                  <>
                    <label className="wl">Module key<Text mono value={permModule} onChange={(v) => setPermModule(kebab(v).replace(/-/g, '_'))} placeholder={mod} ariaLabel="Permission module" /></label>
                    <p className="note">Adds <b className="mono">{perm}.view / .edit / .delete</b> to the role editor and grants them to <b>admin</b> once. Other roles get them in Admin → Roles (or under Entity → Permission module).</p>
                  </>
                ) : (
                  <div className="pick-list">{permModules.map((m) => <button key={m.module} type="button" className={permModule === m.module ? 'on' : ''} onClick={() => setPermModule(m.module)}><b>{m.label}</b><span className="mono muted">{m.module}: {m.actions.join(', ')}</span></button>)}
                    {!permModules.length && <p className="muted">The app's permission modules were not found (is the API root set?).</p>}</div>
                )}
              </>
            )}
            <p className="note"><Icon name="shield" size={12} /> Hiding a button is a convenience; the API checks the permission on every request.</p>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="review">
          <dl>
            <dt>Display</dt><dd><b>{finalTitle}</b> · {type} · <span className="mono">{mod}.{kebab(finalTitle)}</span></dd>
            <dt>Data</dt><dd>{ent0 ? `${ent0.label} (existing)` : `${entityLabel} — new entity, ${s.project?.backend === 'none' ? 'API contract for ' + endpoint : generate ? 'generated API' : 'existing API ' + endpoint}`}{type === 'master-slave' && relation === 'child' ? ` → ${childName} (child)` : ''}</dd>
            <dt>Menu</dt><dd>{withMenu ? `${nodes.find((n) => n.id === parent)?.title || 'Top level'}${newFolder ? ' / ' + newFolder : ''} / ${finalTitle}` : 'not in the menu'}</dd>
            <dt>Access</dt><dd className="mono">{ent0 ? Object.values(ent0.permissions).join(', ') : permMode === 'new' ? `${perm}.view, ${perm}.edit, ${perm}.delete (new)` : perm || 'pick a module'}</dd>
            {companion && type !== 'master-slave' && <><dt>Also</dt><dd>the matching {type === 'summary' ? 'Entry form' : 'Summary grid'}, linked (both are saved right away)</dd></>}
          </dl>
          <p className="note">Next you design the layout on the canvas. Nothing is written to the app until you Save and then Generate.</p>
        </div>
      )}
    </Modal>
  );
}

function KindArt({ kind }: { kind: DisplayType }) {
  if (kind === 'summary') return <div className="art art-sum"><i className="a-bar" /><i className="a-hd" />{[0, 1, 2, 3].map((x) => <i key={x} className="a-row" />)}</div>;
  if (kind === 'entry') return <div className="art art-ent"><i className="a-tab" />{[0, 1, 2, 3].map((x) => <i key={x} className="a-in" />)}<i className="a-btn" /></div>;
  return <div className="art art-ms"><div>{[0, 1, 2, 3, 4].map((x) => <i key={x} className={'a-row' + (x === 1 ? ' on' : '')} />)}</div><div><i className="a-in" /><i className="a-in" /><i className="a-in" /><i className="a-btn" /></div></div>;
}
