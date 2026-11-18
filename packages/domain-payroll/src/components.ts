/**
 * Salary components domain — configurable earnings/deductions.
 * Calculation types: fixed | percentage (of another component or gross) | formula (manual).
 */

import { query } from '@jsk/shared-kernel';
import { parseCents } from './money';

export type ComponentType = 'earning' | 'deduction';
export type ComponentCalculationType = 'fixed' | 'percentage' | 'formula';

export interface SalaryComponent {
  id: string;
  name: string;
  code: string;
  type: ComponentType;
  calculation_type: ComponentCalculationType;
  percentage_of_component: string | null;
  default_amount: string | null;
  taxable: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ComponentCreateInput {
  name: string;
  code: string;
  type: ComponentType;
  calculation_type?: ComponentCalculationType | undefined;
  percentage_of_component?: string | null | undefined;
  default_amount?: string | null | undefined;
  taxable?: boolean | undefined;
  is_active?: boolean | undefined;
  sort_order?: number | undefined;
}

export interface ComponentUpdateInput {
  name?: string | undefined;
  type?: ComponentType | undefined;
  calculation_type?: ComponentCalculationType | undefined;
  percentage_of_component?: string | null | undefined;
  default_amount?: string | null | undefined;
  taxable?: boolean | undefined;
  is_active?: boolean | undefined;
  sort_order?: number | undefined;
}

export function assertComponentCode(code: string): void {
  if (!/^[A-Z0-9_]{2,40}$/.test(code)) {
    throw new Error('salary_component.invalid_code');
  }
}

function assertAmount(value: string | null | undefined): void {
  if (value === null || value === undefined || value === '') return;
  try {
    parseCents(value);
  } catch {
    throw new Error('salary_component.invalid_amount');
  }
}

export async function listComponents(input: {
  type?: ComponentType | undefined;
  activeOnly?: boolean | undefined;
} = {}): Promise<SalaryComponent[]> {
  const clauses: string[] = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  if (input.type) {
    params.push(input.type);
    clauses.push(`type = $${params.length}`);
  }
  if (input.activeOnly) {
    clauses.push('is_active = true');
  }
  const { rows } = await query<SalaryComponent>(
    `SELECT * FROM salary_components
      WHERE ${clauses.join(' AND ')}
      ORDER BY type, sort_order, name`,
    params
  );
  return rows;
}

export async function getComponent(id: string): Promise<SalaryComponent | null> {
  const { rows } = await query<SalaryComponent>(
    `SELECT * FROM salary_components WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

export async function createComponent(input: ComponentCreateInput): Promise<SalaryComponent> {
  assertComponentCode(input.code);
  if (!input.name.trim()) throw new Error('salary_component.invalid_name');
  if (input.calculation_type === 'percentage' && !input.percentage_of_component) {
    // percentage of gross is allowed — percentage_of_component may be null
  }
  assertAmount(input.default_amount);
  const { rows } = await query<SalaryComponent>(
    `INSERT INTO salary_components
       (name, code, type, calculation_type, percentage_of_component, default_amount, taxable, is_active, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.name.trim(),
      input.code.trim().toUpperCase(),
      input.type,
      input.calculation_type ?? 'fixed',
      input.percentage_of_component ?? null,
      input.default_amount ?? null,
      input.taxable ?? false,
      input.is_active ?? true,
      input.sort_order ?? 0,
    ]
  );
  return rows[0];
}

export async function updateComponent(
  id: string,
  patch: ComponentUpdateInput
): Promise<SalaryComponent | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, value: unknown) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.name !== undefined) push('name', patch.name.trim());
  if (patch.default_amount !== undefined) assertAmount(patch.default_amount);
  if (patch.type !== undefined) push('type', patch.type);
  if (patch.calculation_type !== undefined) push('calculation_type', patch.calculation_type);
  if (patch.percentage_of_component !== undefined) push('percentage_of_component', patch.percentage_of_component);
  if (patch.default_amount !== undefined) push('default_amount', patch.default_amount);
  if (patch.taxable !== undefined) push('taxable', patch.taxable);
  if (patch.is_active !== undefined) push('is_active', patch.is_active);
  if (patch.sort_order !== undefined) push('sort_order', patch.sort_order);
  if (sets.length === 0) return getComponent(id);
  params.push(id);
  const { rows } = await query<SalaryComponent>(
    `UPDATE salary_components SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

/** Deactivate (soft archive) — historical payroll lines keep their snapshots. */
export async function deactivateComponent(id: string): Promise<boolean> {
  const r = await query(
    `UPDATE salary_components SET is_active = false, deleted_at = now(), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return (r.rowCount ?? 0) > 0;
}