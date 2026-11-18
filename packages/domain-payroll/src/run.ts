/**
 * Payroll run lifecycle.
 *
 *   create → (draft) → calculate (snapshots entries) → approve → pay
 *   draft/calculated may be cancelled; approved/paid runs are immutable
 *   (recalculation is blocked so paid payroll never silently changes).
 *
 * Runs are scoped to a period month; one non-cancelled run per month.
 */

import { query, withTransaction } from '@jsk/shared-kernel';
import { parseCents, centsToString } from './money';
import { calculatePayroll } from './calculator';
import type { CalcComponent, CalcInput, CalcAdjustment, CalcResult } from './calculator';
import { getPayrollSettings } from './settings';
import type { PayrollSettings } from './settings';
import { daysInMonth, scheduledWorkingDays } from './calculator';

export type PayrollRunStatus = 'draft' | 'calculated' | 'approved' | 'paid' | 'cancelled';
export type PaymentMethod = 'bank_transfer' | 'cash' | 'cheque' | 'other';

export interface PayrollRun {
  id: string;
  period_month: string;
  status: PayrollRunStatus;
  payment_date: string | null;
  payment_method: PaymentMethod | null;
  payment_reference: string;
  payment_notes: string;
  gross_total: string;
  earnings_total: string;
  deductions_total: string;
  net_total: string;
  run_by: string | null;
  calculated_by: string | null;
  approved_by: string | null;
  paid_by: string | null;
  calculated_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  employee_count?: number | undefined;
  paid_count?: number | undefined;
}

export interface PayrollEntry {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  employee_salary_id: string;
  period_month: string;
  gross_pay: string;
  total_earnings: string;
  total_deductions: string;
  net_pay: string;
  attendance_deduction: string;
  late_deduction: string;
  unpaid_leave_deduction: string;
  loan_deduction: string;
  adjustment_earnings: string;
  adjustment_deductions: string;
  working_days: number;
  payable_days: number;
  absent_days: number;
  late_days: number;
  unpaid_leave_days: string;
  payment_status: 'unpaid' | 'paid';
  calculated_at: string;
  approved_at: string | null;
  paid_at: string | null;
  snapshot: unknown;
  employee_code?: string | undefined;
  employee_name?: string | undefined;
  department_name?: string | undefined;
  position_name?: string | undefined;
  lines?: PayrollEntryLine[] | undefined;
}

export interface PayrollEntryLine {
  id: string;
  payroll_entry_id: string;
  salary_component_id: string | null;
  name: string;
  type: 'earning' | 'deduction';
  amount: string;
  source: string;
  description: string;
}

