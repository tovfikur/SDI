import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { attendance, getCurrentUserId } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';

interface Row {
  id: string;
  employee_code?: string;
  full_name?: string;
  work_date: string;
  status: string;
  reason?: string;
}

export function PendingAttendanceTab(): ReactElement {
  const { can } = usePermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<Row | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await attendance.pending();
      const payload = res.data as unknown;
      setRows(
        Array.isArray(payload) ? (payload as Row[]) : ((payload as { items?: Row[] })?.items ?? [])
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pending attendance');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const process = async (approve: boolean) => {
    if (!target) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const userId = (await getCurrentUserId()) ?? '00000000-0000-0000-0000-000000000000';
      if (approve) {
        await attendance.approvePending(target.id, { userId });
      } else {
        await attendance.rejectPending(target.id, { userId });
      }
      setTarget(null);
      setNotice(approve ? 'Attendance approved.' : 'Attendance rejected.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to process attendance');
      setTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    {
      key: 'employee_code',
      header: 'ID',
      render: (r) => (
        <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{r.employee_code ?? '—'}</span>
      ),
    },
    { key: 'full_name', header: 'Employee', render: (r) => <strong>{r.full_name ?? '—'}</strong> },
    { key: 'work_date', header: 'Date', render: (r) => new Date(r.work_date).toLocaleDateString() },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      render: (r) => <StatusBadge value={r.status} />,
    },
    { key: 'reason', header: 'Reason', render: (r) => r.reason ?? '—' },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <div className="data-table-actions">
          {can('hr.attendance.approve') && (
            <button className="btn-clay btn-clay-sm btn-clay-success" onClick={() => setTarget(r)}>
              Approve
            </button>
          )}
          {can('hr.attendance.approve') && (
            <button className="btn-clay btn-clay-sm btn-clay-danger" onClick={() => setTarget(r)}>
              Reject
            </button>
          )}
        </div>
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
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        csvFilename="pending-attendance.csv"
        excelFilename="pending-attendance.xls"
        printable
        emptyMessage="No pending attendance requests."
      />
      <Modal
        title="Process Pending Attendance"
        open={target !== null}
        onClose={() => setTarget(null)}
        onSubmit={() => process(true)}
        submitting={submitting}
        submitLabel="Approve"
        footer={
          <>
            <button className="btn-clay btn-clay-secondary" onClick={() => setTarget(null)}>
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
          Approve or reject the pending attendance for <strong>{target?.full_name}</strong> on{' '}
          {target ? new Date(target.work_date).toLocaleDateString() : ''}?
        </p>
      </Modal>
    </div>
  );
}
