import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { hr } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { useCurrentUser } from '../../auth-context';
import { Icon, Icons } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';

interface Row {
  id: string;
  employee_id: string | null;
  full_name?: string;
  employee_code?: string;
  notice_date: string | null;
  effective_date: string | null;
  reason: string | null;
  status: string;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

interface Paginated {
  items: Row[];
  total: number;
  page: number;
  per_page: number;
}

const RESIGNATION_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function ResignationsPage(): ReactElement {
  const user = useCurrentUser();
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    employee_id: '',
    notice_date: new Date().toISOString().slice(0, 10),
    effective_date: new Date().toISOString().slice(0, 10),
    reason: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [statusTarget, setStatusTarget] = useState<Row | null>(null);
  const [newStatus, setNewStatus] = useState('approved');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canManage = Boolean(
    user && (user.isSuperAdmin || user.permissions?.includes('hr.employee.update'))
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [res, emps] = await Promise.all([
        hr.resignations({
          ...(statusFilter ? { status: statusFilter } : {}),
          search: debouncedSearch,
          page,
          perPage,
        }),
        hr.employees({ perPage: 100 }),
      ]);
      const resp = res.data as unknown as Paginated;
      const items = (Array.isArray(resp.items) ? resp.items : []).filter(
        (x) => x !== null && typeof x === 'object'
      );
      setRows(items);
      setTotal(Array.isArray(resp.items) ? (resp.total ?? items.length) : items.length);
      setEmployees((emps.data as { items: Employee[] }).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load resignations');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, debouncedSearch, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const save = async () => {
    if (!form.employee_id || !form.notice_date || !form.effective_date) {
      setFormError('Employee, notice date and effective date are required');
      return;
    }
    if (form.effective_date < form.notice_date) {
      setFormError('Effective date cannot be earlier than notice date');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await hr.createResignation({
        employee_id: form.employee_id,
        notice_date: form.notice_date,
        effective_date: form.effective_date,
        reason: form.reason,
      });
      setModalOpen(false);
      toast('Resignation created', 'success');
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create resignation');
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async () => {
    if (!statusTarget) return;
    setSubmitting(true);
    try {
      await hr.updateResignationStatus(statusTarget.id, { status: newStatus });
      setStatusTarget(null);
      toast('Resignation status updated', 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to update resignation status', 'error');
      setStatusTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  const empOf = (r: Row | null | undefined) =>
    r ? employees.find((e) => e.id === r.employee_id) : undefined;
  const fmtDate = (d: string | null | undefined) =>
    d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString() : '—';

  const columns: DataColumn<Row>[] = [
    {
      key: 'full_name',
      header: 'Employee',
      sortable: true,
      render: (r) => <strong>{r.full_name ?? empOf(r)?.full_name ?? 'Unknown employee'}</strong>,
    },
    {
      key: 'employee_code',
      header: 'ID',
      render: (r) => (
        <span style={{ color: 'var(--text-dim)' }}>
          {r.employee_code ?? empOf(r)?.employee_code ?? '—'}
        </span>
      ),
    },
    {
      key: 'notice_date',
      header: 'Notice Date',
      sortable: true,
      render: (r) => fmtDate(r.notice_date),
    },
    {
      key: 'effective_date',
      header: 'Effective Date',
      sortable: true,
      render: (r) => fmtDate(r.effective_date),
    },
    { key: 'reason', header: 'Reason', render: (r) => r.reason ?? '—' },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      render: (r) => <StatusBadge value={r.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) =>
        r.status === 'pending' && canManage ? (
          <div className="data-table-actions">
            <button
              className="btn-clay btn-clay-sm btn-clay-success"
              onClick={() => setStatusTarget(r)}
            >
              Approve
            </button>
            <button
              className="btn-clay btn-clay-sm btn-clay-danger"
              onClick={() => {
                setNewStatus('rejected');
                setStatusTarget(r);
              }}
            >
              Reject
            </button>
          </div>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Resignations"
        subtitle="Process employee resignation requests."
        actions={
          canManage ? (
            <button
              className="btn-clay btn-clay-primary"
              onClick={() => {
                setFormError('');
                setModalOpen(true);
              }}
            >
              + New Resignation
            </button>
          ) : null
        }
      />

      <div className="activity-toolbar">
        <div className="activity-toolbar-left">
          <div className="filter-bar">
            <button
              className={`btn-clay btn-clay-sm ${statusFilter === '' ? 'btn-clay-primary' : 'btn-clay-secondary'}`}
              onClick={() => setStatusFilter('')}
            >
              All
            </button>
            {RESIGNATION_STATUSES.map((s) => (
              <button
                key={s.value}
                className={`btn-clay btn-clay-sm ${statusFilter === s.value ? 'btn-clay-primary' : 'btn-clay-secondary'}`}
                onClick={() => setStatusFilter(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
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
              {[10, 25, 50, 100].map((n) => (
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
            placeholder="Search employee, reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <div className="panel-clay report-state-panel">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon icon={Icons.Warning} />
            </div>
            <div className="empty-state-title">Could not load resignations</div>
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
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          page={page}
          perPage={perPage}
          total={total}
          onPageChange={setPage}
          onPerPageChange={(p) => {
            setPerPage(p);
            setPage(1);
          }}
          csvFilename="resignations.csv"
          excelFilename="resignations.xls"
          printable
          emptyMessage={
            statusFilter || debouncedSearch
              ? 'No resignations match the selected filters.'
              : 'No resignations found.'
          }
        />
      )}

      <Modal
        title="New Resignation"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel="Create"
        busyLabel="Creating..."
      >
        <div className="form-group">
          <label className="form-label">
            Employee <span className="form-required">*</span>
          </label>
          <select
            className="form-control-clay"
            value={form.employee_id}
            onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
          >
            <option value="">— Select employee —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} ({e.employee_code})
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Notice Date <span className="form-required">*</span>
            </label>
            <input
              type="date"
              className="form-control-clay"
              value={form.notice_date}
              onChange={(e) => setForm({ ...form, notice_date: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              Effective Date <span className="form-required">*</span>
            </label>
            <input
              type="date"
              className="form-control-clay"
              value={form.effective_date}
              onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Reason</label>
          <textarea
            className="form-control-clay"
            rows={3}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>

      <Modal
        title="Update Resignation Status"
        open={statusTarget !== null}
        onClose={() => setStatusTarget(null)}
        onSubmit={updateStatus}
        submitting={submitting}
        submitLabel="Save"
        busyLabel="Saving..."
        footer={
          <>
            <button
              className="btn-clay btn-clay-secondary"
              onClick={() => setStatusTarget(null)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              className="btn-clay btn-clay-primary"
              onClick={() => updateStatus()}
              disabled={submitting}
            >
              Save
            </button>
          </>
        }
      >
        <p>
          Update status of the resignation for{' '}
          <strong>{statusTarget?.full_name ?? empOf(statusTarget)?.full_name ?? 'employee'}</strong>
          ?
        </p>
        <div className="form-group" style={{ marginTop: '0.5rem' }}>
          <label className="form-label">New Status</label>
          <select
            className="form-control-clay"
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
          >
            {RESIGNATION_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </Modal>
    </div>
  );
}
