/**
 * Contracts shared by the framework, the display registry service and generated modules.
 * The registry's JSON shapes (navigation, display metadata) are mirrored here; see
 * src/display_registry/manifest.py in the platform for the manifest itself.
 */
import type { ComponentType } from 'react';

// ---------------------------------------------------------------- registry payloads
export interface DisplayParam { name: string; required?: boolean; description?: string }

export interface DisplayMeta {
  id: string;
  title: string;
  /** entry-form | summary | master-slave | custom | a type the app registers */
  type: string;
  /** implementation key in the app's approved display registry */
  key: string;
  route: string;
  openMode: 'tab' | 'window' | 'page';
  params: DisplayParam[];
  icon?: string | null;
  config: Record<string, any>;
  module: string;
  requiredPermissions: string[];
  /** what the signed-in user may do here (from actionPermissions); a UI hint, the API still decides */
  actions: Record<string, boolean>;
}

export interface MenuItem {
  id: string;
  title: string;
  icon?: string | null;
  display?: string;
  params?: Record<string, string | number | boolean>;
  action?: string | null;
  children?: MenuItem[];
}

export interface Navigation {
  app: string;
  user: string;
  menu: MenuItem[];
  displays: Record<string, DisplayMeta>;
  etag: string;
}

// ---------------------------------------------------------------- sign-in
export interface SessionUser { username: string; fullName?: string; email?: string; roles?: string[] }

export interface SessionInfo {
  token: string;
  expiresAt: string;
  user: SessionUser;
  permissions: string[];
}

// ---------------------------------------------------------------- displays
export type Params = Record<string, string>;

/** What a display gets from the host. */
export interface DisplayProps {
  meta: DisplayMeta;
  params: Params;
  /** e.g. 'new' from a "New Trade" menu entry; undefined otherwise */
  action?: string;
  /** increases each time the same action is requested again for an open display */
  actionId?: number;
}

/** An implementation the app approves for use by key. `load` keeps each display in its own chunk. */
export interface DisplayImplementation {
  load: () => Promise<{ default: ComponentType<DisplayProps> }>;
  /** display types this implementation can serve (registration and the host check it) */
  types?: string[];
}

export type DisplayRegistry = Record<string, DisplayImplementation>;

// ---------------------------------------------------------------- entity schema (Entry / Summary / Master-Slave templates)
/**
 * Value types a field can hold. 'number' is kept for older schemas (a decimal). 'datetime' is an ISO string
 * 'yyyy-mm-ddThh:mm', 'time' is 'hh:mm'. 'multiselect' holds an array of option values.
 */
export type FieldType =
  | 'string' | 'text' | 'number' | 'integer' | 'decimal' | 'currency' | 'date' | 'datetime' | 'time'
  | 'boolean' | 'lookup' | 'select' | 'multiselect';

/** How a field is drawn; the default follows the type (select for options, checkbox for boolean ...). */
export type FieldWidget = 'input' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'switch' | 'multiselect';

export interface LookupSource {
  /** API path returning [{ id, name }] or a { data } envelope, e.g. '/lookups/regions' */
  endpoint: string;
  valueField?: string;
  labelField?: string;
}

export interface FieldDef {
  name: string;
  label: string;
  type?: FieldType;
  widget?: FieldWidget;
  required?: boolean;
  maxLength?: number;
  minLength?: number;
  min?: number;
  max?: number;
  /** decimals allowed for decimal / currency fields */
  decimals?: number;
  /** ISO 4217 code shown next to currency fields, e.g. 'INR' */
  currency?: string;
  pattern?: string;
  patternMessage?: string;
  placeholder?: string;
  /** upper-case the value as it is typed (Ext fieldStyle text-transform) */
  upperCase?: boolean;
  options?: (string | number)[];
  lookup?: LookupSource;
  defaultValue?: unknown;
  readOnly?: boolean;
  /** read-only once the record exists */
  readOnlyOnEdit?: boolean;
  help?: string;
  /** hidden from the form (kept in the record) */
  hidden?: boolean;
  /** columns of the form grid this field spans (default 1; a section's columns is the maximum) */
  span?: number;
  /** show only when another field has one of these values */
  visibleWhen?: { field: string; equals: unknown[] };
  /** name of a validator the display's hooks provide (hooks.validators[name]) */
  validator?: string;
}

/** A group of fields in an Entry form: a panel, a field set, or one tab of a tab strip. */
export interface SectionDef {
  id: string;
  title?: string;
  kind?: 'panel' | 'fieldset' | 'tab' | 'plain';
  /** grid columns in this section (default: the form's columns) */
  columns?: number;
  collapsible?: boolean;
  collapsed?: boolean;
  /** field names, in order */
  fields: string[];
  description?: string;
}

