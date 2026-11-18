-- 002_feature_gaps.sql
-- Adds missing tables and columns from FEATURES_SPECIFICATION.md

-- ============================================================
-- 6.1 Application Master Settings
-- ============================================================
CREATE TABLE app_settings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_title          text NOT NULL DEFAULT 'SDI',
  support_email          text NOT NULL DEFAULT 'support@sdi.local',
  support_phone          text NOT NULL DEFAULT '',
  timezone               text NOT NULL DEFAULT 'Asia/Dhaka',
  address                text NOT NULL DEFAULT '',
  footer_text            text NOT NULL DEFAULT '',
  currency               text NOT NULL DEFAULT 'BDT',
  country                text NOT NULL DEFAULT 'Bangladesh',
  default_checkin_range  integer NOT NULL DEFAULT 100,  -- meters
  header_logo_url        text,
  sidebar_logo_url       text,
  collapsed_logo_url     text,
  login_bg_url           text,
  favicon_url            text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (company_title) VALUES ('SDI');

-- ============================================================
-- 2.1 Geo-Location on Attendance Events
-- ============================================================
ALTER TABLE attendance_events ADD COLUMN latitude  double precision;
ALTER TABLE attendance_events ADD COLUMN longitude double precision;
ALTER TABLE attendance_events ADD COLUMN device_metadata jsonb;

-- ============================================================
-- 2.1 Geo-Location on Attendance Pending (for geo queue)
-- ============================================================
ALTER TABLE attendance_pending ADD COLUMN event_type    text NOT NULL DEFAULT 'manual'
  CHECK (event_type IN ('manual','geo_checkin','field_work','client_visit','other'));
ALTER TABLE attendance_pending ADD COLUMN latitude      double precision;
ALTER TABLE attendance_pending ADD COLUMN longitude     double precision;
ALTER TABLE attendance_pending ADD COLUMN reason_type   text;

-- ============================================================
-- 5.2 Geo-Fenced Project Location
-- ============================================================
ALTER TABLE projects ADD COLUMN latitude         double precision;
ALTER TABLE projects ADD COLUMN longitude        double precision;
ALTER TABLE projects ADD COLUMN check_in_radius  integer NOT NULL DEFAULT 100;  -- meters

-- ============================================================
-- Meeting Attachments (referenced by domain-projects but not in schema)
-- ============================================================
CREATE TABLE meeting_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id   uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  file_name    text NOT NULL,
  file_size    integer NOT NULL DEFAULT 0,
  mime_type    text NOT NULL DEFAULT 'application/octet-stream',
  storage_key  text NOT NULL,
  uploaded_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meeting_attachments_meeting_id_idx ON meeting_attachments(meeting_id);

-- ============================================================
-- 5.3 Sprint Management
-- ============================================================
CREATE TABLE sprints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  goal        text NOT NULL DEFAULT '',
  start_date  date,
  end_date    date,
  status      text NOT NULL DEFAULT 'planned'
              CHECK (status IN ('planned','active','completed')),
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX sprints_project_id_idx ON sprints(project_id);

ALTER TABLE tasks ADD COLUMN sprint_id uuid REFERENCES sprints(id);

-- ============================================================
-- 1.4 ID Cards (table already exists, just verify structure)
-- ============================================================
-- id_cards table already exists in 001_core_schema.sql

-- ============================================================
-- 1.5 Resignations (table already exists)
-- ============================================================
-- resignations table already exists

-- ============================================================
-- 1.5 Notices (table already exists)
-- ============================================================
-- notices table already exists

-- ============================================================
-- 1.5 Loans (table already exists)
-- ============================================================
-- loans table already exists

-- ============================================================
-- 1.5 HR Policies (table already exists)
-- ============================================================
-- hr_policies table already exists