export interface PayrollAdjustment {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  salary_component_id: string | null;
  type: 'earning' | 'deduction';
  amount: string;
  reason: string;
  added_by: string | null;
  created_at: string;
  employee_code?: string | undefined;
  employee_name?: string | undefined;
  component_name?: string | undefined;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

function assertPeriod(period: string): void {
  if (!MONTH_RE.test(period)) throw new Error('payroll_run.invalid_period');
}

function periodEnd(monthFirst: string): string {
  const [y, m] = monthFirst.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthFirst.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Data integration helpers (attendance / leave / loans / holidays)
// ---------------------------------------------------------------------------

async function fetchMonthStats(
  employeeId: string,
  start: string,
  end: string,
  settings: PayrollSettings
): Promise<{ absentDays: number; lateDays: number; unpaidLeaveDays: string; workingDays: number }> {
  const { rows: att } = await query<{ absent: number; late: number }>(
    `SELECT
       count(*) FILTER (WHERE status IN ('Absent','Missing'))::int AS absent,
       count(*) FILTER (WHERE status = 'Late' AND late_minutes > 0)::int AS late
       FROM attendance_days
      WHERE employee_id = $1 AND work_date BETWEEN $2 AND $3`,
    [employeeId, start, end]
  );
  const { rows: leave } = await query<{ days: string }>(
    `SELECT count(*)::numeric(6,2) AS days
       FROM leave_applications la
       JOIN leave_types lt ON lt.id = la.leave_type_id
      WHERE la.employee_id = $1
        AND la.status = 'approved'
        AND la.deleted_at IS NULL
        AND lt.is_paid = false
        AND la.start_date <= $3 AND la.end_date >= $2`,
    [employeeId, start, end]
  );
  const workingDays =
    settings.working_day_calculation === 'scheduled_working_days'
      ? scheduledWorkingDays(start, await fetchMonthHolidays(start))
      : daysInMonth(start);
  return {
    absentDays: att[0]?.absent ?? 0,
    lateDays: att[0]?.late ?? 0,
    unpaidLeaveDays: leave[0]?.days ?? '0',
    workingDays,
  };
}

async function fetchMonthHolidays(monthFirst: string): Promise<string[]> {
  const { rows } = await query<{ holiday_date: string }>(
    `SELECT holiday_date::text AS holiday_date FROM holidays
      WHERE is_active AND deleted_at IS NULL
        AND holiday_date >= $1::date AND holiday_date < ($1::date + interval '1 month')`,
    [monthFirst]
  );
  return rows.map((r) => r.holiday_date);
}

async function fetchLoanDue(employeeId: string, start: string, end: string): Promise<string> {
  const { rows } = await query<{ total: string }>(
    `SELECT COALESCE(sum(amount), 0)::text AS total
       FROM loan_installments
      WHERE loan_id IN (SELECT id FROM loans WHERE employee_id = $1 AND status IN ('active','closed'))
        AND status IN ('pending','overdue')
        AND due_date BETWEEN $2 AND $3`,
    [employeeId, start, end]
  );
  return rows[0]?.total ?? '0';
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function listRuns(input: {
  page?: number | undefined;
  per_page?: number | undefined;
  status?: PayrollRunStatus | undefined;
} = {}): Promise<{ items: PayrollRun[]; total: number }> {
  const page = input.page ?? 1;
  const perPage = input.per_page ?? 10;
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.status) {
    params.push(input.status);
    clauses.push(`pr.status = $${params.length}`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(perPage, (page - 1) * perPage);
  const { rows } = await query<PayrollRun>(
    `SELECT pr.*,
            (SELECT count(*)::int FROM payroll_entries pe WHERE pe.payroll_run_id = pr.id) AS employee_count,
            (SELECT count(*)::int FROM payroll_entries pe WHERE pe.payroll_run_id = pr.id AND pe.payment_status = 'paid') AS paid_count
       FROM payroll_runs pr
       ${where}
      ORDER BY pr.period_month DESC, pr.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { rows: totalRows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM payroll_runs pr ${where}`,
    params.slice(0, clauses.length)
  );
  return { items: rows, total: totalRows[0]?.n ?? 0 };
}

export async function getRun(id: string): Promise<PayrollRun | null> {
  const { rows } = await query<PayrollRun>(`SELECT * FROM payroll_runs WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createRun(
  period: string,
  runBy: string | null
): Promise<PayrollRun> {
  assertPeriod(period);
  const settings = await getPayrollSettings();
  return withTransaction(async (client) => {
    const exists = await client.query(
      `SELECT id FROM payroll_runs WHERE period_month = $1::date AND status <> 'cancelled'`,
      [period]
    );
    if (exists.rows.length > 0) throw new Error('payroll_run.duplicate_period');
    const paymentDay = Math.min(Math.max(settings.default_payment_day, 1), 28);
    const { rows } = await client.query<PayrollRun>(
      `INSERT INTO payroll_runs (period_month, status, payment_date, run_by)
       VALUES ($1::date, 'draft', ($1::date + interval '1 month' + (($2 - 1) || ' days')::interval)::date, $3)
       RETURNING *`,
      [period, paymentDay, runBy]
    );
    return rows[0];
  });
}

/** Employees eligible for a run: active employees with an applicable salary. */
export async function listRunCandidates(period: string): Promise<
  Array<{ employee_id: string; employee_code: string; employee_name: string; department_name: string | null; salary_id: string; structure_id: string; structure_name: string; gross_salary: string; effective_from: string }>
> {
  assertPeriod(period);
  const start = period;
  const end = periodEnd(period);
  const { rows } = await query<{
    employee_id: string;
    employee_code: string;
    employee_name: string;
    department_name: string | null;
    salary_id: string;
    structure_id: string;
    structure_name: string;
    gross_salary: string;
    effective_from: string;
  }>(`SELECT e.id AS employee_id, e.employee_code, e.full_name AS employee_name,
            d.name AS department_name, es.id AS salary_id, es.salary_structure_id AS structure_id,
            ss.name AS structure_name, es.gross_salary, es.effective_from
       FROM employees e
       JOIN LATERAL (
         SELECT id, salary_structure_id, gross_salary, effective_from
           FROM employee_salaries
          WHERE employee_id = e.id
            AND effective_from <= $2::date
            AND (effective_to IS NULL OR effective_to >= $1::date)
          ORDER BY effective_from DESC, created_at DESC LIMIT 1
       ) es ON true
       JOIN salary_structures ss ON ss.id = es.salary_structure_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.status = 'active' AND e.deleted_at IS NULL
      ORDER BY e.employee_code`,
    [start, end]
  );
  return rows;
}

/** Builds the per-employee calculation input (structure + overrides + stats). */
async function buildCalcInput(
  employeeId: string,
  salaryId: string,
  structureId: string,
  period: string,
  settings: PayrollSettings,
  adjustments: CalcAdjustment[]
): Promise<CalcInput> {
  const end = periodEnd(period);
  const { rows: salary } = await query<{ gross_salary: string }>(
    `SELECT gross_salary::text FROM employee_salaries WHERE id = $1`,
    [salaryId]
  );
  const { rows: comps } = await query<CalcComponent>(
    `SELECT sc.id, sc.name, sc.code, sc.type, scc.calculation_type,
            scc.percentage_of_component, scc.amount, sc.sort_order
       FROM salary_structure_components scc
       JOIN salary_components sc ON sc.id = scc.component_id
      WHERE scc.structure_id = $1 AND sc.deleted_at IS NULL
      ORDER BY sc.sort_order, sc.name`,
    [structureId]
  );
  const { rows: overrideRows } = await query<{ component_id: string; amount: string }>(
    `SELECT component_id, amount::text AS amount FROM employee_salary_overrides WHERE employee_salary_id = $1`,
    [salaryId]
  );
  const overrides = new Map<string, string>();
  for (const o of overrideRows) overrides.set(o.component_id, o.amount);
  const stats = await fetchMonthStats(employeeId, period, end, settings);
  const loan = await fetchLoanDue(employeeId, period, end);
  return {
    grossSalary: salary[0]?.gross_salary ?? '0',
    basis: settings.salary_calculation_basis,
    components: comps,
    overrides,
    workingDays: stats.workingDays,
    absentDays: stats.absentDays,
    lateDays: stats.lateDays,
    unpaidLeaveDays: stats.unpaidLeaveDays,
    loanDeduction: loan,
    attendanceEnabled: settings.attendance_deduction,
    lateEnabled: settings.late_deduction,
    leaveEnabled: settings.unpaid_leave_deduction,
    rounding: settings.rounding_rule,
    adjustments,
  };
}

export async function calculateRun(runId: string, userId: string | null): Promise<PayrollRun> {
  return withTransaction(async (client) => {
    const runRows = await client.query<PayrollRun>(`SELECT * FROM payroll_runs WHERE id = $1`, [runId]);
    if (runRows.rows.length === 0) throw new Error('payroll_run.not_found');
    const run = runRows.rows[0];
    if (run.status === 'approved' || run.status === 'paid' || run.status === 'cancelled') {
      throw new Error('payroll_run.locked');
    }
    const period = String(run.period_month).slice(0, 10);
    const settings = await getPayrollSettings();
    const candidates = await listRunCandidates(period);
    const adjustments = await listAdjustmentsForRun(runId);

    await client.query('DELETE FROM payroll_entries WHERE payroll_run_id = $1', [runId]);

    for (const candidate of candidates) {
      const adjList = adjustments
        .filter((a) => a.employee_id === candidate.employee_id)
        .map((a) => ({
          type: a.type,
          amount: a.amount,
          component_id: a.salary_component_id,
          component_name: a.component_name ?? null,
          reason: a.reason,
        }));
      const input = await buildCalcInput(
        candidate.employee_id,
        candidate.salary_id,
        candidate.structure_id,
        period,
        settings,
        adjList
      );
      const result: CalcResult = calculatePayroll(input);
      const { rows: inserted } = await client.query<{ id: string }>(
        `INSERT INTO payroll_entries
           (payroll_run_id, employee_id, employee_salary_id, period_month,
            gross_pay, total_earnings, total_deductions, net_pay,
            attendance_deduction, late_deduction, unpaid_leave_deduction, loan_deduction,
            adjustment_earnings, adjustment_deductions,
            working_days, payable_days, absent_days, late_days, unpaid_leave_days,
            snapshot)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING id`,
        [
          runId, candidate.employee_id, candidate.salary_id, period,
          result.grossPay, result.totalEarnings, result.totalDeductions, result.netPay,
          result.attendanceDeduction, result.lateDeduction, result.unpaidLeaveDeduction, result.loanDeduction,
          result.adjustmentEarnings, result.adjustmentDeductions,
          result.workingDays, result.payableDays, result.absentDays, result.lateDays, result.unpaidLeaveDays,
          JSON.stringify({
            structure_name: candidate.structure_name,
            gross_salary: candidate.gross_salary,
            basis: settings.salary_calculation_basis,
            working_day_calculation: settings.working_day_calculation,
            daily_rate: result.workingDays > 0
              ? centsToString((parseCents(result.grossPay) / BigInt(result.workingDays)))
              : '0.00',
            flags: {
              attendance_deduction: settings.attendance_deduction,
              late_deduction: settings.late_deduction,
              unpaid_leave_deduction: settings.unpaid_leave_deduction,
              overtime_enabled: settings.overtime_enabled,
            },
            currency: settings.default_currency,
            period,
          }),
        ]
      );
      for (const line of result.lines) {
        await client.query(
          `INSERT INTO payroll_entry_lines
             (payroll_entry_id, salary_component_id, name, type, amount, source, description)
           VALUES ($1, NULLIF($2,'')::uuid, $3, $4, $5, $6, $7)`,
          [
            inserted[0].id, line.component_id ?? '', line.name, line.type,
            line.amount, line.source, line.description,
          ]
        );
      }
    }
    const totals = await client.query<{ gross: string; earnings: string; deductions: string; net: string }>(
      `SELECT COALESCE(sum(gross_pay),0)::text AS gross,
              COALESCE(sum(total_earnings),0)::text AS earnings,
              COALESCE(sum(total_deductions),0)::text AS deductions,
              COALESCE(sum(net_pay),0)::text AS net
         FROM payroll_entries WHERE payroll_run_id = $1`,
      [runId]
    );
    const t = totals.rows[0];
    const { rows: updated } = await client.query<PayrollRun>(
      `UPDATE payroll_runs
          SET status = 'calculated', calculated_by = $2, calculated_at = now(),
              gross_total = $3, earnings_total = $4, deductions_total = $5, net_total = $6,
              updated_at = now()
        WHERE id = $1 RETURNING *`,
      [runId, userId, t.gross, t.earnings, t.deductions, t.net]
    );
    return updated[0];
  });
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

export async function listAdjustmentsForRun(runId: string): Promise<PayrollAdjustment[]> {
  const { rows } = await query<PayrollAdjustment>(
    `SELECT pa.*, e.employee_code, e.full_name AS employee_name, sc.name AS component_name
       FROM payroll_adjustments pa
       JOIN employees e ON e.id = pa.employee_id
       LEFT JOIN salary_components sc ON sc.id = pa.salary_component_id
      WHERE pa.payroll_run_id = $1
      ORDER BY pa.created_at DESC`,
    [runId]
  );
  return rows;
}

export async function addAdjustment(input: {
  payroll_run_id: string;
  employee_id: string;
  type: 'earning' | 'deduction';
  amount: string;
  salary_component_id?: string | null | undefined;
  reason?: string | undefined;
  added_by?: string | null | undefined;
}): Promise<PayrollAdjustment> {
  const run = await getRun(input.payroll_run_id);
  if (!run) throw new Error('payroll_run.not_found');
  if (run.status !== 'draft' && run.status !== 'calculated') {
    throw new Error('payroll_run.locked');
  }
  let amount: bigint;
  try {
    amount = parseCents(input.amount);
  } catch {
    throw new Error('payroll_adjustment.invalid_amount');
  }
  if (amount <= 0n) throw new Error('payroll_adjustment.invalid_amount');
  const { rows } = await query<PayrollAdjustment>(
    `INSERT INTO payroll_adjustments
       (payroll_run_id, employee_id, salary_component_id, type, amount, reason, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      input.payroll_run_id,
      input.employee_id,
      input.salary_component_id ?? null,
      input.type,
      centsToString(amount),
      input.reason ?? '',
      input.added_by ?? null,
    ]
  );
  // Keep the run consistent: recalculate when adjustments change a calculated run.
  if (run.status === 'calculated') {
    await calculateRun(input.payroll_run_id, input.added_by ?? null);
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Approve / pay / cancel
// ---------------------------------------------------------------------------

export async function approveRun(runId: string, userId: string | null): Promise<PayrollRun> {
  const run = await getRun(runId);
  if (!run) throw new Error('payroll_run.not_found');
  if (run.status !== 'calculated') throw new Error('payroll_run.must_be_calculated');
  const { rows } = await query<PayrollRun>(
    `UPDATE payroll_runs
        SET status = 'approved', approved_by = $2, approved_at = now(), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [runId, userId]
  );
  await query(
    `UPDATE payroll_entries SET approved_at = now() WHERE payroll_run_id = $1 AND approved_at IS NULL`,
    [runId]
  );
  return rows[0];
}

export async function payRun(
  runId: string,
  input: { payment_date: string; payment_method: PaymentMethod; payment_reference?: string | undefined; payment_notes?: string | undefined },
  userId: string | null
): Promise<PayrollRun> {
  const run = await getRun(runId);
  if (!run) throw new Error('payroll_run.not_found');
  if (run.status !== 'approved') throw new Error('payroll_run.must_be_approved');
  return withTransaction(async (client) => {
    const { rows } = await client.query<PayrollRun>(
      `UPDATE payroll_runs
          SET status = 'paid', payment_date = $2::date, payment_method = $3,
              payment_reference = $4, payment_notes = $5,
              paid_by = $6, paid_at = now(), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [runId, input.payment_date, input.payment_method, input.payment_reference ?? '', input.payment_notes ?? '', userId]
    );
    const runRows = rows[0];
    await client.query(
      `UPDATE payroll_entries SET payment_status = 'paid', paid_at = now() WHERE payroll_run_id = $1 AND payment_status = 'unpaid'`,
      [runId]
    );
    // Mark the due loan installments that fed this run as paid (audit-safe).
    await client.query(
      `UPDATE loan_installments li
          SET status = 'paid', paid_date = $2::date
         FROM loans l, payroll_entries pe
        WHERE pe.payroll_run_id = $1
          AND pe.payment_status = 'paid'
          AND li.loan_id = l.id
          AND l.employee_id = pe.employee_id
          AND li.status IN ('pending','overdue')
          AND li.due_date BETWEEN pe.period_month::date
              AND (pe.period_month::date + interval '1 month' - interval '1 day')::date`,
      [runId, input.payment_date]
    );
    return runRows;
  });
}

export async function cancelRun(runId: string, _userId: string | null): Promise<PayrollRun> {
  const run = await getRun(runId);
  if (!run) throw new Error('payroll_run.not_found');
  if (run.status === 'paid' || run.status === 'approved') {
    throw new Error('payroll_run.locked');
  }
  const { rows } = await query<PayrollRun>(
    `UPDATE payroll_runs SET status = 'cancelled', cancelled_at = now(), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [runId]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Entries & payslips
// ---------------------------------------------------------------------------

export async function listRunEntries(
  runId: string,
  input: { employee_id?: string | undefined } = {}
): Promise<PayrollEntry[]> {
  const params: unknown[] = [runId];
  let extra = '';
  if (input.employee_id) {
    params.push(input.employee_id);
    extra = ' AND pe.employee_id = $2';
  }
  const { rows } = await query<PayrollEntry>(
    `SELECT pe.*, e.employee_code, e.full_name AS employee_name, d.name AS department_name,
            p.name AS position_name
       FROM payroll_entries pe
       JOIN employees e ON e.id = pe.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN positions p ON p.id = e.position_id
      WHERE pe.payroll_run_id = $1${extra}
      ORDER BY e.employee_code`,
    params
  );
  if (rows.length === 0) return [];
  const { rows: lines } = await query<PayrollEntryLine>(
    `SELECT * FROM payroll_entry_lines WHERE payroll_entry_id = ANY($1) ORDER BY id`,
    [rows.map((r) => r.id)]
  );
  const byEntry = new Map<string, PayrollEntryLine[]>();
  for (const l of lines) {
    const list = byEntry.get(l.payroll_entry_id) ?? [];
    list.push(l);
    byEntry.set(l.payroll_entry_id, list);
  }
  return rows.map((r) => ({ ...r, lines: byEntry.get(r.id) ?? [] }));
}

/** Payslips visible to a user: own only, or all when payslip.view_all. */
export async function listPayslips(input: {
  employee_id?: string | undefined;
  period?: string | undefined;
  page?: number | undefined;
  per_page?: number | undefined;
}): Promise<{ items: PayrollEntry[]; total: number }> {
  const page = input.page ?? 1;
  const perPage = input.per_page ?? 25;
  const clauses: string[] = ['pr.status IN (\'approved\',\'paid\')'];
  const params: unknown[] = [];
  if (input.employee_id) {
    params.push(input.employee_id);
    clauses.push(`pe.employee_id = $${params.length}`);
  }
  if (input.period) {
    params.push(input.period);
    clauses.push(`pe.period_month = $${params.length}::date`);
  }
  const where = clauses.join(' AND ');
  const filterCount = params.length;
  params.push(perPage, (page - 1) * perPage);
  const { rows } = await query<PayrollEntry>(
    `SELECT pe.*, e.employee_code, e.full_name AS employee_name, d.name AS department_name,
            p.name AS position_name
       FROM payroll_entries pe
       JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
       JOIN employees e ON e.id = pe.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN positions p ON p.id = e.position_id
      WHERE ${where}
      ORDER BY pe.period_month DESC, e.employee_code
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { rows: totalRows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM payroll_entries pe
       JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
      WHERE ${where}`,
    params.slice(0, filterCount)
  );
  if (rows.length === 0) return { items: [], total: totalRows[0]?.n ?? 0 };
  const { rows: lines } = await query<PayrollEntryLine>(
    `SELECT * FROM payroll_entry_lines WHERE payroll_entry_id = ANY($1) ORDER BY id`,
    [rows.map((r) => r.id)]
  );
  const byEntry = new Map<string, PayrollEntryLine[]>();
  for (const l of lines) {
    const list = byEntry.get(l.payroll_entry_id) ?? [];
    list.push(l);
    byEntry.set(l.payroll_entry_id, list);
  }
  return { items: rows.map((r) => ({ ...r, lines: byEntry.get(r.id) ?? [] })), total: totalRows[0]?.n ?? 0 };
}

export async function getPayslip(entryId: string): Promise<PayrollEntry | null> {
  const { rows } = await query<PayrollEntry>(
    `SELECT pe.*, e.employee_code, e.full_name AS employee_name, d.name AS department_name,
            p.name AS position_name, pr.payment_date
       FROM payroll_entries pe
       JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
       JOIN employees e ON e.id = pe.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN positions p ON p.id = e.position_id
      WHERE pe.id = $1 AND pr.status IN ('approved','paid')`,
    [entryId]
  );
  if (rows.length === 0) return null;
  const { rows: lines } = await query<PayrollEntryLine>(
    `SELECT * FROM payroll_entry_lines WHERE payroll_entry_id = $1 ORDER BY id`,
    [entryId]
  );
  return { ...rows[0], lines };
}

// ---------------------------------------------------------------------------
// Totals helper (used by dashboard/reports)
// ---------------------------------------------------------------------------

export async function runTotals(runId: string): Promise<{
  gross: string; earnings: string; deductions: string; net: string; employeeCount: number; paidCount: number;
}> {
  const { rows } = await query(
    `SELECT COALESCE(sum(gross_pay),0)::text AS gross,
            COALESCE(sum(total_earnings),0)::text AS earnings,
            COALESCE(sum(total_deductions),0)::text AS deductions,
            COALESCE(sum(net_pay),0)::text AS net,
            count(*)::int AS employee_count,
            count(*) FILTER (WHERE payment_status = 'paid')::int AS paid_count
       FROM payroll_entries WHERE payroll_run_id = $1`,
    [runId]
  );
  const r = rows[0];
  return {
    gross: r.gross, earnings: r.earnings, deductions: r.deductions, net: r.net,
    employeeCount: r.employee_count, paidCount: r.paid_count,
  };
}