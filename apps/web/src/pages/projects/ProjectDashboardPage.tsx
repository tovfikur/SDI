import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { projects } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { ChartCard } from '../../components/charts/ChartCard';
import { AreaTrendChart, DonutChart, HorizontalBarChart } from '../../components/charts/charts';
import { statusColor } from '../../components/charts/chartTheme';
import { formatStatusLabel } from '../../utils/statusLabels';

interface DashProject {
  name: string;
  client: string | null;
  lead: string | null;
  progress: number | string;
  status: string;
  start_date: string | null;
  ending_date: string | null;
  duration_days: number | null;
  approximate_tasks: number | null;
  task_total?: number;
  task_done?: number;
}

interface StatusRow {
  status: string;
  n: number;
}

export function ProjectDashboardPage(): ReactElement {
  const navigate = useNavigate();
  const [projectRows, setProjectRows] = useState<DashProject[]>([]);
  const [projectStatus, setProjectStatus] = useState<StatusRow[]>([]);
  const [completionTrend, setCompletionTrend] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await projects.dashboard();
        if (cancelled) return;
        const data = res.data as { projects: DashProject[] };
        setProjectRows(data.projects ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchAnalytics() {
      setAnalyticsLoading(true);
      try {
        const res = await projects.analytics();
        const d = res.data as {
          byStatus: StatusRow[];
          completionTrend: Array<{ week: string; n: number }>;
        };
        if (!cancelled) {
          setProjectStatus(d.byStatus ?? []);
          setCompletionTrend((d.completionTrend ?? []).map((c) => ({ week: c.week, n: c.n })));
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

  const totalProjects = projectRows.length;
  const activeProjects = projectRows.filter((p) => p.status !== 'completed').length;
  const avgProgress = projectRows.length
    ? Math.round(projectRows.reduce((s, p) => s + Number(p.progress ?? 0), 0) / projectRows.length)
    : 0;

  return (
    <div>
      <PageHeader title="Project Dashboard" subtitle="Overall portfolio health and task distribution." />
      {loading && <div className="data-table-state">Loading dashboard...</div>}
      {error && <div className="data-table-state data-table-error">{error}</div>}
      {!loading && !error && (
        <>
          <div className="kpi-grid">
            <Link to="/projects/list" className="stat-card-clay" style={{ textDecoration: 'none' }}>
              <div className="mini-stat">
                <div className="mini-stat-value">{totalProjects}</div>
                <div className="mini-stat-label">Total Projects</div>
              </div>
            </Link>
            <Link to="/projects/list" className="stat-card-clay" style={{ textDecoration: 'none' }}>
              <div className="mini-stat">
                <div className="mini-stat-value">{activeProjects}</div>
                <div className="mini-stat-label">Active Projects</div>
              </div>
            </Link>
            <Link to="/projects/tasks" className="stat-card-clay" style={{ textDecoration: 'none' }}>
              <div className="mini-stat">
                <div className="mini-stat-value">{avgProgress}%</div>
                <div className="mini-stat-label">Avg Project Progress</div>
              </div>
            </Link>
            <Link to="/projects/tasks" className="stat-card-clay" style={{ textDecoration: 'none' }}>
              <div className="mini-stat">
                <div className="mini-stat-value">{projectStatus.length}</div>
                <div className="mini-stat-label">Project Statuses</div>
              </div>
            </Link>
          </div>

          <div className="analytics-grid analytics-grid-wide">
            <ChartCard
              title="Projects by Status"
              subtitle="Portfolio status mix — click a segment to open the project list"
              loading={analyticsLoading}
              empty={projectStatus.length === 0}
            >
              <DonutChart
                data={projectStatus.map((s) => ({ key: s.status, value: s.n, color: statusColor(s.status) }))}
                onSliceClick={() => navigate('/projects/list')}
              />
              <div className="chart-legend">
                {projectStatus.map((s) => (
                  <button
                    key={s.status}
                    type="button"
                    className="chart-legend-item"
                    onClick={() => navigate('/projects/list')}
                  >
                    <span className="chart-legend-dot" style={{ background: statusColor(s.status) }} />
                    <span className="chart-legend-label">{formatStatusLabel(s.status)}</span>
                    <span className="chart-legend-value">{s.n}</span>
                  </button>
                ))}
              </div>
            </ChartCard>

            <ChartCard
              title="Project Progress"
              subtitle="Task-derived progress across projects — click a bar for details"
              loading={analyticsLoading}
              empty={projectRows.length === 0}
            >
              <HorizontalBarChart
                data={projectRows.map((p) => ({ name: p.name, progress: Math.round(Number(p.progress ?? 0)) }))}
                nameKey="name"
                valueKey="progress"
                valueFormatter={(v) => `${v}%`}
                onBarClick={() => navigate('/projects/list')}
              />
            </ChartCard>
          </div>

          <ChartCard
            title="Task Completion Over Time"
            subtitle="Completed tasks per week over the last 180 days"
            loading={analyticsLoading}
            empty={completionTrend.length === 0}
          >
            <AreaTrendChart
              data={completionTrend}
              xKey="week"
              series={[{ key: 'n', color: 'var(--primary)' }]}
              valueFormatter={(v) => `${v} tasks`}
            />
          </ChartCard>

          <div className="panel-clay">
            <h3>Project List</h3>
            {projectRows.length === 0 ? (
              <div className="data-table-state">No projects yet.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Client</th>
                    <th>Lead</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th>End Date</th>
                  </tr>
                </thead>
                <tbody>
                  {projectRows.map((p) => (
                    <tr key={p.name}>
                      <td><strong>{p.name}</strong></td>
                      <td>{p.client ?? '—'}</td>
                      <td>{p.lead ?? '—'}</td>
                      <td><StatusBadge value={p.status} /></td>
                      <td>
                        <div className="progress-clay">
                          <div className="progress-fill" style={{ width: `${Math.min(100, Number(p.progress ?? 0))}%` }} />
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{String(p.progress ?? 0)}%</span>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
                          {p.task_done ?? 0} / {p.task_total ?? 0} tasks done
                        </div>
                      </td>
                      <td>{p.ending_date ? new Date(p.ending_date).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}