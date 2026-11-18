import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { hr } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon, Icons } from '../../components/Icon';

interface Row {
  id: string;
  name: string;
  is_active: boolean;
}

function useMaster(
  loader: (
    params: Record<string, string | number | undefined>
  ) => Promise<{ data: { items: unknown[]; total: number } }>
) {
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
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await loaderRef.current({ page, perPage, search });
      const payload = (res.data as unknown as { items?: Row[]; total?: number }) ?? {};
      setRows(payload.items ?? []);
      setTotal(payload.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load records');
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

  return {
    rows,
    loading,
    error,
    page,
    perPage,
    total,
    modalOpen,
    editing,
    name,
    submitting,
    formError,
    deleteTarget,
    search,
    setPage,
    setPerPage,
    setSearch,
    setName,
    setModalOpen,
    setFormError,
    setSubmitting,
    setDeleteTarget,
    setError,
    setEditing,
    load,
    openCreate,
    openEdit,
  };
}

export function PositionsTab(): ReactElement {
  const { can } = usePermissions();
  const m = useMaster((p) => hr.positions(p));

  const save = async () => {
    m.setSubmitting(true);
    m.setFormError('');
    try {
      if (m.editing) {
        await hr.updatePosition(m.editing.id, { name: m.name });
      } else {
        await hr.createPosition({ name: m.name });
      }
      m.setModalOpen(false);
      await m.load();
    } catch (e) {
      m.setFormError(e instanceof Error ? e.message : 'Failed to save position');
    } finally {
      m.setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!m.deleteTarget) return;
    m.setSubmitting(true);
    try {
      await hr.deletePosition(m.deleteTarget.id, deletePassword);
      m.setDeleteTarget(null);
      await m.load();
    } catch (e) {
      m.setError(e instanceof Error ? e.message : 'Failed to delete position');
    } finally {
      m.setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    { key: 'name', header: 'Position', sortable: true, render: (r) => <strong>{r.name}</strong> },
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
            <button className="icon-btn" title="Edit" onClick={() => m.openEdit(r)}>
              <Icon icon={Icons.Edit} />
            </button>
          )}
          {can('hr.masters.delete') && (
            <button
              className="icon-btn icon-btn-danger"
              title="Delete"
              onClick={() => m.setDeleteTarget(r)}
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
          <div className="page-title">Positions</div>
          <div className="page-subtitle">Job titles available within the organization.</div>
        </div>
        <div className="page-header-actions">
          {can('hr.masters.create') && (
            <button className="btn-clay btn-clay-primary" onClick={m.openCreate}>
              + New Position
            </button>
          )}
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={m.rows}
        rowKey={(r) => r.id}
        loading={m.loading}
        error={m.error}
        page={m.page}
        perPage={m.perPage}
        total={m.total}
        onPageChange={m.setPage}
        onPerPageChange={(p) => {
          m.setPerPage(p);
          m.setPage(1);
        }}
        search={m.search}
        onSearch={(s) => {
          m.setSearch(s);
          m.setPage(1);
        }}
        searchPlaceholder="Search positions..."
        csvFilename="positions.csv"
        excelFilename="positions.xls"
        printable
      />
      <Modal
        title={m.editing ? 'Edit Position' : 'New Position'}
        open={m.modalOpen}
        onClose={() => m.setModalOpen(false)}
        onSubmit={save}
        submitting={m.submitting}
        submitLabel={m.editing ? 'Update' : 'Create'}
      >
        <div className="form-group">
          <label className="form-label">
            Position Name <span className="form-required">*</span>
          </label>
          <input
            className="form-control-clay"
            value={m.name}
            onChange={(e) => m.setName(e.target.value)}
            autoFocus
          />
        </div>
        {m.formError && <div className="form-error-text">{m.formError}</div>}
      </Modal>
      <ProtectedDeleteModal
        title="Delete Position"
        open={m.deleteTarget !== null}
        onClose={() => m.setDeleteTarget(null)}
        onConfirm={doDelete}
        submitting={m.submitting}
        message={
          <p>Are you sure you want to delete <strong>{m.deleteTarget?.name}</strong>?</p>
        }
      />
    </div>
  );
}

export function EmployeeTypesTab(): ReactElement {
  const { can } = usePermissions();
  const m = useMaster((p) => hr.employeeTypes(p));

  const save = async () => {
    m.setSubmitting(true);
    m.setFormError('');
    try {
      if (m.editing) {
        await hr.updateEmployeeType(m.editing.id, { name: m.name });
      } else {
        await hr.createEmployeeType({ name: m.name });
      }
      m.setModalOpen(false);
      await m.load();
    } catch (e) {
      m.setFormError(e instanceof Error ? e.message : 'Failed to save employee type');
    } finally {
      m.setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!m.deleteTarget) return;
    m.setSubmitting(true);
    try {
      await hr.deleteEmployeeType(m.deleteTarget.id, deletePassword);
      m.setDeleteTarget(null);
      await m.load();
    } catch (e) {
      m.setError(e instanceof Error ? e.message : 'Failed to delete employee type');
    } finally {
      m.setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    {
      key: 'name',
      header: 'Employee Type',
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
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <div className="data-table-actions">
          {can('hr.masters.update') && (
            <button className="icon-btn" title="Edit" onClick={() => m.openEdit(r)}>
              <Icon icon={Icons.Edit} />
            </button>
          )}
          {can('hr.masters.delete') && (
            <button
              className="icon-btn icon-btn-danger"
              title="Delete"
              onClick={() => m.setDeleteTarget(r)}
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
          <div className="page-title">Employee Types</div>
          <div className="page-subtitle">Categories used by work schedules and attendance policy.</div>
        </div>
        <div className="page-header-actions">
          <button className="btn-clay btn-clay-primary" onClick={m.openCreate}>
            + New Employee Type
          </button>
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={m.rows}
        rowKey={(r) => r.id}
        loading={m.loading}
        error={m.error}
        page={m.page}
        perPage={m.perPage}
        total={m.total}
        onPageChange={m.setPage}
        onPerPageChange={(p) => {
          m.setPerPage(p);
          m.setPage(1);
        }}
        search={m.search}
        onSearch={(s) => {
          m.setSearch(s);
          m.setPage(1);
        }}
        searchPlaceholder="Search employee types..."
        csvFilename="employee-types.csv"
        excelFilename="employee-types.xls"
        printable
      />
      <Modal
        title={m.editing ? 'Edit Employee Type' : 'New Employee Type'}
        open={m.modalOpen}
        onClose={() => m.setModalOpen(false)}
        onSubmit={save}
        submitting={m.submitting}
        submitLabel={m.editing ? 'Update' : 'Create'}
      >
        <div className="form-group">
          <label className="form-label">
            Type Name <span className="form-required">*</span>
          </label>
          <input
            className="form-control-clay"
            value={m.name}
            onChange={(e) => m.setName(e.target.value)}
            autoFocus
          />
        </div>
        {m.formError && <div className="form-error-text">{m.formError}</div>}
      </Modal>
      <ProtectedDeleteModal
        title="Delete Employee Type"
        open={m.deleteTarget !== null}
        onClose={() => m.setDeleteTarget(null)}
        onConfirm={doDelete}
        submitting={m.submitting}
        message={
          <p>Are you sure you want to delete <strong>{m.deleteTarget?.name}</strong>?</p>
        }
      />
    </div>
  );
}
