import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { toPng } from 'html-to-image';
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
  employee_id: string;
  full_name?: string;
  employee_code?: string;
  card_number: string;
  issued_date: string | null;
  expiry_date: string | null;
  is_active?: boolean;
  photo_url?: string | null;
}

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

export function IdCardsPage(): ReactElement {
  const { can } = usePermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    employee_id: '',
    card_number: '',
    issued_date: new Date().toISOString().slice(0, 10),
    expiry_date: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [preview, setPreview] = useState<Row | null>(null);
  const [downloading, setDownloading] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cards, emps] = await Promise.all([hr.idCards(), hr.employees({ perPage: 100 })]);
      setRows(cards.data as unknown[] as Row[]);
      setEmployees((emps.data as { items: Employee[] }).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ID cards');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!form.employee_id || !form.card_number) {
      setFormError('Employee and card number are required');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await hr.createIdCard(form);
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create ID card');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await hr.deleteIdCard(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete ID card');
    } finally {
      setSubmitting(false);
    }
  };

  const empOf = (r: Row) => employees.find((e) => e.id === r.employee_id);

  const downloadCard = async () => {
    if (!preview || !cardRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 3, cacheBust: true });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `ID-Card-${preview.employee_id}.png`;
      a.click();
    } catch {
      /* keep preview open on export failure */
    } finally {
      setDownloading(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    {
      key: 'full_name',
      header: 'Employee',
      sortable: true,
      render: (r) => <strong>{r.full_name ?? empOf(r)?.full_name ?? '—'}</strong>,
    },
    {
      key: 'employee_code',
      header: 'ID',
      render: (r) => (
        <span style={{ color: 'var(--text-dim)' }}>
          {r.employee_code ?? empOf(r)?.employee_code ?? '—'}
        </span>
      ),
    },
    { key: 'card_number', header: 'Card Number', sortable: true },
    {
      key: 'issued_date',
      header: 'Issued',
      render: (r) => (r.issued_date ? new Date(r.issued_date).toLocaleDateString() : '—'),
    },
    {
      key: 'expiry_date',
      header: 'Expiry',
      render: (r) => (r.expiry_date ? new Date(r.expiry_date).toLocaleDateString() : '—'),
    },
    {
      key: 'is_active',
      header: 'Status',
      align: 'center',
      render: (r) => <StatusBadge value={r.is_active === false ? 'inactive' : 'active'} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <div className="data-table-actions">
          <button className="icon-btn" title="Preview" onClick={() => setPreview(r)}>
            <Icon icon={Icons.IdCard} />
          </button>
          {can('hr.employee.delete') && (
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
        title="ID Cards"
        subtitle="Issue and manage employee identification cards."
        actions={
          <button
            className="btn-clay btn-clay-primary"
            onClick={() => {
              setFormError('');
              setModalOpen(true);
            }}
          >
            + New ID Card
          </button>
        }
      />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        csvFilename="id-cards.csv"
        excelFilename="id-cards.xls"
        printable
        emptyMessage="No ID cards issued yet."
      />

      <Modal
        title="New ID Card"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel="Create"
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
        <div className="form-group">
          <label className="form-label">
            Card Number <span className="form-required">*</span>
          </label>
          <input
            className="form-control-clay"
            value={form.card_number}
            onChange={(e) => setForm({ ...form, card_number: e.target.value })}
            autoFocus
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Issued Date</label>
            <input
              type="date"
              className="form-control-clay"
              value={form.issued_date}
              onChange={(e) => setForm({ ...form, issued_date: e.target.value })}
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

      <Modal
        title="ID Card Preview"
        open={preview !== null}
        onClose={() => setPreview(null)}
        footer={
          <>
            <button
              className="btn-clay btn-clay-secondary"
              onClick={() => setPreview(null)}
              disabled={downloading}
            >
              Cancel
            </button>
            <button
              className="btn-clay btn-clay-primary"
              onClick={() => void downloadCard()}
              disabled={downloading}
            >
              {downloading ? 'Preparing...' : 'Download'}
            </button>
          </>
        }
      >
        {preview && (
          <div className="id-card-preview" ref={cardRef}>
            <div className="id-card-preview-header">
              <div className="id-card-preview-org">SDI</div>
              <div className="id-card-preview-org-sub">EMPLOYEE ID CARD</div>
            </div>
            <div className="id-card-preview-avatar">
              {(preview.full_name ?? empOf(preview)?.full_name ?? '?')
                .split(' ')
                .map((p) => p[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </div>
            <div className="id-card-preview-row">
              <span className="id-card-preview-label">Name</span>
              <span className="id-card-preview-value">
                {preview.full_name ?? empOf(preview)?.full_name ?? '—'}
              </span>
            </div>
            <div className="id-card-preview-row">
              <span className="id-card-preview-label">Employee ID</span>
              <span className="id-card-preview-value">
                {preview.employee_code ?? empOf(preview)?.employee_code ?? '—'}
              </span>
            </div>
            <div className="id-card-preview-row">
              <span className="id-card-preview-label">Card No.</span>
              <span className="id-card-preview-value">{preview.card_number}</span>
            </div>
            <div className="id-card-preview-row">
              <span className="id-card-preview-label">Valid Till</span>
              <span className="id-card-preview-value">
                {preview.expiry_date ? new Date(preview.expiry_date).toLocaleDateString() : '—'}
              </span>
            </div>
            <div className="id-card-preview-footer">SDI · HR Department</div>
          </div>
        )}
      </Modal>

      <ProtectedDeleteModal
        title="Delete ID Card"
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        submitting={submitting}
        message={
          <p>
          Are you sure you want to delete card <strong>{deleteTarget?.card_number}</strong>?
        </p>
        }
      />
    </div>
  );
}
