/**
 * Attendance service (Spec FR-050..060, WF-003/004/005): raw event ingestion
 * (deduped), day-level recalculation, missing/pending queues, device mapping
 * and the six report queries.
 */

import { query, withTransaction, list } from '@jsk/shared-kernel';
import type { ColumnMap, PaginatedResponse } from '@jsk/shared-kernel';
import type { FilterParam, SortParam } from '@jsk/shared-kernel';
import { calculateDay, ORG_TZ } from './calculation';
import type { SetupRuleForCalc } from './calculation';

export interface EventInput {
  employee_id: string;
  event_time: string; // ISO timestamp
  source?: string | undefined;
  device_employee_id?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  device_metadata?: Record<string, unknown> | undefined;
}

export async function ingestEvent(input: EventInput, recalc = true): Promise<{ inserted: boolean }> {
  const result = await query<{ id: string }>(
    `INSERT INTO attendance_events (employee_id, event_time, source, device_employee_id, latitude, longitude, device_metadata)
     VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7)
     ON CONFLICT (employee_id, event_time, source) DO NOTHING RETURNING id`,
    [
      input.employee_id,
      input.event_time,
      input.source ?? 'manual',
      input.device_employee_id ?? null,
      input.latitude ?? null,
      input.longitude ?? null,
      input.device_metadata ? JSON.stringify(input.device_metadata) : null,
    ]
  );
  if (result.rowCount === 0) {
    return { inserted: false };
  }
  if (recalc) {
    const date = localDateOf(input.event_time);
    await recalculateEmployeeDay(input.employee_id, date);
  }
  return { inserted: true };
}

export async function bulkIngest(events: EventInput[]): Promise<{ inserted: number; duplicates: number }> {
  let inserted = 0;
  let duplicates = 0;
  await withTransaction(async (client) => {
    for (const event of events) {
      const r = await client.query(
        `INSERT INTO attendance_events (employee_id, event_time, source, device_employee_id)
         VALUES ($1, $2::timestamptz, $3, $4)
         ON CONFLICT (employee_id, event_time, source) DO NOTHING RETURNING id`,
        [event.employee_id, event.event_time, event.source ?? 'manual', event.device_employee_id ?? null]
      );
      if (r.rowCount && r.rowCount > 0) inserted += 1;
      else duplicates += 1;
    }
  });
  return { inserted, duplicates };
}

/** Local YYYY-MM-DD of an ISO timestamp in the org timezone. */
export function localDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ORG_TZ }).format(new Date(iso));
}

async function resolveSetupRule(employeeId: string): Promise<SetupRuleForCalc | null> {
  const { rows } = await query<{ id: string; office_start_time: string; office_end_time: string; grace_period_minutes: number; working_days: string[] }>(
    `SELECT sr.id, sr.office_start_time, sr.office_end_time, sr.grace_period_minutes, sr.working_days
       FROM setup_rules sr
       JOIN employees e ON e.setup_rule_id = sr.id OR (e.setup_rule_id IS NULL AND e.employee_type_id = sr.employee_type_id)
      WHERE e.id = $1 AND sr.is_active AND sr.deleted_at IS NULL
      ORDER BY (e.setup_rule_id = sr.id) DESC
      LIMIT 1`,
    [employeeId]
  );
  if (rows.length === 0) {
    return null;
  }
  return {
    office_start_time: rows[0].office_start_time,
    office_end_time: rows[0].office_end_time,
    grace_period_minutes: rows[0].grace_period_minutes,
    working_days: rows[0].working_days ?? [],
  };
}

