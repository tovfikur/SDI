import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { payroll } from '../../api';
import type { PayrollDashboardData } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { ChartCard } from '../../components/charts/ChartCard';
import {
  AreaTrendChart,
  DonutChart,
  HorizontalBarChart,
  VerticalBarChart,
} from '../../components/charts/charts';

import { formatStatusLabel } from '../../utils/statusLabels';
import { Icon, Icons } from '../../components/Icon';
import { usePermissions } from '../../auth-context';

const formatMoney = (v: string | number): string =>
  Number(v ?? 0).toLocaleString(undefined, { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 });

const formatDate = (d: string | null | undefined): string =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString() : '—';

interface KpiDef {
  key: keyof Pick<PayrollDashboardData, 'month_net_total' | 'month_gross_total' | 'month_deductions_total' | 'year_net_total'>;
  label: string;
  icon: typeof Icons.Users;
  to: string;
  accent: string;
  hint?: string;
}

const KPI_DEFS: KpiDef[] = [
  {
    key: 'month_net_total',
    label: 'Net Pay',
    icon: Icons.Wallet,
    to: '/payroll/runs',
    accent: '#10b981',
    hint: 'Latest period',
  },
  {
    key: 'month_gross_total',
    label: 'Gross Pay',
    icon: Icons.MoneyBills,
    to: '/payroll/runs',
    accent: '#3b82f6',
    hint: 'Earnings before deductions',
  },
  {
    key: 'month_deductions_total',
    label: 'Total Deductions',
    icon: Icons.Calculator,
    to: '/payroll/reports',
    accent: '#ef4444',
    hint: 'Attendance + Leave + Loan',
  },
  {
    key: 'year_net_total',
    label: 'Year to Date Net',
    icon: Icons.ChartLine,
    to: '/payroll/reports',
    accent: '#8b5cf6',
    hint: 'Current fiscal year',
  },
];

