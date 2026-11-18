/**
 * Payroll reports — read-only, always computed from snapshotted entries
 * (approved/paid runs only, so numbers never shift).
 */

import { query } from '@jsk/shared-kernel';

export interface ReportRow {
  [key: string]: string | number | null;
}

function scopeClauses(scope: {
  period?: string | undefined;
  department_id?: string | undefined;
  employee_id?: string | undefined;
  payment_status?: 'unpaid' | 'paid' | undefined;
}): { where: string; params: unknown[] } {
  const clauses: string[] = ['pr.status IN (\'approved\',\'paid\')'];
  const params: unknown[] = [];
  if (scope.period) {
    const period = /^\d{4}-\d{2}$/.test(scope.period) ? `${scope.period}-01` : scope.period;
    params.push(period);
    clauses.push(`pe.period_month = $${params.length}::date`);
  }
  if (scope.department_id) {
    params.push(scope.department_id);
    clauses.push(`e.department_id = $${params.length}`);
  }
  if (scope.employee_id) {
    params.push(scope.employee_id);
    clauses.push(`pe.employee_id = $${params.length}`);
  }
  if (scope.payment_status) {
    params.push(scope.payment_status);
    clauses.push(`pe.payment_status = $${params.length}`);
  }
  return { where: clauses.join(' AND '), params };
}

export interface PayrollRegisterRow {
  period: string;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  position_name: string | null;
  gross_pay: string;
  total_deductions: string;
  net_pay: string;
  payment_status: string;
  paid_at: string | null;
}

export async function payrollRegister(scope: {
  period?: string | undefined;
  department_id?: string | undefined;
  employee_id?: string | undefined;
  payment_status?: 'unpaid' | 'paid' | undefined;
}): Promise<PayrollRegisterRow[]> {
  const { where, params } = scopeClauses(scope);
  const { rows } = await query<PayrollRegisterRow>(
    `SELECT pe.period_month::text AS period, e.employee_code, e.full_name AS employee_name,
            d.name AS department_name, p.name AS position_name,
            pe.gross_pay::text, pe.total_deductions::text, pe.net_pay::text,
            pe.payment_status, pe.paid_at::text AS paid_at
       FROM payroll_entries pe
       JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
       JOIN employees e ON e.id = pe.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN positions p ON p.id = e.position_id
      WHERE ${where}
      ORDER BY pe.period_month DESC, e.employee_code`,
    params
  );
  return rows;
}

export interface SalarySummaryRow {
  period: string;
  employee_count: number;
  gross_total: string;
  deduction_total: string;
  net_total: string;
}

export async function salarySummary(scope: {
  period?: string | undefined;
  department_id?: string | undefined;
}): Promise<SalarySummaryRow[]> {
  const { where, params } = scopeClauses(scope);
  const { rows } = await query<SalarySummaryRow>(
    `SELECT pe.period_month::text AS period, count(*)::int AS employee_count,
            sum(pe.gross_pay)::text AS gross_total,
            sum(pe.total_deductions)::text AS deduction_total,
            sum(pe.net_pay)::text AS net_total
       FROM payroll_entries pe
       JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
       JOIN employees e ON e.id = pe.employee_id
      WHERE ${where}
      GROUP BY pe.period_month
      ORDER BY pe.period_month DESC`,
    params
  );
  return rows;
}

export interface DepartmentSummaryRow {
  period: string;
  department_name: string;
  employee_count: number;
  gross_total: string;
  deduction_total: string;
  net_total: string;
}

export async function departmentSummary(scope: {
  period?: string | undefined;
}): Promise<DepartmentSummaryRow[]> {
  const { where, params } = scopeClauses(scope);
  const { rows } = await query<DepartmentSummaryRow>(
    `SELECT pe.period_month::text AS period, COALESCE(d.name, 'Unassigned') AS department_name,
            count(*)::int AS employee_count,
            sum(pe.gross_pay)::text AS gross_total,
            sum(pe.total_deductions)::text AS deduction_total,
            sum(pe.net_pay)::text AS net_total
       FROM payroll_entries pe
       JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
       JOIN employees e ON e.id = pe.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE ${where}
      GROUP BY pe.period_month, COALESCE(d.name, 'Unassigned')
      ORDER BY pe.period_month DESC, net_total DESC`,
    params
  );
  return rows;
}

export interface ComponentSummaryRow {
  period: string;
  line_name: string;
  line_type: string;
  line_source: string;
  total_amount: string;
}

export async function componentSummary(scope: {
  period?: string | undefined;
}): Promise<ComponentSummaryRow[]> {
  const { where, params } = scopeClauses(scope);
  const { rows } = await query<ComponentSummaryRow>(
    `SELECT pe.period_month::text AS period, pel.name AS line_name, pel.type AS line_type,
            pel.source AS line_source, sum(pel.amount)::text AS total_amount
       FROM payroll_entry_lines pel
       JOIN payroll_entries pe ON pe.id = pel.payroll_entry_id
       JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
      WHERE ${where}
      GROUP BY pe.period_month, pel.name, pel.type, pel.source
      ORDER BY pe.period_month DESC, total_amount DESC`,
    params
  );
  return rows;
}

export async function deductionSummary(scope: {
  period?: string | undefined;
}): Promise<ComponentSummaryRow[]> {
  const { where, params } = scopeClauses(scope);
  const { rows } = await query<ComponentSummaryRow>(
    `SELECT pe.period_month::text AS period, pel.name AS line_name, pel.type AS line_type,
            pel.source AS line_source, sum(pel.amount)::text AS total_amount
       FROM payroll_entry_lines pel
       JOIN payroll_entries pe ON pe.id = pel.payroll_entry_id
       JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
      WHERE pel.type = 'deduction' AND ${where}
      GROUP BY pe.period_month, pel.name, pel.type, pel.source
      ORDER BY pe.period_month DESC, total_amount DESC`,
    params
  );
  return rows;
}

export interface PaymentStatusSummaryRow {
  period: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  net_pay: string;
  payment_status: string;
  paid_at: string | null;
  payment_reference: string | null;
}

export async function paymentStatusSummary(scope: {
  period?: string | undefined;
  department_id?: string | undefined;
  employee_id?: string | undefined;
  payment_status?: 'unpaid' | 'paid' | undefined;
}): Promise<PaymentStatusSummaryRow[]> {
  const { where, params } = scopeClauses(scope);
  const { rows } = await query<PaymentStatusSummaryRow>(
    `SELECT pe.period_month::text AS period, pe.employee_id,
            e.employee_code, e.full_name AS employee_name,
            d.name AS department_name,
            pe.net_pay::text AS net_pay,
            pe.payment_status, pe.paid_at::text AS paid_at,
            NULLIF(pr.payment_reference, '') AS payment_reference
       FROM payroll_entries pe
       JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
       JOIN employees e ON e.id = pe.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE ${where}
      ORDER BY pe.period_month DESC, e.employee_code`,
    params
  );
  return rows;
}