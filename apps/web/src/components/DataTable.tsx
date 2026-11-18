import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { downloadCsv, exportExcel, printReportWindow } from '../utils/export';
import { Icon, Icons } from './Icon';

export interface DataColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string;
  sortable?: boolean;
  sortKey?: string;
}

interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean | undefined;
  error?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  total?: number | undefined;
  onPageChange?: ((page: number) => void) | undefined;
  onPerPageChange?: ((perPage: number) => void) | undefined;
  search?: string | undefined;
  onSearch?: ((search: string) => void) | undefined;
  searchPlaceholder?: string | undefined;
  csvFilename?: string | undefined;
  excelFilename?: string | undefined;
  printable?: boolean | undefined;
  /** Heading used by the Print view (defaults to csvFilename or 'report'). */
  printTitle?: string | undefined;
  /** When provided, CSV/Excel/Print use every filtered row instead of just the current page. */
  fetchAllRows?: (() => Promise<T[]>) | undefined;
  emptyMessage?: string | undefined;
  toolbarExtra?: ReactNode | undefined;
}

const PER_PAGE_OPTIONS = [10, 25, 50, 100];

export function DataTable<T>({
  columns,
  rows = [],
  rowKey,
  loading,
  error,
  page = 1,
  perPage = 10,
  total,
  onPageChange,
  onPerPageChange,
  search,
  onSearch,
  searchPlaceholder = 'Search...',
  csvFilename,
  excelFilename,
  printTitle,
  printable,
  fetchAllRows,
  emptyMessage = 'No records found.',
  toolbarExtra,
}: DataTableProps<T>) {
  const [sortState, setSortState] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'excel' | 'print' | null>(null);

  const sortedRows = useMemo(() => {
    if (!sortState) return rows;
    const col = columns.find((c) => c.key === sortState.key);
    if (!col || !col.sortable) return rows;
    const field = col.sortKey ?? col.key;
    const dir = sortState.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = (a as Record<string, unknown>)[field];
      const bv = (b as Record<string, unknown>)[field];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [rows, sortState, columns]);

  const totalPages = total !== undefined ? Math.max(1, Math.ceil(total / perPage)) : 1;

  const toggleSort = (key: string) => {
    setSortState((prev) =>
      prev && prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    );
  };

  const exportColumns = columns.filter((c) => c.key !== 'actions').map((c) => ({ key: c.sortKey ?? c.key, header: c.header }));

  const resolveExportRows = async (): Promise<Record<string, unknown>[]> => {
    if (!fetchAllRows) {
      return sortedRows as unknown as Record<string, unknown>[];
    }
    const all = await fetchAllRows();
    const col = sortState ? columns.find((c) => c.key === sortState.key) : undefined;
    if (sortState && col?.sortable) {
      const field = col.sortKey ?? col.key;
      const dir = sortState.dir === 'asc' ? 1 : -1;
      all.sort((a, b) => {
        const av = (a as Record<string, unknown>)[field];
        const bv = (b as Record<string, unknown>)[field];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
      });
    }
    return all as unknown as Record<string, unknown>[];
  };

  const runExport = async (
    kind: 'csv' | 'excel' | 'print',
    writer: (rows: Record<string, unknown>[]) => void
  ) => {
    if (exporting) return;
    setExporting(kind);
    try {
      writer(await resolveExportRows());
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="data-table-clay">
      <div className="data-table-toolbar">
        <div className="data-table-toolbar-left">
          {onSearch && (
            <input
              className="search-input-clay"
              value={search ?? ''}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={searchPlaceholder}
            />
          )}
          {onPerPageChange && (
            <div className="data-table-perpage">
              <span>Show</span>
              <select
                className="form-control-clay form-control-sm"
                value={perPage}
                onChange={(e) => onPerPageChange(Number(e.target.value))}
              >
                {PER_PAGE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span>entries</span>
            </div>
          )}
        </div>
        <div className="data-table-toolbar-right">
          {csvFilename && (
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              disabled={exporting !== null}
              onClick={() =>
                void runExport('csv', (data) =>
                  downloadCsv(csvFilename, data, exportColumns)
                )
              }
            >
              {exporting === 'csv' ? 'Exporting...' : 'CSV'}
            </button>
          )}
          {excelFilename && (
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              disabled={exporting !== null}
              onClick={() =>
                void runExport('excel', (data) =>
                  exportExcel(excelFilename, data, exportColumns)
                )
              }
            >
              {exporting === 'excel' ? 'Exporting...' : 'Excel'}
            </button>
          )}
          {printable && (
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              disabled={exporting !== null}
              onClick={() =>
                void runExport('print', (data) =>
                  printReportWindow(
                    printTitle ?? csvFilename?.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') ?? 'Report',
                    [],
                    data,
                    exportColumns
                  )
                )
              }
            >
              {exporting === 'print' ? 'Preparing...' : 'Print'}
            </button>
          )}
          {toolbarExtra}
        </div>
      </div>

      {error ? (
        <div className="data-table-state data-table-error">{error}</div>
      ) : (
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    style={{ width: col.width, textAlign: col.align ?? 'left' }}
                    onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                    className={col.sortable ? 'data-table-sortable' : undefined}
                  >
                    {col.header}
                    {col.sortable && sortState?.key === col.key ? (
                      <Icon
                        icon={sortState.dir === 'asc' ? Icons.ChevronUp : Icons.ChevronDown}
                        size="xs"
                      />
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`}>
                    {columns.map((col) => (
                      <td key={col.key} className="skeleton-cell">
                        <div
                          className="skeleton skeleton-line"
                          style={{ width: `${55 + ((i * 13 + col.key.length * 7) % 40)}%` }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="data-table-state">
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <Icon icon={Icons.FolderOpen} size="xl" />
                      </div>
                      <div className="empty-state-title">{emptyMessage}</div>
                      <div className="empty-state-hint">Try adjusting your search or filters.</div>
                    </div>
                  </td>
                </tr>
              ) : (
                sortedRows.map((row) => (
                  <tr key={rowKey(row)}>
                    {columns.map((col) => (
                      <td key={col.key} style={{ textAlign: col.align ?? 'left' }}>
                        {col.render
                          ? col.render(row)
                          : String((row as Record<string, unknown>)[col.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {(onPageChange || onPerPageChange) && (
        <div className="data-table-footer">
          <div className="data-table-total">
            {total !== undefined
              ? `Showing ${(page - 1) * perPage + 1}–${Math.min(page * perPage, total)} of ${total} entries`
              : `${rows.length} entries`}
          </div>
          <div className="data-table-pagination">
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              disabled={page <= 1}
              onClick={() => onPageChange?.(page - 1)}
            >
              Previous
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
              .reduce<number[]>((acc, p) => {
                if (acc.length && p - acc[acc.length - 1] > 1) acc.push(-1);
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === -1 ? (
                  <span key={`gap-${i}`} className="data-table-page-gap">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    className={`btn-clay btn-clay-sm ${p === page ? 'btn-clay-primary' : 'btn-clay-secondary'}`}
                    onClick={() => onPageChange?.(p)}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange?.(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
