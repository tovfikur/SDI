import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { leave } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Modal } from '../../components/Modal';
import { HardCopyDocumentUpload } from '../../components/HardCopyDocumentUpload';
import type { LeaveAttachmentFile } from '../../components/HardCopyDocumentUpload';
import { Icon, Icons } from '../../components/Icon';
import { ChartCard } from '../../components/charts/ChartCard';
import { DonutChart } from '../../components/charts/charts';
import { useToast } from '../../components/Toast';

interface BalanceRow {
  leave_type: string;
  leave_code: string;
  year: number;
  total: number;
  taken: number;
  due: number;
}

interface Application {
  id: string;
  leave_type?: string;
  leave_type_name?: string;
  start_date: string;
  end_date: string;
  status: string;
  reason?: string | null;
  created_at: string;
  requested_days?: number | string | null;
  approved_days?: number | string | null;
}

interface LeaveType {
  id: string;
  name: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function safeDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const PAGE_SIZE = 10;

export function MyLeavePage(): ReactElement {
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    reason: '',
    attachment: null as LeaveAttachmentFile | null,
  });
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [balRes, appRes, typeRes] = await Promise.allSettled([
        leave.balances({}),
        leave.applications({ perPage: 100 }),
        leave.types(),
      ]);
      if (balRes.status === 'fulfilled') setBalances(balRes.value.data as BalanceRow[]);
      if (appRes.status === 'fulfilled') setApplications((appRes.value.data as { items: Application[] }).items);
      if (typeRes.status === 'fulfilled') setTypes((typeRes.value.data as { items: LeaveType[] }).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leave data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [applications.length]);

  const openApply = () => {
    setForm({ leaveTypeId: '', startDate: '', endDate: '', reason: '', attachment: null });
    setFormError('');
    setFieldErrors({});
    setModalOpen(true);
  };

  const submit = async () => {
    const errors: Record<string, string> = {};
    if (!form.leaveTypeId) errors.leaveTypeId = 'Select a leave type.';
    if (!form.startDate) errors.startDate = 'Start date is required.';
    if (!form.endDate) errors.endDate = 'End date is required.';
    if (form.startDate && form.endDate && form.startDate > form.endDate) {
      errors.endDate = 'End date cannot be before the start date.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    setFormError('');
    try {
      await leave.createApplication({
        employeeId: '',
        leaveTypeId: form.leaveTypeId,
        startDate: form.startDate,
        endDate: form.endDate,
        ...(form.reason ? { reason: form.reason } : {}),
        ...(form.attachment ? { attachmentFileId: form.attachment.file_id } : {}),
      });
      setModalOpen(false);
      toast('Leave application submitted.', 'success');
      void load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to submit leave application');
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async (id: string) => {
    try {
      await leave.withdraw(id, {});
      toast('Leave application withdrawn.', 'success');
      void load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to withdraw application');
    }
  };

  const totalLeave = balances.reduce((s, b) => s + num(b.total), 0);
  const usedLeave = balances.reduce((s, b) => s + num(b.taken), 0);

  const pendingApps = applications.filter((a) => a.status === 'pending').length;
  const approvedApps = applications.filter((a) => a.status === 'approved').length;

  const utilizationMix = useMemo(
    () =>
      balances
        .filter((b) => num(b.taken) > 0)
        .map((b) => ({
          key: b.leave_type,
          value: num(b.taken),
          color: '#8b5cf6',
        })),
    [balances]
  );

  const pageCount = Math.max(1, Math.ceil(applications.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageApps = applications.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const requestedDays = form.startDate && form.endDate && form.startDate <= form.endDate
    ? Math.max(1, Math.round((new Date(form.endDate).getTime() - new Date(form.startDate).getTime()) / 86400000) + 1)
    : null;

  return (
    <div>
      <PageHeader
        title="My Leave"
        subtitle="View leave balance, requests and leave history"
        actions={
          <button className="btn btn-primary" onClick={openApply}>
            Request Leave
          </button>
        }
      />

      {error ? (
        <div className="card" style={{ maxWidth: 480, margin: '2rem auto' }}>
          <div className="card-body">
            <div className="empty-state" style={{ padding: '0.5rem 0' }}>
              <div className="empty-state-icon" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                <Icon icon={Icons.Warning} size="xl" />
              </div>
              <div className="empty-state-title">Could not load leave data</div>
              <div className="empty-state-hint" style={{ textAlign: 'center' }}>{error}</div>
              <button type="button" className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => void load()}>
                Retry
              </button>
            </div>
          </div>
        </div>
      ) : loading ? (
        <>
          <div className="kpi-grid hrdash-kpi-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="hrdash-kpi">
                <span className="hrdash-kpi-icon">
                  <div className="skeleton skeleton-line" style={{ width: 20, height: 20, borderRadius: 8 }} />
                </span>
                <span className="hrdash-kpi-body">
                  <span className="hrdash-kpi-value">
                    <div className="skeleton skeleton-line" style={{ width: 52, height: 22 }} />
                  </span>
                  <span className="hrdash-kpi-label">
                    <div className="skeleton skeleton-line" style={{ width: 84, height: 12 }} />
                  </span>
                </span>
              </div>
            ))}
          </div>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="card" style={{ marginBottom: 12 }}>
              <div className="card-body">
                <div className="skeleton skeleton-line" style={{ width: `${70 - i * 15}%` }} />
                <div className="skeleton skeleton-line" style={{ width: `${45 - i * 10}%`, marginTop: 8 }} />
              </div>
            </div>
          ))}
        </>
      ) : (
        <>
          <div className="kpi-grid hrdash-kpi-grid">
            <div className="hrdash-kpi">
              <span className="hrdash-kpi-icon" style={{ background: '#8b5cf61f', color: '#8b5cf6' }}>
                <Icon icon={Icons.CalendarDays} size="lg" />
              </span>
              <span className="hrdash-kpi-body">
                <span className="hrdash-kpi-value">{balances.length ? `${totalLeave}d` : '—'}</span>
                <span className="hrdash-kpi-label">Total Leave Balance</span>
              </span>
            </div>
            <div className="hrdash-kpi">
              <span className="hrdash-kpi-icon" style={{ background: '#f59e0b1f', color: '#f59e0b' }}>
                <Icon icon={Icons.Hourglass} size="lg" />
              </span>
              <span className="hrdash-kpi-body">
                <span className="hrdash-kpi-value">{balances.length ? `${usedLeave}d` : '—'}</span>
                <span className="hrdash-kpi-label">Used</span>
              </span>
            </div>
            <div className="hrdash-kpi">
              <span className="hrdash-kpi-icon" style={{ background: '#0ea5e91f', color: '#0ea5e9' }}>
                <Icon icon={Icons.UserClock} size="lg" />
              </span>
              <span className="hrdash-kpi-body">
                <span className="hrdash-kpi-value">{applications.length ? pendingApps : '—'}</span>
                <span className="hrdash-kpi-label">Pending</span>
              </span>
            </div>
            <div className="hrdash-kpi">
              <span className="hrdash-kpi-icon" style={{ background: '#10b9811f', color: '#10b981' }}>
                <Icon icon={Icons.Check} size="lg" />
              </span>
              <span className="hrdash-kpi-body">
                <span className="hrdash-kpi-value">{applications.length ? approvedApps : '—'}</span>
                <span className="hrdash-kpi-label">Approved</span>
              </span>
            </div>
          </div>

          <div className="analytics-grid analytics-grid-wide" style={{ marginTop: 0 }}>
            <div>
              {balances.length === 0 ? (
                <div className="card">
                  <div className="card-body">
                    <div className="empty-state" style={{ padding: '0.5rem 0' }}>
                      <div className="empty-state-icon">
                        <Icon icon={Icons.CalendarDays} size="xl" />
                      </div>
                      <div className="empty-state-title">No leave balance found</div>
                      <div className="empty-state-hint" style={{ textAlign: 'center' }}>
                        Leave balances are published by HR at the start of the leave year.
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
                  {balances.map((b, i) => {
                    const total = num(b.total);
                    const taken = num(b.taken);
                    const due = num(b.due);
                    const pct = total > 0 ? Math.round((taken / total) * 100) : 0;
                    return (
                      <div key={`${b.leave_code}-${b.year}-${i}`} className="card" style={{ padding: 0, overflow: 'hidden' }}>
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
                          <strong style={{ fontSize: '0.95rem' }}>{b.leave_type}</strong>
                          <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>{b.year}</span>
                        </div>
                        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                            <span className="text-muted">Allocation</span>
                            <strong>{total}d</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                            <span className="text-muted">Used</span>
                            <strong>{taken}d</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                            <span className="text-muted">Remaining</span>
                            <strong style={{ color: '#8b5cf6' }}>{due}d</strong>
                          </div>
                          {total > 0 && (
                            <div style={{ marginTop: 2 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 4 }}>
                                <span className="text-muted">Used</span>
                                <strong>{pct}%</strong>
                              </div>
                              <div className="progress" style={{ height: 6 }}>
                                <div className="progress-bar" style={{ width: `${Math.min(100, pct)}%`, background: '#8b5cf6' }} />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <ChartCard
              title="Leave Utilization"
              subtitle="Days taken per leave type"
              loading={loading}
              empty={utilizationMix.length === 0}
              emptyMessage="No leave days taken yet."
            >
              <DonutChart data={utilizationMix} height={230} />
            </ChartCard>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">
              <div className="card-title">Leave Requests</div>
            </div>
            {applications.length === 0 ? (
              <div className="card-body">
                <div className="empty-state" style={{ padding: '1rem 0' }}>
                  <div className="empty-state-icon">
                    <Icon icon={Icons.CalendarDays} size="xl" />
                  </div>
                  <div className="empty-state-title">No leave requests found</div>
                  <div className="empty-state-hint" style={{ textAlign: 'center' }}>
                    Click Request Leave to apply for time off.
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="table-responsive">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Leave Type</th>
                        <th>From</th>
                        <th>To</th>
                        <th>Days</th>
                        <th>Reason</th>
                        <th>Status</th>
                        <th>Applied On</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageApps.map((a) => {
                        const days = a.requested_days != null && a.requested_days !== '' ? num(a.requested_days) : num(a.approved_days);
                        return (
                          <tr key={a.id}>
                            <td style={{ fontWeight: 600 }}>{String(a.leave_type_name ?? a.leave_type ?? '—')}</td>
                            <td>{safeDate(a.start_date)}</td>
                            <td>{safeDate(a.end_date)}</td>
                            <td>{days > 0 ? days : '—'}</td>
                            <td className="text-muted" style={{ maxWidth: 220 }}>{a.reason || '—'}</td>
                            <td>
                              <StatusBadge value={a.status} />
                            </td>
                            <td>{safeDate(a.created_at)}</td>
                            <td>
                              {a.status === 'pending' ? (
                                <button className="btn btn-sm btn-outline" onClick={() => void withdraw(a.id)}>
                                  Withdraw
                                </button>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {applications.length > PAGE_SIZE && (
                  <div className="pagination-bar" style={{ marginTop: 12 }}>
                    <span className="page-info">
                      Page {safePage} of {pageCount} • {applications.length} requests
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
          </div>
        </>
      )}

      <Modal
        open={modalOpen}
        title="Request Leave"
        onClose={() => setModalOpen(false)}
        onSubmit={() => void submit()}
        submitting={submitting}
        submitLabel="Submit Request"
        busyLabel="Submitting…"
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label form-required">Leave Type</label>
            <select
              className="form-control"
              value={form.leaveTypeId}
              onChange={(e) => {
                setForm({ ...form, leaveTypeId: e.target.value });
                setFieldErrors((prev) => ({ ...prev, leaveTypeId: '' }));
              }}
            >
              <option value="">Select leave type</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {fieldErrors.leaveTypeId && <div className="form-error-text">{fieldErrors.leaveTypeId}</div>}
          </div>
          <div className="form-group">
            <label className="form-label form-required">From Date</label>
            <input
              type="date"
              className="form-control"
              value={form.startDate}
              onChange={(e) => {
                setForm({ ...form, startDate: e.target.value });
                setFieldErrors((prev) => ({ ...prev, startDate: '' }));
              }}
            />
            {fieldErrors.startDate && <div className="form-error-text">{fieldErrors.startDate}</div>}
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label form-required">To Date</label>
            <input
              type="date"
              className="form-control"
              value={form.endDate}
              onChange={(e) => {
                setForm({ ...form, endDate: e.target.value });
                setFieldErrors((prev) => ({ ...prev, endDate: '' }));
              }}
            />
            {fieldErrors.endDate && <div className="form-error-text">{fieldErrors.endDate}</div>}
          </div>
          <div className="form-group">
            <label className="form-label">Leave Days</label>
            <div className="form-control" style={{ background: 'var(--surface-muted)', fontWeight: 600 }}>
              {requestedDays != null ? `${requestedDays} day${requestedDays === 1 ? '' : 's'}` : '—'}
            </div>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Reason</label>
          <textarea
            className="form-control"
            rows={4}
            style={{ minHeight: 90 }}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="Optional — tell your manager why you need this leave"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Hard Copy Attachment (optional)</label>
          <HardCopyDocumentUpload
            value={form.attachment}
            onChange={(v) => setForm({ ...form, attachment: v })}
            disabled={submitting}
          />
        </div>
        {formError && <div className="alert alert-danger">{formError}</div>}
      </Modal>
    </div>
  );
}