/**
 * Training domain (Spec §25, HC-02): training programs, assignments
 * (evaluation/completion with score) and certificates.
 */

import { query, withTransaction, insertRow, list } from '@jsk/shared-kernel';
import type { PaginatedResponse } from '@jsk/shared-kernel';
import type { FilterParam, SortParam } from '@jsk/shared-kernel';

export const trainings = {
  async list(input: { filters?: FilterParam[]; search?: string; sort?: SortParam | null; page?: number; per_page?: number }): Promise<PaginatedResponse<Record<string, unknown>>> {
    return list({
      table: 'trainings t',
      columns: {
        id: { type: 'uuid', sql: 't.id' },
        title: { type: 'text', sql: 't.title' },
        trainer: { type: 'text', sql: 't.trainer' },
        status: { type: 'text', sql: 't.status' },
        schedule: { type: 'datetime', sql: 't.schedule' },
      },
      filters: input.filters,
      search: input.search,
      searchableColumns: ['title', 'trainer'],
      sort: input.sort,
      defaultSort: { field: 'title', direction: 'asc' },
      activeOnly: true,
      pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
    });
  },
  async get(id: string): Promise<Record<string, unknown> | null> {
    return withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT * FROM trainings WHERE id = $1::uuid`, [id]);
      if (rows.length === 0) return null;
      const training = rows[0];
      training.assignments = (await client.query(
        `SELECT ta.*, e.full_name, e.employee_code FROM training_assignments ta
         JOIN employees e ON e.id = ta.employee_id WHERE ta.training_id = $1 ORDER BY e.full_name`,
        [id]
      )).rows;
      return training;
    });
  },
  async create(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow('trainings', { ...data, status: data.status ?? 'planned' });
  },
  async update(id: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const { updateRow } = await import('@jsk/shared-kernel');
    return updateRow('trainings', id, data);
  },
  async remove(id: string): Promise<boolean> {
    const { softDeleteRow } = await import('@jsk/shared-kernel');
    return softDeleteRow('trainings', id);
  },
};

export async function assignEmployees(trainingId: string, employeeIds: string[]): Promise<{ assigned: number }> {
  let assigned = 0;
  await withTransaction(async (client) => {
    for (const employeeId of employeeIds) {
      const r = await client.query(
        `INSERT INTO training_assignments (training_id, employee_id) VALUES ($1, $2::uuid)
         ON CONFLICT (training_id, employee_id) DO NOTHING`,
        [trainingId, employeeId]
      );
      if (r.rowCount && r.rowCount > 0) assigned += 1;
    }
  });
  return { assigned };
}

/** Record evaluation/completion for an assignment (BR: completion requires score/status update). */
export async function completeAssignment(assignmentId: string, input: { status?: string | undefined; score?: number | undefined; completion_date?: string | undefined; notes?: string | undefined }): Promise<Record<string, unknown>> {
  const { rows } = await query<Record<string, unknown>>(
    `UPDATE training_assignments
        SET status = $2, score = $3, completion_date = $4, notes = $5, updated_at = now()
      WHERE id = $1::uuid RETURNING *`,
    [
      assignmentId,
      input.status ?? 'completed',
      input.score ?? null,
      input.completion_date ?? new Date().toISOString().slice(0, 10),
      input.notes ?? null,
    ]
  );
  if (rows.length === 0) {
    throw new Error('training.assignment_not_found');
  }
  return rows[0];
}

export async function updateAssignmentStatus(assignmentId: string, status: string): Promise<Record<string, unknown> | null> {
  const { rows } = await query<Record<string, unknown>>(
    `UPDATE training_assignments SET status = $2, updated_at = now() WHERE id = $1::uuid RETURNING *`,
    [assignmentId, status]
  );
  return rows[0] ?? null;
}

export const certificates = {
  async list(input: { employee_id?: string; search?: string; page?: number; per_page?: number }): Promise<PaginatedResponse<Record<string, unknown>>> {
    return list({
      table: 'training_certificates tc',
      columns: {
        id: { type: 'uuid', sql: 'tc.id' },
        employee_id: { type: 'uuid', sql: 'tc.employee_id' },
        title: { type: 'text', sql: 'tc.title' },
        provider: { type: 'text', sql: 'tc.provider' },
        source: { type: 'text', sql: 'tc.source' },
        issue_date: { type: 'date', sql: 'tc.issue_date' },
        expiry_date: { type: 'date', sql: 'tc.expiry_date' },
        full_name: { type: 'text', sql: 'e.full_name' },
      },
      joins: 'JOIN employees e ON e.id = tc.employee_id',
      filters: input.employee_id ? [{ field: 'employee_id', value: input.employee_id, operator: 'eq' }] : undefined,
      search: input.search,
      searchableColumns: ['title', 'provider'],
      defaultSort: { field: 'issue_date', direction: 'desc' },
      pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
    });
  },
  async create(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow('training_certificates', { ...data, source: data.source ?? 'internal' });
  },
  async remove(id: string): Promise<boolean> {
    const { hardDelete } = await import('@jsk/shared-kernel');
    return hardDelete('training_certificates', id);
  },
};

export async function myTrainings(employeeId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await query(
    `SELECT t.title, t.trainer, t.schedule, t.venue, ta.status, ta.score, ta.completion_date
       FROM training_assignments ta JOIN trainings t ON t.id = ta.training_id
      WHERE ta.employee_id = $1::uuid AND t.deleted_at IS NULL
      ORDER BY t.schedule DESC NULLS LAST`,
    [employeeId]
  );
  return rows;
}
