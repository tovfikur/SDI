import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { payroll } from '../../api';
import type { SalaryStructure, StructureComponentRow } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { formatStatusLabel } from '../../utils/statusLabels';

const bdt = (v: string | number | null): string =>
  Number(v ?? 0).toLocaleString(undefined, { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 });

export function SalaryStructuresPage(): ReactElement {
  const [rows, setRows] = useState<SalaryStructure[]>([]);
  const [components, setComponents] = useState<Array<{ id: string; name: string; code: string; type: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SalaryStructure | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    componentRows: [] as Array<{ component_id: string; percentage_of_component: string; amount: string }>,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [structRes, compRes] = await Promise.all([payroll.structures(), payroll.components()]);
      setRows(structRes.data);
      setComponents(compRes.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load salary structures');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', componentRows: [{ component_id: '', percentage_of_component: '', amount: '' }] });
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (s: SalaryStructure) => {
    setEditing(s);
    setForm({
      name: s.name,
      description: s.description,
      componentRows: s.components.map((c) => ({
        component_id: c.component_id,
        percentage_of_component: c.percentage_of_component ?? '',
        amount: c.amount ?? '',
      })),
    });
    setFormError('');
    setFormOpen(true);
  };

  const addRow = () =>
    setForm({ ...form, componentRows: [...form.componentRows, { component_id: '', percentage_of_component: '', amount: '' }] });

  const updateRow = (idx: number, patch: Partial<{ component_id: string; percentage_of_component: string; amount: string }>) => {
    const next = [...form.componentRows];
    next[idx] = { ...next[idx], ...patch };
    setForm({ ...form, componentRows: next });
  };

  const removeRow = (idx: number) => {
    if (form.componentRows.length === 1) return;
    setForm({ ...form, componentRows: form.componentRows.filter((_, i) => i !== idx) });
  };

  const save = async () => {
    setSubmitting(true);
    setFormError('');
    try {
      if (!form.name) {
        setFormError('Structure name is required.');
        return;
      }
      const valid = form.componentRows.filter((r) => r.component_id);
      if (valid.length === 0) {
        setFormError('Add at least one component.');
        return;
      }
      const body = {
        name: form.name,
        description: form.description || undefined,
        components: valid.map((r) => ({
          componentId: r.component_id,
          percentageOfComponent: r.percentage_of_component || undefined,
          amount: r.amount || undefined,
        })),
      };
      if (editing) {
        await payroll.updateStructure(editing.id, body);
      } else {
        await payroll.createStructure(body);
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save structure');
    } finally {
      setSubmitting(false);
    }
  };

  const deactivate = async (s: SalaryStructure) => {
    if (!window.confirm(`Deactivate structure "${s.name}"?`)) return;
    try {
      await payroll.deactivateStructure(s.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate structure');
    }
  };

  const filtered = rows.filter(
    (s) => !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase())
  );

  const columns: DataColumn<SalaryStructure>[] = [
    { key: 'name', header: 'Structure', render: (s) => <span className="badge-clay badge-clay-info">{s.name}</span> },
    {
      key: 'description',
      header: 'Description',
      render: (s) => (s.description ? <span className="muted-text">{s.description}</span> : <span>—</span>),
    },
    {
      key: 'components',
      header: 'Components',
      align: 'center',
      render: (s) => `${s.components.length}`,
    },
    { key: 'is_active', header: 'Status', render: (s) => <StatusBadge value={s.is_active ? 'active' : 'inactive'} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (s) => (
        <div className="table-actions">
          <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
            {expanded === s.id ? 'Hide' : 'View'}
          </button>
          <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => openEdit(s)}>
            Edit
          </button>
          {s.is_active && (
            <button className="btn-clay btn-clay-sm btn-clay-danger" onClick={() => void deactivate(s)}>
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
        title="Salary Structures"
        subtitle="Named bundles of components applied to employee salaries."
        actions={
          <button className="btn-clay btn-clay-primary" onClick={openCreate}>
            Add Structure
          </button>
        }
      />
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(s) => s.id}
        loading={loading}
        error={error}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search structures..."
        csvFilename="salary-structures.csv"
        excelFilename="salary-structures.xlsx"
        printable
        emptyMessage="No salary structures yet."
      />
      {expanded &&
        rows
          .filter((s) => s.id === expanded)
          .map((s) => (
            <div key={s.id} className="panel-clay" style={{ marginTop: 16 }}>
              <div className="panel-title">{s.name} — Components</div>
              <table className="table-clay" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Type</th>
                    <th>Calculation</th>
                    <th>Base</th>
                    <th align="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {s.components.map((c: StructureComponentRow) => (
                    <tr key={c.id}>
                      <td>
                        {c.name} <span className="muted-text">({c.code})</span>
                      </td>
                      <td>
                        <span className={c.type === 'earning' ? 'badge-clay badge-clay-success' : 'badge-clay badge-clay-danger'}>
                          {formatStatusLabel(c.type)}
                        </span>
                      </td>
                      <td>
                        <span className="badge-clay badge-clay-info">{formatStatusLabel(c.calculation_type)}</span>
                      </td>
                      <td className="muted-text">
                        {c.percentage_of_component ? (
                          <span>
                            {bdt(c.percentage_of_component)} of {c.percentage_of_component}
                          </span>
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                      <td align="right">{c.amount ? bdt(c.amount) : <span>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      {formOpen && (
        <div className="modal-backdrop" onClick={() => setFormOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{editing ? `Edit ${editing.name}` : 'Add Salary Structure'}</div>
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
                  placeholder="e.g. Permanent Staff"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <input
                  className="form-input"
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional description"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Components</label>
                {form.componentRows.map((row, idx) => {
                  const comp = components.find((c) => c.id === row.component_id);
                  return (
                    <div key={idx} className="structure-row">
                      <select
                        className="form-input"
                        value={row.component_id}
                        onChange={(e) => updateRow(idx, { component_id: e.target.value })}
                      >
                        <option value="">Select component...</option>
                        {components
                          .filter((c) => c.id === row.component_id || !form.componentRows.some((r) => r.component_id === c.id))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({c.code})
                            </option>
                          ))}
                      </select>
                      {comp && (comp.type === 'percentage' || (comp as { calculation_type?: string }).calculation_type === 'percentage') && (
                        <input
                          className="form-input"
                          type="text"
                          value={row.percentage_of_component}
                          onChange={(e) => updateRow(idx, { percentage_of_component: e.target.value })}
                          placeholder="Base component ID"
                        />
                      )}
                      <input
                        className="form-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.amount}
                        onChange={(e) => updateRow(idx, { amount: e.target.value })}
                        placeholder="Amount (BDT)"
                      />
                      <button className="btn-clay btn-clay-sm btn-clay-danger" onClick={() => removeRow(idx)}>
                        Remove
                      </button>
                    </div>
                  );
                })}
                <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={addRow}>
                  Add Component
                </button>
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