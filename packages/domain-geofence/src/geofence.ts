/**
 * Dynamic optional geofencing domain.
 *
 * Geofences are admin-configured circles. Assignments attach a geofence to a
 * scope (employee / department / employee type / work schedule) with
 * independent flags:
 *   - enabled           rule applies at all
 *   - restrict_check_in  check-in is refused while the employee is outside
 *   - restrict_check_out check-out is refused while outside
 *   - monitor_exit      watch for exits during a session (ENTER/EXIT events)
 *   - flag_exit         mark outside employees in the admin live map
 *
 * Geofencing is OPTIONAL: when no enabled assignment matches an employee, all
 * tracking behaves exactly as before. The backend always resolves the
 * effective rule itself — the client never supplies a geofence.
 *
 * Resolution order (first match wins): employee -> work schedule (setup rule)
 * -> employee type -> department. A disabled assignment at a higher priority
 * acts as an opt-out (no geofence applies to that employee).
 */

import { query, parsePagination, totalPages } from '@jsk/shared-kernel';
import type { PaginatedResponse } from '@jsk/shared-kernel';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MIN_GEOFENCE_RADIUS_METERS = 10;
export const MAX_GEOFENCE_RADIUS_METERS = 100_000;
/** Consecutive points classified in the new state before a transition fires. */
export const TRANSITION_MIN_POINTS = 2;

