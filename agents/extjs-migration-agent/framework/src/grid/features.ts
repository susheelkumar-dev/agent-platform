import type { ReactNode } from 'react';
import type { GridFeatures, Preset } from './types';

/** Presets are just starting switch sets — like an Ext base class's default config. */
export const PRESETS: Record<Preset, GridFeatures> = {
  full: {
    toolbar: true, search: true, filters: true, sorting: true, paging: true,
    grouping: true, groupSummary: true, summary: true, selection: 'multi', rowNumbers: true,
    rowExpander: true, editing: { mode: 'cell', switcher: true }, add: true, delete: true, actions: true,
    contextMenu: true, export: true, columnChooser: true, undo: true, sync: true, dirtyMarkers: true,
    stateful: true, resetView: true, responsive: true, autoHeight: false,
  },
  standard: {
    toolbar: true, search: true, filters: true, sorting: true, paging: true,
    grouping: false, groupSummary: false, summary: false, selection: 'multi', rowNumbers: true,
    rowExpander: false, editing: false, add: false, delete: false, actions: false,
    contextMenu: true, export: true, columnChooser: true, undo: false, sync: false, dirtyMarkers: false,
    stateful: false, resetView: false, responsive: true, autoHeight: false,
  },
  minimal: {
    toolbar: false, search: false, filters: false, sorting: true, paging: false,
    grouping: false, groupSummary: false, summary: false, selection: false, rowNumbers: false,
    rowExpander: false, editing: false, add: false, delete: false, actions: false,
    contextMenu: false, export: false, columnChooser: false, undo: false, sync: false, dirtyMarkers: false,
    stateful: false, resetView: false, responsive: true, autoHeight: false,
  },
};

export interface ResolvedFeatures<T> {
  toolbar: boolean;
  search: false | { fields?: string[]; placeholder?: string };
  filters: false | { floating: boolean };
  sorting: boolean;
  paging: false | { pageSize: number; pageSizes: number[] };
  grouping: false | { field: string | null; fields?: string[]; switcher: boolean };
  groupSummary: boolean;
  summary: boolean;
  selection: false | 'single' | 'multi';
  checkboxes: boolean;
  rowNumbers: boolean;
  rowExpander: false | { render?: (record: T) => ReactNode; height?: number };
  editing: false | { mode: 'cell' | 'row'; switcher: boolean; singleClick: boolean };
  add: boolean;
  delete: boolean;
  actions: false | { edit: boolean; duplicate: boolean; delete: boolean };
  contextMenu: boolean;
  export: false | { csv: boolean; xlsx: boolean; fileName: string };
  columnChooser: boolean;
  undo: boolean;
  sync: boolean;
  dirtyMarkers: boolean;
  stateful: false | string;
  resetView: boolean;
  responsive: boolean;
  autoHeight: boolean;
}

const obj = <O extends object>(v: unknown): Partial<O> => (v && typeof v === 'object' ? (v as Partial<O>) : {});

export function resolveFeatures<T>(
  preset: Preset | undefined, f: GridFeatures<T> | undefined,
  defaults: { stateId: string; groupField: string | null; fileName: string },
): ResolvedFeatures<T> {
  const m = { ...PRESETS[preset ?? 'standard'], ...(f ?? {}) } as GridFeatures<T>;
  const on = (v: unknown) => v !== undefined && v !== false && v !== null;

  const editing: ResolvedFeatures<T>['editing'] = !on(m.editing) ? false : (() => {
    const o = obj<{ mode: 'cell' | 'row'; switcher: boolean; singleClick: boolean }>(m.editing);
    const mode = m.editing === 'row' ? 'row' : o.mode ?? 'cell';
    return { mode, switcher: o.switcher ?? false, singleClick: o.singleClick ?? false };
  })();
  const selection = !on(m.selection) ? false : m.selection === 'single' ? 'single' : 'multi';
  const add = !!m.add;
  const del = !!m.delete;

  return {
    toolbar: !!m.toolbar,
    search: on(m.search) ? { ...obj<{ fields: string[]; placeholder: string }>(m.search) } : false,
    filters: on(m.filters) ? { floating: obj<{ floating: boolean }>(m.filters).floating ?? true } : false,
    sorting: m.sorting !== false,
    paging: on(m.paging)
      ? { pageSize: obj<{ pageSize: number }>(m.paging).pageSize ?? 50, pageSizes: obj<{ pageSizes: number[] }>(m.paging).pageSizes ?? [25, 50, 100, 250] }
      : false,
    grouping: on(m.grouping)
      ? (() => {
          const o = obj<{ field: string | null; fields: string[]; switcher: boolean }>(m.grouping);
          return { field: o.field === undefined ? defaults.groupField : o.field, fields: o.fields, switcher: o.switcher ?? true };
        })()
      : false,
    groupSummary: !!m.groupSummary,
    summary: !!m.summary,
    selection,
    checkboxes: m.checkboxes !== false,
    rowNumbers: !!m.rowNumbers,
    rowExpander: on(m.rowExpander) ? { ...obj<{ render: (record: T) => ReactNode; height: number }>(m.rowExpander) } : false,
    editing,
    add,
    delete: del && !!selection,
    actions: on(m.actions)
      ? (() => {
          const o = obj<{ edit: boolean; duplicate: boolean; delete: boolean }>(m.actions);
          return { edit: o.edit ?? !!editing, duplicate: o.duplicate ?? add, delete: o.delete ?? del };
        })()
      : false,
    contextMenu: !!m.contextMenu,
    export: on(m.export)
      ? (() => {
          const o = obj<{ csv: boolean; xlsx: boolean; fileName: string }>(m.export);
          return { csv: o.csv ?? true, xlsx: o.xlsx ?? true, fileName: o.fileName ?? defaults.fileName };
        })()
      : false,
    columnChooser: !!m.columnChooser,
    undo: !!m.undo,
    sync: !!m.sync,
    dirtyMarkers: !!m.dirtyMarkers,
    stateful: typeof m.stateful === 'string' ? m.stateful : m.stateful ? defaults.stateId : false,
    resetView: !!m.resetView,
    responsive: m.responsive !== false,
    autoHeight: !!m.autoHeight,
  };
}
