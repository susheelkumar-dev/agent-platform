/**
 * The toolbox: every control a developer can drop, and what it becomes in the schema.
 * A field control creates an entity field (the data model) and places it; the same field can then be used as a
 * grid column or a search field without being defined again.
 */
import type { Action, ActionKind, Column, DataType, Display, DisplayType, Entity, EntityField, EntryLayout, Section, SummaryLayout, Widget } from './types';
import { camel, kebab, pascal, pluralLabel, uniqueName } from './naming';

export type ControlGroup = 'Text' | 'Numbers' | 'Date & time' | 'Choices' | 'Layout' | 'Data' | 'Actions';

export interface Control {
  id: string;
  label: string;
  group: ControlGroup;
  icon: string;
  hint: string;
  /** what dropping it creates */
  creates: 'field' | 'section' | 'action' | 'grid-feature' | 'note';
  field?: { dataType: DataType; widget?: Widget; multiple?: boolean; base: string; label: string; extra?: Partial<EntityField> };
  section?: { kind: Section['kind']; title: string; description?: string };
  action?: { kind: ActionKind; label?: string };
  feature?: 'remote' | 'search' | 'filters' | 'grid' | 'master-detail';
}

export const CONTROLS: Control[] = [
  { id: 'heading', label: 'Heading', group: 'Text', icon: 'heading', hint: 'A titled panel that groups fields', creates: 'section', section: { kind: 'panel', title: 'New section' } },
  { id: 'label', label: 'Label / help text', group: 'Text', icon: 'text', hint: 'A short explanation shown above fields', creates: 'section', section: { kind: 'plain', title: '', description: 'Explain what to enter here.' } },
  { id: 'text', label: 'Text box', group: 'Text', icon: 'input', hint: 'One line of text', creates: 'field', field: { dataType: 'string', widget: 'input', base: 'text', label: 'Text', extra: { maxLength: 80 } } },
  { id: 'textarea', label: 'Text area', group: 'Text', icon: 'textarea', hint: 'Several lines of text', creates: 'field', field: { dataType: 'text', widget: 'textarea', base: 'notes', label: 'Notes', extra: { maxLength: 1000 } } },
  { id: 'integer', label: 'Whole number', group: 'Numbers', icon: 'hash', hint: 'Integer', creates: 'field', field: { dataType: 'integer', widget: 'input', base: 'quantity', label: 'Quantity' } },
  { id: 'decimal', label: 'Decimal', group: 'Numbers', icon: 'decimal', hint: 'Number with decimals', creates: 'field', field: { dataType: 'decimal', widget: 'input', base: 'amount', label: 'Amount', extra: { decimals: 2 } } },
  { id: 'currency', label: 'Currency', group: 'Numbers', icon: 'currency', hint: 'Money in one currency', creates: 'field', field: { dataType: 'currency', widget: 'input', base: 'price', label: 'Price', extra: { currency: 'INR', decimals: 2, min: 0 } } },
  { id: 'date', label: 'Date', group: 'Date & time', icon: 'calendar', hint: 'yyyy-mm-dd', creates: 'field', field: { dataType: 'date', widget: 'input', base: 'date', label: 'Date' } },
  { id: 'datetime', label: 'Date & time', group: 'Date & time', icon: 'clock-calendar', hint: 'yyyy-mm-ddThh:mm', creates: 'field', field: { dataType: 'datetime', widget: 'input', base: 'startsAt', label: 'Starts at' } },
  { id: 'time', label: 'Time', group: 'Date & time', icon: 'clock', hint: 'hh:mm', creates: 'field', field: { dataType: 'time', widget: 'input', base: 'time', label: 'Time' } },
  { id: 'dropdown', label: 'Dropdown', group: 'Choices', icon: 'select', hint: 'One value from a fixed list', creates: 'field', field: { dataType: 'enum', widget: 'select', base: 'status', label: 'Status', extra: { options: ['Option A', 'Option B'] } } },
  { id: 'combo', label: 'Combo (lookup)', group: 'Choices', icon: 'search-list', hint: 'A record or value from an API list', creates: 'field', field: { dataType: 'lookup', widget: 'select', base: 'refId', label: 'Reference', extra: { lookup: { endpoint: '/lookups/regions', valueField: 'id', labelField: 'name' } } } },
  { id: 'multiselect', label: 'Multi-select', group: 'Choices', icon: 'tags', hint: 'Several values from a list', creates: 'field', field: { dataType: 'enum', widget: 'multiselect', multiple: true, base: 'tags', label: 'Tags', extra: { options: ['Tag A', 'Tag B', 'Tag C'] } } },
  { id: 'radio', label: 'Radio buttons', group: 'Choices', icon: 'radio', hint: 'One of a few values, all visible', creates: 'field', field: { dataType: 'enum', widget: 'radio', base: 'kind', label: 'Kind', extra: { options: ['First', 'Second'] } } },
  { id: 'checkbox', label: 'Checkbox', group: 'Choices', icon: 'check', hint: 'Yes / no', creates: 'field', field: { dataType: 'boolean', widget: 'checkbox', base: 'flag', label: 'Flag' } },
  { id: 'switch', label: 'Switch', group: 'Choices', icon: 'switch', hint: 'On / off', creates: 'field', field: { dataType: 'boolean', widget: 'switch', base: 'enabled', label: 'Enabled', extra: { defaultValue: true } } },
  { id: 'panel', label: 'Panel', group: 'Layout', icon: 'panel', hint: 'A titled box of fields', creates: 'section', section: { kind: 'panel', title: 'Panel' } },
  { id: 'fieldset', label: 'Field group', group: 'Layout', icon: 'fieldset', hint: 'A light frame around related fields', creates: 'section', section: { kind: 'fieldset', title: 'Group' } },
  { id: 'tab', label: 'Tab', group: 'Layout', icon: 'tabs', hint: 'Consecutive tabs form one tab strip', creates: 'section', section: { kind: 'tab', title: 'Tab' } },
  { id: 'row', label: 'Plain area', group: 'Layout', icon: 'row', hint: 'Fields without a frame', creates: 'section', section: { kind: 'plain', title: '' } },
  { id: 'grid', label: 'Data grid', group: 'Data', icon: 'grid', hint: 'Summary and Master-Slave displays are built on the grid', creates: 'grid-feature', feature: 'grid' },
  { id: 'search', label: 'Search field', group: 'Data', icon: 'search', hint: 'Drop a field on the search panel', creates: 'grid-feature', feature: 'search' },
  { id: 'filters', label: 'Column filters', group: 'Data', icon: 'filter', hint: 'Filter row under the headers', creates: 'grid-feature', feature: 'filters' },
  { id: 'paging', label: 'Server paging', group: 'Data', icon: 'pages', hint: 'Page, sort and filter on the server', creates: 'grid-feature', feature: 'remote' },
  { id: 'master-detail', label: 'Master-detail', group: 'Data', icon: 'split', hint: 'Use a Master-Slave display: list + linked form', creates: 'grid-feature', feature: 'master-detail' },
  { id: 'a-save', label: 'Save', group: 'Actions', icon: 'save', hint: 'Create or update', creates: 'action', action: { kind: 'save' } },
  { id: 'a-delete', label: 'Delete', group: 'Actions', icon: 'trash', hint: 'With confirmation', creates: 'action', action: { kind: 'delete' } },
  { id: 'a-copy', label: 'Copy', group: 'Actions', icon: 'copy', hint: 'New record prefilled from this one', creates: 'action', action: { kind: 'copy' } },
  { id: 'a-audit', label: 'Audit / history', group: 'Actions', icon: 'history', hint: 'Who changed what, from the audit trail', creates: 'action', action: { kind: 'audit', label: 'History' } },
  { id: 'a-reset', label: 'Reset', group: 'Actions', icon: 'undo', hint: 'Undo unsaved changes', creates: 'action', action: { kind: 'reset' } },
  { id: 'a-cancel', label: 'Cancel / close', group: 'Actions', icon: 'close', hint: 'Close, asking first if there are changes', creates: 'action', action: { kind: 'cancel', label: 'Close' } },
  { id: 'a-new', label: 'New', group: 'Actions', icon: 'plus', hint: 'Toolbar: create a record', creates: 'action', action: { kind: 'new' } },
  { id: 'a-open', label: 'Open', group: 'Actions', icon: 'open', hint: 'Toolbar / row: open the selected record', creates: 'action', action: { kind: 'open' } },
  { id: 'a-refresh', label: 'Refresh', group: 'Actions', icon: 'refresh', hint: 'Toolbar: reload', creates: 'action', action: { kind: 'refresh' } },
  { id: 'a-custom', label: 'Custom action', group: 'Actions', icon: 'bolt', hint: 'Your own button: an API call or a hook', creates: 'action', action: { kind: 'custom', label: 'Custom action' } },
];

