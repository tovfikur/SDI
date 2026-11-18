import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions, useCurrentUser } from '../../auth-context';
import { getCurrentUserId, hr, leave } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';

interface Row {
  id: string;
  employee_id: string;
  employee_name?: string;
  work_date: string;
  minutes: number;
  reason: string | null;
  status: string;
}

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

export function ShortLeavesTab(): ReactElement {
  const { can } = usePermissions();
  const user = useCurrentUser();
  const canManageEmployees = can('hr.employee.view');
  const [rows, setRows] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    employeeId: '',
    workDate: new Date().toISOString().slice(0, 10),
    minutes: '30',
    reason: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Self-service users cannot list employees — the backend scopes to their
      // own profile, so only staff need the employee dropdown.
      if (!canManageEmployees) {
        const slRes = await leave.shortLeaves();
        setRows(slRes.data as unknown[] as Row[]);
        setEmployees([]);
        return;
      }
      const [slRes, empRes] = await Promise.all([
        leave.shortLeaves(),
        hr.employees({ perPage: 100 }),
      ]);
      setRows(slRes.data as unknown[] as Row[]);
      setEmployees((empRes.data as { items: Employee[] }).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load short leaves');
    } finally {
      setLoading(false);
    }
  }, [canManageEmployees]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!form.employeeId || !form.workDate || !form.minutes) {
      setFormError('Employee, work date and minutes are required');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await leave.createShortLeave({
        employeeId: form.employeeId,
        workDate: form.workDate,
        minutes: Number(form.minutes),
        reason: form.reason || undefined,
      });
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create short leave');
    } finally {
      setSubmitting(false);
    }
  };

  const process = async (row: Row, approve: boolean) => {
    setSubmitting(true);
    try {
      const userId = (await getCurrentUserId()) ?? '00000000-0000-0000-0000-000000000000';
      if (approve) {
        await leave.approveShort(row.id, { userId });
      } else {
        await leave.rejectShort(row.id, { userId });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to process short leave');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    {
      key: 'employee_name',
      header: 'Employee',
      sortable: true,
      render: (r) => (
        <strong>
          {r.employee_name ?? employees.find((e) => e.id === r.employee_id)?.full_name ?? '—'}
        </strong>
      ),
    },
    {
      key: 'work_date',
      header: 'Date',
      sortable: true,
      render: (r) => new Date(r.work_date).toLocaleDateString(),
    },
    {
      key: 'minutes',
      header: 'Minutes',
      align: 'center',
      sortable: true,
      render: (r) => <StatusBadge value={`${r.minutes} min`} />,
    },
    { key: 'reason', header: 'Reason', render: (r) => r.reason ?? '—' },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      render: (r) => <StatusBadge value={r.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) =>
        r.status === 'pending' ? (
          <div className="data-table-actions">
            {can('hr.leave.approve') && (
              <button
                className="btn-clay btn-clay-sm btn-clay-success"
                onClick={() => process(r, true)}
                disabled={submitting}
              >
                Approve
              </button>
            )}
            {can('hr.leave.approve') && (
              <button
                className="btn-clay btn-clay-sm btn-clay-danger"
                onClick={() => process(r, false)}
                disabled={submitting}
              >
                Reject
              </button>
            )}
          </div>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '0.6rem' }}>
        <div>
          <div className="page-title">Short Leaves</div>
          <div className="page-subtitle">Record short absences measured in minutes.</div>
        </div>
        <div className="page-header-actions">
          <button
            className="btn-clay btn-clay-primary"
            onClick={() => {
              setFormError('');
              setForm((f) => ({
                ...f,
                employeeId: canManageEmployees ? f.employeeId : (user?.employeeId ?? ''),
              }));
              setModalOpen(true);
            }}
          >
            + New Short Leave
          </button>
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        csvFilename="short-leaves.csv"
        excelFilename="short-leaves.xls"
        printable
        emptyMessage="No short leaves recorded."
      />
      <Modal
        title="New Short Leave"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel="Create"
      >
        {canManageEmployees ? (
          <div className="form-group">
            <label className="form-label">
              Employee <span className="form-required">*</span>
            </label>
            <select
              className="form-control-clay"
              value={form.employeeId}
              onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
            >
              <option value="">— Select employee —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name} ({e.employee_code})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">Employee</label>
            <input className="form-control-clay" value={user?.fullName ?? ''} disabled />
          </div>
        )}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Work Date <span className="form-required">*</span>
            </label>
            <input
              type="date"
              className="form-control-clay"
              value={form.workDate}
              onChange={(e) => setForm({ ...form, workDate: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              Minutes <span className="form-required">*</span>
            </label>
            <input
              type="number"
              min={1}
              className="form-control-clay"
              value={form.minutes}
              onChange={(e) => setForm({ ...form, minutes: e.target.value })}
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
    </div>
  );
}
