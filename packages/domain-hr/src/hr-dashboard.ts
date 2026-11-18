import { query } from '@jsk/shared-kernel';

// ---------------------------------------------------------------------------
// HR Dashboard (premium dashboard aggregation)
// Query helpers + pure computation helpers (kept pure so they are unit-testable
// without a database).
// ---------------------------------------------------------------------------

export async function activeEmployeeCount(): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM employees WHERE status = 'active'`
  );
  return rows[0]?.n ?? 0;
}

export async function newHiresCount(days: number): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM employees
      WHERE status = 'active' AND joining_date IS NOT NULL
        AND joining_date >= CURRENT_DATE - $1::int`,
    [days]
  );
  return rows[0]?.n ?? 0;
}

export async function pendingLeaveCount(): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM leave_applications
      WHERE status = 'pending' AND deleted_at IS NULL`
  );
  return rows[0]?.n ?? 0;
}

export async function recentHires(limit = 8): Promise<Record<string, unknown>[]> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT e.id, e.full_name, e.employee_code, e.joining_date, e.photo_file_id,
            COALESCE(p.name, 'Unassigned') AS position_name,
            COALESCE(d.name, 'Unassigned') AS department_name
       FROM employees e
       LEFT JOIN positions p ON p.id = e.position_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.status = 'active' AND e.joining_date IS NOT NULL
      ORDER BY e.joining_date DESC, e.created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function hiresByPosition(days: number): Promise<Record<string, unknown>[]> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT e.position_id, COALESCE(p.name, 'Unassigned') AS position_name,
            COUNT(*)::int AS count,
            MAX(e.joining_date)::text AS latest_joining_date
       FROM employees e
       LEFT JOIN positions p ON p.id = e.position_id
      WHERE e.status = 'active' AND e.joining_date IS NOT NULL
        AND e.joining_date >= CURRENT_DATE - $1::int
      GROUP BY e.position_id, p.name
      ORDER BY count DESC, position_name`,
    [days]
  );
  return rows;
}

export async function pendingLeaveRequests(limit = 8): Promise<{ items: Record<string, unknown>[]; total: number }> {
  const countRes = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM leave_applications
      WHERE status = 'pending' AND deleted_at IS NULL`
  );
  const { rows } = await query<Record<string, unknown>>(
    `SELECT la.id, la.start_date, la.end_date, la.requested_days, la.reason, la.status,
            la.created_at,
            e.id AS employee_id, e.full_name, e.employee_code,
            COALESCE(p.name, 'Unassigned') AS position_name,
            COALESCE(d.name, 'Unassigned') AS department_name,
            lt.name AS leave_type
       FROM leave_applications la
       JOIN employees e ON e.id = la.employee_id
       LEFT JOIN positions p ON p.id = e.position_id
       LEFT JOIN departments d ON d.id = e.department_id
       JOIN leave_types lt ON lt.id = la.leave_type_id
      WHERE la.status = 'pending' AND la.deleted_at IS NULL
      ORDER BY la.created_at DESC
      LIMIT $1`,
    [limit]
  );
  return { items: rows, total: countRes.rows[0]?.n ?? 0 };
}

/** Raw loan/installment aggregate for active loans. */
export async function loanRecovery(): Promise<Record<string, unknown>> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT
       COUNT(DISTINCT l.id)::int AS active_loans,
       COALESCE(SUM(l.amount), 0)::float8 AS active_amount,
       COALESCE(SUM(li.amount), 0)::float8 AS total_payable,
       COALESCE(SUM(li.amount) FILTER (WHERE li.status = 'paid'), 0)::float8 AS paid_total,
       COALESCE(SUM(li.amount) FILTER (WHERE li.status = 'paid' AND li.paid_date >= date_trunc('month', CURRENT_DATE)), 0)::float8 AS paid_this_month,
       COALESCE(SUM(li.amount) FILTER (WHERE li.status = 'pending'), 0)::float8 AS outstanding,
       COALESCE(COUNT(*) FILTER (WHERE li.status = 'overdue'), 0)::int AS overdue_count,
       COALESCE(SUM(li.amount) FILTER (WHERE li.status = 'overdue'), 0)::float8 AS overdue_amount,
       COUNT(li.id)::int AS installment_count,
       COUNT(*) FILTER (WHERE li.status = 'paid')::int AS paid_count
       FROM loans l
       JOIN loan_installments li ON li.loan_id = l.id
      WHERE l.deleted_at IS NULL AND l.status = 'active'`
  );
  return rows[0] ?? {};
}

