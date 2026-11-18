import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { hr, training } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { StatusBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toast';
import { toLocalDateTimeInput } from '../../utils/date';
import { Icon, Icons } from '../../components/Icon';

interface Row {
  id: string;
  title: string;
  trainer: string | null;
  status: string;
  schedule: string | null;
  description?: string | null;
  duration_hours?: number | null;
  max_participants?: number | null;
}

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

export function TrainingProgramsTab(): ReactElement {
  const { can } = usePermissions();
  const [rows, setRows] = useState<Row[]>([]);
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
    title: '',
    trainer: '',
    status: 'planned',
    schedule: '',
    description: '',
    duration_hours: '',
    max_participants: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [assignTarget, setAssignTarget] = useState<Row | null>(null);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [assignResult, setAssignResult] = useState('');
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await training.list({ page, perPage, search });
      const data = res.data as { items: Row[]; total: number };
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load training programs');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, search]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const openCreate = () => {
    setEditing(null);
    setForm({
      title: '',
      trainer: '',
      status: 'planned',
      schedule: '',
      description: '',
      duration_hours: '',
      max_participants: '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm({
      title: row.title,
      trainer: row.trainer ?? '',
      status: row.status,
      schedule: toLocalDateTimeInput(row.schedule ?? ''),
      description: row.description ?? '',
      duration_hours: row.duration_hours != null ? String(row.duration_hours) : '',
      max_participants: row.max_participants != null ? String(row.max_participants) : '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const save = async () => {
    const title = form.title.trim();
    const duration = Number(form.duration_hours);
    const maxParticipants = Number(form.max_participants);
    if (!title) {
      setFormError('Title is required.');
      return;
    }
    if (form.duration_hours !== '' && (!Number.isFinite(duration) || duration <= 0)) {
      setFormError('Duration must be a positive number.');
      return;
    }
    if (
      form.max_participants !== '' &&
      (!Number.isInteger(maxParticipants) || maxParticipants < 1)
    ) {
      setFormError('Max Participants must be a positive integer.');
      return;
    }
    if (form.schedule && Number.isNaN(new Date(form.schedule).getTime())) {
      setFormError('Schedule must be a valid date and time.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    const body = {
      title,
      trainer: form.trainer.trim() || undefined,
      status: form.status,
      schedule: form.schedule ? new Date(form.schedule).toISOString() : undefined,
      description: form.description || undefined,
      duration_hours: form.duration_hours !== '' ? Number(form.duration_hours) : undefined,
      max_participants: form.max_participants !== '' ? Number(form.max_participants) : undefined,
    };
    try {
      if (editing) {
        await training.update(editing.id, body);
        toast('Training program updated.');
      } else {
        await training.create(body);
        toast('Training program created.');
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save training program');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await training.remove(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete training program');
    } finally {
      setSubmitting(false);
    }
  };

  const assign = async () => {
    if (!assignTarget) return;
    setSubmitting(true);
    setAssignResult('');
    try {
      const res = await training.assign(assignTarget.id, { employeeIds: selectedEmployees });
      setAssignResult(`Assigned ${(res as { assigned?: number }).assigned ?? 0} employee(s).`);
      setAssignTarget(null);
      setSelectedEmployees([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign employees');
      setAssignTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    { key: 'title', header: 'Title', sortable: true, render: (r) => <strong>{r.title}</strong> },
    { key: 'trainer', header: 'Trainer', render: (r) => r.trainer ?? '—' },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      render: (r) => <StatusBadge value={r.status} />,
    },
    {
      key: 'schedule',
      header: 'Schedule',
      sortable: true,
      render: (r) => (r.schedule ? new Date(r.schedule).toLocaleString() : '—'),
    },
    {
      key: 'duration_hours',
      header: 'Hours',
      align: 'center',
      render: (r) => r.duration_hours ?? '—',
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <div className="data-table-actions">
          <button
            className="icon-btn"
            title="Assign employees"
            onClick={() => {
              setAssignTarget(r);
              setSelectedEmployees([]);
            }}
          >
            <Icon icon={Icons.Users} />
          </button>
          {can('hr.training.manage') && (
            <button className="icon-btn" title="Edit" onClick={() => openEdit(r)}>
              <Icon icon={Icons.Edit} />
            </button>
          )}
          {can('hr.training.manage') && (
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
      <div className="page-header" style={{ marginBottom: '0.6rem' }}>
        <div>
          <div className="page-title">Training Programs</div>
          <div className="page-subtitle">Plan and track training programs.</div>
        </div>
        <div className="page-header-actions">
          {can('hr.training.manage') && (
            <button className="btn-clay btn-clay-primary" onClick={openCreate}>
              + New Program
            </button>
          )}
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
        search={search}
        onSearch={(s) => {
          setSearch(s);
          setPage(1);
        }}
        searchPlaceholder="Search programs..."
        csvFilename="training-programs.csv"
        excelFilename="training-programs.xls"
        printable
        emptyMessage="No training programs yet."
      />

      <Modal
        title={editing ? 'Edit Program' : 'New Training Program'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel={editing ? 'Update' : 'Create'}
        wide
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Title <span className="form-required">*</span>
            </label>
            <input
              className="form-control-clay"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">Trainer</label>
            <input
              className="form-control-clay"
              value={form.trainer}
              onChange={(e) => setForm({ ...form, trainer: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row form-row-3">
          <div className="form-group">
            <label className="form-label">Status</label>
            <select
              className="form-control-clay"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="planned">Planned</option>
              <option value="scheduled">Scheduled</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Schedule</label>
            <input
              type="datetime-local"
              className="form-control-clay"
              value={form.schedule}
              onChange={(e) => setForm({ ...form, schedule: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Duration (hours)</label>
            <input
              type="number"
              min={0}
              className="form-control-clay"
              value={form.duration_hours}
              onChange={(e) => setForm({ ...form, duration_hours: e.target.value })}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Max Participants</label>
          <input
            type="number"
            min={0}
            className="form-control-clay"
            value={form.max_participants}
            onChange={(e) => setForm({ ...form, max_participants: e.target.value })}
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

      <Modal
        title="Assign Employees"
        open={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
        onSubmit={assign}
        submitting={submitting}
        submitLabel="Assign"
        wide
      >
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
          Select employees for <strong>{assignTarget?.title}</strong>:
        </p>
        <div className="filter-bar">
          {employees.map((e) => (
            <label
              key={e.id}
              className="form-inline-flex"
              style={{ gap: '0.35rem', fontSize: '0.8rem' }}
            >
              <input
                type="checkbox"
                checked={selectedEmployees.includes(e.id)}
                onChange={(ev) =>
                  setSelectedEmployees((prev) =>
                    ev.target.checked ? [...prev, e.id] : prev.filter((id) => id !== e.id)
                  )
                }
              />
              {e.full_name}
            </label>
          ))}
        </div>
        {assignResult && <div className="form-help-text">{assignResult}</div>}
      </Modal>

      <ProtectedDeleteModal
        title="Delete Program"
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
