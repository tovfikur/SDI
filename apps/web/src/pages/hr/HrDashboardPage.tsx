import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { hr } from '../../api';
import type { HrDashboardData } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { ChartCard } from '../../components/charts/ChartCard';
import { AreaTrendChart, DonutChart, HorizontalBarChart, VerticalBarChart } from '../../components/charts/charts';
import { statusColor, PALETTE } from '../../components/charts/chartTheme';
import { formatStatusLabel } from '../../utils/statusLabels';
import { Icon, Icons } from '../../components/Icon';
import type { IconDefinition } from '../../components/Icon';
import { EmployeeAvatar } from '../../components/EmployeePhotoUpload';
import { usePermissions } from '../../auth-context';

const ATTN_COLORS = { present: '#10b981', late: '#f59e0b', absent: '#ef4444', leave: '#2563eb' };

interface KpiDef {
  key: KpiKey;
  label: string;
  icon: IconDefinition;
  to: string;
  accent: string;
  hint?: string;
}

const KPI_DEFS: KpiDef[] = [
  { key: 'totalActive', label: 'Total Active Employees', icon: Icons.Users, to: '/hr/employees', accent: 'var(--primary)' },
  { key: 'presentToday', label: 'Present Today', icon: Icons.Check, to: '/hr/attendance', accent: '#10b981', hint: 'Present + Late' },
  { key: 'lateToday', label: 'Late Today', icon: Icons.Clock, to: '/hr/attendance', accent: '#f59e0b' },
  { key: 'absentToday', label: 'Absent Today', icon: Icons.CalendarXmark, to: '/hr/attendance/missing', accent: '#ef4444', hint: 'Absent + Missing' },
  { key: 'onLeaveToday', label: 'On Leave Today', icon: Icons.CalendarDay, to: '/hr/leave', accent: '#8b5cf6' },
  { key: 'pendingLeaveRequests', label: 'Pending Leave Requests', icon: Icons.Hourglass, to: '/hr/leave/applications', accent: '#06b6d4' },
  { key: 'newHires30', label: 'New Hires · 30d', icon: Icons.UserPlus, to: '/hr/employees', accent: '#ec4899' },
];

type KpiKey =
  | 'totalActive'
  | 'presentToday'
  | 'lateToday'
  | 'absentToday'
  | 'onLeaveToday'
  | 'pendingLeaveRequests'
  | 'newHires30';

const formatMoney = (n: number | string): string =>
  Number(n ?? 0).toLocaleString(undefined, { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 });

const formatDate = (d: string | null | undefined): string =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString() : '—';

