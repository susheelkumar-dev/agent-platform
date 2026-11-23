import type { DataGridProps, GridFeatures } from './types';
import { DataGrid } from './DataGrid';

/**
 * xtype registry — Ext's `Ext.define('App.TradeGrid', { extend: 'Ext.grid.Panel', xtype: 'tradegrid', ... })`.
 *
 *   export const TradeGrid = defineGrid<Trade>('tradegrid', { columns, idField: 'id', preset: 'full' });
 *   <TradeGrid data={trades} />                       // as a component
 *   <XGrid xtype="tradegrid" data={trades} />         // or by xtype string, e.g. from JSON layouts
 *
 * Instance props override the defaults; `features` are merged switch by switch.
 */
type Defaults<T extends object> = Partial<DataGridProps<T>>;
const registry = new Map<string, Defaults<any>>();

function merge<T extends object>(base: Defaults<T>, over: Defaults<T>): DataGridProps<T> {
  const features: GridFeatures<T> = { ...(base.features ?? {}), ...(over.features ?? {}) };
  return { ...base, ...over, features } as DataGridProps<T>;
}

export function defineGrid<T extends object>(xtype: string, defaults: Defaults<T>) {
  registry.set(xtype, defaults);
  function Grid(props: Defaults<T>) {
    return <DataGrid<T> {...merge(defaults, props)} />;
  }
  Grid.displayName = `Grid(${xtype})`;
  return Grid;
}

export function XGrid<T extends object = any>({ xtype, ...props }: Defaults<T> & { xtype: string }) {
  const defaults = registry.get(xtype);
  if (!defaults) throw new Error(`XGrid: no grid registered with xtype "${xtype}". Call defineGrid('${xtype}', {...}) first.`);
  return <DataGrid<T> {...merge(defaults as Defaults<T>, props as Defaults<T>)} />;
}

export const registeredXtypes = () => [...registry.keys()];
