/**
 * DataGrid — reusable config-driven grid for React + AG Grid Community.
 *
 *   import { DataGrid, defineGrid, XGrid } from './datagrid';
 *   import './datagrid/datagrid.css';
 */
export { DataGrid } from './DataGrid';
export { defineGrid, XGrid, registeredXtypes } from './registry';
export { PRESETS } from './features';
export { fmtDate, fmtNumber } from './format';
export type {
  ColumnConfig, DataGridProps, DataGridHandle, DataGridModel, GridFeatures, Preset,
  FieldType, SummaryType, BadgeTone, FilterKind, EditorKind,
} from './types';
export type { Changes, Sorter, SortDir, GridStore } from './store/useGridStore';
export type { MenuItem } from './components/Popups';
