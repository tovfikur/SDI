import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { payroll } from '../../api';
import type { PayrollEntry } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { Modal } from '../../components/Modal';
import { Icon, Icons } from '../../components/Icon';
import { useCurrentUser } from '../../auth-context';

const money = (v: string | number | null | undefined): string =>
  Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function getGrossSalaryFromSnapshot(snapshot: unknown): string | null {
  if (snapshot && typeof snapshot === 'object' && 'gross_salary' in snapshot) {
    const val = (snapshot as Record<string, unknown>).gross_salary;
    return typeof val === 'string' ? val : null;
  }
  return null;
}

export function MyPayslipsPage(): ReactElement {
  const user = useCurrentUser();
  const [rows, setRows] = useState<PayrollEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<PayrollEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 6;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await payroll.payslips({ perPage: 100 });
      setRows((res.data as { items: PayrollEntry[] }).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load payslips');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [rows.length]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setError('');
    try {
      const res = await payroll.payslip(id);
      setDetail(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load payslip');
    } finally {
      setDetailLoading(false);
    }
  };

  const earnings = (detail?.lines ?? []).filter((l) => l.type === 'earning');
  const deductions = (detail?.lines ?? []).filter((l) => l.type === 'deduction');

  return (
    <div>
      <PageHeader title="My Payslips" subtitle={`Payment history for ${user?.fullName ?? 'you'}`} />
      {error && <div className="alert alert-danger">{error}</div>}
      {loading ? (
        <div className="data-table-state">Loading payslips…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">No payslips available yet.</div>
      ) : (
        <>
          <div className="kpi-grid hrdash-kpi-grid">
            <div className="hrdash-kpi">
              <span className="hrdash-kpi-icon" style={{ background: '#10b9811f', color: '#10b981' }}>
                <Icon icon={Icons.FileInvoiceDollar} size="lg" />
              </span>
              <span className="hrdash-kpi-body">
                <span className="hrdash-kpi-value">{rows.length}</span>
                <span className="hrdash-kpi-label">Payslips Issued</span>
              </span>
            </div>
            <div className="hrdash-kpi">
              <span className="hrdash-kpi-icon" style={{ background: '#ec48991f', color: '#ec4899' }}>
                <Icon icon={Icons.MoneyBills} size="lg" />
              </span>
              <span className="hrdash-kpi-body">
                <span className="hrdash-kpi-value">{money(rows.reduce((s, r) => s + Number(r.net_pay ?? 0), 0))}</span>
                <span className="hrdash-kpi-label">Total Net Pay</span>
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {pageRows.map((r) => {
              const gross = Number(r.gross_pay ?? 0);
              const deductions = Number(r.total_deductions ?? 0);
              const paid = r.payment_status === 'paid';
              const deductionPct = gross > 0 ? Math.min(100, Math.round((deductions / gross) * 100)) : 0;
              return (
                <div key={r.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div
                    style={{
                      padding: '12px 16px',
                      background: paid
                        ? 'linear-gradient(135deg, #10b981 0%, #047857 100%)'
                        : 'linear-gradient(135deg, #64748b 0%, #475569 100%)',
                      color: '#fff',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <strong style={{ fontSize: '1.02rem' }}>{r.period_month}</strong>
                    <span
                      className="badge"
                      style={{
                        background: 'rgba(255,255,255,0.22)',
                        color: '#fff',
                        fontWeight: 700,
                      }}
                    >
                      {paid ? 'Paid' : 'Unpaid'}
                    </span>
                  </div>
                  <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span className="text-muted" style={{ fontSize: '0.78rem' }}>Net Pay</span>
                      <strong style={{ fontSize: '1.3rem', color: paid ? '#10b981' : 'inherit' }}>{money(r.net_pay)}</strong>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: 4 }}>
                        <span className="text-muted">Deductions</span>
                        <span>{money(r.total_deductions)} ({deductionPct}%)</span>
                      </div>
                      <div className="progress" style={{ height: 6 }}>
                        <div className="progress-bar" style={{ width: `${deductionPct}%`, background: paid ? '#ec4899' : '#94a3b8' }} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                      <span className="text-muted">Gross Pay</span>
                      <strong>{money(r.gross_pay)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                      <span className="text-muted">Payment Date</span>
                      <span>{r.payment_date ?? r.paid_at ? String(r.payment_date ?? r.paid_at ?? '').slice(0, 10) : '—'}</span>
                    </div>
                    <button className="btn btn-outline btn-sm" onClick={() => void openDetail(r.id)} style={{ width: '100%' }}>
                      View Payslip
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {rows.length > PAGE_SIZE && (
            <div className="pagination-bar" style={{ marginTop: 14, justifyContent: 'flex-end', border: 'none', padding: 0 }}>
              <span className="page-info">
                Page {safePage} of {pageCount} • {rows.length} payslips
              </span>
              <button type="button" className="btn btn-sm btn-outline" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                ‹ Prev
              </button>
              <button type="button" className="btn btn-sm btn-outline" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>
                Next ›
              </button>
            </div>
          )}
        </>
      )}

      <Modal
        open={detail !== null}
        title={`Payslip — ${detail?.period_month ?? ''}`}
        onClose={() => setDetail(null)}
        footer={
          <>
            <button className="btn-clay btn-clay-secondary" onClick={() => window.print()} disabled={detailLoading}>
              Print
            </button>
            <button className="btn-clay btn-clay-primary" onClick={() => setDetail(null)}>
              Close
            </button>
          </>
        }
      >
        {detailLoading && <div className="data-table-state">Loading payslip…</div>}
        {!detailLoading && detail && (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <div className="col">
                <strong>Employee:</strong> {detail.employee_name ?? user?.fullName}
              </div>
              <div className="col">
                <strong>Code:</strong> {detail.employee_code ?? '—'}
              </div>
              <div className="col">
                <strong>Department:</strong> {detail.department_name ?? '—'}
              </div>
              <div className="col">
                <strong>Position:</strong> {detail.position_name ?? '—'}
              </div>
            </div>

            <h4 style={{ margin: '12px 0 8px' }}>Earnings</h4>
            <table className="table table-sm">
              <tbody>
                {earnings.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td style={{ textAlign: 'right' }}>{money(l.amount)}</td>
                  </tr>
                ))}
                {(() => {
                  const grossSalary = detail.snapshot ? getGrossSalaryFromSnapshot(detail.snapshot) : null;
                  return grossSalary ? (
                    <tr>
                      <td>
                        <strong>Gross Salary (contract)</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{money(grossSalary)}</strong>
                      </td>
                    </tr>
                  ) : null;
                })()}
                <tr>
                  <td>
                    <strong>Gross Pay (structure)</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{money(detail.gross_pay)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>

            <h4 style={{ margin: '12px 0 8px' }}>Deductions</h4>
            <table className="table table-sm">
              <tbody>
                {deductions.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td style={{ textAlign: 'right' }}>{money(l.amount)}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Total Deductions</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{money(detail.total_deductions)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>

            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 8,
                background: 'var(--surface-subtle, #f6f7fb)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <strong>Net Pay</strong>
                <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                  {detail.working_days} working / {detail.payable_days} payable days
                </div>
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{money(detail.net_pay)}</div>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}