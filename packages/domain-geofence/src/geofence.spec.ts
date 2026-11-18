import { describe, expect, it } from 'vitest';
import {
  classifyGeofencePoint,
  resolveEffectiveAssignment,
  haversineDistanceMeters,
} from './geofence';
import type { GeofenceAssignment } from './geofence';

const CIRCLE = { center_latitude: 23.81, center_longitude: 90.41, radius_meters: 500 };

function assignment(overrides: Partial<GeofenceAssignment> = {}): GeofenceAssignment {
  return {
    id: 'a1',
    geofence_id: 'g1',
    employee_id: null,
    department_id: null,
    employee_type_id: null,
    setup_rule_id: null,
    enabled: true,
    restrict_check_in: true,
    restrict_check_out: false,
    monitor_exit: true,
    flag_exit: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('haversineDistanceMeters', () => {
  it('zero distance at the same point', () => {
    expect(haversineDistanceMeters(23.81, 90.41, 23.81, 90.41)).toBe(0);
  });

  it('is symmetric', () => {
    const d = haversineDistanceMeters(23.81, 90.41, 23.81, 90.42);
    expect(d).toBeCloseTo(haversineDistanceMeters(23.81, 90.42, 23.81, 90.41), 6);
  });
});

describe('classifyGeofencePoint', () => {
  it('center point is inside', () => {
    const r = classifyGeofencePoint(23.81, 90.41, 5, CIRCLE);
    expect(r.status).toBe('inside');
  });

  it('far point is outside', () => {
    const r = classifyGeofencePoint(23.9, 90.6, 5, CIRCLE);
    expect(r.status).toBe('outside');
    expect(r.distance_meters).toBeGreaterThan(500);
  });

  it('point just inside the radius is inside', () => {
    // 0.0048 deg lng at this latitude ≈ 489 m from center (radius 500 m).
    const r = classifyGeofencePoint(23.81, 90.4148, 10, CIRCLE);
    expect(r.status).toBe('inside');
  });

  it('point just outside the radius is outside', () => {
    // 0.0051 deg lng ≈ 519 m from center (radius 500 m, tolerance 5 m).
    const r = classifyGeofencePoint(23.81, 90.4151, 10, CIRCLE);
    expect(r.status).toBe('outside');
  });

  it('uncertain band: accuracy range overlaps the boundary yields unknown', () => {
    // ≈509 m from center with ±20 m accuracy → [489, 529] straddles the 500 m radius.
    const r = classifyGeofencePoint(23.81, 90.415, 20, CIRCLE);
    expect(r.status).toBe('unknown');
  });

  it('definitely outside even with poor accuracy when far beyond radius', () => {
    // ≈23 km from center; even ±1 km of GPS error cannot reach the 500 m radius.
    const r = classifyGeofencePoint(23.9, 90.6, 1000, CIRCLE);
    expect(r.status).toBe('outside');
    expect(r.distance_meters).toBeGreaterThan(0);
  });

  it('null accuracy is classified by raw distance', () => {
    const r = classifyGeofencePoint(23.9, 90.6, null, CIRCLE);
    expect(r.status).toBe('outside');
  });
});

describe('resolveEffectiveAssignment', () => {
  const scope = {
    employee_id: 'emp1',
    department_id: 'dept1',
    employee_type_id: 'type1',
    setup_rule_id: 'rule1',
  };

  it('no assignments -> null (feature optional)', () => {
    expect(resolveEffectiveAssignment([], scope)).toBeNull();
  });

  it('employee-specific assignment wins over department', () => {
    const a = resolveEffectiveAssignment(
      [
        assignment({ id: 'dept', department_id: 'dept1' }),
        assignment({ id: 'emp', employee_id: 'emp1' }),
      ],
      scope
    );
    expect(a?.id).toBe('emp');
  });

  it('work schedule (setup rule) beats employee type and department', () => {
    const a = resolveEffectiveAssignment(
      [
        assignment({ id: 'dept', department_id: 'dept1' }),
        assignment({ id: 'type', employee_type_id: 'type1' }),
        assignment({ id: 'rule', setup_rule_id: 'rule1' }),
      ],
      scope
    );
    expect(a?.id).toBe('rule');
  });

  it('employee type beats department', () => {
    const a = resolveEffectiveAssignment(
      [
        assignment({ id: 'dept', department_id: 'dept1' }),
        assignment({ id: 'type', employee_type_id: 'type1' }),
      ],
      scope
    );
    expect(a?.id).toBe('type');
  });

  it('department fallback when employee has no other scope', () => {
    const a = resolveEffectiveAssignment(
      [assignment({ id: 'dept', department_id: 'dept1' })],
      scope
    );
    expect(a?.id).toBe('dept');
  });

  it('disabled higher-priority assignment opts the employee out', () => {
    const a = resolveEffectiveAssignment(
      [
        assignment({ id: 'dept', department_id: 'dept1' }),
        assignment({ id: 'emp', employee_id: 'emp1', enabled: false }),
      ],
      scope
    );
    expect(a).toBeNull();
  });

  it('assignments for unrelated scopes do not match', () => {
    const a = resolveEffectiveAssignment(
      [assignment({ id: 'other', department_id: 'dept99' })],
      scope
    );
    expect(a).toBeNull();
  });
});
