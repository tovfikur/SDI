import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { payroll } from '../../api';
import type { PayrollReportRow } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';

const bdt = (v: string | number): string =>
  Number(v).toLocaleString(undefined, { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 });

const REPORTS: Array<{ key: string; label: string }> = [
  { key: 'register', label: 'Payroll Register' },
  { key: 'salary-summary', label: 'Salary Summary' },
  { key: 'department-summary', label: 'Department Summary' },
  { key: 'component-summary', label: 'Component Summary' },
  { key: 'deduction-summary', label: 'Deduction Summary' },
  { key: 'payment-status', label: 'Payment Status' },
];

export function PayrollReportsPage(): ReactElement {
  const [kind, setKind] = useState('register');
  const [rows, setRows] = useState<PayrollReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('');
  const [status, setStatus] = useState('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    payroll
      .report(kind, {
        period: period || undefined,
        paymentStatus: status === 'all' ? undefined : status,
      })
      .then((res) => {
        if (!cancelled) {
          setRows(res.data);
          setError('');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, period, status]);

  const columns: DataColumn<PayrollReportRow>[] =
    rows.length > 0
      ? Object.keys(rows[0]).map((key) => ({
          key,
          header: key
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase()),
          align: /_total|_pay|_amount|_salary|_deduction|_earning|count$/i.test(key) ? 'right' : 'left',
          render: (r) => {
            const v = r[key];
            if (v === null || v === undefined) return <span>—</span>;
            if (key === 'payment_status' || key === 'status') {
              return <StatusBadge value={String(v)} />;
            }
            if (/_total|_pay|_amount|_salary|_deduction|_earning|_gross|_net$/i.test(key) && typeof v === 'number') {
              return <span>{bdt(v)}</span>;
            }
            return <span>{String(v)}</span>;
          },
        }))
      : [];

  return (
    <div>
      <PageHeader title="Payroll Reports" subtitle="Exportable payroll reports with period and status filters." />
      <div className="panel-clay">
        <div className="filter-row">
          {REPORTS.map((r) => (
            <button
              key={r.key}
              className={`btn-clay btn-clay-sm ${kind === r.key ? 'btn-clay-primary' : 'btn-clay-secondary'}`}
              onClick={() => setKind(r.key)}
            >
              {r.label}
            </button>
          ))}
          <div className="spacer" />
          <input
            className="form-input"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="Period"
          />
          <select className="form-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
          </select>
        </div>
        {error && <div className="alert-box alert-box-error" style={{ marginTop: 12 }}>{error}</div>}
        <div style={{ marginTop: 12 }}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => String(r.employee_id ?? `${Object.values(r).join('-')}`)}
            loading={loading}
            csvFilename={`payroll-${kind}-${period || 'all'}.csv`}
            excelFilename={`payroll-${kind}-${period || 'all'}.xlsx`}
            printable
            printTitle={`Payroll ${REPORTS.find((r) => r.key === kind)?.label ?? 'Report'} — ${period || 'All periods'}`}
            emptyMessage="No records for this report."
          />
        </div>
      </div>
    </div>
  );
}