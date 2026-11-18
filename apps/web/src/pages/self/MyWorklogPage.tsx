import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { attendance, hr, projects } from '../../api';
import { useCurrentUser } from '../../auth-context';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Icon, Icons } from '../../components/Icon';
import { ChartCard } from '../../components/charts/ChartCard';
import { VerticalBarChart, DonutChart } from '../../components/charts/charts';
import { statusColor } from '../../components/charts/chartTheme';
import { printWorklogSummaryReport } from '../../utils/export';
import { formatLateDuration } from '../../utils/time';

interface Row {
  id: string;
  work_date: string;
  project_id: string | null;
  task_id: string | null;
  project_name?: string | null;
  task_name?: string | null;
  hours: string;
  work_description: string;
  status: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

export function MyWorklogPage(): ReactElement {
  const user = useCurrentUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [projectsList, setProjectsList] = useState<ProjectOption[]>([]);
  const [tasksList, setTasksList] = useState<Array<{ id: string; title: string; project_id: string }>>([]);
  const [summary, setSummary] = useState<{ today_hours: number; week_hours: number; pending: number; approved: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    work_date: '',
    project_id: '',
    task_id: '',
    hours: 8,
    work_description: '',
  });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await projects.dailyTasks({ perPage: 100 });
      setRows((res.data as { items: Row[] }).items);
      const summaryRes = await projects.dailyTasksSummary();
      setSummary(summaryRes.data);
      const projRes = await projects.list({ perPage: 100 });
      setProjectsList((projRes.data as { items: ProjectOption[] }).items);
      const tasksRes = await projects.tasks({ perPage: 100 });
      setTasksList(
        (tasksRes.data as { items: Array<{ id: string; title: string; project_id: string }> }).items
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load work log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ work_date: new Date().toISOString().slice(0, 10), project_id: '', task_id: '', hours: 8, work_description: '' });
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm({
      work_date: String(row.work_date ?? ''),
      project_id: row.project_id ?? '',
      task_id: row.task_id ?? '',
      hours: Number(row.hours ?? 0),
      work_description: String(row.work_description ?? ''),
    });
    setFormError('');
    setModalOpen(true);
  };

  const submit = async () => {
    if (!form.work_date || !form.project_id || !form.work_description.trim()) {
      setFormError('Date, project and description are required.');
      return;
    }
    const hours = Number(form.hours);
    if (!form.hours || Number.isNaN(hours) || hours <= 0 || hours > 24) {
      setFormError('Hours must be a number between 0 and 24.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      if (editing) {
        await projects.updateDailyTask(editing.id, {
          work_date: form.work_date,
          project_id: form.project_id,
          task_id: form.task_id || null,
          hours: Number(form.hours) || 0,
          work_description: form.work_description.trim(),
        });
      } else {
        await projects.createDailyTask({
          work_date: form.work_date,
          project_id: form.project_id,
          task_id: form.task_id || null,
          hours: Number(form.hours) || 0,
          work_description: form.work_description.trim(),
        });
      }
      setModalOpen(false);
      toast(editing ? 'Timesheet entry updated.' : 'Timesheet entry added.', 'success');
      void load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save work log');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    {
      key: 'work_date',
      header: 'Date',
      render: (r) => String(r.work_date ?? '—'),
    },
    {
      key: 'project_name',
      header: 'Project',
      render: (r) => r.project_name ?? '—',
    },
    {
      key: 'task_name',
      header: 'Task',
      render: (r) => r.task_name ?? '—',
    },
    {
      key: 'hours',
      header: 'Hours',
      render: (r) => `${Number(r.hours ?? 0)}h`,
    },
    {
      key: 'work_description',
      header: 'Description',
      render: (r) => <span style={{ whiteSpace: 'pre-wrap' }}>{r.work_description}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge value={r.status} />,
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        r.status === 'draft' || r.status === 'rejected' ? (
          <button className="btn btn-sm btn-outline" onClick={() => openEdit(r)}>
            Edit
          </button>
        ) : null,
    },
  ];

  const availableTasks = tasksList.filter((t) => !form.project_id || t.project_id === form.project_id);

  const last14Days = useMemo(() => {
    const days: Array<{ day: string; iso: string; hours: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({ day: d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }), iso: d.toISOString().slice(0, 10), hours: 0 });
    }
    for (const r of rows) {
      const idx = days.findIndex((d) => d.iso === String(r.work_date ?? ''));
      if (idx >= 0) days[idx].hours += Number(r.hours ?? 0);
    }
    return days.map(({ day, hours }) => ({ day, hours }));
  }, [rows]);

  const statusMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    return [...counts.entries()].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n);
  }, [rows]);

  const totalHours = rows.reduce((s, r) => s + Number(r.hours ?? 0), 0);

  const handlePrintSummaryReport = async () => {
    try {
      const targetEmpId = user?.employeeId;
      if (!targetEmpId) {
        toast('No employee profile associated with your account.', 'error');
        return;
      }
      const now = new Date();
      const curMonth = now.toISOString().slice(0, 7);
      const dFrom = `${curMonth}-01`;
      const dTo = now.toISOString().slice(0, 10);

      // Load employee profile
      let empName = user?.fullName || 'Employee';
      let empCode = '';
      let empDept = '';
      let empBranch = '';
      let empDesignation = '';
      try {
        const empRes = await hr.employee(targetEmpId);
        const emp = empRes.data as Record<string, unknown>;
        empName = String(emp.full_name || empName);
        empCode = String(emp.employee_code || '');
        empDept = String(emp.department_name || '');
        empBranch = String(emp.branch_name || '');
        empDesignation = String(emp.position_name || '');
      } catch {
        /* optional */
      }

      // Load attendance events for month
      let attEvents: Record<string, unknown>[] = [];
      try {
        const attRes = await attendance.events({
          'filter[employee_id]': targetEmpId,
          'filter[work_date]': `${dFrom}..${dTo}`,
          perPage: 100,
        });
        attEvents = ((attRes.data as { items: Record<string, unknown>[] }).items ?? []) as Record<string, unknown>[];
      } catch {
        /* optional */
      }

      const startMs = new Date(dFrom).getTime();
      const endMs = new Date(dTo).getTime();
      const totalDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);

      let workedDays = 0;
      let lateCount = 0;
      let totalLateMinutes = 0;
      let offDayDutyDays = 0;
      let outsideGeofenceDays = 0;
      let leaveDays = 0;
      let absentDays = 0;

      for (const ev of attEvents) {
        const st = String(ev.status || '').toLowerCase();
        const lMin = Number(ev.late_minutes || 0);
        if (st === 'present') {
          workedDays++;
        } else if (st === 'late') {
          workedDays++;
          lateCount++;
          totalLateMinutes += lMin;
        } else if (st.includes('holidaypresent') || st.includes('restdaypresent')) {
          workedDays++;
          offDayDutyDays++;
        } else if (st.includes('leave')) {
          leaveDays++;
        } else if (st === 'absent' || st === 'missing') {
          absentDays++;
        }
        if (ev.outside_geofence || ev.geofence_status === 'outside') {
          outsideGeofenceDays++;
        }
      }

      const worklogs = rows.map((w) => ({
        date: w.work_date ? new Date(`${w.work_date.slice(0, 10)}T00:00:00`).toLocaleDateString() : '—',
        project: w.project_name ?? '—',
        task: w.task_name ?? '—',
        description: w.work_description || '—',
        hours: w.hours,
        status: w.status,
      }));

      printWorklogSummaryReport({
        employee: {
          name: empName,
          code: empCode,
          department: empDept,
          branch: empBranch,
          designation: empDesignation,
        },
        period: { from: dFrom, to: dTo },
        attendanceSummary: {
          totalDays,
          workedDays,
          lateCount,
          lateDuration: formatLateDuration(totalLateMinutes),
          offDayDutyDays,
          outsideGeofenceDays,
          leaveDays,
          absentDays,
        },
        worklogs,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to generate report', 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title="My Timesheet"
        subtitle="Your daily work log across projects"
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-outline"
              onClick={handlePrintSummaryReport}
              title="Download your monthly worklog & attendance summary report"
            >
              <Icon icon={Icons.Print} size="sm" /> Download Summary Report
            </button>
            <button className="btn btn-primary" onClick={openCreate}>
              + Add Entry
            </button>
          </div>
        }
      />

      <div className="kpi-grid hrdash-kpi-grid">
        <div className="hrdash-kpi">
          <span className="hrdash-kpi-icon" style={{ background: '#10b9811f', color: '#10b981' }}>
            <Icon icon={Icons.Clock} size="lg" />
          </span>
          <span className="hrdash-kpi-body">
            <span className="hrdash-kpi-value">{summary ? `${summary.today_hours ?? 0}h` : '—'}</span>
            <span className="hrdash-kpi-label">Hours Today</span>
          </span>
        </div>
        <div className="hrdash-kpi">
          <span className="hrdash-kpi-icon" style={{ background: '#f59e0b1f', color: '#f59e0b' }}>
            <Icon icon={Icons.CalendarDays} size="lg" />
          </span>
          <span className="hrdash-kpi-body">
            <span className="hrdash-kpi-value">{summary ? `${summary.week_hours ?? 0}h` : '—'}</span>
            <span className="hrdash-kpi-label">Hours This Week</span>
          </span>
        </div>
        <div className="hrdash-kpi">
          <span className="hrdash-kpi-icon" style={{ background: '#f59e0b1f', color: '#f59e0b' }}>
            <Icon icon={Icons.Hourglass} size="lg" />
          </span>
          <span className="hrdash-kpi-body">
            <span className="hrdash-kpi-value">{summary?.pending ?? 0}</span>
            <span className="hrdash-kpi-label">Pending Approval</span>
          </span>
        </div>
        <div className="hrdash-kpi">
          <span className="hrdash-kpi-icon" style={{ background: '#6366f11f', color: '#6366f1' }}>
            <Icon icon={Icons.ListCheck} size="lg" />
          </span>
          <span className="hrdash-kpi-body">
            <span className="hrdash-kpi-value">{totalHours}h</span>
            <span className="hrdash-kpi-label">Total Logged</span>
          </span>
        </div>
      </div>

      <div className="analytics-grid analytics-grid-wide">
        <ChartCard
          title="Hours Logged — Last 14 Days"
          loading={loading}
          empty={last14Days.every((d) => Number(d.hours) === 0)}
          emptyMessage="No work log entries in the last 14 days."
        >
          <VerticalBarChart data={last14Days} xKey="day" barKey="hours" color="#10b981" height={190} />
        </ChartCard>
        <ChartCard
          title="Approval Status"
          subtitle="Submission status of your entries"
          loading={loading}
          empty={statusMix.length === 0}
          emptyMessage="No entries yet."
        >
          <DonutChart
            data={statusMix.map((s) => ({ key: s.status, value: s.n, color: statusColor(s.status) }))}
            height={185}
          />
        </ChartCard>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {loading ? (
        <div className="data-table-state">Loading work log…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          emptyMessage="No work log entries yet."
          page={page}
          perPage={perPage}
          total={rows.length}
          onPageChange={(p) => setPage(p)}
          onPerPageChange={(n) => setPerPage(n)}
        />
      )}

      <Modal
        open={modalOpen}
        title={editing ? 'Edit Timesheet Entry' : 'Add Timesheet Entry'}
        onClose={() => setModalOpen(false)}
        onSubmit={() => void submit()}
        submitting={submitting}
        submitLabel={editing ? 'Save Changes' : 'Add Entry'}
        busyLabel="Saving…"
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label form-required">Date</label>
            <input
              type="date"
              className="form-control"
              value={form.work_date}
              onChange={(e) => setForm({ ...form, work_date: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label form-required">Hours</label>
            <input
              type="number"
              min={0.5}
              max={24}
              step={0.5}
              className="form-control"
              value={form.hours}
              onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label form-required">Project</label>
            <select
              className="form-control"
              value={form.project_id}
              onChange={(e) => setForm({ ...form, project_id: e.target.value, task_id: '' })}
            >
              <option value="">Select your project</option>
              {projectsList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Task (optional)</label>
            <select
              className="form-control"
              value={form.task_id}
              onChange={(e) => setForm({ ...form, task_id: e.target.value })}
            >
              <option value="">No specific task</option>
              {availableTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label form-required">Description</label>
          <textarea
            className="form-control"
            rows={3}
            value={form.work_description}
            onChange={(e) => setForm({ ...form, work_description: e.target.value })}
          />
        </div>
        {formError && <div className="alert alert-danger">{formError}</div>}
      </Modal>
    </div>
  );
}