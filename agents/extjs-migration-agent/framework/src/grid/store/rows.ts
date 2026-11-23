/**
 * The grid renders a flat list of "view rows". Ext's grid view does the same internally
 * (group headers, record rows, row-expander bodies, summary rows are all view nodes).
 */
export type RowKind = 'data' | 'group' | 'groupSummary' | 'detail' | 'total';

export interface RowMeta {
  __kind: RowKind;
  __id: string;
  /** position in our computed order — AG Grid's own sort is overridden with this */
  __order: number;
  __recId?: number | string;
  __rowNum?: number;
  __dirty?: ReadonlySet<string>;
  __errors?: Readonly<Record<string, string>>;
  __phantom?: boolean;
  __expanded?: boolean;
  __groupField?: string;
  __groupKey?: string;
  __groupCount?: number;
  __collapsed?: boolean;
}

/** A view row: record fields (or summary values) flattened next to the meta fields. */
export type GridRow = RowMeta & Record<string, unknown>;

export const isDataRow = (r: GridRow | undefined | null): boolean => r?.__kind === 'data';
export const isSummaryRow = (r: GridRow | undefined | null): boolean =>
  r?.__kind === 'groupSummary' || r?.__kind === 'total';
