import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { hr } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';

interface Row {
  id: string;
  employee_id: string;
  employee_name?: string;
  transfer_type: string;
  transfer_date: string;
  from_department: string | null;
  to_department: string | null;
  reason: string | null;
  status: string;
}

export function TransfersTab({ transferType }: { transferType: 'in' | 'out' }): ReactElement {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    employee_id: '',
    transfer_type: transferType,
    transfer_date: new Date().toISOString().slice(0, 10),
    from_department: '',
    to_department: '',
    reason: '',
  });
  const [employees, setEmployees] = useState<
    { id: string; full_name: string; employee_code: string }[]
  >([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [statusTarget, setStatusTarget] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hr.allTransfers({ transferType });
      setRows(res.data as unknown[] as Row[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load transfers');
    } finally {
      setLoading(false);
    }
  }, [transferType]);

  const loadLookups = useCallback(async () => {
    try {
      const [e, d] = await Promise.all([
        hr.employees({ perPage: 100 }),
        hr.departments({ perPage: 100 }),
      ]);
      setEmployees(
        (e.data as { items: { id: string; full_name: string; employee_code: string }[] }).items
      );
      setDepartments((d.data as { items: { id: string; name: string }[] }).items);
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  const save = async () => {
    setSubmitting(true);
    setFormError('');
    try {
      await hr.createTransfer(form.employee_id, {
        transfer_type: form.transfer_type,
        transfer_date: form.transfer_date,
        from_department: form.from_department || null,
        to_department: form.to_department || null,
        reason: form.reason || null,
      });
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create transfer');
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (status: string) => {
    if (!statusTarget) return;
    setSubmitting(true);
    try {
      await hr.updateTransferStatus(statusTarget.id, { status });
      setStatusTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update transfer status');
      setStatusTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    {
      key: 'employee_name',
      header: 'Employee',
      render: (r) =>
        r.employee_name ??
        employees.find((e) => e.id === r.employee_id)?.full_name ??
        r.employee_id.slice(0, 8),
    },
    {
      key: 'transfer_date',
      header: 'Date',
      sortable: true,
      render: (r) => new Date(r.transfer_date).toLocaleDateString(),
    },
    { key: 'from_department', header: 'From Department', render: (r) => r.from_department ?? '—' },
    { key: 'to_department', header: 'To Department', render: (r) => r.to_department ?? '—' },
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
            <button
              className="btn-clay btn-clay-sm btn-clay-success"
              onClick={() => setStatusTarget(r)}
            >
              Approve
            </button>
            <button
              className="btn-clay btn-clay-sm btn-clay-danger"
              onClick={() => setStatusTarget(r)}
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
      <div className="page-header" style={{ marginBottom: '0.6rem' }}>
        <div>
          <div className="page-title">
            {transferType === 'out' ? 'Transfer Out' : 'Transfer In'}
          </div>
          <div className="page-subtitle">
            {transferType === 'out'
              ? 'Employees moved out of a department.'
              : 'Employees moved into a department.'}
          </div>
        </div>
        <div className="page-header-actions">
          <button
            className="btn-clay btn-clay-primary"
            onClick={() => {
              setForm((f) => ({
                ...f,
                transfer_type: transferType,
                transfer_date: new Date().toISOString().slice(0, 10),
              }));
              setFormError('');
              setModalOpen(true);
            }}
          >
            + New Transfer
          </button>
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        csvFilename={`transfers-${transferType}.csv`}
        excelFilename={`transfers-${transferType}.xls`}
        printable
        emptyMessage={`No ${transferType === 'out' ? 'outgoing' : 'incoming'} transfers.`}
      />

      <Modal
        title="New Transfer"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel="Create"
        wide
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
            <label className="form-label">Transfer Type</label>
            <select
              className="form-control-clay"
              value={form.transfer_type}
              onChange={(e) => setForm({ ...form, transfer_type: e.target.value as 'in' | 'out' })}
            >
              <option value="out">Out</option>
              <option value="in">In</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">
              Transfer Date <span className="form-required">*</span>
            </label>
            <input
              type="date"
              className="form-control-clay"
              value={form.transfer_date}
              onChange={(e) => setForm({ ...form, transfer_date: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">From Department</label>
            <select
              className="form-control-clay"
              value={form.from_department}
              onChange={(e) => setForm({ ...form, from_department: e.target.value })}
            >
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">To Department</label>
            <select
              className="form-control-clay"
              value={form.to_department}
              onChange={(e) => setForm({ ...form, to_department: e.target.value })}
            >
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
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
        title="Update Transfer Status"
        open={statusTarget !== null}
        onClose={() => setStatusTarget(null)}
        onSubmit={() => updateStatus('approved')}
        submitting={submitting}
        submitLabel="Approve"
        footer={
          <>
            <button className="btn-clay btn-clay-secondary" onClick={() => setStatusTarget(null)}>
              Cancel
            </button>
            <button
              className="btn-clay btn-clay-danger"
              onClick={() => updateStatus('rejected')}
              disabled={submitting}
            >
              Reject
            </button>
            <button
              className="btn-clay btn-clay-primary"
              onClick={() => updateStatus('approved')}
              disabled={submitting}
            >
              Approve
            </button>
          </>
        }
      >
        <p>
          Update status of the transfer for{' '}
          <strong>
            {statusTarget?.employee_name ??
              employees.find((e) => e.id === statusTarget?.employee_id)?.full_name ??
              'employee'}
          </strong>
          ?
        </p>
      </Modal>
    </div>
  );
}
