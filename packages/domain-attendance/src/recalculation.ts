import { withTransaction } from '@jsk/shared-kernel';
import type { PoolClient } from 'pg';

export type AttendanceStatus =
  | 'NoData'
  | 'Present'
  | 'Late'
  | 'Absent'
  | 'HolidayPresent'
  | 'Missing';

export interface RecalculationResult {
  employeeId: string;
  workDate: string;
  status: AttendanceStatus;
  firstIn: string | null;
  lastOut: string | null;
  totalWorkMinutes: number;
  lateMinutes: number;
}

export async function recalculateEmployeeDay(
  employeeId: string,
  workDate: string
): Promise<RecalculationResult> {
  return withTransaction(async (client: PoolClient) => {
    // Check if date is a holiday
    const holidayRes = await client.query<{ id: string }>(
      'SELECT id FROM holidays WHERE holiday_date = $1 AND is_active AND deleted_at IS NULL',
      [workDate]
    );
    const holidayId = holidayRes.rows[0]?.id || null;

    // Check if employee has an approved leave for this date
    const leaveRes = await client.query<{ id: string }>(
      `SELECT id FROM leave_applications
       WHERE employee_id = $1 AND status = 'approved' AND $2 BETWEEN start_date AND end_date AND deleted_at IS NULL`,
      [employeeId, workDate]
    );
    const hasApprovedLeave = leaveRes.rows.length > 0;

    // Fetch raw attendance events for this date
    const eventsRes = await client.query<{ event_time: Date }>(
      `SELECT event_time FROM attendance_events
       WHERE employee_id = $1 AND event_time::date = $2::date
       ORDER BY event_time ASC`,
      [employeeId, workDate]
    );

    const events = eventsRes.rows;

    let status: AttendanceStatus = 'NoData';
    let firstIn: string | null = null;
    let lastOut: string | null = null;
    let totalWorkMinutes = 0;
    let lateMinutes = 0;

    if (events.length === 0) {
      if (holidayId) {
        status = 'NoData';
      } else if (hasApprovedLeave) {
        status = 'NoData';
      } else {
        status = 'Absent';
      }
    } else {
      const firstEvent = events[0].event_time;
      const lastEvent = events[events.length - 1].event_time;

      firstIn = firstEvent.toISOString().slice(11, 19);
      lastOut = lastEvent.toISOString().slice(11, 19);

      if (events.length > 1) {
        totalWorkMinutes = Math.round((lastEvent.getTime() - firstEvent.getTime()) / 60000);
      }

      if (holidayId) {
        status = 'HolidayPresent';
      } else {
        // Fetch setup rule
        const ruleRes = await client.query<{ office_start_time: string; grace_period_minutes: number }>(
          `SELECT sr.office_start_time, sr.grace_period_minutes
           FROM employees e
           JOIN setup_rules sr ON e.setup_rule_id = sr.id
           WHERE e.id = $1`,
          [employeeId]
        );

        if (ruleRes.rows.length > 0) {
          const rule = ruleRes.rows[0];
          const [startHour, startMin] = rule.office_start_time.split(':').map(Number);

          const scheduledStart = new Date(firstEvent);
          scheduledStart.setHours(startHour, startMin, 0, 0);

          const cutoff = new Date(scheduledStart.getTime() + rule.grace_period_minutes * 60000);

          if (firstEvent > cutoff) {
            status = 'Late';
            lateMinutes = Math.round((firstEvent.getTime() - scheduledStart.getTime()) / 60000);
          } else {
            status = 'Present';
          }
        } else {
          status = 'Present';
        }
      }
    }

    // Upsert into attendance_days table
    await client.query(
      `INSERT INTO attendance_days (
         employee_id, work_date, first_in, last_out, total_work_minutes, status, late_minutes, holiday_id, calculated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (employee_id, work_date)
       DO UPDATE SET
         first_in = EXCLUDED.first_in,
         last_out = EXCLUDED.last_out,
         total_work_minutes = EXCLUDED.total_work_minutes,
         status = EXCLUDED.status,
         late_minutes = EXCLUDED.late_minutes,
         holiday_id = EXCLUDED.holiday_id,
         calculated_at = now()`,
      [employeeId, workDate, firstIn, lastOut, totalWorkMinutes, status, lateMinutes, holidayId]
    );

    return {
      employeeId,
      workDate,
      status,
      firstIn,
      lastOut,
      totalWorkMinutes,
      lateMinutes,
    };
  });
}
