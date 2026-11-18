/**
 * Leave domain (Spec FR-070..080, BR-008..011, SM-2, WF-006/007).
 *
 * - Application submit: Draft -> Pending (validates against current balance).
 * - Approval: 2-step Manager -> HR. Step 1 records approval (stays pending),
 *   step 2 consumes balance inside a row-locked transaction (BR-009, race-safe)
 *   and marks the application approved (Spec 3.1).
 * - Rejection: Pending -> Rejected; never touches balance (BR-010).
 * - Generate Leaves for [year]: idempotent per employee+type+year (BR-008).
 */

import { query, withTransaction, insertRow, list } from '@jsk/shared-kernel';
import type { ColumnMap, PaginatedResponse } from '@jsk/shared-kernel';
import type { FilterParam, SortParam } from '@jsk/shared-kernel';

// ---------------------------------------------------------------------------
// Leave types (FR-074)
// ---------------------------------------------------------------------------

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  annual_entitlement: string;
  is_paid: boolean;
  gender_eligibility: string;
  carry_forward: boolean;
  max_consecutive_days: number | null;
  requires_document: boolean;
  is_active: boolean;
}

export const leaveTypes = {
  async list(input: { filters?: FilterParam[]; search?: string; sort?: SortParam | null; page?: number; per_page?: number }): Promise<PaginatedResponse<Record<string, unknown>>> {
    return list({
      table: 'leave_types lt',
      columns: {
        id: { type: 'uuid', sql: 'lt.id' },
        name: { type: 'text', sql: 'lt.name' },
        code: { type: 'text', sql: 'lt.code' },
        is_active: { type: 'boolean', sql: 'lt.is_active' },
      },
      filters: input.filters,
      search: input.search,
      searchableColumns: ['name', 'code'],
      sort: input.sort,
      defaultSort: { field: 'name', direction: 'asc' },
      activeOnly: true,
      pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
    });
  },
  async get(id: string): Promise<LeaveType | null> {
    const { getById } = await import('@jsk/shared-kernel');
    return getById<LeaveType>('leave_types', id);
  },
  async create(data: Omit<LeaveType, 'id'>): Promise<LeaveType> {
    return insertRow<LeaveType>('leave_types', { ...data });
  },
  async update(id: string, data: Partial<Omit<LeaveType, 'id'>>): Promise<LeaveType | null> {
    const { updateRow } = await import('@jsk/shared-kernel');
    return updateRow<LeaveType>('leave_types', id, { ...data });
  },
  async remove(id: string): Promise<boolean> {
    const { softDeleteRow } = await import('@jsk/shared-kernel');
    return softDeleteRow('leave_types', id);
  },
};

// ---------------------------------------------------------------------------
// Date / day-count helpers
// ---------------------------------------------------------------------------

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Calendar days between two dates inclusive. */
export function daysBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00`).getTime();
  const e = new Date(`${end}T00:00:00`).getTime();
  return Math.round((e - s) / 86_400_000) + 1;
}

/** Split an inclusive date range into per-calendar-year day counts. */
export function splitDaysByYear(start: string | Date, end: string | Date): Map<number, number> {
  const result = new Map<number, number>();
  const startDate = typeof start === 'string' ? start : start.toISOString().slice(0, 10);
  const endDate = typeof end === 'string' ? end : end.toISOString().slice(0, 10);
  let cursor = startDate;
  while (cursor <= endDate) {
    const year = Number(cursor.slice(0, 4));
    result.set(year, (result.get(year) ?? 0) + 1);
    cursor = addDays(cursor, 1);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Leave applications (FR-070/071)
// ---------------------------------------------------------------------------

export interface CreateApplicationInput {
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  reason?: string | undefined;
  hard_copy?: boolean | undefined;
  attachment_file_id?: string | undefined;
  requested_days?: number | undefined;
}

const APPLICATION_COLUMNS: ColumnMap = {
  id: { type: 'uuid', sql: 'la.id' },
  employee_id: { type: 'uuid', sql: 'la.employee_id' },
  leave_type_id: { type: 'uuid', sql: 'la.leave_type_id' },
  status: { type: 'text', sql: 'la.status' },
  approval_step: { type: 'numeric', sql: 'la.approval_step' },
  start_date: { type: 'date', sql: 'la.start_date' },
  end_date: { type: 'date', sql: 'la.end_date' },
  full_name: { type: 'text', sql: 'e.full_name' },
  employee_code: { type: 'text', sql: 'e.employee_code' },
  leave_type_name: { type: 'text', sql: 'lt.name' },
  department_id: { type: 'uuid', sql: 'e.department_id' },
};

async function checkBalance(employeeId: string, leaveTypeId: string, startDate: string, endDate: string): Promise<void> {
  const perYear = splitDaysByYear(startDate, endDate);
  for (const [year, days] of perYear) {
    const { rows } = await query(
      `SELECT due FROM leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
      [employeeId, leaveTypeId, year]
    );
    const due = rows[0] ? Number(rows[0].due) : 0;
    if (days > due) {
      throw new Error('leave.insufficient_balance');
    }
  }
}