export const CONTROL = Object.fromEntries(CONTROLS.map((c) => [c.id, c]));

export const DATA_TYPES: { value: DataType; label: string }[] = [
  { value: 'string', label: 'Text (one line)' }, { value: 'text', label: 'Long text' }, { value: 'integer', label: 'Whole number' },
  { value: 'decimal', label: 'Decimal' }, { value: 'currency', label: 'Currency' }, { value: 'boolean', label: 'Yes / no' },
  { value: 'date', label: 'Date' }, { value: 'datetime', label: 'Date & time' }, { value: 'time', label: 'Time' },
  { value: 'enum', label: 'Fixed list (enum)' }, { value: 'lookup', label: 'Lookup (API list)' },
];

export const WIDGETS_FOR: Record<DataType, Widget[]> = {
  string: ['input', 'textarea'], text: ['textarea'], integer: ['input'], decimal: ['input'], currency: ['input'],
  date: ['input'], datetime: ['input'], time: ['input'], boolean: ['checkbox', 'switch'],
  enum: ['select', 'radio', 'multiselect'], lookup: ['select', 'radio', 'multiselect'],
};

export function defaultWidget(f: EntityField): Widget {
  if (f.dataType === 'boolean') return 'checkbox';
  if (f.multiple) return 'multiselect';
  if (f.dataType === 'enum' || f.dataType === 'lookup') return 'select';
  if (f.dataType === 'text') return 'textarea';
  return 'input';
}