const EARTH_RADIUS_M = 6_371_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Geofence {
  id: string;
  name: string;
  description: string;
  type: 'circle';
  center_latitude: number;
  center_longitude: number;
  radius_meters: number;
  status: 'active' | 'inactive';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeofenceListItem extends Geofence {
  assignments_count: number;
}

export type GeofenceScopeType = 'employee' | 'department' | 'employee_type' | 'setup_rule';

export interface GeofenceAssignment {
  id: string;
  geofence_id: string;
  employee_id: string | null;
  department_id: string | null;
  employee_type_id: string | null;
  setup_rule_id: string | null;
  enabled: boolean;
  restrict_check_in: boolean;
  restrict_check_out: boolean;
  monitor_exit: boolean;
  flag_exit: boolean;
  created_at: string;
  updated_at: string;
}

export type GeofenceStatusValue = 'inside' | 'outside' | 'unknown';

export interface GeofenceRule {
  geofence: Geofence;
  assignment: GeofenceAssignment;
}

export interface GeofenceEvent {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  tracking_session_id: string | null;
  geofence_id: string;
  geofence_name: string;
  event_type: 'entered' | 'exited';
  latitude: number;
  longitude: number;
  accuracy: number | null;
  occurred_at: string;
}

export interface EmployeeScope {
  employee_id: string;
  department_id: string | null;
  employee_type_id: string | null;
  setup_rule_id: string | null;
}

// ---------------------------------------------------------------------------
// Pure geofence geometry / logic (unit-tested, no DB)
// ---------------------------------------------------------------------------

export function haversineDistanceMeters(
  latA: number,
  lngA: number,
  latB: number,
  lngB: number
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export interface GeofencePointEvaluation {
  status: GeofenceStatusValue;
  distance_meters: number;
}

/**
 * Classifies a GPS fix against a circle geofence using the reported GPS
 * accuracy as an uncertainty radius (three-band logic):
 *
 * - definitely inside:  distance + accuracy <= radius
 * - definitely outside: distance - accuracy > radius
 * - uncertain:          the accuracy band overlaps the boundary → `unknown`
 *
 * When no accuracy is reported the point is classified by raw distance.
 */
export function classifyGeofencePoint(
  latitude: number,
  longitude: number,
  accuracy: number | null | undefined,
  geofence: Pick<Geofence, 'center_latitude' | 'center_longitude' | 'radius_meters'>
): GeofencePointEvaluation {
  const distance = haversineDistanceMeters(
    latitude,
    longitude,
    geofence.center_latitude,
    geofence.center_longitude
  );
  const hasAccuracy =
    accuracy != null && Number.isFinite(accuracy) && accuracy >= 0 ? true : false;
  if (!hasAccuracy) {
    const inside = distance <= geofence.radius_meters;
    return { status: inside ? 'inside' : 'outside', distance_meters: distance };
  }
  const acc = accuracy as number;
  if (distance + acc <= geofence.radius_meters) {
    return { status: 'inside', distance_meters: distance };
  }
  if (distance - acc > geofence.radius_meters) {
    return { status: 'outside', distance_meters: distance };
  }
  return { status: 'unknown', distance_meters: distance };
}

/**
 * Picks the effective assignment for an employee.
 * Priority: employee -> setup rule (work schedule) -> employee type ->
 * department. The first matching assignment wins; if it is disabled, the rule
 * is treated as absent (opt-out).
 */
export function resolveEffectiveAssignment(
  assignments: GeofenceAssignment[],
  scope: EmployeeScope
): GeofenceAssignment | null {
  if (assignments.length === 0) {
    return null;
  }
  const byKey = (key: GeofenceScopeType): string | null => {
    switch (key) {
      case 'employee':
        return scope.employee_id;
      case 'setup_rule':
        return scope.setup_rule_id;
      case 'employee_type':
        return scope.employee_type_id;
      case 'department':
        return scope.department_id;
    }
  };
  const priority: GeofenceScopeType[] = ['employee', 'setup_rule', 'employee_type', 'department'];
  for (const key of priority) {
    const id = byKey(key);
    if (!id) {
      continue;
    }
    const match = assignments.find((a) => {
      switch (key) {
        case 'employee':
          return a.employee_id === id;
        case 'setup_rule':
          return a.setup_rule_id === id;
        case 'employee_type':
          return a.employee_type_id === id;
        case 'department':
          return a.department_id === id;
      }
    });
    if (match) {
      return match.enabled ? match : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateGeofenceCoordinates(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error('geofence.invalid_coordinates');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('geofence.invalid_coordinates');
  }
}

export function validateGeofenceRadius(radiusMeters: number): void {
  if (
    !Number.isFinite(radiusMeters) ||
    radiusMeters < MIN_GEOFENCE_RADIUS_METERS ||
    radiusMeters > MAX_GEOFENCE_RADIUS_METERS
  ) {
    throw new Error('geofence.invalid_radius');
  }
}

// ---------------------------------------------------------------------------
// Geofence CRUD
// ---------------------------------------------------------------------------

export interface GeofenceListInput {
  page?: number;
  per_page?: number;
  search?: string;
  status?: 'active' | 'inactive';
}

export async function listGeofences(
  input: GeofenceListInput
): Promise<PaginatedResponse<GeofenceListItem>> {
  const { page, per_page } = parsePagination(input.page, input.per_page);
  const wheres: string[] = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  let idx = 1;
  if (input.search && input.search.trim() !== '') {
    wheres.push(`(name ILIKE $${idx++} OR description ILIKE $${idx++})`);
    params.push(`%${input.search.trim()}%`, `%${input.search.trim()}%`);
  }
  if (input.status) {
    wheres.push(`status = $${idx++}`);
    params.push(input.status);
  }
  const where = `WHERE ${wheres.join(' AND ')}`;

  const countRes = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM geofences ${where}`,
    params
  );
  const total = countRes.rows[0]?.n ?? 0;

  const { rows } = await query<GeofenceListItem>(
    `SELECT g.*, (SELECT count(*)::int FROM geofence_assignments a WHERE a.geofence_id = g.id) AS assignments_count
       FROM geofences g
      ${where}
      ORDER BY g.created_at DESC
      LIMIT $${idx++} OFFSET $${idx}`,
    [...params, per_page, (page - 1) * per_page]
  );
  return { items: rows, total, page, per_page, total_pages: totalPages(total, per_page) };
}

export async function getGeofence(id: string): Promise<Geofence | null> {
  const { rows } = await query<Geofence>(
    `SELECT * FROM geofences WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

export interface GeofenceCreateInput {
  name: string;
  description?: string;
  center_latitude: number;
  center_longitude: number;
  radius_meters: number;
  created_by?: string;
}

export async function createGeofence(input: GeofenceCreateInput): Promise<Geofence> {
  const name = input.name.trim();
  if (name === '') {
    throw new Error('geofence.invalid_name');
  }
  validateGeofenceCoordinates(input.center_latitude, input.center_longitude);
  validateGeofenceRadius(input.radius_meters);
  const { rows } = await query<Geofence>(
    `INSERT INTO geofences
       (name, description, center_latitude, center_longitude, radius_meters, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      name,
      (input.description ?? '').trim(),
      input.center_latitude,
      input.center_longitude,
      input.radius_meters,
      input.created_by ?? null,
    ]
  );
  return rows[0];
}

export type GeofenceUpdateInput = Partial<{
  name: string;
  description: string;
  center_latitude: number;
  center_longitude: number;
  radius_meters: number;
  status: 'active' | 'inactive';
}>;

export async function updateGeofence(id: string, patch: GeofenceUpdateInput): Promise<Geofence | null> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  let idx = 2;
  if (patch.name !== undefined) {
    if (patch.name.trim() === '') {
      throw new Error('geofence.invalid_name');
    }
    sets.push(`name = $${idx++}`);
    params.push(patch.name.trim());
  }
  if (patch.description !== undefined) {
    sets.push(`description = $${idx++}`);
    params.push(patch.description.trim());
  }
  if (patch.center_latitude !== undefined || patch.center_longitude !== undefined) {
    const current = await getGeofence(id);
    if (!current) {
      throw new Error('geofence.not_found');
    }
    const lat = patch.center_latitude ?? current.center_latitude;
    const lng = patch.center_longitude ?? current.center_longitude;
    validateGeofenceCoordinates(lat, lng);
    sets.push(`center_latitude = $${idx++}`);
    params.push(lat);
    sets.push(`center_longitude = $${idx++}`);
    params.push(lng);
  }
  if (patch.radius_meters !== undefined) {
    validateGeofenceRadius(patch.radius_meters);
    sets.push(`radius_meters = $${idx++}`);
    params.push(patch.radius_meters);
  }
  if (patch.status !== undefined) {
    sets.push(`status = $${idx++}`);
    params.push(patch.status);
  }
  if (sets.length === 0) {
    return getGeofence(id);
  }
  const { rows } = await query<Geofence>(
    `UPDATE geofences SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

/** Deactivation is preferred over hard delete: history is preserved. */
export async function deactivateGeofence(id: string): Promise<boolean> {
  const res = await query(
    `UPDATE geofences SET status = 'inactive', updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return (res.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export interface AssignmentScope {
  type: GeofenceScopeType;
  id: string;
}

export interface AssignmentCreateInput {
  geofence_id: string;
  scope: AssignmentScope;
  enabled?: boolean;
  restrict_check_in?: boolean;
  restrict_check_out?: boolean;
  monitor_exit?: boolean;
  flag_exit?: boolean;
}

export interface AssignmentWithScope extends GeofenceAssignment {
  scope_type: GeofenceScopeType;
  scope_name: string;
}

export async function listAssignments(geofenceId: string): Promise<AssignmentWithScope[]> {
  const { rows } = await query<AssignmentWithScope>(
    `SELECT a.*,
            CASE
              WHEN a.employee_id IS NOT NULL THEN 'employee'
              WHEN a.department_id IS NOT NULL THEN 'department'
              WHEN a.employee_type_id IS NOT NULL THEN 'employee_type'
              ELSE 'setup_rule'
            END AS scope_type,
            COALESCE(e.full_name, d.name, et.name, sr.title, 'Unknown') AS scope_name
       FROM geofence_assignments a
       LEFT JOIN employees e ON e.id = a.employee_id
       LEFT JOIN departments d ON d.id = a.department_id
       LEFT JOIN employee_types et ON et.id = a.employee_type_id
       LEFT JOIN setup_rules sr ON sr.id = a.setup_rule_id
      WHERE a.geofence_id = $1
      ORDER BY a.created_at DESC`,
    [geofenceId]
  );
  return rows;
}

export async function createAssignment(input: AssignmentCreateInput): Promise<GeofenceAssignment> {
  const geofence = await getGeofence(input.geofence_id);
  if (!geofence) {
    throw new Error('geofence.not_found');
  }
  const { type, id } = input.scope;
  if (!id) {
    throw new Error('geofence.invalid_scope');
  }
  const cols =
    type === 'employee'
      ? { employee_id: id }
      : type === 'department'
        ? { department_id: id }
        : type === 'employee_type'
          ? { employee_type_id: id }
          : { setup_rule_id: id };
  const { rows } = await query<GeofenceAssignment>(
    `INSERT INTO geofence_assignments
       (geofence_id, employee_id, department_id, employee_type_id, setup_rule_id,
        enabled, restrict_check_in, restrict_check_out, monitor_exit, flag_exit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      input.geofence_id,
      cols.employee_id ?? null,
      cols.department_id ?? null,
      cols.employee_type_id ?? null,
      cols.setup_rule_id ?? null,
      input.enabled ?? true,
      input.restrict_check_in ?? true,
      input.restrict_check_out ?? false,
      input.monitor_exit ?? true,
      input.flag_exit ?? true,
    ]
  );
  if (rows.length === 0) {
    throw new Error('geofence.assignment_exists');
  }
  return rows[0];
}

export type AssignmentUpdateInput = Partial<{
  enabled: boolean;
  restrict_check_in: boolean;
  restrict_check_out: boolean;
  monitor_exit: boolean;
  flag_exit: boolean;
}>;

export async function updateAssignment(
  id: string,
  patch: AssignmentUpdateInput
): Promise<GeofenceAssignment | null> {
  const keys = [
    'enabled',
    'restrict_check_in',
    'restrict_check_out',
    'monitor_exit',
    'flag_exit',
  ] as const;
  const sets: string[] = [];
  const params: unknown[] = [id];
  let idx = 2;
  for (const key of keys) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      params.push(patch[key]);
    }
  }
  if (sets.length === 0) {
    const { rows } = await query<GeofenceAssignment>(
      `SELECT * FROM geofence_assignments WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }
  const { rows } = await query<GeofenceAssignment>(
    `UPDATE geofence_assignments SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

export async function removeAssignment(id: string): Promise<boolean> {
  const res = await query(`DELETE FROM geofence_assignments WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Effective rule resolution (used by field tracking / attendance)
// ---------------------------------------------------------------------------

export async function resolveGeofenceForEmployee(employeeId: string): Promise<GeofenceRule | null> {
  const scopeRes = await query<EmployeeScope>(
    `SELECT id AS employee_id, department_id, employee_type_id, setup_rule_id
       FROM employees WHERE id = $1 AND deleted_at IS NULL`,
    [employeeId]
  );
  const scope = scopeRes.rows[0];
  if (!scope) {
    return null;
  }
  const assignment = await resolveEffectiveAssignmentForScope(scope);
  if (!assignment) {
    return null;
  }
  const geofence = await query<Geofence>(
    `SELECT * FROM geofences WHERE id = $1 AND status = 'active' AND deleted_at IS NULL`,
    [assignment.geofence_id]
  );
  const fence = geofence.rows[0];
  if (!fence) {
    return null;
  }
  return { geofence: fence, assignment };
}

async function resolveEffectiveAssignmentForScope(scope: EmployeeScope): Promise<GeofenceAssignment | null> {
  const { rows } = await query<GeofenceAssignment>(
    `SELECT a.* FROM geofence_assignments a
      JOIN geofences g ON g.id = a.geofence_id AND g.status = 'active' AND g.deleted_at IS NULL
     WHERE a.employee_id = $1 OR a.setup_rule_id = $2 OR a.employee_type_id = $3 OR a.department_id = $4`,
    [scope.employee_id, scope.setup_rule_id, scope.employee_type_id, scope.department_id]
  );
  return resolveEffectiveAssignment(rows, scope);
}

/**
 * Evaluates an employee's location against their effective rule.
 * Returns `rule: null` when no geofence applies (optional feature).
 */
export async function evaluateEmployeePoint(
  employeeId: string,
  latitude: number,
  longitude: number,
  accuracy: number | null | undefined
): Promise<{
  rule: GeofenceRule | null;
  status: GeofenceStatusValue | null;
  distance_meters: number | null;
}> {
  const rule = await resolveGeofenceForEmployee(employeeId);
  if (!rule) {
    return { rule: null, status: null, distance_meters: null };
  }
  const evaluation = classifyGeofencePoint(latitude, longitude, accuracy, rule.geofence);
  return { rule, status: evaluation.status, distance_meters: evaluation.distance_meters };
}

// ---------------------------------------------------------------------------
// ENTER/EXIT transitions (jitter-stabilized)
// ---------------------------------------------------------------------------

export interface GeofenceTransitionResult {
  rule: GeofenceRule | null;
  status: GeofenceStatusValue | null;
  transitioned: boolean;
  event_type: 'entered' | 'exited' | null;
}

/**
 * Evaluates a newly stored location point against the employee's geofence and
 * applies jitter-stabilized transitions: a state change only fires after two
 * consecutive points agree on the new state. `unknown` fixes never change the
 * state and never fire events.
 *
 * Called by field tracking right after a point is persisted.
 */
export async function applyGeofenceTransition(input: {
  session_id: string;
  employee_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null | undefined;
  captured_at: string;
}): Promise<GeofenceTransitionResult> {
  const rule = await resolveGeofenceForEmployee(input.employee_id);
  if (!rule) {
    return { rule: null, status: null, transitioned: false, event_type: null };
  }

  const sessionRes = await query<{
    id: string;
    geofence_id: string | null;
    current_geofence_status: GeofenceStatusValue | null;
  }>(
    `SELECT id, geofence_id, current_geofence_status
       FROM field_tracking_sessions WHERE id = $1`,
    [input.session_id]
  );
  const session = sessionRes.rows[0];
  if (!session) {
    return { rule, status: null, transitioned: false, event_type: null };
  }

  const evaluation = classifyGeofencePoint(
    input.latitude,
    input.longitude,
    input.accuracy,
    rule.geofence
  );

  if (evaluation.status === 'unknown') {
    // Too imprecise to classify: keep the previous state, fire nothing.
    return {
      rule,
      status: session.current_geofence_status,
      transitioned: false,
      event_type: null,
    };
  }

  const current = session.current_geofence_status;

  // First authoritative point for this session: adopt the state directly.
  if (current === null || current === 'unknown') {
    await setSessionGeofenceState(session.id, rule.geofence.id, evaluation.status, input.captured_at);
    const eventType =
      evaluation.status === 'outside' && rule.assignment.monitor_exit ? 'exited' : null;
    if (eventType) {
      await insertGeofenceEvent({
        employee_id: input.employee_id,
        tracking_session_id: input.session_id,
        geofence_id: rule.geofence.id,
        event_type: eventType,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy ?? null,
        occurred_at: input.captured_at,
      });
    }
    return { rule, status: evaluation.status, transitioned: eventType !== null, event_type: eventType };
  }

  if (evaluation.status === current) {
    return { rule, status: current, transitioned: false, event_type: null };
  }

  // Candidate transition — require the previous point to agree (2 consecutive).
  const prevRes = await query<{ latitude: number; longitude: number; accuracy: number | null }>(
    `SELECT latitude, longitude, accuracy
       FROM field_location_points
      WHERE session_id = $1 AND captured_at < $2::timestamptz
      ORDER BY captured_at DESC LIMIT 1`,
    [input.session_id, input.captured_at]
  );
  const prev = prevRes.rows[0] ?? null;
  if (!prev) {
    return { rule, status: current, transitioned: false, event_type: null };
  }
  const prevEvaluation = classifyGeofencePoint(
    prev.latitude,
    prev.longitude,
    prev.accuracy,
    rule.geofence
  );
  if (prevEvaluation.status !== evaluation.status) {
    // One-off bounce: ignore.
    return { rule, status: current, transitioned: false, event_type: null };
  }

  await setSessionGeofenceState(session.id, rule.geofence.id, evaluation.status, input.captured_at);
  const eventType = evaluation.status === 'outside' ? 'exited' : 'entered';
  const shouldRecord = eventType === 'entered' || rule.assignment.monitor_exit;
  if (shouldRecord) {
    await insertGeofenceEvent({
      employee_id: input.employee_id,
      tracking_session_id: input.session_id,
      geofence_id: rule.geofence.id,
      event_type: eventType,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy ?? null,
      occurred_at: input.captured_at,
    });
  }
  return { rule, status: evaluation.status, transitioned: true, event_type: eventType };
}

async function setSessionGeofenceState(
  sessionId: string,
  geofenceId: string,
  status: GeofenceStatusValue,
  occurredAt: string
): Promise<void> {
  await query(
    `UPDATE field_tracking_sessions
        SET geofence_id = $2, current_geofence_status = $3,
            last_geofence_transition_at = $4::timestamptz, updated_at = now()
      WHERE id = $1`,
    [sessionId, geofenceId, status, occurredAt]
  );
}

async function insertGeofenceEvent(input: {
  employee_id: string;
  tracking_session_id: string;
  geofence_id: string;
  event_type: 'entered' | 'exited';
  latitude: number;
  longitude: number;
  accuracy: number | null;
  occurred_at: string;
}): Promise<void> {
  await query(
    `INSERT INTO geofence_events
       (employee_id, tracking_session_id, geofence_id, event_type, latitude, longitude, accuracy, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
    [
      input.employee_id,
      input.tracking_session_id,
      input.geofence_id,
      input.event_type,
      input.latitude,
      input.longitude,
      input.accuracy,
      input.occurred_at,
    ]
  );
}

// ---------------------------------------------------------------------------
// Geofence state for the live map / status
// ---------------------------------------------------------------------------

/**
 * Effective geofence + current state for a set of employees (bulk resolution,
 * used by the admin live map).
 */
export async function geofenceStateForEmployees(
  employeeIds: string[]
): Promise<Record<string, { rule: GeofenceRule; status: GeofenceStatusValue | null } | null>> {
  const result: Record<string, { rule: GeofenceRule; status: GeofenceStatusValue | null } | null> =
    {};
  if (employeeIds.length === 0) {
    return result;
  }
  const scopeRes = await query<EmployeeScope>(
    `SELECT id AS employee_id, department_id, employee_type_id, setup_rule_id
       FROM employees WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [employeeIds]
  );
  const scopes = scopeRes.rows;
  const assignmentRes = await query<GeofenceAssignment>(
    `SELECT a.* FROM geofence_assignments a
      JOIN geofences g ON g.id = a.geofence_id AND g.status = 'active' AND g.deleted_at IS NULL
     WHERE a.employee_id = ANY($1::uuid[])
        OR a.department_id = ANY($1::uuid[])
        OR a.employee_type_id = ANY($1::uuid[])
        OR a.setup_rule_id = ANY($1::uuid[])`,
    [employeeIds]
  );
  const geofenceIds = [...new Set(assignmentRes.rows.map((a) => a.geofence_id))];
  const fenceById = new Map<string, Geofence>();
  if (geofenceIds.length > 0) {
    const fenceRes = await query<Geofence>(
      `SELECT * FROM geofences WHERE id = ANY($1::uuid[])`,
      [geofenceIds]
    );
    for (const fence of fenceRes.rows) {
      fenceById.set(fence.id, fence);
    }
  }
  const stateRes = await query<{ session_id: string; employee_id: string; current_geofence_status: GeofenceStatusValue | null }>(
    `SELECT id AS session_id, employee_id, current_geofence_status
       FROM field_tracking_sessions
      WHERE status = 'active' AND employee_id = ANY($1::uuid[])`,
    [employeeIds]
  );
  const stateByEmployee = new Map(stateRes.rows.map((r) => [r.employee_id, r]));

  for (const scope of scopes) {
    const assignment = resolveEffectiveAssignment(assignmentRes.rows, scope);
    if (!assignment) {
      result[scope.employee_id] = null;
      continue;
    }
    const fence = fenceById.get(assignment.geofence_id);
    if (!fence) {
      result[scope.employee_id] = null;
      continue;
    }
    const state = stateByEmployee.get(scope.employee_id);
    result[scope.employee_id] = {
      rule: { geofence: fence, assignment },
      status: state?.current_geofence_status ?? null,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Breach history + live summary (admin)
// ---------------------------------------------------------------------------

export interface GeofenceEventListInput {
  employee_id?: string;
  geofence_id?: string;
  event_type?: 'entered' | 'exited';
  date_from?: string;
  date_to?: string;
  page?: number;
  per_page?: number;
}

export async function listGeofenceEvents(
  input: GeofenceEventListInput
): Promise<PaginatedResponse<GeofenceEvent>> {
  const { page, per_page } = parsePagination(input.page, input.per_page);
  const wheres: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (input.employee_id) {
    wheres.push(`ev.employee_id = $${idx++}`);
    params.push(input.employee_id);
  }
  if (input.geofence_id) {
    wheres.push(`ev.geofence_id = $${idx++}`);
    params.push(input.geofence_id);
  }
  if (input.event_type) {
    wheres.push(`ev.event_type = $${idx++}`);
    params.push(input.event_type);
  }
  if (input.date_from) {
    wheres.push(`ev.occurred_at >= $${idx++}::timestamptz`);
    params.push(`${input.date_from}T00:00:00+06:00`);
  }
  if (input.date_to) {
    wheres.push(`ev.occurred_at < $${idx++}::timestamptz`);
    params.push(`${input.date_to}T23:59:59+06:00`);
  }
  const where = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';

  const countRes = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM geofence_events ev ${where}`,
    params
  );
  const total = countRes.rows[0]?.n ?? 0;

  const { rows } = await query<GeofenceEvent>(
    `SELECT ev.id, ev.employee_id, e.employee_code, e.full_name AS employee_name,
            ev.tracking_session_id, ev.geofence_id, g.name AS geofence_name,
            ev.event_type, ev.latitude, ev.longitude, ev.accuracy, ev.occurred_at
       FROM geofence_events ev
       JOIN employees e ON e.id = ev.employee_id
       JOIN geofences g ON g.id = ev.geofence_id
      ${where}
      ORDER BY ev.occurred_at DESC
      LIMIT $${idx++} OFFSET $${idx}`,
    [...params, per_page, (page - 1) * per_page]
  );
  return { items: rows, total, page, per_page, total_pages: totalPages(total, per_page) };
}

export interface GeofenceLiveSummary {
  trackingNow: number;
  inside: number;
  outside: number;
  noGeofence: number;
  flaggedOutside: number;
}

/** Org-wide live geofence breakdown for the admin dashboard / analytics. */
export async function geofenceLiveSummary(): Promise<GeofenceLiveSummary> {
  const sessions = await query<{ employee_id: string; status: GeofenceStatusValue | null }>(
    `SELECT employee_id, current_geofence_status AS status
       FROM field_tracking_sessions WHERE status = 'active'`
  );
  if (sessions.rows.length === 0) {
    return { trackingNow: 0, inside: 0, outside: 0, noGeofence: 0, flaggedOutside: 0 };
  }
  const stateMap = await geofenceStateForEmployees(sessions.rows.map((s) => s.employee_id));
  const summary: GeofenceLiveSummary = {
    trackingNow: sessions.rows.length,
    inside: 0,
    outside: 0,
    noGeofence: 0,
    flaggedOutside: 0,
  };
  for (const session of sessions.rows) {
    const state = stateMap[session.employee_id] ?? null;
    if (!state) {
      summary.noGeofence += 1;
      continue;
    }
    if (session.status === 'inside') {
      summary.inside += 1;
    } else if (session.status === 'outside') {
      summary.outside += 1;
      if (state.rule.assignment.flag_exit) {
        summary.flaggedOutside += 1;
      }
    } else {
      summary.noGeofence += 1;
    }
  }
  return summary;
}
