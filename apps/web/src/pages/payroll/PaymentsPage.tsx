import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { payroll } from '../../api';
import type { PayrollReportRow } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';

const bdt = (v: string | number): string =>
  Number(v).toLocaleString(undefined, { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 });

const STATUSES = ['all', 'paid', 'unpaid'];

export function PaymentsPage(): ReactElement {
  const [rows, setRows] = useState<PayrollReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('all');
  const [period, setPeriod] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    payroll
      .report('payment-status', {
        period: period || undefined,
        paymentStatus: status === 'all' ? undefined : status,
      })
      .then((res) => {
        if (!cancelled) {
          setRows(res.data);
          setError('');
          setPage(1);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load payments');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, period]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          !search ||
          String(r.employee_code ?? '').toLowerCase().includes(search.toLowerCase()) ||
          String(r.employee_name ?? '').toLowerCase().includes(search.toLowerCase())
      ),
    [rows, search]
  );

  const sliced = useMemo(
    () => filtered.slice((page - 1) * perPage, page * perPage),
    [filtered, page, perPage]
  );

  const columns: DataColumn<PayrollReportRow>[] = [
    { key: 'employee_code', header: 'Employee ID' },
    { key: 'employee_name', header: 'Employee' },
    {
      key: 'department_name',
      header: 'Department',
      render: (r) => r.department_name ?? <span className="muted-text">—</span>,
    },
    { key: 'net_pay', header: 'Net Pay', align: 'right', render: (r) => bdt(Number(r.net_pay ?? 0)) },
    {
      key: 'payment_status',
      header: 'Status',
      align: 'center',
      render: (r) => (
        <span className={r.payment_status === 'paid' ? 'badge-clay badge-clay-success' : 'badge-clay badge-clay-warning'}>
          {r.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
        </span>
      ),
    },
    {
      key: 'paid_at',
      header: 'Payment Date',
      render: (r) => (r.paid_at ? String(r.paid_at).slice(0, 10) : <span>—</span>),
    },
    {
      key: 'payment_reference',
      header: 'Reference',
      render: (r) => (r.payment_reference ? String(r.payment_reference) : <span>—</span>),
    },
  ];

  const totalNet = filtered.reduce((sum, r) => sum + Number(r.net_pay ?? 0), 0);
  const paidCount = filtered.filter((r) => r.payment_status === 'paid').length;

  return (
    <div>
      <PageHeader title="Payments" subtitle="Payment status across payroll periods." />
      <div className="panel-clay">
        <div className="filter-row">
          <select className="form-control-clay" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All payment statuses' : s === 'paid' ? 'Paid only' : 'Unpaid only'}
              </option>
            ))}
          </select>
          <input
            className="form-control-clay"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="Period"
          />
          <input
            className="form-control-clay"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee..."
          />
          <div className="spacer" />
          <div className="payment-summary">
            <span className="badge-clay badge-clay-success">{paidCount} paid</span>
            <span className="badge-clay badge-clay-info">{bdt(totalNet)} total</span>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <DataTable
            columns={columns}
            rows={sliced}
            rowKey={(r) => String(r.employee_id ?? `${r.employee_code ?? ''}-${r.period ?? ''}`)}
            loading={loading}
            error={error}
            page={page}
            perPage={perPage}
            total={filtered.length}
            onPageChange={setPage}
            onPerPageChange={(pp) => {
              setPerPage(pp);
              setPage(1);
            }}
            csvFilename={`payments-${period || 'all'}.csv`}
            excelFilename={`payments-${period || 'all'}.xlsx`}
            printable
            emptyMessage="No payment records found."
          />
        </div>
      </div>
    </div>
  );
}