export function newField(entity: Entity, c: Control): EntityField {
  const spec = c.field!;
  const name = uniqueName(spec.base, entity.fields.map((f) => f.name).concat(['id']));
  return { name, label: spec.label + (name === spec.base ? '' : ' ' + name.replace(spec.base, '')), dataType: spec.dataType, ...(spec.multiple ? { multiple: true } : {}), ...(spec.extra || {}) } as EntityField;
}

export function newSection(layout: EntryLayout, c: Control): Section {
  const s = c.section!;
  const id = uniqueName(kebab(s.title || s.kind || 'area') || 'area', layout.sections.map((x) => x.id));
  return { id, title: s.title || null, kind: s.kind, ...(s.description ? { description: s.description } : {}), items: [] };
}

export function newAction(list: Action[], kind: ActionKind, label?: string): Action {
  const base = kind === 'custom' ? 'custom' : kind;
  const id = uniqueName(base, list.map((a) => a.id));
  const a: Action = { id, kind };
  if (label) a.label = label;
  if (kind === 'custom') a.label = label || 'Custom action';
  return a;
}

const isSearchable = (f: EntityField) => ['enum', 'lookup', 'boolean', 'date', 'datetime'].includes(f.dataType) && !f.multiple;

export function defaultColumns(e: Entity, skip: string[] = [], max = 8): Column[] {
  return e.fields.filter((f) => !skip.includes(f.name) && f.dataType !== 'text').slice(0, max).map((f) => {
    const c: Column = { field: f.name };
    if (f.name === e.titleField) c.flex = 1;
    else c.width = ['decimal', 'currency', 'integer'].includes(f.dataType) ? 140 : f.dataType === 'boolean' ? 100 : f.dataType === 'datetime' ? 170 : 130;
    return c;
  });
}

export function defaultSummary(e: Entity, entryDisplay: string | null): SummaryLayout {
  return {
    columns: defaultColumns(e),
    searchFields: e.fields.filter(isSearchable).slice(0, 4).map((f) => ({ field: f.name, ...(f.dataType === 'date' || f.dataType === 'datetime' ? { operator: 'between' as const } : {}) })),
    remote: false,
    sorters: e.titleField ? [{ field: e.titleField, direction: 'ASC' }] : [],
    toolbarActions: [{ id: 'new', kind: 'new' }, { id: 'open', kind: 'open' }, { id: 'delete', kind: 'delete' }, { id: 'refresh', kind: 'refresh' }],
    rowActions: [{ id: 'open', kind: 'open', label: 'Open' }, { id: 'delete', kind: 'delete', label: 'Delete' }],
    entryDisplay,
  };
}

export function defaultEntry(e: Entity, skip: string[] = [], summaryDisplay: string | null = null): EntryLayout {
  const items = e.fields.filter((f) => !skip.includes(f.name)).map((f) => ({ field: f.name, ...(f.dataType === 'text' ? { span: 2 } : {}) }));
  return {
    columns: 2,
    sections: [{ id: 'general', title: 'General', kind: 'panel', items }],
    actions: [{ id: 'save', kind: 'save' }, { id: 'copy', kind: 'copy' }, { id: 'audit', kind: 'audit', label: 'History' }, { id: 'reset', kind: 'reset' }, { id: 'delete', kind: 'delete' }, { id: 'cancel', kind: 'cancel', label: 'Close' }],
    summaryDisplay,
  };
}

