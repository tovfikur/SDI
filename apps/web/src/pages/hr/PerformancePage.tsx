import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { hr } from '../../api';
import type { AppraisalDevelopmentPlan, AppraisalNextGoal, AppraisalPayload, AppraisalRow, AppraisalScore } from '../../api';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { PageHeader } from '../../components/PageHeader';
import { ChartCard } from '../../components/charts/ChartCard';
import { AreaTrendChart, DonutChart, HorizontalBarChart } from '../../components/charts/charts';
import { PALETTE } from '../../components/charts/chartTheme';
import { useToast } from '../../components/Toast';
import { useCurrentUser } from '../../auth-context';
import { downloadCsv, exportExcel } from '../../utils/export';
import { Icon, Icons } from '../../components/Icon';

type AppraisalRating = 'Poor' | 'Need Improvement' | 'Good' | 'Very Good' | 'Excellent';

const RATING_A: { rating: AppraisalRating; points: number }[] = [
  { rating: 'Poor', points: 0 },
  { rating: 'Need Improvement', points: 3 },
  { rating: 'Good', points: 6 },
  { rating: 'Very Good', points: 9 },
  { rating: 'Excellent', points: 12 },
];

const RATING_B: { rating: AppraisalRating; points: number }[] = [
  { rating: 'Poor', points: 2 },
  { rating: 'Need Improvement', points: 4 },
  { rating: 'Good', points: 6 },
  { rating: 'Very Good', points: 9 },
  { rating: 'Excellent', points: 10 },
];

const SECTION_A_CRITERIA = [
  'Knowledge of Duties & Quality of Work',
  'Timeliness of Delivery',
  'Impact of Achievement',
  'Overall Achievement of Goals',
  'Going Beyond Call of Duty',
];

const SECTION_B_CRITERIA = [
  'Interpersonal Skills & Teamwork',
  'Attendance & Punctuality',
  'Communication Skills',
  'Contribution to Mission',
];

const SECTION_A_MAX = 60;
const SECTION_B_MAX = 40;
const COMMENTS_MAX_WORDS = 500;

const EMPTY_RATING: AppraisalRating = 'Poor';

interface FormRating {
  rating: AppraisalRating;
  notes: string;
}

interface FormState {
  employee_id: string;
  position_title: string;
  position_date: string;
  performance_date: string;
  reviewer_name: string;
  reviewer_signature: string;
  next_review_date: string;
  reviewer_recommendations: string;
  employee_comments: string;
  notes: string;
  sectionA: FormRating[];
  sectionB: FormRating[];
  developmentPlans: Array<{ improvement_area: string; expected_outcome: string; mentor_name: string; start_date: string; end_date: string }>;
  nextGoals: Array<{ goal: string; target_period: string }>;
}

const emptyForm = (employeeId = '', positionTitle = ''): FormState => ({
  employee_id: employeeId,
  position_title: positionTitle,
  position_date: '',
  performance_date: new Date().toISOString().slice(0, 10),
  reviewer_name: '',
  reviewer_signature: '',
  next_review_date: '',
  reviewer_recommendations: '',
  employee_comments: '',
  notes: '',
  sectionA: SECTION_A_CRITERIA.map(() => ({ rating: EMPTY_RATING, notes: '' })),
  sectionB: SECTION_B_CRITERIA.map(() => ({ rating: EMPTY_RATING, notes: '' })),
  developmentPlans: [],
  nextGoals: [],
});

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
  position_name?: string;
}

interface Summary {
  total_reviews: number;
  avg_score: number | null;
  reviewed_employees: number;
  pending_reviews: number;
}

