import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { hr } from '../../api';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';

interface Row {
  id: string;
  title: string;
  body: string;
  category: string | null;
  is_active: boolean;
  created_at: string;
}

export function PoliciesPage(): ReactElement {
  const { can } = usePermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ title: '', body: '', category: 'General' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hr.policies(category ? { category } : undefined);
      setRows(res.data as unknown[] as Row[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load policies');
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ title: '', body: '', category: 'General' });
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm({ title: row.title, body: row.body, category: row.category ?? 'General' });
    setFormError('');
    setModalOpen(true);
  };

  const save = async () => {
    setSubmitting(true);
    setFormError('');
    try {
      if (editing) {
        await hr.updatePolicy(editing.id, form);
      } else {
        await hr.createPolicy(form);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save policy');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await hr.deletePolicy(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete policy');
    } finally {
      setSubmitting(false);
    }
  };

  const CATEGORIES = [
    'General',
    'HR',
    'Attendance',
    'Leave',
    'Compensation',
    'Code of Conduct',
    'Safety',
  ];

  return (
    <div>
      <PageHeader
        title="HR Policies"
        subtitle="Maintain company policies and guidelines."
        actions={
          can('hr.masters.create') && (
            <button className="btn-clay btn-clay-primary" onClick={openCreate}>
              + New Policy
            </button>
          )
        }
      />
      <div className="filter-bar" style={{ marginBottom: '0.8rem' }}>
        <button
          className={`btn-clay btn-clay-sm ${category === '' ? 'btn-clay-primary' : 'btn-clay-secondary'}`}
          onClick={() => setCategory('')}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={`btn-clay btn-clay-sm ${category === c ? 'btn-clay-primary' : 'btn-clay-secondary'}`}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      {loading && <div className="data-table-state">Loading policies...</div>}
      {error && <div className="data-table-state data-table-error">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="data-table-state">No policies found.</div>
      )}
      {!loading &&
        !error &&
        rows.map((p) => (
          <div key={p.id} className="notice-card">
            <div className="notice-card-title">
              {p.title} <StatusBadge value={p.is_active ? 'active' : 'inactive'} />
            </div>
            <div className="notice-card-meta">
              {new Date(p.created_at).toLocaleDateString()} · {p.category ?? 'General'}
            </div>
            <div className="notice-card-body">
              {openId === p.id ? p.body : p.body.length > 220 ? `${p.body.slice(0, 220)}…` : p.body}
            </div>
            <div className="data-table-actions" style={{ marginTop: '0.5rem' }}>
              {p.body.length > 220 && (
                <button
                  className="btn-clay btn-clay-sm btn-clay-secondary"
                  onClick={() => setOpenId(openId === p.id ? null : p.id)}
                >
                  {openId === p.id ? 'Collapse' : 'Read More'}
                </button>
              )}
              <button
                className="btn-clay btn-clay-sm btn-clay-secondary"
                onClick={() => openEdit(p)}
              >
                Edit
              </button>
              <button
                className="btn-clay btn-clay-sm btn-clay-danger"
                onClick={() => setDeleteTarget(p)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}

      <Modal
        title={editing ? 'Edit Policy' : 'New Policy'}
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
            <label className="form-label">Category</label>
            <select
              className="form-control-clay"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">
            Policy Body <span className="form-required">*</span>
          </label>
          <textarea
            className="form-control-clay"
            rows={8}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>

      <ProtectedDeleteModal
        title="Delete Policy"
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
