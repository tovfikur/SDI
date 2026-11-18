/**
 * Field tracking (self attendance with GPS punches + live location tracking).
 *
 * Actual check-in / check-out punches are attendance_events with sources
 * `field_checkin` / `field_checkout` (free-text `source`, no enum change
 * needed) so existing first-in/last-out and monthly calculations keep working.
 * Periodic GPS pings are stored only in `field_location_points`.
 */

import {
  query,
  withTransaction,
  parsePagination,
  totalPages,
  isIsoDateTime,
  getPool,
} from '@jsk/shared-kernel';
import type { Queryable, PaginatedResponse } from '@jsk/shared-kernel';
import {
  applyGeofenceTransition,
  evaluateEmployeePoint,
  geofenceStateForEmployees,
  geofenceLiveSummary,
} from '@jsk/domain-geofence';
import type { GeofenceStatusValue } from '@jsk/domain-geofence';
import { ORG_TZ } from './calculation';
import { localDateOf, recalculateEmployeeDay } from './service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FieldTrackingSession {
  id: string;
  employee_id: string;
  check_in_event_id: string | null;
  check_out_event_id: string | null;
  started_at: string;
  ended_at: string | null;
  start_latitude: number;
  start_longitude: number;
  end_latitude: number | null;
  end_longitude: number | null;
  status: 'active' | 'completed';
  device_id: string | null;
  geofence_id: string | null;
  current_geofence_status: GeofenceStatusValue | null;
  last_geofence_transition_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FieldLocationPointInput {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  altitude?: number | null;
  speed?: number | null;
  heading?: number | null;
  captured_at?: string | null;
  battery_level?: number | null;
  metadata?: Record<string, unknown> | null;
}

export const FIELD_LOCATION_BATCH_MAX = 100;

/** Device timestamps further than this from server time are ignored (clock skew). */
const MAX_CLIENT_SKEW_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/** Validates coordinates, accuracy and optional captured_at. Throws domain error codes. */
export function validateFieldPoint(point: FieldLocationPointInput): void {
  if (!Number.isFinite(point.latitude) || !isValidLatitude(point.latitude)) {
    throw new Error('field_tracking.invalid_latitude');
  }
  if (!Number.isFinite(point.longitude) || !isValidLongitude(point.longitude)) {
    throw new Error('field_tracking.invalid_longitude');
  }
  if (point.accuracy != null && (!Number.isFinite(point.accuracy) || point.accuracy < 0)) {
    throw new Error('field_tracking.invalid_accuracy');
  }
  if (point.captured_at != null && !isIsoDateTime(point.captured_at)) {
    throw new Error('field_tracking.invalid_captured_at');
  }
}

/** Uses the client timestamp when plausible, otherwise server now. */
function normalizeEventTime(capturedAt: string | null | undefined, now = new Date()): string {
  if (capturedAt) {
    const t = new Date(capturedAt).getTime();
    if (Number.isFinite(t) && Math.abs(now.getTime() - t) <= MAX_CLIENT_SKEW_MS) {
      return capturedAt;
    }
  }
  return now.toISOString();
}

// ---------------------------------------------------------------------------
// Project-based attendance geofence
// ---------------------------------------------------------------------------

/** Great-circle distance between two WGS-84 coordinates, in meters (Haversine). */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Project-based attendance geofence (FR-103).
 *
 * When the employee has at least one active project with a configured location
 * (via `project_members` membership or being the project lead), a field
 * check-in is only allowed from inside at least one of those project ranges.
 * Throws `OUTSIDE_PROJECT_RANGE` otherwise. Employees without any configured
 * project location are unaffected (generic geofence behavior remains).
 */
export async function checkProjectCheckInGeofence(
  employeeId: string,
  latitude: number,
  longitude: number
): Promise<void> {
  const { rows } = await query<{
    id: string;
    latitude: number | string;
    longitude: number | string;
    check_in_radius: number | string;
  }>(
    `SELECT p.id, p.latitude, p.longitude, p.check_in_radius
       FROM projects p
      WHERE p.deleted_at IS NULL
        AND p.status IN ('open', 'in_progress')
        AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
        AND (p.project_lead_id = $1::uuid
             OR EXISTS (SELECT 1 FROM project_members pm
                         WHERE pm.project_id = p.id AND pm.employee_id = $1::uuid))`,
    [employeeId]
  );
  if (rows.length === 0) {
    return;
  }
  const inside = rows.some((r) => {
    const distance = haversineDistanceMeters(
      latitude,
      longitude,
      Number(r.latitude),
      Number(r.longitude)
    );
    const radius = Number(r.check_in_radius) || 100;
    return distance <= radius;
  });
  if (!inside) {
    throw new Error('OUTSIDE_PROJECT_RANGE');
  }
}

