import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { hr, projects } from '../../api';
import { useToast } from '../../components/Toast';
import { downloadCsv, exportExcel, printReportWindow } from '../../utils/export';
import { Icon, Icons } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { ChartCard } from '../../components/charts/ChartCard';
import { DonutChart, HorizontalBarChart } from '../../components/charts/charts';
import { statusColor } from '../../components/charts/chartTheme';
import { formatStatusLabel } from '../../utils/statusLabels';

interface Client {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  client_id?: string | null;
}

interface Member {
  id: string;
  full_name: string;
}

interface ReportRow {
  id: string;
  name: string;
  client_id: string | null;
  client_name: string | null;
  lead_id: string | null;
  lead_name: string | null;
  status: string;
  start_date: string | null;
  ending_date: string | null;
  project_progress: number | null;
  total_tasks: number;
  done_tasks: number;
  avg_task_progress: number | null;
}

interface ReportSummary {
  total_projects: number;
  active_projects: number;
  completed_projects: number;
  total_tasks: number;
  completed_tasks: number;
  avg_project_progress: number | null;
}

interface ReportResponse {
  items: ReportRow[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  summary: ReportSummary;
}

interface ReportFilters {
  projectId: string;
  clientId: string;
  memberId: string;
  status: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: ReportFilters = {
  projectId: '',
  clientId: '',
  memberId: '',
  status: '',
  dateFrom: '',
  dateTo: '',
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function fmtPct(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0%';
  const clamped = Math.min(100, Math.max(0, n));
  const rounded = Math.round(clamped * 100) / 100;
  const s = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `${s}%`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

const PER_PAGE_OPTIONS = [10, 25, 50, 100];

const SORTABLE = {
  name: 'name',
  client: 'client',
  status: 'status',
  progress: 'progress',
  start_date: 'start_date',
  ending_date: 'ending_date',
  task_count: 'task_count',
  avg_task_progress: 'avg_task_progress',
} as const;

type SortField = keyof typeof SORTABLE;

export function ProjectReportsPage(): ReactElement {
  const { toast } = useToast();

  const [rows, setRows] = useState<ReportRow[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({
    field: 'name',
    dir: 'asc',
  });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<ReportFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'excel' | 'print' | null>(null);

  const [clients, setClients] = useState<Client[]>([]);
  const [projectOptions, setProjectOptions] = useState<Project[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const statusMix = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return [...m.entries()].map(([status, n]) => ({ status, n }));
  }, [rows]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [c, p, e] = await Promise.all([
          projects.clients({ perPage: 100 }),
          projects.list({ perPage: 100 }),
          hr.employees({ perPage: 100 }),
        ]);
        setClients((c.data as { items: Client[] }).items);
        setProjectOptions((p.data as { items: Project[] }).items);
        setMembers((e.data as { items: Member[] }).items);
      } catch {
        /* lookups are optional */
      }
    })();
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search]);

  const buildParams = useCallback(
    (pageNum: number, per: number, all = false): Record<string, string | number> => {
      const params: Record<string, string | number> = { page: pageNum, perPage: per };
      if (all) params.all = 'true';
      if (debouncedSearch) params.search = debouncedSearch;
      if (filters.projectId) params.projectId = filters.projectId;
      if (filters.clientId) params.clientId = filters.clientId;
      if (filters.memberId) params.memberId = filters.memberId;
      if (filters.status) params.status = filters.status;
      if (filters.dateFrom) params.dateFrom = filters.dateFrom;
      if (filters.dateTo) params.dateTo = filters.dateTo;
      params.sort = SORTABLE[sort.field];
      params.direction = sort.dir;
      return params;
    },
    [debouncedSearch, filters, sort]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await projects.reports(buildParams(page, perPage));
      const data = res.data as unknown as ReportResponse;
      setRows(data.items);
      setTotal(data.total);
      setSummary(data.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load project report');
    } finally {
      setLoading(false);
    }
  }, [buildParams, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSort = (field: SortField) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' }
    );
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const applyFilters = () => {
    setFilters(draftFilters);
    setPage(1);
    setFilterOpen(false);
  };

  const resetFilters = () => {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
    setFilterOpen(false);
  };