export function PayrollDashboardPage(): ReactElement {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [data, setData] = useState<PayrollDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await payroll.dashboard();
        if (!cancelled) setData(res.data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load payroll dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const trend = (data?.month_trend ?? []).slice().reverse();
  const evd = (data?.earnings_vs_deductions ?? []).slice().reverse();
  const deptBreakdown = data?.department_breakdown ?? [];
  const paymentStatus = data?.payment_status ?? [];

  return (
    <div>
      <PageHeader
        title="Payroll Dashboard"
        subtitle="Payroll overview at a glance."
        actions={
          <>
            {can('payroll.run.create') && (
              <Link className="btn-clay btn-clay-primary" to="/payroll/runs/create">
                <Icon icon={Icons.Plus} /> Create Run
              </Link>
            )}
            {can('payroll.report') && (
              <Link className="btn-clay" to="/payroll/reports">
                <Icon icon={Icons.FileLines} /> Reports
              </Link>
            )}
            {can('payroll.payslip.view_all') && (
              <Link className="btn-clay" to="/payroll/payslips">
                <Icon icon={Icons.Receipt} /> Payslips
              </Link>
            )}
          </>
        }
      />

      {loading && <div className="data-table-state">Loading dashboard…</div>}
      {error && <div className="data-table-state data-table-error">{error}</div>}

      {!loading && !error && data && (
        <>
          <div className="kpi-grid hrdash-kpi-grid">
            {KPI_DEFS.map((def) => (
              <Link key={def.key} to={def.to} className="hrdash-kpi" style={{ textDecoration: 'none' }}>
                <span className="hrdash-kpi-icon" style={{ background: `${def.accent}1f`, color: def.accent }}>
                  <Icon icon={def.icon} size="lg" />
                </span>
                <span className="hrdash-kpi-body">
                  <span className="hrdash-kpi-value">{formatMoney(data[def.key])}</span>
                  <span className="hrdash-kpi-label">{def.label}</span>
                  {def.hint && <span className="hrdash-kpi-hint">{def.hint}</span>}
                </span>
              </Link>
            ))}
          </div>

          <div className="analytics-grid analytics-grid-wide">
            <ChartCard
              title="Monthly Net Pay Trend"
              subtitle="Net pay total per payroll month (calculated/approved/paid runs)"
              loading={loading}
              empty={trend.length === 0}
              emptyMessage="No payroll runs yet."
              className="hrdash-span2"
            >
              <AreaTrendChart
                data={trend}
                xKey="period"
                series={[
                  { key: 'net_total', color: '#10b981' },
                  { key: 'gross_total', color: '#3b82f6' },
                ]}
                height={260}
                valueFormatter={(v) => formatMoney(String(v))}
              />
              <div className="chart-legend">
                {[
                  { key: 'net_total', color: '#10b981', label: 'Net Pay' },
                  { key: 'gross_total', color: '#3b82f6', label: 'Gross Pay' },
                ].map((s) => (
                  <span key={s.key} className="chart-legend-item">
                    <span className="chart-legend-dot" style={{ background: s.color }} />
                    <span className="chart-legend-label">{s.label}</span>
                  </span>
                ))}
              </div>
            </ChartCard>
          </div>

          <div className="analytics-grid analytics-grid-wide">
            <ChartCard
              title="Earnings vs Deductions"
              subtitle="Total earnings and deductions per month"
              loading={loading}
              empty={evd.length === 0}
              emptyMessage="No payroll data yet."
            >
              <VerticalBarChart
                data={evd.map((d) => ({ ...d, earnings_total: Number(d.earnings_total), deductions_total: Number(d.deductions_total) }))}
                xKey="period"
                barKey="earnings_total"
                color="#3b82f6"
                height={250}
                valueFormatter={(v) => formatMoney(String(v))}
                onBarClick={() => navigate('/payroll/reports')}
              />
              <div className="chart-legend">
                <span className="chart-legend-item">
                  <span className="chart-legend-dot" style={{ background: '#3b82f6' }} />
                  <span className="chart-legend-label">Earnings</span>
                </span>
                <span className="chart-legend-item">
                  <span className="chart-legend-dot" style={{ background: '#ef4444' }} />
                  <span className="chart-legend-label">Deductions</span>
                </span>
              </div>
            </ChartCard>

            <ChartCard
              title="Deduction Breakdown"
              subtitle={`Latest period: ${data.latest_period ? formatDate(data.latest_period) : '—'}`}
              loading={loading}
              empty={data.month_deductions_total === '0'}
              emptyMessage="No deductions in latest period."
            >
              <DonutChart
                data={[
                  { key: 'Attendance', value: Number(data.month_attendance_deduction), color: '#f59e0b' },
                  { key: 'Unpaid Leave', value: Number(data.month_leave_deduction), color: '#ef4444' },
                  { key: 'Loan', value: Number(data.month_loan_deduction), color: '#8b5cf6' },
                  { key: 'Adjustments', value: Number(data.month_adjustment_deductions), color: '#06b6d4' },
                ].filter((d) => d.value > 0)}
                height={250}
                valueFormatter={(v) => formatMoney(String(v))}
              />
              <div className="chart-legend">
                {[
                  { key: 'Attendance', color: '#f59e0b', value: Number(data.month_attendance_deduction) },
                  { key: 'Unpaid Leave', color: '#ef4444', value: Number(data.month_leave_deduction) },
                  { key: 'Loan', color: '#8b5cf6', value: Number(data.month_loan_deduction) },
                  { key: 'Adjustments', color: '#06b6d4', value: Number(data.month_adjustment_deductions) },
                ]
                  .filter((d) => d.value > 0)
                  .map((d) => (
                    <span key={d.key} className="chart-legend-item">
                      <span className="chart-legend-dot" style={{ background: d.color }} />
                      <span className="chart-legend-label">{d.key}</span>
                      <span className="chart-legend-value">{formatMoney(d.value)}</span>
                    </span>
                  ))}
              </div>
            </ChartCard>
          </div>

          <div className="analytics-grid">
            <ChartCard
              title="Net Pay by Department"
              subtitle="Latest payroll period"
              loading={loading}
              empty={deptBreakdown.length === 0}
              emptyMessage="No department data for this period."
            >
              <HorizontalBarChart
                data={deptBreakdown.map((d) => ({ name: d.department_name, net_total: Number(d.net_total) }))}
                nameKey="name"
                valueKey="net_total"
                height={280}
                valueFormatter={(v) => formatMoney(String(v))}
                onBarClick={(entry) => {
                  const raw = deptBreakdown.find((d) => d.department_name === String(entry.name));
                  if (raw) navigate(`/payroll/reports?department=${encodeURIComponent(raw.department_name)}`);
                }}
              />
            </ChartCard>

            <ChartCard
              title="Payment Status"
              subtitle="Employees by payment status (latest period)"
              loading={loading}
              empty={paymentStatus.length === 0}
              emptyMessage="No payment data yet."
            >
              <DonutChart
                data={paymentStatus.map((p) => ({
                  key: formatStatusLabel(p.status),
                  value: p.employee_count,
                  color: p.status === 'paid' ? '#10b981' : '#f59e0b',
                }))}
                height={230}
                valueFormatter={(v) => `${v} employees`}
              />
              <div className="chart-legend">
                {paymentStatus.map((p) => (
                  <span key={p.status} className="chart-legend-item">
                    <span className="chart-legend-dot" style={{ background: p.status === 'paid' ? '#10b981' : '#f59e0b' }} />
                    <span className="chart-legend-label">{formatStatusLabel(p.status)}</span>
                    <span className="chart-legend-value">{p.employee_count} employees · {formatMoney(p.net_total)}</span>
                  </span>
                ))}
              </div>
            </ChartCard>
          </div>

          <div className="panel-clay">
            <h3>Current Run Status</h3>
            <div className="notice-card-meta">
              Period {data.latest_period ? formatDate(data.latest_period) : '—'} ·
              <StatusBadge value={data.latest_status ?? 'draft'} />
              {data.latest_status === 'calculated' && (
                <> — <Link className="btn-clay" to="/payroll/runs" style={{ marginLeft: 8, fontSize: 12 }}>Approve & Pay</Link></>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}