import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { attendance } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { ChartCard } from '../../components/charts/ChartCard';
import { AreaTrendChart, HorizontalBarChart } from '../../components/charts/charts';
import { formatStatusLabel } from '../../utils/statusLabels';
import { formatMonthLabel, isValidMonth, monthRange } from '../../utils/date';

interface Row {
  id: string;
  employee_code?: string;
  full_name?: string;
  work_date?: string;
  status?: string;
  late_minutes?: number | null;
  [key: string]: unknown;
}

export function AttendanceReportPage(): ReactElement {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'late' | 'daily' | 'summary' | 'detail' | 'worksheet'>('late');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [trend, setTrend] = useState<Record<string, unknown>[]>([]);
  const [byDepartment, setByDepartment] = useState<Array<{ id: string | null; name: string; present: number; late: number; absent: number; leave: number }>>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'late') {
        const res = await attendance.reports.late({ page, perPage });
        const data = res.data as unknown as { items: Row[]; total: number };
        setRows(data.items);
        setTotal(data.total);
      } else if (tab === 'daily') {
        const res = await attendance.reports.dailyPresent({ date });
        const items = res.data as unknown as Row[];
        setRows(items);
        setTotal(items.length);
      } else if (tab === 'summary') {
        const [y, m] = month.split('-').map(Number);
        const res = await attendance.reports.monthlySummary({ year: y, month: m });
        const items = res.data as unknown as Row[];
        setRows(items);
        setTotal(items.length);
      } else if (tab === 'detail') {
        if (!isValidMonth(month)) {
          setError('Please select a valid month.');
          setRows([]);
          setTotal(0);
          setLoading(false);
          return;
        }
        const res = await attendance.reports.monthlyDetail({
          page,
          perPage,
          'filter[work_date]': monthRange(month),
        });
        const data = res.data as unknown as { items: Row[]; total: number };
        setRows(data.items);
        setTotal(data.total);
      } else {
        const res = await attendance.reports.worksheet({ page, perPage });
        const data = res.data as unknown as { items: Row[]; total: number };
        setRows(data.items);
        setTotal(data.total);
      }
    } catch (e) {
      setError(e instanceof Error ? `Unable to load report. ${e.message}` : 'Unable to load report.');
    } finally {
      setLoading(false);
    }
  }, [tab, page, perPage, date, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const fetchAllRows = useCallback(async (): Promise<Row[]> => {
    if (tab === 'daily') {
      const res = await attendance.reports.dailyPresent({ date });
      return (res.data as unknown as Row[]) ?? [];
    }
    if (tab === 'summary') {
      const [y, m] = month.split('-').map(Number);
      const res = await attendance.reports.monthlySummary({ year: y, month: m });
      return (res.data as unknown as Row[]) ?? [];
    }
    if (tab === 'detail' && !isValidMonth(month)) return [];
    const fetchPage = (p: number) => {
      if (tab === 'late') return attendance.reports.late({ page: p, perPage: 100 });
      if (tab === 'detail') {
        return attendance.reports.monthlyDetail({ page: p, perPage: 100, 'filter[work_date]': monthRange(month) });
      }
      return attendance.reports.worksheet({ page: p, perPage: 100 });
    };
    const all: Row[] = [];
    let currentPage = 1;
    for (;;) {
      const res = await fetchPage(currentPage);
      const data = res.data as unknown as { items: Row[]; total: number };
      all.push(...data.items);
      if (data.items.length < 100 || all.length >= data.total || currentPage >= 500) break;
      currentPage += 1;
    }
    return all;
  }, [tab, date, month]);

  const TABS = [
    { id: 'late' as const, label: 'Late Report' },
    { id: 'daily' as const, label: 'Daily Present' },
    { id: 'summary' as const, label: 'Monthly Summary' },
    { id: 'detail' as const, label: 'Monthly Detail' },
    { id: 'worksheet' as const, label: 'Daily Worksheet' },
  ];

  useEffect(() => {
    setPage(1);
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    async function fetchAnalytics() {
      setAnalyticsLoading(true);
      try {
        const res = await attendance.analytics({ days: 30 });
        const d = res.data as { trend: Record<string, unknown>[]; byDepartment: Array<{ id: string | null; name: string; present: number; late: number; absent: number; leave: number }> };
        if (!cancelled) {
          setTrend(d.trend ?? []);
          setByDepartment(d.byDepartment ?? []);
        }
      } catch {
        /* optional */
      }
      if (!cancelled) setAnalyticsLoading(false);
    }
    void fetchAnalytics();
    return () => {
      cancelled = true;
    };
  }, []);

  const columns: DataColumn<Row>[] = [
    { key: 'employee_code', header: 'ID', render: (r) => <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{r.employee_code ?? '—'}</span> },
    { key: 'full_name', header: 'Employee', sortable: true, render: (r) => <strong>{r.full_name ?? '—'}</strong> },
    {
      key: 'department_name',
      header: 'Department',
      render: (r) => (r.department_name ? String(r.department_name) : '—'),
    },
    {
      key: 'work_date',
      header: 'Date',
      render: (r) => (r.work_date ? new Date(String(r.work_date)).toLocaleDateString() : '—'),
    },
    { key: 'status', header: 'Status', align: 'center', render: (r) => <StatusBadge value={r.status} /> },
    {
      key: 'late_minutes',
      header: 'Late (min)',
      align: 'center',
      render: (r) => (r.late_minutes !== null && r.late_minutes !== undefined ? String(r.late_minutes) : '—'),
    },
    {
      key: 'extras',
      header: 'Other',
      render: (r) => {
        const skip = ['employee_code', 'full_name', 'work_date', 'status', 'late_minutes', 'id'];
        const extras = Object.keys(r)
          .filter((k) => !skip.includes(k) && typeof r[k] === 'number')
          .map((k) => `${k.replace(/_/g, ' ')}: ${String(r[k])}`);
        return extras.length ? extras.join(' · ') : '—';
      },
    },
  ];

  return (
    <div>
      <PageHeader title="Attendance Report" subtitle="Generate and export attendance reports." />
      <div className="desktop-tab-bar subnav-bar" style={{ marginBottom: '0.8rem' }}>
        {TABS.map((t) => (
          <button key={t.id} className={`tab-btn-sleek ${tab === t.id ? 'active' : ''}`} onClick={() => { setTab(t.id); setPage(1); }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="analytics-grid analytics-grid-wide">
        <ChartCard
          title="Attendance Trend"
          subtitle="Last 30 days — present / late / absent / leave"
          loading={analyticsLoading}
          empty={trend.length === 0}
        >
          <AreaTrendChart
            data={trend}
            xKey="date"
            series={[
              { key: 'present', color: '#10b981' },
              { key: 'late', color: '#f59e0b' },
              { key: 'absent', color: '#ef4444' },
              { key: 'leave', color: '#2563eb' },
            ]}
            valueFormatter={(v) => `${v}`}
          />
          <div className="chart-legend">
            {[
              { key: 'present', color: '#10b981' },
              { key: 'late', color: '#f59e0b' },
              { key: 'absent', color: '#ef4444' },
              { key: 'leave', color: '#2563eb' },
            ].map((s) => (
              <span key={s.key} className="chart-legend-item">
                <span className="chart-legend-dot" style={{ background: s.color }} />
                <span className="chart-legend-label">{formatStatusLabel(s.key)}</span>
              </span>
            ))}
          </div>
        </ChartCard>

        <ChartCard
          title="Department Attendance Issues"
          subtitle="Late + absent days per department over the last 30 days — click a bar to open employees"
          loading={analyticsLoading}
          empty={byDepartment.length === 0}
        >
          <HorizontalBarChart
            data={byDepartment.map((d) => ({
              name: d.name,
              issues: Number(d.late ?? 0) + Number(d.absent ?? 0),
            }))}
            nameKey="name"
            valueKey="issues"
            color="#ef4444"
            onBarClick={(entry) => {
              const raw = byDepartment.find((d) => d.name === String(entry.name));
              if (raw?.id) navigate(`/hr/employees?departmentId=${encodeURIComponent(raw.id)}`);
            }}
          />
        </ChartCard>
      </div>

      <div className="filter-bar" style={{ marginBottom: '0.8rem' }}>
        {(tab === 'daily') && (
          <input type="date" className="form-control-clay form-control-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        )}
        {(tab === 'summary' || tab === 'detail') && (
          <input type="month" className="form-control-clay form-control-sm" value={month} onChange={(e) => setMonth(e.target.value)} />
        )}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.id ?? Math.random())}
        loading={loading}
        error={error}
        page={page}
        perPage={perPage}
        total={total}
        onPageChange={setPage}
        onPerPageChange={(p) => {
          setPerPage(p);
          setPage(1);
        }}
        csvFilename={`attendance-${tab}.csv`}
        printTitle={`Attendance ${TABS.find((t) => t.id === tab)?.label ?? 'Report'}`}
        excelFilename={`attendance-${tab}.xls`}
        fetchAllRows={fetchAllRows}
        printable
        emptyMessage={tab === 'detail' ? `No attendance records found for ${formatMonthLabel(month)}.` : 'No data for this report.'}
      />
    </div>
  );
}