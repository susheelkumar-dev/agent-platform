import { describe, expect, it } from 'vitest';
import { newDisplay, newEntity } from '../src/catalog';
import { renameField, unplaceField, usesOfField } from '../src/layout';
import { drop, duplicateSelected, nudgeSelected, removeSelected } from '../src/ops';
import type { Doc } from '../src/store';

function doc(type: 'entry' | 'summary' | 'master-slave' = 'entry'): Doc {
  const e = newEntity({ label: 'Generation Asset', module: 'assets', generate: true });
  const child = newEntity({ label: 'Asset Outage', module: 'assets', generate: true, existingPermissions: e.permissions, parent: { entity: e } });
  const d = newDisplay({ type, title: type === 'entry' ? 'Generation Asset' : 'Generation Assets', module: 'assets', entity: e, detail: child, relation: 'child', menuParent: null, withMenu: true });
  return { display: d, entities: { [e.name]: e, [child.name]: child } };
}

describe('catalog', () => {
  it('builds valid-looking defaults', () => {
    const d = doc('summary').display;
    expect(d.id).toBe('assets.generation-assets');
    expect(d.name).toBe('GenerationAssetsSummary');
    expect(d.summary!.columns.map((c) => c.field)).toEqual(['code', 'name']);
    const ms = doc('master-slave').display.masterSlave!;
    expect(ms.detail.relation).toBe('child');
    expect(ms.detail.linkField).toBe('generationAssetId');
    expect(ms.detail.entry.sections[0].items.some((i) => i.field === 'generationAssetId')).toBe(false);
  });
});

describe('drop', () => {
  it('a control creates an entity field and places it', () => {
    const d = doc();
    const sel = drop(d, { t: 'control', id: 'currency' }, { t: 'items', panel: 'entry', section: 'general', index: 1 });
    expect(sel).toMatchObject({ kind: 'item', field: 'price' });
    expect(d.entities.GenerationAsset.fields.find((f) => f.name === 'price')?.dataType).toBe('currency');
    expect(d.display.entry!.sections[0].items[1].field).toBe('price');
  });

  it('refuses a field that is already on the form', () => {
    const d = doc();
    expect(drop(d, { t: 'field', entity: 'GenerationAsset', field: 'code' }, { t: 'items', panel: 'entry', section: 'general', index: 0 })).toMatch(/already/);
  });

  it('moves items between sections and reorders', () => {
    const d = doc();
    drop(d, { t: 'control', id: 'panel' }, { t: 'sections', panel: 'entry', index: 1 });
    const second = d.display.entry!.sections[1].id;
    drop(d, { t: 'item', panel: 'entry', section: 'general', field: 'code' }, { t: 'items', panel: 'entry', section: second, index: 0 });
    expect(d.display.entry!.sections[0].items.map((i) => i.field)).toEqual(['name']);
    expect(d.display.entry!.sections[1].items.map((i) => i.field)).toEqual(['code']);
  });

  it('a custom action gets an API route on a generated entity', () => {
    const d = doc();
    const sel = drop(d, { t: 'control', id: 'a-custom' }, { t: 'actions', panel: 'entry', list: 'actions', index: 0 });
    expect(sel).toMatchObject({ kind: 'action', id: 'custom-action' });
    expect(d.entities.GenerationAsset.backend!.customActions).toContain('custom-action');
  });

  it('only allows actions that fit the bar', () => {
    const d = doc('summary');
    expect(drop(d, { t: 'control', id: 'a-save' }, { t: 'actions', panel: 'summary', list: 'toolbarActions', index: 0 })).toMatch(/not available/);
  });
});

describe('selection operations', () => {
  it('duplicate, nudge and remove', () => {
    const d = doc();
    const dup = duplicateSelected(d, { kind: 'item', panel: 'entry', section: 'general', field: 'name' });
    expect(dup).toMatchObject({ field: 'name2' });
    expect(d.entities.GenerationAsset.fields.map((f) => f.name)).toContain('name2');
    nudgeSelected(d, { kind: 'item', panel: 'entry', section: 'general', field: 'name2' }, -1);
    expect(d.display.entry!.sections[0].items.map((i) => i.field)).toEqual(['code', 'name2', 'name']);
    removeSelected(d, { kind: 'item', panel: 'entry', section: 'general', field: 'name2' });
    expect(d.display.entry!.sections[0].items.map((i) => i.field)).toEqual(['code', 'name']);
    expect(removeSelected(d, { kind: 'section', panel: 'entry', section: 'general' })).toMatch(/at least one/);
  });

  it('rename follows every reference', () => {
    const d = doc('summary');
    renameField(d.display, d.entities, 'GenerationAsset', 'name', 'title');
    expect(d.entities.GenerationAsset.titleField).toBe('title');
    expect(d.display.summary!.columns.some((c) => c.field === 'title')).toBe(true);
    expect(d.display.summary!.sorters![0].field).toBe('title');
    expect(usesOfField(d.display, 'GenerationAsset', 'title').length).toBeGreaterThan(0);
    unplaceField(d.display, 'GenerationAsset', 'title');
    expect(usesOfField(d.display, 'GenerationAsset', 'title')).toEqual([]);
  });
});

import { plural, pluralLabel, singularLabel } from '../src/naming';
describe('naming', () => {
  it('never pluralises twice and singularises entity names', () => {
    expect(pluralLabel('Items')).toBe('Items');
    expect(pluralLabel('Item')).toBe('Items');
    expect(plural('Entity')).toBe('Entities');
    expect(plural('Status')).toBe('Statuses');
    expect(plural('Analysis')).toBe('Analyses');
    expect(singularLabel('Maintenance Crews')).toBe('Maintenance Crew');
    expect(singularLabel('Entities')).toBe('Entity');
    expect(singularLabel('Address')).toBe('Address');
  });
});