interface PerfResponse {
  items: AppraisalRow[];
  total: number;
  page: number;
  per_page: number;
  summary: Summary;
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

const wordCount = (text: string): number => {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
};

function printAppraisalReport(row: AppraisalRow, employeeLabel: string): void {
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
  const scoreRows = (rows: Array<AppraisalScore & { score: number; max_score: number }>): string =>
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
  win.document.write(`<!DOCTYPE html><html><head><title>Performance Appraisal — ${esc(employeeLabel)}</title><style>
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
      <span><b>Employee:</b> ${esc(employeeLabel)}</span>
      <span><b>Designation:</b> ${esc(row.position_name ?? row.position_title ?? '—')}</span>
      <span><b>Department:</b> ${esc(row.department_name ?? '—')}</span>
      <span><b>Review Date:</b> ${esc(formatDate(row.performance_date))}</span>
      <span><b>Reviewer:</b> ${esc(row.evaluator_name ?? '—')}</span>
      <span><b>Next Review:</b> ${esc(formatDate(row.next_review_date))}</span>
    </div>
    <div class="summary-cards">
      <div class="sum-card"><div class="v">${totalA} / ${SECTION_A_MAX}</div><div class="l">Section A · Goals &amp; Objectives</div></div>
      <div class="sum-card"><div class="v">${totalB} / ${SECTION_B_MAX}</div><div class="l">Section B · Other Standards</div></div>
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
    <div class="signature">
      <div class="sig-box">Employee Signature</div>
      <div class="sig-box">Reviewer Signature: ${esc(row.reviewer_signature || '')}</div>
    </div>
    <div class="footer">SDI Enterprise — generated ${new Date().toLocaleString()}</div>
    <script>window.onload=()=>setTimeout(()=>window.print(),350)</script>
  </body></html>`);
  win.document.close();
}

export function PerformancePage(): ReactElement {
  const user = useCurrentUser();
  const { toast } = useToast();
  const canManage = Boolean(
    user && (user.isSuperAdmin || user.permissions?.includes('hr.employee.performance'))
  );

  const [rows, setRows] = useState<AppraisalRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summary, setSummary] = useState<Summary>({
    total_reviews: 0,
    avg_score: null,
    reviewed_employees: 0,
    pending_reviews: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters] = useState({ employee_id: '', date_from: '', date_to: '' });
  const [draftFilters, setDraftFilters] = useState({ employee_id: '', date_from: '', date_to: '' });
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  const [view, setView] = useState<'list' | 'form'>('list');
  const [editing, setEditing] = useState<AppraisalRow | null>(null);
  const [detail, setDetail] = useState<AppraisalRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppraisalRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowLoading, setRowLoading] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'excel' | null>(null);
  const [perfTrend, setPerfTrend] = useState<Record<string, unknown>[]>([]);
  const [perfByDept, setPerfByDept] = useState<Array<{ name: string; avg_score: number; reviews: number }>>([]);
  const [perfRating, setPerfRating] = useState<Array<{ bucket: string; n: number }>>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search]);

  const buildParams = (p: number, pp: number, searchOverride?: string) => {
    const params: Record<string, string | number | undefined> = {
      page: p,
      perPage: pp,
      search: searchOverride ?? debouncedSearch,
      employeeId: filters.employee_id || undefined,
      dateFrom: filters.date_from || undefined,
      dateTo: filters.date_to || undefined,
    };
    return params;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [perf, emps] = await Promise.all([
        hr.performanceRecords(buildParams(page, perPage)),
        hr.employees({ perPage: 100 }),
      ]);
      const resp = perf.data as unknown as PerfResponse;
      const items = Array.isArray(resp?.items) ? resp.items : [];
      setRows(items);
      setTotal(resp?.total ?? items.length);
      setSummary(
        resp?.summary ?? {
          total_reviews: 0,
          avg_score: null,
          reviewed_employees: 0,
          pending_reviews: 0,
        }
      );
      setEmployees((emps.data as { items?: Employee[] })?.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load performance records');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, debouncedSearch, filters.employee_id, filters.date_from, filters.date_to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    async function fetchTrend() {
      setTrendLoading(true);
      try {
        const res = await hr.performanceTrend();
        const d = res.data as {
          trend: Record<string, unknown>[];
          byDepartment: Array<{ name: string; avg_score: number; reviews: number }>;
          byRating: Array<{ bucket: string; n: number }>;
        };
        if (!cancelled) {
          setPerfTrend(d.trend ?? []);
          setPerfByDept((d.byDepartment ?? []).filter((x) => Number(x.reviews ?? 0) > 0));
          setPerfRating(d.byRating ?? []);
        }
      } catch {
        /* optional */
      }
      if (!cancelled) setTrendLoading(false);
    }
    void fetchTrend();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeFilterCount =
    (filters.employee_id ? 1 : 0) + (filters.date_from ? 1 : 0) + (filters.date_to ? 1 : 0);

  const resetFilters = () => {
    setFilters({ employee_id: '', date_from: '', date_to: '' });
    setDraftFilters({ employee_id: '', date_from: '', date_to: '' });
    setFilterOpen(false);
    setPage(1);
  };

  const openCreate = () => {
    setEditing(null);
    const firstEmp = employees[0];
    setForm(emptyForm(firstEmp?.id ?? '', firstEmp?.position_name ?? ''));
    setFormError('');
    setView('form');
  };

  const openEdit = async (row: AppraisalRow) => {
    setRowLoading(row.id);
    let fullRow = row;
    try {
      if (row.employee_id) {
        const res = await hr.performance(row.employee_id, row.id);
        const record = ((res.data as any)?.data ?? res.data) as Record<string, unknown>;
        if (record && typeof record === 'object') {
          fullRow = { ...row, ...record } as AppraisalRow;
        }
      }
    } catch (e) {
      console.warn('Failed to fetch full appraisal record for edit', e);
    } finally {
      setRowLoading(null);
    }
    const scores = fullRow.scores ?? [];
    const sectionA = SECTION_A_CRITERIA.map((c) => {
      const s = scores.find((x) => x.section === 'A' && x.criterion === c);
      return { rating: (s?.rating ?? EMPTY_RATING) as AppraisalRating, notes: s?.notes ?? '' };
    });
    const sectionB = SECTION_B_CRITERIA.map((c) => {
      const s = scores.find((x) => x.section === 'B' && x.criterion === c);
      return { rating: (s?.rating ?? EMPTY_RATING) as AppraisalRating, notes: s?.notes ?? '' };
    });
    setEditing(fullRow);
    setForm({
      employee_id: fullRow.employee_id ?? '',
      position_title: fullRow.position_title ?? fullRow.position_name ?? '',
      position_date: (fullRow.position_date ?? '').slice(0, 10),
      performance_date: (fullRow.performance_date ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
      reviewer_name: fullRow.evaluator_name ?? '',
      reviewer_signature: fullRow.reviewer_signature ?? '',
      next_review_date: (fullRow.next_review_date ?? '').slice(0, 10),
      reviewer_recommendations: fullRow.reviewer_recommendations ?? '',
      employee_comments: fullRow.employee_comments ?? '',
      notes: fullRow.notes ?? '',
      sectionA,
      sectionB,
      developmentPlans: (fullRow.development_plans ?? []).map((p) => ({
        improvement_area: p.improvement_area ?? '',
        expected_outcome: p.expected_outcome ?? '',
        mentor_name: p.mentor_name ?? '',
        start_date: (p.start_date ?? '').slice(0, 10),
        end_date: (p.end_date ?? '').slice(0, 10),
      })),
      nextGoals: (fullRow.next_goals ?? []).map((g) => ({
        goal: g.goal ?? '',
        target_period: g.target_period ?? '',
      })),
    });
    setFormError('');
    setView('form');
  };

  const sectionAScore = useMemo(
    () => form.sectionA.reduce((sum, r) => sum + (RATING_A.find((x) => x.rating === r.rating)?.points ?? 0), 0),
    [form.sectionA]
  );
  const sectionBScore = useMemo(
    () => form.sectionB.reduce((sum, r) => sum + (RATING_B.find((x) => x.rating === r.rating)?.points ?? 0), 0),
    [form.sectionB]
  );
  const combinedScore = sectionAScore + sectionBScore;
  const classification = combinedScore >= 80 ? 'EE' : combinedScore >= 75 ? 'AE' : 'UE';
  const commentsWords = wordCount(form.employee_comments);

  const validateForm = (): string => {
    if (!form.employee_id) return 'Employee is required.';
    if (!form.performance_date) return 'Review date is required.';
    if (!form.reviewer_name.trim()) return 'Reviewer name is required.';
    const missingA = form.sectionA.some((r) => !r.rating);
    const missingB = form.sectionB.some((r) => !r.rating);
    if (missingA || missingB) return 'Every criterion in Sections A and B must have a rating.';
    if (commentsWords > COMMENTS_MAX_WORDS) {
      return `Employee comments must not exceed ${COMMENTS_MAX_WORDS} words (currently ${commentsWords}).`;
    }
    if (form.next_review_date && form.performance_date) {
      const perf = new Date(form.performance_date).getTime();
      const next = new Date(form.next_review_date).getTime();
      if (!Number.isNaN(perf) && !Number.isNaN(next) && next < perf) {
        return 'Next review date cannot be before the review date.';
      }
    }
    if (form.developmentPlans.some((p) => p.start_date && p.end_date && p.end_date < p.start_date)) {
      return 'Development plan end date cannot be before its start date.';
    }
    return '';
  };

  const buildPayload = (): AppraisalPayload => {
    const sectionA: AppraisalScore[] = form.sectionA
      .filter((r) => r.rating)
      .map((r, i) => ({
        section: 'A',
        criterion: SECTION_A_CRITERIA[i],
        rating: r.rating,
        notes: r.notes.trim() || null,
      }));
    const sectionB: AppraisalScore[] = form.sectionB
      .filter((r) => r.rating)
      .map((r, i) => ({
        section: 'B',
        criterion: SECTION_B_CRITERIA[i],
        rating: r.rating,
        notes: r.notes.trim() || null,
      }));
    const developmentPlans: AppraisalDevelopmentPlan[] = form.developmentPlans
      .filter((p) => p.improvement_area.trim() || p.expected_outcome.trim() || p.mentor_name.trim())
      .map((p) => ({
        improvement_area: p.improvement_area.trim() || null,
        expected_outcome: p.expected_outcome.trim() || null,
        mentor_name: p.mentor_name.trim() || null,
        start_date: p.start_date || null,
        end_date: p.end_date || null,
      }));
    const nextGoals: AppraisalNextGoal[] = form.nextGoals
      .filter((g) => g.goal.trim())
      .map((g) => ({
        goal: g.goal.trim() || null,
        target_period: g.target_period.trim() || null,
      }));
    return {
      position_title: form.position_title.trim() || null,
      position_date: form.position_date || null,
      performance_date: form.performance_date || null,
      reviewer_name: form.reviewer_name.trim() || null,
      reviewer_signature: form.reviewer_signature.trim() || null,
      next_review_date: form.next_review_date || null,
      reviewer_recommendations: form.reviewer_recommendations.trim() || null,
      employee_comments: form.employee_comments.trim() || null,
      notes: form.notes.trim() || null,
      section_a: sectionA,
      section_b: sectionB,
      development_plans: developmentPlans,
      next_goals: nextGoals,
    };
  };

  const save = async () => {
    const validation = validateForm();
    if (validation) {
      setFormError(validation);
      return;
    }
    setSubmitting(true);
    setFormError('');
    const payload = buildPayload();
    try {
      if (editing) {
        await hr.updatePerformance(editing.employee_id ?? '', editing.id, payload);
        toast('Appraisal updated', 'success');
      } else {
        await hr.createPerformance(form.employee_id, payload);
        toast('Appraisal created', 'success');
      }
      setView('list');
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save appraisal');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await hr.deletePerformance(deleteTarget.employee_id ?? '', deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      toast('Appraisal record deleted', 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to delete appraisal record', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const showDetail = async (row: AppraisalRow) => {
    setRowLoading(row.id);
    if (!row.employee_id) {
      setDetail(row);
      setRowLoading(null);
      return;
    }
    try {
      const res = await hr.performance(row.employee_id, row.id);
      const record = ((res.data as any)?.data ?? res.data) as Record<string, unknown>;
      setDetail({ ...row, ...record } as AppraisalRow);
    } catch {
      setDetail(row);
    } finally {
      setRowLoading(null);
    }
  };

  const handlePrint = async (row: AppraisalRow) => {
    let fullRow = row;
    if ((!row.scores || row.scores.length === 0) && row.employee_id) {
      setRowLoading(row.id);
      try {
        const res = await hr.performance(row.employee_id, row.id);
        const record = ((res.data as any)?.data ?? res.data) as Record<string, unknown>;
        if (record && typeof record === 'object') {
          fullRow = { ...row, ...record } as AppraisalRow;
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to load details for printing', 'error');
      } finally {
        setRowLoading(null);
      }
    }
    const emp = employees.find((e) => e.id === fullRow.employee_id);
    const label = emp ? `${emp.full_name} (${emp.employee_code})` : (fullRow.full_name ?? 'Employee');
    printAppraisalReport(fullRow, label);
  };

  const employeeLabel = (row: AppraisalRow): string =>
    `${row.full_name ?? 'Unknown employee'} (${row.employee_code ?? '—'})`;

  const updateRating = (section: 'A' | 'B', i: number, patch: Partial<FormRating>) => {
    if (section === 'A') {
      setForm((f) => {
        const sectionA = [...f.sectionA];
        sectionA[i] = { ...sectionA[i], ...patch };
        return { ...f, sectionA };
      });
    } else {
      setForm((f) => {
        const sectionB = [...f.sectionB];
        sectionB[i] = { ...sectionB[i], ...patch };
        return { ...f, sectionB };
      });
    }
  };

  const exportColumns = [
    { key: 'employee', header: 'Employee' },
    { key: 'designation', header: 'Designation' },
    { key: 'department', header: 'Department' },
    { key: 'date', header: 'Review Date' },
    { key: 'score', header: 'Total Score' },
    { key: 'classification', header: 'Classification' },
    { key: 'reviewer', header: 'Reviewer' },
    { key: 'next', header: 'Next Review' },
  ];

  const handleExport = async (kind: 'csv' | 'excel') => {
    setExporting(kind);
    try {
      const collected: AppraisalRow[] = [];
      let p = 1;
      let fetched = 0;
      const pp = 100;
      do {
        const res = await hr.performanceRecords(buildParams(p, pp));
        const resp = res.data as unknown as PerfResponse;
        collected.push(...(Array.isArray(resp.items) ? resp.items : []));
        fetched = resp.items?.length ?? 0;
        p += 1;
      } while (fetched === pp);
      const mapped = collected.map((r) => ({
        employee: employeeLabel(r),
        designation: r.position_name ?? r.position_title ?? '—',
        department: r.department_name ?? '—',
        date: formatDate(r.performance_date),
        score: r.total_score ?? '—',
        classification: r.classification ?? '—',
        reviewer: r.evaluator_name ?? '—',
        next: formatDate(r.next_review_date),
      }));
      if (kind === 'csv') {
        downloadCsv('performance.csv', mapped, exportColumns);
      } else {
        exportExcel('performance.xls', mapped, exportColumns);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed', 'error');
    } finally {
      setExporting(null);
    }
  };

  const columns: { key: string; header: string; align?: 'center' }[] = [
    { key: 'employee', header: 'Employee' },
    { key: 'designation', header: 'Designation' },
    { key: 'date', header: 'Review Date' },
    { key: 'score', header: 'Score' },
    { key: 'classification', header: 'Class.' },
    { key: 'next', header: 'Next Review' },
    { key: 'reviewer', header: 'Reviewer' },
    { key: 'actions', header: 'Action', align: 'center' },
  ];

  if (view === 'form') {
    return (
      <div>
        <PageHeader
          title={editing ? 'Edit Performance Appraisal' : 'New Performance Appraisal'}
          subtitle="Complete all sections — totals and classification are computed automatically."
          actions={
            <button
              className="btn-clay btn-clay-secondary"
              onClick={() => {
                setView('list');
                setFormError('');
              }}
            >
              ← Back to Appraisals
            </button>
          }
        />

        <div className="appraisal-form-layout">
          <div className="appraisal-form-main">
            <section className="panel-clay appraisal-section">
              <div className="form-section-title">Appraisal Details</div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">
                    Employee <span className="form-required">*</span>
                  </label>
                  {editing ? (
                    <div
                      className="form-control-clay"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: 'var(--color-bg-muted, #f8fafc)',
                        cursor: 'not-allowed',
                      }}
                    >
                      <Icon icon={Icons.UserTie} />
                      <strong>{editing.full_name ?? 'Employee'}</strong>
                      {editing.employee_code && (
                        <span className="daily-task-subline" style={{ marginLeft: 6 }}>
                          ({editing.employee_code})
                        </span>
                      )}
                    </div>
                  ) : (
                    <select
                      className="form-control-clay"
                      value={form.employee_id}
                      onChange={(e) => {
                        const empId = e.target.value;
                        const emp = employees.find((x) => x.id === empId);
                        setForm((prev) => ({
                          ...prev,
                          employee_id: empId,
                          position_title: emp?.position_name ?? prev.position_title,
                        }));
                      }}
                    >
                      <option value="">— Select employee —</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.full_name} ({e.employee_code})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">
                    Review Date <span className="form-required">*</span>
                  </label>
                  <input
                    type="date"
                    className="form-control-clay"
                    value={form.performance_date}
                    onChange={(e) => setForm({ ...form, performance_date: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Position Title</label>
                  <input
                    className="form-control-clay"
                    value={form.position_title}
                    placeholder="e.g. Senior Software Engineer"
                    onChange={(e) => setForm({ ...form, position_title: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Position Date</label>
                  <input
                    type="date"
                    className="form-control-clay"
                    value={form.position_date}
                    onChange={(e) => setForm({ ...form, position_date: e.target.value })}
                  />
                </div>
              </div>
            </section>

            <section className="panel-clay appraisal-section">
              <div className="appraisal-section-head">
                <div>
                  <div className="form-section-title">Section A — Assessment of Goals &amp; Objectives</div>
                  <div className="appraisal-section-hint">
                    Max {SECTION_A_MAX} points · Rate each criterion on the 5-point scale
                  </div>
                </div>
                <span className="badge-clay badge-clay-info">
                  {sectionAScore} / {SECTION_A_MAX}
                </span>
              </div>
              <div className="appraisal-criteria">
                {form.sectionA.map((r, i) => (
                  <div key={SECTION_A_CRITERIA[i]} className="appraisal-criterion">
                    <div className="appraisal-criterion-label">
                      <span className="appraisal-criterion-name">{SECTION_A_CRITERIA[i]}</span>
                      <span className="appraisal-criterion-pts">
                        {RATING_A.find((x) => x.rating === r.rating)?.points ?? 0} pts
                      </span>
                    </div>
                    <div className="appraisal-rating-row">
                      {RATING_A.map((opt) => (
                        <button
                          key={opt.rating}
                          type="button"
                          className={`appraisal-rating-btn ${r.rating === opt.rating ? 'appraisal-rating-btn-active' : ''}`}
                          onClick={() => updateRating('A', i, { rating: opt.rating })}
                        >
                          <span className="appraisal-rating-label">{opt.rating}</span>
                          <span className="appraisal-rating-points">{opt.points}</span>
                        </button>
                      ))}
                    </div>
                    <input
                      className="form-control-clay form-control-sm appraisal-criterion-notes"
                      placeholder="Notes for this criterion (optional)"
                      value={r.notes}
                      onChange={(e) => updateRating('A', i, { notes: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="panel-clay appraisal-section">
              <div className="appraisal-section-head">
                <div>
                  <div className="form-section-title">Section B — Assessment of Other Performance Standards</div>
                  <div className="appraisal-section-hint">
                    Max {SECTION_B_MAX} points · Rate each criterion on the 5-point scale
                  </div>
                </div>
                <span className="badge-clay badge-clay-info">
                  {sectionBScore} / {SECTION_B_MAX}
                </span>
              </div>
              <div className="appraisal-criteria">
                {form.sectionB.map((r, i) => (
                  <div key={SECTION_B_CRITERIA[i]} className="appraisal-criterion">
                    <div className="appraisal-criterion-label">
                      <span className="appraisal-criterion-name">{SECTION_B_CRITERIA[i]}</span>
                      <span className="appraisal-criterion-pts">
                        {RATING_B.find((x) => x.rating === r.rating)?.points ?? 0} pts
                      </span>
                    </div>
                    <div className="appraisal-rating-row">
                      {RATING_B.map((opt) => (
                        <button
                          key={opt.rating}
                          type="button"
                          className={`appraisal-rating-btn ${r.rating === opt.rating ? 'appraisal-rating-btn-active' : ''}`}
                          onClick={() => updateRating('B', i, { rating: opt.rating })}
                        >
                          <span className="appraisal-rating-label">{opt.rating}</span>
                          <span className="appraisal-rating-points">{opt.points}</span>
                        </button>
                      ))}
                    </div>
                    <input
                      className="form-control-clay form-control-sm appraisal-criterion-notes"
                      placeholder="Notes for this criterion (optional)"
                      value={r.notes}
                      onChange={(e) => updateRating('B', i, { notes: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="panel-clay appraisal-section">
              <div className="form-section-title">Section C — Reviewer Recommendations</div>
              <div className="form-group">
                <label className="form-label">Recommendations</label>
                <textarea
                  className="form-control-clay"
                  rows={4}
                  value={form.reviewer_recommendations}
                  onChange={(e) => setForm({ ...form, reviewer_recommendations: e.target.value })}
                  placeholder="Summarize strengths, areas of focus and any recommended actions..."
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Reviewer Signature</label>
                  <input
                    className="form-control-clay"
                    value={form.reviewer_signature}
                    onChange={(e) => setForm({ ...form, reviewer_signature: e.target.value })}
                    placeholder="Name / electronic signature"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Next Review Date</label>
                  <input
                    type="date"
                    className="form-control-clay"
                    value={form.next_review_date}
                    onChange={(e) => setForm({ ...form, next_review_date: e.target.value })}
                  />
                </div>
              </div>
            </section>

            <section className="panel-clay appraisal-section">
              <div className="appraisal-section-head">
                <div>
                  <div className="form-section-title">Section D — Employee Comments</div>
                  <div className="appraisal-section-hint">Maximum {COMMENTS_MAX_WORDS} words</div>
                </div>
                <span className={`badge-clay ${commentsWords > COMMENTS_MAX_WORDS ? 'badge-clay-danger' : commentsWords > COMMENTS_MAX_WORDS - 50 ? 'badge-clay-warning' : 'badge-clay-info'}`}>
                  {commentsWords} / {COMMENTS_MAX_WORDS} words
                </span>
              </div>
              <textarea
                className="form-control-clay"
                rows={5}
                value={form.employee_comments}
                onChange={(e) => setForm({ ...form, employee_comments: e.target.value })}
                placeholder="Employee's own feedback statement (max 500 words)..."
              />
            </section>

            <section className="panel-clay appraisal-section">
              <div className="appraisal-section-head">
                <div>
                  <div className="form-section-title">Section E — Development Plan</div>
                  <div className="appraisal-section-hint">Improvement areas, expected outcomes, mentor and duration</div>
                </div>
              </div>
              {form.developmentPlans.map((p, i) => (
                <div key={i} className="appraisal-subsection">
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Improvement Area</label>
                      <input
                        className="form-control-clay"
                        value={p.improvement_area}
                        onChange={(e) =>
                          setForm((f) => {
                            const developmentPlans = [...f.developmentPlans];
                            developmentPlans[i] = { ...developmentPlans[i], improvement_area: e.target.value };
                            return { ...f, developmentPlans };
                          })
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Expected Outcome</label>
                      <input
                        className="form-control-clay"
                        value={p.expected_outcome}
                        onChange={(e) =>
                          setForm((f) => {
                            const developmentPlans = [...f.developmentPlans];
                            developmentPlans[i] = { ...developmentPlans[i], expected_outcome: e.target.value };
                            return { ...f, developmentPlans };
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Responsible Mentor</label>
                      <input
                        className="form-control-clay"
                        value={p.mentor_name}
                        onChange={(e) =>
                          setForm((f) => {
                            const developmentPlans = [...f.developmentPlans];
                            developmentPlans[i] = { ...developmentPlans[i], mentor_name: e.target.value };
                            return { ...f, developmentPlans };
                          })
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Start Date</label>
                      <input
                        type="date"
                        className="form-control-clay"
                        value={p.start_date}
                        onChange={(e) =>
                          setForm((f) => {
                            const developmentPlans = [...f.developmentPlans];
                            developmentPlans[i] = { ...developmentPlans[i], start_date: e.target.value };
                            return { ...f, developmentPlans };
                          })
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">End Date</label>
                      <input
                        type="date"
                        className="form-control-clay"
                        value={p.end_date}
                        onChange={(e) =>
                          setForm((f) => {
                            const developmentPlans = [...f.developmentPlans];
                            developmentPlans[i] = { ...developmentPlans[i], end_date: e.target.value };
                            return { ...f, developmentPlans };
                          })
                        }
                      />
                    </div>
                    {form.developmentPlans.length > 1 && (
                      <button
                        className="btn-clay btn-clay-danger btn-clay-sm appraisal-remove-btn"
                        aria-label="Remove development plan"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            developmentPlans: f.developmentPlans.filter((_, x) => x !== i),
                          }))
                        }
                      >
                        <Icon icon={Icons.Trash} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button
                className="btn-clay btn-clay-secondary btn-clay-sm"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    developmentPlans: [...f.developmentPlans, { improvement_area: '', expected_outcome: '', mentor_name: '', start_date: '', end_date: '' }],
                  }))
                }
              >
                + Add Development Plan
              </button>
            </section>

            <section className="panel-clay appraisal-section">
              <div className="appraisal-section-head">
                <div>
                  <div className="form-section-title">Section F — Next Period Goals</div>
                  <div className="appraisal-section-hint">Agreed future goals and target completion periods</div>
                </div>
              </div>
              {form.nextGoals.map((g, i) => (
                <div key={i} className="appraisal-subsection">
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Goal</label>
                      <input
                        className="form-control-clay"
                        value={g.goal}
                        onChange={(e) =>
                          setForm((f) => {
                            const nextGoals = [...f.nextGoals];
                            nextGoals[i] = { ...nextGoals[i], goal: e.target.value };
                            return { ...f, nextGoals };
                          })
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Target Completion Period</label>
                      <input
                        className="form-control-clay"
                        value={g.target_period}
                        onChange={(e) =>
                          setForm((f) => {
                            const nextGoals = [...f.nextGoals];
                            nextGoals[i] = { ...nextGoals[i], target_period: e.target.value };
                            return { ...f, nextGoals };
                          })
                        }
                      />
                    </div>
                    {form.nextGoals.length > 1 && (
                      <button
                        className="btn-clay btn-clay-danger btn-clay-sm appraisal-remove-btn"
                        aria-label="Remove goal"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            nextGoals: f.nextGoals.filter((_, x) => x !== i),
                          }))
                        }
                      >
                        <Icon icon={Icons.Trash} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button
                className="btn-clay btn-clay-secondary btn-clay-sm"
                onClick={() =>
                  setForm((f) => ({ ...f, nextGoals: [...f.nextGoals, { goal: '', target_period: '' }] }))
                }
              >
                + Add Goal
              </button>
            </section>

            <section className="panel-clay appraisal-section">
              <div className="form-section-title">Additional Notes</div>
              <textarea
                className="form-control-clay"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="General remarks / remarks for the record..."
              />
            </section>

            {formError && <div className="form-error-text">{formError}</div>}

            <div className="appraisal-form-actions">
              <button
                className="btn-clay btn-clay-secondary"
                onClick={() => {
                  setView('list');
                  setFormError('');
                }}
              >
                Cancel
              </button>
              <button className="btn-clay btn-clay-primary" disabled={submitting} onClick={() => void save()}>
                {submitting ? (editing ? 'Updating...' : 'Creating...') : editing ? 'Update Appraisal' : 'Create Appraisal'}
              </button>
            </div>
          </div>

          <aside className="appraisal-sticky-summary">
            <div className="panel-clay">
              <div className="appraisal-summary-title">Section C — Score Summary</div>
              <div className="appraisal-summary-row">
                <span>Section A (Goals &amp; Objectives)</span>
                <strong>{sectionAScore} / {SECTION_A_MAX}</strong>
              </div>
              <div className="appraisal-summary-row">
                <span>Section B (Other Standards)</span>
                <strong>{sectionBScore} / {SECTION_B_MAX}</strong>
              </div>
              <div className="appraisal-summary-row appraisal-summary-total">
                <span>Combined Score</span>
                <strong>{combinedScore} / 100</strong>
              </div>
              <div className="appraisal-classification">
                <div className={`badge-clay ${classificationMeta(classification).cls} appraisal-classification-badge`}>
                  {classificationMeta(classification).label}
                </div>
                <div className="appraisal-classification-hint">{classificationMeta(classification).hint}</div>
              </div>
              <div className="appraisal-summary-progress">
                <div
                  className="appraisal-summary-bar"
                  style={{ width: `${Math.min(100, (combinedScore / 100) * 100)}%` }}
                />
              </div>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Employee Performance"
        subtitle="Performance appraisal records, scores, classifications and evaluator notes."
        actions={
          canManage && (
            <button className="btn-clay btn-clay-primary" onClick={openCreate}>
              + New Performance Appraisal
            </button>
          )
        }
      />

      <div className="stats-grid">
        <div className="stat-card-clay">
          <div>
            <div className="stat-label">Total Reviews</div>
            <div className="stat-value">{summary.total_reviews}</div>
          </div>
          <span className="badge-clay badge-clay-info">
            <Icon icon={Icons.ChartBar} />
          </span>
        </div>
        <div className="stat-card-clay">
          <div>
            <div className="stat-label">Average Score</div>
            <div className="stat-value">
              {summary.avg_score === null ? '—' : Number(summary.avg_score).toFixed(2)}
            </div>
          </div>
          <span className="badge-clay badge-clay-success">
            <Icon icon={Icons.Star} />
          </span>
        </div>
        <div className="stat-card-clay">
          <div>
            <div className="stat-label">Reviewed Employees</div>
            <div className="stat-value">{summary.reviewed_employees}</div>
          </div>
          <span className="badge-clay">
            <Icon icon={Icons.Check} />
          </span>
        </div>
        <div className="stat-card-clay">
          <div>
            <div className="stat-label">Pending Reviews</div>
            <div className="stat-value">{summary.pending_reviews}</div>
          </div>
          <span className="badge-clay badge-clay-warning">
            <Icon icon={Icons.Hourglass} size="xs" />
          </span>
        </div>
      </div>

      <div className="analytics-grid">
        <ChartCard
          title="Average Score Trend"
          subtitle="Average review score by period — reviews count shown on hover"
          loading={trendLoading}
          empty={perfTrend.length === 0}
        >
          <AreaTrendChart
            data={perfTrend.map((p) => ({
              period: String(p.period ?? ''),
              avg_score: Number(p.avg_score ?? 0),
              reviews: Number(p.reviews ?? 0),
            }))}
            xKey="period"
            series={[{ key: 'avg_score', color: 'var(--primary)' }]}
            valueFormatter={(v) => `${Number(v).toFixed(2)} / 100`}
          />
        </ChartCard>

        {perfByDept.length >= 2 && (
          <ChartCard
            title="Department Comparison"
            subtitle="Average review score per department"
            loading={trendLoading}
            empty={perfByDept.length === 0}
          >
            <HorizontalBarChart
              data={perfByDept.map((d) => ({ name: d.name, avg: Math.round(Number(d.avg_score ?? 0)) }))}
              nameKey="name"
              valueKey="avg"
              valueFormatter={(v) => `${v} / 100`}
            />
          </ChartCard>
        )}
      </div>

      {perfRating.length > 0 && (
        <ChartCard
          title="Rating Distribution"
          subtitle="Reviews grouped by total score bucket"
          loading={trendLoading}
          empty={perfRating.length === 0}
        >
          <DonutChart
            data={perfRating.map((r, i) => ({ key: r.bucket, value: r.n, color: PALETTE[i % PALETTE.length] }))}
          />
          <div className="chart-legend">
            {perfRating.map((r, i) => (
              <span key={r.bucket} className="chart-legend-item">
                <span className="chart-legend-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="chart-legend-label">{r.bucket}</span>
                <span className="chart-legend-value">{r.n}</span>
              </span>
            ))}
          </div>
        </ChartCard>
      )}

      <div className="activity-toolbar">
        <div className="activity-toolbar-left">
          <button
            className={`btn-clay btn-clay-sm ${activeFilterCount > 0 ? 'btn-clay-primary' : 'btn-clay-secondary'}`}
            onClick={() => {
              setDraftFilters({ ...filters });
              setFilterOpen(true);
            }}
          >
            Filter {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
          </button>
          {activeFilterCount > 0 && (
            <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={resetFilters}>
              Reset
            </button>
          )}
          <div className="data-table-perpage">
            <span>Show</span>
            <select
              className="form-control-clay form-control-sm"
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>entries</span>
          </div>
        </div>
        <div className="activity-toolbar-right">
          <input
            className="search-input-clay"
            placeholder="Search employee, ID, reviewer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className="btn-clay btn-clay-secondary btn-clay-sm"
            disabled={exporting === 'csv'}
            onClick={() => handleExport('csv')}
          >
            {exporting === 'csv' ? 'Exporting...' : 'CSV'}
          </button>
          <button
            className="btn-clay btn-clay-secondary btn-clay-sm"
            disabled={exporting === 'excel'}
            onClick={() => handleExport('excel')}
          >
            {exporting === 'excel' ? 'Exporting...' : 'Excel'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="panel-clay report-state-panel">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon icon={Icons.Warning} />
            </div>
            <div className="empty-state-title">Unable to load employee performance records.</div>
            <div className="empty-state-hint">{error}</div>
            <button
              className="btn-clay btn-clay-primary"
              onClick={() => {
                setError('');
                void load();
              }}
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        <div className="data-table-clay">
          <div className="report-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 48, textAlign: 'center' }}>SL</th>
                  {columns.map((col) => (
                    <th key={col.key} style={{ textAlign: col.align ?? 'left' }}>
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`sk-${i}`}>
                      {Array.from({ length: columns.length + 1 }).map((_, j) => (
                        <td key={j} className="skeleton-cell">
                          <div
                            className="skeleton skeleton-line"
                            style={{ width: `${55 + ((i * 13 + j * 7) % 40)}%` }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 1} className="data-table-state">
                      <div className="empty-state">
                        <div className="empty-state-icon">
                          <Icon icon={Icons.FolderOpen} />
                        </div>
                        <div className="empty-state-title">
                          {activeFilterCount > 0 || debouncedSearch
                            ? 'No performance records match the selected filters.'
                            : 'No performance appraisals yet.'}
                        </div>
                        {activeFilterCount > 0 || debouncedSearch ? (
                          <button className="btn-clay btn-clay-secondary" onClick={resetFilters}>
                            Reset Filters
                          </button>
                        ) : canManage ? (
                          <button className="btn-clay btn-clay-secondary" onClick={openCreate}>
                            New Performance Appraisal
                          </button>
                        ) : (
                          <div className="empty-state-hint">
                            Records will appear here once they are created.
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((r, idx) => {
                    const meta = classificationMeta(r.classification);
                    return (
                      <tr key={r.id}>
                        <td style={{ textAlign: 'center' }}>{(page - 1) * perPage + idx + 1}</td>
                        <td>
                          <strong>{r.full_name ?? 'Unknown employee'}</strong>
                          {r.employee_code && (
                            <span className="daily-task-subline"> {r.employee_code}</span>
                          )}
                        </td>
                        <td>{r.position_name ?? r.position_title ?? '—'}</td>
                        <td>{formatDate(r.performance_date)}</td>
                        <td>
                          <span className={`badge-clay ${scoreTone(r.total_score)}`}>
                            {r.total_score === null || r.total_score === undefined
                              ? '—'
                              : `${r.total_score} pts`}
                          </span>
                        </td>
                        <td>
                          <span className={`badge-clay ${meta.cls}`} title={meta.hint}>
                            {meta.label}
                          </span>
                        </td>
                        <td>{formatDate(r.next_review_date)}</td>
                        <td>{r.evaluator_name ?? '—'}</td>
                        <td style={{ textAlign: 'center' }}>
                          <div className="data-table-actions">
                            <button
                              className="icon-btn"
                              title="View"
                              aria-label="View"
                              disabled={rowLoading === r.id}
                              onClick={() => void showDetail(r)}
                            >
                              <Icon icon={Icons.View} />
                            </button>
                            <button
                              className="icon-btn"
                              title="Print Report"
                              aria-label="Print Report"
                              disabled={rowLoading === r.id}
                              onClick={() => void handlePrint(r)}
                            >
                              <Icon icon={Icons.Print} />
                            </button>
                            {canManage && (
                              <>
                                <button
                                  className="icon-btn"
                                  title="Edit"
                                  aria-label="Edit"
                                  disabled={rowLoading === r.id}
                                  onClick={() => void openEdit(r)}
                                >
                                  <Icon icon={Icons.Edit} />
                                </button>
                                <button
                                  className="icon-btn icon-btn-danger"
                                  title="Delete"
                                  aria-label="Delete"
                                  onClick={() => setDeleteTarget(r)}
                                >
                                  <Icon icon={Icons.Trash} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="data-table-footer">
            <div className="data-table-total">
              {total > 0
                ? `Showing ${(page - 1) * perPage + 1}–${Math.min(page * perPage, total)} of ${total} entries`
                : '0 entries'}
            </div>
            <div className="data-table-pagination">
              <button
                className="btn-clay btn-clay-secondary btn-clay-sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <button
                className="btn-clay btn-clay-secondary btn-clay-sm"
                disabled={page >= Math.max(1, Math.ceil(total / perPage))}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && (
        <div className="report-mobile-cards">
          {rows.map((row, idx) => {
            const meta = classificationMeta(row.classification);
            return (
              <div key={row.id} className="report-card">
                <div className="report-card-head">
                  <span className="report-card-name">
                    {row.full_name ?? 'Unknown employee'}
                    <span className="daily-task-subline"> {row.employee_code}</span>
                  </span>
                  <span className={`badge-clay ${meta.cls}`} title={meta.hint}>
                    {meta.label}
                  </span>
                </div>
                <div className="report-card-row">
                  <span>{row.position_name ?? row.position_title ?? '—'}</span>
                  <span>{formatDate(row.performance_date)}</span>
                </div>
                <div className="report-card-row">
                  <span>Reviewer: {row.evaluator_name ?? '—'}</span>
                  <span>{row.total_score === null || row.total_score === undefined ? '—' : `${row.total_score} pts`}</span>
                </div>
                <div className="report-card-row">
                  <span>Next Review: {formatDate(row.next_review_date)}</span>
                </div>
                <div className="report-card-meta">
                  <span>#{idx + 1 + (page - 1) * perPage}</span>
                  <span className="daily-card-actions">
                    <button
                      className="icon-btn"
                      title="View"
                      aria-label="View"
                      disabled={rowLoading === row.id}
                      onClick={() => void showDetail(row)}
                    >
                      <Icon icon={Icons.View} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Print Report"
                      aria-label="Print Report"
                      disabled={rowLoading === row.id}
                      onClick={() => void handlePrint(row)}
                    >
                      <Icon icon={Icons.Print} />
                    </button>
                    {canManage && (
                      <>
                        <button
                          className="icon-btn"
                          title="Edit"
                          aria-label="Edit"
                          disabled={rowLoading === row.id}
                          onClick={() => void openEdit(row)}
                        >
                          <Icon icon={Icons.Edit} />
                        </button>
                        <button
                          className="icon-btn icon-btn-danger"
                          title="Delete"
                          aria-label="Delete"
                          onClick={() => setDeleteTarget(row)}
                        >
                          <Icon icon={Icons.Trash} />
                        </button>
                      </>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="panel-clay report-state-panel">
              <div className="empty-state">
                <div className="empty-state-icon">
                  <Icon icon={Icons.FolderOpen} />
                </div>
                <div className="empty-state-title">
                  {activeFilterCount > 0 || debouncedSearch
                    ? 'No performance records match the selected filters.'
                    : 'No performance appraisals yet.'}
                </div>
                {activeFilterCount > 0 || debouncedSearch ? (
                  <button className="btn-clay btn-clay-secondary" onClick={resetFilters}>
                    Reset Filters
                  </button>
                ) : (
                  canManage && (
                    <button className="btn-clay btn-clay-secondary" onClick={openCreate}>
                      New Performance Appraisal
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <Modal
        title="Appraisal Details"
        open={detail !== null}
        onClose={() => setDetail(null)}
        wide
      >
        {detail && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Employee</label>
                <div>
                  <strong>{detail.full_name ?? 'Unknown employee'}</strong>
                  {detail.employee_code && (
                    <span className="daily-task-subline"> {detail.employee_code}</span>
                  )}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Total Score / Classification</label>
                <div>
                  <span className={`badge-clay ${scoreTone(detail.total_score)}`}>
                    {detail.total_score === null || detail.total_score === undefined
                      ? '—'
                      : `${detail.total_score} pts`}
                  </span>{' '}
                  <span className={`badge-clay ${classificationMeta(detail.classification).cls}`}>
                    {classificationMeta(detail.classification).label}
                  </span>
                </div>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Designation</label>
                <div>{detail.position_name ?? detail.position_title ?? '—'}</div>
              </div>
              <div className="form-group">
                <label className="form-label">Department</label>
                <div>{detail.department_name ?? '—'}</div>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Review Date</label>
                <div>{formatDate(detail.performance_date)}</div>
              </div>
              <div className="form-group">
                <label className="form-label">Next Review Date</label>
                <div>{formatDate(detail.next_review_date)}</div>
              </div>
              <div className="form-group">
                <label className="form-label">Reviewer</label>
                <div>{detail.evaluator_name ?? '—'}</div>
              </div>
            </div>
            {detail.scores && detail.scores.length > 0 && (
              <div>
                <div className="form-section-title">Sections A &amp; B — Scores</div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th>Criterion</th>
                      <th style={{ textAlign: 'center' }}>Rating</th>
                      <th style={{ textAlign: 'center' }}>Points</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.scores.map((s, i) => (
                      <tr key={i}>
                        <td>
                          <span className={`badge-clay ${s.section === 'A' ? 'badge-clay-info' : 'badge-clay-warning'}`}>
                            {s.section}
                          </span>
                        </td>
                        <td>{s.criterion}</td>
                        <td style={{ textAlign: 'center' }}>{s.rating ?? '—'}</td>
                        <td style={{ textAlign: 'center' }}>{s.score} / {s.max_score}</td>
                        <td>{s.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {detail.reviewer_recommendations && (
              <div className="form-group" style={{ marginTop: '0.6rem' }}>
                <label className="form-label">Section C — Reviewer Recommendations</label>
                <div>{detail.reviewer_recommendations}</div>
              </div>
            )}
            {detail.employee_comments && (
              <div className="form-group" style={{ marginTop: '0.6rem' }}>
                <label className="form-label">Section D — Employee Comments</label>
                <div className="appraisal-detail-block">{detail.employee_comments}</div>
              </div>
            )}
            {(detail.development_plans ?? []).length > 0 && (
              <div style={{ marginTop: '0.6rem' }}>
                <div className="form-section-title">Section E — Development Plan</div>
                {detail.development_plans!.map((p, i) => (
                  <div key={i} className="appraisal-detail-block">
                    <strong>{p.improvement_area ?? '—'}</strong>
                    {p.expected_outcome && <div>Outcome: {p.expected_outcome}</div>}
                    {p.mentor_name && <div>Mentor: {p.mentor_name}</div>}
                    {(p.start_date || p.end_date) && (
                      <div>Duration: {formatDate(p.start_date)} → {formatDate(p.end_date)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {(detail.next_goals ?? []).length > 0 && (
              <div style={{ marginTop: '0.6rem' }}>
                <div className="form-section-title">Section F — Next Period Goals</div>
                {detail.next_goals!.map((g, i) => (
                  <div key={i} className="appraisal-detail-block">
                    <strong>{g.goal ?? '—'}</strong>
                    {g.target_period && <div>Target: {g.target_period}</div>}
                  </div>
                ))}
              </div>
            )}
            {detail.reviewer_signature && (
              <div className="form-group" style={{ marginTop: '0.6rem' }}>
                <label className="form-label">Reviewer Signature</label>
                <div>{detail.reviewer_signature}</div>
              </div>
            )}
            {detail.notes && (
              <div className="form-group" style={{ marginTop: '0.6rem' }}>
                <label className="form-label">Remarks</label>
                <div>{detail.notes}</div>
              </div>
            )}
            <div className="form-inline-flex" style={{ justifyContent: 'flex-end', marginTop: '0.8rem' }}>
              <button
                className="btn-clay btn-clay-primary btn-clay-sm"
                onClick={() => printAppraisalReport(detail, employeeLabel(detail))}
              >
                <Icon icon={Icons.Print} /> Print Report
              </button>
            </div>
          </>
        )}
      </Modal>

      <ProtectedDeleteModal
        title="Delete Appraisal Record"
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        submitting={submitting}
        message={<p>Are you sure you want to delete this appraisal record?</p>}
      />

      {filterOpen && (
        <>
          {!isMobile && (
            <div className="filter-popover-backdrop" onClick={() => setFilterOpen(false)} />
          )}
          <div
            className={isMobile ? 'modal-overlay' : 'filter-popover'}
            onClick={isMobile ? () => setFilterOpen(false) : undefined}
          >
            <div
              className={isMobile ? 'modal-content-clay filter-sheet' : 'filter-popover-panel'}
              onClick={(e) => e.stopPropagation()}
            >
              {isMobile && <div className="bottom-sheet-handle" />}
              <div className="modal-header-clay">
                <div className="modal-title-clay">Filter Performance Records</div>
                <button className="modal-close-btn" onClick={() => setFilterOpen(false)}>
                  <Icon icon={Icons.Close} />
                </button>
              </div>
              <div className="modal-body-clay">
                <div className="form-group">
                  <label className="form-label">Employee</label>
                  <select
                    className="form-control-clay"
                    value={draftFilters.employee_id}
                    onChange={(e) =>
                      setDraftFilters((f) => ({ ...f, employee_id: e.target.value }))
                    }
                  >
                    <option value="">All employees</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name} ({e.employee_code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Review From</label>
                    <input
                      type="date"
                      className="form-control-clay"
                      value={draftFilters.date_from}
                      onChange={(e) =>
                        setDraftFilters((f) => ({ ...f, date_from: e.target.value }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Review To</label>
                    <input
                      type="date"
                      className="form-control-clay"
                      value={draftFilters.date_to}
                      onChange={(e) => setDraftFilters((f) => ({ ...f, date_to: e.target.value }))}
                    />
                  </div>
                </div>
                <div
                  className="form-inline-flex"
                  style={{ justifyContent: 'flex-end', gap: '0.5rem' }}
                >
                  <button
                    className="btn-clay btn-clay-secondary btn-clay-sm"
                    onClick={() => {
                      setDraftFilters({ employee_id: '', date_from: '', date_to: '' });
                      setFilters({ employee_id: '', date_from: '', date_to: '' });
                      setPage(1);
                      setFilterOpen(false);
                    }}
                  >
                    Reset
                  </button>
                  <button
                    className="btn-clay btn-clay-primary btn-clay-sm"
                    onClick={() => {
                      setFilters({ ...draftFilters });
                      setPage(1);
                      setFilterOpen(false);
                    }}
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}