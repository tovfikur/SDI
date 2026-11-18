import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ReactElement } from 'react';
import { hr, projects } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { ChartCard } from '../../components/charts/ChartCard';
import { DonutChart, HorizontalBarChart, VerticalBarChart } from '../../components/charts/charts';
import { statusColor } from '../../components/charts/chartTheme';
import { formatStatusLabel } from '../../utils/statusLabels';

interface Row {
  id: string;
  title: string;
  status: string;
  priority: string;
  project_id: string;
  project_name?: string;
  assignee_id: string | null;
  assignee_name?: string | null;
  progress_percent: number | null;
  estimated_hours: number | null;
  planned_start: string | null;
  planned_end: string | null;
}

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

export function EmployeeTaskOverviewPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status') ?? '';
  const priorityParam = searchParams.get('priority') ?? '';
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [workload, setWorkload] = useState<Array<Record<string, unknown>>>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [mixStatus, setMixStatus] = useState<Array<{ status: string; n: number }>>([]);
  const [mixPriority, setMixPriority] = useState<Array<{ priority: string; n: number }>>([]);
  const [mixLoading, setMixLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await projects.tasks({
        page,
        perPage,
        ...(selected ? { 'filter[assignee_id]': selected } : {}),
        ...(statusParam ? { 'filter[status]': statusParam } : {}),
        ...(priorityParam ? { 'filter[priority]': priorityParam } : {}),
      });
      const data = res.data as { items: Row[]; total: number };
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, selected, statusParam, priorityParam]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    async function loadEmployees() {
      try {
        const res = await hr.employees({ perPage: 100 });
        setEmployees((res.data as { items: Employee[] }).items);
        const urlEmployee = searchParams.get('employee_id');
        if (urlEmployee) setSelected(urlEmployee);
      } catch {
        /* optional */
      }
    }
    void loadEmployees();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [selected, statusParam, priorityParam]);

  useEffect(() => {
    let cancelled = false;
    async function fetchWorkload() {
      setAnalyticsLoading(true);
      try {
        const res = await projects.analytics();
        const d = res.data as { workload: Array<Record<string, unknown>> };
        if (!cancelled) setWorkload(d.workload ?? []);
      } catch {
        /* optional */
      }
      if (!cancelled) setAnalyticsLoading(false);
    }
    void fetchWorkload();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      setMixStatus([]);
      setMixPriority([]);
      return;
    }
    let cancelled = false;
    async function fetchMix() {
      setMixLoading(true);
      try {
        const res = await projects.tasks({
          perPage: 500,
          page: 1,
          'filter[assignee_id]': selected,
        });
        const data = res.data as { items: Row[] };
        const items = cancelled ? [] : data.items;
        if (!cancelled) {
          const byStatus = new Map<string, number>();
          const byPriority = new Map<string, number>();
          for (const t of items) {
            byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
            byPriority.set(t.priority, (byPriority.get(t.priority) ?? 0) + 1);
          }
          setMixStatus([...byStatus.entries()].map(([status, n]) => ({ status, n })));
          setMixPriority([...byPriority.entries()].map(([priority, n]) => ({ priority, n })));
        }
      } catch {
        /* optional */
      }
      if (!cancelled) setMixLoading(false);
    }
    void fetchMix();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const setFilter = (key: 'employee_id' | 'status' | 'priority', value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
    if (key === 'employee_id') setSelected(value);
  };

  const columns: DataColumn<Row>[] = [
    { key: 'title', header: 'Task', sortable: true, render: (r) => <strong>{r.title}</strong> },
    { key: 'project_name', header: 'Project', render: (r) => r.project_name ?? '—' },
    {
      key: 'assignee_name',
      header: 'Assignee',
      render: (r) =>
        r.assignee_name ?? employees.find((e) => e.id === r.assignee_id)?.full_name ?? '—',
    },
    {
      key: 'priority',
      header: 'Priority',
      align: 'center',
      render: (r) => <StatusBadge value={r.priority} />,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      render: (r) => <StatusBadge value={r.status} />,
    },
    {
      key: 'progress_percent',
      header: 'Progress',
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <div className="progress-clay" style={{ width: 90 }}>
            <div
              className="progress-fill"
              style={{ width: `${Math.min(100, Number(r.progress_percent ?? 0))}%` }}
            />
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {String(r.progress_percent ?? 0)}%
          </span>
        </div>
      ),
    },
    {
      key: 'estimated_hours',
      header: 'Est. Hours',
      align: 'center',
      render: (r) => r.estimated_hours ?? '—',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Employee Task Overview"
        subtitle="Tasks grouped by assignee across all projects."
      />

      <div className="analytics-grid analytics-grid-wide">
        <ChartCard
          title="Workload by Employee"
          subtitle="Active tasks per employee — click a bar to filter the table"
          loading={analyticsLoading}
          empty={workload.length === 0}
        >
          <HorizontalBarChart
            data={workload.map((w) => ({
              name: String(w.full_name ?? '—'),
              active: Number(w.active ?? 0),
            }))}
            nameKey="name"
            valueKey="active"
            onBarClick={(entry) => {
              const emp = workload.find((w) => w.full_name === String(entry.name));
              if (emp?.employee_id) setFilter('employee_id', String(emp.employee_id));
            }}
          />
        </ChartCard>

        <ChartCard
          title={selected ? 'Selected Employee — Task Mix' : 'Task Mix'}
          subtitle={
            selected
              ? 'Status & priority of the selected employee — click to filter'
              : 'Select an employee to see their status and priority mix'
          }
          loading={mixLoading}
          empty={mixStatus.length === 0 && mixPriority.length === 0}
          emptyMessage={selected ? 'No tasks found for this employee.' : 'No data available for this period.'}
        >
          <div className="analytics-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 0 }}>
            <div>
              <DonutChart
                data={mixStatus.map((t) => ({ key: t.status, value: t.n, color: statusColor(t.status) }))}
                onSliceClick={(key) => setFilter('status', key)}
                height={150}
              />
              <div className="chart-legend" style={{ justifyContent: 'center' }}>
                {mixStatus.map((t) => (
                  <button
                    key={t.status}
                    type="button"
                    className="chart-legend-item"
                    style={
                      statusParam === t.status
                        ? { borderColor: 'var(--primary)', color: 'var(--primary)', background: 'var(--brand-soft)' }
                        : undefined
                    }
                    onClick={() => setFilter('status', statusParam === t.status ? '' : t.status)}
                  >
                    <span className="chart-legend-dot" style={{ background: statusColor(t.status) }} />
                    <span className="chart-legend-label">{formatStatusLabel(t.status)}</span>
                    <span className="chart-legend-value">{t.n}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <VerticalBarChart
                data={mixPriority.map((pr) => ({ name: formatStatusLabel(pr.priority), priority: pr.n }))}
                xKey="name"
                barKey="priority"
                height={150}
                color={priorityParam ? statusColor(priorityParam) : 'var(--primary)'}
                onBarClick={(entry) => {
                  const raw = mixPriority.find((pr) => formatStatusLabel(pr.priority) === String(entry.name));
                  if (raw) setFilter('priority', raw.priority);
                }}
              />
            </div>
          </div>
        </ChartCard>
      </div>

      <div className="panel-clay" style={{ marginBottom: '0.8rem', maxWidth: 720 }}>
        <div className="form-inline-flex">
          <select
            className="form-control-clay form-control-sm"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} ({e.employee_code})
              </option>
            ))}
          </select>
        </div>
      </div>
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
        csvFilename="employee-task-overview.csv"
        excelFilename="employee-task-overview.xls"
        printable
        emptyMessage="No tasks assigned."
      />
    </div>
  );
}
