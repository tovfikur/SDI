import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { payroll } from '../../api';
import type { SalaryComponent } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { formatStatusLabel } from '../../utils/statusLabels';

const bdt = (v: string | number | null): string =>
  Number(v ?? 0).toLocaleString(undefined, { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 });

const EMPTY_FORM = {
  name: '',
  code: '',
  type: 'earning' as 'earning' | 'deduction',
  calculationType: 'fixed' as 'fixed' | 'percentage' | 'formula',
  percentageOfComponent: '',
  defaultAmount: '',
  taxable: false,
  sortOrder: '0',
};

export function SalaryComponentsPage(): ReactElement {
  const [rows, setRows] = useState<SalaryComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SalaryComponent | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await payroll.components();
      setRows(res.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load salary components');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (c: SalaryComponent) => {
    setEditing(c);
    setForm({
      name: c.name,
      code: c.code,
      type: c.type,
      calculationType: c.calculation_type,
      percentageOfComponent: c.percentage_of_component ?? '',
      defaultAmount: c.default_amount ?? '',
      taxable: c.taxable,
      sortOrder: String(c.sort_order),
    });
    setFormError('');
    setFormOpen(true);
  };

  const save = async () => {
    setSubmitting(true);
    setFormError('');
    try {
      if (!form.name || !form.code) {
        setFormError('Name and code are required.');
        return;
      }
      if (form.calculationType === 'percentage' && !form.percentageOfComponent) {
        setFormError('Percentage components require a base component.');
        return;
      }
      const body = {
        name: form.name,
        code: form.code,
        type: form.type,
        calculationType: form.calculationType,
        percentageOfComponent: form.calculationType === 'percentage' ? form.percentageOfComponent : null,
        defaultAmount: form.defaultAmount ? form.defaultAmount : null,
        taxable: form.taxable,
        sortOrder: Number(form.sortOrder || 0),
      };
      if (editing) {
        await payroll.updateComponent(editing.id, body);
      } else {
        await payroll.createComponent(body);
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save component');
    } finally {
      setSubmitting(false);
    }
  };

  const deactivate = async (c: SalaryComponent) => {
    if (!window.confirm(`Deactivate component "${c.name}"?`)) return;
    try {
      await payroll.deactivateComponent(c.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate component');
    }
  };

  const filtered = rows.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.code.toLowerCase().includes(search.toLowerCase())
  );

  const columns: DataColumn<SalaryComponent>[] = [
    { key: 'code', header: 'Code', render: (c) => <span className="badge-clay badge-clay-primary">{c.code}</span> },
    { key: 'name', header: 'Name' },
    {
      key: 'type',
      header: 'Type',
      render: (c) => (
        <span className={c.type === 'earning' ? 'badge-clay badge-clay-success' : 'badge-clay badge-clay-danger'}>
          {formatStatusLabel(c.type)}
        </span>
      ),
    },
    {
      key: 'calculation_type',
      header: 'Calculation',
      render: (c) => <span className="badge-clay badge-clay-info">{formatStatusLabel(c.calculation_type)}</span>,
    },
    {
      key: 'percentage_of_component',
      header: 'Base',
      render: (c) => (c.percentage_of_component ? <span className="muted-text">{c.percentage_of_component}</span> : <span>—</span>),
    },
    {
      key: 'default_amount',
      header: 'Default Amount',
      align: 'right',
      render: (c) => (c.default_amount ? bdt(c.default_amount) : <span>—</span>),
    },
    { key: 'taxable', header: 'Taxable', align: 'center', render: (c) => (c.taxable ? 'Yes' : 'No') },
    { key: 'is_active', header: 'Status', render: (c) => <StatusBadge value={c.is_active ? 'active' : 'inactive'} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (c) => (
        <div className="table-actions">
          <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => openEdit(c)}>
            Edit
          </button>
          {c.is_active && (
            <button className="btn-clay btn-clay-sm btn-clay-danger" onClick={() => void deactivate(c)}>
              Deactivate
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Salary Components"
        subtitle="Earning and deduction components used across salary structures."
        actions={
          <button className="btn-clay btn-clay-primary" onClick={openCreate}>
            Add Component
          </button>
        }
      />
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(c) => c.id}
        loading={loading}
        error={error}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search components..."
        csvFilename="salary-components.csv"
        excelFilename="salary-components.xlsx"
        printable
        emptyMessage="No salary components yet."
      />
      {formOpen && (
        <div className="modal-backdrop" onClick={() => setFormOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{editing ? `Edit ${editing.name}` : 'Add Salary Component'}</div>
              <button className="modal-close" onClick={() => setFormOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  className="form-input"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Basic Salary"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Code</label>
                <input
                  className="form-input"
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. BASIC"
                  disabled={!!editing}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select
                  className="form-input"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as 'earning' | 'deduction' })}
                >
                  <option value="earning">Earning</option>
                  <option value="deduction">Deduction</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Calculation Type</label>
                <select
                  className="form-input"
                  value={form.calculationType}
                  onChange={(e) => setForm({ ...form, calculationType: e.target.value as 'fixed' | 'percentage' | 'formula' })}
                >
                  <option value="fixed">Fixed amount</option>
                  <option value="percentage">Percentage of another component</option>
                  <option value="formula">Formula</option>
                </select>
              </div>
              {form.calculationType === 'percentage' && (
                <div className="form-group">
                  <label className="form-label">Percentage Of Component</label>
                  <select
                    className="form-input"
                    value={form.percentageOfComponent}
                    onChange={(e) => setForm({ ...form, percentageOfComponent: e.target.value })}
                  >
                    <option value="">Select component...</option>
                    {rows
                      .filter((c) => c.is_active)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.code})
                        </option>
                      ))}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Default Amount (BDT)</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.defaultAmount}
                  onChange={(e) => setForm({ ...form, defaultAmount: e.target.value })}
                  placeholder="e.g. 5000.00"
                />
              </div>
              <div className="form-group">
                <label className="form-label">
                  <input
                    type="checkbox"
                    checked={form.taxable}
                    onChange={(e) => setForm({ ...form, taxable: e.target.checked })}
                  />
                  <span className="checkbox-label">Taxable component</span>
                </label>
              </div>
              <div className="form-group">
                <label className="form-label">Sort Order</label>
                <input
                  className="form-input"
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                />
              </div>
              {formError && <div className="alert-box alert-box-error">{formError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn-clay btn-clay-secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button className="btn-clay btn-clay-primary" onClick={() => void save()} disabled={submitting}>
                {submitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}