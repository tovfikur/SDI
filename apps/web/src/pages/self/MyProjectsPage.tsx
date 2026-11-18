import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { projects } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon, Icons } from '../../components/Icon';
import { statusColor } from '../../components/charts/chartTheme';
import { ChartCard } from '../../components/charts/ChartCard';
import { DonutChart } from '../../components/charts/charts';
import { projectCardStyle, projectProgressStyle } from '../../utils/projectCard';

interface Row {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
  ending_date: string | null;
  client_name?: string | null;
  lead_name?: string | null;
  task_total?: number;
  task_done?: number;
  project_progress?: number | null;
  progress_percent?: number | null;
  card_color?: string | null;
  text_color?: string | null;
}

const progressOf = (r: Row): number => Math.max(0, Math.min(100, Math.round(Number(r.project_progress ?? r.progress_percent ?? 0))));

export function MyProjectsPage(): ReactElement {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await projects.list({ perPage: 100 });
      setRows((res.data as { items: Row[] }).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [rows.length]);

  const statusMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    return [...counts.entries()].map(([status, n]) => ({ status, n }));
  }, [rows]);

  const totalTasks = rows.reduce((s, r) => s + (r.task_total ?? 0), 0);
  const doneTasks = rows.reduce((s, r) => s + (r.task_done ?? 0), 0);
  const avgProgress = rows.length ? Math.round(rows.reduce((s, r) => s + progressOf(r), 0) / rows.length) : 0;

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div>
      <PageHeader title="My Projects" subtitle="Projects you lead or are a member of" />
      {error && <div className="alert alert-danger">{error}</div>}
      {loading ? (
        <div className="loading">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">You are not part of any projects yet.</div>
      ) : (
        <>
          <div className="kpi-grid hrdash-kpi-grid">
            <div className="hrdash-kpi">
              <span className="hrdash-kpi-icon" style={{ background: '#6366f11f', color: '#6366f1' }}>
                <Icon icon={Icons.Briefcase} size="lg" />
              </span>
              <span className="hrdash-kpi-body">
                <span className="hrdash-kpi-value">{rows.length}</span>
                <span className="hrdash-kpi-label">Projects</span>
              </span>
            </div>
            <div className="hrdash-kpi">
              <span className="hrdash-kpi-icon" style={{ background: '#10b9811f', color: '#10b981' }}>
                <Icon icon={Icons.ListCheck} size="lg" />
              </span>
              <span className="hrdash-kpi-body">
                <span className="hrdash-kpi-value">
                  {doneTasks}/{totalTasks}
                </span>
                <span className="hrdash-kpi-label">Tasks Completed</span>
              </span>
            </div>
            <div className="hrdash-kpi">
              <span className="hrdash-kpi-icon" style={{ background: '#f59e0b1f', color: '#f59e0b' }}>
                <Icon icon={Icons.ChartSimple} size="lg" />
              </span>
              <span className="hrdash-kpi-body">
                <span className="hrdash-kpi-value">{avgProgress}%</span>
                <span className="hrdash-kpi-label">Avg Progress</span>
              </span>
            </div>
          </div>

          <div
            className="my-projects-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
          >
              {pageRows.map((r) => {
                const pct = progressOf(r);
                return (
                  <Link
                    key={r.id}
                    to={`/me/projects/${r.id}`}
                    className="card"
                    style={{
                      ...(projectCardStyle(r.card_color, r.text_color) ?? {}),
                      textDecoration: 'none',
                      color: projectCardStyle(r.card_color, r.text_color)?.color ?? 'inherit',
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '1rem 1.1rem',
                      transition: 'transform .15s ease, box-shadow .15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.3, color: 'var(--text-main)' }}>{r.name}</div>
                        {r.client_name && (
                          <div className="text-muted" style={{ fontSize: '0.82rem', marginTop: 2 }}>{r.client_name}</div>
                        )}
                      </div>
                      <StatusBadge value={r.status} />
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '0.5rem 1rem',
                        margin: '0.9rem 0',
                        fontSize: '0.82rem',
                      }}
                    >
                      <div>
                        <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3 }}>Start</div>
                        <div style={{ fontWeight: 600 }}>{r.start_date ?? '—'}</div>
                      </div>
                      <div>
                        <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3 }}>End</div>
                        <div style={{ fontWeight: 600 }}>{r.ending_date ?? '—'}</div>
                      </div>
                      <div>
                        <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3 }}>Tasks</div>
                        <div style={{ fontWeight: 600 }}>{r.task_done ?? 0} / {r.task_total ?? 0}</div>
                      </div>
                      <div>
                        <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3 }}>Lead</div>
                        <div style={{ fontWeight: 600 }}>{r.lead_name ?? '—'}</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 'auto' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 6 }}>
                        <span className="text-muted">Progress</span>
                        <strong>{pct}%</strong>
                      </div>
                      <div className="progress" style={{ height: 8 }}>
                        <div
                          className="progress-bar"
                          style={projectProgressStyle(r.card_color, r.text_color, pct)}
                        />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

            {rows.length > PAGE_SIZE && (
              <div className="pagination-bar" style={{ marginTop: '0.75rem' }}>
                <span className="page-info">
                  Page {safePage} of {pageCount} • {rows.length} projects
                </span>
                <button type="button" className="btn btn-sm btn-outline" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                  ‹ Prev
                </button>
                <button type="button" className="btn btn-sm btn-outline" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>
                  Next ›
                </button>
              </div>
            )}

            <ChartCard
              title="Project Status Mix"
              subtitle="Distribution across your projects"
              loading={loading}
              empty={statusMix.length === 0}
            >
              <DonutChart
                data={statusMix.map((s) => ({ key: s.status, value: s.n, color: statusColor(s.status) }))}
                height={230}
              />
            </ChartCard>
        </>
      )}
    </div>
  );
}