import { useState, useEffect } from 'react';
import type { ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { hr, projects, leave, attendance, fieldTracking } from '../api';
import { Icon, Icons } from '../components/Icon';
import type { IconDefinition } from '../components/Icon';
import { usePermissions, useCurrentUser } from '../auth-context';
import { StatusBadge } from '../components/StatusBadge';
import { ChartCard } from '../components/charts/ChartCard';
import { AreaTrendChart, DonutChart } from '../components/charts/charts';
import { projectBadgeStyle, projectCardStyle, projectProgressStyle } from '../utils/projectCard';
import { statusColor } from '../components/charts/chartTheme';
import { formatStatusLabel } from '../utils/statusLabels';

const QUICK_LINKS: { to: string; label: string; icon: IconDefinition; permission?: string }[] = [
  { to: '/hr/dashboard', label: 'HR Dashboard', icon: Icons.Home, permission: 'hr.masters.view' },
  {
    to: '/hr/departments',
    label: 'Departments',
    icon: Icons.Building,
    permission: 'hr.masters.view',
  },
  {
    to: '/hr/sub-departments',
    label: 'Sub Departments',
    icon: Icons.Sitemap,
    permission: 'hr.masters.view',
  },
  { to: '/hr/setup-rules', label: 'Work Schedule', icon: Icons.CalendarDays, permission: 'hr.masters.view' },
  { to: '/hr/employees', label: 'Employees', icon: Icons.UserTie, permission: 'hr.employee.view' },
  {
    to: '/hr/attendance',
    label: 'Attendance',
    icon: Icons.Clock,
    permission: 'hr.attendance.view',
  },
  {
    to: '/hr/attendance/mobile',
    label: 'My Attendance',
    icon: Icons.UserClock,
    permission: 'hr.attendance.field.self',
  },
  {
    to: '/hr/attendance-report',
    label: 'Attendance Report',
    icon: Icons.ChartBar,
    permission: 'report.view',
  },
  { to: '/hr/holidays', label: 'Holidays', icon: Icons.CalendarDay, permission: 'hr.masters.view' },
  { to: '/hr/leave', label: 'Leave', icon: Icons.CalendarMinus },
  { to: '/hr/training', label: 'Training', icon: Icons.GraduationCap },
  { to: '/hr/notices', label: 'Notices', icon: Icons.Bullhorn, permission: 'hr.notices.read' },
  { to: '/hr/id-cards', label: 'ID Cards', icon: Icons.IdCard, permission: 'hr.employee.view' },
  { to: '/hr/policies', label: 'Policies', icon: Icons.FileLines, permission: 'hr.policies.read' },
  { to: '/hr/loans', label: 'Loans', icon: Icons.SackDollar, permission: 'hr.employee.view' },
  {
    to: '/hr/resignations',
    label: 'Resignations',
    icon: Icons.PersonWalkingArrowRight,
    permission: 'hr.employee.view',
  },
  {
    to: '/projects/dashboard',
    label: 'Project Dashboard',
    icon: Icons.Dashboard,
    permission: 'pm.project.view',
  },
  {
    to: '/projects/employee-tasks',
    label: 'Employee Tasks',
    icon: Icons.UserGear,
    permission: 'pm.task.view',
  },
  {
    to: '/projects/clients',
    label: 'Clients',
    icon: Icons.Handshake,
    permission: 'pm.client.view',
  },
  {
    to: '/projects/list',
    label: 'Projects',
    icon: Icons.FolderOpen,
    permission: 'pm.project.view',
  },
  {
    to: '/projects/tasks',
    label: 'Manage Tasks',
    icon: Icons.ListCheck,
    permission: 'pm.task.view',
  },
  {
    to: '/projects/daily-tasks',
    label: 'Work Log',
    icon: Icons.ClipboardList,
    permission: 'pm.daily_task.view',
  },
  {
    to: '/projects/meetings',
    label: 'Meetings',
    icon: Icons.CalendarDays,
    permission: 'pm.meeting.view',
  },
  {
    to: '/projects/reports',
    label: 'Project Reports',
    icon: Icons.ChartLine,
    permission: 'report.view',
  },
  { to: '/audit', label: 'Audit Log', icon: Icons.ShieldHalved, permission: 'audit.view' },
  { to: '/settings', label: 'Settings', icon: Icons.Gear, permission: 'settings.manage' },
];

interface DashboardProject {
  id: string;
  name: string;
  client: string;
  lead: string;
  progress: string | number;
  start_date: string;
  ending_date: string;
  duration_days: number;
  status: string;
  approximate_tasks: number;
  card_color?: string | null;
  text_color?: string | null;
}

interface Meeting {
  id: string;
  place: string;
  held_at: string;
  purpose: string;
  project_name: string;
}

interface LeaveBalance {
  employee_code: string;
  full_name: string;
  leave_type: string;
  total: string | number;
  taken: string | number;
  due: string | number;
}

interface AttendanceRecord {
  employee_code: string;
  full_name: string;
  Present: number | null;
}

interface MyStatus {
  checkedIn: boolean;
  trackingActive: boolean;
  session: { started_at: string } | null;
}

export function DashboardPage(): ReactElement {
  const { can, canAny } = usePermissions();
  const user = useCurrentUser();
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [activeProjects, setActiveProjects] = useState<DashboardProject[]>([]);
  const [showAllProjects, setShowAllProjects] = useState(false);
  // Backend returns projects ordered by most recent (created_at DESC).
  const visibleProjects = showAllProjects ? activeProjects : activeProjects.slice(0, 3);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [todayPresent, setTodayPresent] = useState(0);
  const [myStatus, setMyStatus] = useState<MyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
const [attTrend, setAttTrend] = useState<Record<string, unknown>[]>([]);
  const [workforce, setWorkforce] = useState<Array<{ name: string; n: number }>>([]);
  const [attDays, setAttDays] = useState(30);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const navigate = useNavigate();

  const canLeave = canAny(['hr.leave.view', 'self.leave.apply']);
  const canTraining = canAny(['hr.training.view', 'self.training.view']);

  useEffect(() => {
    let cancelled = false;

    async function fetchDashboard() {
      try {
        setLoading(true);
        setError(null);

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const tasks: Promise<unknown>[] = [];

        if (can('hr.employee.view')) {
          tasks.push(
            hr
              .employees({ perPage: 1 })
              .then((res) => setTotalEmployees((res.data as { total?: number })?.total ?? 0))
          );
        }
        if (can('pm.project.view')) {
          tasks.push(
            projects.dashboard().then((res) => {
              const dashData = res.data as Record<string, unknown>;
              setActiveProjects((dashData?.projects ?? []) as DashboardProject[]);
            })
          );
        }
        if (can('pm.meeting.view')) {
          tasks.push(
            projects
              .meetings({ perPage: 6, sort: 'held_at', direction: 'desc' })
              .then((res) =>
                setMeetings(
                  ((res.data as Record<string, unknown>)?.items ?? []) as unknown as Meeting[]
                )
              )
          );
        }
        if (can('report.view')) {
          tasks.push(
            attendance.reports.monthlySummary({ year, month }).then((res) => {
              const attData = (res.data as AttendanceRecord[]) ?? [];
              setTodayPresent(attData.filter((r) => (r.Present ?? 0) > 0).length);
            })
          );
        }
        if (canLeave) {
          tasks.push(
            leave.balances().then((res) => setLeaveBalances((res.data as LeaveBalance[]) ?? []))
          );
        }
        if (can('hr.attendance.field.self')) {
          tasks.push(
            fieldTracking
              .myStatus()
              .then((res) => setMyStatus((res.data as MyStatus) ?? null))
              .catch(() => setMyStatus(null))
          );
        }

        await Promise.all(tasks);
        if (cancelled) return;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchDashboard();
    return () => {
      cancelled = true;
    };
  }, [can, canAny, canLeave]);

  useEffect(() => {
    let cancelled = false;
    async function fetchAnalytics() {
      setAnalyticsLoading(true);
      const tasks: Promise<unknown>[] = [];
      const canOrgAttendance =
        can('hr.attendance.manage') || can('hr.attendance.approve') || can('report.view');
      if (canOrgAttendance || can('self.attendance.view')) {
        tasks.push(
          attendance
            .analytics({ days: attDays })
            .then((res) => {
              const d = res.data as { trend: Record<string, unknown>[] };
              if (!cancelled) {
                setAttTrend(d.trend ?? []);
              }
            })
            .catch(() => undefined)
        );
      }
      if (can('hr.employee.view')) {
        tasks.push(
          hr
            .workforceAnalytics()
            .then((res) => {
              const d = res.data as { byDepartment: Array<{ name: string; n: number }> };
              if (!cancelled) setWorkforce(d.byDepartment ?? []);
            })
            .catch(() => undefined)
        );
      }
      await Promise.all(tasks);
      if (!cancelled) setAnalyticsLoading(false);
    }
    void fetchAnalytics();
    return () => {
      cancelled = true;
    };
  }, [can, canAny, canLeave, attDays]);

  const pendingLeaves = leaveBalances.reduce((sum, b) => sum + Number(b.due ?? 0), 0);
  const visibleLinks = QUICK_LINKS.filter((q) => {
    if (q.to === '/hr/leave') return canLeave;
    if (q.to === '/hr/training') return canTraining;
    return !q.permission || can(q.permission);
  });

  if (loading) {
    return (
      <div className="page-state-box">
        <div className="spinner" />
        <div className="page-state-text">Loading dashboard…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-state-box">
        <div className="page-state-icon">
          <Icon icon={Icons.Error} />
        </div>
        <div className="page-state-text" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {user?.fullName ? `Welcome, ${user.fullName.split(' ')[0]}` : 'Executive Dashboard'}
          </h1>
          <p className="page-subtitle">SDI Real-Time Overview</p>
        </div>
        <button className="btn-clay btn-clay-primary" onClick={() => window.location.reload()}>
          Refresh Metrics
        </button>
      </div>

      <div className="stats-grid">
        {can('hr.employee.view') && (
          <Link to="/hr/employees" className="stat-card-clay stat-card-link" aria-label={`Total Employees: ${totalEmployees} — open employee list`}>
            <div>
              <div className="stat-label">Total Employees</div>
              <div className="stat-value">{totalEmployees}</div>
            </div>
            <div className="stat-icon-clay">
              <Icon icon={Icons.Users} />
            </div>
          </Link>
        )}
        {can('pm.project.view') && (
          <Link to="/projects/list" className="stat-card-clay stat-card-link" aria-label={`Active Projects: ${activeProjects.length} — open projects`}>
            <div>
              <div className="stat-label">Active Projects</div>
              <div className="stat-value">{activeProjects.length}</div>
            </div>
            <div className="stat-icon-clay">
              <Icon icon={Icons.FolderOpen} />
            </div>
          </Link>
        )}
        {canLeave && (
          <Link to={can('hr.leave.view') ? '/hr/leave/balances' : '/me/leave'} className="stat-card-clay stat-card-link" aria-label={`Leave days due: ${pendingLeaves} — open leave`}>
            <div>
              <div className="stat-label">Leave Days Due</div>
              <div className="stat-value">{pendingLeaves}</div>
            </div>
            <div className="stat-icon-clay">
              <Icon icon={Icons.CalendarDay} />
            </div>
          </Link>
        )}
        {can('report.view') && (
          <Link to="/hr/attendance-report" className="stat-card-clay stat-card-link" aria-label={`Today's present: ${todayPresent} — open attendance report`}>
            <div>
              <div className="stat-label">Today&apos;s Present</div>
              <div className="stat-value">{todayPresent}</div>
            </div>
            <div className="stat-icon-clay">
              <Icon icon={Icons.Clock} />
            </div>
          </Link>
        )}
        {can('hr.attendance.field.self') && (
          <Link to="/me/attendance" className="stat-card-clay stat-card-link" aria-label="Open my attendance">
            <div>
              <div className="stat-label">My Attendance</div>
              <div className="stat-value" style={{ fontSize: '0.95rem' }}>
                {myStatus?.checkedIn ? 'Checked In' : 'Not Checked In'}
              </div>
              {myStatus?.session?.started_at && (
                <div className="stat-sub" style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  Since:{' '}
                  {new Date(myStatus.session.started_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              )}
            </div>
            <div className="stat-icon-clay">
              <Icon icon={Icons.UserClock} />
            </div>
          </Link>
        )}
      </div>

      <h3
        style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: '1.75rem', marginBottom: '1rem' }}
      >
        Analytics
      </h3>

      <div className="analytics-grid analytics-grid-wide">
        {(can('hr.attendance.manage') || can('hr.attendance.approve') || can('report.view') || can('self.attendance.view')) && (
          <ChartCard
            title="Attendance Trend"
            subtitle={
              can('hr.attendance.manage') || can('hr.attendance.approve') || can('report.view')
                ? 'Daily present / late / absent / leave counts'
                : 'My daily attendance'
            }
            loading={analyticsLoading}
            empty={attTrend.length === 0}
            actions={
              <select
                className="form-control-clay"
                value={attDays}
                onChange={(e) => setAttDays(Number(e.target.value))}
                aria-label="Attendance trend period"
              >
                <option value={7}>7 Days</option>
                <option value={30}>30 Days</option>
                <option value={90}>3 Months</option>
              </select>
            }
          >
            <AreaTrendChart
              data={attTrend}
              xKey="date"
              series={[
                { key: 'present', color: '#10b981' },
                { key: 'late', color: '#f59e0b' },
                { key: 'absent', color: '#ef4444' },
                { key: 'leave', color: '#2563eb' },
              ]}
              valueFormatter={(v) => `${v}`}
            />
            <div className="chart-legend">
              {[
                { key: 'present', color: '#10b981' },
                { key: 'late', color: '#f59e0b' },
                { key: 'absent', color: '#ef4444' },
                { key: 'leave', color: '#2563eb' },
              ].map((s) => (
                <span key={s.key} className="chart-legend-item">
                  <span className="chart-legend-dot" style={{ background: s.color }} />
                  <span className="chart-legend-label">{formatStatusLabel(s.key)}</span>
                </span>
              ))}
            </div>
          </ChartCard>
        )}

        {can('hr.employee.view') && (
          <ChartCard
            title="Workforce Distribution"
            subtitle="Employees by department — click a segment to open employees"
            loading={analyticsLoading}
            empty={workforce.length === 0}
          >
            <DonutChart
              data={workforce.map((d) => ({ key: d.name, value: d.n, color: statusColor(d.name) }))}
              onSliceClick={() => navigate('/hr/employees')}
            />
            <div className="chart-legend">
              {workforce.map((d) => (
                <button
                  key={d.name}
                  type="button"
                  className="chart-legend-item"
                  onClick={() => navigate('/hr/employees')}
                >
                  <span className="chart-legend-dot" style={{ background: statusColor(d.name) }} />
                  <span className="chart-legend-label">{d.name}</span>
                  <span className="chart-legend-value">{d.n}</span>
                </button>
              ))}
            </div>
          </ChartCard>
        )}
      </div>

      {can('pm.project.view') && (
        <>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: '1.25rem' }}>
            Active Projects Overview
          </h3>
          {activeProjects.length === 0 ? (
            <div className="panel-clay" style={{ marginBottom: '1.5rem' }}>
              <div className="data-table-state">No active projects found</div>
            </div>
          ) : (
            <div className="projects-overview-grid">
              {visibleProjects.map((project, idx) => {
                const progress = Number(project.progress ?? 0);
                return (
                  <Link
                    to={`/me/projects/${project.id}`}
                    key={project.id ?? `${project.name}-${idx}`}
                    className="square-card square-card-link"
                    aria-label={`Open project ${project.name}`}
                    style={projectCardStyle(project.card_color, project.text_color)}
                  >
                    <div className="square-card-header">
                      <div>
                        <div className="square-card-title">{project.name}</div>
                        <div className="square-card-subtitle">
                          {project.client ?? '—'} &bull; Lead: {project.lead ?? '—'}
                        </div>
                      </div>
                      <span className="badge-clay" style={projectBadgeStyle(project.card_color, project.text_color)}>
                        {Math.round(progress)}%
                      </span>
                    </div>
                    <div
                      className="progress-clay"
                      style={{ margin: '0.2rem 0 0.85rem', minWidth: '100%' }}
                    >
                      <div
                        className="progress-fill"
                        style={projectProgressStyle(project.card_color, project.text_color, progress)}
                      ></div>
                    </div>
                    <div className="square-card-body">
                      <div className="square-card-row">
                        <span className="square-card-row-label">Start Date</span>
                        <span className="square-card-row-val">
                          {project.start_date ? project.start_date.slice(0, 10) : '—'}
                        </span>
                      </div>
                      <div className="square-card-row">
                        <span className="square-card-row-label">Ending Date</span>
                        <span className="square-card-row-val">
                          {project.ending_date ? project.ending_date.slice(0, 10) : '—'}
                        </span>
                      </div>
                      <div className="square-card-row">
                        <span className="square-card-row-label">Status</span>
                        <StatusBadge value={project.status} />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
          {activeProjects.length > 3 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.9rem' }}>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => setShowAllProjects((s) => !s)}
              >
                {showAllProjects ? 'Show Less' : `More (${activeProjects.length - 3} more)`}
              </button>
            </div>
          )}
        </>
      )}

      <h3
        style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: '2rem', marginBottom: '1.25rem' }}
      >
        Quick Links
      </h3>
      <div className="kpi-grid">
        {visibleLinks.map((q) => (
          <Link key={q.to} to={q.to} className="quick-link-card">
            <div className="quick-link-icon">
              <Icon icon={q.icon} />
            </div>
            <div className="quick-link-label">{q.label}</div>
          </Link>
        ))}
      </div>

      {can('pm.meeting.view') && (
        <>
          <h3
            style={{
              fontSize: '1.15rem',
              fontWeight: 800,
              marginTop: '2rem',
              marginBottom: '1.25rem',
            }}
          >
            Recent Activity
          </h3>
          {meetings.length === 0 ? (
            <div className="stat-card-clay">
              <div className="stat-label">No recent meetings found</div>
            </div>
          ) : (
            <div className="square-card-grid">
              {meetings.slice(0, 6).map((meeting) => (
                <Link to="/projects/meetings" key={meeting.id} className="square-card square-card-link" aria-label={`Open meetings — ${meeting.place || 'Meeting'}`}>
                  <div className="square-card-header">
                    <div>
                      <div className="square-card-title">{meeting.place || 'Meeting'}</div>
                      <div className="square-card-subtitle">
                        {meeting.project_name ?? 'General'}
                      </div>
                    </div>
                  </div>
                  <div className="square-card-body">
                    <div className="square-card-row">
                      <span className="square-card-row-label">When</span>
                      <span className="square-card-row-val">
                        {meeting.held_at ? new Date(meeting.held_at).toLocaleString() : '—'}
                      </span>
                    </div>
                    <div className="square-card-row">
                      <span className="square-card-row-label">Purpose</span>
                      <span className="square-card-row-val">{meeting.purpose ?? '—'}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
