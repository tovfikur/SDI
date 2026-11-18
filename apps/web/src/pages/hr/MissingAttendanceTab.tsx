import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { attendance } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';

interface Row {
  id: string;
  employee_code?: string;
  full_name?: string;
  work_date: string;
  status: string;
  first_in?: string | null;
  last_out?: string | null;
}

export function MissingAttendanceTab(): ReactElement {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await attendance.missing();
      const payload = res.data as unknown;
      setRows(Array.isArray(payload) ? (payload as Row[]) : ((payload as { items?: Row[] })?.items ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load missing attendance');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: DataColumn<Row>[] = [
    { key: 'employee_code', header: 'ID', render: (r) => <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{r.employee_code ?? '—'}</span> },
    { key: 'full_name', header: 'Employee', render: (r) => <strong>{r.full_name ?? '—'}</strong> },
    { key: 'work_date', header: 'Date', render: (r) => new Date(r.work_date).toLocaleDateString() },
    { key: 'status', header: 'Status', align: 'center', render: (r) => <StatusBadge value={r.status} /> },
  ];

  return (
    <div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        csvFilename="missing-attendance.csv"
        excelFilename="missing-attendance.xls"
        printable
        emptyMessage="No missing attendance records. All days are accounted for."
      />
    </div>
  );
}