import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { hr, projects, leave, fieldTracking, payroll, attendance } from '../../api';
import type { FieldTrackingStatusData, WorkLogRow } from '../../api';
import { Icon, Icons } from '../../components/Icon';
import type { IconDefinition } from '../../components/Icon';
import { useCurrentUser } from '../../auth-context';
import { StatusBadge } from '../../components/StatusBadge';
import { PageHeader } from '../../components/PageHeader';
import { ChartCard } from '../../components/charts/ChartCard';
import { DonutChart, HorizontalBarChart, VerticalBarChart } from '../../components/charts/charts';
import { statusColor } from '../../components/charts/chartTheme';
import { useToast } from '../../components/Toast';
import { acquireBestPosition, captureFailureMessage, punchErrorMessage } from '../hr/useFieldTracking';

interface KpiDef {
  key: string;
  label: string;
  icon: IconDefinition;
  accent: string;
  to: string;
  permission?: string;
}

const KPI_DEFS: KpiDef[] = [
  { key: 'projects', label: 'My Projects', icon: Icons.Briefcase, accent: '#6366f1', to: '/me/projects' },
  { key: 'tasks', label: 'My Tasks', icon: Icons.ListCheck, accent: '#0ea5e9', to: '/me/tasks' },
  { key: 'todayHours', label: 'Hours Today', icon: Icons.Clock, accent: '#10b981', to: '/me/worklog' },
  { key: 'weekHours', label: 'Hours This Week', icon: Icons.CalendarDays, accent: '#f59e0b', to: '/me/worklog' },
  { key: 'leave', label: 'Leave Available', icon: Icons.CalendarMinus, accent: '#8b5cf6', to: '/me/leave' },
  { key: 'payslips', label: 'Payslips', icon: Icons.FileInvoiceDollar, accent: '#ec4899', to: '/me/payslips' },
];

interface StatusRow {
  status: string;
  n: number;
}

