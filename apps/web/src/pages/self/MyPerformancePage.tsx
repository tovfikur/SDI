import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useCurrentUser } from '../../auth-context';
import { hr } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { Icon, Icons } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { ChartCard } from '../../components/charts/ChartCard';
import { VerticalBarChart, DonutChart } from '../../components/charts/charts';

interface ScoreItem {
  section: string;
  criterion: string;
  rating?: string | null;
  score: number;
  max_score: number;
  notes?: string | null;
}

interface DevPlanItem {
  improvement_area?: string | null;
  expected_outcome?: string | null;
  mentor_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

interface GoalItem {
  goal?: string | null;
  target_period?: string | null;
}

interface PerformanceRow {
  id: string;
  employee_id?: string;
  performance_date: string;
  evaluator_name?: string | null;
  reviewer_name?: string | null;
  reviewer_signature?: string | null;
  total_score?: number | null;
  overall_score?: number | null;
  classification?: string | null;
  reviewer_recommendations?: string | null;
  employee_comments?: string | null;
  position_title?: string | null;
  position_name?: string | null;
  department_name?: string | null;
  next_review_date?: string | null;
  created_at?: string;
  scores?: ScoreItem[];
  development_plans?: DevPlanItem[];
  next_goals?: GoalItem[];
}

const scoreTone = (score: number | null | undefined): string => {
  if (score === null || score === undefined) return 'badge-clay';
  if (score >= 80) return 'badge-clay-success';
  if (score >= 60) return 'badge-clay-info';
  if (score >= 40) return 'badge-clay-warning';
  return 'badge-clay-danger';
};

const classificationMeta = (c: string | null | undefined): { label: string; cls: string; hint: string } => {
  if (c === 'EE') return { label: 'EE', cls: 'badge-clay-success', hint: 'Exceeds Expectations (80–100)' };
  if (c === 'AE') return { label: 'AE', cls: 'badge-clay-info', hint: 'Meets Expectations (75–79)' };
  if (c === 'UE') return { label: 'UE', cls: 'badge-clay-danger', hint: 'Unsatisfactory (Below 75)' };
  return { label: '—', cls: 'badge-clay', hint: 'Not classified' };
};

const formatDate = (d?: string | null): string => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString();
};