/** Candidate active employees for the attention panel (birthdays/anniversaries/contracts). */
export async function attentionEmployees(): Promise<Record<string, unknown>[]> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT e.id, e.full_name, e.employee_code, e.date_of_birth, e.joining_date,
            e.contract_end_date,
            COALESCE(d.name, 'Unassigned') AS department_name
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.status = 'active'`
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Pure computation helpers (unit-testable)
// ---------------------------------------------------------------------------

export interface TodayKpis {
  totalActive: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
  onLeaveToday: number;
  pendingLeaveRequests: number;
  newHires30: number;
}

/** Present Today = Present + Late; Absent Today = Absent + Missing. */
export function computeTodayKPIs(input: {
  totalActive: number;
  today: Array<{ status: string; n: number | string }>;
  pendingLeaveRequests: number;
  newHires30: number;
}): TodayKpis {
  const n = (s: string): number => {
    const row = input.today.find((t) => t.status === s);
    return row ? Number(row.n) : 0;
  };
  const present = n('Present');
  const late = n('Late');
  const absent = n('Absent');
  const missing = n('Missing');
  const leave = n('Leave');
  return {
    totalActive: input.totalActive,
    presentToday: present + late,
    lateToday: late,
    absentToday: absent + missing,
    onLeaveToday: leave,
    pendingLeaveRequests: input.pendingLeaveRequests,
    newHires30: input.newHires30,
  };
}

export interface LoanRecovery {
  active_loans: number;
  active_amount: number;
  total_payable: number;
  paid_total: number;
  paid_this_month: number;
  outstanding: number;
  overdue_count: number;
  overdue_amount: number;
  installment_count: number;
  paid_count: number;
  progress_pct: number;
}

/** Repayment progress = paid installments / total installments (× 100). */
export function computeLoanRecovery(raw: Record<string, unknown>): LoanRecovery {
  const num = (k: string): number => Number(raw[k] ?? 0);
  const installmentCount = num('installment_count');
  const paidCount = num('paid_count');
  const progressPct = installmentCount > 0 ? Math.round((paidCount / installmentCount) * 100) : 0;
  return {
    active_loans: num('active_loans'),
    active_amount: num('active_amount'),
    total_payable: num('total_payable'),
    paid_total: num('paid_total'),
    paid_this_month: num('paid_this_month'),
    outstanding: num('outstanding'),
    overdue_count: num('overdue_count'),
    overdue_amount: num('overdue_amount'),
    installment_count: installmentCount,
    paid_count: paidCount,
    progress_pct: progressPct,
  };
}

export interface AttentionItem {
  id: string;
  full_name: string;
  employee_code: string;
  label: string;
  date: string;
}

export interface Attention {
  expiringContracts: AttentionItem[];
  upcomingBirthdays: AttentionItem[];
  upcomingAnniversaries: AttentionItem[];
  pendingAttendanceApprovals: number;
}

export interface Candidate {
  id: string;
  full_name: string;
  employee_code: string;
  date_of_birth: string | Date | null;
  joining_date: string | Date | null;
  contract_end_date: string | Date | null;
}

/** Next occurrence of a month/day event (birthday/anniversary) from `asOf`. */
function nextOccurrence(monthDay: Date, asOf: Date): Date {
  const d = new Date(monthDay);
  d.setUTCFullYear(asOf.getUTCFullYear());
  if (d < asOf) {
    d.setUTCFullYear(asOf.getUTCFullYear() + 1);
  }
  return d;
}

/** Builds the HR Attention panel buckets. Handles month/day only (year-agnostic). */
export function computeAttention(
  employees: Candidate[],
  pendingAttendanceApprovals: number,
  asOf: Date = new Date()
): Attention {
  const toDate = (v: string | Date | null): Date | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const horizon = asOf.getTime() + 30 * 86_400_000;
  const expiringContracts: AttentionItem[] = [];
  const upcomingBirthdays: AttentionItem[] = [];
  const upcomingAnniversaries: AttentionItem[] = [];
  for (const e of employees) {
    if (e.contract_end_date) {
      const end = toDate(e.contract_end_date);
      if (end && end.getTime() >= asOf.getTime() && end.getTime() <= horizon) {
        expiringContracts.push({ id: e.id, full_name: e.full_name, employee_code: e.employee_code, label: 'Contract expires', date: end.toISOString().slice(0, 10) });
      }
    }
    const dob = toDate(e.date_of_birth);
    if (dob) {
      const next = nextOccurrence(dob, asOf);
      if (next.getTime() <= horizon) {
        upcomingBirthdays.push({ id: e.id, full_name: e.full_name, employee_code: e.employee_code, label: 'Birthday', date: next.toISOString().slice(0, 10) });
      }
    }
    const join = toDate(e.joining_date);
    if (join) {
      const next = nextOccurrence(join, asOf);
      if (next.getTime() <= horizon) {
        upcomingAnniversaries.push({ id: e.id, full_name: e.full_name, employee_code: e.employee_code, label: 'Work anniversary', date: next.toISOString().slice(0, 10) });
      }
    }
  }
  const byDate = (a: AttentionItem, b: AttentionItem): number => a.date.localeCompare(b.date);
  expiringContracts.sort(byDate);
  upcomingBirthdays.sort(byDate);
  upcomingAnniversaries.sort(byDate);
  return {
    expiringContracts,
    upcomingBirthdays,
    upcomingAnniversaries,
    pendingAttendanceApprovals,
  };
}

/** Normalizes hires-by-position rows (numeric count, sorted desc). */
export function computeHiresByPosition(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows
    .map((r) => ({ ...r, count: Number(r.count) }))
    .sort((a, b) => Number(b.count) - Number(a.count));
}