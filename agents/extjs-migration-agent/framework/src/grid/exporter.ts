import type { ColumnConfig } from './types';
import { displayValue } from './format';

/**
 * Ext gridexporter (saveDocumentAs xlsx / csv).
 * Exports every filtered + sorted record (not just the page) in the visible column order.
 * AG Grid Community has no Excel export, so both formats are built here.
 */
function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const raw = <T,>(c: ColumnConfig<T>, r: T) =>
  c.tpl ? c.tpl(r) : c.dataIndex ? (r as Record<string, unknown>)[c.dataIndex] : undefined;

export function exportCsv<T>(records: T[], cols: ColumnConfig<T>[], fileName: string) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => esc(c.text)).join(',')];
  for (const r of records) lines.push(cols.map((c) => esc(c.type === 'number' || c.type === 'date' ? raw(c, r) : displayValue(c, r))).join(','));
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${fileName}.csv`);
}

export async function exportXlsx<T>(records: T[], cols: ColumnConfig<T>[], fileName: string, sheet = 'Data') {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const header = cols.map((c) => ({ value: c.text, fontWeight: 'bold' as const }));
  const body = records.map((r) =>
    cols.map((c) => {
      const v = raw(c, r);
      if (v === null || v === undefined || v === '') return null;
      if (c.tpl) return { value: String(v), type: String };
      switch (c.type) {
        case 'number': {
          const d = c.decimals ?? 2;
          return { value: Number(v), type: Number, format: d ? `#,##0.${'0'.repeat(d)}` : '#,##0' };
        }
        case 'date': {
          const [y, m, d] = String(v).split('-').map(Number);
          return { value: new Date(Date.UTC(y, m - 1, d)), type: Date, format: 'dd-mmm-yyyy' };
        }
        case 'boolean': return { value: Boolean(v), type: Boolean };
        default: return { value: String(v), type: String };
      }
    }),
  );
  const blob = await writeXlsxFile([header, ...body], {
    sheet: sheet.slice(0, 31),
    columns: cols.map((c) => ({ width: Math.max(12, Math.min(40, c.text.length + 4, (c.width ?? 120) / 7)) })),
    stickyRowsCount: 1,
  }).toBlob();
  download(blob, `${fileName}.xlsx`);
}
