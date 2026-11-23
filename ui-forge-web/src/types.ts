/** The UI Forge schema (version 1.0) as the builder edits it. Mirrors src/ui_forge/schema.py. */

export type DataType = 'string' | 'text' | 'integer' | 'decimal' | 'currency' | 'boolean' | 'date' | 'datetime' | 'time' | 'enum' | 'lookup';
export type Widget = 'input' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'switch' | 'multiselect';
export type ActionKind = 'save' | 'delete' | 'copy' | 'audit' | 'reset' | 'cancel' | 'new' | 'open' | 'refresh' | 'custom';
export type DisplayType = 'entry' | 'summary' | 'master-slave';

export interface LookupDef { endpoint: string; valueField?: string; labelField?: string }

export interface EntityField {
  name: string;
  label: string;
  dataType: DataType;
  multiple?: boolean;
  required?: boolean;
  unique?: boolean;
  maxLength?: number | null;
  minLength?: number | null;
  min?: number | null;
  max?: number | null;
  decimals?: number | null;
  currency?: string | null;
  pattern?: string | null;
  patternMessage?: string | null;
  options?: (string | number)[] | null;
  lookup?: LookupDef | null;
  defaultValue?: unknown;
  upperCase?: boolean;
  readOnly?: boolean;
  description?: string | null;
  example?: unknown;
}

export interface PermissionModule { module: string; label: string; actions: string[]; actionLabels?: Record<string, string>; grants?: Record<string, string[]> }
export interface EntityPermissions { view: string; create: string; update: string; delete: string }

export interface Entity {
  schemaVersion: '1.0';
  kind: 'entity';
  name: string;
  label: string;
  plural: string;
  module: string;
  endpoint: string;
  idField?: string;
  titleField?: string | null;
  fields: EntityField[];
  permissions: EntityPermissions;
  permissionModule?: PermissionModule | null;
  parent?: { entity: string; field: string; onParentDelete?: 'restrict' | 'cascade' } | null;
  backend?: { generate?: boolean; collection?: string | null; auditEntityType?: string | null; customActions?: string[] };
  description?: string | null;
  revision?: number;
}

export interface FormItem {
  field: string;
  span?: number;
  widget?: Widget | null;
  label?: string | null;
  placeholder?: string | null;
  help?: string | null;
  readOnly?: boolean | null;
  readOnlyOnEdit?: boolean | null;
  hidden?: boolean | null;
  visibleWhen?: { field: string; equals: unknown[] } | null;
  defaultValue?: unknown;
  validator?: string | null;
}

export type SectionKind = 'panel' | 'fieldset' | 'tab' | 'plain';
export interface Section { id: string; title?: string | null; kind?: SectionKind; columns?: number | null; collapsible?: boolean; collapsed?: boolean; description?: string | null; items: FormItem[] }

export interface Action { id: string; kind: ActionKind; label?: string | null; permission?: string | null; confirm?: string | null; path?: string | null; style?: 'primary' | 'danger' | 'default' | null; icon?: string | null }

export interface EntryLayout { columns?: number; sections: Section[]; actions?: Action[]; copyExclude?: string[]; summaryDisplay?: string | null }

