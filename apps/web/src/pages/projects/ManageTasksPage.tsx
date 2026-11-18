import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { hr, projects } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon, Icons } from '../../components/Icon';
import { ChartCard } from '../../components/charts/ChartCard';
import { DonutChart, VerticalBarChart } from '../../components/charts/charts';
import { statusColor } from '../../components/charts/chartTheme';
import { formatStatusLabel } from '../../utils/statusLabels';

interface Row {
  id: string;
  project_id: string;
  project_name?: string;
  title: string;
  description: string;
  assignee_id: string | null;
  assignee_name?: string | null;
  assignee_ids?: string[];
  all_assignees?: string | null;
  priority: string;
  planned_start: string | null;
  planned_end: string | null;
  status: string;
  progress_percent: number | null;
  estimated_hours: number | null;
}

interface Project {
  id: string;
  name: string;
}

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

export function ManageTasksPage(): ReactElement {
  const { can } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get('status') ?? '';
  const priorityFilter = searchParams.get('priority') ?? '';
  const [taskStatus, setTaskStatus] = useState<Array<{ status: string; n: number }>>([]);
  const [priorities, setPriorities] = useState<Array<{ priority: string; n: number }>>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({
    project_id: '',
    title: '',
    description: '',
    assignee_id: '',
    assignee_ids: [] as string[],
    priority: 'medium',
    planned_start: '',
    planned_end: '',
    status: 'todo',
    progress_percent: '0',
    estimated_hours: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await projects.tasks({
        page,
        perPage,
        search,
        ...(statusFilter ? { 'filter[status]': statusFilter } : {}),
        ...(priorityFilter ? { 'filter[priority]': priorityFilter } : {}),
      });
      const data = res.data as { items: Row[]; total: number };
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, search, statusFilter, priorityFilter]);

  const loadLookups = useCallback(async () => {
    try {
      const [p, e] = await Promise.all([
        projects.list({ perPage: 100 }),
        hr.employees({ perPage: 100 }),
      ]);
      setProjectList((p.data as { items: Project[] }).items);
      setEmployees((e.data as { items: Employee[] }).items);
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, priorityFilter]);

  useEffect(() => {
    let cancelled = false;
    async function fetchAnalytics() {
      setAnalyticsLoading(true);
      try {
        const res = await projects.analytics();
        const d = res.data as {
          taskStatus: Array<{ status: string; n: number }>;
          priorities: Array<{ priority: string; n: number }>;
        };
        if (!cancelled) {
          setTaskStatus(d.taskStatus ?? []);
          setPriorities(d.priorities ?? []);
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

  const setFilter = (key: 'status' | 'priority', value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      project_id: projectList[0]?.id ?? '',
      title: '',
      description: '',
      assignee_id: '',
      assignee_ids: [],
      priority: 'medium',
      planned_start: '',
      planned_end: '',
      status: 'todo',
      progress_percent: '0',
      estimated_hours: '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    const existingIds = row.assignee_ids && row.assignee_ids.length > 0
      ? row.assignee_ids
      : row.assignee_id ? [row.assignee_id] : [];
    setForm({
      project_id: row.project_id,
      title: row.title,
      description: row.description ?? '',
      assignee_id: row.assignee_id ?? '',
      assignee_ids: existingIds,
      priority: row.priority,
      planned_start: (row.planned_start ?? '').slice(0, 10),
      planned_end: (row.planned_end ?? '').slice(0, 10),
      status: row.status,
      progress_percent: String(row.progress_percent ?? 0),
      estimated_hours: row.estimated_hours != null ? String(row.estimated_hours) : '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const save = async () => {
    setSubmitting(true);
    setFormError('');
    const body = {
      project_id: form.project_id,
      title: form.title,
      description: form.description || undefined,
      assignee_id: form.assignee_ids[0] || form.assignee_id || null,
      assignee_ids: form.assignee_ids,
      priority: form.priority,
      planned_start: form.planned_start || undefined,
      planned_end: form.planned_end || undefined,
      status: form.status,
      progress_percent: Number(form.progress_percent) || 0,
      estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : undefined,
    };
    try {
      if (editing) {
        await projects.updateTask(editing.id, body);
      } else {
        await projects.createTask(body);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save task');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await projects.removeTask(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete task');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    { key: 'title', header: 'Task', sortable: true, render: (r) => <strong>{r.title}</strong> },
    {
      key: 'project_name',
      header: 'Project',
      render: (r) => r.project_name ?? projectList.find((p) => p.id === r.project_id)?.name ?? '—',
    },
    {
      key: 'assignee_name',
      header: 'Assignees',
      render: (r) => (
        <span title={r.all_assignees || r.assignee_name || '—'}>
          {r.all_assignees || r.assignee_name || employees.find((e) => e.id === r.assignee_id)?.full_name || '—'}
        </span>
      ),
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
          <div className="progress-clay" style={{ width: 80 }}>
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
      key: 'planned_start',
      header: 'Start',
      render: (r) => (r.planned_start ? new Date(r.planned_start).toLocaleDateString() : '—'),
    },
    {
      key: 'planned_end',
      header: 'End',
      render: (r) => (r.planned_end ? new Date(r.planned_end).toLocaleDateString() : '—'),
    },
    {
      key: 'estimated_hours',
      header: 'Hours',
      align: 'center',
      render: (r) => r.estimated_hours ?? '—',
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <div className="data-table-actions">
          {can('pm.task.manage') && (
            <button className="icon-btn" title="Edit" onClick={() => openEdit(r)}>
              <Icon icon={Icons.Edit} />
            </button>
          )}
          {can('pm.task.manage') && (
            <button
              className="icon-btn icon-btn-danger"
              title="Delete"
              onClick={() => setDeleteTarget(r)}
            >
              <Icon icon={Icons.Trash} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Manage Tasks"
        subtitle="Create, assign and track project tasks."
        actions={
          can('pm.task.manage') && (
            <button className="btn-clay btn-clay-primary" onClick={openCreate}>
              + New Task
            </button>
          )
        }
      />

      {(statusFilter || priorityFilter) && (
        <div className="filter-chips" style={{ marginBottom: '1rem' }}>
          {statusFilter && (
            <button type="button" className="chart-legend-item" onClick={() => setFilter('status', '')}>
              Status: <strong>{formatStatusLabel(statusFilter)}</strong> &times;
            </button>
          )}
          {priorityFilter && (
            <button type="button" className="chart-legend-item" onClick={() => setFilter('priority', '')}>
              Priority: <strong>{formatStatusLabel(priorityFilter)}</strong> &times;
            </button>
          )}
        </div>
      )}

      <div className="analytics-grid analytics-grid-wide">
        <ChartCard
          title="Tasks by Status"
          subtitle="Click a segment or legend chip to filter the table"
          loading={analyticsLoading}
          empty={taskStatus.length === 0}
        >
          <DonutChart
            data={taskStatus.map((t) => ({ key: t.status, value: t.n, color: statusColor(t.status) }))}
            onSliceClick={(key) => setFilter('status', key)}
          />
          <div className="chart-legend">
            {taskStatus.map((t) => (
              <button
                key={t.status}
                type="button"
                className="chart-legend-item"
                style={
                  statusFilter === t.status
                    ? { borderColor: 'var(--primary)', color: 'var(--primary)', background: 'var(--brand-soft)' }
                    : undefined
                }
                onClick={() => setFilter('status', statusFilter === t.status ? '' : t.status)}
              >
                <span className="chart-legend-dot" style={{ background: statusColor(t.status) }} />
                <span className="chart-legend-label">{formatStatusLabel(t.status)}</span>
                <span className="chart-legend-value">{t.n}</span>
              </button>
            ))}
          </div>
        </ChartCard>

        <ChartCard
          title="Tasks by Priority"
          subtitle="Click a bar to filter by priority"
          loading={analyticsLoading}
          empty={priorities.length === 0}
        >
          <VerticalBarChart
            data={priorities.map((pr) => ({ name: formatStatusLabel(pr.priority), priority: pr.n }))}
            xKey="name"
            barKey="priority"
            color={priorityFilter ? statusColor(priorityFilter) : 'var(--primary)'}
            onBarClick={(entry) => {
              const raw = priorities.find((pr) => formatStatusLabel(pr.priority) === String(entry.name));
              if (raw) setFilter('priority', raw.priority);
            }}
          />
        </ChartCard>
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
        search={search}
        onSearch={(s) => {
          setSearch(s);
          setPage(1);
        }}
        searchPlaceholder="Search tasks..."
        csvFilename="tasks.csv"
        excelFilename="tasks.xls"
        printable
        emptyMessage="No tasks yet."
      />

      <Modal
        title={editing ? 'Edit Task' : 'New Task'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel={editing ? 'Update' : 'Create'}
        wide
      >
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label className="form-label">
              Task Title <span className="form-required">*</span>
            </label>
            <input
              className="form-control-clay"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              Project <span className="form-required">*</span>
            </label>
            <select
              className="form-control-clay"
              value={form.project_id}
              onChange={(e) => setForm({ ...form, project_id: e.target.value })}
            >
              <option value="">—</option>
              {projectList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-group" style={{ marginBottom: '0.8rem' }}>
          <label className="form-label" style={{ fontWeight: 600 }}>
            Task Assignees ({form.assignee_ids.length} selected)
          </label>
          <div
            style={{
              maxHeight: 140,
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '0.35rem',
              padding: '0.6rem',
              background: 'var(--bg-card-subtle, rgba(0,0,0,0.02))',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
            }}
          >
            {employees.map((e) => {
              const isChecked = form.assignee_ids.includes(e.id);
              return (
                <label
                  key={e.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(ev) => {
                      const next = ev.target.checked
                        ? [...form.assignee_ids, e.id]
                        : form.assignee_ids.filter((id) => id !== e.id);
                      setForm({ ...form, assignee_ids: next, assignee_id: next[0] || '' });
                    }}
                  />
                  <span>
                    {e.full_name} ({e.employee_code})
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Priority</label>
            <select
              className="form-control-clay"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select
              className="form-control-clay"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="review">Review</option>
              <option value="done">Done</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>
        </div>
        <div className="form-row form-row-3">
          <div className="form-group">
            <label className="form-label">Planned Start</label>
            <input
              type="date"
              className="form-control-clay"
              value={form.planned_start}
              onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Planned End</label>
            <input
              type="date"
              className="form-control-clay"
              value={form.planned_end}
              onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Estimated Hours</label>
            <input
              type="number"
              min={0}
              className="form-control-clay"
              value={form.estimated_hours}
              onChange={(e) => setForm({ ...form, estimated_hours: e.target.value })}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Progress (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            className="form-control-clay"
            value={form.progress_percent}
            onChange={(e) => setForm({ ...form, progress_percent: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea
            className="form-control-clay"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>

      <ProtectedDeleteModal
        title="Delete Task"
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        submitting={submitting}
        message={
          <p>
          Are you sure you want to delete <strong>{deleteTarget?.title}</strong>?
        </p>
        }
      />
    </div>
  );
}