export function HrDashboardPage(): ReactElement {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [data, setData] = useState<HrDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hiresWindow, setHiresWindow] = useState<30 | 90 | 365>(30);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!data) setLoading(true);
      setError('');
      try {
        const res = await hr.dashboard({ hiresWindowDays: hiresWindow });
        if (!cancelled) setData(res.data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load HR dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [hiresWindow]);

  const openEmployee = (row: { id: string; full_name: string; employee_code: string; department_name?: string | null; position_name?: string | null; joining_date?: string | null }) => {
    navigate('/hr/employees', {
      state: {
        openEmployee: {
          id: row.id,
          full_name: row.full_name,
          employee_code: row.employee_code,
          department_name: row.department_name ?? null,
          position_name: row.position_name ?? null,
          joining_date: row.joining_date ?? null,
        },
      },
    });
  };

  const kpiValue = (key: KpiKey): number => data?.todayKpis[key] ?? 0;
  const byDepartment = (data?.workforce?.byDepartment as Array<{ id: string; name: string; n: number }>) ?? [];
  const byType = (data?.workforce?.byType as Array<{ id: string; name: string; n: number }>) ?? [];
  const joiners = (data?.workforce?.joiners as Array<{ month: string; n: number }>) ?? [];
  const attTrend = data?.attendanceTrend ?? [];
  const leaveStatus = data?.leaveOverview ?? [];
  const todayDept = data?.todayByDepartment ?? [];
  const maxDeptTotal = Math.max(1, ...todayDept.map((d) => d.total));
  const deptPct = (n: number): string => `${Math.round((n / maxDeptTotal) * 100)}%`;
  const hires = data?.hiresByPosition ?? [];

  return (
    <div>
      <PageHeader title="HR Dashboard" subtitle="Company-wide HR overview at a glance." />

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
                  <span className="hrdash-kpi-value">{kpiValue(def.key)}</span>
                  <span className="hrdash-kpi-label">{def.label}</span>
                  {def.hint && <span className="hrdash-kpi-hint">{def.hint}</span>}
                </span>
              </Link>
            ))}
          </div>

          <div className="hrdash-actions">
            {can('hr.employee.create') && (
              <Link className="btn-clay btn-clay-primary" to="/hr/employees/create">
                <Icon icon={Icons.UserPlus} /> Add Employee
              </Link>
            )}
            {can('hr.leave.view') && (
              <Link className="btn-clay" to="/hr/leave/applications">
                <Icon icon={Icons.CalendarDay} /> Review Leave
              </Link>
            )}
            {can('hr.attendance.view') && (
              <Link className="btn-clay" to="/hr/attendance">
                <Icon icon={Icons.Clock} /> Attendance
              </Link>
            )}
            {can('hr.notices.read') && (
              <Link className="btn-clay" to="/hr/notices">
                <Icon icon={Icons.Bullhorn} /> Publish Notice
              </Link>
            )}
          </div>

          <ChartCard
            title="Today's Department Attendance"
            subtitle="Present / Late / Absent / Leave per department — click a row to open filtered employees"
            loading={loading}
            empty={todayDept.length === 0}
            emptyMessage="No attendance recorded today yet."
            className="hrdash-span2"
          >
            <div className="hrdash-dept-legend">
              {(['present', 'late', 'absent', 'leave'] as const).map((k) => (
                <span key={k} className="chart-legend-item">
                  <span className="chart-legend-dot" style={{ background: ATTN_COLORS[k] }} />
                  <span className="chart-legend-label">{formatStatusLabel(k)}</span>
                  <span className="chart-legend-value">
                    {todayDept.reduce((s, d) => s + Number(d[k]), 0)}
                  </span>
                </span>
              ))}
            </div>
            <div className="hrdash-dept">
              {todayDept.map((d) => (
                <button
                  key={d.department_id || d.name}
                  type="button"
                  className="hrdash-dept-row"
                  onClick={() =>
                    d.department_id
                      ? navigate(`/hr/employees?departmentId=${encodeURIComponent(d.department_id)}`)
                      : navigate('/hr/employees')
                  }
                >
                  <span className="hrdash-dept-name" title={d.name}>
                    {d.name}
                  </span>
                  <span className="hrdash-dept-bar">
                    <span style={{ width: deptPct(d.present), background: ATTN_COLORS.present }} title={`Present ${d.present}`} />
                    <span style={{ width: deptPct(d.late), background: ATTN_COLORS.late }} title={`Late ${d.late}`} />
                    <span style={{ width: deptPct(d.absent), background: ATTN_COLORS.absent }} title={`Absent ${d.absent}`} />
                    <span style={{ width: deptPct(d.leave), background: ATTN_COLORS.leave }} title={`Leave ${d.leave}`} />
                  </span>
                  <span className="hrdash-dept-pct">{d.attendance_pct}%</span>
                </button>
              ))}
            </div>
          </ChartCard>

          <div className="analytics-grid analytics-grid-wide">
            <ChartCard
              title="Workforce by Department"
              subtitle="Headcount per department — click a bar to open filtered employees"
              loading={loading}
              empty={byDepartment.length === 0}
            >
              <HorizontalBarChart
                data={byDepartment.map((d) => ({ name: d.name, n: d.n }))}
                nameKey="name"
                valueKey="n"
                onBarClick={(entry) => {
                  const raw = byDepartment.find((d) => d.name === String(entry.name));
                  if (raw) navigate(`/hr/employees?departmentId=${encodeURIComponent(raw.id)}`);
                }}
              />
            </ChartCard>

            <ChartCard
              title="Workforce Composition"
              subtitle="Employment type distribution — click a segment to open filtered employees"
              loading={loading}
              empty={byType.length === 0}
            >
              <DonutChart
                data={byType.map((t, i) => ({ key: t.name, value: t.n, color: PALETTE[i % PALETTE.length] }))}
                onSliceClick={(entry) => {
                  const raw = byType.find((t) => t.name === String(entry));
                  if (raw) navigate(`/hr/employees?employeeTypeId=${encodeURIComponent(raw.id)}`);
                }}
              />
              <div className="chart-legend">
                {byType.map((t, i) => (
                  <button
                    key={t.name}
                    type="button"
                    className="chart-legend-item"
                    onClick={() => navigate(`/hr/employees?employeeTypeId=${encodeURIComponent(t.id)}`)}
                  >
                    <span className="chart-legend-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                    <span className="chart-legend-label">{t.name}</span>
                    <span className="chart-legend-value">{t.n}</span>
                  </button>
                ))}
              </div>
            </ChartCard>
          </div>

          <ChartCard
            title="Attendance Trend"
            subtitle="Last 30 days — present / late / absent / leave from actual attendance records"
            loading={loading}
            empty={attTrend.length === 0}
            className="hrdash-span2"
          >
            <AreaTrendChart
              data={attTrend}
              xKey="date"
              series={[
                { key: 'present', color: ATTN_COLORS.present },
                { key: 'late', color: ATTN_COLORS.late },
                { key: 'absent', color: ATTN_COLORS.absent },
                { key: 'leave', color: ATTN_COLORS.leave },
              ]}
              valueFormatter={(v) => `${v}`}
            />
            <div className="chart-legend">
              {[
                { key: 'present', color: ATTN_COLORS.present },
                { key: 'late', color: ATTN_COLORS.late },
                { key: 'absent', color: ATTN_COLORS.absent },
                { key: 'leave', color: ATTN_COLORS.leave },
              ].map((s) => (
                <span key={s.key} className="chart-legend-item">
                  <span className="chart-legend-dot" style={{ background: s.color }} />
                  <span className="chart-legend-label">{formatStatusLabel(s.key)}</span>
                </span>
              ))}
            </div>
          </ChartCard>

          <div className="analytics-grid">
            <ChartCard
              title="Employee Growth"
              subtitle="Monthly joiners over the last 12 months"
              loading={loading}
              empty={joiners.length === 0}
            >
              <AreaTrendChart
                data={joiners.map((j) => ({ month: j.month, n: j.n }))}
                xKey="month"
                series={[{ key: 'n', color: 'var(--primary)' }]}
                valueFormatter={(v) => `${v}`}
              />
            </ChartCard>

            <ChartCard
              title="Leave Overview"
              subtitle="Applications by status — click a segment to open leave"
              loading={loading}
              empty={leaveStatus.length === 0}
            >
              <DonutChart
                data={leaveStatus.map((s) => ({ key: s.status, value: s.n, color: statusColor(s.status) }))}
                onSliceClick={() => navigate('/hr/leave')}
              />
              <div className="chart-legend">
                {leaveStatus.map((s) => (
                  <button
                    key={s.status}
                    type="button"
                    className="chart-legend-item"
                    onClick={() => navigate('/hr/leave')}
                  >
                    <span className="chart-legend-dot" style={{ background: statusColor(s.status) }} />
                    <span className="chart-legend-label">{formatStatusLabel(s.status)}</span>
                    <span className="chart-legend-value">{s.n}</span>
                  </button>
                ))}
              </div>
            </ChartCard>
          </div>

          <div className="analytics-grid">
            <ChartCard
              title="New Hires by Position"
              subtitle={`Employees hired in the last ${hiresWindow} days, grouped by position`}
              loading={loading}
              empty={hires.length === 0}
              emptyMessage="No hires in this period yet."
              actions={
                <div className="hrdash-segmented">
                  {([30, 90, 365] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      className={hiresWindow === w ? 'hrdash-segmented-active' : ''}
                      onClick={() => setHiresWindow(w)}
                    >
                      {w}d
                    </button>
                  ))}
                </div>
              }
            >
              <VerticalBarChart
                data={hires.map((h) => ({ name: h.position_name, count: h.count }))}
                xKey="name"
                barKey="count"
                color="var(--primary)"
                onBarClick={() => navigate('/hr/employees')}
              />
            </ChartCard>

            <ChartCard
              title="Loan Recovery"
              subtitle="Active loans and installment recovery — click through to Loans"
              loading={loading}
              empty={data.loanRecovery.installment_count === 0 && data.loanRecovery.active_loans === 0}
              emptyMessage="No active loans."
            >
              <div className="hrdash-loan">
                <div className="hrdash-loan-stats">
                  <div className="hrdash-loan-stat">
                    <span className="hrdash-loan-label">Active Loan Amount</span>
                    <span className="hrdash-loan-value">{formatMoney(data.loanRecovery.active_amount)}</span>
                  </div>
                  <div className="hrdash-loan-stat">
                    <span className="hrdash-loan-label">Outstanding Balance</span>
                    <span className="hrdash-loan-value">{formatMoney(data.loanRecovery.outstanding)}</span>
                  </div>
                  <div className="hrdash-loan-stat">
                    <span className="hrdash-loan-label">Paid This Month</span>
                    <span className="hrdash-loan-value hrdash-loan-good">{formatMoney(data.loanRecovery.paid_this_month)}</span>
                  </div>
                  <div className="hrdash-loan-stat">
                    <span className="hrdash-loan-label">Overdue Installments</span>
                    <span className="hrdash-loan-value hrdash-loan-bad">
                      {data.loanRecovery.overdue_count}
                      {data.loanRecovery.overdue_count > 0 && <small> · {formatMoney(data.loanRecovery.overdue_amount)}</small>}
                    </span>
                  </div>
                </div>
                <div className="hrdash-progress">
                  <div className="hrdash-progress-head">
                    <span>Repayment progress</span>
                    <b>{data.loanRecovery.progress_pct}%</b>
                  </div>
                  <div className="hrdash-progress-track">
                    <div className="hrdash-progress-fill" style={{ width: `${data.loanRecovery.progress_pct}%` }} />
                  </div>
                  <div className="hrdash-progress-meta">
                    <span>Paid {formatMoney(data.loanRecovery.paid_total)}</span>
                    <span>of {formatMoney(data.loanRecovery.total_payable)}</span>
                  </div>
                </div>
                <Link className="hrdash-panel-link" to="/hr/loans">
                  Manage Loans <Icon icon={Icons.ChevronUp} />
                </Link>
              </div>
            </ChartCard>
          </div>

          <div className="analytics-grid">
            <ChartCard
              title="Pending Leave Requests"
              subtitle="Latest applications awaiting review"
              loading={loading}
              empty={data.pendingLeaves.items.length === 0}
              emptyMessage="No pending leave requests."
              actions={
                <Link className="hrdash-viewall" to="/hr/leave/applications">
                  View All ({data.pendingLeaves.total}) <Icon icon={Icons.ChevronUp} />
                </Link>
              }
            >
              <div className="hrdash-list">
                {data.pendingLeaves.items.map((a) => (
                  <button key={a.id} type="button" className="hrdash-item" onClick={() => openEmployee(a)}>
                    <span className="hrdash-item-main">
                      <span className="hrdash-item-title">
                        {a.full_name} <small>{a.employee_code}</small>
                      </span>
                      <span className="hrdash-item-sub">
                        {a.position_name} · {a.department_name}
                      </span>
                      <span className="hrdash-item-sub">
                        <StatusBadge value={a.leave_type} />
                      </span>
                    </span>
                    <span className="hrdash-item-meta">
                      <span className="hrdash-item-sub">
                        {formatDate(a.start_date)} → {formatDate(a.end_date)} ({a.requested_days}d)
                      </span>
                      {a.reason && (
                        <span className="hrdash-item-reason" title={a.reason}>
                          {a.reason}
                        </span>
                      )}
                      <span>
                        <StatusBadge value={a.status} />
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </ChartCard>

            <ChartCard
              title="Recent Hires"
              subtitle="Latest employees onboarded — click for the employee profile"
              loading={loading}
              empty={data.recentHires.length === 0}
              emptyMessage="No hires recorded yet."
            >
              <div className="hrdash-list">
                {data.recentHires.map((h) => (
                  <button key={h.id} type="button" className="hrdash-item" onClick={() => openEmployee(h)}>
                    <span className="hrdash-item-main">
                      <span className="hrdash-item-title">
                        <EmployeeAvatar fileId={h.photo_file_id} name={h.full_name} size={24} /> {h.full_name} <small>{h.employee_code}</small>
                      </span>
                      <span className="hrdash-item-sub">{h.position_name}</span>
                      <span className="hrdash-item-sub">{h.department_name}</span>
                    </span>
                    <span className="hrdash-item-meta">
                      <span className="hrdash-item-sub">
                        <Icon icon={Icons.UserPlus} size="xs" /> Joined {formatDate(h.joining_date)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </ChartCard>
          </div>

          <div className="analytics-grid">
            <ChartCard
              title="Employee Short Leave"
              subtitle="Latest short-leave requests — link to the Leave module"
              loading={loading}
              empty={data.shortLeaves.length === 0}
              emptyMessage="No short leaves yet."
              actions={
                <Link className="hrdash-viewall" to="/hr/leave/short-leaves">
                  View All <Icon icon={Icons.ChevronUp} />
                </Link>
              }
            >
              <div className="hrdash-list">
                {data.shortLeaves.slice(0, 6).map((s) => (
                  <button key={s.id} type="button" className="hrdash-item" onClick={() => openEmployee(s)}>
                    <span className="hrdash-item-main">
                      <span className="hrdash-item-title">
                        {s.full_name} <small>{s.employee_code}</small>
                      </span>
                      <span className="hrdash-item-sub">{s.department_name ?? '—'}</span>
                    </span>
                    <span className="hrdash-item-meta">
                      <span className="hrdash-item-sub">
                        <Icon icon={Icons.Clock} size="xs" /> {s.minutes} min · {formatDate(s.work_date)}
                      </span>
                      {s.reason && (
                        <span className="hrdash-item-reason" title={s.reason}>
                          {s.reason}
                        </span>
                      )}
                      <span>
                        <StatusBadge value={s.status} />
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </ChartCard>

            <ChartCard
              title="HR Attention"
              subtitle="Things that need action in the next 30 days"
              loading={loading}
              empty={
                data.attention.expiringContracts.length === 0 &&
                data.attention.upcomingBirthdays.length === 0 &&
                data.attention.upcomingAnniversaries.length === 0 &&
                data.attention.pendingAttendanceApprovals === 0
              }
              emptyMessage="Nothing needs attention right now."
            >
              <div className="hrdash-attn">
                {data.attention.expiringContracts.length > 0 && (
                  <div className="hrdash-attn-group">
                    <div className="hrdash-attn-head">
                      <Icon icon={Icons.Warning} size="sm" /> Contract{data.attention.expiringContracts.length > 1 ? 's' : ''} expiring soon ({data.attention.expiringContracts.length})
                    </div>
                    {data.attention.expiringContracts.slice(0, 4).map((i) => (
                      <button key={i.id} type="button" className="hrdash-attn-item" onClick={() => openEmployee(i)}>
                        <span>{i.full_name}</span>
                        <span>{formatDate(i.date)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {data.attention.upcomingBirthdays.length > 0 && (
                  <div className="hrdash-attn-group">
                    <div className="hrdash-attn-head">
                      <Icon icon={Icons.Cake} size="sm" /> Upcoming birthdays ({data.attention.upcomingBirthdays.length})
                    </div>
                    {data.attention.upcomingBirthdays.slice(0, 4).map((i) => (
                      <button key={i.id} type="button" className="hrdash-attn-item" onClick={() => openEmployee(i)}>
                        <span>{i.full_name}</span>
                        <span>{formatDate(i.date)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {data.attention.upcomingAnniversaries.length > 0 && (
                  <div className="hrdash-attn-group">
                    <div className="hrdash-attn-head">
                      <Icon icon={Icons.Star} size="sm" /> Work anniversaries ({data.attention.upcomingAnniversaries.length})
                    </div>
                    {data.attention.upcomingAnniversaries.slice(0, 4).map((i) => (
                      <button key={i.id} type="button" className="hrdash-attn-item" onClick={() => openEmployee(i)}>
                        <span>{i.full_name}</span>
                        <span>{formatDate(i.date)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {data.attention.pendingAttendanceApprovals > 0 && (
                  <Link className="hrdash-attn-approvals" to="/hr/attendance/pending">
                    <Icon icon={Icons.Clock} size="sm" /> Pending attendance approvals
                    <span className="hrdash-attn-count">{data.attention.pendingAttendanceApprovals}</span>
                  </Link>
                )}
              </div>
            </ChartCard>
          </div>



          <div className="panel-clay">
            <h3>Recent Notices</h3>
            {data.notices.length === 0 ? (
              <div className="data-table-state">No notices published yet.</div>
            ) : (
              data.notices.slice(0, 4).map((n) => (
                <div key={n.id} className="notice-card">
                  <div className="notice-card-title">
                    {n.title} <StatusBadge value={n.is_active ? 'active' : 'inactive'} />
                  </div>
                  <div className="notice-card-meta">{new Date(n.created_at).toLocaleString()}</div>
                  <div className="notice-card-body">{n.body}</div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}