import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { payroll } from '../../api';
import type { PayrollEntry, PayrollRun } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { formatStatusLabel } from '../../utils/statusLabels';

const bdt = (v: string | number): string =>
  Number(v).toLocaleString(undefined, { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 });

const MONTHS = Array.from({ length: 24 }, (_, i) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - i);
  return d.toISOString().slice(0, 7);
});

export function PayrollRunPage(): ReactElement {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [active, setActive] = useState<PayrollRun | null>(null);
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeError, setActiveError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createPeriod, setCreatePeriod] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'bank_transfer',
    paymentReference: '',
    paymentNotes: '',
  });
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');

  const [selectedEntry, setSelectedEntry] = useState<PayrollEntry | null>(null);
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjForm, setAdjForm] = useState({
    employeeId: '',
    type: 'earning' as 'earning' | 'deduction',
    amount: '',
    salaryComponentId: '',
    reason: '',
  });
  const [adjError, setAdjError] = useState('');

  const loadRuns = useCallback(async (p: number, pp: number) => {
    setLoading(true);
    try {
      const res = await payroll.runs({ page: p, perPage: pp });
      setRuns(res.data.items);
      setTotal(res.data.total);
      setPage(res.data.page);
      setPerPage(res.data.per_page);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payroll runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns(page, perPage);
  }, [loadRuns, page, perPage]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setActiveError('');
    try {
      const [runRes, entriesRes] = await Promise.all([
        payroll.run(id),
        payroll.entries(id, { perPage: '500' }),
      ]);
      setActive(runRes.data);
      setEntries(entriesRes.data);
      setActiveError('');
    } catch (err) {
      setActiveError(err instanceof Error ? err.message : 'Failed to load run detail');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const refreshActive = async () => {
    if (active) await loadDetail(active.id);
    await loadRuns(page, perPage);
  };

  const createRun = async () => {
    setCreating(true);
    setCreateError('');
    try {
      const res = await payroll.createRun(createPeriod);
      setCreateOpen(false);
      await loadRuns(1, perPage);
      await loadDetail(res.data.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create run');
    } finally {
      setCreating(false);
    }
  };

  const action = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refreshActive();
    } catch (err) {
      setActiveError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const payRun = async () => {
    setPaying(true);
    setPayError('');
    try {
      await action(() =>
        payroll.pay(active?.id ?? '', {
          paymentDate: payForm.paymentDate,
          paymentMethod: payForm.paymentMethod,
          paymentReference: payForm.paymentReference,
          paymentNotes: payForm.paymentNotes,
        })
      );
      setPayOpen(false);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Failed to mark paid');
    } finally {
      setPaying(false);
    }
  };

  const addAdjustment = async () => {
    setAdjError('');
    if (!active) return;
    if (!adjForm.employeeId || !adjForm.amount || Number(adjForm.amount) <= 0) {
      setAdjError('Employee and amount are required.');
      return;
    }
    try {
      await payroll.addAdjustment(active.id, {
        employeeId: adjForm.employeeId,
        type: adjForm.type,
        amount: adjForm.amount,
        ...(adjForm.salaryComponentId ? { salaryComponentId: adjForm.salaryComponentId } : {}),
        ...(adjForm.reason ? { reason: adjForm.reason } : {}),
      });
      setAdjOpen(false);
      await refreshActive();
    } catch (err) {
      setAdjError(err instanceof Error ? err.message : 'Failed to add adjustment');
    }
  };

  const canCalculate = active?.status === 'draft';
  const canApprove = active?.status === 'calculated';
  const canPay = active?.status === 'approved';
  const canCancel = active?.status === 'draft' || active?.status === 'calculated';

  const runsColumns: DataColumn<PayrollRun>[] = [
    {
      key: 'period_month',
      header: 'Period',
      render: (r) => <span className="badge-clay badge-clay-primary">{r.period_month.slice(0, 7)}</span>,
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
    {
      key: 'employee_count',
      header: 'Employees',
      align: 'center',
      render: (r) => `${r.employee_count ?? 0}`,
    },
    {
      key: 'gross_total',
      header: 'Gross',
      align: 'right',
      render: (r) => bdt(r.gross_total),
    },
    {
      key: 'deductions_total',
      header: 'Deductions',
      align: 'right',
      render: (r) => bdt(r.deductions_total),
    },
    { key: 'net_total', header: 'Net Pay', align: 'right', render: (r) => <b>{bdt(r.net_total)}</b> },
    {
      key: 'payment_date',
      header: 'Payment Date',
      render: (r) => (r.payment_date ? <span className="muted-text">{r.payment_date}</span> : <span>—</span>),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => void loadDetail(r.id)}>
          Open
        </button>
      ),
    },
  ];

  const entriesColumns: DataColumn<PayrollEntry>[] = [
    { key: 'employee_code', header: 'ID' },
    { key: 'employee_name', header: 'Employee' },
    {
      key: 'department_name',
      header: 'Department',
      render: (r) => r.department_name ?? <span className="muted-text">—</span>,
    },
    {
      key: 'gross_pay',
      header: 'Gross',
      align: 'right',
      render: (r) => bdt(r.gross_pay),
    },
    {
      key: 'total_earnings',
      header: 'Earnings',
      align: 'right',
      render: (r) => bdt(r.total_earnings),
    },
    {
      key: 'total_deductions',
      header: 'Deductions',
      align: 'right',
      render: (r) => bdt(r.total_deductions),
    },
    { key: 'net_pay', header: 'Net', align: 'right', render: (r) => <b>{bdt(r.net_pay)}</b> },
    { key: 'payment_status', header: 'Payment', render: (r) => <StatusBadge value={r.payment_status} /> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => setSelectedEntry(r)}>
          Payslip
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Payroll Run"
        subtitle="Create payroll runs, calculate salaries, approve and pay."
        actions={
          <button className="btn-clay btn-clay-primary" onClick={() => setCreateOpen(true)}>
            New Payroll Run
          </button>
        }
      />
      <DataTable
        columns={runsColumns}
        rows={runs}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        page={page}
        perPage={perPage}
        total={total}
        onPageChange={setPage}
        onPerPageChange={(pp) => {
          setPerPage(pp);
          setPage(1);
        }}
        csvFilename="payroll-runs.csv"
        excelFilename="payroll-runs.xlsx"
        printable
        emptyMessage="No payroll runs yet."
      />
      {active && (
        <div className="panel-clay" style={{ marginTop: 20 }}>
          <div className="panel-header">
            <div className="panel-title">
              Payroll Run — {active.period_month.slice(0, 7)}{' '}
              <StatusBadge value={active.status} />
            </div>
            <div className="page-header-actions">
              {canCalculate && (
                <button className="btn-clay btn-clay-primary" onClick={() => void action(() => payroll.calculate(active.id))}>
                  Calculate
                </button>
              )}
              {canApprove && (
                <button className="btn-clay btn-clay-primary" onClick={() => void action(() => payroll.approve(active.id))}>
                  Approve
                </button>
              )}
              {canPay && (
                <button className="btn-clay btn-clay-primary" onClick={() => setPayOpen(true)}>
                  Mark Paid
                </button>
              )}
              {canCancel && (
                <button className="btn-clay btn-clay-danger" onClick={() => void action(() => payroll.cancel(active.id))}>
                  Cancel Run
                </button>
              )}
              <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => void refreshActive()}>
                Refresh
              </button>
            </div>
          </div>
          <div className="panel-subtitle">
            {active.employee_count ?? entries.length} employees · Gross {bdt(active.gross_total)} · Deductions{' '}
            {bdt(active.deductions_total)} · Net {bdt(active.net_total)}
            {active.payment_method ? ` · ${formatStatusLabel(active.payment_method)}` : ''}
            {active.payment_reference ? ` · Ref: ${active.payment_reference}` : ''}
          </div>
          {activeError && <div className="alert-box alert-box-error">{activeError}</div>}
          {detailLoading ? (
            <div className="empty-state">Loading run detail...</div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <div className="panel-header">
                <div className="panel-title">Employee Payroll Entries</div>
                {active.status !== 'paid' && active.status !== 'cancelled' && (
                  <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => setAdjOpen(true)}>
                    Add Adjustment
                  </button>
                )}
              </div>
              <DataTable
                columns={entriesColumns}
                rows={entries}
                rowKey={(r) => r.id}
                csvFilename={`payroll-entries-${active.period_month.slice(0, 7)}.csv`}
                excelFilename={`payroll-entries-${active.period_month.slice(0, 7)}.xlsx`}
                printable
                emptyMessage="No entries yet — calculate the run first."
              />
            </div>
          )}
        </div>
      )}

      {createOpen && (
        <div className="modal-overlay" onClick={() => setCreateOpen(false)}>
          <div className="modal-content-clay" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-clay">
              <div className="modal-title-clay">New Payroll Run</div>
              <button className="modal-close-btn" onClick={() => setCreateOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body-clay">
              <div className="form-group">
                <label className="form-label">Period</label>
                <select className="form-control-clay" value={createPeriod} onChange={(e) => setCreatePeriod(e.target.value)}>
                  {MONTHS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              {createError && <div className="alert-box alert-box-error">{createError}</div>}
            </div>
            <div className="modal-footer-clay">
              <button className="btn-clay btn-clay-secondary" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button className="btn-clay btn-clay-primary" onClick={() => void createRun()} disabled={creating}>
                {creating ? 'Creating...' : 'Create Run'}
              </button>
            </div>
          </div>
        </div>
      )}

      {payOpen && active && (
        <div className="modal-overlay" onClick={() => setPayOpen(false)}>
          <div className="modal-content-clay" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-clay">
              <div className="modal-title-clay">Mark Run Paid — {active.period_month.slice(0, 7)}</div>
              <button className="modal-close-btn" onClick={() => setPayOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body-clay">
              <div className="form-group">
                <label className="form-label">Payment Date</label>
                <input
                  className="form-control-clay"
                  type="date"
                  value={payForm.paymentDate}
                  onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Payment Method</label>
                <select
                  className="form-control-clay"
                  value={payForm.paymentMethod}
                  onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })}
                >
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Reference (optional)</label>
                <input
                  className="form-control-clay"
                  type="text"
                  value={payForm.paymentReference}
                  onChange={(e) => setPayForm({ ...payForm, paymentReference: e.target.value })}
                  placeholder="e.g. bank slip no."
                />
              </div>
              <div className="form-group">
                <label className="form-label">Notes (optional)</label>
                <textarea
                  className="form-control-clay"
                  value={payForm.paymentNotes}
                  onChange={(e) => setPayForm({ ...payForm, paymentNotes: e.target.value })}
                />
              </div>
              {payError && <div className="alert-box alert-box-error">{payError}</div>}
            </div>
            <div className="modal-footer-clay">
              <button className="btn-clay btn-clay-secondary" onClick={() => setPayOpen(false)}>
                Cancel
              </button>
              <button className="btn-clay btn-clay-primary" onClick={() => void payRun()} disabled={paying}>
                {paying ? 'Saving...' : 'Mark Paid'}
              </button>
            </div>
          </div>
        </div>
      )}

      {adjOpen && active && (
        <div className="modal-overlay" onClick={() => setAdjOpen(false)}>
          <div className="modal-content-clay" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-clay">
              <div className="modal-title-clay">Add Adjustment — {active.period_month.slice(0, 7)}</div>
              <button className="modal-close-btn" onClick={() => setAdjOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body-clay">
              <div className="form-group">
                <label className="form-label">Employee</label>
                <select
                  className="form-control-clay"
                  value={adjForm.employeeId}
                  onChange={(e) => setAdjForm({ ...adjForm, employeeId: e.target.value })}
                >
                  <option value="">Select employee...</option>
                  {entries.map((en) => (
                    <option key={en.id} value={en.employee_id}>
                      {en.employee_code} — {en.employee_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select
                  className="form-control-clay"
                  value={adjForm.type}
                  onChange={(e) => setAdjForm({ ...adjForm, type: e.target.value as 'earning' | 'deduction' })}
                >
                  <option value="earning">Earning (bonus, commission, arrear)</option>
                  <option value="deduction">Deduction (penalty, recovery)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Amount (BDT)</label>
                <input
                  className="form-control-clay"
                  type="number"
                  min="0"
                  step="0.01"
                  value={adjForm.amount}
                  onChange={(e) => setAdjForm({ ...adjForm, amount: e.target.value })}
                  placeholder="e.g. 5000.00"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Reason</label>
                <input
                  className="form-control-clay"
                  type="text"
                  value={adjForm.reason}
                  onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}
                  placeholder="e.g. festival bonus"
                />
              </div>
              {adjError && <div className="alert-box alert-box-error">{adjError}</div>}
            </div>
            <div className="modal-footer-clay">
              <button className="btn-clay btn-clay-secondary" onClick={() => setAdjOpen(false)}>
                Cancel
              </button>
              <button className="btn-clay btn-clay-primary" onClick={() => void addAdjustment()}>
                Add Adjustment
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedEntry && (
        <div className="modal-overlay" onClick={() => setSelectedEntry(null)}>
          <div className="modal-content-clay" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-clay">
              <div className="modal-title-clay">
                Payslip — {selectedEntry.employee_name} ({selectedEntry.employee_code})
              </div>
              <button className="modal-close-btn" onClick={() => setSelectedEntry(null)}>
                ×
              </button>
            </div>
            <div className="modal-body-clay">
              <div className="payslip-meta">
                Period {selectedEntry.period_month.slice(0, 7)} ·{' '}
                <StatusBadge value={selectedEntry.payment_status} /> ·{' '}
                {selectedEntry.paid_at ? `Paid on ${selectedEntry.paid_at.slice(0, 10)}` : 'Not yet paid'}
              </div>
              {(selectedEntry.lines ?? []).length > 0 && (
                <table className="table-clay" style={{ marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th>Type</th>
                      <th>Source</th>
                      <th align="right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedEntry.lines?.map((l) => (
                      <tr key={l.id}>
                        <td>{l.name}</td>
                        <td>
                          <span className={l.type === 'earning' ? 'badge-clay badge-clay-success' : 'badge-clay badge-clay-danger'}>
                            {formatStatusLabel(l.type)}
                          </span>
                        </td>
                        <td className="muted-text">{l.source}</td>
                        <td align="right">{bdt(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="payslip-totals">
                <div className="payslip-total-row">
                  <span>Gross Pay</span>
                  <span>{bdt(selectedEntry.gross_pay)}</span>
                </div>
                <div className="payslip-total-row">
                  <span>Total Earnings</span>
                  <span>{bdt(selectedEntry.total_earnings)}</span>
                </div>
                <div className="payslip-total-row">
                  <span>Total Deductions</span>
                  <span>
                    {bdt(selectedEntry.total_deductions)} (attendance {bdt(selectedEntry.attendance_deduction)} · loan{' '}
                    {bdt(selectedEntry.loan_deduction)})
                  </span>
                </div>
                <div className="payslip-total-row payslip-net">
                  <span>Net Pay</span>
                  <span>{bdt(selectedEntry.net_pay)}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer-clay">
              <button className="btn-clay btn-clay-secondary" onClick={() => setSelectedEntry(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}