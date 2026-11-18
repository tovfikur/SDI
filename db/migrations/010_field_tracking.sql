-- Field tracking (self attendance with GPS punches + location tracking).
-- Actual check-in / check-out are attendance_events (sources field_checkin /
-- field_checkout); GPS pings live only in field_location_points so monthly
-- attendance calculations are unaffected by tracking frequency.

CREATE TABLE field_tracking_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         uuid NOT NULL REFERENCES employees(id),
  check_in_event_id   uuid REFERENCES attendance_events(id),
  check_out_event_id  uuid REFERENCES attendance_events(id),
  started_at          timestamptz NOT NULL,
  ended_at            timestamptz,
  start_latitude      double precision NOT NULL,
  start_longitude     double precision NOT NULL,
  end_latitude        double precision,
  end_longitude       double precision,
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','completed')),
  device_id           text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX field_tracking_sessions_employee_id_idx ON field_tracking_sessions(employee_id);
CREATE INDEX field_tracking_sessions_status_idx ON field_tracking_sessions(status);
-- At most one active session per employee.
CREATE UNIQUE INDEX field_tracking_sessions_one_active_idx
  ON field_tracking_sessions(employee_id) WHERE status = 'active';

CREATE TABLE field_location_points (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES field_tracking_sessions(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES employees(id),
  latitude      double precision NOT NULL,
  longitude     double precision NOT NULL,
  accuracy      double precision,
  altitude      double precision,
  speed         double precision,
  heading       double precision,
  captured_at   timestamptz NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  battery_level integer,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX field_location_points_session_id_idx ON field_location_points(session_id);
CREATE INDEX field_location_points_employee_id_idx ON field_location_points(employee_id);
CREATE INDEX field_location_points_captured_at_idx ON field_location_points(captured_at);