export async function createApplication(input: CreateApplicationInput): Promise<Record<string, unknown>> {
  if (input.end_date < input.start_date) {
    throw new Error('leave.end_before_start');
  }
  const requestedDays = input.requested_days ?? daysBetween(input.start_date, input.end_date);
  await checkBalance(input.employee_id, input.leave_type_id, input.start_date, input.end_date);
  const { rows } = await query<Record<string, unknown>>(
    `INSERT INTO leave_applications (employee_id, leave_type_id, start_date, end_date, requested_days, approved_days, reason, hard_copy, attachment_file_id, status)
     VALUES ($1, $2, $3::date, $4::date, $5, 0, $6, $7, $8, 'pending') RETURNING *`,
    [input.employee_id, input.leave_type_id, input.start_date, input.end_date, requestedDays, input.reason ?? '', input.hard_copy ?? false, input.attachment_file_id ?? null]
  );
  return rows[0];
}

export async function listApplications(input: { filters?: FilterParam[]; sort?: SortParam | null; page?: number; per_page?: number }): Promise<PaginatedResponse<Record<string, unknown>>> {
  return list({
    table: 'leave_applications la',
    columns: APPLICATION_COLUMNS,
    select: 'la.*, f.original_filename AS attachment_filename',
    joins: `JOIN employees e ON e.id = la.employee_id
            JOIN leave_types lt ON lt.id = la.leave_type_id
            LEFT JOIN files f ON f.id = la.attachment_file_id`,
    filters: input.filters,
    sort: input.sort,
    defaultSort: { field: 'start_date', direction: 'desc' },
    activeOnly: true,
    pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
  });
}

/**
 * Leave analytics (BR-018): status distribution, distribution by leave type,
 * and monthly request volume for the given year. `employeeId` restricts to a
 * single employee (personal analytics) when provided.
 */
export async function leaveAnalytics(
  year: number,
  employeeId?: string | null
): Promise<{ byStatus: Record<string, unknown>[]; byType: Record<string, unknown>[]; monthly: Record<string, unknown>[] }> {
  const scope = employeeId ? ` AND la.employee_id = $2::uuid` : '';
  const base: unknown[] = [year];
  if (employeeId) base.push(employeeId);
  const [byStatus, byType, monthly] = await Promise.all([
    query(
      `SELECT la.status, COUNT(*)::int AS n FROM leave_applications la
        WHERE extract(year FROM la.start_date) = $1::int AND la.deleted_at IS NULL${scope}
        GROUP BY la.status ORDER BY n DESC`,
      base
    ),
    query(
      `SELECT lt.name, COUNT(*)::int AS n FROM leave_applications la
        JOIN leave_types lt ON lt.id = la.leave_type_id
       WHERE extract(year FROM la.start_date) = $1::int AND la.deleted_at IS NULL${scope}
       GROUP BY lt.name ORDER BY n DESC`,
      base
    ),
    query(
      `SELECT to_char(la.start_date, 'YYYY-MM') AS month, COUNT(*)::int AS n
         FROM leave_applications la
        WHERE extract(year FROM la.start_date) = $1::int AND la.deleted_at IS NULL${scope}
        GROUP BY month ORDER BY month`,
      base
    ),
  ]);
  return { byStatus: byStatus.rows, byType: byType.rows, monthly: monthly.rows };
}

export async function getApplication(id: string): Promise<Record<string, unknown> | null> {
  const { getById } = await import('@jsk/shared-kernel');
  return getById('leave_applications', id);
}

/**
 * Approve (WF-006): single atomic step. Consumes balance inside a row-locked
 * transaction (BR-009, race-safe) and marks the application 'approved' in the
 * same request — no second click required. Idempotent: re-approving an already
 * approved application is rejected with a controlled error, so balance is
 * never deducted twice.
 */
