/**
 * Payroll rules (singleton configuration row) — configurable business policy.
 * Nothing here is hardcoded into the calculator: the calculator consumes the
 * effective settings row.
 */

import { query } from '@jsk/shared-kernel';
import type { RoundingRule } from './money';

export type WorkingDayCalculation = 'calendar_days' | 'scheduled_working_days';
export type SalaryCalculationBasis = 'gross_salary' | 'basic_salary';

export interface PayrollSettings {
  id: number;
  period_label: string;
  salary_calculation_basis: SalaryCalculationBasis;
  attendance_deduction: boolean;
  late_deduction: boolean;
  overtime_enabled: boolean;
  unpaid_leave_deduction: boolean;
  rounding_rule: RoundingRule;
  working_day_calculation: WorkingDayCalculation;
  default_payment_day: number;
  default_currency: string;
  updated_at: string;
}

export interface PayrollSettingsPatch {
  period_label?: string | undefined;
  salary_calculation_basis?: SalaryCalculationBasis | undefined;
  attendance_deduction?: boolean | undefined;
  late_deduction?: boolean | undefined;
  overtime_enabled?: boolean | undefined;
  unpaid_leave_deduction?: boolean | undefined;
  rounding_rule?: RoundingRule | undefined;
  working_day_calculation?: WorkingDayCalculation | undefined;
  default_payment_day?: number | undefined;
  default_currency?: string | undefined;
}

export async function getPayrollSettings(): Promise<PayrollSettings> {
  const { rows } = await query<PayrollSettings>(
    `SELECT * FROM payroll_settings WHERE id = 1`
  );
  if (rows.length === 0) {
    const { rows: created } = await query<PayrollSettings>(
      `INSERT INTO payroll_settings (id) VALUES (1) RETURNING *`
    );
    return created[0];
  }
  return rows[0];
}

export async function updatePayrollSettings(
  patch: PayrollSettingsPatch
): Promise<PayrollSettings> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, value: unknown) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.period_label !== undefined) push('period_label', patch.period_label);
  if (patch.salary_calculation_basis !== undefined) push('salary_calculation_basis', patch.salary_calculation_basis);
  if (patch.attendance_deduction !== undefined) push('attendance_deduction', patch.attendance_deduction);
  if (patch.late_deduction !== undefined) push('late_deduction', patch.late_deduction);
  if (patch.overtime_enabled !== undefined) push('overtime_enabled', patch.overtime_enabled);
  if (patch.unpaid_leave_deduction !== undefined) push('unpaid_leave_deduction', patch.unpaid_leave_deduction);
  if (patch.rounding_rule !== undefined) push('rounding_rule', patch.rounding_rule);
  if (patch.working_day_calculation !== undefined) push('working_day_calculation', patch.working_day_calculation);
  if (patch.default_payment_day !== undefined) push('default_payment_day', patch.default_payment_day);
  if (patch.default_currency !== undefined) push('default_currency', patch.default_currency);
  if (sets.length === 0) return getPayrollSettings();
  const { rows } = await query<PayrollSettings>(
    `UPDATE payroll_settings SET ${sets.join(', ')}, updated_at = now() WHERE id = 1 RETURNING *`,
    params
  );
  return rows[0];
}