export function EmployeeDashboardPage(): ReactElement {
  const user = useCurrentUser();
  const { toast } = useToast();
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [taskRows, setTaskRows] = useState<Array<{ status: string }>>([]);
  const [projectCount, setProjectCount] = useState(0);
  const [worklogRows, setWorklogRows] = useState<WorkLogRow[]>([]);
  const [worklogSummary, setWorklogSummary] = useState<{ today_hours: number; week_hours: number; pending: number } | null>(null);
  const [leaveBalance, setLeaveBalance] = useState<Array<Record<string, unknown>>>([]);
  const [status, setStatus] = useState<FieldTrackingStatusData | null>(null);
  const [payslipCount, setPayslipCount] = useState(0);
  const [todayAttendance, setTodayAttendance] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [meRes, tasksRes, projectsRes, worklogRes, summaryRes, leaveRes, statusRes, payslipsRes, daysRes] =
        await Promise.allSettled([
          hr.me(),
          projects.tasks({ perPage: 100 }),
          projects.list({ perPage: 1 }),
          projects.dailyTasks({ perPage: 100 }),
          projects.dailyTasksSummary(),
          leave.balances({}),
          fieldTracking.myStatus(),
          payroll.payslips({ perPage: 1 }),
          attendance.dailyLog({ perPage: 1 }),
        ]);
      if (meRes.status === 'fulfilled') setProfile(meRes.value.data);
      if (tasksRes.status === 'fulfilled') setTaskRows((tasksRes.value.data as { items: Array<{ status: string }> }).items);
      if (projectsRes.status === 'fulfilled') setProjectCount((projectsRes.value.data as { total: number }).total);
      if (worklogRes.status === 'fulfilled') {
        // Endpoint may return an array or a paginated envelope depending on
        // permissions — always normalize to an array.
        const raw = worklogRes.value.data as unknown;
        setWorklogRows(
          Array.isArray(raw)
            ? (raw as WorkLogRow[])
            : ((raw as { items?: WorkLogRow[] })?.items ?? [])
        );
      }
      if (summaryRes.status === 'fulfilled') setWorklogSummary(summaryRes.value.data);
      if (leaveRes.status === 'fulfilled') setLeaveBalance(leaveRes.value.data as Array<Record<string, unknown>>);
      if (statusRes.status === 'fulfilled') setStatus(statusRes.value.data);
      if (payslipsRes.status === 'fulfilled') setPayslipCount((payslipsRes.value.data as { total: number }).total);
      if (daysRes.status === 'fulfilled') {
        const days = daysRes.value.data as { items: Array<Record<string, unknown>> };
        const today = new Date().toISOString().slice(0, 10);
        setTodayAttendance(days.items.find((d) => String(d.work_date ?? '') === today) ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const checkIn = async () => {
    setBusy(true);
    try {
      const res = await acquireBestPosition();
      if (!res.position) {
        toast(captureFailureMessage(res.reason), 'error');
        return;
      }
      const pos = res.position;
      await fieldTracking.checkIn({
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy: pos.accuracy ?? null,
        capturedAt: pos.capturedAt,
      });
      toast('Checked in successfully.', 'success');
      void load();
    } catch (e) {
      toast(punchErrorMessage(e, 'in'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const checkedIn = status?.checkedIn === true;
  const insideGeofence = status?.geofence
    ? status.geofence.status === 'inside' || status.geofence.inside === true
    : null;

  const leaveTaken = leaveBalance.reduce((sum, r) => sum + (Number(r.taken) || 0), 0);
  const leaveAvailable = leaveBalance.reduce((sum, r) => sum + (Number(r.due) || 0), 0);
  void leaveTaken;

  const taskStatusMix = useMemo<StatusRow[]>(() => {
    const counts = new Map<string, number>();
    for (const t of taskRows) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
    return [...counts.entries()].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n);
  }, [taskRows]);

  const weeklyTrend = useMemo<Array<Record<string, unknown>>>(() => {
    const days: Array<{ day: string; iso: string; hours: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({
        day: d.toLocaleDateString(undefined, { weekday: 'short' }),
        iso: d.toISOString().slice(0, 10),
        hours: 0,
      });
    }
    for (const row of worklogRows) {
      const wd = String(row.work_date ?? '');
      const idx = days.findIndex((d) => d.iso === wd);
      if (idx >= 0) days[idx].hours += Number(row.hours ?? 0);
    }
    return days.map(({ day, hours }) => ({ day, hours }));
  }, [worklogRows]);

  const kpiValue = (key: string): string => {
    switch (key) {
      case 'projects':
        return String(projectCount);
      case 'tasks':
        return String(taskRows.length);
      case 'todayHours':
        return worklogSummary ? `${worklogSummary.today_hours ?? 0}h` : '—';
      case 'weekHours':
        return worklogSummary ? `${worklogSummary.week_hours ?? 0}h` : '—';
      case 'leave':
        return `${leaveAvailable}d`;
      case 'payslips':
        return String(payslipCount);
      default:
        return '—';
    }
  };

  const donutData = taskStatusMix.map((s) => ({ key: s.status, value: s.n, color: statusColor(s.status) }));

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${String(profile?.full_name ?? user?.fullName ?? '')}`}
        subtitle="Here is what is happening with your work today."
        actions={
          <Link to="/me/attendance" className="btn btn-outline">
            <Icon icon={Icons.UserClock} /> My Attendance
          </Link>
        }
      />

      {loading && <div className="data-table-state">Loading dashboard…</div>}
      {error && <div className="data-table-state data-table-error">{error}</div>}

      {!loading && !error && (
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
                </span>
              </Link>
            ))}
          </div>

          <div className="analytics-grid analytics-grid-wide">
            <ChartCard
              title="My Task Status"
              subtitle="Breakdown of tasks assigned to you"
              loading={loading}
              empty={donutData.length === 0}
              emptyMessage="No tasks assigned yet."
            >
              <DonutChart
                data={donutData}
                valueFormatter={(v) => `${v} tasks`}
                onSliceClick={(key) => {
                  window.location.href = `/me/tasks?status=${key}`;
                }}
              />
            </ChartCard>

            <ChartCard
              title="My Attendance Today"
              subtitle="Current check-in status"
              loading={loading}
            >
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                {!checkedIn ? (
                  <button
                    className={`checkin-circle-btn${insideGeofence === false ? ' is-outside-geofence' : ''}`}
                    onClick={() => void checkIn()}
                    disabled={busy}
                    title="Check In"
                    aria-label="Check In"
                    style={{ margin: '0 auto 12px' }}
                  >
                    {busy ? <span className="checkin-circle-spinner" /> : <Icon icon={Icons.RightToBracket} size="xl" />}
                    {busy ? 'Locating...' : 'Check In'}
                  </button>
                ) : (
                  <div
                    style={{
                      width: 132,
                      height: 132,
                      margin: '0 auto 12px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(16,185,129,0.14)',
                      color: '#10b981',
                    }}
                  >
                    <Icon icon={Icons.UserClock} size="2xl" />
                  </div>
                )}
                <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>
                  {checkedIn ? 'You are on duty' : 'Tap the button to check in'}
                </div>
                {checkedIn && status?.session && (
                  <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                    Since{' '}
                    {new Date(status.session.started_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                )}
                {todayAttendance && (
                  <div style={{ marginTop: 10 }}>
                    <StatusBadge value={String(todayAttendance.status ?? 'Present')} />
                    <span style={{ marginLeft: 8 }}>
                      {todayAttendance.first_in
                        ? `In ${String(todayAttendance.first_in).slice(0, 5)}`
                        : 'No check-in recorded'}
                      {todayAttendance.last_out ? ` • Out ${String(todayAttendance.last_out).slice(0, 5)}` : ''}
                    </span>
                  </div>
                )}
                <Link to="/me/attendance" className="btn btn-outline" style={{ marginTop: 14 }}>
                  Open Attendance
                </Link>
              </div>
            </ChartCard>
          </div>

          <div className="analytics-grid">
            <ChartCard
              title="Hours Logged — Last 7 Days"
              subtitle="Daily work log hours"
              loading={loading}
              empty={weeklyTrend.every((d) => Number(d.hours) === 0)}
              emptyMessage="No work log entries in the last 7 days."
            >
              <VerticalBarChart data={weeklyTrend} xKey="day" barKey="hours" color="#10b981" height={240} />
            </ChartCard>

            <ChartCard
              title="Leave Balance"
              subtitle="Entitled vs taken this year"
              loading={loading}
              empty={leaveBalance.length === 0}
              emptyMessage="No leave balance published yet."
            >
              <HorizontalBarChart
                data={leaveBalance.map((b) => ({
                  name: String(b.leave_type ?? 'Leave'),
                  total: Number(b.total ?? 0),
                  taken: Number(b.taken ?? 0),
                }))}
                nameKey="name"
                valueKey="total"
                color="#8b5cf6"
                height={Math.max(160, leaveBalance.length * 34)}
              />
            </ChartCard>
          </div>

          <div className="quick-links-grid">
            {[
              { to: '/me/projects', label: 'My Projects', icon: Icons.Briefcase },
              { to: '/me/tasks', label: 'My Tasks', icon: Icons.ListCheck },
              { to: '/me/worklog', label: 'My Timesheet', icon: Icons.ClipboardList },
              { to: '/me/attendance', label: 'My Attendance', icon: Icons.Clock },
              { to: '/me/leave', label: 'My Leave', icon: Icons.CalendarMinus },
              { to: '/me/loans', label: 'My Loans', icon: Icons.SackDollar },
              { to: '/me/profile', label: 'My Profile', icon: Icons.UserTie },
              { to: '/me/payslips', label: 'My Payslips', icon: Icons.FileInvoiceDollar },
              { to: '/me/id-card', label: 'My ID Card', icon: Icons.IdCard },
              { to: '/me/organization', label: 'Holidays & Notices', icon: Icons.Globe },
            ].map((link) => (
              <Link key={link.to} to={link.to} className="quick-link-card">
                <span className="quick-link-icon">
                  <Icon icon={link.icon} />
                </span>
                <span>{link.label}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}