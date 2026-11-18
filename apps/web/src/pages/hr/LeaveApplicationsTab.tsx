import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { getCurrentUserId, hr, leave } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { ChartCard } from '../../components/charts/ChartCard';
import { DonutChart, HorizontalBarChart } from '../../components/charts/charts';
import { statusColor } from '../../components/charts/chartTheme';
import { formatStatusLabel } from '../../utils/statusLabels';
import { usePermissions, useCurrentUser } from '../../auth-context';
import { HardCopyDocumentUpload, LeaveAttachmentView } from '../../components/HardCopyDocumentUpload';
import type { LeaveAttachmentFile } from '../../components/HardCopyDocumentUpload';

interface Row {
  id: string;
  employee_id: string;
  employee_name?: string;
  leave_type_id: string;
  leave_type_name?: string;
  start_date: string;
  end_date: string;
  requested_days: number;
  approved_days: number | null;
  reason: string | null;
  status: string;
  manager_comment?: string | null;
  hard_copy?: boolean;
  attachment_file_id?: string | null;
  attachment_filename?: string | null;
}

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

export function LeaveApplicationsTab(): ReactElement {
  const { can } = usePermissions();
  const user = useCurrentUser();
  const canManageEmployees = can('hr.employee.view');
  const [rows, setRows] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    employeeId: '',
    leaveTypeId: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    reason: '',
    hardCopy: false,
  });
  const [attachment, setAttachment] = useState<LeaveAttachmentFile | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [processTarget, setProcessTarget] = useState<Row | null>(null);
  const [approveDays, setApproveDays] = useState('');
  const [comment, setComment] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [byStatus, setByStatus] = useState<Array<{ status: string; n: number }>>([]);
  const [byType, setByType] = useState<Array<{ name: string; n: number }>>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await leave.applications({
        page,
        perPage,
        ...(statusFilter ? { 'filter[status]': statusFilter } : {}),
        ...(typeFilter ? { 'filter[leave_type_id]': typeFilter } : {}),
      });
      const data = res.data as { items: Row[]; total: number };
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leave applications');
    } finally {
      setLoading(false);
    }
  }, [page, perPage]);

  const loadLookups = useCallback(async () => {
    try {
      // Self-service users cannot list employees — the backend scopes to their
      // own profile, so only staff need the employee dropdown.
      if (!canManageEmployees) {
        const t = await leave.types();
        setTypes((t.data as { items: unknown[] }).items as { id: string; name: string }[]);
        return;
      }
      const [e, t] = await Promise.all([hr.employees({ perPage: 100 }), leave.types()]);
      setEmployees((e.data as { items: Employee[] }).items);
      setTypes((t.data as { items: unknown[] }).items as { id: string; name: string }[]);
    } catch {
      /* optional */
    }
  }, [canManageEmployees]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    let cancelled = false;
    async function fetchAnalytics() {
      setAnalyticsLoading(true);
      try {
        const res = await leave.analytics();
        const d = res.data as {
          byStatus: Array<{ status: string; n: number }>;
          byType: Array<{ name: string; n: number }>;
        };
        if (!cancelled) {
          setByStatus(d.byStatus ?? []);
          setByType(d.byType ?? []);
        }
      } catch {
        /* optional */
      }
      if (!cancelled) setAnalyticsLoading(false);
    }
    void fetchAnalytics();
    return () => {
      cancelled = true;
    };
  }, []);

  const apply = async () => {
    if (!form.employeeId || !form.leaveTypeId || !form.startDate || !form.endDate) {
      setFormError('Employee, leave type, start and end dates are required');
      return;
    }
    if (form.hardCopy && !attachment) {
      setFormError('Please upload the required document before applying.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await leave.createApplication({
        ...form,
        attachmentFileId: attachment?.file_id,
      });
      setModalOpen(false);
      setNotice('Leave application submitted.');
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to submit application');
    } finally {
      setSubmitting(false);
    }
  };

  const process = async (approve: boolean) => {
    if (!processTarget) return;
    setSubmitting(true);
    setError('');
    try {
      const userId = (await getCurrentUserId()) ?? '00000000-0000-0000-0000-000000000000';
      if (approve) {
        await leave.approve(processTarget.id, {
          userId,
          approvedDays: approveDays ? Number(approveDays) : undefined,
          comment: comment || undefined,
        });
      } else {
        await leave.reject(processTarget.id, { userId, comment: comment || undefined });
      }
      setProcessTarget(null);
      setNotice(approve ? 'Leave approved.' : 'Leave rejected.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to process leave');
      setProcessTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async (row: Row) => {
    try {
      await leave.withdraw(row.id, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to withdraw leave');
    }
  };

  const columns: DataColumn<Row>[] = [
    {
      key: 'employee_name',
      header: 'Employee',
      sortable: true,
      render: (r) => (
        <strong>
          {r.employee_name ?? employees.find((e) => e.id === r.employee_id)?.full_name ?? '—'}
        </strong>
      ),
    },
    {
      key: 'leave_type_name',
      header: 'Leave Type',
      render: (r) => r.leave_type_name ?? types.find((t) => t.id === r.leave_type_id)?.name ?? '—',
    },
    {
      key: 'start_date',
      header: 'Start',
      sortable: true,
      render: (r) => new Date(r.start_date).toLocaleDateString(),
    },
    {
      key: 'end_date',
      header: 'End',
      sortable: true,
      render: (r) => new Date(r.end_date).toLocaleDateString(),
    },
    { key: 'requested_days', header: 'Days', align: 'center', sortable: true },
    {
      key: 'approved_days',
      header: 'Approved',
      align: 'center',
      render: (r) => r.approved_days ?? '—',
    },
    { key: 'reason', header: 'Reason', render: (r) => r.reason ?? '—' },
    {
      key: 'hard_copy',
      header: 'Hard Copy',
      align: 'center',
      render: (r) => (r.hard_copy ? 'Yes' : 'No'),
    },
    {
      key: 'attachment',
      header: 'Attachment',
      align: 'center',
      render: (r) =>
        r.attachment_file_id ? (
          <LeaveAttachmentView fileId={r.attachment_file_id} filename={r.attachment_filename} />
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      render: (r) => <StatusBadge value={r.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) =>
        r.status === 'pending' ? (
          <div className="data-table-actions">
            {can('hr.leave.approve') && (
              <button
                className="btn-clay btn-clay-sm btn-clay-success"
                onClick={() => {
                  setProcessTarget(r);
                  setApproveDays(String(r.requested_days));
                  setComment('');
                }}
              >
                Approve
              </button>
            )}
            {can('hr.leave.approve') && (
              <button
                className="btn-clay btn-clay-sm btn-clay-danger"
                onClick={() => {
                  setProcessTarget(r);
                  setApproveDays('');
                  setComment('');
                }}
              >
                Reject
              </button>
            )}
          </div>
        ) : r.status === 'submitted' ? (
          <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => withdraw(r)}>
            Withdraw
          </button>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div>
      {notice && (
        <div
          className="form-help-text"
          style={{ color: 'var(--clay-success)', marginBottom: '0.5rem' }}
        >
          {notice}
        </div>
      )}
      <div className="analytics-grid analytics-grid-wide">
        <ChartCard
          title="Applications by Status"
          subtitle="This year — click a segment or chip to filter the table"
          loading={analyticsLoading}
          empty={byStatus.length === 0}
        >
          <DonutChart
            data={byStatus.map((t) => ({ key: t.status, value: t.n, color: statusColor(t.status) }))}
            onSliceClick={(key) => setStatusFilter(statusFilter === key ? '' : key)}
          />
          <div className="chart-legend">
            {byStatus.map((t) => (
              <button
                key={t.status}
                type="button"
                className="chart-legend-item"
                style={
                  statusFilter === t.status
                    ? { borderColor: 'var(--primary)', color: 'var(--primary)', background: 'var(--brand-soft)' }
                    : undefined
                }
                onClick={() => setStatusFilter(statusFilter === t.status ? '' : t.status)}
              >
                <span className="chart-legend-dot" style={{ background: statusColor(t.status) }} />
                <span className="chart-legend-label">{formatStatusLabel(t.status)}</span>
                <span className="chart-legend-value">{t.n}</span>
              </button>
            ))}
          </div>
        </ChartCard>

        <ChartCard
          title="Applications by Type"
          subtitle="This year — click a bar to filter by leave type"
          loading={analyticsLoading}
          empty={byType.length === 0}
        >
          <HorizontalBarChart
            data={byType}
            nameKey="name"
            valueKey="n"
            onBarClick={(entry) => {
              const raw = byType.find((t) => t.name === String(entry.name));
              if (!raw) return;
              const match = types.find((t) => t.name === raw.name);
              setTypeFilter(typeFilter === match?.id ? '' : (match?.id ?? ''));
            }}
          />
        </ChartCard>
      </div>

      {(statusFilter || typeFilter) && (
        <div style={{ marginBottom: '0.75rem' }}>
          {statusFilter && (
            <button type="button" className="chart-legend-item" onClick={() => setStatusFilter('')}>
              Status: <strong>{formatStatusLabel(statusFilter)}</strong> &times;
            </button>
          )}
          {typeFilter && (
            <button type="button" className="chart-legend-item" onClick={() => setTypeFilter('')}>
              Type: <strong>{types.find((t) => t.id === typeFilter)?.name ?? typeFilter}</strong> &times;
            </button>
          )}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        page={page}
        perPage={perPage}
        total={total}
        onPageChange={setPage}
        onPerPageChange={(p) => {
          setPerPage(p);
          setPage(1);
        }}
        csvFilename="leave-applications.csv"
        excelFilename="leave-applications.xls"
        printable
        toolbarExtra={
          <button
            className="btn-clay btn-clay-primary btn-clay-sm"
            onClick={() => {
              setFormError('');
              setAttachment(null);
              setForm((f) => ({
                ...f,
                employeeId: canManageEmployees ? f.employeeId : (user?.employeeId ?? ''),
              }));
              setModalOpen(true);
            }}
          >
            + New Application
          </button>
        }
        emptyMessage="No leave applications yet."
      />

      <Modal
        title="New Leave Application"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={apply}
        submitting={submitting}
        submitLabel="Apply"
        wide
      >
        <div className="form-row">
          {canManageEmployees && (
            <div className="form-group">
              <label className="form-label">
                Employee <span className="form-required">*</span>
              </label>
              <select
                className="form-control-clay"
                value={form.employeeId}
                onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              >
                <option value="">— Select employee —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name} ({e.employee_code})
                  </option>
                ))}
              </select>
            </div>
          )}
          {!canManageEmployees && (
            <div className="form-group">
              <label className="form-label">Employee</label>
              <input className="form-control-clay" value={user?.fullName ?? ''} disabled />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">
              Leave Type <span className="form-required">*</span>
            </label>
            <select
              className="form-control-clay"
              value={form.leaveTypeId}
              onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}
            >
              <option value="">— Select type —</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Start Date <span className="form-required">*</span>
            </label>
            <input
              type="date"
              className="form-control-clay"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              End Date <span className="form-required">*</span>
            </label>
            <input
              type="date"
              className="form-control-clay"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Reason</label>
          <textarea
            className="form-control-clay"
            rows={3}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label form-inline-flex" style={{ gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={form.hardCopy}
              onChange={(e) => setForm({ ...form, hardCopy: e.target.checked })}
            />
            Submit hard copy
          </label>
        </div>
        {form.hardCopy && (
          <div className="form-group">
            <label className="form-label">
              Document <span className="form-required">*</span>
            </label>
            <HardCopyDocumentUpload value={attachment} onChange={setAttachment} />
          </div>
        )}
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>

      <Modal
        title={processTarget?.status === 'pending' ? 'Approve / Reject Leave' : 'Process Leave'}
        open={processTarget !== null}
        onClose={() => setProcessTarget(null)}
        onSubmit={() => process(true)}
        submitting={submitting}
        submitLabel="Approve"
        footer={
          <>
            <button className="btn-clay btn-clay-secondary" onClick={() => setProcessTarget(null)}>
              Cancel
            </button>
            <button
              className="btn-clay btn-clay-danger"
              onClick={() => process(false)}
              disabled={submitting}
            >
              Reject
            </button>
            <button
              className="btn-clay btn-clay-primary"
              onClick={() => process(true)}
              disabled={submitting}
            >
              Approve
            </button>
          </>
        }
      >
        <p>
          Process leave for <strong>{processTarget?.employee_name ?? 'employee'}</strong> (
          {processTarget?.requested_days} days requested)?
        </p>
        {processTarget?.attachment_file_id && (
          <div className="form-group">
            <label className="form-label">Attachment</label>
            <LeaveAttachmentView
              fileId={processTarget.attachment_file_id}
              filename={processTarget.attachment_filename}
            />
          </div>
        )}
        <div className="form-group">
          <label className="form-label">Approved Days</label>
          <input
            type="number"
            min={0}
            className="form-control-clay"
            value={approveDays}
            onChange={(e) => setApproveDays(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Manager Comment</label>
          <textarea
            className="form-control-clay"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
