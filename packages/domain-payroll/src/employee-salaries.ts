/**
 * Employee salary assignment — additive history records.
 *
 * Changing an employee's salary inserts a NEW row (closing the previous one)
 * instead of mutating: payroll always resolves the salary applicable to the
 * payroll period, so historical runs keep their original amounts.
 */

import { query, withTransaction } from '@jsk/shared-kernel';
import { parseCents, centsToString } from './money';

export interface EmployeeSalary {
  id: string;
  employee_id: string;
  salary_structure_id: string;
  gross_salary: string;
  currency: string;
  effective_from: string;
  effective_to: string | null;
  status: 'active' | 'inactive';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  structure_name?: string | undefined;
  overrides?: EmployeeSalaryOverride[] | undefined;
}

export interface EmployeeSalaryOverride {
  id: string;
  employee_salary_id: string;
  component_id: string;
  amount: string;
  component_name?: string | undefined;
}

export interface SalaryAssignInput {
  employee_id: string;
  salary_structure_id: string;
  gross_salary: string;
  currency?: string | undefined;
  effective_from: string;
  overrides?: Array<{ component_id: string; amount: string }> | undefined;
}

export async function listEmployeeSalaries(input: {
  employee_id?: string | undefined;
  status?: 'active' | 'inactive' | undefined;
} = {}): Promise<EmployeeSalary[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.employee_id) {
    params.push(input.employee_id);
    clauses.push(`es.employee_id = $${params.length}`);
  }
  if (input.status) {
    params.push(input.status);
    clauses.push(`es.status = $${params.length}`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await query<EmployeeSalary>(
    `SELECT es.*, ss.name AS structure_name
       FROM employee_salaries es
       JOIN salary_structures ss ON ss.id = es.salary_structure_id
      ${where}
      ORDER BY es.effective_from DESC, es.created_at DESC`,
    params
  );
  if (rows.length === 0) return [];
  const { rows: overrides } = await query<EmployeeSalaryOverride>(
    `SELECT o.id, o.employee_salary_id, o.component_id, o.amount, sc.name AS component_name
       FROM employee_salary_overrides o
       JOIN salary_components sc ON sc.id = o.component_id
      WHERE o.employee_salary_id = ANY($1)
      ORDER BY sc.sort_order, sc.name`,
    [rows.map((r) => r.id)]
  );
  const bySalary = new Map<string, EmployeeSalaryOverride[]>();
  for (const o of overrides) {
    const list = bySalary.get(o.employee_salary_id) ?? [];
    list.push(o);
    bySalary.set(o.employee_salary_id, list);
  }
  return rows.map((r) => ({ ...r, overrides: bySalary.get(r.id) ?? [] }));
}

export async function getEmployeeSalary(id: string): Promise<EmployeeSalary | null> {
  const { rows } = await query<EmployeeSalary>(
    `SELECT es.*, ss.name AS structure_name
       FROM employee_salaries es
       JOIN salary_structures ss ON ss.id = es.salary_structure_id
      WHERE es.id = $1`,
    [id]
  );
  if (rows.length === 0) return null;
  const { rows: overrides } = await query<EmployeeSalaryOverride>(
    `SELECT o.id, o.employee_salary_id, o.component_id, o.amount, sc.name AS component_name
       FROM employee_salary_overrides o
       JOIN salary_components sc ON sc.id = o.component_id
      WHERE o.employee_salary_id = $1
      ORDER BY sc.sort_order, sc.name`,
    [id]
  );
  return { ...rows[0], overrides };
}

/** Resolves the salary applicable for a period (month-first day → month-last day). */
export async function resolveSalaryForPeriod(
  employeeId: string,
  periodStart: string,
  periodEnd: string
): Promise<EmployeeSalary | null> {
  const { rows } = await query<EmployeeSalary>(
    `SELECT es.*, ss.name AS structure_name
       FROM employee_salaries es
       JOIN salary_structures ss ON ss.id = es.salary_structure_id
      WHERE es.employee_id = $1
        AND es.effective_from <= $3
        AND (es.effective_to IS NULL OR es.effective_to >= $2)
      ORDER BY es.effective_from DESC, es.created_at DESC
      LIMIT 1`,
    [employeeId, periodStart, periodEnd]
  );
  return rows[0] ?? null;
}

export async function assignSalary(
  input: SalaryAssignInput,
  createdBy: string | null
): Promise<EmployeeSalary> {
  let gross: bigint;
  try {
    gross = parseCents(input.gross_salary);
  } catch {
    throw new Error('employee_salary.invalid_gross');
  }
  if (gross < 0n) throw new Error('employee_salary.invalid_gross');
  if (!input.effective_from) throw new Error('employee_salary.invalid_effective_from');
  return withTransaction(async (client) => {
    // Close any open salary for the same employee (history preserved).
    await client.query(
      `UPDATE employee_salaries
          SET effective_to = $2::date - 1, status = 'inactive', updated_at = now()
        WHERE employee_id = $1 AND status = 'active' AND effective_to IS NULL
          AND effective_from <= $2::date`,
      [input.employee_id, input.effective_from]
    );
    const { rows } = await client.query<EmployeeSalary>(
      `INSERT INTO employee_salaries
         (employee_id, salary_structure_id, gross_salary, currency, effective_from, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'active', $6) RETURNING *`,
      [
        input.employee_id,
        input.salary_structure_id,
        centsToString(gross),
        input.currency ?? 'BDT',
        input.effective_from,
        createdBy,
      ]
    );
    const salary = rows[0];
    for (const override of input.overrides ?? []) {
      let overrideCents: bigint;
      try {
        overrideCents = parseCents(override.amount);
      } catch {
        throw new Error('employee_salary.invalid_override');
      }
      await client.query(
        `INSERT INTO employee_salary_overrides (employee_salary_id, component_id, amount)
         VALUES ($1, $2, $3) ON CONFLICT (employee_salary_id, component_id) DO NOTHING`,
        [salary.id, override.component_id, centsToString(overrideCents)]
      );
    }
    const full = await getEmployeeSalary(salary.id);
    return full ?? salary;
  });
}

export async function setSalaryOverrides(
  salaryId: string,
  overrides: Array<{ component_id: string; amount: string }>
): Promise<EmployeeSalary | null> {
  const salary = await getEmployeeSalary(salaryId);
  if (!salary) return null;
  if (salary.status !== 'active') {
    throw new Error('employee_salary.inactive');
  }
  await withTransaction(async (client) => {
    await client.query('DELETE FROM employee_salary_overrides WHERE employee_salary_id = $1', [salaryId]);
    for (const override of overrides) {
      let overrideCents: bigint;
      try {
        overrideCents = parseCents(override.amount);
      } catch {
        throw new Error('employee_salary.invalid_override');
      }
      await client.query(
        `INSERT INTO employee_salary_overrides (employee_salary_id, component_id, amount)
         VALUES ($1, $2, $3)`,
        [salaryId, override.component_id, centsToString(overrideCents)]
      );
    }
  });
  return getEmployeeSalary(salaryId);
}

export async function deactivateSalary(salaryId: string): Promise<boolean> {
  const r = await query(
    `UPDATE employee_salaries SET status = 'inactive', effective_to = COALESCE(effective_to, now()::date), updated_at = now()
      WHERE id = $1 AND status = 'active'`,
    [salaryId]
  );
  return (r.rowCount ?? 0) > 0;
}