export async function approveApplication(id: string, userId: string, approvedDays?: number, comment?: string): Promise<Record<string, unknown>> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM leave_applications WHERE id = $1::uuid FOR UPDATE`,
      [id]
    );
    if (rows.length === 0) {
      throw new Error('leave.not_found');
    }
    const app = rows[0];
    if (app.status === 'approved') {
      throw new Error('leave.already_approved');
    }
    if (app.status !== 'pending') {
      throw new Error('leave.not_pending');
    }

    const days = approvedDays !== undefined && approvedDays !== null ? Number(approvedDays) : Number(app.requested_days);
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error('leave.approved_days_invalid');
    }
    if (days > Number(app.requested_days)) {
      throw new Error('leave.approved_exceeds_requested');
    }

    const perYear = splitDaysByYear(app.start_date, app.end_date);
    for (const [year, requested] of perYear) {
      const { rows: balRows } = await client.query(
        `SELECT * FROM leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3 FOR UPDATE`,
        [app.employee_id, app.leave_type_id, year]
      );
      if (balRows.length === 0) {
        throw new Error('leave.no_balance_row');
      }
      const balance = balRows[0];
      if (Number(balance.due) < requested) {
        throw new Error('leave.insufficient_balance');
      }
      const newTaken = Number(balance.taken) + requested;
      await client.query(
        `UPDATE leave_balances SET taken = $1, due = total - $1 WHERE id = $2`,
        [newTaken, balance.id]
      );
    }

    const { rows: updated } = await client.query(
      `UPDATE leave_applications SET status='approved', approval_step=2, approved_days=$2, approved_by=$3::uuid, approved_at=now(), manager_comment=$4, version = version + 1
       WHERE id = $1::uuid RETURNING *`,
      [id, days, userId, comment ?? null]
    );
    return updated[0];
  });
}

/** Reject (BR-010): no balance effect. */
export async function rejectApplication(id: string, userId: string, comment?: string): Promise<Record<string, unknown>> {
  const { rows } = await query(
    `UPDATE leave_applications SET status='rejected', approved_by=$2::uuid, approved_at=now(), manager_comment=$3, version = version + 1
     WHERE id = $1::uuid AND status = 'pending' RETURNING *`,
    [id, userId, comment ?? null]
  );
  if (rows.length === 0) {
    throw new Error('leave.not_pending');
  }
  return rows[0];
}

/** Withdraw a pending application (SM-2). */
export async function withdrawApplication(id: string): Promise<Record<string, unknown>> {
  const { rows } = await query(
    `UPDATE leave_applications SET status='withdrawn', version = version + 1
     WHERE id = $1::uuid AND status = 'pending' RETURNING *`,
    [id]
  );
  if (rows.length === 0) {
    throw new Error('leave.not_pending');
  }
  return rows[0];
}

/** Soft-delete (SM-2, preserves audit trail). */
export async function softDeleteApplication(id: string): Promise<boolean> {
  const { softDeleteRow } = await import('@jsk/shared-kernel');
  return softDeleteRow('leave_applications', id, { status: 'deleted' });
}

// ---------------------------------------------------------------------------
// Balances (FR-072/073)
// ---------------------------------------------------------------------------

export async function totalLeavesMatrix(employeeId?: string, year?: number): Promise<Record<string, unknown>[]> {
  const yearFilter = year ? Number(year) : new Date().getFullYear();
  const { rows } = employeeId
    ? await query(
        `SELECT lb.id, lb.employee_id, lb.leave_type_id,
                e.employee_code, e.full_name, lt.name AS leave_type, lt.code AS leave_code,
                lb.year, lb.total, lb.taken, lb.due
           FROM leave_balances lb
           JOIN employees e ON e.id = lb.employee_id
           JOIN leave_types lt ON lt.id = lb.leave_type_id
          WHERE lb.year = $1 AND lb.employee_id = $2::uuid
          ORDER BY e.full_name, lt.name`,
        [yearFilter, employeeId]
      )
    : await query(
        `SELECT lb.id, lb.employee_id, lb.leave_type_id,
                e.employee_code, e.full_name, lt.name AS leave_type, lt.code AS leave_code,
                lb.year, lb.total, lb.taken, lb.due
           FROM leave_balances lb
           JOIN employees e ON e.id = lb.employee_id
           JOIN leave_types lt ON lt.id = lb.leave_type_id
          WHERE lb.year = $1
          ORDER BY e.full_name, lt.name`,
        [yearFilter]
      );
  return rows;
}

export async function updateLeaveBalance(
  id: string,
  data: { total?: number | undefined; taken?: number | undefined; due?: number | undefined }
): Promise<Record<string, unknown>> {
  const { rows: existing } = await query<Record<string, unknown>>(
    `SELECT * FROM leave_balances WHERE id = $1`,
    [id]
  );
  if (existing.length === 0) {
    throw new Error('leave.balance_not_found');
  }
  const current = existing[0];
  const total = data.total !== undefined ? Number(data.total) : Number(current['total']);
  const taken = data.taken !== undefined ? Number(data.taken) : Number(current['taken']);
  const due = data.due !== undefined ? Number(data.due) : Number((total - taken).toFixed(2));
  if (total < 0 || taken < 0 || due < 0) {
    throw new Error('leave.negative_balance');
  }
  const { rows: updated } = await query(
    `UPDATE leave_balances
        SET total = $1, taken = $2, due = $3
      WHERE id = $4
      RETURNING *`,
    [total, taken, due, id]
  );
  return updated[0];
}

export async function upsertLeaveBalance(
  employeeId: string,
  leaveTypeId: string,
  year: number,
  data: { total: number; taken?: number | undefined; due?: number | undefined }
): Promise<Record<string, unknown>> {
  const total = Number(data.total);
  const taken = data.taken !== undefined ? Number(data.taken) : 0;
  const due = data.due !== undefined ? Number(data.due) : Number((total - taken).toFixed(2));
  if (total < 0 || taken < 0 || due < 0) {
    throw new Error('leave.negative_balance');
  }
  const { rows } = await query(
    `INSERT INTO leave_balances (employee_id, leave_type_id, year, total, taken, due)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (employee_id, leave_type_id, year)
     DO UPDATE SET total = EXCLUDED.total, taken = EXCLUDED.taken, due = EXCLUDED.due
     RETURNING *`,
    [employeeId, leaveTypeId, year, total, taken, due]
  );
  return rows[0];
}

/** Generate Leaves for [year] (BR-008, HC-02): idempotent per employee+type+year. */
export async function generateLeavesForYear(year: number): Promise<{ created: number; skipped: number; failed: number; failedEmployees: string[] }> {
  const employees = (await query<{ id: string }>(`SELECT id FROM employees WHERE status = 'active' AND deleted_at IS NULL`)).rows;
  const types = (await query<{ id: string }>(`SELECT id FROM leave_types WHERE is_active AND deleted_at IS NULL`)).rows;
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const failedEmployees: string[] = [];

  for (const employee of employees) {
    try {
      for (const type of types) {
        const { rows } = await query<{ total: string }>(
          `SELECT annual_entitlement AS total FROM leave_types WHERE id = $1`,
          [type.id]
        );
        const total = Number(rows[0]?.total ?? 0);
        const r = await query(
          `INSERT INTO leave_balances (employee_id, leave_type_id, year, total, taken, due)
           VALUES ($1, $2, $3, $4, 0, $4)
           ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING`,
          [employee.id, type.id, year, total]
        );
        if (r.rowCount && r.rowCount > 0) created += 1;
        else skipped += 1;
      }
    } catch {
      failed += 1;
      failedEmployees.push(employee.id);
    }
  }
  return { created, skipped, failed, failedEmployees };
}

// ---------------------------------------------------------------------------
// Short leaves (FR-075)
// ---------------------------------------------------------------------------

export async function createShortLeave(input: {
  employee_id: string;
  work_date: string;
  minutes: number;
  reason?: string | undefined;
  leave_type_id?: string | undefined;
}): Promise<Record<string, unknown>> {
  const { rows } = await query<Record<string, unknown>>(
    `INSERT INTO short_leaves (employee_id, leave_type_id, work_date, minutes, reason)
     VALUES ($1, $2, $3::date, $4, $5) RETURNING *`,
    [input.employee_id, input.leave_type_id ?? null, input.work_date, input.minutes, input.reason ?? '']
  );
  return rows[0];
}

export async function listShortLeaves(): Promise<Record<string, unknown>[]> {
  const { rows } = await query(
    `SELECT sl.*, e.full_name, e.employee_code, COALESCE(d.name, 'Unassigned') AS department_name
       FROM short_leaves sl
       JOIN employees e ON e.id = sl.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
      ORDER BY sl.work_date DESC`
  );
  return rows;
}

export async function approveShortLeave(id: string, userId: string): Promise<Record<string, unknown>> {
  const { rows } = await query(
    `UPDATE short_leaves SET status='approved', approved_by=$1::uuid, approved_at=now() WHERE id = $2::uuid AND status='pending' RETURNING *`,
    [userId, id]
  );
  return rows[0];
}

export async function rejectShortLeave(id: string, userId: string): Promise<Record<string, unknown>> {
  const { rows } = await query(
    `UPDATE short_leaves SET status='rejected', approved_by=$1::uuid, approved_at=now() WHERE id = $2::uuid AND status='pending' RETURNING *`,
    [userId, id]
  );
  return rows[0];
}
