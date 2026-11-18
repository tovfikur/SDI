import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { hr, leave } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon, Icons } from '../../components/Icon';
import { useToast } from '../../components/Toast';

interface Row {
  id?: string;
  employee_id?: string;
  leave_type_id?: string;
  employee_code?: string;
  full_name?: string;
  leave_type?: string;
  leave_code?: string;
  year?: number;
  total?: number;
  taken?: number;
  due?: number;
  [key: string]: unknown;
}

interface EmployeeOption {
  id: string;
  employee_code?: string;
  full_name?: string;
}

interface LeaveTypeOption {
  id: string;
  name: string;
  code: string;
}

export function LeaveBalancesTab(): ReactElement {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [generating, setGenerating] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Dropdown options for create modal
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);

  // Form values
  const [form, setForm] = useState({
    employee_id: '',
    leave_type_id: '',
    employee_label: '',
    leave_label: '',
    year: String(new Date().getFullYear()),
    total: '0',
    taken: '0',
    due: '0',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await leave.balances({ year });
      setRows((res.data as unknown[] as Row[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leave balances');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load employee and leave type options on mount if user can manage
  useEffect(() => {
    if (can('hr.leave.manage')) {
      void (async () => {
        try {
          const [empRes, ltRes] = await Promise.all([
            hr.employees({ perPage: 1000 }),
            leave.types(),
          ]);
          const empList = (empRes.data?.items ?? []) as EmployeeOption[];
          setEmployees(empList);
          const rawLt = ltRes.data as unknown;
          const ltList = Array.isArray(rawLt)
            ? (rawLt as LeaveTypeOption[])
            : Array.isArray((rawLt as { items?: unknown[] })?.items)
              ? ((rawLt as { items: LeaveTypeOption[] }).items)
              : [];
          setLeaveTypes(ltList);
        } catch {
          // Non-blocking
        }
      })();
    }
  }, [can]);

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      const res = await leave.generate({ year: Number(year) });
      const genCount = (res as { generated?: number; created?: number })?.generated ?? (res as { created?: number })?.created ?? 0;
      toast(`Generated ${genCount} balance records for ${year}.`, 'success');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate balances');
    } finally {
      setGenerating(false);
    }
  };

  const openEdit = (r: Row) => {
    setEditing(r);
    setForm({
      employee_id: String(r.employee_id ?? ''),
      leave_type_id: String(r.leave_type_id ?? ''),
      employee_label: `${r.employee_code ?? ''} - ${r.full_name ?? ''}`.trim(),
      leave_label: r.leave_type ?? r.leave_code ?? 'Leave',
      year: String(r.year ?? year),
      total: String(r.total ?? 0),
      taken: String(r.taken ?? 0),
      due: String(r.due ?? 0),
    });
    setFormError('');
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditing(null);
    const firstEmp = employees[0]?.id ?? '';
    const firstLt = leaveTypes[0]?.id ?? '';
    setForm({
      employee_id: firstEmp,
      leave_type_id: firstLt,
      employee_label: '',
      leave_label: '',
      year,
      total: '14',
      taken: '0',
      due: '14',
    });
    setFormError('');
    setModalOpen(true);
  };

  const handleTotalChange = (val: string) => {
    const totalNum = parseFloat(val) || 0;
    const takenNum = parseFloat(form.taken) || 0;
    const dueNum = Math.max(0, +(totalNum - takenNum).toFixed(2));
    setForm((prev) => ({ ...prev, total: val, due: String(dueNum) }));
  };

  const handleTakenChange = (val: string) => {
    const takenNum = parseFloat(val) || 0;
    const totalNum = parseFloat(form.total) || 0;
    const dueNum = Math.max(0, +(totalNum - takenNum).toFixed(2));
    setForm((prev) => ({ ...prev, taken: val, due: String(dueNum) }));
  };

  const handleDueChange = (val: string) => {
    setForm((prev) => ({ ...prev, due: val }));
  };

  const save = async () => {
    const totalNum = parseFloat(form.total);
    const takenNum = parseFloat(form.taken);
    const dueNum = parseFloat(form.due);

    if (isNaN(totalNum) || totalNum < 0) {
      setFormError('Total must be a non-negative number.');
      return;
    }
    if (isNaN(takenNum) || takenNum < 0) {
      setFormError('Taken must be a non-negative number.');
      return;
    }
    if (isNaN(dueNum) || dueNum < 0) {
      setFormError('Due balance must be a non-negative number.');
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      if (editing && editing.id) {
        await leave.updateBalance(editing.id, {
          total: totalNum,
          taken: takenNum,
          due: dueNum,
        });
        toast('Leave balance updated successfully.', 'success');
      } else {
        if (!form.employee_id) {
          setFormError('Please select an employee.');
          setSubmitting(false);
          return;
        }
        if (!form.leave_type_id) {
          setFormError('Please select a leave type.');
          setSubmitting(false);
          return;
        }
        await leave.createBalance({
          employee_id: form.employee_id,
          leave_type_id: form.leave_type_id,
          year: parseInt(form.year, 10) || new Date().getFullYear(),
          total: totalNum,
          taken: takenNum,
          due: dueNum,
        });
        toast('Leave balance created/updated successfully.', 'success');
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save leave balance');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      (r.full_name?.toLowerCase() ?? '').includes(q) ||
      (r.employee_code?.toLowerCase() ?? '').includes(q) ||
      (r.leave_type?.toLowerCase() ?? '').includes(q) ||
      (r.leave_code?.toLowerCase() ?? '').includes(q)
    );
  }, [rows, search]);

  const columns: DataColumn<Row>[] = [
    {
      key: 'employee_code',
      header: 'ID',
      render: (r) => <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{r.employee_code ?? '—'}</span>,
    },
    {
      key: 'full_name',
      header: 'Employee',
      sortable: true,
      render: (r) => <strong>{r.full_name ?? '—'}</strong>,
    },
    {
      key: 'leave_type',
      header: 'Leave Type',
      render: (r) => r.leave_type ?? r.leave_code ?? '—',
    },
    { key: 'year', header: 'Year', align: 'center' },
    {
      key: 'total',
      header: 'Total',
      align: 'center',
      sortable: true,
      render: (r) => <StatusBadge value={String(r.total ?? 0)} />,
    },
    { key: 'taken', header: 'Taken', align: 'center', sortable: true },
    {
      key: 'due',
      header: 'Due',
      align: 'center',
      sortable: true,
      render: (r) => (Number(r.due) < 0 ? <span style={{ color: 'var(--clay-danger)' }}>{String(r.due)}</span> : String(r.due ?? '—')),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
          {can('hr.leave.manage') && (
            <button
              className="icon-btn"
              title="Edit Leave Balance"
              onClick={() => openEdit(r)}
            >
              <Icon icon={Icons.Edit} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="panel-clay" style={{ marginBottom: '0.8rem' }}>
        <div className="form-inline-flex" style={{ flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="form-inline-flex" style={{ gap: '0.6rem' }}>
            <label className="form-label" style={{ marginBottom: 0, alignSelf: 'center', fontWeight: 600 }}>Year:</label>
            <input
              type="number"
              min={2000}
              max={2100}
              className="form-control-clay form-control-sm"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              style={{ width: 110 }}
            />
            <button className="btn-clay btn-clay-secondary btn-clay-sm" onClick={generate} disabled={generating}>
              {generating ? 'Generating...' : 'Generate Balances'}
            </button>
          </div>
          {can('hr.leave.manage') && (
            <button className="btn-clay btn-clay-primary btn-clay-sm" onClick={openCreate}>
              + Set Balance
            </button>
          )}
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={filteredRows}
        rowKey={(r) => `${r.id ?? ''}-${r.employee_code ?? ''}-${r.leave_code ?? ''}-${r.year ?? ''}`}
        loading={loading}
        error={error}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search by employee, ID, or leave type..."
        csvFilename={`leave-balances-${year}.csv`}
        excelFilename={`leave-balances-${year}.xls`}
        printable
        emptyMessage="No leave balances for this year. Use 'Generate Balances' or '+ Set Balance'."
      />

      <Modal
        title={editing ? `Edit Leave Balance: ${form.employee_label}` : 'Set Employee Leave Balance'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel={editing ? 'Update Balance' : 'Save Balance'}
      >
        {editing ? (
          <div style={{ marginBottom: '1.2rem', padding: '0.75rem', background: 'var(--surface-sunken)', borderRadius: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.9rem' }}>
              <div><strong>Employee:</strong> {form.employee_label}</div>
              <div><strong>Leave Type:</strong> {form.leave_label}</div>
              <div><strong>Year:</strong> {form.year}</div>
            </div>
          </div>
        ) : (
          <>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label className="form-label">
                Employee <span className="form-required">*</span>
              </label>
              <select
                className="form-control-clay"
                value={form.employee_id}
                onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employee_code ? `[${emp.employee_code}] ` : ''}{emp.full_name ?? emp.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row" style={{ marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label">
                  Leave Type <span className="form-required">*</span>
                </label>
                <select
                  className="form-control-clay"
                  value={form.leave_type_id}
                  onChange={(e) => setForm({ ...form, leave_type_id: e.target.value })}
                >
                  {leaveTypes.map((lt) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.name} ({lt.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">
                  Year <span className="form-required">*</span>
                </label>
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  className="form-control-clay"
                  value={form.year}
                  onChange={(e) => setForm({ ...form, year: e.target.value })}
                />
              </div>
            </div>
          </>
        )}

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Total Entitlement <span className="form-required">*</span>
            </label>
            <input
              type="number"
              min={0}
              step="0.5"
              className="form-control-clay"
              value={form.total}
              onChange={(e) => handleTotalChange(e.target.value)}
              placeholder="e.g. 14"
              autoFocus={!!editing}
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              Taken Days <span className="form-required">*</span>
            </label>
            <input
              type="number"
              min={0}
              step="0.5"
              className="form-control-clay"
              value={form.taken}
              onChange={(e) => handleTakenChange(e.target.value)}
              placeholder="e.g. 0"
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              Due / Remaining Days <span className="form-required">*</span>
            </label>
            <input
              type="number"
              min={0}
              step="0.5"
              className="form-control-clay"
              value={form.due}
              onChange={(e) => handleDueChange(e.target.value)}
              placeholder="e.g. 14"
            />
          </div>
        </div>

        {formError && <div className="form-error-text" style={{ marginTop: '0.8rem' }}>{formError}</div>}
      </Modal>
    </div>
  );
}