  const exportColumns = [
    { key: 'project', header: 'Project' },
    { key: 'client', header: 'Client' },
    { key: 'lead', header: 'Project Lead' },
    { key: 'status', header: 'Status' },
    { key: 'progress', header: 'Progress' },
    { key: 'start', header: 'Start Date' },
    { key: 'end', header: 'End Date' },
    { key: 'totalTasks', header: 'Total Tasks' },
    { key: 'completedTasks', header: 'Completed Tasks' },
    { key: 'avgTaskProgress', header: 'Avg Task Progress' },
  ];

  const handleExport = async (kind: 'csv' | 'excel' | 'print') => {
    setExporting(kind);
    try {
      const res = await projects.reports(buildParams(1, perPage, true));
      const data = res.data as unknown as ReportResponse;
      const mapped = (data?.items ?? []).map((r) => ({
        project: r.name,
        client: r.client_name ?? '',
        lead: r.lead_name ?? '',
        status: formatStatusLabel(r.status),
        progress: fmtPct(r.project_progress),
        start: formatDate(r.start_date),
        end: formatDate(r.ending_date),
        totalTasks: r.total_tasks,
        completedTasks: r.done_tasks,
        avgTaskProgress: fmtPct(r.avg_task_progress),
      }));
      if (kind === 'csv') {
        downloadCsv('project-reports.csv', mapped, exportColumns);
      } else if (kind === 'excel') {
        exportExcel('project-reports.xls', mapped, exportColumns);
      } else {
        printReportWindow(
          'Project Reports',
          [
            'Self Development Initiative',
            `Generated: ${new Date().toLocaleString()}`,
            `Filters: ${filterSummaryText()}`,
          ],
          mapped,
          exportColumns
        );
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed', 'error');
    } finally {
      setExporting(null);
    }
  };

  const filterSummaryText = (): string => {
    const parts: string[] = [];
    if (filters.projectId) {
      const p = projectOptions.find((x) => x.id === filters.projectId);
      if (p) parts.push(`Project: ${p.name}`);
    }
    if (filters.clientId) {
      const c = clients.find((x) => x.id === filters.clientId);
      if (c) parts.push(`Client: ${c.name}`);
    }
    if (filters.memberId) {
      const m = members.find((x) => x.id === filters.memberId);
      if (m) parts.push(`Member: ${m.full_name}`);
    }
    if (filters.status) parts.push(`Status: ${formatStatusLabel(filters.status)}`);
    if (filters.dateFrom) parts.push(`From: ${formatDate(filters.dateFrom)}`);
    if (filters.dateTo) parts.push(`To: ${formatDate(filters.dateTo)}`);
    if (debouncedSearch) parts.push(`Search: "${debouncedSearch}"`);
    return parts.length > 0 ? parts.join(' | ') : 'All projects';
  };

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2
  );
  const pageItems = pageNumbers.reduce<number[]>((acc, p) => {
    if (acc.length && p - acc[acc.length - 1] > 1) acc.push(-1);
    acc.push(p);
    return acc;
  }, []);

  const shownStart = total === 0 ? 0 : (page - 1) * perPage + 1;
  const shownEnd = Math.min(page * perPage, total);

  const columns: { key: string; header: string; sortable?: boolean; align?: 'left' | 'center' }[] =
    [
      { key: 'name', header: 'Project', sortable: true },
      { key: 'client_name', header: 'Client', sortable: true },
      { key: 'lead_name', header: 'Project Lead' },
      { key: 'status', header: 'Status', sortable: true },
      { key: 'project_progress', header: 'Progress', sortable: true, align: 'center' },
      { key: 'start_date', header: 'Start Date', sortable: true },
      { key: 'ending_date', header: 'End Date', sortable: true },
      { key: 'total_tasks', header: 'Total Tasks', sortable: true, align: 'center' },
      { key: 'done_tasks', header: 'Completed Tasks', align: 'center' },
      { key: 'avg_task_progress', header: 'Avg Task Progress', sortable: true, align: 'center' },
    ];

  const sortKeyFor = (colKey: string): SortField | null => {
    const map: Record<string, SortField> = {
      name: 'name',
      client_name: 'client',
      status: 'status',
      project_progress: 'progress',
      start_date: 'start_date',
      ending_date: 'ending_date',
      total_tasks: 'task_count',
      avg_task_progress: 'avg_task_progress',
    };
    return map[colKey] ?? null;
  };

