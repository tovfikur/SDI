/**
 * Salary structures domain — a named bundle of components with per-structure
 * amounts (fixed) or percentage points (percentage).
 */

import { query, withTransaction } from '@jsk/shared-kernel';
import { parseCents } from './money';

export interface StructureComponentRow {
  id: string;
  structure_id: string;
  component_id: string;
  name: string;
  code: string;
  type: 'earning' | 'deduction';
  calculation_type: 'fixed' | 'percentage' | 'formula';
  percentage_of_component: string | null;
  amount: string | null;
  sort_order: number;
}

export interface SalaryStructure {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  components: StructureComponentRow[];
}

export interface StructureComponentInput {
  component_id: string;
  calculation_type?: 'fixed' | 'percentage' | 'formula' | undefined;
  percentage_of_component?: string | null | undefined;
  amount?: string | null | undefined;
}

export interface StructureCreateInput {
  name: string;
  description?: string | undefined;
  is_active?: boolean | undefined;
  components?: StructureComponentInput[] | undefined;
}

export interface StructureUpdateInput {
  name?: string | undefined;
  description?: string | undefined;
  is_active?: boolean | undefined;
  components?: StructureComponentInput[] | undefined;
}

const COMPONENT_SELECT = `
  SELECT scc.id, scc.structure_id, scc.component_id, scc.calculation_type,
         scc.percentage_of_component, scc.amount,
         sc.name, sc.code, sc.type, sc.sort_order
    FROM salary_structure_components scc
    JOIN salary_components sc ON sc.id = scc.component_id`;

async function loadComponents(structureIds: string[]): Promise<StructureComponentRow[]> {
  if (structureIds.length === 0) return [];
  const { rows } = await query<StructureComponentRow>(
    `${COMPONENT_SELECT}
      WHERE scc.structure_id = ANY($1) AND sc.deleted_at IS NULL
      ORDER BY sc.sort_order, sc.name`,
    [structureIds]
  );
  return rows;
}

export async function listStructures(): Promise<SalaryStructure[]> {
  const { rows } = await query<SalaryStructure>(
    `SELECT * FROM salary_structures WHERE deleted_at IS NULL ORDER BY name`
  );
  if (rows.length === 0) return [];
  const comps = await loadComponents(rows.map((r) => r.id));
  const byStructure = new Map<string, StructureComponentRow[]>();
  for (const c of comps) {
    const list = byStructure.get(c.structure_id) ?? [];
    list.push(c);
    byStructure.set(c.structure_id, list);
  }
  return rows.map((r) => ({ ...r, components: byStructure.get(r.id) ?? [] }));
}

export async function getStructure(id: string): Promise<SalaryStructure | null> {
  const { rows } = await query<SalaryStructure>(
    `SELECT * FROM salary_structures WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (rows.length === 0) return null;
  const comps = await loadComponents([id]);
  return { ...rows[0], components: comps };
}

async function replaceComponents(
  client: import('pg').PoolClient,
  structureId: string,
  components: StructureComponentInput[]
): Promise<void> {
  await client.query('DELETE FROM salary_structure_components WHERE structure_id = $1', [structureId]);
  for (const comp of components) {
    if (comp.amount !== null && comp.amount !== undefined && comp.amount !== '') {
      try {
        parseCents(comp.amount);
      } catch {
        throw new Error('salary_structure.invalid_amount');
      }
    }
    await client.query(
      `INSERT INTO salary_structure_components
         (structure_id, component_id, calculation_type, percentage_of_component, amount)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        structureId,
        comp.component_id,
        comp.calculation_type ?? 'fixed',
        comp.percentage_of_component ?? null,
        comp.amount ?? null,
      ]
    );
  }
}

export async function createStructure(input: StructureCreateInput): Promise<SalaryStructure> {
  if (!input.name.trim()) throw new Error('salary_structure.invalid_name');
  return withTransaction(async (client) => {
    const { rows } = await client.query<SalaryStructure>(
      `INSERT INTO salary_structures (name, description, is_active)
       VALUES ($1, $2, $3) RETURNING *`,
      [input.name.trim(), input.description ?? '', input.is_active ?? true]
    );
    const structure = rows[0];
    if (input.components && input.components.length > 0) {
      await replaceComponents(client, structure.id, input.components);
    }
    const full = await getStructure(structure.id);
    return full ?? structure;
  });
}

export async function updateStructure(
  id: string,
  patch: StructureUpdateInput
): Promise<SalaryStructure | null> {
  return withTransaction(async (client) => {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      params.push(patch.name.trim());
      sets.push(`name = $${params.length}`);
    }
    if (patch.description !== undefined) {
      params.push(patch.description);
      sets.push(`description = $${params.length}`);
    }
    if (patch.is_active !== undefined) {
      params.push(patch.is_active);
      sets.push(`is_active = $${params.length}`);
    }
    if (sets.length > 0) {
      params.push(id);
      const r = await client.query<SalaryStructure>(
        `UPDATE salary_structures SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`,
        params
      );
      if (r.rows.length === 0) return null;
    }
    if (patch.components) {
      await replaceComponents(client, id, patch.components);
    }
    return getStructure(id);
  });
}

/** Deactivate instead of deleting — historical payroll snapshots stay intact. */
export async function deactivateStructure(id: string): Promise<boolean> {
  const r = await query(
    `UPDATE salary_structures SET is_active = false, deleted_at = now(), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return (r.rowCount ?? 0) > 0;
}