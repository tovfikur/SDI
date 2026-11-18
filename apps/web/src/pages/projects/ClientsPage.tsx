import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { projects } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon, Icons } from '../../components/Icon';

interface Row {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
}

export function ClientsPage(): ReactElement {
  const { can } = usePermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await projects.clients({ page, perPage, search });
      const data = res.data as { items: Row[]; total: number };
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', email: '', phone: '', address: '' });
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm({
      name: row.name,
      email: row.email ?? '',
      phone: row.phone ?? '',
      address: row.address ?? '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const save = async () => {
    setSubmitting(true);
    setFormError('');
    try {
      if (editing) {
        await projects.updateClient(editing.id, form);
      } else {
        await projects.createClient(form);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save client');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await projects.deleteClient(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete client');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    { key: 'name', header: 'Client', sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'email', header: 'Email', render: (r) => r.email ?? '—' },
    { key: 'phone', header: 'Phone', render: (r) => r.phone ?? '—' },
    { key: 'address', header: 'Address', render: (r) => r.address ?? '—' },
    {
      key: 'is_active',
      header: 'Status',
      align: 'center',
      render: (r) => <StatusBadge value={r.is_active ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <div className="data-table-actions">
          {can('pm.client.manage') && (
            <button className="icon-btn" title="Edit" onClick={() => openEdit(r)}>
              <Icon icon={Icons.Edit} />
            </button>
          )}
          {can('pm.client.manage') && (
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
        title="Client List"
        subtitle="Manage clients and their contact details."
        actions={
          can('pm.client.manage') && (
            <button className="btn-clay btn-clay-primary" onClick={openCreate}>
              + New Client
            </button>
          )
        }
      />
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
        searchPlaceholder="Search clients..."
        csvFilename="clients.csv"
        excelFilename="clients.xls"
        printable
        emptyMessage="No clients yet."
      />
      <Modal
        title={editing ? 'Edit Client' : 'New Client'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel={editing ? 'Update' : 'Create'}
        wide
      >
        <div className="form-group">
          <label className="form-label">
            Client Name <span className="form-required">*</span>
          </label>
          <input
            className="form-control-clay"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-control-clay"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input
              className="form-control-clay"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Address</label>
          <textarea
            className="form-control-clay"
            rows={3}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>
      <ProtectedDeleteModal
        title="Delete Client"
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
