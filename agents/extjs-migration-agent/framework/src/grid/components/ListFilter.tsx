import { useCallback, useMemo } from 'react';
import { useGridFilter, type CustomFilterProps, type CustomFloatingFilterProps } from 'ag-grid-react';
import type { IDoesFilterPassParams } from 'ag-grid-community';
import type { ListModel } from '../store/filterEngine';

/**
 * Ext `filter: { type: 'list' }` and `filter: 'boolean'` → custom checkbox-list filter.
 * (AG Grid's Set Filter is Enterprise-only, so this is the Community replacement.)
 */
export interface ListFilterParams {
  values: unknown[];
  formatter?: (v: unknown) => string;
}

type Props = CustomFilterProps<unknown, unknown, ListModel> & ListFilterParams;

export function ListFilter(props: Props) {
  const { model, onModelChange, values, formatter, getValue } = props;
  const selected = useMemo(() => new Set(model?.values ?? values), [model, values]);
  const fmt = formatter ?? ((v: unknown) => String(v));

  const doesFilterPass = useCallback(
    (p: IDoesFilterPassParams) => !model || model.values.some((v) => v === getValue(p.node)),
    [model, getValue],
  );
  useGridFilter({ doesFilterPass });

  const commit = (next: Set<unknown>) => {
    // all selected == no filter (Ext list filter behaves the same)
    onModelChange(next.size === values.length ? null : { filterType: 'list', values: values.filter((v) => next.has(v)) });
  };

  return (
    <div className="xg-list-filter">
      <label className="xg-list-filter__all">
        <input
          type="checkbox"
          checked={selected.size === values.length}
          ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < values.length; }}
          onChange={(e) => commit(e.target.checked ? new Set(values) : new Set())}
        />
        (Select all)
      </label>
      <div className="xg-list-filter__items">
        {values.map((v) => (
          <label key={String(v)}>
            <input
              type="checkbox"
              checked={selected.has(v)}
              onChange={(e) => {
                const n = new Set(selected);
                if (e.target.checked) n.add(v); else n.delete(v);
                commit(n);
              }}
            />
            {fmt(v)}
          </label>
        ))}
      </div>
    </div>
  );
}

/** Read-only floating filter that summarises the list selection under the header. */
export function ListFloatingFilter(props: CustomFloatingFilterProps & { filterParams?: ListFilterParams }) {
  const model = props.model as ListModel | null;
  const fmt = (props.filterParams as ListFilterParams | undefined)?.formatter ?? ((v: unknown) => String(v));
  const text = !model ? '' : model.values.length === 0 ? '(none)' : model.values.map(fmt).join(', ');
  return (
    <input
      className="xg-list-floating"
      readOnly
      value={text}
      placeholder="All"
      onClick={() => props.showParentFilter()}
      aria-label="Open list filter"
    />
  );
}