function printSelfAppraisal(row: PerformanceRow, employeeName: string): void {
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) return;
  const esc = (v: unknown): string =>
    String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const sectionA = (row.scores ?? []).filter((s) => s.section === 'A');
  const sectionB = (row.scores ?? []).filter((s) => s.section === 'B');
  const totalA = sectionA.reduce((sum, s) => sum + Number(s.score ?? 0), 0);
  const totalB = sectionB.reduce((sum, s) => sum + Number(s.score ?? 0), 0);
  const total = Number(row.total_score ?? totalA + totalB);
  const meta = classificationMeta(row.classification);

  const scoreRows = (rows: ScoreItem[]): string =>
    rows.length === 0
      ? `<tr><td colspan="4" style="text-align:center;color:#94a3b8">No entries</td></tr>`
      : rows
          .map(
            (s) => `<tr>
              <td>${esc(s.criterion)}</td>
              <td style="text-align:center">${esc(s.rating)}</td>
              <td style="text-align:center">${esc(s.score)}</td>
              <td>${esc(s.notes)}</td>
            </tr>`
          )
          .join('');

  const devPlans = (row.development_plans ?? []).map(
    (p, i) => `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${esc(p.improvement_area)}</td>
      <td>${esc(p.expected_outcome)}</td>
      <td>${esc(p.mentor_name)}</td>
      <td>${esc(p.start_date)} → ${esc(p.end_date)}</td>
    </tr>`
  );

  const goals = (row.next_goals ?? []).map(
    (g, i) => `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${esc(g.goal)}</td>
      <td>${esc(g.target_period)}</td>
    </tr>`
  );

  win.document.write(`<!DOCTYPE html><html><head><title>Performance Appraisal — ${esc(employeeName)}</title><style>
    *{box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;padding:28px 34px;color:#1e293b;background:#fff;font-size:13px}
    .brand{display:flex;align-items:center;gap:14px;border-bottom:3px solid #1e3a8a;padding-bottom:14px;margin-bottom:18px}
    .brand-logo{width:52px;height:52px;background:#1e3a8a;color:#fff;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800}
    .brand-name{font-size:20px;font-weight:800;letter-spacing:-0.01em}
    .brand-sub{font-size:12px;color:#64748b}
    h2{margin:4px 0 2px;font-size:19px}
    h3{font-size:14px;margin:22px 0 8px;color:#1e3a8a;text-transform:uppercase;letter-spacing:0.05em}
    .meta{display:flex;flex-wrap:wrap;gap:6px 22px;margin:10px 0;font-size:12px;color:#475569}
    .meta b{color:#0f172a}
    table{border-collapse:collapse;width:100%;font-size:12px;margin-top:6px}
    th,td{border:1px solid #cbd5e1;padding:7px 9px;text-align:left;vertical-align:top}
    th{background:#f1f5f9;font-weight:700;text-transform:uppercase;font-size:10.5px;letter-spacing:0.03em}
    tr:nth-child(even) td{background:#f8fafc}
    .summary-cards{display:flex;gap:14px;margin:14px 0 6px}
    .sum-card{flex:1;border:1px solid #cbd5e1;border-radius:10px;padding:12px 16px;text-align:center}
    .sum-card .v{font-size:24px;font-weight:800}
    .sum-card .l{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;margin-top:2px}
    .comment-block{border:1px solid #cbd5e1;border-radius:10px;padding:14px 16px;margin-top:6px;white-space:pre-wrap;background:#f8fafc}
    .signature{margin-top:28px;display:flex;justify-content:space-between;gap:24px}
    .sig-box{flex:1;border-top:1.5px solid #334155;padding-top:6px;font-size:12px;color:#475569;text-align:center}
    .footer{margin-top:26px;font-size:10.5px;color:#94a3b8;text-align:right}
    @media print{body{padding:0}}
  </style></head><body>
    <div class="brand">
      <div class="brand-logo">SDI</div>
      <div>
        <div class="brand-name">SDI</div>
        <div class="brand-sub">Self Development Initiative</div>
      </div>
    </div>
    <h2>Employee Performance Appraisal Report</h2>
    <div class="meta">
      <span><b>Employee:</b> ${esc(employeeName)}</span>
      <span><b>Designation:</b> ${esc(row.position_name ?? row.position_title ?? '—')}</span>
      <span><b>Review Date:</b> ${esc(formatDate(row.performance_date))}</span>
      <span><b>Reviewer:</b> ${esc(row.evaluator_name ?? row.reviewer_name ?? '—')}</span>
      <span><b>Next Review:</b> ${esc(formatDate(row.next_review_date))}</span>
    </div>
    <div class="summary-cards">
      <div class="sum-card"><div class="v">${totalA} / 60</div><div class="l">Section A · Goals &amp; Objectives</div></div>
      <div class="sum-card"><div class="v">${totalB} / 40</div><div class="l">Section B · Other Standards</div></div>
      <div class="sum-card"><div class="v">${total} / 100</div><div class="l">Combined Score</div></div>
      <div class="sum-card"><div class="v">${esc(meta.label)}</div><div class="l">Classification · ${esc(meta.hint)}</div></div>
    </div>
    <h3>Section A — Assessment of Goals &amp; Objectives</h3>
    <table><thead><tr><th>Criterion</th><th style="text-align:center">Rating</th><th style="text-align:center">Points</th><th>Notes</th></tr></thead>
    <tbody>${scoreRows(sectionA)}</tbody></table>
    <h3>Section B — Assessment of Other Performance Standards</h3>
    <table><thead><tr><th>Criterion</th><th style="text-align:center">Rating</th><th style="text-align:center">Points</th><th>Notes</th></tr></thead>
    <tbody>${scoreRows(sectionB)}</tbody></table>
    <h3>Section C — Reviewer Recommendations</h3>
    <div class="comment-block">${esc(row.reviewer_recommendations || '—')}</div>
    <h3>Section D — Employee Comments</h3>
    <div class="comment-block">${esc(row.employee_comments || '—')}</div>
    <h3>Section E — Development Plan</h3>
    <table><thead><tr><th style="text-align:center">#</th><th>Improvement Area</th><th>Expected Outcome</th><th>Mentor</th><th>Duration</th></tr></thead>
    <tbody>${devPlans.length ? devPlans.join('') : '<tr><td colspan="5" style="text-align:center;color:#94a3b8">No development plans</td></tr>'}</tbody></table>
    <h3>Section F — Next Period Goals</h3>
    <table><thead><tr><th style="text-align:center">#</th><th>Goal</th><th>Target Completion Period</th></tr></thead>
    <tbody>${goals.length ? goals.join('') : '<tr><td colspan="3" style="text-align:center;color:#94a3b8">No goals defined</td></tr>'}</tbody></table>
    <div class="footer">SDI Enterprise — generated ${new Date().toLocaleString()}</div>
    <script>window.onload=()=>setTimeout(()=>window.print(),350)</script>
  </body></html>`);
  win.document.close();
}

