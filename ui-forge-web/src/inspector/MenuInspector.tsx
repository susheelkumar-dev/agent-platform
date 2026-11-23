/** Where the display appears in the application menu (and the folders it adds). */
import { useMemo } from 'react';
import { kebab, uniqueName } from '../naming';
import { useStore } from '../store';
import type { MenuEntry } from '../types';
import { Btn, ChipList, Group, Num, Row, Text, Toggle } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { assign, permissionSuggestions } from './common';

export interface TreeNode { id: string; title: string; parent: string | null; folder: boolean; mine?: boolean; isNew?: boolean; display?: string | null; sortOrder: number }

/** The app's menu as the registry knows it, plus every saved UI Forge display, plus this draft. */
export function useMenuTree(): TreeNode[] {
  const s = useStore();
  return useMemo(() => {
    const out = new Map<string, TreeNode>();
    // the manifest's copy of the display being edited would show its old position
    for (const m of s.inventory?.menus || []) if (!(m.forge && s.origId && (m.display === s.origId || m.id === s.doc?.display.menu?.id))) out.set(m.id, { id: m.id, title: m.title, parent: m.parent ?? null, folder: m.folder, display: m.display, sortOrder: m.sortOrder ?? 100 });
    for (const d of Object.values(s.saved.displays)) {
      if (d.id === s.origId) continue;
      for (const f of d.folders || []) out.set(f.id, { id: f.id, title: f.title, parent: f.parent ?? null, folder: true, sortOrder: f.sortOrder ?? 100 });
      if (d.menu) out.set(d.menu.id, { id: d.menu.id, title: d.menu.title, parent: d.menu.parent ?? null, folder: false, display: d.id, sortOrder: d.menu.sortOrder ?? 100 });
    }
    const d = s.doc?.display;
    if (d) {
      for (const f of d.folders || []) out.set(f.id, { id: f.id, title: f.title, parent: f.parent ?? null, folder: true, mine: true, isNew: true, sortOrder: f.sortOrder ?? 100 });
      if (d.menu) out.set(d.menu.id, { id: d.menu.id, title: d.menu.title, parent: d.menu.parent ?? null, folder: false, mine: true, display: d.id, sortOrder: d.menu.sortOrder ?? 100 });
    }
    return [...out.values()];
  }, [s.inventory, s.saved, s.doc, s.origId]);
}

