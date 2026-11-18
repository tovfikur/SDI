import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { hr } from '../../api';
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
  is_active: boolean;
  created_at: string;
}

export function DepartmentsPage(): ReactElement {
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
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hr.departments({ page, perPage, search });
      const data = res.data as { items: Row[]; total: number };
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load departments');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setName(row.name);
    setFormError('');
    setModalOpen(true);
  };

  const save = async () => {
    setSubmitting(true);
    setFormError('');
    try {
      if (editing) {
        await hr.updateDepartment(editing.id, { name });
      } else {
        await hr.createDepartment({ name });
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save department');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await hr.deleteDepartment(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete department');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    {
      key: 'name',
      header: 'Department Name',
      sortable: true,
      render: (r) => <strong>{r.name}</strong>,
    },
    {
      key: 'is_active',
      header: 'Status',
      align: 'center',
      render: (r) => <StatusBadge value={r.is_active ? 'active' : 'inactive'} />,
    },
    {
      key: 'created_at',
      header: 'Created At',
      sortable: true,
      render: (r) => new Date(r.created_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <div className="data-table-actions">
          {can('hr.masters.update') && (
            <button className="icon-btn" title="Edit" onClick={() => openEdit(r)}>
              <Icon icon={Icons.Edit} />
            </button>
          )}
          {can('hr.masters.delete') && (
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
        title="Departments"
        subtitle="Organize your company into functional departments."
        actions={
          can('hr.masters.create') && (
            <button className="btn-clay btn-clay-primary" onClick={openCreate}>
              + New Department
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
        searchPlaceholder="Search departments..."
        csvFilename="departments.csv"
        excelFilename="departments.xls"
        printable
      />

      <Modal
        title={editing ? 'Edit Department' : 'New Department'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel={editing ? 'Update' : 'Create'}
      >
        <div className="form-group">
          <label className="form-label">
            Department Name <span className="form-required">*</span>
          </label>
          <input
            className="form-control-clay"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Engineering"
            autoFocus
          />
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>

      <ProtectedDeleteModal
        title="Delete Department"
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        submitting={submitting}
        message={
          <p>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot
            be undone.
          </p>
        }
      />
    </div>
  );
}