export function MyPerformancePage(): ReactElement {
  const user = useCurrentUser();
  const [rows, setRows] = useState<PerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<PerformanceRow | null>(null);
  const [rowLoading, setRowLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.employeeId) {
      setRows([]);
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await hr.performances(user.employeeId);
      const data = (res.data as any)?.data ?? res.data;
      setRows(Array.isArray(data) ? (data as PerformanceRow[]) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load performance history');
    } finally {
      setLoading(false);
    }
  }, [user?.employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const avgScore = useMemo(() => {
    if (!rows.length) return 0;
    const scored = rows.filter((r) => r.total_score != null || r.overall_score != null);
    if (!scored.length) return 0;
    const sum = scored.reduce((acc, r) => acc + Number(r.total_score ?? Number(r.overall_score) * 20), 0);
    return Math.round(sum / scored.length);
  }, [rows]);

  const scoreTrend = useMemo(
    () =>
      rows
        .slice()
        .sort((a, b) =>
          String(a.performance_date ?? a.created_at ?? '').localeCompare(
            String(b.performance_date ?? b.created_at ?? '')
          )
        )
        .map((r) => ({
          date: String(r.performance_date ?? String(r.created_at ?? '').slice(0, 10)),
          score: Number(r.total_score ?? Number(r.overall_score ?? 0) * 20),
        })),
    [rows]
  );

  const classMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const c = r.classification ?? 'Unclassified';
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const colorMap: Record<string, string> = {
      EE: '#16a34a',
      AE: '#0284c7',
      UE: '#dc2626',
      Unclassified: '#94a3b8',
    };
    return [...counts.entries()].map(([k, n]) => ({
      key: k === 'EE' ? 'Exceeds (EE)' : k === 'AE' ? 'Meets (AE)' : k === 'UE' ? 'Unsatisfactory (UE)' : k,
      value: n,
      color: colorMap[k] ?? '#64748b',
    }));
  }, [rows]);

  const latest = rows[0] ?? null;
  const latestScore = latest ? Number(latest.total_score ?? Number(latest.overall_score ?? 0) * 20) : null;
  const latestMeta = latest ? classificationMeta(latest.classification) : null;

  const showDetail = async (row: PerformanceRow) => {
    if (!user?.employeeId) {
      setDetail(row);
      return;
    }
    setRowLoading(row.id);
    try {
      const res = await hr.performance(user.employeeId, row.id);
      const record = ((res.data as any)?.data ?? res.data) as Record<string, unknown>;
      setDetail({ ...row, ...record } as PerformanceRow);
    } catch {
      setDetail(row);
    } finally {
      setRowLoading(null);
    }
  };

  const handlePrint = async (row: PerformanceRow) => {
    let fullRow = row;
    if (!row.scores || row.scores.length === 0) {
      if (user?.employeeId) {
        setRowLoading(row.id);
        try {
          const res = await hr.performance(user.employeeId, row.id);
          const record = ((res.data as any)?.data ?? res.data) as Record<string, unknown>;
          if (record && typeof record === 'object') {
            fullRow = { ...row, ...record } as PerformanceRow;
          }
        } catch {
          // fallback
        } finally {
          setRowLoading(null);
        }
      }
    }
    printSelfAppraisal(fullRow, user?.fullName || 'Employee');
  };

  return (
    <div>
      <PageHeader
        title="My Performance Appraisals"
        subtitle="Review your historical appraisals, evaluation scores, feedback, and career development plans."
      />

      {loading ? (
        <div className="data-table-clay">
          <div className="data-table-toolbar">
            <div className="skeleton skeleton-line" style={{ width: 180, height: 20 }} />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card" style={{ marginBottom: 12 }}>
              <div className="card-body">
                <div className="skeleton skeleton-line" style={{ width: `${70 - i * 10}%` }} />
                <div className="skeleton skeleton-line" style={{ width: `${45 - i * 5}%`, marginTop: 8 }} />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="card" style={{ maxWidth: 480, margin: '2rem auto' }}>
          <div className="card-body">
            <div className="empty-state" style={{ padding: '0.5rem 0' }}>
              <div className="empty-state-icon" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                <Icon icon={Icons.Warning} size="xl" />
              </div>
              <div className="empty-state-title">Could not load performance history</div>
              <div className="empty-state-hint" style={{ textAlign: 'center' }}>
                {error}
              </div>
              <button type="button" className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => void load()}>
                Try Again
              </button>
            </div>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="card" style={{ maxWidth: 480, margin: '2rem auto' }}>
          <div className="card-body">
            <div className="empty-state" style={{ padding: '0.5rem 0' }}>
              <div className="empty-state-icon">
                <Icon icon={Icons.ChartSimple} size="xl" />
              </div>
              <div className="empty-state-title">No performance reviews recorded</div>
              <div className="empty-state-hint" style={{ textAlign: 'center' }}>
                Once your manager or HR evaluates your performance, your appraisal records will appear here.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="kpi-grid hrdash-kpi-grid">
            <div className="hrdash-kpi">
              <span className="hrdash-kpi-icon" style={{ background: '#6366f11f', color: '#6366f1' }}>
                <Icon icon={Icons.ChartSimple} size="lg" />
              </span>
              <span className="hrdash-kpi-body">
                <span className="hrdash-kpi-value">{avgScore} / 100</span>
                <span className="hrdash-kpi-label">Average Total Score</span>
              </span>
            </div>
            <div className="hrdash-kpi">
              <span className="hrdash-kpi-icon" style={{ background: '#10b9811f', color: '#10b981' }}>
                <Icon icon={Icons.Check} size="lg" />
              </span>
              <span className="hrdash-kpi-body">
                <span className="hrdash-kpi-value">{rows.length}</span>
                <span className="hrdash-kpi-label">Appraisals Completed</span>
              </span>
            </div>
            <div className="hrdash-kpi">
              <span className="hrdash-kpi-icon" style={{ background: '#0ea5e91f', color: '#0ea5e9' }}>
                <Icon icon={Icons.UserTie} size="lg" />
              </span>
              <span className="hrdash-kpi-body">
                <span className="hrdash-kpi-value">
                  {latest?.evaluator_name ?? latest?.reviewer_name ?? '—'}
                </span>
                <span className="hrdash-kpi-label">Latest Reviewer</span>
              </span>
            </div>
          </div>

          <div className="analytics-grid analytics-grid-wide">
            <ChartCard
              title="Latest Appraisal Score"
              subtitle={
                latest
                  ? `Reviewed on ${formatDate(latest.performance_date)}`
                  : 'Your most recent appraisal'
              }
            >
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div
                  style={{
                    width: 150,
                    height: 150,
                    borderRadius: '50%',
                    margin: '0 auto 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    background: `conic-gradient(#6366f1 ${(latestScore ?? 0) * 3.6}deg, var(--card-border, #e2e8f0) 0deg)`,
                  }}
                >
                  <div
                    style={{
                      width: 112,
                      height: 112,
                      borderRadius: '50%',
                      background: 'var(--card-bg, #fff)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'column',
                    }}
                  >
                    <strong style={{ fontSize: '1.7rem', color: '#6366f1' }}>
                      {latestScore != null ? latestScore : '—'}
                    </strong>
                    <span style={{ fontSize: '0.72rem', opacity: 0.7 }}>out of 100</span>
                  </div>
                </div>

                {latestMeta && (
                  <div>
                    <span className={`badge-clay ${latestMeta.cls}`} style={{ fontSize: '0.88rem' }}>
                      {latestMeta.label} — {latestMeta.hint}
                    </span>
                  </div>
                )}

                {latest?.reviewer_recommendations && (
                  <div
                    className="text-muted"
                    style={{
                      fontSize: '0.85rem',
                      marginTop: 12,
                      maxWidth: 460,
                      marginInline: 'auto',
                      textAlign: 'left',
                      background: 'var(--color-bg-muted, #f8fafc)',
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border-subtle, #e2e8f0)',
                    }}
                  >
                    <strong>Feedback: </strong>
                    {latest.reviewer_recommendations}
                  </div>
                )}
              </div>
            </ChartCard>

            <ChartCard
              title="Classification Breakdown"
              loading={loading}
              empty={classMix.length === 0}
            >
              <DonutChart data={classMix} height={200} />
            </ChartCard>
          </div>

          <ChartCard
            title="Score History Trend"
            subtitle="Overall appraisal score (0–100 scale)"
            loading={loading}
            empty={scoreTrend.length < 2}
            emptyMessage="At least two appraisals are needed to plot a performance trend."
          >
            <VerticalBarChart data={scoreTrend} xKey="date" barKey="score" color="#6366f1" height={220} />
          </ChartCard>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="card-title">Appraisal History</div>
              <span className="badge-clay badge-clay-info">{rows.length} total reviews</span>
            </div>
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Review Date</th>
                    <th>Designation</th>
                    <th>Reviewer</th>
                    <th>Total Score</th>
                    <th>Classification</th>
                    <th>Next Review</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const score = r.total_score != null ? Number(r.total_score) : r.overall_score != null ? Number(r.overall_score) * 20 : null;
                    const meta = classificationMeta(r.classification);
                    return (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 600 }}>{formatDate(r.performance_date)}</td>
                        <td>{r.position_title ?? r.position_name ?? '—'}</td>
                        <td>{r.evaluator_name ?? r.reviewer_name ?? '—'}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 }}>
                            <div className="progress" style={{ flex: 1, height: 8 }}>
                              <div
                                className="progress-bar"
                                style={{
                                  width: `${Math.min(100, Math.max(0, score ?? 0))}%`,
                                  background: score != null && score >= 80 ? '#16a34a' : score != null && score >= 60 ? '#0284c7' : '#eab308',
                                }}
                              />
                            </div>
                            <span style={{ fontSize: '0.82rem', fontWeight: 700 }}>
                              {score != null ? `${score} / 100` : '—'}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className={`badge-clay ${meta.cls}`} title={meta.hint}>
                            {meta.label}
                          </span>
                        </td>
                        <td>{formatDate(r.next_review_date)}</td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            <button
                              type="button"
                              className="btn-clay btn-clay-sm btn-clay-secondary"
                              title="View Appraisal Details"
                              disabled={rowLoading === r.id}
                              onClick={() => void showDetail(r)}
                            >
                              <Icon icon={Icons.View} /> View
                            </button>
                            <button
                              type="button"
                              className="btn-clay btn-clay-sm btn-clay-secondary"
                              title="Print Appraisal Report"
                              disabled={rowLoading === r.id}
                              onClick={() => void handlePrint(r)}
                            >
                              <Icon icon={Icons.Print} /> Print
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Detailed Appraisal Modal */}
      <Modal
        title="Performance Appraisal Details"
        open={detail !== null}
        onClose={() => setDetail(null)}
        wide
      >
        {detail && (
          <div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Review Date</label>
                <div style={{ fontWeight: 600 }}>{formatDate(detail.performance_date)}</div>
              </div>
              <div className="form-group">
                <label className="form-label">Evaluator / Reviewer</label>
                <div style={{ fontWeight: 600 }}>{detail.evaluator_name ?? detail.reviewer_name ?? '—'}</div>
              </div>
              <div className="form-group">
                <label className="form-label">Score &amp; Classification</label>
                <div>
                  <span className={`badge-clay ${scoreTone(detail.total_score)}`} style={{ marginRight: 6 }}>
                    {detail.total_score != null ? `${detail.total_score} / 100 pts` : '—'}
                  </span>
                  <span className={`badge-clay ${classificationMeta(detail.classification).cls}`}>
                    {classificationMeta(detail.classification).label} — {classificationMeta(detail.classification).hint}
                  </span>
                </div>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Position Title</label>
                <div>{detail.position_title ?? detail.position_name ?? '—'}</div>
              </div>
              <div className="form-group">
                <label className="form-label">Next Review Date</label>
                <div>{formatDate(detail.next_review_date)}</div>
              </div>
            </div>

            {detail.scores && detail.scores.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="form-section-title">Evaluation Scores Breakdown</div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>Sec</th>
                      <th>Criterion</th>
                      <th style={{ textAlign: 'center', width: 120 }}>Rating</th>
                      <th style={{ textAlign: 'center', width: 90 }}>Points</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.scores.map((s, i) => (
                      <tr key={i}>
                        <td>
                          <span className={`badge-clay ${s.section === 'A' ? 'badge-clay-info' : 'badge-clay-warning'}`}>
                            Sec {s.section}
                          </span>
                        </td>
                        <td>{s.criterion}</td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{s.rating ?? '—'}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700 }}>{s.score} / {s.max_score}</td>
                        <td className="text-muted">{s.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {detail.reviewer_recommendations && (
              <div style={{ marginTop: 16 }}>
                <div className="form-section-title">Reviewer Recommendations</div>
                <div style={{ background: 'var(--color-bg-muted, #f8fafc)', padding: 12, borderRadius: 8, border: '1px solid #e2e8f0', whiteSpace: 'pre-wrap' }}>
                  {detail.reviewer_recommendations}
                </div>
              </div>
            )}

            {detail.employee_comments && (
              <div style={{ marginTop: 16 }}>
                <div className="form-section-title">Employee Comments</div>
                <div style={{ background: 'var(--color-bg-muted, #f8fafc)', padding: 12, borderRadius: 8, border: '1px solid #e2e8f0', whiteSpace: 'pre-wrap' }}>
                  {detail.employee_comments}
                </div>
              </div>
            )}

            {detail.development_plans && detail.development_plans.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="form-section-title">Development Plan</div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Improvement Area</th>
                      <th>Expected Outcome</th>
                      <th>Mentor</th>
                      <th>Timeline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.development_plans.map((p, i) => (
                      <tr key={i}>
                        <td>{p.improvement_area ?? '—'}</td>
                        <td>{p.expected_outcome ?? '—'}</td>
                        <td>{p.mentor_name ?? '—'}</td>
                        <td>{p.start_date || p.end_date ? `${formatDate(p.start_date)} → ${formatDate(p.end_date)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {detail.next_goals && detail.next_goals.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="form-section-title">Next Period Goals</div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Goal Description</th>
                      <th>Target Completion Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.next_goals.map((g, i) => (
                      <tr key={i}>
                        <td style={{ width: 40, textAlign: 'center' }}>{i + 1}</td>
                        <td>{g.goal ?? '—'}</td>
                        <td>{g.target_period ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn-clay btn-clay-secondary"
                onClick={() => setDetail(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-clay btn-clay-primary"
                onClick={() => {
                  printSelfAppraisal(detail, user?.fullName || 'Employee');
                }}
              >
                <Icon icon={Icons.Print} /> Print Appraisal Report
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