export interface Column {
  field: string; label?: string | null; width?: number | null; flex?: number | null; align?: 'left' | 'center' | 'right' | null;
  format?: string | null; decimals?: number | null; sortable?: boolean; filter?: boolean | 'text' | 'number' | 'date' | 'list';
  hidden?: boolean; renderer?: string | null; badgeTones?: Record<string, 'gray' | 'blue' | 'green' | 'red' | 'amber'> | null;
}
export interface SearchField { field: string; label?: string | null; operator?: 'eq' | 'contains' | 'gte' | 'lte' | 'between' | 'in'; param?: string | null; required?: boolean; defaultValue?: unknown; placeholder?: string | null }
export interface SummaryLayout {
  columns: Column[]; searchFields?: SearchField[]; remote?: boolean; pageSize?: number | null; sorters?: { field: string; direction?: 'ASC' | 'DESC' }[];
  toolbarActions?: Action[]; rowActions?: Action[]; emptyText?: string | null; selection?: 'single' | 'multi'; autoLoad?: boolean;
  entryDisplay?: string | null; features?: Record<string, unknown>;
}
export interface MasterSlaveLayout {
  master: { entity: string; summary: SummaryLayout };
  detail: { entity: string; relation?: 'same' | 'child'; linkField?: string | null; masterKey?: string | null; entry: EntryLayout; summary?: SummaryLayout | null };
  orientation?: 'horizontal' | 'vertical';
  split?: number;
  unsavedChanges?: 'confirm' | 'discard' | 'block';
  stackBelow?: number;
}
export interface MenuFolder { id: string; title: string; parent?: string | null; icon?: string | null; sortOrder?: number }
export interface MenuEntry { id: string; title: string; parent?: string | null; icon?: string | null; sortOrder?: number; action?: string | null; params?: Record<string, string | number | boolean>; requiredPermissions?: string[]; enabled?: boolean }

export interface Display {
  schemaVersion: '1.0';
  kind: 'display';
  id: string;
  name: string;
  title: string;
  description?: string | null;
  type: DisplayType;
  module: string;
  route?: string | null;
  icon?: string | null;
  openMode?: 'tab' | 'window' | 'page';
  entity?: string | null;
  menu?: MenuEntry | null;
  folders?: MenuFolder[];
  permissions?: { required?: string[]; actions?: Record<string, string> };
  entry?: EntryLayout | null;
  summary?: SummaryLayout | null;
  masterSlave?: MasterSlaveLayout | null;
  generator?: { frontend?: boolean; backend?: boolean; tests?: boolean };
  revision?: number;
}

export interface Issue { level: 'error' | 'warning'; where: string; path: string; message: string }

export interface InventoryMenu { id: string; title: string; parent?: string | null; display?: string | null; folder: boolean; sortOrder?: number; icon?: string | null; module: string; forge: boolean }
export interface Inventory {
  menus: InventoryMenu[];
  displays: { id: string; title: string; type: string; key: string; route: string; module: string; forge: boolean }[];
  modules: { id: string; file: string; forge: boolean }[];
  displayKeys: string[];
  permissions: { module: string; label: string; actions: string[] }[];
  lookups: string[];
  routes: { method: string; path: string }[];
  collections: string[];
}
export interface ProjectInfo { appRoot: string; apiRoot: string | null; mirrorRoot: string | null; appId: string; apiBase: string; appApiUrl: string; registryUrl: string; backend: string }

export interface GeneratedFile { key: string; root: string; path: string; owner: 'generated' | 'developer' | 'block'; source: string; content: string; exists?: boolean }
export interface PlanChange { key: string; root: string; path: string; owner: string; status: 'create' | 'update' | 'unchanged' | 'conflict' | 'keep' | 'orphan' | 'retire'; note: string; source: string; diff: string }
export interface PlanResult { hash: string; counts: Record<string, number>; problems: string[]; changes: PlanChange[] }

/** Where in a display a layout lives. */
export type Panel = 'entry' | 'summary' | 'master' | 'detail' | 'detailList';

export type Selection =
  | { kind: 'display' }
  | { kind: 'menu' }
  | { kind: 'section'; panel: Panel; section: string }
  | { kind: 'item'; panel: Panel; section: string; field: string }
  | { kind: 'column'; panel: Panel; field: string }
  | { kind: 'search'; panel: Panel; field: string }
  | { kind: 'action'; panel: Panel; list: 'actions' | 'toolbarActions' | 'rowActions'; id: string }
  | { kind: 'grid'; panel: Panel }
  | { kind: 'field'; entity: string; field: string }
  | { kind: 'entity'; entity: string };
