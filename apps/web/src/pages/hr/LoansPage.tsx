import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { hr } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';

interface Loan {
  id: string;
  employee_id: string | null;
  full_name?: string;
  amount: string;
  status: string;
}

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

export function LoansPage(): ReactElement {
  const { can } = usePermissions();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    employee_id: '',
    amount: '',
    interest_rate: '0',
    loan_date: new Date().toISOString().slice(0, 10),
    installment_count: '1',
    deduction_day: '1',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [loanRes, empRes] = await Promise.all([
        hr.loans({ perPage: 100 }),
        hr.employees({ perPage: 100 }),
      ]);
      const payload = (loanRes.data as { items?: Loan[]; total?: number }) ?? {};
      setLoans(payload.items ?? []);
      setEmployees((empRes.data as { items?: Employee[] })?.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load loans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openModal = () => {
    setForm({
      employee_id: employees[0]?.id ?? '',
      amount: '',
      interest_rate: '0',
      loan_date: new Date().toISOString().slice(0, 10),
      installment_count: '1',
      deduction_day: '1',
      notes: '',
    });
    setFormError('');
    setOpen(true);
  };
  const closeModal = () => setOpen(false);

  const save = async () => {
    if (!form.employee_id || !form.amount || !form.loan_date) {
      setFormError('Employee, amount and loan date are required');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await hr.createLoan({
        employee_id: form.employee_id,
        amount: Number(form.amount),
        interest_rate: Number(form.interest_rate) || 0,
        loan_date: form.loan_date,
        installment_count: Number(form.installment_count) || 1,
        deduction_day: Number(form.deduction_day) || 1,
        notes: form.notes || undefined,
      });
      setOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create loan');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<Loan>[] = [
    { key: 'full_name', header: 'Employee', render: (r) => <strong>{r.full_name ?? '—'}</strong> },
    {
      key: 'amount',
      header: 'Amount',
      render: (r) =>
        Number(r.amount ?? 0).toLocaleString(undefined, { style: 'currency', currency: 'BDT' }),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      render: (r) => <StatusBadge value={r.status} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Loans"
        subtitle="Manage employee loan applications."
        actions={
          can('hr.employee.update') && (
            <button className="btn-clay btn-clay-primary" onClick={openModal}>
              + New Loan
            </button>
          )
        }
      />
      {error && <div className="form-error-text">{error}</div>}
      <DataTable
        columns={columns}
        rows={loans}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        emptyMessage="No loans found."
        csvFilename="loans.csv"
        excelFilename="loans.xls"
        printable
      />

      <Modal
        title="New Loan"
        open={open}
        onClose={closeModal}
        onSubmit={save}
        submitting={submitting}
        submitLabel="Create"
        wide
      >
        <div className="form-row">
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
              Amount <span className="form-required">*</span>
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              className="form-control-clay"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row form-row-3">
          <div className="form-group">
            <label className="form-label">Interest Rate (%)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              className="form-control-clay"
              value={form.interest_rate}
              onChange={(e) => setForm({ ...form, interest_rate: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              Loan Date <span className="form-required">*</span>
            </label>
            <input
              type="date"
              className="form-control-clay"
              value={form.loan_date}
              onChange={(e) => setForm({ ...form, loan_date: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Installments</label>
            <input
              type="number"
              min={1}
              className="form-control-clay"
              value={form.installment_count}
              onChange={(e) => setForm({ ...form, installment_count: e.target.value })}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Deduction Day (1–31)</label>
          <input
            type="number"
            min={1}
            max={31}
            className="form-control-clay"
            value={form.deduction_day}
            onChange={(e) => setForm({ ...form, deduction_day: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea
            className="form-control-clay"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>
    </div>
  );
}