/** Recalculates one employee-day and upserts the derived row. Idempotent. */
export async function recalculateEmployeeDay(employeeId: string, date: string): Promise<Record<string, unknown> | null> {
  const [eventsRes, holidayRes, leaveRes, setupRule] = await Promise.all([
    query<{ event_time: string }>(
      `SELECT event_time FROM attendance_events
       WHERE employee_id = $1 AND (event_time AT TIME ZONE '${ORG_TZ}')::date = $2::date
       ORDER BY event_time`,
      [employeeId, date]
    ),
    query<{ id: string }>(
      `SELECT id FROM holidays WHERE holiday_date = $1::date AND is_active AND deleted_at IS NULL`,
      [date]
    ),
    query<{ id: string }>(
      `SELECT la.id FROM leave_applications la
        JOIN leave_types lt ON lt.id = la.leave_type_id
       WHERE la.employee_id = $1 AND la.status = 'approved'
         AND $2::date BETWEEN la.start_date AND la.end_date`,
      [employeeId, date]
    ),
    resolveSetupRule(employeeId),
  ]);
  const events = eventsRes.rows;
  const isHoliday = holidayRes.rows.length > 0;
  const hasApprovedLeave = leaveRes.rows.length > 0;

  const result = calculateDay({
    date,
    events,
    setupRule,
    isHoliday,
    hasApprovedLeave,
  });

  const { rows } = await query<Record<string, unknown>>(
    `INSERT INTO attendance_days
       (employee_id, work_date, first_in, last_out, total_work_minutes, status, late_minutes, early_closing, holiday_id, setup_rule_id, branch_id, late_out_minutes, early_out_minutes, calculated_at)
     VALUES ($1, $2::date, $3::time, $4::time, $5, $6, $7, $8, $9::uuid, $10::uuid, (SELECT branch_id FROM employees WHERE id = $1), $11, $12, now())
     ON CONFLICT (employee_id, work_date) DO UPDATE SET
       first_in = EXCLUDED.first_in, last_out = EXCLUDED.last_out,
       total_work_minutes = EXCLUDED.total_work_minutes, status = EXCLUDED.status,
       late_minutes = EXCLUDED.late_minutes, early_closing = EXCLUDED.early_closing,
       holiday_id = EXCLUDED.holiday_id, setup_rule_id = EXCLUDED.setup_rule_id,
       branch_id = COALESCE(EXCLUDED.branch_id, attendance_days.branch_id),
       late_out_minutes = EXCLUDED.late_out_minutes, early_out_minutes = EXCLUDED.early_out_minutes,
       calculated_at = now()
     RETURNING *`,
    [
      employeeId,
      date,
      result.first_in,
      result.last_out,
      result.total_work_minutes,
      result.status,
      result.late_minutes,
      result.early_closing,
      holidayRes.rows[0]?.id ?? null,
      setupRule ? (await resolveSetupRuleId(employeeId)) : null,
      result.late_out_minutes ?? 0,
      result.early_out_minutes ?? 0,
    ]
  );
  return rows[0];
}

async function resolveSetupRuleId(employeeId: string): Promise<string | null> {
  const { rows } = await query(
    `SELECT sr.id FROM setup_rules sr
       JOIN employees e ON e.setup_rule_id = sr.id OR (e.setup_rule_id IS NULL AND e.employee_type_id = sr.employee_type_id)
      WHERE e.id = $1 AND sr.is_active AND sr.deleted_at IS NULL
      ORDER BY (e.setup_rule_id = sr.id) DESC LIMIT 1`,
    [employeeId]
  );
  return rows[0]?.id ?? null;
}

