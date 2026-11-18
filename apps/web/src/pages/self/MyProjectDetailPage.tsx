import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { projects } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon, Icons } from '../../components/Icon';
import { projectAccent } from '../../utils/projectCard';
import { statusColor } from '../../components/charts/chartTheme';
import { ChartCard } from '../../components/charts/ChartCard';
import { DonutChart } from '../../components/charts/charts';

interface TaskRow {
  id: string;
  title: string;
  status: string;
  progress_percent: number | null;
  assignee_name?: string | null;
  planned_start: string | null;
  planned_end: string | null;
}

export function MyProjectDetailPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Record<string, unknown> | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await projects.get(id);
      setProject(res.data);
      const taskRes = await projects.tasks({ perPage: 100, 'filter[project_id]': id });
      setTasks((taskRes.data as { items: TaskRow[] }).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const taskMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
    return [...counts.entries()].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n);
  }, [tasks]);

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!project) return <div className="empty-state">Project not found.</div>;

  const members = (project.members as Array<{ id: string; full_name: string; role?: string }>) ?? [];
  const taskSummary = (project.taskSummary as Record<string, number>) ?? {};
  const progress = Math.max(0, Math.min(100, Number(project.project_progress ?? project.progress_percent ?? 0)));
  const color = projectAccent((project as { card_color?: string | null }).card_color);
  const totalTasks = Number(taskSummary.total ?? tasks.length ?? 0);

  return (
    <div>
      <PageHeader
        title={String(project.name ?? 'Project')}
        {...(project.client_name ? { subtitle: `Client: ${String(project.client_name)}` } : {})}
        actions={
          <Link to="/me/projects" className="btn btn-outline">
            ← Back to My Projects
          </Link>
        }
      />

      <div className="analytics-grid analytics-grid-wide">
        <ChartCard title="Project Overview" loading={loading}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <div
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  background: `conic-gradient(${color} ${progress * 3.6}deg, var(--card-border, #e2e8f0) 0deg)`,
                }}
              >
                <div
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: '50%',
                    background: 'var(--card-bg, #fff)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                  }}
                >
                  <strong style={{ fontSize: '1.4rem' }}>{Math.round(progress)}%</strong>
                  <span style={{ fontSize: '0.72rem', opacity: 0.7 }}>Progress</span>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <StatusBadge value={String(project.status ?? 'open')} />
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 220, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
              {[
                { label: 'Start Date', value: String(project.start_date ?? '—'), icon: Icons.CalendarDays },
                { label: 'End Date', value: String(project.ending_date ?? '—'), icon: Icons.CalendarMinus },
                { label: 'Project Lead', value: String(project.lead_name ?? '—'), icon: Icons.UserTie },
                { label: 'Tasks', value: `${Number(taskSummary.done ?? 0)} / ${totalTasks} done`, icon: Icons.ListCheck },
                { label: 'Team Size', value: String(members.length), icon: Icons.UserClock },
                {
                  label: 'Location',
                  value:
                    project.latitude != null && project.longitude != null
                      ? `${Number(project.latitude).toFixed(4)}, ${Number(project.longitude).toFixed(4)}`
                      : '—',
                  icon: Icons.MapLocationDot,
                },
              ].map((s) => (
                <div key={s.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: `${color}1c`,
                      color,
                      flexShrink: 0,
                    }}
                  >
                    <Icon icon={s.icon} size="sm" />
                  </span>
                  <div>
                    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.65 }}>{s.label}</div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{s.value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {project.check_in_radius != null && (
            <div style={{ marginTop: 12, fontSize: '0.85rem' }}>
              <span className="badge-clay badge-clay-info">Check-in radius: {String(project.check_in_radius)}m</span>
            </div>
          )}
          {Boolean(project.summary) && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--card-border, #e2e8f0)' }}>
              <strong>Summary</strong>
              <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0', opacity: 0.85 }}>{String(project.summary)}</p>
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Task Status"
          subtitle="Distribution of project tasks"
          loading={loading}
          empty={taskMix.length === 0}
          emptyMessage="No tasks in this project yet."
        >
          <DonutChart
            data={taskMix.map((s) => ({ key: s.status, value: s.n, color: statusColor(s.status) }))}
            height={230}
          />
        </ChartCard>
      </div>

      {members.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">
              <Icon icon={Icons.UserClock} size="sm" /> Team
            </div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {members.map((m) => (
              <span
                key={m.id}
                className="badge-soft"
                style={{ padding: '6px 12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: '#6366f11f',
                    color: '#6366f1',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                  }}
                >
                  {(m.full_name ?? '?').split(/\s+/).map((p) => p[0]?.toUpperCase()).slice(0, 2).join('')}
                </span>
                {m.full_name}
                {m.role ? <span className="text-muted" style={{ fontWeight: 500 }}>({m.role})</span> : null}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-title">Assigned Tasks</div>
          <Link to="/me/tasks" className="btn btn-sm btn-outline">
            Manage My Tasks
          </Link>
        </div>
        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Assignee</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.title}</td>
                  <td>
                    <StatusBadge value={t.status} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
                      <div className="progress" style={{ flex: 1, height: 6 }}>
                        <div
                          className="progress-bar"
                          style={{ width: `${Math.max(0, Math.min(100, Number(t.progress_percent ?? 0)))}%` }}
                        />
                      </div>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{t.progress_percent ?? 0}%</span>
                    </div>
                  </td>
                  <td>{t.assignee_name ?? '—'}</td>
                  <td className="text-muted">{t.planned_end ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}