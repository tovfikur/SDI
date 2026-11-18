import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { payroll } from '../../api';
import type { EmployeeSalary, SalaryStructure } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';

interface PayrollEmployee {
  id: string;
  employee_code: string;
  full_name: string;
  department_name: string | null;
}

const bdt = (v: string | number): string =>
  Number(v).toLocaleString(undefined, { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 });

interface SalaryRow {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  structure_name: string;
  gross_salary: string;
  effective_from: string;
  status: string;
}

interface OverrideFormRow {
  componentId: string;
  componentName: string;
  amount: string;
}

export function EmployeeSalariesPage(): ReactElement {
  const [rows, setRows] = useState<SalaryRow[]>([]);
  const [salaries, setSalaries] = useState<EmployeeSalary[]>([]);
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [employees, setEmployees] = useState<PayrollEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    employeeId: '',
    salaryStructureId: '',
    grossSalary: '',
    effectiveFrom: '',
    overrides: [] as OverrideFormRow[],
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [salRes, structRes, empRes] = await Promise.all([
        payroll.employeeSalaries({ perPage: '500' }),
        payroll.structures(),
        payroll.employees(),
      ]);
      const empMap = new Map(empRes.data.map((e) => [e.id, e]));
      setSalaries(salRes.data);
      setRows(
        salRes.data.map((s) => {
          const em = empMap.get(s.employee_id);
          return {
            id: s.id,
            employee_id: s.employee_id,
            employee_code: em?.employee_code ?? '',
            employee_name: em?.full_name ?? '',
            department_name: em?.department_name ?? null,
            structure_name: s.structure_name ?? '',
            gross_salary: s.gross_salary,
            effective_from: s.effective_from,
            status: s.status,
          };
        })
      );
      setStructures(structRes.data);
      setEmployees(empRes.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load employee salaries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const structureById = (id: string) => structures.find((s) => s.id === id);

  const defaultOverrides = (structureId: string): OverrideFormRow[] =>
    (structureById(structureId)?.components ?? [])
      .filter((c) => c.calculation_type === 'fixed')
      .map((c) => ({ componentId: c.component_id, componentName: c.name, amount: '' }));

  const openCreate = () => {
    setForm({
      employeeId: '',
      salaryStructureId: '',
      grossSalary: '',
      effectiveFrom: new Date().toISOString().slice(0, 10),
      overrides: [],
    });
    setEditingId(null);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (row: SalaryRow) => {
    const sal = salaries.find((s) => s.id === row.id);
    if (!sal) return;
    const structure = structureById(sal.salary_structure_id);
    const overrideMap = new Map(sal.overrides?.map((o) => [o.component_id, o.amount]) ?? []);
    const overrideRows = (structure?.components ?? [])
      .filter((c) => c.calculation_type === 'fixed')
      .map((c) => ({
        componentId: c.component_id,
        componentName: c.name,
        amount: overrideMap.get(c.component_id) ?? '',
      }));
    setForm({
      employeeId: sal.employee_id,
      salaryStructureId: sal.salary_structure_id,
      grossSalary: sal.gross_salary,
      effectiveFrom: sal.effective_from,
      overrides: overrideRows,
    });
    setEditingId(row.id);
    setFormError('');
    setFormOpen(true);
  };

  const save = async () => {
    setSubmitting(true);
    setFormError('');
    try {
      if (editingId) {
        const overrides = form.overrides
          .filter((o) => o.componentId && o.amount)
          .map((o) => ({ componentId: o.componentId, amount: o.amount }));
        await payroll.setSalaryOverrides(editingId, overrides);
      } else {
        if (!form.employeeId || !form.salaryStructureId || !form.grossSalary || !form.effectiveFrom) {
          setFormError('Employee, structure, gross salary and effective date are required.');
          return;
        }
        await payroll.assignSalary({
          employeeId: form.employeeId,
          salaryStructureId: form.salaryStructureId,
          grossSalary: form.grossSalary,
          effectiveFrom: form.effectiveFrom,
          overrides: form.overrides
            .filter((o) => o.componentId && o.amount)
            .map((o) => ({ componentId: o.componentId, amount: o.amount })),
        });
      }
      setFormOpen(false);
      setLoading(true);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save salary');
    } finally {
      setSubmitting(false);
    }
  };

  const deactivate = async (id: string) => {
    if (!window.confirm('Deactivate this salary assignment?')) return;
    try {
      await payroll.deactivateSalary(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate salary');
    }
  };

  const filtered = rows.filter(
    (r) =>
      !search ||
      r.employee_code.toLowerCase().includes(search.toLowerCase()) ||
      r.employee_name.toLowerCase().includes(search.toLowerCase()) ||
      (r.department_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      r.structure_name.toLowerCase().includes(search.toLowerCase())
  );

  const columns: DataColumn<SalaryRow>[] = [
    { key: 'employee_code', header: 'Employee ID' },
    { key: 'employee_name', header: 'Employee' },
    {
      key: 'department_name',
      header: 'Department',
      render: (r) => r.department_name ?? <span className="muted-text">—</span>,
    },
    {
      key: 'structure_name',
      header: 'Structure',
      render: (r) => <span className="badge-clay badge-clay-info">{r.structure_name}</span>,
    },
    { key: 'gross_salary', header: 'Gross Salary', align: 'right', render: (r) => bdt(r.gross_salary) },
    {
      key: 'effective_from',
      header: 'Effective From',
      render: (r) => <span className="muted-text">{r.effective_from}</span>,
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div className="table-actions">
          {r.status === 'active' && (
            <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => openEdit(r)}>
              Overrides
            </button>
          )}
          {r.status === 'active' && (
            <button className="btn-clay btn-clay-sm btn-clay-danger" onClick={() => void deactivate(r.id)}>
              Deactivate
            </button>
          )}
        </div>
      ),
    },
  ];

  const isEditing = !!editingId;

  return (
    <div>
      <PageHeader
        title="Employee Salaries"
        subtitle="Salary assignments and per-employee component overrides."
        actions={
          <button className="btn-clay btn-clay-primary" onClick={openCreate}>
            Assign Salary
          </button>
        }
      />
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search employee, department or structure..."
        csvFilename="employee-salaries.csv"
        excelFilename="employee-salaries.xlsx"
        printable
        emptyMessage="No salary assignments yet."
      />
      {formOpen && (
        <div className="modal-backdrop" onClick={() => setFormOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{isEditing ? 'Manage Salary Overrides' : 'Assign Salary'}</div>
              <button className="modal-close" onClick={() => setFormOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {!isEditing && (
                <>
                  <div className="form-group">
                    <label className="form-label">Employee</label>
                    <select
                      className="form-input"
                      value={form.employeeId}
                      onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                    >
                      <option value="">Select employee...</option>
                      {employees.map((em) => (
                        <option key={em.id} value={em.id}>
                          {em.employee_code} — {em.full_name}
                          {em.department_name ? ` (${em.department_name})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Salary Structure</label>
                    <select
                      className="form-input"
                      value={form.salaryStructureId}
                      onChange={(e) => {
                        const sid = e.target.value;
                        setForm({
                          ...form,
                          salaryStructureId: sid,
                          overrides: sid ? defaultOverrides(sid) : [],
                        });
                      }}
                    >
                      <option value="">Select structure...</option>
                      {structures
                        .filter((s) => s.is_active)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Gross Salary (BDT)</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.grossSalary}
                      onChange={(e) => setForm({ ...form, grossSalary: e.target.value })}
                      placeholder="e.g. 30000.00"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Effective From</label>
                    <input
                      className="form-input"
                      type="date"
                      value={form.effectiveFrom}
                      onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
                    />
                  </div>
                </>
              )}
              {form.overrides.length > 0 && (
                <div className="form-group">
                  <label className="form-label">Component Overrides (fixed components)</label>
                  {form.overrides.map((o) => (
                    <div key={o.componentId} className="override-row">
                      <span className="muted-text">{o.componentName}</span>
                      <input
                        className="form-input"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="amount (BDT)"
                        value={o.amount}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            overrides: form.overrides.map((x) =>
                              x.componentId === o.componentId ? { ...x, amount: e.target.value } : x
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                  {isEditing && <div className="muted-text">Blank amounts remove the override (fall back to structure default).</div>}
                </div>
              )}
              {formError && <div className="alert-box alert-box-error">{formError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn-clay btn-clay-secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button className="btn-clay btn-clay-primary" onClick={() => void save()} disabled={submitting}>
                {submitting ? 'Saving...' : isEditing ? 'Save Overrides' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}