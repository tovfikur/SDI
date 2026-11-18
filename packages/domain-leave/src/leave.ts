import { query, withTransaction } from '@jsk/shared-kernel';
import type { PoolClient } from 'pg';

export interface ApplyLeavePayload {
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  requestedDays: number;
  reason?: string;
  userId: string;
}

export async function applyLeave(payload: ApplyLeavePayload): Promise<string> {
  const { employeeId, leaveTypeId, startDate, endDate, requestedDays, reason, userId } = payload;

  if (new Date(endDate) < new Date(startDate)) {
    throw new Error('End date must be greater than or equal to start date');
  }
  if (requestedDays <= 0) {
    throw new Error('Requested days must be greater than 0');
  }

  return withTransaction(async (client: PoolClient) => {
    const year = new Date(startDate).getFullYear();

    // Check balance
    const balRes = await client.query<{ due: number }>(
      'SELECT due FROM leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3',
      [employeeId, leaveTypeId, year]
    );

    if (balRes.rows.length > 0) {
      const due = Number(balRes.rows[0].due);
      if (due < requestedDays) {
        throw new Error(`Insufficient leave balance. Requested: ${requestedDays}, Available: ${due}`);
      }
    }

    const appRes = await client.query<{ id: string }>(
      `INSERT INTO leave_applications (
         employee_id, leave_type_id, start_date, end_date, requested_days, reason, status, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7) RETURNING id`,
      [employeeId, leaveTypeId, startDate, endDate, requestedDays, reason || '', userId]
    );

    return appRes.rows[0].id;
  });
}

export async function approveLeave(applicationId: string, approverUserId: string, managerComment?: string): Promise<void> {
  return withTransaction(async (client: PoolClient) => {
    const appRes = await client.query<{
      id: string;
      employee_id: string;
      leave_type_id: string;
      start_date: Date;
      requested_days: number;
      status: string;
    }>(
      'SELECT id, employee_id, leave_type_id, start_date, requested_days, status FROM leave_applications WHERE id = $1 FOR UPDATE',
      [applicationId]
    );

    if (appRes.rows.length === 0) {
      throw new Error('Leave application not found');
    }

    const app = appRes.rows[0];
    if (app.status !== 'pending') {
      throw new Error(`Cannot approve leave in '${app.status}' status`);
    }

    const year = app.start_date.getFullYear();
    const days = Number(app.requested_days);

    // Consume balance (BR-009)
    await client.query(
      `UPDATE leave_balances
       SET taken = taken + $1, due = due - $1
       WHERE employee_id = $2 AND leave_type_id = $3 AND year = $4`,
      [days, app.employee_id, app.leave_type_id, year]
    );

    await client.query(
      `UPDATE leave_applications
       SET status = 'approved', approved_by = $1, approved_at = now(), approved_days = $2, manager_comment = $3
       WHERE id = $4`,
      [approverUserId, days, managerComment || null, applicationId]
    );
  });
}

export async function generateYearlyLeaveBalances(year: number): Promise<{ generatedCount: number }> {
  const empRes = await query<{ id: string }>('SELECT id FROM employees WHERE status = \'active\' AND deleted_at IS NULL');
  const typeRes = await query<{ id: string; annual_entitlement: number }>('SELECT id, annual_entitlement FROM leave_types WHERE is_active AND deleted_at IS NULL');

  let generatedCount = 0;

  for (const emp of empRes.rows) {
    for (const lt of typeRes.rows) {
      const entitlement = Number(lt.annual_entitlement);
      const res = await query(
        `INSERT INTO leave_balances (employee_id, leave_type_id, year, total, taken, due)
         VALUES ($1, $2, $3, $4, 0, $4)
         ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING`,
        [emp.id, lt.id, year, entitlement]
      );
      if (res.rowCount && res.rowCount > 0) {
        generatedCount += 1;
      }
    }
  }

  return { generatedCount };
}