export function newEntity(opts: { label: string; module: string; permissionsModule?: string; existingPermissions?: Entity['permissions'] | null; generate: boolean; endpoint?: string; fields?: EntityField[]; parent?: { entity: Entity } | null }): Entity {
  const name = pascal(opts.label);
  const pm = opts.permissionsModule || opts.module;
  const fields: EntityField[] = opts.fields?.length ? opts.fields : [
    { name: 'code', label: 'Code', dataType: 'string', required: true, unique: true, maxLength: 20, upperCase: true },
    { name: 'name', label: 'Name', dataType: 'string', required: true, maxLength: 80 },
  ];
  const e: Entity = {
    schemaVersion: '1.0', kind: 'entity', name, label: opts.label, plural: pluralLabel(opts.label), module: opts.module,
    endpoint: opts.endpoint || '/' + kebab(pluralLabel(opts.label)), titleField: fields.some((f) => f.name === 'name') ? 'name' : fields[0]?.name ?? null,
    fields,
    permissions: opts.existingPermissions || { view: `${pm}.view`, create: `${pm}.edit`, update: `${pm}.edit`, delete: `${pm}.delete` },
    permissionModule: opts.existingPermissions ? null : { module: pm, label: pascal(pm).replace(/([a-z])([A-Z])/g, '$1 $2'), actions: ['view', 'edit', 'delete'] },
    backend: { generate: opts.generate, customActions: [] },
  };
  if (opts.parent) {
    const link = camel(opts.parent.entity.name) + 'Id';
    e.fields = [{ name: link, label: opts.parent.entity.label, dataType: 'lookup', required: true, lookup: { endpoint: opts.parent.entity.endpoint, valueField: 'id', labelField: opts.parent.entity.titleField || 'name' } }, ...e.fields];
    e.parent = { entity: opts.parent.entity.name, field: link, onParentDelete: 'restrict' };
  }
  return e;
}

export function newDisplay(opts: { type: DisplayType; title: string; module: string; entity: Entity; detail?: Entity | null; relation?: 'same' | 'child'; menuParent: string | null; menuTitle?: string; newFolder?: { id: string; title: string; parent: string | null } | null; withMenu: boolean; entryDisplay?: string | null; summaryDisplay?: string | null }): Display {
  const slug = kebab(opts.title);
  const suffix = opts.type === 'entry' ? 'Entry' : opts.type === 'summary' ? 'Summary' : 'MasterSlave';
  const name = pascal(opts.title).endsWith(suffix) ? pascal(opts.title) : pascal(opts.title) + suffix;
  const d: Display = {
    schemaVersion: '1.0', kind: 'display', id: `${opts.module}.${slug}`, name, title: opts.title, type: opts.type, module: opts.module,
    route: `${opts.module}/${slug}`, icon: null, folders: opts.newFolder ? [{ id: opts.newFolder.id, title: opts.newFolder.title, parent: opts.newFolder.parent, sortOrder: 100 }] : [],
  };
  if (opts.withMenu) {
    d.menu = { id: `${opts.module}.${slug}`, title: opts.menuTitle || opts.title, parent: opts.newFolder ? opts.newFolder.id : opts.menuParent, sortOrder: 100 };
    if (opts.type === 'entry') d.menu.params = { id: 'new' };
  }
  if (opts.type === 'entry') { d.entity = opts.entity.name; d.entry = defaultEntry(opts.entity, [], opts.summaryDisplay ?? null); }
  if (opts.type === 'summary') { d.entity = opts.entity.name; d.summary = defaultSummary(opts.entity, opts.entryDisplay ?? null); }
  if (opts.type === 'master-slave') {
    const child = opts.relation === 'child' && opts.detail;
    const de = child ? opts.detail! : opts.entity;
    const link = child ? de.parent?.field ?? null : null;
    const master = defaultSummary(opts.entity, null);
    master.columns = defaultColumns(opts.entity, [], 5);
    master.toolbarActions = child ? [{ id: 'refresh', kind: 'refresh' }] : [{ id: 'new', kind: 'new' }, { id: 'refresh', kind: 'refresh' }];
    master.rowActions = [];
    master.entryDisplay = null;
    const entry = defaultEntry(de, link ? [link] : []);
    entry.actions = (entry.actions || []).filter((a) => a.kind !== 'copy');
    d.masterSlave = {
      master: { entity: opts.entity.name, summary: master },
      detail: {
        entity: de.name, relation: child ? 'child' : 'same', linkField: link, entry,
        summary: child ? { columns: defaultColumns(de, link ? [link] : [], 6), toolbarActions: [{ id: 'new', kind: 'new', label: `New ${de.label.toLowerCase()}` }, { id: 'delete', kind: 'delete' }, { id: 'refresh', kind: 'refresh' }], rowActions: [] } : null,
      },
      orientation: 'horizontal', split: 45, unsavedChanges: 'confirm',
    };
  }
  return d;
}

export const ACTION_KINDS_FOR: Record<'actions' | 'toolbarActions' | 'rowActions', ActionKind[]> = {
  actions: ['save', 'delete', 'copy', 'audit', 'reset', 'cancel', 'custom'],
  toolbarActions: ['new', 'open', 'delete', 'refresh', 'custom'],
  rowActions: ['open', 'delete', 'custom'],
};