export function MenuTree({ nodes, onPick, picked, compact }: { nodes: TreeNode[]; onPick?: (folderId: string | null) => void; picked?: string | null; compact?: boolean }) {
  const kids = (p: string | null) => nodes.filter((n) => (n.parent ?? null) === p).sort((a, b) => Number(b.folder) - Number(a.folder) || a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  const render = (p: string | null, depth: number): JSX.Element[] => kids(p).flatMap((n) => [
    <div key={n.id} className={`mt-row${n.folder ? ' folder' : ''}${n.mine ? ' mine' : ''}${picked === n.id ? ' picked' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}
      role={onPick && n.folder ? 'button' : undefined} tabIndex={onPick && n.folder ? 0 : undefined}
      onClick={() => n.folder && onPick?.(n.id)} onKeyDown={(e) => { if (e.key === 'Enter' && n.folder) onPick?.(n.id); }}>
      <Icon name={n.folder ? 'folder' : 'file'} size={13} />
      <span>{n.title}</span>
      {n.isNew && <span className="badge orange">new folder</span>}
      {n.mine && !n.folder && <span className="badge orange">this display</span>}
    </div>,
    ...(n.folder ? render(n.id, depth + 1) : []),
  ]);
  return (
    <div className={'menutree' + (compact ? ' compact' : '')}>
      {onPick && <div className={`mt-row folder${picked === null ? ' picked' : ''}`} role="button" tabIndex={0} onClick={() => onPick(null)}><Icon name="home" size={13} /><span>Top level</span></div>}
      {render(null, onPick ? 1 : 0)}
    </div>
  );
}

export function MenuInspector() {
  const s = useStore();
  const d = s.doc!.display;
  const nodes = useMenuTree();
  const m = d.menu;
  const setMenu = (patch: Partial<MenuEntry>) => s.edit((doc) => { if (doc.display.menu) assign(doc.display.menu, patch); });
  const perms = permissionSuggestions(s);
  const folders = d.folders || [];
  const taken = nodes.map((n) => n.id);
  return (
    <>
      <Group title="Menu entry">
        <Row label="Show in menu"><Toggle value={!!m} onChange={(v) => s.edit((doc) => {
          doc.display.menu = v ? { id: doc.display.id, title: doc.display.title, parent: doc.display.folders?.[0]?.id ?? null, sortOrder: 100, ...(doc.display.type === 'entry' ? { params: { id: 'new' } } : {}) } : null;
        })} /></Row>
        {m && (
          <>
            <Row label="Title"><Text value={m.title} onChange={(v) => setMenu({ title: v })} validate={(v) => (v.trim() ? null : 'required')} /></Row>
            <Row label="Order" hint="Lower comes first within the folder"><Num value={m.sortOrder ?? 100} onChange={(v) => setMenu({ sortOrder: v ?? 100 })} /></Row>
            <Row label="Icon"><Text value={m.icon} onChange={(v) => setMenu({ icon: v })} /></Row>
            <Row label="Opens with" hint="Parameters passed to the display, e.g. id=new for a New … entry">
              <ChipList value={Object.entries(m.params || {}).map(([k, v]) => `${k}=${v}`)} placeholder="name=value"
                onChange={(v) => setMenu({ params: Object.fromEntries(v.map(String).filter((x) => x.includes('=')).map((x) => [x.split('=')[0].trim(), x.split('=').slice(1).join('=').trim()])) })} />
            </Row>
            <Row label="Action" hint="Passed to the display, e.g. 'new' opens a Master-Slave on a new record"><Text mono value={m.action} onChange={(v) => setMenu({ action: v })} /></Row>
            <Row label="Also needs" hint="Extra permissions for this menu entry (on top of the display's)"><ChipList value={m.requiredPermissions || []} suggestions={perms} onChange={(v) => setMenu({ requiredPermissions: v.map(String) })} /></Row>
            <Row label="Enabled"><Toggle value={m.enabled !== false} onChange={(v) => setMenu({ enabled: v ? null : false } as any)} /></Row>
            <Row label="Folder" wide>
              <MenuTree nodes={nodes} picked={m.parent ?? null} onPick={(id) => setMenu({ parent: id })} />
            </Row>
          </>
        )}
      </Group>
      <Group title={`New folders (${folders.length})`} aside={<Btn small kind="ghost" icon="plus" onClick={() => s.edit((doc) => {
        const id = uniqueName(`${doc.display.module}.${kebab('folder')}`, taken);
        doc.display.folders = [...(doc.display.folders || []), { id, title: 'New folder', parent: null, sortOrder: 100 }];
      })}>Add</Btn>}>
        {!folders.length && <p className="note">Folders this display adds to the menu. Saved displays that use the same folder id share it.</p>}
        {folders.map((f, i) => (
          <div key={f.id + i} className="folder-ed">
            <Row label="Title"><Text value={f.title} onChange={(v) => s.edit((doc) => { doc.display.folders![i].title = v; })} /></Row>
            <Row label="Id"><Text mono value={f.id} onChange={(v) => s.edit((doc) => {
              const old = doc.display.folders![i].id;
              doc.display.folders![i].id = v;
              if (doc.display.menu?.parent === old) doc.display.menu.parent = v;
              doc.display.folders!.forEach((x) => { if (x.parent === old) x.parent = v; });
            })} /></Row>
            <Row label="Inside"><select className="in" value={f.parent || ''} onChange={(e) => s.edit((doc) => { doc.display.folders![i].parent = e.target.value || null; })}>
              <option value="">Top level</option>
              {nodes.filter((n) => n.folder && n.id !== f.id).map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
            </select></Row>
            <Row label="Order"><Num value={f.sortOrder ?? 100} onChange={(v) => s.edit((doc) => { doc.display.folders![i].sortOrder = v ?? 100; })} /></Row>
            <Btn small kind="ghost" icon="trash" onClick={() => s.edit((doc) => {
              const gone = doc.display.folders!.splice(i, 1)[0];
              if (doc.display.menu?.parent === gone.id) doc.display.menu.parent = gone.parent ?? null;
            })}>Remove folder</Btn>
          </div>
        ))}
      </Group>
      <p className="note"><Icon name="info" size={12} /> Menus come from the display registry: after Generate, use Register so the entry appears for users who have the permissions.</p>
    </>
  );
}
