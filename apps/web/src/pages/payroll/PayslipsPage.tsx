import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { payroll } from '../../api';
import type { PayrollEntry } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { formatStatusLabel } from '../../utils/statusLabels';

const bdt = (v: string | number): string =>
  Number(v).toLocaleString(undefined, { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 });

function getGrossSalaryFromSnapshot(snapshot: unknown): string | null {
  if (snapshot && typeof snapshot === 'object' && 'gross_salary' in snapshot) {
    const val = (snapshot as Record<string, unknown>).gross_salary;
    return typeof val === 'string' ? val : null;
  }
  return null;
}

export function PayslipsPage(): ReactElement {
  const [payslips, setPayslips] = useState<PayrollEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PayrollEntry | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [selectedError, setSelectedError] = useState('');

  const load = useCallback(async (p: number, pp: number) => {
    setLoading(true);
    try {
      const res = await payroll.payslips({ page: p, perPage: pp });
      setPayslips(res.data.items);
      setTotal(res.data.total);
      setPage(res.data.page);
      setPerPage(res.data.per_page);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payslips');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(page, perPage);
  }, [load, page, perPage]);

  const openPayslip = async (id: string) => {
    setSelectedLoading(true);
    setSelectedError('');
    try {
      const res = await payroll.payslip(id);
      setSelected(res.data);
    } catch (err) {
      setSelectedError(err instanceof Error ? err.message : 'Failed to load payslip');
    } finally {
      setSelectedLoading(false);
    }
  };

  const filtered = payslips.filter(
    (p) =>
      !search ||
      p.employee_code?.toLowerCase().includes(search.toLowerCase()) ||
      p.employee_name?.toLowerCase().includes(search.toLowerCase()) ||
      p.period_month.includes(search)
  );

  const columns: DataColumn<PayrollEntry>[] = [
    {
      key: 'period_month',
      header: 'Period',
      render: (p) => <span className="badge-clay badge-clay-primary">{p.period_month.slice(0, 7)}</span>,
    },
    { key: 'employee_code', header: 'Employee ID' },
    { key: 'employee_name', header: 'Employee' },
    {
      key: 'department_name',
      header: 'Department',
      render: (p) => p.department_name ?? <span className="muted-text">—</span>,
    },
    { key: 'gross_pay', header: 'Gross', align: 'right', render: (p) => bdt(p.gross_pay) },
    { key: 'net_pay', header: 'Net Pay', align: 'right', render: (p) => <b>{bdt(p.net_pay)}</b> },
    { key: 'payment_status', header: 'Payment', render: (p) => <StatusBadge value={p.payment_status} /> },
    {
      key: 'paid_at',
      header: 'Paid On',
      render: (p) => (p.paid_at ? <span className="muted-text">{p.paid_at.slice(0, 10)}</span> : <span>—</span>),
    },
    {
      key: 'actions',
      header: '',
      render: (p) => (
        <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => void openPayslip(p.id)}>
          View
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Payslips"
        subtitle="Your payslips and payslip history."
        actions={
          <button
            className="btn-clay btn-clay-sm btn-clay-secondary"
            onClick={() => window.print()}
          >
            Print
          </button>
        }
      />
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(p) => p.id}
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
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search period, employee or ID..."
        csvFilename="payslips.csv"
        excelFilename="payslips.xlsx"
        printable
        emptyMessage="No payslips found."
      />
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-content-clay" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-clay">
              <div className="modal-title-clay">
                Payslip — {selected.employee_name} ({selected.employee_code})
              </div>
              <button className="modal-close-btn" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            <div className="modal-body-clay">
              {selectedLoading ? (
                <div className="empty-state">Loading payslip...</div>
              ) : selectedError ? (
                <div className="alert-box alert-box-error">{selectedError}</div>
              ) : (
                <>
                  <div className="payslip-meta">
                    Period {selected.period_month.slice(0, 7)} ·{' '}
                    <StatusBadge value={selected.payment_status} /> ·{' '}
                    {selected.paid_at ? `Paid on ${selected.paid_at.slice(0, 10)}` : 'Not yet paid'}
                    {selected.payment_date ? ` · Payment date ${selected.payment_date}` : ''}
                  </div>
                  {(selected.lines ?? []).length > 0 && (
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
                        {selected.lines?.map((l) => (
                          <tr key={l.id}>
                            <td>{l.name}</td>
                            <td>
                              <span
                                className={
                                  l.type === 'earning' ? 'badge-clay badge-clay-success' : 'badge-clay badge-clay-danger'
                                }
                              >
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
                    {(() => {
                      const grossSalary = selected.snapshot ? getGrossSalaryFromSnapshot(selected.snapshot) : null;
                      return (
                        <>
                          {grossSalary && (
                            <div className="payslip-total-row">
                              <span>Gross Salary (contract)</span>
                              <span>{bdt(grossSalary)}</span>
                            </div>
                          )}
                          <div className="payslip-total-row">
                            <span>Gross Pay (structure)</span>
                            <span>{bdt(selected.gross_pay)}</span>
                          </div>
                          <div className="payslip-total-row">
                            <span>Total Earnings</span>
                            <span>{bdt(selected.total_earnings)}</span>
                          </div>
                          <div className="payslip-total-row">
                            <span>Total Deductions</span>
                            <span>
                              {bdt(selected.total_deductions)} (attendance {bdt(selected.attendance_deduction)} · loan{' '}
                              {bdt(selected.loan_deduction)})
                            </span>
                          </div>
                          <div className="payslip-total-row payslip-net">
                            <span>Net Pay</span>
                            <span>{bdt(selected.net_pay)}</span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                  <div className="payslip-footer">SDI Enterprise — Payroll</div>
                </>
              )}
            </div>
            <div className="modal-footer-clay">
              <button className="btn-clay btn-clay-secondary" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}