// ---------------------------------------------------------------------------
// Session lookups
// ---------------------------------------------------------------------------

export async function getActiveFieldSession(
  employeeId: string
): Promise<FieldTrackingSession | null> {
  const { rows } = await query<FieldTrackingSession>(
    `SELECT * FROM field_tracking_sessions
      WHERE employee_id = $1 AND status = 'active'
      ORDER BY started_at DESC LIMIT 1`,
    [employeeId]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Location point persistence
// ---------------------------------------------------------------------------

async function insertFieldLocationPoint(
  sessionId: string,
  employeeId: string,
  point: FieldLocationPointInput,
  q: Queryable = getPool()
): Promise<void> {
  validateFieldPoint(point);
  await query(
    `INSERT INTO field_location_points
       (session_id, employee_id, latitude, longitude, accuracy, altitude, speed, heading,
        captured_at, received_at, battery_level, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, now(), $10, $11)`,
    [
      sessionId,
      employeeId,
      point.latitude,
      point.longitude,
      point.accuracy ?? null,
      point.altitude ?? null,
      point.speed ?? null,
      point.heading ?? null,
      normalizeEventTime(point.captured_at ?? null),
      point.battery_level ?? null,
      point.metadata ? JSON.stringify(point.metadata) : null,
    ],
    q
  );
}

// ---------------------------------------------------------------------------
// Employee check-in
// ---------------------------------------------------------------------------

export interface FieldCheckInInput {
  employee_id: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  device_id?: string | null;
  captured_at?: string | null;
}

export async function fieldCheckIn(input: FieldCheckInInput): Promise<FieldTrackingSession> {
  validateFieldPoint({
    latitude: input.latitude,
    longitude: input.longitude,
    accuracy: input.accuracy ?? null,
    captured_at: input.captured_at ?? null,
  });
  const startedAt = normalizeEventTime(input.captured_at ?? null);

  // Project-based attendance geofence: when the employee has configured project
  // locations, check-in is only allowed from inside at least one of them.
  await checkProjectCheckInGeofence(input.employee_id, input.latitude, input.longitude);

  // Optional geofencing: refuse check-in while outside the allowed area.
  const geofenceCheck = await evaluateEmployeePoint(
    input.employee_id,
    input.latitude,
    input.longitude,
    input.accuracy ?? null
  );
  if (geofenceCheck.rule && geofenceCheck.rule.assignment.enabled) {
    if (geofenceCheck.rule.assignment.restrict_check_in && geofenceCheck.status === 'outside') {
      throw new Error('geofence.outside_checkin');
    }
    if (geofenceCheck.rule.assignment.restrict_check_in && geofenceCheck.status === 'unknown') {
      throw new Error('geofence.accuracy_insufficient');
    }
  }

  const session = await withTransaction(async (client) => {
    const activeRes = await client.query<{ id: string }>(
      `SELECT id FROM field_tracking_sessions
        WHERE employee_id = $1 AND status = 'active'
        FOR UPDATE`,
      [input.employee_id]
    );
    if (activeRes.rows.length > 0) {
      throw new Error('field_tracking.already_active');
    }

    const eventRes = await client.query<{ id: string }>(
      `INSERT INTO attendance_events (employee_id, event_time, source, latitude, longitude, device_metadata)
       VALUES ($1, $2::timestamptz, 'field_checkin', $3, $4, $5)
       ON CONFLICT (employee_id, event_time, source) DO NOTHING
       RETURNING id`,
      [
        input.employee_id,
        startedAt,
        input.latitude,
        input.longitude,
        JSON.stringify({
          device_id: input.device_id ?? null,
          accuracy: input.accuracy ?? null,
          geofence: geofenceCheck.rule?.geofence.name ?? null,
          inside_geofence: geofenceCheck.status === 'inside' ? true : null,
        }),
      ]
    );
    if (eventRes.rows.length === 0) {
      throw new Error('field_tracking.checkin_event_conflict');
    }
    const checkInEventId = eventRes.rows[0].id;

    const sessionRes = await client.query<FieldTrackingSession>(
      `INSERT INTO field_tracking_sessions
         (employee_id, check_in_event_id, started_at, start_latitude, start_longitude, device_id)
       VALUES ($1, $2, $3::timestamptz, $4, $5, $6)
       RETURNING *`,
      [
        input.employee_id,
        checkInEventId,
        startedAt,
        input.latitude,
        input.longitude,
        input.device_id ?? null,
      ]
    );
    const newSession = sessionRes.rows[0];

    await insertFieldLocationPoint(
      newSession.id,
      input.employee_id,
      {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy ?? null,
        captured_at: startedAt,
      },
      client
    );

    return newSession;
  });

  // Establish the session's geofence state from the check-in point (records an
  // initial EXIT event when a monitored employee checks in outside).
  await applyGeofenceTransition({
    session_id: session.id,
    employee_id: input.employee_id,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracy: input.accuracy ?? null,
    captured_at: startedAt,
  });

  await recalculateDay(input.employee_id, startedAt);
  return session;
}

// ---------------------------------------------------------------------------
// Location updates (single + batch)
// ---------------------------------------------------------------------------

export async function recordFieldLocation(input: {
  employee_id: string;
  point: FieldLocationPointInput;
}): Promise<{ saved: boolean; received_at: string }> {
  const session = await getActiveFieldSession(input.employee_id);
  if (!session) {
    throw new Error('field_tracking.no_active_session');
  }
  await insertFieldLocationPoint(session.id, input.employee_id, input.point);
  await applyGeofenceTransition({
    session_id: session.id,
    employee_id: input.employee_id,
    latitude: input.point.latitude,
    longitude: input.point.longitude,
    accuracy: input.point.accuracy ?? null,
    captured_at: normalizeEventTime(input.point.captured_at ?? null),
  });
  return { saved: true, received_at: new Date().toISOString() };
}

export async function recordFieldLocationsBatch(input: {
  employee_id: string;
  points: FieldLocationPointInput[];
}): Promise<{ saved: number; received_at: string }> {
  if (input.points.length === 0) {
    return { saved: 0, received_at: new Date().toISOString() };
  }
  if (input.points.length > FIELD_LOCATION_BATCH_MAX) {
    throw new Error('field_tracking.batch_too_large');
  }
  const session = await getActiveFieldSession(input.employee_id);
  if (!session) {
    throw new Error('field_tracking.no_active_session');
  }

  const seen = new Set<string>();
  const deduped: FieldLocationPointInput[] = [];
  for (const point of input.points) {
    validateFieldPoint(point);
    const key = `${point.captured_at ?? ''}|${point.latitude}|${point.longitude}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(point);
  }
  if (deduped.length === 0) {
    return { saved: 0, received_at: new Date().toISOString() };
  }

  const values: string[] = [];
  const params: unknown[] = [];
  for (const point of deduped) {
    const base = params.length;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, ` +
        `$${base + 7}, $${base + 8}, $${base + 9}::timestamptz, now(), $${base + 10}, $${base + 11})`
    );
    params.push(
      session.id,
      input.employee_id,
      point.latitude,
      point.longitude,
      point.accuracy ?? null,
      point.altitude ?? null,
      point.speed ?? null,
      point.heading ?? null,
      normalizeEventTime(point.captured_at ?? null),
      point.battery_level ?? null,
      point.metadata ? JSON.stringify(point.metadata) : null
    );
  }
  await query(
    `INSERT INTO field_location_points
       (session_id, employee_id, latitude, longitude, accuracy, altitude, speed, heading,
        captured_at, received_at, battery_level, metadata)
     VALUES ${values.join(', ')}`,
    params
  );

  // Evaluate the geofence against the newest point in the batch only (the
  // stabilization logic compares with the previously stored point).
  const newest = deduped.reduce((a, b) =>
    (b.captured_at ?? '') > (a.captured_at ?? '') ? b : a
  );
  await applyGeofenceTransition({
    session_id: session.id,
    employee_id: input.employee_id,
    latitude: newest.latitude,
    longitude: newest.longitude,
    accuracy: newest.accuracy ?? null,
    captured_at: normalizeEventTime(newest.captured_at ?? null),
  });

  return { saved: deduped.length, received_at: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Employee check-out
// ---------------------------------------------------------------------------

export interface FieldCheckOutInput {
  employee_id: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  captured_at?: string | null;
}

export async function fieldCheckOut(input: FieldCheckOutInput): Promise<FieldTrackingSession> {
  validateFieldPoint({
    latitude: input.latitude,
    longitude: input.longitude,
    accuracy: input.accuracy ?? null,
    captured_at: input.captured_at ?? null,
  });
  const endedAt = normalizeEventTime(input.captured_at ?? null);

  // Optional geofencing: check-out can be independently restricted.
  const geofenceCheck = await evaluateEmployeePoint(
    input.employee_id,
    input.latitude,
    input.longitude,
    input.accuracy ?? null
  );
  if (geofenceCheck.rule && geofenceCheck.rule.assignment.enabled) {
    if (geofenceCheck.rule.assignment.restrict_check_out && geofenceCheck.status === 'outside') {
      throw new Error('geofence.outside_checkout');
    }
    if (geofenceCheck.rule.assignment.restrict_check_out && geofenceCheck.status === 'unknown') {
      throw new Error('geofence.accuracy_insufficient');
    }
  }

  const session = await withTransaction(async (client) => {
    const activeRes = await client.query<FieldTrackingSession>(
      `SELECT * FROM field_tracking_sessions
        WHERE employee_id = $1 AND status = 'active'
        FOR UPDATE`,
      [input.employee_id]
    );
    if (activeRes.rows.length === 0) {
      throw new Error('field_tracking.no_active_session');
    }
    const activeSession = activeRes.rows[0];

    await insertFieldLocationPoint(
      activeSession.id,
      input.employee_id,
      {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy ?? null,
        captured_at: endedAt,
      },
      client
    );

    const eventRes = await client.query<{ id: string }>(
      `INSERT INTO attendance_events (employee_id, event_time, source, latitude, longitude, device_metadata)
       VALUES ($1, $2::timestamptz, 'field_checkout', $3, $4, $5)
       ON CONFLICT (employee_id, event_time, source) DO NOTHING
       RETURNING id`,
      [
        input.employee_id,
        endedAt,
        input.latitude,
        input.longitude,
        JSON.stringify({
          accuracy: input.accuracy ?? null,
          geofence: geofenceCheck.rule?.geofence.name ?? null,
          inside_geofence: geofenceCheck.status === 'inside' ? true : null,
        }),
      ]
    );
    if (eventRes.rows.length === 0) {
      throw new Error('field_tracking.checkout_event_conflict');
    }

    const updateRes = await client.query<FieldTrackingSession>(
      `UPDATE field_tracking_sessions
          SET ended_at = $2::timestamptz, end_latitude = $3, end_longitude = $4,
              status = 'completed', check_out_event_id = $5, updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [activeSession.id, endedAt, input.latitude, input.longitude, eventRes.rows[0].id]
    );
    return updateRes.rows[0];
  });

  await recalculateDay(input.employee_id, endedAt);
  return session;
}

// ---------------------------------------------------------------------------
// Employee current status
// ---------------------------------------------------------------------------

export interface FieldTrackingStatus {
  checkedIn: boolean;
  trackingActive: boolean;
  employee: { id: string; full_name: string; employee_code: string } | null;
  session: {
    id: string;
    started_at: string;
    start_latitude: number;
    start_longitude: number;
    last_location_at: string | null;
    last_latitude: number | null;
    last_longitude: number | null;
    check_in_event_id: string | null;
    device_id: string | null;
  } | null;
  /** null = no geofence applies to this employee (feature is optional). */
  geofence: {
    name: string;
    center_latitude: number;
    center_longitude: number;
    radius_meters: number;
    status: GeofenceStatusValue | null;
    inside: boolean | null;
    checkInRestricted: boolean;
    checkOutRestricted: boolean;
    monitored: boolean;
    distance_meters: number | null;
  } | null;
  todayAttendance?: {
    work_date: string;
    first_in: string | null;
    last_out: string | null;
    total_work_minutes?: number | null;
    total_worked_minutes?: number | null;
    status: string | null;
  } | null;
}

export async function getFieldTrackingStatus(employeeId: string): Promise<FieldTrackingStatus> {
  const empRes = await query<{ id: string; full_name: string; employee_code: string }>(
    `SELECT id, full_name, employee_code FROM employees WHERE id = $1 AND deleted_at IS NULL`,
    [employeeId]
  );
  const employee = empRes.rows[0] ?? null;

  // Retrieve today's attendance record in Dhaka timezone
  const todayRes = await query<{
    work_date: string;
    first_in: string | null;
    last_out: string | null;
    total_work_minutes: number | null;
    total_worked_minutes: number | null;
    status: string | null;
  }>(
    `SELECT work_date::text, first_in::text, last_out::text,
            total_work_minutes, total_work_minutes AS total_worked_minutes, status
       FROM attendance_days
      WHERE employee_id = $1
        AND work_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date`,
    [employeeId]
  );
  const todayAttendance = todayRes.rows[0] ?? null;

  const session = await getActiveFieldSession(employeeId);
  // Auto-close stale active sessions from past days
  if (session) {
    const isPastRes = await query<{ is_past: boolean }>(
      `SELECT ($1::timestamptz AT TIME ZONE 'Asia/Dhaka')::date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date AS is_past`,
      [session.started_at]
    );
    if (isPastRes.rows[0]?.is_past) {
      await query(
        `UPDATE field_tracking_sessions
            SET status = 'completed', ended_at = started_at + interval '8 hours', updated_at = now()
          WHERE id = $1`,
        [session.id]
      );
      const rule = await evaluateEmployeePoint(employeeId, 0, 0, null);
      return {
        checkedIn: false,
        trackingActive: false,
        employee,
        session: null,
        geofence: rule.rule ? geofenceStatusPayload(rule.rule, null, null) : null,
        todayAttendance,
      };
    }
  }

  if (!session) {
    const rule = await evaluateEmployeePoint(employeeId, 0, 0, null);
    return {
      checkedIn: false,
      trackingActive: false,
      employee,
      session: null,
      geofence: rule.rule ? geofenceStatusPayload(rule.rule, null, null) : null,
      todayAttendance,
    };
  }

  const pointRes = await query<{ captured_at: string; latitude: number; longitude: number; accuracy: number | null }>(
    `SELECT captured_at, latitude, longitude, accuracy
       FROM field_location_points
      WHERE session_id = $1
      ORDER BY captured_at DESC LIMIT 1`,
    [session.id]
  );
  const last = pointRes.rows[0] ?? null;

  const rule = await evaluateEmployeePoint(
    employeeId,
    last?.latitude ?? session.start_latitude,
    last?.longitude ?? session.start_longitude,
    last?.accuracy ?? null
  );
  const sessionStatus: GeofenceStatusValue | null = session.current_geofence_status;
  const geofence =
    rule.rule && sessionStatus !== null
      ? geofenceStatusPayload(rule.rule, sessionStatus, rule.distance_meters)
      : rule.rule
        ? geofenceStatusPayload(rule.rule, null, rule.distance_meters)
        : null;

  return {
    checkedIn: true,
    trackingActive: true,
    employee,
    session: {
      id: session.id,
      started_at: session.started_at,
      start_latitude: session.start_latitude,
      start_longitude: session.start_longitude,
      last_location_at: last?.captured_at ?? null,
      last_latitude: last?.latitude ?? null,
      last_longitude: last?.longitude ?? null,
      check_in_event_id: session.check_in_event_id,
      device_id: session.device_id,
    },
    geofence,
    todayAttendance,
  };
}

function geofenceStatusPayload(
  rule: { geofence: { name: string; center_latitude: number; center_longitude: number; radius_meters: number }; assignment: { restrict_check_in: boolean; restrict_check_out: boolean; monitor_exit: boolean } },
  status: GeofenceStatusValue | null,
  distanceMeters: number | null
): NonNullable<FieldTrackingStatus['geofence']> {
  return {
    name: rule.geofence.name,
    center_latitude: rule.geofence.center_latitude,
    center_longitude: rule.geofence.center_longitude,
    radius_meters: rule.geofence.radius_meters,
    status,
    inside: status === 'inside' ? true : status === 'outside' ? false : null,
    checkInRestricted: rule.assignment.restrict_check_in,
    checkOutRestricted: rule.assignment.restrict_check_out,
    monitored: rule.assignment.monitor_exit,
    distance_meters: distanceMeters,
  };
}

// ---------------------------------------------------------------------------
// Admin: live tracking, route history, sessions
// ---------------------------------------------------------------------------

export interface FieldTrackingLiveEntry {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  position_name: string | null;
  department_name: string | null;
  branch_id?: string | null | undefined;
  branch_name?: string | null | undefined;
  session_id: string;
  started_at: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  last_seen_at: string | null;
  geofence: {
    id: string;
    name: string;
    center_latitude: number;
    center_longitude: number;
    radius_meters: number;
    status: GeofenceStatusValue | null;
    inside: boolean | null;
    flag_exit: boolean;
  } | null;
}

export async function listFieldTrackingLive(): Promise<FieldTrackingLiveEntry[]> {
  // Conclude any stale/abandoned sessions older than 24 hours or belonging to inactive/deleted employees
  await query(
    `UPDATE field_tracking_sessions
        SET status = 'completed',
            ended_at = COALESCE(
              (SELECT max(captured_at) FROM field_location_points WHERE session_id = field_tracking_sessions.id),
              started_at + INTERVAL '8 hours'
            )
      WHERE status = 'active'
        AND (
          started_at < (now() - INTERVAL '24 hours')
          OR employee_id IN (SELECT id FROM employees WHERE deleted_at IS NOT NULL OR status != 'active')
        )`
  );

  const { rows } = await query<
    Omit<FieldTrackingLiveEntry, 'geofence'> & { geofence_status: GeofenceStatusValue | null }
  >(
    `SELECT DISTINCT ON (s.employee_id)
            s.employee_id,
            e.employee_code, e.full_name AS employee_name,
            p.name AS position_name, d.name AS department_name,
            e.branch_id, b.name AS branch_name,
            s.id AS session_id, s.started_at,
            lp.latitude, lp.longitude, lp.accuracy, lp.captured_at AS last_seen_at,
            s.current_geofence_status AS geofence_status
       FROM field_tracking_sessions s
       JOIN employees e ON e.id = s.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN positions p ON p.id = e.position_id
       LEFT JOIN branches b ON b.id = e.branch_id
       LEFT JOIN LATERAL (
         SELECT latitude, longitude, accuracy, captured_at
           FROM field_location_points
          WHERE session_id = s.id
          ORDER BY captured_at DESC
          LIMIT 1
       ) lp ON true
      WHERE s.status = 'active'
        AND e.deleted_at IS NULL
        AND e.status = 'active'
      ORDER BY s.employee_id, s.started_at DESC`
  );

  const stateMap = await geofenceStateForEmployees(rows.map((r) => r.employee_id));
  return rows.map((row) => {
    const state = stateMap[row.employee_id] ?? null;
    const geofence = state
      ? {
          id: state.rule.geofence.id,
          name: state.rule.geofence.name,
          center_latitude: state.rule.geofence.center_latitude,
          center_longitude: state.rule.geofence.center_longitude,
          radius_meters: state.rule.geofence.radius_meters,
          status: row.geofence_status,
          inside:
            row.geofence_status === 'inside'
              ? true
              : row.geofence_status === 'outside'
                ? false
                : null,
          flag_exit: state.rule.assignment.flag_exit,
        }
      : null;
    return {
      employee_id: row.employee_id,
      employee_code: row.employee_code,
      employee_name: row.employee_name,
      position_name: row.position_name,
      department_name: row.department_name,
      branch_id: row.branch_id ?? null,
      branch_name: row.branch_name ?? null,
      session_id: row.session_id,
      started_at: row.started_at,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy: row.accuracy,
      last_seen_at: row.last_seen_at,
      geofence,
    };
  });
}

export interface FieldTrackingRoutePoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  captured_at: string;
  received_at: string;
  battery_level: number | null;
}

export interface FieldTrackingRouteSession {
  session_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  start_latitude: number;
  start_longitude: number;
  end_latitude: number | null;
  end_longitude: number | null;
  check_in_event_id: string | null;
  check_out_event_id: string | null;
  points: FieldTrackingRoutePoint[];
  geofence: {
    id: string;
    name: string;
    center_latitude: number;
    center_longitude: number;
    radius_meters: number;
  } | null;
  geofence_events: FieldTrackingRouteGeofenceEvent[];
}

export interface FieldTrackingRouteGeofenceEvent {
  event_type: 'entered' | 'exited';
  latitude: number;
  longitude: number;
  accuracy: number | null;
  occurred_at: string;
}

export interface FieldTrackingRouteResponse {
  employee: {
    id: string;
    full_name: string;
    employee_code: string;
    position_name: string | null;
    department_name: string | null;
  } | null;
  sessions: FieldTrackingRouteSession[];
  /** Effective geofence for the employee on that day (null when not applied). */
  geofence: {
    id: string;
    name: string;
    center_latitude: number;
    center_longitude: number;
    radius_meters: number;
  } | null;
}

export async function getFieldTrackingRoute(
  employeeId: string,
  date: string
): Promise<FieldTrackingRouteResponse> {
  const empRes = await query<{
    id: string;
    full_name: string;
    employee_code: string;
    position_name: string | null;
    department_name: string | null;
  }>(
    `SELECT e.id, e.full_name, e.employee_code, p.name AS position_name, d.name AS department_name
       FROM employees e
       LEFT JOIN positions p ON p.id = e.position_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.id = $1 AND e.deleted_at IS NULL`,
    [employeeId]
  );
  const employee = empRes.rows[0] ?? null;

  const sessionRes = await query<Omit<FieldTrackingRouteSession, 'points' | 'geofence' | 'geofence_events'>>(
    `SELECT id AS session_id, started_at, ended_at, status,
            start_latitude, start_longitude, end_latitude, end_longitude,
            check_in_event_id, check_out_event_id
       FROM field_tracking_sessions
      WHERE employee_id = $1
        AND (started_at AT TIME ZONE '${ORG_TZ}')::date = $2::date
      ORDER BY started_at`,
    [employeeId, date]
  );
  const sessions = sessionRes.rows;
  if (sessions.length === 0) {
    return {
      employee,
      sessions: [],
      geofence: await currentGeofenceGeometry(employeeId),
    };
  }

  const pointRes = await query<FieldTrackingRoutePoint & { session_id: string }>(
    `SELECT session_id, latitude, longitude, accuracy, altitude, speed, heading,
            captured_at, received_at, battery_level
       FROM field_location_points
      WHERE session_id = ANY($1::uuid[])
      ORDER BY captured_at ASC`,
    [sessions.map((s) => s.session_id)]
  );
  const bySession = new Map<string, FieldTrackingRoutePoint[]>();
  for (const row of pointRes.rows) {
    const { session_id, ...point } = row;
    const list = bySession.get(session_id) ?? [];
    list.push(point);
    bySession.set(session_id, list);
  }

  const eventRes = await query<FieldTrackingRouteGeofenceEvent & { session_id: string }>(
    `SELECT session_id, event_type, latitude, longitude, accuracy, occurred_at
       FROM geofence_events
      WHERE tracking_session_id = ANY($1::uuid[])
      ORDER BY occurred_at ASC`,
    [sessions.map((s) => s.session_id)]
  );
  const eventsBySession = new Map<string, FieldTrackingRouteGeofenceEvent[]>();
  for (const row of eventRes.rows) {
    const { session_id, ...event } = row;
    const list = eventsBySession.get(session_id) ?? [];
    list.push(event);
    eventsBySession.set(session_id, list);
  }

  const geofence = await currentGeofenceGeometry(employeeId);

  return {
    employee,
    sessions: sessions.map((s) => ({
      ...s,
      geofence,
      points: bySession.get(s.session_id) ?? [],
      geofence_events: eventsBySession.get(s.session_id) ?? [],
    })),
    geofence,
  };
}

async function currentGeofenceGeometry(
  employeeId: string
): Promise<NonNullable<FieldTrackingRouteResponse['geofence']> | null> {
  const rule = await evaluateEmployeePoint(employeeId, 0, 0, null);
  if (!rule.rule) {
    return null;
  }
  return {
    id: rule.rule.geofence.id,
    name: rule.rule.geofence.name,
    center_latitude: rule.rule.geofence.center_latitude,
    center_longitude: rule.rule.geofence.center_longitude,
    radius_meters: rule.rule.geofence.radius_meters,
  };
}

export interface FieldTrackingSessionListItem {
  id: string;
  employee_id: string;
  full_name: string;
  employee_code: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  start_latitude: number;
  start_longitude: number;
  end_latitude: number | null;
  end_longitude: number | null;
  point_count: number;
}

export interface FieldTrackingSessionListInput {
  employee_id?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  per_page?: number;
}

export async function listFieldTrackingSessions(
  input: FieldTrackingSessionListInput
): Promise<PaginatedResponse<FieldTrackingSessionListItem>> {
  if (input.date_from && !isIsoDateValue(input.date_from)) {
    throw new Error('field_tracking.invalid_date');
  }
  if (input.date_to && !isIsoDateValue(input.date_to)) {
    throw new Error('field_tracking.invalid_date');
  }
  const { page, per_page } = parsePagination(input.page, input.per_page);

  const wheres: string[] = ['e.deleted_at IS NULL'];
  const params: unknown[] = [];
  let idx = 1;
  if (input.employee_id) {
    wheres.push(`s.employee_id = $${idx++}`);
    params.push(input.employee_id);
  }
  if (input.status) {
    wheres.push(`s.status = $${idx++}`);
    params.push(input.status);
  }
  if (input.date_from) {
    wheres.push(`s.started_at >= $${idx++}::timestamptz`);
    params.push(`${input.date_from}T00:00:00+06:00`);
  }
  if (input.date_to) {
    wheres.push(`s.started_at < $${idx++}::timestamptz`);
    params.push(`${input.date_to}T23:59:59+06:00`);
  }
  const where = `WHERE ${wheres.join(' AND ')}`;

  const countRes = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM field_tracking_sessions s JOIN employees e ON e.id = s.employee_id ${where}`,
    params
  );
  const total = countRes.rows[0]?.n ?? 0;

  const { rows } = await query<FieldTrackingSessionListItem>(
    `SELECT s.id, s.employee_id, s.started_at, s.ended_at, s.status,
            s.start_latitude, s.start_longitude, s.end_latitude, s.end_longitude,
            e.full_name, e.employee_code,
            (SELECT count(*)::int FROM field_location_points lp WHERE lp.session_id = s.id) AS point_count
       FROM field_tracking_sessions s
       JOIN employees e ON e.id = s.employee_id
       ${where}
      ORDER BY s.started_at DESC
      LIMIT $${idx++} OFFSET $${idx}`,
    [...params, per_page, (page - 1) * per_page]
  );

  return {
    items: rows,
    total,
    page,
    per_page,
    total_pages: totalPages(total, per_page),
  };
}

function isIsoDateValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/**
 * Compact field-force analytics (BR-018): live counts + recent activity.
 * `employeeId` restricts to personal status only (no org-wide leak).
 */
export async function fieldTrackingAnalytics(employeeId?: string | null): Promise<Record<string, unknown>> {
  if (employeeId) {
    const [mineRes, myGeofence] = await Promise.all([
      query<{ active: boolean; today: number; points: number }>(
        `SELECT
           EXISTS(SELECT 1 FROM field_tracking_sessions WHERE employee_id = $1::uuid AND status = 'active') AS active,
           (SELECT COUNT(*)::int FROM field_tracking_sessions WHERE employee_id = $1::uuid AND started_at::date = CURRENT_DATE) AS today,
           (SELECT COUNT(*)::int FROM field_location_points WHERE employee_id = $1::uuid AND captured_at >= now() - interval '24 hours') AS points`,
        [employeeId]
      ),
      evaluateEmployeePoint(employeeId, 0, 0, null),
    ]);
    const mine = mineRes.rows[0] ?? null;
    return {
      myActive: mine?.active ?? false,
      mySessionsToday: mine?.today ?? 0,
      myPointsLast24h: mine?.points ?? 0,
      myGeofenceName: myGeofence.rule?.geofence.name ?? null,
    };
  }
  const [active, today, points, byTeam, geofence, activityTrend] = await Promise.all([
    query<{ n: number }>(
      `SELECT COUNT(DISTINCT s.employee_id)::int AS n
         FROM field_tracking_sessions s
         JOIN employees e ON e.id = s.employee_id
        WHERE s.status = 'active' AND e.deleted_at IS NULL AND e.status = 'active'`
    ),
    query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM field_tracking_sessions s
         JOIN employees e ON e.id = s.employee_id
        WHERE s.started_at::date = CURRENT_DATE AND e.deleted_at IS NULL`
    ),
    query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM field_location_points lp
         JOIN employees e ON e.id = lp.employee_id
        WHERE lp.captured_at >= now() - interval '24 hours' AND e.deleted_at IS NULL`
    ),
    query<{ team: string; n: number }>(
      `SELECT COALESCE(d.name, 'Unassigned') AS team, COUNT(DISTINCT s.employee_id)::int AS n
         FROM field_tracking_sessions s
         JOIN employees e ON e.id = s.employee_id
         LEFT JOIN departments d ON d.id = e.department_id
        WHERE s.status = 'active' AND e.deleted_at IS NULL AND e.status = 'active'
        GROUP BY d.name ORDER BY n DESC LIMIT 10`
    ),
    geofenceLiveSummary(),
    query<Record<string, unknown>>(
      `SELECT to_char(s.started_at::date, 'YYYY-MM-DD') AS date, COUNT(*)::int AS n
         FROM field_tracking_sessions s
         JOIN employees e ON e.id = s.employee_id
        WHERE s.started_at >= CURRENT_DATE - 13 AND e.deleted_at IS NULL
        GROUP BY s.started_at::date ORDER BY s.started_at::date`
    ),
  ]);
  return {
    activeOnDuty: active.rows[0]?.n ?? 0,
    sessionsToday: today.rows[0]?.n ?? 0,
    pointsLast24h: points.rows[0]?.n ?? 0,
    byTeam: byTeam.rows,
    geofence,
    activityTrend: activityTrend.rows,
  };
}

// ---------------------------------------------------------------------------
// Attendance day recalculation after a real punch
// ---------------------------------------------------------------------------

async function recalculateDay(employeeId: string, eventTime: string): Promise<void> {
  try {
    await recalculateEmployeeDay(employeeId, localDateOf(eventTime));
  } catch {
    // Day-level recalculation is idempotent and re-runnable; it must never
    // break the punch itself.
  }
}