/** A button of an Entry form, a Summary toolbar or a Summary row. */
export interface ActionDef {
  id: string;
  kind: 'save' | 'delete' | 'copy' | 'audit' | 'reset' | 'cancel' | 'new' | 'open' | 'refresh' | 'export' | 'custom';
  label?: string;
  /** key in DisplayMeta.actions that must be true (from the manifest's actionPermissions) */
  permission?: string;
  /** question asked before the action runs */
  confirm?: string;
  /** custom actions: POST {endpoint}/{id}/{path}; without a path the display's hooks.onAction handles it */
  path?: string;
  /** custom actions that change the record: reload it afterwards */
  reload?: boolean;
  style?: 'primary' | 'danger' | 'default';
  icon?: string;
}

export interface ColumnDef {
  field: string;
  text: string;
  type?: 'string' | 'number' | 'date' | 'boolean';
  width?: number;
  flex?: number;
  align?: 'left' | 'center' | 'right';
  decimals?: number;
  format?: string;
  options?: (string | number | boolean)[];
  filter?: boolean | 'text' | 'number' | 'date' | 'list';
  sortable?: boolean;
  hidden?: boolean;
  /** 'badge', 'currency:<ISO code>', 'datetime', 'time', 'list', or a named renderer the app registers */
  renderer?: string;
  /** the value is a key of this lookup: show its label (one or several keys) */
  lookup?: LookupSource;
  badgeTones?: Record<string, 'gray' | 'blue' | 'green' | 'red' | 'amber'>;
  trueText?: string;
  falseText?: string;
}

/** A search field above a Summary grid; its value is sent to the server as a query parameter. */
export interface SearchFieldDef extends FieldDef {
  /** query parameter name (default: the field name). Date ranges send {param}From and {param}To. */
  param?: string;
  operator?: 'eq' | 'contains' | 'gte' | 'lte' | 'between' | 'in';
}

/** config of a 'summary' display (display.config in the manifest) */
export interface SummaryConfig {
  entity: string;
  entityPlural?: string;
  /** API path; may contain {param} placeholders filled from the display's params (e.g. '/assets/{assetId}/outages') */
  endpoint: string;
  idField?: string;
  columns: ColumnDef[];
  /** display that opens a record ('id' param) and creates one (id = 'new') */
  entryDisplay?: string;
  sorters?: { property: string; direction?: 'ASC' | 'DESC' }[];
  features?: Record<string, unknown>;
  /** server paging when the collection is large; default false (load all, filter in the grid) */
  remote?: boolean;
  pageSize?: number;
  /** search panel above the grid (values go to the server as query parameters) */
  searchFields?: SearchFieldDef[];
  /** run the search when the display opens (default true) */
  autoLoad?: boolean;
  /** extra query parameters always sent, e.g. a parent key */
  baseParams?: Record<string, string | number | boolean>;
  toolbarActions?: ActionDef[];
  rowActions?: ActionDef[];
  emptyText?: string;
  selection?: 'single' | 'multi';
  /** field shown in delete confirmations (default name, then code, then the id) */
  titleField?: string;
}

/** config of an 'entry-form' display */
export interface EntryConfig {
  entity: string;
  endpoint: string;
  idField?: string;
  /** field shown in the title for an existing record */
  titleField?: string;
  fields: FieldDef[];
  /** display to return to after save / cancel */
  summaryDisplay?: string;
  columns?: number;
  /** groups of fields; without sections all visible fields are laid out in one grid */
  sections?: SectionDef[];
  /** buttons; default Save and Close (the original behaviour) */
  actions?: ActionDef[];
  /** where Audit reads history: GET {endpoint}?{entityTypeParam}={entityType}&{idParam}={id} */
  audit?: { endpoint: string; entityType: string; entityTypeParam?: string; idParam?: string };
  /** fields cleared when a record is copied (besides the id) */
  copyExclude?: string[];
}

/** config of a 'master-slave' display: a master list and a linked detail panel. */
export interface MasterSlaveConfig {
  master: SummaryConfig;
  /**
   * 'same': the detail is the selected master record's form.
   * 'child': the detail lists the master's child records (detail.summary) and edits one in detail.entry;
   *          linkField (on the child) receives the master's key.
   */
  relation: 'same' | 'child';
  detail: { entry: EntryConfig; summary?: SummaryConfig };
  /** child field holding the master's key (relation 'child') */
  linkField?: string;
  /** master field the link refers to (default the master's idField) */
  masterKey?: string;
  orientation?: 'horizontal' | 'vertical';
  /** share of the master panel, 20–80 (percent) */
  split?: number;
  /** what happens when another master is selected while the detail form has unsaved changes */
  unsavedChanges?: 'confirm' | 'discard' | 'block';
  /** below this width the panels stack vertically */
  stackBelow?: number;
}
