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
  department_id: string;
  department_name?: string;
  is_active: boolean;
}

export function SubDepartmentsPage(): ReactElement {
  const { can } = usePermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [listRes, deptRes] = await Promise.all([
        hr.subDepartments({ page, perPage, search }),
        hr.departments({ perPage: 100 }),
      ]);
      const data = listRes.data as { items: Row[]; total: number };
      setRows(data.items);
      setTotal(data.total);
      setDepartments((deptRes.data as { items: { id: string; name: string }[] }).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sub-departments');
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
    setDepartmentId(departments[0]?.id ?? '');
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setName(row.name);
    setDepartmentId(row.department_id);
    setFormError('');
    setModalOpen(true);
  };

  const save = async () => {
    setSubmitting(true);
    setFormError('');
    try {
      if (editing) {
        await hr.updateSubDepartment(editing.id, { name });
      } else {
        await hr.createSubDepartment({ name, department_id: departmentId });
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save sub-department');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await hr.deleteSubDepartment(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete sub-department');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    {
      key: 'name',
      header: 'Sub Department',
      sortable: true,
      render: (r) => <strong>{r.name}</strong>,
    },
    {
      key: 'department_name',
      header: 'Parent Department',
      sortable: true,
      render: (r) =>
        r.department_name ?? departments.find((d) => d.id === r.department_id)?.name ?? '—',
    },
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
        title="Sub Departments"
        subtitle="Define teams that belong to a parent department."
        actions={
          can('hr.masters.create') && (
            <button className="btn-clay btn-clay-primary" onClick={openCreate}>
              + New Sub Department
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
        searchPlaceholder="Search sub-departments..."
        csvFilename="sub-departments.csv"
        excelFilename="sub-departments.xls"
        printable
      />

      <Modal
        title={editing ? 'Edit Sub Department' : 'New Sub Department'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel={editing ? 'Update' : 'Create'}
      >
        <div className="form-group">
          <label className="form-label">
            Sub Department Name <span className="form-required">*</span>
          </label>
          <input
            className="form-control-clay"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Backend Engineering"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label className="form-label">
            Parent Department <span className="form-required">*</span>
          </label>
          <select
            className="form-control-clay"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>

      <ProtectedDeleteModal
        title="Delete Sub Department"
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
