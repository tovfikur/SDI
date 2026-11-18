/**
 * Payroll analytics — dashboard KPIs + chart series, backed by real
 * snapshotted payroll data (approved/paid runs only).
 */

import { query } from '@jsk/shared-kernel';

export interface PayrollDashboardData {
  latest_period: string | null;
  latest_status: string | null;
  month_net_total: string;
  month_employee_count: number;
  month_paid_count: number;
  month_gross_total: string;
  month_deductions_total: string;
  month_attendance_deduction: string;
  month_leave_deduction: string;
  month_loan_deduction: string;
  month_adjustment_earnings: string;
  month_adjustment_deductions: string;
  year_net_total: string;
  total_runs: number;
  total_employees: number;
  month_trend: Array<{ period: string; gross_total: string; net_total: string }>;
  department_breakdown: Array<{ department_name: string; net_total: string }>;
  earnings_vs_deductions: Array<{ period: string; earnings_total: string; deductions_total: string }>;
  payment_status: Array<{ status: string; employee_count: number; net_total: string }>;
}

export async function getPayrollDashboard(): Promise<PayrollDashboardData> {
  const latest = await query<{ period: string; status: string }>(
    `SELECT period_month::text AS period, status
       FROM payroll_runs
      WHERE status IN ('calculated','approved','paid')
      ORDER BY period_month DESC LIMIT 1`
  );
  const latestPeriod = latest.rows[0]?.period ?? null;

  const monthRow = latestPeriod
    ? await query(
        `SELECT COALESCE(sum(net_pay),0)::text AS net_total,
                count(*)::int AS employee_count,
                count(*) FILTER (WHERE payment_status = 'paid')::int AS paid_count,
                COALESCE(sum(gross_pay),0)::text AS gross_total,
                COALESCE(sum(total_deductions),0)::text AS deductions_total,
                COALESCE(sum(attendance_deduction),0)::text AS attendance_deduction,
                COALESCE(sum(unpaid_leave_deduction),0)::text AS leave_deduction,
                COALESCE(sum(loan_deduction),0)::text AS loan_deduction,
                COALESCE(sum(adjustment_earnings),0)::text AS adjustment_earnings,
                COALESCE(sum(adjustment_deductions),0)::text AS adjustment_deductions
           FROM payroll_entries WHERE period_month = $1::date`,
        [latestPeriod]
      )
    : { rows: [{}] };

  const trendRows = await query<{ period: string; gross_total: string; net_total: string }>(
    `SELECT pe.period_month::text AS period,
            sum(pe.gross_pay)::text AS gross_total, sum(pe.net_pay)::text AS net_total
       FROM payroll_entries pe
       JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
      WHERE pr.status IN ('approved','paid')
      GROUP BY pe.period_month
      ORDER BY pe.period_month DESC
      LIMIT 6`
  );

  const deptRows = await query<{ department_name: string; net_total: string }>(
    `SELECT COALESCE(d.name, 'Unassigned') AS department_name, sum(pe.net_pay)::text AS net_total
       FROM payroll_entries pe
       JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
       JOIN employees e ON e.id = pe.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE pr.status IN ('approved','paid')
        AND ($1::date IS NULL OR pe.period_month = $1::date)
      GROUP BY COALESCE(d.name, 'Unassigned')
      ORDER BY net_total DESC LIMIT 8`,
    [latestPeriod]
  );

  const evdRows = await query<{ period: string; earnings_total: string; deductions_total: string }>(
    `SELECT pe.period_month::text AS period,
            sum(pe.total_earnings)::text AS earnings_total,
            sum(pe.total_deductions)::text AS deductions_total
       FROM payroll_entries pe
       JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
      WHERE pr.status IN ('approved','paid')
      GROUP BY pe.period_month
      ORDER BY pe.period_month DESC
      LIMIT 6`
  );

  const payStatusRows = await query<{ status: string; employee_count: number; net_total: string }>(
    `SELECT pe.payment_status AS status, count(*)::int AS employee_count, sum(pe.net_pay)::text AS net_total
       FROM payroll_entries pe
       JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
      WHERE pr.status IN ('approved','paid')
        AND ($1::date IS NULL OR pe.period_month = $1::date)
      GROUP BY pe.payment_status
      ORDER BY pe.payment_status`,
    [latestPeriod]
  );

  const totals = await query<{ net_total: string }>(
    `SELECT COALESCE(sum(pe.net_pay),0)::text AS net_total
       FROM payroll_entries pe
       JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
      WHERE pr.status IN ('approved','paid')
        AND pe.period_month >= date_trunc('year', now())::date`
  );
  const runCount = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM payroll_runs WHERE status IN ('calculated','approved','paid')`
  );
  const employeeCount = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM employees WHERE status = 'active' AND deleted_at IS NULL`
  );

  const m = monthRow.rows[0] as Record<string, string | number>;
  return {
    latest_period: latestPeriod,
    latest_status: latest.rows[0]?.status ?? null,
    month_net_total: String(m.net_total ?? '0'),
    month_employee_count: Number(m.employee_count ?? 0),
    month_paid_count: Number(m.paid_count ?? 0),
    month_gross_total: String(m.gross_total ?? '0'),
    month_deductions_total: String(m.deductions_total ?? '0'),
    month_attendance_deduction: String(m.attendance_deduction ?? '0'),
    month_leave_deduction: String(m.leave_deduction ?? '0'),
    month_loan_deduction: String(m.loan_deduction ?? '0'),
    month_adjustment_earnings: String(m.adjustment_earnings ?? '0'),
    month_adjustment_deductions: String(m.adjustment_deductions ?? '0'),
    year_net_total: totals.rows[0]?.net_total ?? '0',
    total_runs: runCount.rows[0]?.n ?? 0,
    total_employees: employeeCount.rows[0]?.n ?? 0,
    month_trend: trendRows.rows,
    department_breakdown: deptRows.rows,
    earnings_vs_deductions: evdRows.rows,
    payment_status: payStatusRows.rows,
  };
}