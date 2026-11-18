import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { hr } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { Icon, Icons } from '../../components/Icon';
import { useToast } from '../../components/Toast';

interface Loan {
  id: string;
  amount: number;
  interest_rate: number;
  monthly_deduction: number;
  loan_date: string;
  start_month: string | null;
  end_month: string | null;
  notes: string | null;
  status: string;
  interest_amount: number;
  total_payable: number;
  installment_count: number;
  monthly_installment_amount: number;
  deduction_day: number;
}

export function MyLoansPage(): ReactElement {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    amount: '',
    interest_rate: '0',
    loan_date: '',
    installment_count: '12',
    deduction_day: '1',
    start_month: '',
    notes: '',
  });
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hr.loans({ perPage: 100 });
      setLoans((res.data as { items: Loan[] }).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load loans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openApply = () => {
    setForm({
      amount: '',
      interest_rate: '0',
      loan_date: new Date().toISOString().slice(0, 10),
      installment_count: '12',
      deduction_day: '1',
      start_month: '',
      notes: '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const submit = async () => {
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      setFormError('Loan amount is required and must be positive.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await hr.createLoanSelf({
        amount,
        interest_rate: Number(form.interest_rate) || 0,
        loan_date: form.loan_date,
        installment_count: Math.max(1, Math.floor(Number(form.installment_count) || 1)),
        deduction_day: Math.max(1, Math.min(31, Math.floor(Number(form.deduction_day) || 1))),
        ...(form.start_month ? { start_month: form.start_month } : {}),
        ...(form.notes ? { notes: form.notes } : {}),
      });
      setModalOpen(false);
      toast('Loan request submitted. It will be reviewed by HR.', 'success');
      void load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to submit loan request');
    } finally {
      setSubmitting(false);
    }
  };

  const activeLoans = loans.filter((l) => l.status === 'active');
  const totalRequested = loans.reduce((s, l) => s + Number(l.amount ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="My Loans"
        subtitle="Your loan requests and current status"
        actions={
          <button className="btn btn-primary" onClick={openApply}>
            Request Loan
          </button>
        }
      />
      {error && <div className="alert alert-danger">{error}</div>}

      {!loading && loans.length > 0 && (
        <div className="kpi-grid hrdash-kpi-grid">
          <div className="hrdash-kpi">
            <span className="hrdash-kpi-icon" style={{ background: '#8b5cf61f', color: '#8b5cf6' }}>
              <Icon icon={Icons.SackDollar} size="lg" />
            </span>
            <span className="hrdash-kpi-body">
              <span className="hrdash-kpi-value">{totalRequested.toLocaleString()}</span>
              <span className="hrdash-kpi-label">Total Requested</span>
            </span>
          </div>
          <div className="hrdash-kpi">
            <span className="hrdash-kpi-icon" style={{ background: '#10b9811f', color: '#10b981' }}>
              <Icon icon={Icons.MoneyBills} size="lg" />
            </span>
            <span className="hrdash-kpi-body">
              <span className="hrdash-kpi-value">{activeLoans.length}</span>
              <span className="hrdash-kpi-label">Active Loans</span>
            </span>
          </div>
          <div className="hrdash-kpi">
            <span className="hrdash-kpi-icon" style={{ background: '#f59e0b1f', color: '#f59e0b' }}>
              <Icon icon={Icons.Hourglass} size="lg" />
            </span>
            <span className="hrdash-kpi-body">
              <span className="hrdash-kpi-value">{loans.filter((l) => l.status === 'pending').length}</span>
              <span className="hrdash-kpi-label">Pending Review</span>
            </span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="data-table-state">Loading loans…</div>
      ) : loans.length === 0 ? (
        <div className="empty-state">No loan requests yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {loans.map((l) => {
            const monthly = Number(l.monthly_deduction ?? l.monthly_installment_amount ?? 0);
            const total = Number(l.total_payable ?? l.amount ?? 0);
            return (
              <div key={l.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div
                  style={{
                    padding: '12px 16px',
                    background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                    color: '#fff',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.8 }}>Loan Amount</div>
                    <strong style={{ fontSize: '1.35rem', lineHeight: 1.2 }}>{Number(l.amount ?? 0).toLocaleString()}</strong>
                  </div>
                  <StatusBadge value={l.status} />
                </div>
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem' }}>
                    <span className="text-muted">Interest</span>
                    <strong>{Number(l.interest_rate ?? 0)}%</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem' }}>
                    <span className="text-muted">Monthly Deduction</span>
                    <strong>{monthly.toLocaleString()}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem' }}>
                    <span className="text-muted">Installments</span>
                    <strong>{l.installment_count}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem' }}>
                    <span className="text-muted">Total Payable</span>
                    <strong>{total.toLocaleString()}</strong>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      marginTop: 4,
                      paddingTop: 9,
                      borderTop: '1px solid var(--border-subtle)',
                      fontSize: '0.8rem',
                    }}
                  >
                    <span className="text-muted">Date</span>
                    <span>{l.loan_date}</span>
                    <span className="text-muted">Deductions</span>
                    <span>
                      {l.start_month ?? '—'} → {l.end_month ?? '—'}
                    </span>
                  </div>
                  {l.notes && <div className="text-muted" style={{ fontSize: '0.82rem' }}>{l.notes}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        title="Request a Loan"
        onClose={() => setModalOpen(false)}
        onSubmit={() => void submit()}
        submitting={submitting}
        submitLabel="Submit Request"
        busyLabel="Submitting…"
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label form-required">Amount</label>
            <input
              type="number"
              min={1}
              className="form-control"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Interest Rate (%)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              className="form-control"
              value={form.interest_rate}
              onChange={(e) => setForm({ ...form, interest_rate: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label form-required">Loan Date</label>
            <input
              type="date"
              className="form-control"
              value={form.loan_date}
              onChange={(e) => setForm({ ...form, loan_date: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label form-required">Installments</label>
            <input
              type="number"
              min={1}
              className="form-control"
              value={form.installment_count}
              onChange={(e) => setForm({ ...form, installment_count: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Deduction Day</label>
            <input
              type="number"
              min={1}
              max={31}
              className="form-control"
              value={form.deduction_day}
              onChange={(e) => setForm({ ...form, deduction_day: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">First Deduction Month (optional)</label>
            <input
              type="month"
              className="form-control"
              value={form.start_month}
              onChange={(e) => setForm({ ...form, start_month: e.target.value })}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea
            className="form-control"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <p className="text-muted">Your request will start as <strong>pending</strong> until approved by HR.</p>
        {formError && <div className="alert alert-danger">{formError}</div>}
      </Modal>
    </div>
  );
}