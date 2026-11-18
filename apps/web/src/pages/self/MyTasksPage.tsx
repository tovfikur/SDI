import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { projects } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Icon, Icons } from '../../components/Icon';
import { statusColor } from '../../components/charts/chartTheme';
import { formatStatusLabel } from '../../utils/statusLabels';

interface Row {
  id: string;
  title: string;
  status: string;
  priority: string;
  project_id: string;
  project_name?: string;
  progress_percent: number | null;
  planned_start: string | null;
  planned_end: string | null;
}

const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done', 'blocked'] as const;

const BOARD_COLUMN_LIMIT = 6;
const LIST_PAGE_SIZE = 10;

const PRIORITY_COLOR: Record<string, string> = {
  low: '#64748b',
  medium: '#0ea5e9',
  high: '#f59e0b',
  urgent: '#ef4444',
};

export function MyTasksPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const statusFilter = searchParams.get('status') ?? '';
  const [view, setView] = useState<'board' | 'list'>('list');
  const [rows, setRows] = useState<Row[]>([]);
  const [projectsList, setProjectsList] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    project_id: '',
    title: '',
    description: '',
    priority: 'medium',
    planned_start: '',
    planned_end: '',
  });
  const [statusModal, setStatusModal] = useState<Row | null>(null);
  const [statusForm, setStatusForm] = useState({ status: '', progress_percent: 0 });
  const [expandedCols, setExpandedCols] = useState<Record<string, boolean>>({});
  const [listPage, setListPage] = useState(1);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await projects.tasks({ perPage: 100 });
      setRows((res.data as { items: Row[] }).items);
      const projRes = await projects.list({ perPage: 100 });
      setProjectsList((projRes.data as { items: Array<{ id: string; name: string }> }).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => (statusFilter ? rows.filter((r) => r.status === statusFilter) : rows),
    [rows, statusFilter]
  );

  const stats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    const overdue = rows.filter((r) => r.planned_end && r.status !== 'done' && r.planned_end < new Date().toISOString().slice(0, 10)).length;
    return {
      total: rows.length,
      done: counts.get('done') ?? 0,
      inProgress: counts.get('in_progress') ?? 0,
      overdue,
    };
  }, [rows]);

  const openCreate = () => {
    setForm({ project_id: '', title: '', description: '', priority: 'medium', planned_start: '', planned_end: '' });
    setFormError('');
    setModalOpen(true);
  };

  const submitCreate = async () => {
    if (!form.project_id || !form.title.trim()) {
      setFormError('Project and task title are required.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await projects.createTask({
        project_id: form.project_id,
        title: form.title.trim(),
        description: form.description || undefined,
        priority: form.priority,
        ...(form.planned_start ? { planned_start: form.planned_start } : {}),
        ...(form.planned_end ? { planned_end: form.planned_end } : {}),
      });
      setModalOpen(false);
      toast('Task created.', 'success');
      void load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const openStatus = (row: Row) => {
    setStatusForm({ status: row.status, progress_percent: Number(row.progress_percent ?? 0) });
    setStatusModal(row);
  };

  const submitStatus = async () => {
    if (!statusModal) return;
    setSubmitting(true);
    setFormError('');
    try {
      await projects.updateTask(statusModal.id, {
        status: statusForm.status,
        progress_percent: Number(statusForm.progress_percent) || 0,
      });
      setStatusModal(null);
      toast('Task updated.', 'success');
      void load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to update task');
    } finally {
      setSubmitting(false);
    }
  };

  const quickStatus = async (row: Row, next: string) => {
    try {
      const progress = next === 'done' ? 100 : Number(row.progress_percent ?? 0);
      await projects.updateTask(row.id, { status: next, progress_percent: progress });
      toast(`Moved to ${formatStatusLabel(next)}.`, 'success');
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to update task', 'error');
    }
  };

  const dueSoon = (end: string | null): boolean => {
    if (!end || !end.trim()) return false;
    const days = (new Date(end).getTime() - Date.now()) / 86_400_000;
    return days >= 0 && days <= 3;
  };

  const pageCount = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const safeListPage = Math.min(listPage, pageCount);
  const listRows = filtered.slice((safeListPage - 1) * LIST_PAGE_SIZE, safeListPage * LIST_PAGE_SIZE);

  const toggleExpand = (status: string): void => {
    setExpandedCols((prev) => ({ ...prev, [status]: !prev[status] }));
  };

  useEffect(() => {
    setListPage(1);
  }, [statusFilter, view]);

  return (
    <div>
      <PageHeader
        title="My Tasks"
        subtitle="Tasks assigned to you — create new tasks inside your projects"
        actions={
          <button className="btn btn-primary" onClick={openCreate}>
            + New Task
          </button>
        }
      />

      <div className="kpi-grid hrdash-kpi-grid">
        <div className="hrdash-kpi">
          <span className="hrdash-kpi-icon" style={{ background: '#6366f11f', color: '#6366f1' }}>
            <Icon icon={Icons.ListCheck} size="lg" />
          </span>
          <span className="hrdash-kpi-body">
            <span className="hrdash-kpi-value">{stats.total}</span>
            <span className="hrdash-kpi-label">All Tasks</span>
          </span>
        </div>
        <div className="hrdash-kpi">
          <span className="hrdash-kpi-icon" style={{ background: '#0ea5e91f', color: '#0ea5e9' }}>
            <Icon icon={Icons.Clock} size="lg" />
          </span>
          <span className="hrdash-kpi-body">
            <span className="hrdash-kpi-value">{stats.inProgress}</span>
            <span className="hrdash-kpi-label">In Progress</span>
          </span>
        </div>
        <div className="hrdash-kpi">
          <span className="hrdash-kpi-icon" style={{ background: '#10b9811f', color: '#10b981' }}>
            <Icon icon={Icons.Check} size="lg" />
          </span>
          <span className="hrdash-kpi-body">
            <span className="hrdash-kpi-value">{stats.done}</span>
            <span className="hrdash-kpi-label">Completed</span>
          </span>
        </div>
        <div className="hrdash-kpi">
          <span className="hrdash-kpi-icon" style={{ background: '#ef44441f', color: '#ef4444' }}>
            <Icon icon={Icons.Warning} size="lg" />
          </span>
          <span className="hrdash-kpi-body">
            <span className="hrdash-kpi-value">{stats.overdue}</span>
            <span className="hrdash-kpi-label">Overdue</span>
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <div className="btn-group" role="group">
          <button
            type="button"
            className={`btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setView('list')}
          >
            <Icon icon={Icons.ClipboardList} size="sm" /> List
          </button>
          <button
            type="button"
            className={`btn btn-sm ${view === 'board' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setView('board')}
          >
            <Icon icon={Icons.ListCheck} size="sm" /> Board
          </button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {loading ? (
        <div className="data-table-state">Loading tasks…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">No tasks here.</div>
      ) : view === 'board' ? (
        <div className="kanban-board">
          {TASK_STATUSES.map((status) => {
            const tasks = filtered.filter((r) => r.status === status);
            const expanded = expandedCols[status] === true;
            const visible = expanded ? tasks : tasks.slice(0, BOARD_COLUMN_LIMIT);
            const hidden = tasks.length - visible.length;
            return (
              <div key={status} className="kanban-column">
                <div className="kanban-column-head">
                  <span className="kanban-column-dot" style={{ background: statusColor(status) }} />
                  <span className="kanban-column-title">{formatStatusLabel(status)}</span>
                  <span className="kanban-column-count">{tasks.length}</span>
                </div>
                <div className="kanban-column-body">
                  {visible.map((t) => {
                    const prio = PRIORITY_COLOR[t.priority] ?? '#64748b';
                    return (
                      <div key={t.id} className="kanban-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                          <span
                            className="badge-soft"
                            style={{ color: prio, background: `${prio}1a`, fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.4 }}
                          >
                            {t.priority}
                          </span>
                          {status !== 'done' && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline kanban-advance"
                              title={`Move to ${formatStatusLabel(TASK_STATUSES[TASK_STATUSES.indexOf(status as (typeof TASK_STATUSES)[number]) + 1] ?? 'done')}`}
                              onClick={() => quickStatus(t, TASK_STATUSES[TASK_STATUSES.indexOf(status as (typeof TASK_STATUSES)[number]) + 1] ?? 'done')}
                            >
                              →
                            </button>
                          )}
                        </div>
                        <div className="kanban-card-title" onClick={() => openStatus(t)} title="Click to update">
                          {t.title}
                        </div>
                        <div className="kanban-card-meta">
                          <span title="Project">
                            <Icon icon={Icons.Briefcase} size="xs" /> {t.project_name ?? '—'}
                          </span>
                          {t.planned_end && (
                            <span
                              title="Due date"
                              style={{
                                color:
                                  t.status === 'done'
                                    ? 'var(--success)'
                                    : dueSoon(t.planned_end)
                                      ? 'var(--danger)'
                                      : 'inherit',
                                fontWeight: dueSoon(t.planned_end) && t.status !== 'done' ? 700 : 400,
                              }}
                            >
                              <Icon icon={Icons.CalendarMinus} size="xs" /> {t.planned_end}
                            </span>
                          )}
                        </div>
                        <div className="progress" style={{ height: 5 }}>
                          <div className="progress-bar" style={{ width: `${Math.min(100, Math.max(0, Number(t.progress_percent ?? 0)))}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {tasks.length === 0 && <div className="kanban-empty">No tasks</div>}
                  {hidden > 0 && (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => toggleExpand(status)} style={{ width: '100%' }}>
                      {expanded ? 'Show less' : `Load more (+${hidden})`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Priority</th>
                  <th>Due</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {listRows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.title}</td>
                    <td className="text-muted">{r.project_name ?? '—'}</td>
                    <td>
                      <StatusBadge value={r.status} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 110 }}>
                        <div className="progress" style={{ flex: 1, height: 6 }}>
                          <div
                            className="progress-bar"
                            style={{ width: `${Math.min(100, Math.max(0, Number(r.progress_percent ?? 0)))}%` }}
                          />
                        </div>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{r.progress_percent ?? 0}%</span>
                      </div>
                    </td>
                    <td>
                      <span className="badge-soft" style={{ color: PRIORITY_COLOR[r.priority] ?? '#64748b', background: `${PRIORITY_COLOR[r.priority] ?? '#64748b'}1a`, fontWeight: 700 }}>
                        {formatStatusLabel(r.priority)}
                      </span>
                    </td>
                    <td className="text-muted">{r.planned_end ?? '—'}</td>
                    <td>
                      <button className="btn btn-sm btn-outline" onClick={() => openStatus(r)}>
                        Update
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > LIST_PAGE_SIZE && (
            <div className="pagination-bar">
              <span className="page-info">
                Page {safeListPage} of {pageCount} • {filtered.length} tasks
              </span>
              <button type="button" className="btn btn-sm btn-outline" disabled={safeListPage <= 1} onClick={() => setListPage(safeListPage - 1)}>
                ‹ Prev
              </button>
              <button type="button" className="btn btn-sm btn-outline" disabled={safeListPage >= pageCount} onClick={() => setListPage(safeListPage + 1)}>
                Next ›
              </button>
            </div>
          )}
        </div>
      )}

      <Modal
        open={modalOpen}
        title="New Task"
        onClose={() => setModalOpen(false)}
        onSubmit={() => void submitCreate()}
        submitting={submitting}
        submitLabel="Create Task"
        busyLabel="Creating…"
      >
        <div className="form-group">
          <label>Project *</label>
          <select className="form-control" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
            <option value="">Select a project you are part of</option>
            {projectsList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Title *</label>
          <input className="form-control" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Description</label>
          <textarea className="form-control" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="row">
          <div className="col">
            <div className="form-group">
              <label>Priority</label>
              <select className="form-control" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div className="col">
            <div className="form-group">
              <label>Start</label>
              <input type="date" className="form-control" value={form.planned_start} onChange={(e) => setForm({ ...form, planned_start: e.target.value })} />
            </div>
          </div>
          <div className="col">
            <div className="form-group">
              <label>End</label>
              <input type="date" className="form-control" value={form.planned_end} onChange={(e) => setForm({ ...form, planned_end: e.target.value })} />
            </div>
          </div>
        </div>
        {formError && <div className="alert alert-danger">{formError}</div>}
      </Modal>

      <Modal
        open={statusModal !== null}
        title="Update Task"
        onClose={() => setStatusModal(null)}
        narrow
        onSubmit={() => void submitStatus()}
        submitting={submitting}
        submitLabel="Save"
        busyLabel="Saving…"
      >
        {statusModal && (
          <>
            <div className="form-group">
              <label className="form-label">Task name</label>
              <div className="form-control" style={{ fontWeight: 600, background: 'var(--surface-muted)' }}>
                {statusModal.title}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-control" value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })}>
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {formatStatusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Progress %</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="form-control"
                  value={statusForm.progress_percent}
                  onChange={(e) => setStatusForm({ ...statusForm, progress_percent: Number(e.target.value) })}
                />
                <span className="text-muted" style={{ fontSize: '0.9rem' }}>%</span>
              </div>
            </div>
            {formError && <div className="alert alert-danger">{formError}</div>}
          </>
        )}
      </Modal>
    </div>
  );
}