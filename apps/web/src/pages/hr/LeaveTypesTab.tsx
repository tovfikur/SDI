import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { leave } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { StatusBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toast';
import { Icon, Icons } from '../../components/Icon';

interface Row {
  id: string;
  name: string;
  code: string;
  is_paid?: boolean;
  annual_entitlement?: number;
  carry_forward?: boolean;
  is_active?: boolean;
}

export function LeaveTypesTab(): ReactElement {
  const { can } = usePermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({
    name: '',
    code: '',
    paid: true,
    max_days: '10',
    carry_forward: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await leave.types();
      setRows((res.data as { items: Row[] }).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leave types');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', code: '', paid: true, max_days: '10', carry_forward: false });
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm({
      name: row.name,
      code: row.code,
      paid: row.is_paid ?? true,
      max_days: String(row.annual_entitlement ?? 10),
      carry_forward: row.carry_forward ?? false,
    });
    setFormError('');
    setModalOpen(true);
  };

  const save = async () => {
    const name = form.name.trim();
    const code = form.code.trim();
    const maxDays = Number(form.max_days);
    if (!name) {
      setFormError('Name is required.');
      return;
    }
    if (!code) {
      setFormError('Code is required.');
      return;
    }
    if (!Number.isFinite(maxDays) || maxDays < 0) {
      setFormError('Max Days must be a non-negative number.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    const body = {
      name,
      code,
      is_paid: form.paid,
      annual_entitlement: maxDays,
      carry_forward: form.carry_forward,
    };
    try {
      if (editing) {
        await leave.updateType(editing.id, body);
        toast('Leave type updated.');
      } else {
        await leave.createType(body);
        toast('Leave type created.');
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save leave type');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await leave.deleteType(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete leave type');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    { key: 'name', header: 'Name', sortable: true, render: (r) => <strong>{r.name}</strong> },
    {
      key: 'code',
      header: 'Code',
      render: (r) => <span style={{ color: 'var(--text-dim)' }}>{r.code}</span>,
    },
    {
      key: 'paid',
      header: 'Paid',
      align: 'center',
      render: (r) => <StatusBadge value={r.is_paid ? 'paid' : 'unpaid'} />,
    },
    {
      key: 'max_days',
      header: 'Max Days',
      align: 'center',
      sortable: true,
      render: (r) => (r.annual_entitlement != null ? String(r.annual_entitlement) : '—'),
    },
    {
      key: 'carry_forward',
      header: 'Carry Forward',
      align: 'center',
      render: (r) => (r.carry_forward ? 'Yes' : 'No'),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <div className="data-table-actions">
          {can('hr.leave.manage') && (
            <button className="icon-btn" title="Edit" onClick={() => openEdit(r)}>
              <Icon icon={Icons.Edit} />
            </button>
          )}
          {can('hr.leave.manage') && (
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
          <div className="page-title">Leave Types</div>
          <div className="page-subtitle">Configure paid/unpaid leave categories.</div>
        </div>
        <div className="page-header-actions">
          {can('hr.leave.manage') && (
            <button className="btn-clay btn-clay-primary" onClick={openCreate}>
              + New Leave Type
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
        csvFilename="leave-types.csv"
        excelFilename="leave-types.xls"
        printable
      />
      <Modal
        title={editing ? 'Edit Leave Type' : 'New Leave Type'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel={editing ? 'Update' : 'Create'}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Name <span className="form-required">*</span>
            </label>
            <input
              className="form-control-clay"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Annual Leave"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              Code <span className="form-required">*</span>
            </label>
            <input
              className="form-control-clay"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="e.g. AL"
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Max Days / Year</label>
            <input
              type="number"
              min={0}
              className="form-control-clay"
              value={form.max_days}
              onChange={(e) => setForm({ ...form, max_days: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Paid Leave</label>
            <select
              className="form-control-clay"
              value={form.paid ? '1' : '0'}
              onChange={(e) => setForm({ ...form, paid: e.target.value === '1' })}
            >
              <option value="1">Paid</option>
              <option value="0">Unpaid</option>
            </select>
          </div>
          <div className="form-group">
            <label
              className="form-label form-inline-flex"
              style={{ gap: '0.5rem', marginTop: '1.2rem' }}
            >
              <input
                type="checkbox"
                checked={form.carry_forward}
                onChange={(e) => setForm({ ...form, carry_forward: e.target.checked })}
              />
              Carry forward
            </label>
          </div>
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>
      <ProtectedDeleteModal
        title="Delete Leave Type"
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        submitting={submitting}
        message={
          <p>
          Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
        </p>
        }
      />
    </div>
  );
}