/** Recalculates a range for one or all employees (batch job, idempotent). */
export async function recalculateRange(
  startDate: string,
  endDate: string,
  employeeIds?: string[]
): Promise<number> {
  const employees = employeeIds && employeeIds.length > 0
    ? employeeIds
    : (await query<{ id: string }>(`SELECT id FROM employees WHERE deleted_at IS NULL`)).rows.map((r) => r.id);
  let count = 0;
  for (const employeeId of employees) {
    const { rows } = await query<{ date: string }>(
      `SELECT d::date AS date FROM generate_series($1::date, $2::date, '1 day') AS d
       LEFT JOIN attendance_days ad ON ad.work_date = d::date AND ad.employee_id = $3
       WHERE ad.id IS NULL OR ad.calculated_at IS NULL`,
      [startDate, endDate, employeeId]
    );
    for (const day of rows) {
      await recalculateEmployeeDay(employeeId, day.date);
      count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Manual monthly entry (FR-051): synthesize two raw events, then recalculate.
// ---------------------------------------------------------------------------

export async function monthlyManualEntry(input: {
  employee_id: string;
  year: number;
  month: number; // 1-12
  time_in: string; // ISO datetime
  time_out: string; // ISO datetime
}): Promise<void> {
  await ingestEvent({ employee_id: input.employee_id, event_time: input.time_in, source: 'manual-monthly' }, false);
  await ingestEvent({ employee_id: input.employee_id, event_time: input.time_out, source: 'manual-monthly' }, false);
  const date = localDateOf(input.time_in);
  await recalculateEmployeeDay(input.employee_id, date);
}

// ---------------------------------------------------------------------------
// Device mapping ("Employee ID Show", FR-050)
// ---------------------------------------------------------------------------

export async function upsertDeviceMapping(employeeId: string, deviceEmployeeId: string, notes?: string): Promise<Record<string, unknown>> {
  const { rows } = await query<Record<string, unknown>>(
    `INSERT INTO attendance_device_mappings (employee_id, device_employee_id, notes)
     VALUES ($1, $2, $3)
     ON CONFLICT (device_employee_id) DO UPDATE SET employee_id = EXCLUDED.employee_id, notes = EXCLUDED.notes
     RETURNING *`,
    [employeeId, deviceEmployeeId, notes ?? null]
  );
  return rows[0];
}

export async function listDeviceMappings(): Promise<Record<string, unknown>[]> {
  const { rows } = await query(
    `SELECT m.*, e.full_name, e.employee_code FROM attendance_device_mappings m
     JOIN employees e ON e.id = m.employee_id ORDER BY m.device_employee_id`
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Queues (FR-052/053)
// ---------------------------------------------------------------------------

export async function listMissingAttendance(_filters?: FilterParam[], employeeId?: string | null): Promise<Record<string, unknown>[]> {
  const { rows } = await query(
    `SELECT ad.*, e.full_name, e.employee_code
       FROM attendance_days ad JOIN employees e ON e.id = ad.employee_id
      WHERE ad.status IN ('Missing','Absent')
        ${employeeId ? 'AND ad.employee_id = $1::uuid' : ''}
        AND NOT EXISTS (
          SELECT 1 FROM leave_applications la
          WHERE la.employee_id = ad.employee_id AND la.status = 'approved'
            AND ad.work_date BETWEEN la.start_date AND la.end_date)
      ORDER BY ad.work_date DESC`,
    employeeId ? [employeeId] : []
  );
  return rows;
}

export async function listPendingAttendance(): Promise<Record<string, unknown>[]> {
  const { rows } = await query(
    `SELECT ap.*, e.full_name, e.employee_code FROM attendance_pending ap
     JOIN employees e ON e.id = ap.employee_id WHERE ap.status = 'pending' ORDER BY ap.work_date`
  );
  return rows;
}

export async function approvePending(id: string, userId: string): Promise<void> {
  await query(`UPDATE attendance_pending SET status='approved', processed_by=$1, processed_at=now() WHERE id=$2::uuid`, [userId, id]);
}

export async function rejectPending(id: string, userId: string): Promise<void> {
  await query(`UPDATE attendance_pending SET status='rejected', processed_by=$1, processed_at=now() WHERE id=$2::uuid`, [userId, id]);
}

// ---------------------------------------------------------------------------
// Reports (FR-054..060)
// ---------------------------------------------------------------------------

const DAY_COLUMNS: ColumnMap = {
  id: { type: 'uuid', sql: 'ad.id' },
  employee_id: { type: 'uuid', sql: 'ad.employee_id' },
  work_date: { type: 'date', sql: 'ad.work_date' },
  status: { type: 'text', sql: 'ad.status' },
  full_name: { type: 'text', sql: 'e.full_name' },
  employee_code: { type: 'text', sql: 'e.employee_code' },
  late_minutes: { type: 'int', sql: 'ad.late_minutes' },
  late_out_minutes: { type: 'int', sql: 'ad.late_out_minutes' },
  early_out_minutes: { type: 'int', sql: 'ad.early_out_minutes' },
  department_id: { type: 'uuid', sql: 'e.department_id' },
  department_name: { type: 'text', sql: 'd.name' },
  branch_id: { type: 'uuid', sql: 'COALESCE(ad.branch_id, e.branch_id)' },
  branch_name: { type: 'text', sql: 'b.name' },
};

const DAY_SELECT = `ad.*, e.full_name, e.employee_code, e.department_id, d.name AS department_name, COALESCE(ad.branch_id, e.branch_id) AS branch_id, b.name AS branch_name`;

async function daysPage(filters: FilterParam[] | undefined, sort: SortParam | null, page: number, perPage: number): Promise<PaginatedResponse<Record<string, unknown>>> {
  return list({
    table: 'attendance_days ad',
    columns: DAY_COLUMNS,
    joins: 'JOIN employees e ON e.id = ad.employee_id LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN branches b ON b.id = COALESCE(ad.branch_id, e.branch_id)',
    select: DAY_SELECT,
    filters,
    sort,
    defaultSort: { field: 'work_date', direction: 'desc' },
    pagination: { page, per_page: perPage as 10 | 25 | 50 | 100 },
  });
}

export async function reportLateAttendance(filters: FilterParam[], page = 1, perPage = 10): Promise<PaginatedResponse<Record<string, unknown>>> {
  return daysPage([...filters, { field: 'late_minutes', value: '0', operator: 'gte' }], null, page, perPage);
}

export async function reportAttendanceLog(filters: FilterParam[], sort: SortParam | null, page = 1, perPage = 10): Promise<PaginatedResponse<Record<string, unknown>>> {
  return daysPage(filters, sort, page, perPage);
}

export async function reportDailyPresent(date: string): Promise<Record<string, unknown>[]> {
  const { rows } = await query(
    `SELECT e.employee_code, e.full_name, ad.* FROM attendance_days ad
     JOIN employees e ON e.id = ad.employee_id
     WHERE ad.work_date = $1::date AND ad.status IN ('Present','Late','HolidayPresent')
     ORDER BY e.full_name`,
    [date]
  );
  return rows;
}

/**
 * Attendance analytics (BR-018): daily status trend + today's distribution.
 * `employeeId` restricts to one employee (personal analytics) when provided.
 */
export async function attendanceAnalytics(
  days = 30,
  employeeId?: string | null
): Promise<{ trend: Record<string, unknown>[]; today: Record<string, unknown>[]; byDepartment: Record<string, unknown>[] }> {
  const scope = employeeId ? ` AND employee_id = $2::uuid` : '';
  const params: unknown[] = employeeId ? [days, employeeId] : [days];
  const { rows: trend } = await query<Record<string, unknown>>(
    `SELECT to_char(work_date, 'YYYY-MM-DD') AS date,
            COUNT(*) FILTER (WHERE status = 'Present')::int AS present,
            COUNT(*) FILTER (WHERE status = 'Late')::int AS late,
            COUNT(*) FILTER (WHERE status = 'Absent')::int AS absent,
            COUNT(*) FILTER (WHERE status = 'Leave')::int AS leave,
            COUNT(*) FILTER (WHERE status = 'Missing')::int AS missing,
            COUNT(*) FILTER (WHERE status IN ('Holiday','HolidayPresent'))::int AS holiday
       FROM attendance_days
      WHERE work_date >= CURRENT_DATE - $1::int${scope}
      GROUP BY work_date ORDER BY work_date`,
    params
  );
  const { rows: today } = await query<Record<string, unknown>>(
    `SELECT status, COUNT(*)::int AS n FROM attendance_days
      WHERE work_date = CURRENT_DATE${employeeId ? ' AND employee_id = $1::uuid' : ''} GROUP BY status ORDER BY n DESC`,
    employeeId ? [employeeId] : []
  );
  const { rows: byDepartment } = await query<Record<string, unknown>>(
    `SELECT d.id, COALESCE(d.name, 'Unassigned') AS name,
            COUNT(*) FILTER (WHERE ad.status = 'Present')::int AS present,
            COUNT(*) FILTER (WHERE ad.status = 'Late')::int AS late,
            COUNT(*) FILTER (WHERE ad.status IN ('Absent','Missing'))::int AS absent,
            COUNT(*) FILTER (WHERE ad.status = 'Leave')::int AS leave
       FROM attendance_days ad
       JOIN employees e ON e.id = ad.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE ad.work_date >= CURRENT_DATE - $1::int${employeeId ? ' AND ad.employee_id = $2::uuid' : ''}
      GROUP BY d.id, d.name ORDER BY present DESC`,
    employeeId ? [days, employeeId] : [days]
  );
  return { trend, today, byDepartment };
}

/**
 * Today's attendance grouped by department (BR-018 dashboard). Unlike the
 * multi-day `attendanceAnalytics().byDepartment` aggregate, this reflects a
 * single day's marks so the dashboard "Today" chart never mixes historical
 * data. `asOf` defaults to the current date and is only overridden for
 * testing/verification.
 */
export async function todayByDepartment(asOf?: string): Promise<Record<string, unknown>[]> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT COALESCE(d.id::text, '') AS department_id,
            COALESCE(d.name, 'Unassigned') AS name,
            COUNT(*) FILTER (WHERE ad.status = 'Present')::int AS present,
            COUNT(*) FILTER (WHERE ad.status = 'Late')::int AS late,
            COUNT(*) FILTER (WHERE ad.status IN ('Absent','Missing'))::int AS absent,
            COUNT(*) FILTER (WHERE ad.status = 'Leave')::int AS leave,
            COUNT(*)::int AS total
       FROM attendance_days ad
       JOIN employees e ON e.id = ad.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE ad.work_date = $1::date
      GROUP BY d.id, d.name
      ORDER BY total DESC, d.name`,
    [asOf ?? new Date().toISOString().slice(0, 10)]
  );
  return rows;
}

/** Attendance % = (Present + Late) / (Present + Late + Absent + Missing) × 100. */
export function computeAttendancePct(
  row: { present: number; late: number; absent: number; missing?: number }
): number {
  const attended = Number(row.present) + Number(row.late);
  const marked = attended + Number(row.absent) + Number(row.missing ?? 0);
  if (marked <= 0) return 0;
  return Math.round((attended / marked) * 1000) / 10;
}

export async function reportMonthlySummary(year: number, month: number): Promise<Record<string, unknown>[]> {
  const { rows } = await query(
    `SELECT e.employee_code, e.full_name, ad.work_date, ad.status
       FROM attendance_days ad JOIN employees e ON e.id = ad.employee_id
      WHERE extract(year FROM ad.work_date) = $1 AND extract(month FROM ad.work_date) = $2
      ORDER BY e.full_name, ad.work_date`,
    [year, month]
  );
  const byEmployee = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = `${row.employee_code}::${row.full_name}`;
    const entry: Record<string, unknown> = byEmployee.get(key) ?? { employee_code: row.employee_code, full_name: row.full_name };
    const status = row.status as string;
    const prev = Number(entry[status]);
    entry[status] = (Number.isFinite(prev) ? prev : 0) + 1;
    byEmployee.set(key, entry);
  }
  return [...byEmployee.values()];
}

export async function reportMonthlyDetail(filters: FilterParam[], page = 1, perPage = 10): Promise<PaginatedResponse<Record<string, unknown>>> {
  return daysPage(filters, null, page, perPage);
}

export async function reportDailyWorksheet(filters: FilterParam[], page = 1, perPage = 10): Promise<PaginatedResponse<Record<string, unknown>>> {
  return daysPage(filters, null, page, perPage);
}

// ---------------------------------------------------------------------------
// Geo-fence check-in (Spec 2.1)
// ---------------------------------------------------------------------------

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function geoCheckin(data: {
  employee_id: string;
  event_time: string;
  latitude: number;
  longitude: number;
  device_metadata?: Record<string, unknown>;
  allowed_latitude?: number;
  allowed_longitude?: number;
  allowed_radius_meters?: number;
}) {
  if (data.allowed_latitude != null && data.allowed_longitude != null && data.allowed_radius_meters != null) {
    const distance = haversineDistance(data.latitude, data.longitude, data.allowed_latitude, data.allowed_longitude);
    if (distance > data.allowed_radius_meters) {
      throw new Error(`outside_geo_fence: ${Math.round(distance)}m from allowed zone (max ${data.allowed_radius_meters}m)`);
    }
  }
  return ingestEvent({
    employee_id: data.employee_id,
    event_time: data.event_time,
    source: 'geo_checkin',
    latitude: data.latitude,
    longitude: data.longitude,
    device_metadata: data.device_metadata,
  });
}

export async function listPendingGeo(filters: { status?: string | undefined } = {}) {
  const wheres = ["ap.event_type IN ('geo_checkin','field_work','client_visit')"];
  const params: unknown[] = [];
  let idx = 1;
  if (filters.status) { wheres.push(`ap.status = $${idx++}`); params.push(filters.status); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT ap.id, ap.employee_id, e.full_name, e.employee_code,
            ap.work_date, ap.reason, ap.event_type, ap.latitude, ap.longitude,
            ap.status, ap.created_at
     FROM attendance_pending ap
     JOIN employees e ON e.id = ap.employee_id
     ${where}
     ORDER BY ap.created_at DESC`,
    params
  );
  return rows;
}

export async function getIndividualAttendanceCalendar(employeeId: string, monthStr?: string): Promise<{
  month: string;
  employee: { id: string; full_name: string; employee_code: string };
  summary: {
    total_days: number;
    present: number;
    late: number;
    absent: number;
    leave: number;
    holiday: number;
    weekend: number;
  };
  days: Array<{
    date: string;
    day: number;
    day_name: string;
    status: string;
    first_in?: string | null;
    last_out?: string | null;
    late_minutes?: number | null;
    late_out_minutes?: number | null;
  }>;
}> {
  const empRes = await query<{ id: string; full_name: string; employee_code: string }>(
    `SELECT id, full_name, employee_code FROM employees WHERE id = $1 AND deleted_at IS NULL`,
    [employeeId]
  );
  if (empRes.rows.length === 0) {
    throw new Error(`Employee not found: ${employeeId}`);
  }
  const employee = empRes.rows[0];

  const now = new Date();
  const m = monthStr || now.toISOString().slice(0, 7);
  const [yearStr, monthNumStr] = m.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthNumStr, 10);
  const totalDays = new Date(year, monthNum, 0).getDate();

  const startDate = `${m}-01`;
  const endDate = `${m}-${String(totalDays).padStart(2, '0')}`;

  const daysRes = await query<Record<string, unknown>>(
    `SELECT * FROM attendance_days WHERE employee_id = $1 AND work_date >= $2 AND work_date <= $3`,
    [employeeId, startDate, endDate]
  );
  const recordedByDate = new Map<string, Record<string, unknown>>();
  for (const r of daysRes.rows) {
    const dStr = typeof r.work_date === 'string' ? r.work_date.slice(0, 10) : new Date(r.work_date as Date).toISOString().slice(0, 10);
    recordedByDate.set(dStr, r);
  }

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days: Array<{
    date: string;
    day: number;
    day_name: string;
    status: string;
    first_in?: string | null;
    last_out?: string | null;
    late_minutes?: number | null;
    late_out_minutes?: number | null;
  }> = [];

  let presentCount = 0;
  let lateCount = 0;
  let absentCount = 0;
  let leaveCount = 0;
  let holidayCount = 0;
  let weekendCount = 0;

  const todayStr = now.toISOString().slice(0, 10);

  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${m}-${String(day).padStart(2, '0')}`;
    const dt = new Date(year, monthNum - 1, day);
    const dayName = DAY_NAMES[dt.getDay()];
    const isWeekend = dt.getDay() === 5 || dt.getDay() === 6;

    const rec = recordedByDate.get(dateStr);
    let status = 'Upcoming';
    if (rec) {
      status = String(rec.status);
    } else if (dateStr > todayStr) {
      status = 'Upcoming';
    } else if (isWeekend) {
      status = 'Weekend';
    } else {
      status = 'Absent';
    }

    if (status === 'Present') presentCount++;
    else if (status === 'Late') lateCount++;
    else if (status === 'Absent' || status === 'Missing') absentCount++;
    else if (status.includes('Leave')) leaveCount++;
    else if (status.includes('Holiday')) holidayCount++;
    else if (status === 'Weekend') weekendCount++;

    days.push({
      date: dateStr,
      day,
      day_name: dayName,
      status,
      first_in: (rec?.first_in as string) ?? null,
      last_out: (rec?.last_out as string) ?? null,
      late_minutes: (rec?.late_minutes as number) ?? null,
      late_out_minutes: (rec?.late_out_minutes as number) ?? null,
    });
  }

  return {
    month: m,
    employee,
    summary: {
      total_days: totalDays,
      present: presentCount,
      late: lateCount,
      absent: absentCount,
      leave: leaveCount,
      holiday: holidayCount,
      weekend: weekendCount,
    },
    days,
  };
}
