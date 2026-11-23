import { useEffect, useState } from 'react';
import { Icon } from './Icon';

/** Ext.toolbar.Paging (displayInfo: true) + page-size combo */
export interface PagingToolbarProps {
  page: number; // 0-based
  pageCount: number;
  pageStart: number;
  pageRows: number;
  total: number;
  pageSize: number;
  pageSizes?: number[];
  recordNamePlural?: string;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  onRefresh: () => void;
}

export function PagingToolbar(p: PagingToolbarProps) {
  const [input, setInput] = useState(String(p.page + 1));
  useEffect(() => setInput(String(p.page + 1)), [p.page]);
  const go = (n: number) => p.onPage(Math.max(0, Math.min(p.pageCount - 1, n)));
  const first = p.page === 0;
  const last = p.page >= p.pageCount - 1;

  return (
    <div className="xg-paging" role="navigation" aria-label="Pagination">
      <div className="xg-paging__nav">
        <button className="xg-icon-btn" onClick={() => go(0)} disabled={first} aria-label="First page"><Icon name="first" /></button>
        <button className="xg-icon-btn" onClick={() => go(p.page - 1)} disabled={first} aria-label="Previous page"><Icon name="prev" /></button>
        <span className="xg-paging__page">
          Page
          <input
            value={input}
            inputMode="numeric"
            aria-label="Page number"
            onChange={(e) => setInput(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') go(Number(input || 1) - 1); }}
            onBlur={() => go(Number(input || 1) - 1)}
          />
          of {p.pageCount}
        </span>
        <button className="xg-icon-btn" onClick={() => go(p.page + 1)} disabled={last} aria-label="Next page"><Icon name="next" /></button>
        <button className="xg-icon-btn" onClick={() => go(p.pageCount - 1)} disabled={last} aria-label="Last page"><Icon name="last" /></button>
        <button className="xg-icon-btn" onClick={p.onRefresh} aria-label="Refresh"><Icon name="refresh" /></button>
        <label className="xg-paging__size">
          Page size
          <select value={p.pageSize} onChange={(e) => p.onPageSize(Number(e.target.value))}>
            {(p.pageSizes ?? [25, 50, 100, 250]).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <div className="xg-paging__info">
        {p.total === 0
          ? `No ${p.recordNamePlural ?? 'records'} to display`
          : `Displaying ${p.recordNamePlural ?? 'records'} ${p.pageStart + 1} - ${p.pageStart + p.pageRows} of ${p.total}`}
      </div>
    </div>
  );
}
