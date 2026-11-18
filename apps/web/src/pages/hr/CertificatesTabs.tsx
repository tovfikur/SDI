import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { hr, training } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { Icon, Icons } from '../../components/Icon';

interface Row {
  id: string;
  employee_id: string;
  full_name: string;
  title: string;
  provider: string | null;
  source: string;
  issue_date: string | null;
  expiry_date: string | null;
}

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

function CertificatesTable({ source }: { source: 'internal' | 'external' }): ReactElement {
  const [rows, setRows] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    employee_id: '',
    title: '',
    provider: '',
    issue_date: new Date().toISOString().slice(0, 10),
    expiry_date: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await training.certificates({ page, perPage, search });
      const data = (res.data as { items?: Row[]; total?: number }) ?? {};
      setRows((data.items ?? []).filter((c) => c.source === source));
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load certificates');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, search, source]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    async function loadEmployees() {
      try {
        const res = await hr.employees({ perPage: 100 });
        setEmployees((res.data as { items: Employee[] }).items);
      } catch {
        /* optional */
      }
    }
    void loadEmployees();
  }, []);

  const save = async () => {
    if (!form.employee_id || !form.title) {
      setFormError('Employee and title are required');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await training.createCertificate({
        employee_id: form.employee_id,
        title: form.title,
        provider: form.provider || undefined,
        source,
        issue_date: form.issue_date || undefined,
        expiry_date: form.expiry_date || undefined,
      });
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save certificate');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await training.removeCertificate(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete certificate');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    {
      key: 'full_name',
      header: 'Employee',
      sortable: true,
      render: (r) => <strong>{r.full_name}</strong>,
    },
    { key: 'title', header: 'Certificate', sortable: true },
    { key: 'provider', header: 'Provider', render: (r) => r.provider ?? '—' },
    {
      key: 'issue_date',
      header: 'Issue Date',
      sortable: true,
      render: (r) => (r.issue_date ? new Date(r.issue_date).toLocaleDateString() : '—'),
    },
    {
      key: 'expiry_date',
      header: 'Expiry Date',
      sortable: true,
      render: (r) => (r.expiry_date ? new Date(r.expiry_date).toLocaleDateString() : '—'),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <button
          className="icon-btn icon-btn-danger"
          title="Delete"
          onClick={() => setDeleteTarget(r)}
        >
          <Icon icon={Icons.Trash} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '0.6rem' }}>
        <div>
          <div className="page-title">
            {source === 'internal' ? 'Internal Certificates' : 'External Certificates'}
          </div>
          <div className="page-subtitle">
            {source === 'internal'
              ? 'Certificates awarded through company training.'
              : 'Certificates earned from external providers.'}
          </div>
        </div>
        <div className="page-header-actions">
          <button
            className="btn-clay btn-clay-primary"
            onClick={() => {
              setForm({
                employee_id: employees[0]?.id ?? '',
                title: '',
                provider: '',
                issue_date: new Date().toISOString().slice(0, 10),
                expiry_date: '',
              });
              setFormError('');
              setModalOpen(true);
            }}
          >
            + New Certificate
          </button>
        </div>
      </div>
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
        searchPlaceholder="Search certificates..."
        csvFilename={`certificates-${source}.csv`}
        excelFilename={`certificates-${source}.xls`}
        printable
        emptyMessage={`No ${source} certificates yet.`}
      />
      <Modal
        title="New Certificate"
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
            <label className="form-label">
              Certificate Title <span className="form-required">*</span>
            </label>
            <input
              className="form-control-clay"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Provider</label>
            <input
              className="form-control-clay"
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Issue Date</label>
            <input
              type="date"
              className="form-control-clay"
              value={form.issue_date}
              onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Expiry Date</label>
            <input
              type="date"
              className="form-control-clay"
              value={form.expiry_date}
              onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
            />
          </div>
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>
      <ProtectedDeleteModal
        title="Delete Certificate"
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        submitting={submitting}
        message={
          <p>
          Are you sure you want to delete <strong>{deleteTarget?.title}</strong> for{' '}
          {deleteTarget?.full_name}?
        </p>
        }
      />
    </div>
  );
}

export function InternalCertificatesTab(): ReactElement {
  return <CertificatesTable source="internal" />;
}

export function ExternalCertificatesTab(): ReactElement {
  return <CertificatesTable source="external" />;
}
