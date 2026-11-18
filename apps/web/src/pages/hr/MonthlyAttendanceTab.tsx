import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { attendance, hr } from '../../api';
import type { Branch } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { ChartCard } from '../../components/charts/ChartCard';
import { AreaTrendChart, DonutChart } from '../../components/charts/charts';
import { statusColor } from '../../components/charts/chartTheme';
import { formatStatusLabel } from '../../utils/statusLabels';
import { isValidMonth, monthRange } from '../../utils/date';
import { formatAttendanceTime, formatLateDuration } from '../../utils/time';

interface Row {
  id: string;
  employee_id: string;
  employee_code: string;
  full_name: string;
  work_date: string;
  status: string;
  late_minutes: number | null;
  late_out_minutes?: number | null;
  first_in?: string | null;
  last_out?: string | null;
  branch_name?: string | null;
}

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

export function MonthlyAttendanceTab(): ReactElement {
  const [rows, setRows] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [trend, setTrend] = useState<Record<string, unknown>[]>([]);
  const [today, setToday] = useState<Array<{ status: string; n: number }>>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [recalcTarget, setRecalcTarget] = useState<Row | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!isValidMonth(month)) {
        setRows([]);
        setTotal(0);
        setLoading(false);
        setError('Please select a valid month.');
        return;
      }
      const res = await attendance.events({
        page,
        perPage,
        'filter[work_date]': monthRange(month),
        ...(statusFilter ? { 'filter[status]': statusFilter } : {}),
        ...(branchId ? { 'filter[branch_id]': branchId } : {}),
      });
      const data = res.data as { items: Row[]; total: number };
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, month, statusFilter, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, branchId]);

  useEffect(() => {
    async function loadBranches() {
      try {
        const res = await hr.branches({ perPage: 100 });
        setBranches((res.data as { items: Branch[] }).items ?? []);
      } catch {
        /* optional */
      }
    }
    void loadBranches();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchAnalytics() {
      setAnalyticsLoading(true);
      const now = new Date();
      const start = new Date(`${month}-01`);
      const days = Math.min(120, Math.max(7, Math.round((now.getTime() - start.getTime()) / 86400000) + 1));
      try {
        const res = await attendance.analytics({ days });
        const d = res.data as { trend: Record<string, unknown>[]; today: Array<{ status: string; n: number }> };
        if (!cancelled) {
          setTrend(d.trend ?? []);
          setToday(d.today ?? []);
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
  }, [month]);

  useEffect(() => {
    async function loadEmployees() {
      try {
        const res = await hr.employees({ perPage: 100 });
        setEmployees((res.data as { items: Employee[] }).items);
      } catch {
        /* optional */
      }
    }
    void loadEmployees();
  }, []);

  const recalc = async () => {
    if (!recalcTarget) return;
    setSubmitting(true);
    try {
      await attendance.recalculate({ employeeId: recalcTarget.employee_id, workDate: recalcTarget.work_date.slice(0, 10) });
      setRecalcTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recalculation failed');
      setRecalcTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  const recalcAll = async () => {
    setSubmitting(true);
    setError('');
    try {
      const [y, m] = month.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const res = await attendance.recalcRange({ startDate: `${month}-01`, endDate: `${month}-${lastDay}` });
      setRecalcTarget(null);
      await load();
      setError(`Recalculated ${(res as { recalculated: number }).recalculated} day(s) for ${month}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recalculation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    { key: 'employee_code', header: 'ID', sortable: true, render: (r) => <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{r.employee_code}</span> },
    { key: 'full_name', header: 'Employee', sortable: true, render: (r) => <strong>{r.full_name}</strong> },
    { key: 'branch_name', header: 'Branch', render: (r) => r.branch_name ?? '—' },
    { key: 'work_date', header: 'Date', sortable: true, render: (r) => new Date(r.work_date).toLocaleDateString() },
    { key: 'first_in', header: 'First In', render: (r) => formatAttendanceTime(r.first_in) },
    { key: 'last_out', header: 'Last Out', render: (r) => formatAttendanceTime(r.last_out) },
    { key: 'status', header: 'Status', align: 'center', render: (r) => <StatusBadge value={r.status} /> },
    { key: 'late_minutes', header: 'Late In', align: 'center', sortable: true, render: (r) => formatLateDuration(r.late_minutes) },
    { key: 'late_out_minutes', header: 'Late Out', align: 'center', sortable: true, render: (r) => formatLateDuration(r.late_out_minutes) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => setRecalcTarget(r)}>
          Recalculate
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="panel-clay" style={{ marginBottom: '0.8rem' }}>
        <div className="form-inline-flex" style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Month</label>
            <input type="month" className="form-control-clay" value={month} onChange={(e) => { setMonth(e.target.value); setPage(1); }} />
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Branch</label>
            <select className="form-control-clay" value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }}>
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', alignSelf: 'flex-end', paddingBottom: 6 }}>
            Employees: {employees.length} loaded
          </span>
        </div>
      </div>

      <div className="analytics-grid analytics-grid-wide">
        <ChartCard
          title="Attendance Trend"
          subtitle={`Daily counts from ${month}-01 to today`}
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
          title="Today's Distribution"
          subtitle="Today by status — click a segment to filter the table"
          loading={analyticsLoading}
          empty={today.length === 0}
        >
          <DonutChart
            data={today.map((t) => ({ key: t.status, value: t.n, color: statusColor(t.status) }))}
            onSliceClick={(key) => setStatusFilter(statusFilter === key ? '' : key)}
          />
          <div className="chart-legend">
            {today.map((t) => (
              <button
                key={t.status}
                type="button"
                className="chart-legend-item"
                style={
                  statusFilter === t.status
                    ? { borderColor: 'var(--primary)', color: 'var(--primary)', background: 'var(--brand-soft)' }
                    : undefined
                }
                onClick={() => setStatusFilter(statusFilter === t.status ? '' : t.status)}
              >
                <span className="chart-legend-dot" style={{ background: statusColor(t.status) }} />
                <span className="chart-legend-label">{formatStatusLabel(t.status)}</span>
                <span className="chart-legend-value">{t.n}</span>
              </button>
            ))}
          </div>
        </ChartCard>
      </div>

      {statusFilter && (
        <div style={{ marginBottom: '0.75rem' }}>
          <button type="button" className="chart-legend-item" onClick={() => setStatusFilter('')}>
            Status: <strong>{formatStatusLabel(statusFilter)}</strong> &times;
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
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
        csvFilename={`attendance-${month}.csv`}
        excelFilename={`attendance-${month}.xls`}
        printable
        toolbarExtra={
          <button className="btn-clay btn-clay-secondary btn-clay-sm" onClick={recalcAll} disabled={submitting}>
            Recalculate All ({month})
          </button>
        }
        emptyMessage="No attendance days recorded for this month."
      />

      <Modal
        title="Recalculate Day"
        open={recalcTarget !== null}
        onClose={() => setRecalcTarget(null)}
        onSubmit={recalc}
        submitting={submitting}
        submitLabel="Recalculate"
      >
        <p>
          Recalculate attendance for <strong>{recalcTarget?.full_name}</strong> on{' '}
          {recalcTarget ? new Date(recalcTarget.work_date).toLocaleDateString() : ''}?
        </p>
      </Modal>
    </div>
  );
}