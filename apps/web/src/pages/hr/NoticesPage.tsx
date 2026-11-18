import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { hr } from '../../api';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toast';

interface Row {
  id: string;
  title: string;
  body: string;
  category: string | null;
  is_active: boolean;
  created_at: string;
}

export function NoticesPage(): ReactElement {
  const { can } = usePermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ title: '', body: '', category: 'General' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hr.notices();
      setRows(res.data as unknown[] as Row[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notices');
    } finally {
      setLoading(false);
    }
  }, []);

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
        await hr.updateNotice(editing.id, form);
      } else {
        await hr.createNotice(form);
      }
      setModalOpen(false);
      await load();
      toast(editing ? 'Notice updated.' : 'Notice published.', 'success');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save notice');
      toast(e instanceof Error ? e.message : 'Failed to save notice', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await hr.deleteNotice(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      await load();
      toast('Notice deleted.', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete notice');
      toast(e instanceof Error ? e.message : 'Failed to delete notice', 'error');
      setDeleteTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (row: Row) => {
    try {
      await hr.updateNotice(row.id, { is_active: !row.is_active });
      await load();
      toast(row.is_active ? 'Notice deactivated.' : 'Notice activated.', 'info');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update notice');
      toast(e instanceof Error ? e.message : 'Failed to update notice', 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title="Notices"
        subtitle="Publish announcements visible on the dashboard."
        actions={
          can('hr.masters.create') && (
            <button className="btn-clay btn-clay-primary" onClick={openCreate}>
              + New Notice
            </button>
          )
        }
      />
      {loading && <div className="data-table-state">Loading notices...</div>}
      {error && <div className="data-table-state data-table-error">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="data-table-state">No notices published yet.</div>
      )}
      {!loading &&
        !error &&
        rows.map((n) => (
          <div key={n.id} className="notice-card">
            <div className="notice-card-title">
              {n.title} <StatusBadge value={n.is_active ? 'active' : 'inactive'} />
            </div>
            <div className="notice-card-meta">
              {new Date(n.created_at).toLocaleString()} · {n.category ?? 'General'}
            </div>
            <div className="notice-card-body">{n.body}</div>
            <div className="data-table-actions" style={{ marginTop: '0.5rem' }}>
              <button
                className="btn-clay btn-clay-sm btn-clay-secondary"
                onClick={() => toggleActive(n)}
              >
                {n.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <button
                className="btn-clay btn-clay-sm btn-clay-secondary"
                onClick={() => openEdit(n)}
              >
                Edit
              </button>
              <button
                className="btn-clay btn-clay-sm btn-clay-danger"
                onClick={() => setDeleteTarget(n)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}

      <Modal
        title={editing ? 'Edit Notice' : 'New Notice'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel={editing ? 'Update' : 'Publish'}
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
              <option value="General">General</option>
              <option value="Announcement">Announcement</option>
              <option value="Event">Event</option>
              <option value="Holiday">Holiday</option>
              <option value="Urgent">Urgent</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">
            Body <span className="form-required">*</span>
          </label>
          <textarea
            className="form-control-clay"
            rows={6}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>

      <ProtectedDeleteModal
        title="Delete Notice"
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