  return (
    <div className="report-page">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Project Reports</h1>
          <p className="page-subtitle">
            Aggregate project health report derived from live project and task data.
          </p>
        </div>
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div className="stats-grid">
          <div className="stat-card-clay">
            <div>
              <div className="stat-label">Total Projects</div>
              <div className="stat-value">{summary.total_projects}</div>
            </div>
            <div className="stat-icon-clay">
              <Icon icon={Icons.FolderOpen} />
            </div>
          </div>
          <div className="stat-card-clay">
            <div>
              <div className="stat-label">Active Projects</div>
              <div className="stat-value">{summary.active_projects}</div>
            </div>
            <div className="stat-icon-clay">
              <Icon icon={Icons.Rocket} />
            </div>
          </div>
          <div className="stat-card-clay">
            <div>
              <div className="stat-label">Completed Projects</div>
              <div className="stat-value">{summary.completed_projects}</div>
            </div>
            <div className="stat-icon-clay">
              <Icon icon={Icons.Check} />
            </div>
          </div>
          <div className="stat-card-clay">
            <div>
              <div className="stat-label">Total Tasks</div>
              <div className="stat-value">{summary.total_tasks}</div>
            </div>
            <div className="stat-icon-clay">
              <Icon icon={Icons.PuzzlePiece} />
            </div>
          </div>
          <div className="stat-card-clay">
            <div>
              <div className="stat-label">Completed Tasks</div>
              <div className="stat-value">{summary.completed_tasks}</div>
            </div>
            <div className="stat-icon-clay">
              <Icon icon={Icons.FlagCheckered} />
            </div>
          </div>
          <div className="stat-card-clay">
            <div>
              <div className="stat-label">Avg Project Progress</div>
              <div className="stat-value">{fmtPct(summary.avg_project_progress)}</div>
            </div>
            <div className="stat-icon-clay">
              <Icon icon={Icons.ChartBar} />
            </div>
          </div>
        </div>
      )}

      {/* Report charts */}
      <div className="analytics-grid analytics-grid-wide">
        <ChartCard
          title="Project Status Mix"
          subtitle="Status distribution of the projects in this report — click a segment to filter by status"
          loading={loading}
          empty={statusMix.length === 0}
        >
          <DonutChart
            data={statusMix.map((t) => ({ key: t.status, value: t.n, color: statusColor(t.status) }))}
            onSliceClick={(key) => {
              setDraftFilters((f) => ({ ...f, status: filters.status === key ? '' : key }));
              setFilters((f) => ({ ...f, status: filters.status === key ? '' : key }));
              setPage(1);
            }}
          />
          <div className="chart-legend">
            {statusMix.map((t) => (
              <button
                key={t.status}
                type="button"
                className="chart-legend-item"
                style={
                  filters.status === t.status
                    ? { borderColor: 'var(--primary)', color: 'var(--primary)', background: 'var(--brand-soft)' }
                    : undefined
                }
                onClick={() => {
                  setDraftFilters((f) => ({ ...f, status: filters.status === t.status ? '' : t.status }));
                  setFilters((f) => ({ ...f, status: filters.status === t.status ? '' : t.status }));
                  setPage(1);
                }}
              >
                <span className="chart-legend-dot" style={{ background: statusColor(t.status) }} />
                <span className="chart-legend-label">{formatStatusLabel(t.status)}</span>
                <span className="chart-legend-value">{t.n}</span>
              </button>
            ))}
          </div>
        </ChartCard>

        <ChartCard
          title="Project Progress"
          subtitle="Progress of projects on this report (top 12)"
          loading={loading}
          empty={rows.length === 0}
        >
          <HorizontalBarChart
            data={[...rows]
              .sort((a, b) => Number(b.project_progress ?? 0) - Number(a.project_progress ?? 0))
              .slice(0, 12)
              .map((r) => ({ name: String(r.name ?? '—'), progress: Math.round(Number(r.project_progress ?? 0)) }))}
            nameKey="name"
            valueKey="progress"
            valueFormatter={(v) => `${v}%`}
          />
        </ChartCard>
      </div>

      {/* Toolbar */}
      <div className="activity-toolbar">
        <div className="activity-toolbar-left">
          <button className="btn-clay btn-clay-secondary" onClick={() => setFilterOpen(true)}>
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
          {activeFilterCount > 0 && (
            <button className="btn-clay btn-clay-secondary" onClick={resetFilters}>
              Reset
            </button>
          )}
          <div className="data-table-perpage">
            <span>Show</span>
            <select
              className="form-control-clay form-control-sm"
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
              }}
            >
              {PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>entries</span>
          </div>
        </div>
        <div className="activity-toolbar-right">
          <input
            className="search-input-clay"
            placeholder="Search project, client, lead, status..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="activity-export-group">
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              disabled={exporting !== null}
              onClick={() => handleExport('csv')}
            >
              {exporting === 'csv' ? 'Exporting...' : 'CSV'}
            </button>
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              disabled={exporting !== null}
              onClick={() => handleExport('excel')}
            >
              {exporting === 'excel' ? 'Exporting...' : 'Excel'}
            </button>
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              disabled={exporting !== null}
              onClick={() => handleExport('print')}
            >
              {exporting === 'print' ? 'Preparing...' : 'Print'}
            </button>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error ? (
        <div className="panel-clay report-state-panel">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon icon={Icons.Warning} />
            </div>
            <div className="empty-state-title">Could not load the project report</div>
            <div className="empty-state-hint">{error}</div>
            <button
              className="btn-clay btn-clay-primary"
              onClick={() => {
                setError('');
                void load();
              }}
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="data-table-clay">
            <div className="report-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    {columns.map((col) => {
                      const sk = sortKeyFor(col.key);
                      return (
                        <th
                          key={col.key}
                          style={{ textAlign: col.align ?? 'left' }}
                          className={sk ? 'data-table-sortable' : undefined}
                          onClick={sk ? () => toggleSort(sk) : undefined}
                        >
                          {col.header}
                          {sk && sort.field === sk ? (
                            <Icon
                              icon={sort.dir === 'asc' ? Icons.ChevronUp : Icons.ChevronDown}
                              size="xs"
                            />
                          ) : null}
                        </th>
                      );
                    })}
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
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length} className="data-table-state">
                        <div className="empty-state">
                          <div className="empty-state-icon">
                            <Icon icon={Icons.FolderOpen} />
                          </div>
                          <div className="empty-state-title">
                            No project report data found for the selected filters.
                          </div>
                          <div className="empty-state-hint">
                            Try clearing the filters to see the full report.
                          </div>
                          <button className="btn-clay btn-clay-secondary" onClick={resetFilters}>
                            Reset Filters
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.name}</strong>
                        </td>
                        <td>{row.client_name ?? '—'}</td>
                        <td>{row.lead_name ?? '—'}</td>
                        <td>
                          <StatusBadge value={row.status} />
                        </td>
                        <td className="report-progress-cell">
                          <div className="progress-clay" style={{ width: 72 }}>
                            <div
                              className="progress-fill"
                              style={{
                                width: `${Math.min(100, Number(row.project_progress ?? 0))}%`,
                              }}
                            />
                          </div>
                          <span className="report-progress-label">
                            {fmtPct(row.project_progress)}
                          </span>
                        </td>
                        <td>{formatDate(row.start_date)}</td>
                        <td>{formatDate(row.ending_date)}</td>
                        <td style={{ textAlign: 'center' }}>{row.total_tasks}</td>
                        <td style={{ textAlign: 'center' }}>{row.done_tasks}</td>
                        <td className="report-progress-cell">
                          <div className="progress-clay" style={{ width: 72 }}>
                            <div
                              className="progress-fill"
                              style={{
                                width: `${Math.min(100, Number(row.avg_task_progress ?? 0))}%`,
                              }}
                            />
                          </div>
                          <span className="report-progress-label">
                            {fmtPct(row.avg_task_progress)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="data-table-footer">
              <div className="data-table-total">
                {total === 0
                  ? 'No entries'
                  : `Showing ${shownStart} to ${shownEnd} of ${total} entries`}
              </div>
              <div className="data-table-pagination">
                <button
                  className="btn-clay btn-clay-secondary btn-clay-sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                {pageItems.map((p, i) =>
                  p === -1 ? (
                    <span key={`gap-${i}`} className="data-table-page-gap">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      className={`btn-clay btn-clay-sm ${p === page ? 'btn-clay-primary' : 'btn-clay-secondary'}`}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  )
                )}
                <button
                  className="btn-clay btn-clay-secondary btn-clay-sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {/* Mobile cards */}
          {!loading && (
            <div className="report-mobile-cards">
              {rows.map((row) => (
                <div key={row.id} className="report-card">
                  <div className="report-card-head">
                    <span className="report-card-name">{row.name}</span>
                    <StatusBadge value={row.status} />
                  </div>
                  <div className="report-card-row">
                    <span>{row.client_name ?? '—'}</span>
                    <span>Lead: {row.lead_name ?? '—'}</span>
                  </div>
                  <div className="report-card-progress">
                    <div className="report-card-progress-label">Project Progress</div>
                    <div className="report-progress-cell">
                      <div className="progress-clay" style={{ flex: 1 }}>
                        <div
                          className="progress-fill"
                          style={{ width: `${Math.min(100, Number(row.project_progress ?? 0))}%` }}
                        />
                      </div>
                      <span className="report-progress-label">{fmtPct(row.project_progress)}</span>
                    </div>
                  </div>
                  <div className="report-card-progress">
                    <div className="report-card-progress-label">Avg Task Progress</div>
                    <div className="report-progress-cell">
                      <div className="progress-clay" style={{ flex: 1 }}>
                        <div
                          className="progress-fill"
                          style={{ width: `${Math.min(100, Number(row.avg_task_progress ?? 0))}%` }}
                        />
                      </div>
                      <span className="report-progress-label">{fmtPct(row.avg_task_progress)}</span>
                    </div>
                  </div>
                  <div className="report-card-meta">
                    <span>
                      {formatDate(row.start_date)} → {formatDate(row.ending_date)}
                    </span>
                    <span>
                      Tasks: {row.done_tasks}/{row.total_tasks} done
                    </span>
                  </div>
                </div>
              ))}
              {rows.length === 0 && (
                <div className="panel-clay report-state-panel">
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <Icon icon={Icons.FolderOpen} />
                    </div>
                    <div className="empty-state-title">
                      No project report data found for the selected filters.
                    </div>
                    <button className="btn-clay btn-clay-secondary" onClick={resetFilters}>
                      Reset Filters
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Filter panel */}
      {filterOpen && (
        <>
          {!isMobile && (
            <div className="filter-popover-backdrop" onClick={() => setFilterOpen(false)} />
          )}
          <div
            className={isMobile ? 'modal-overlay' : 'filter-popover'}
            onClick={isMobile ? () => setFilterOpen(false) : undefined}
          >
            <div
              className={isMobile ? 'modal-content-clay filter-sheet' : 'filter-popover-panel'}
              onClick={(e) => e.stopPropagation()}
            >
              {isMobile && <div className="bottom-sheet-handle" />}
              <div className="modal-header-clay">
                <div className="modal-title-clay">Filter Project Report</div>
                <button className="modal-close-btn" onClick={() => setFilterOpen(false)}>
                  <Icon icon={Icons.Close} />
                </button>
              </div>
              <div className="modal-body-clay">
                <div className="form-group">
                  <label className="form-label">Client</label>
                  <select
                    className="form-control-clay"
                    value={draftFilters.clientId}
                    onChange={(e) =>
                      setDraftFilters((f) => ({
                        ...f,
                        clientId: e.target.value,
                        projectId: e.target.value ? f.projectId : '',
                      }))
                    }
                  >
                    <option value="">All clients</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Project</label>
                  <select
                    className="form-control-clay"
                    value={draftFilters.projectId}
                    onChange={(e) => setDraftFilters((f) => ({ ...f, projectId: e.target.value }))}
                  >
                    <option value="">All projects</option>
                    {(draftFilters.clientId
                      ? projectOptions.filter((p) => p.client_id === draftFilters.clientId)
                      : projectOptions
                    ).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Member</label>
                  <select
                    className="form-control-clay"
                    value={draftFilters.memberId}
                    onChange={(e) => setDraftFilters((f) => ({ ...f, memberId: e.target.value }))}
                  >
                    <option value="">All members</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name}
                      </option>
                    ))}
                  </select>
                  <p className="report-filter-hint">
                    Matches projects where the person is the lead, a team member, or a task
                    assignee.
                  </p>
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select
                    className="form-control-clay"
                    value={draftFilters.status}
                    onChange={(e) => setDraftFilters((f) => ({ ...f, status: e.target.value }))}
                  >
                    <option value="">All statuses</option>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Project Start From</label>
                    <input
                      type="date"
                      className="form-control-clay"
                      value={draftFilters.dateFrom}
                      onChange={(e) => setDraftFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Project Start To</label>
                    <input
                      type="date"
                      className="form-control-clay"
                      value={draftFilters.dateTo}
                      onChange={(e) => setDraftFilters((f) => ({ ...f, dateTo: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer-clay">
                <button className="btn-clay btn-clay-secondary" onClick={resetFilters}>
                  Reset
                </button>
                <button className="btn-clay btn-clay-primary" onClick={applyFilters}>
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
