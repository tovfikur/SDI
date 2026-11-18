-- Dynamic optional geofencing for attendance + field force tracking.
-- Geofences are admin-configurable circles; assignments attach a geofence to a
-- scope (employee / department / employee type / work schedule) with
-- independent check-in / check-out / exit-monitoring flags. Geofencing is
-- OPTIONAL: when no enabled rule matches an employee, tracking behaves exactly
-- as before (no restrictions, no events).

CREATE TABLE geofences (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  description      text NOT NULL DEFAULT '',
  type             text NOT NULL DEFAULT 'circle' CHECK (type IN ('circle')),
  center_latitude  double precision NOT NULL
                   CHECK (center_latitude BETWEEN -90 AND 90),
  center_longitude double precision NOT NULL
                   CHECK (center_longitude BETWEEN -180 AND 180),
  radius_meters    double precision NOT NULL CHECK (radius_meters > 0),
  status           text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','inactive')),
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX geofences_status_idx ON geofences(status);

CREATE TABLE geofence_assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  geofence_id        uuid NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  employee_id        uuid REFERENCES employees(id) ON DELETE CASCADE,
  department_id      uuid REFERENCES departments(id) ON DELETE CASCADE,
  employee_type_id   uuid REFERENCES employee_types(id) ON DELETE CASCADE,
  setup_rule_id      uuid REFERENCES setup_rules(id) ON DELETE CASCADE,
  enabled            boolean NOT NULL DEFAULT true,
  restrict_check_in  boolean NOT NULL DEFAULT true,
  restrict_check_out boolean NOT NULL DEFAULT false,
  monitor_exit       boolean NOT NULL DEFAULT true,
  flag_exit          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Exactly one scope per assignment (org-wide rules are not scoped).
  CHECK (num_nonnulls(employee_id, department_id, employee_type_id, setup_rule_id) = 1)
);
CREATE INDEX geofence_assignments_geofence_id_idx ON geofence_assignments(geofence_id);
CREATE INDEX geofence_assignments_employee_id_idx ON geofence_assignments(employee_id);
CREATE INDEX geofence_assignments_department_id_idx ON geofence_assignments(department_id);
CREATE INDEX geofence_assignments_employee_type_id_idx ON geofence_assignments(employee_type_id);
CREATE INDEX geofence_assignments_setup_rule_id_idx ON geofence_assignments(setup_rule_id);

CREATE TABLE geofence_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id          uuid NOT NULL REFERENCES employees(id),
  tracking_session_id  uuid REFERENCES field_tracking_sessions(id) ON DELETE SET NULL,
  geofence_id          uuid NOT NULL REFERENCES geofences(id),
  event_type           text NOT NULL CHECK (event_type IN ('entered','exited')),
  latitude             double precision NOT NULL,
  longitude            double precision NOT NULL,
  accuracy             double precision,
  occurred_at          timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX geofence_events_employee_id_idx ON geofence_events(employee_id);
CREATE INDEX geofence_events_geofence_id_idx ON geofence_events(geofence_id);
CREATE INDEX geofence_events_occurred_at_idx ON geofence_events(occurred_at);

-- Live geofence state for each active tracking session (drives the admin map,
-- the employee's own status screen and the inside/outside analytics).
ALTER TABLE field_tracking_sessions
  ADD COLUMN geofence_id uuid REFERENCES geofences(id);
ALTER TABLE field_tracking_sessions
  ADD COLUMN current_geofence_status text
  CHECK (current_geofence_status IN ('inside','outside','unknown'));
ALTER TABLE field_tracking_sessions
  ADD COLUMN last_geofence_transition_at timestamptz;