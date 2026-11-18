-- SDI HRM & PM — core schema (Spec Phase 5 ER model + Phase 7 auth + Phase 24 audit)
-- Forward-only. No manual edits.

-- ============================================================================
-- AUTH / SETTINGS
-- ============================================================================

CREATE TABLE roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  description   text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE permissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  description   text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username        text NOT NULL UNIQUE,
  email           text NOT NULL UNIQUE,
  full_name       text NOT NULL DEFAULT '',
  password_hash   text NOT NULL,
  is_super_admin  boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  employee_id     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE user_roles (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id   uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  csrf_token_hash text NOT NULL,
  user_agent      text NOT NULL DEFAULT '',
  ip              inet,
  expires_at      timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- HR MASTERS
-- ============================================================================

CREATE TABLE departments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX departments_name_unique ON departments(lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE sub_departments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id),
  name          text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX sub_departments_name_unique
  ON sub_departments(department_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX sub_departments_department_id_idx ON sub_departments(department_id);

CREATE TABLE employee_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX employee_types_name_unique ON employee_types(lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE positions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX positions_name_unique ON positions(lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE setup_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 text NOT NULL,
  employee_type_id      uuid REFERENCES employee_types(id),
  work_pattern          text NOT NULL DEFAULT 'Fixed',
  daily_working_hour    numeric(5,2) NOT NULL DEFAULT 8,
  office_start_time     time NOT NULL DEFAULT '09:00',
  office_end_time       time NOT NULL DEFAULT '18:00',
  grace_period_minutes  integer NOT NULL DEFAULT 0,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE TABLE holidays (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  holiday_date date NOT NULL,
  type         text NOT NULL DEFAULT 'Public',
  description  text NOT NULL DEFAULT '',
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE UNIQUE INDEX holidays_date_unique ON holidays(holiday_date) WHERE is_active AND deleted_at IS NULL;

-- ============================================================================
-- EMPLOYEE (master + 9 wizard sub-entities + performance + transfer)
-- ============================================================================

CREATE TABLE employees (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code      text NOT NULL UNIQUE,
  full_name          text NOT NULL,
  email              text,
  mobile             text,
  date_of_birth      date,
  gender             text,
  marital_status     text,
  blood_group        text,
  contract_type      text,
  joining_date       date,
  contract_end_date  date,
  department_id      uuid REFERENCES departments(id),
  sub_department_id  uuid REFERENCES sub_departments(id),
  position_id        uuid REFERENCES positions(id),
  employee_type_id   uuid REFERENCES employee_types(id),
  setup_rule_id      uuid REFERENCES setup_rules(id),
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','inactive','deleted')),
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CHECK (contract_end_date IS NULL OR joining_date IS NULL OR contract_end_date >= joining_date)
);
CREATE INDEX employees_department_id_idx ON employees(department_id);
CREATE INDEX employees_sub_department_id_idx ON employees(sub_department_id);
CREATE INDEX employees_employee_type_id_idx ON employees(employee_type_id);
CREATE INDEX employees_status_idx ON employees(status);
CREATE INDEX employees_department_id_status_idx ON employees(department_id, status);

CREATE TABLE employee_banks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  bank_name     text,
  account_name  text,
  account_number text,
  branch        text,
  iban          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_banks_employee_id_idx ON employee_banks(employee_id);

CREATE TABLE employee_addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type          text NOT NULL DEFAULT 'present',
  address_line1 text,
  address_line2 text,
  city          text,
  state         text,
  zip           text,
  country       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_addresses_employee_id_idx ON employee_addresses(employee_id);

CREATE TABLE employee_emergency_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name         text,
  relationship text,
  phone        text,
  email        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_emergency_contacts_employee_id_idx ON employee_emergency_contacts(employee_id);

CREATE TABLE employee_academic (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  degree        text,
  institution   text,
  field_of_study text,
  start_year    integer,
  end_year      integer,
  grade         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_academic_employee_id_idx ON employee_academic(employee_id);

CREATE TABLE employee_extra_curriculars (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  activity    text,
  description text,
  year        integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_extra_curriculars_employee_id_idx ON employee_extra_curriculars(employee_id);

CREATE TABLE employee_experiences (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company       text,
  designation   text,
  start_date    date,
  end_date      date,
  responsibilities text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_experiences_employee_id_idx ON employee_experiences(employee_id);

CREATE TABLE employee_family_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name        text,
  relationship text,
  occupation  text,
  date_of_birth date,
  phone       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_family_members_employee_id_idx ON employee_family_members(employee_id);

CREATE TABLE employee_performances (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  position_title   text,
  position_date    date,
  total_score      numeric(6,2) NOT NULL DEFAULT 0,
  evaluator_name   text,
  evaluator_user_id uuid REFERENCES users(id),
  performance_date date,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_performances_employee_id_idx ON employee_performances(employee_id);

CREATE TABLE employee_performance_scores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_id uuid NOT NULL REFERENCES employee_performances(id) ON DELETE CASCADE,
  criterion      text NOT NULL,
  score          numeric(6,2) NOT NULL DEFAULT 0,
  max_score      numeric(6,2) NOT NULL DEFAULT 5,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_performance_scores_performance_id_idx ON employee_performance_scores(performance_id);

CREATE TABLE transfers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  transfer_type text NOT NULL CHECK (transfer_type IN ('in','out')),
  from_entity   text,
  to_entity     text,
  transfer_date date NOT NULL DEFAULT CURRENT_DATE,
  reason        text,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','cancelled')),
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transfers_employee_id_idx ON transfers(employee_id);

-- ============================================================================
-- ATTENDANCE
-- ============================================================================

CREATE TABLE attendance_device_mappings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  device_employee_id text NOT NULL UNIQUE,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attendance_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid NOT NULL REFERENCES employees(id),
  device_employee_id text,
  event_time        timestamptz NOT NULL,
  source            text NOT NULL DEFAULT 'manual',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_events_employee_id_idx ON attendance_events(employee_id);
CREATE INDEX attendance_events_event_time_idx ON attendance_events(event_time);
-- Dedupe key (Spec Phase 5: dedupe on (employee_id, event_time, source))
CREATE UNIQUE INDEX attendance_events_dedupe_idx
  ON attendance_events(employee_id, event_time, source);

CREATE TABLE attendance_days (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id          uuid NOT NULL REFERENCES employees(id),
  work_date            date NOT NULL,
  first_in             time,
  last_out             time,
  total_work_minutes   integer,
  status               text NOT NULL DEFAULT 'NoData',
  late_minutes         integer NOT NULL DEFAULT 0,
  early_closing        boolean NOT NULL DEFAULT false,
  holiday_id           uuid REFERENCES holidays(id),
  setup_rule_id        uuid REFERENCES setup_rules(id),
  calculated_at        timestamptz,
  UNIQUE (employee_id, work_date)
);
CREATE INDEX attendance_days_employee_id_work_date_idx ON attendance_days(employee_id, work_date);
CREATE INDEX attendance_days_work_date_idx ON attendance_days(work_date);
CREATE INDEX attendance_days_status_idx ON attendance_days(status);

CREATE TABLE attendance_pending (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employees(id),
  work_date    date NOT NULL,
  reason       text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  processed_by uuid REFERENCES users(id),
  processed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attendance_missing (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employees(id),
  work_date    date NOT NULL,
  reason       text NOT NULL DEFAULT '',
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

-- ============================================================================
-- LEAVE
-- ============================================================================

CREATE TABLE leave_types (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  code                   text NOT NULL UNIQUE,
  annual_entitlement     numeric(6,2) NOT NULL DEFAULT 0,
  is_paid                boolean NOT NULL DEFAULT true,
  gender_eligibility     text NOT NULL DEFAULT 'both'
                         CHECK (gender_eligibility IN ('both','male','female')),
  carry_forward          boolean NOT NULL DEFAULT false,
  max_consecutive_days   integer,
  requires_document      boolean NOT NULL DEFAULT false,
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);

CREATE TABLE leave_balances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employees(id),
  leave_type_id uuid NOT NULL REFERENCES leave_types(id),
  year          integer NOT NULL,
  total         numeric(6,2) NOT NULL DEFAULT 0,
  taken         numeric(6,2) NOT NULL DEFAULT 0,
  due           numeric(6,2) NOT NULL DEFAULT 0,
  CHECK (total >= 0 AND taken >= 0 AND due >= 0),
  UNIQUE (employee_id, leave_type_id, year)
);
CREATE INDEX leave_balances_employee_id_idx ON leave_balances(employee_id);
CREATE INDEX leave_balances_leave_type_id_idx ON leave_balances(leave_type_id);

CREATE TABLE leave_applications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employees(id),
  leave_type_id  uuid NOT NULL REFERENCES leave_types(id),
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  requested_days numeric(6,2) NOT NULL,
  approved_days  numeric(6,2) NOT NULL DEFAULT 0,
  reason         text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','pending','approved','rejected','withdrawn','deleted')),
  approved_by    uuid REFERENCES users(id),
  approved_at    timestamptz,
  manager_comment text,
  hard_copy      boolean NOT NULL DEFAULT false,
  version        integer NOT NULL DEFAULT 1,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CHECK (end_date >= start_date)
);
CREATE INDEX leave_applications_employee_id_idx ON leave_applications(employee_id);
CREATE INDEX leave_applications_leave_type_id_idx ON leave_applications(leave_type_id);
CREATE INDEX leave_applications_status_idx ON leave_applications(status);

CREATE TABLE short_leaves (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employees(id),
  leave_type_id uuid REFERENCES leave_types(id),
  work_date     date NOT NULL,
  minutes       integer NOT NULL CHECK (minutes > 0 AND minutes <= 480),
  reason        text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','cancelled')),
  approved_by   uuid REFERENCES users(id),
  approved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX short_leaves_employee_id_idx ON short_leaves(employee_id);

-- ============================================================================
-- TRAINING
-- ============================================================================

CREATE TABLE trainings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  trainer     text,
  schedule    timestamptz,
  venue       text,
  status      text NOT NULL DEFAULT 'planned'
              CHECK (status IN ('planned','scheduled','completed','cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE training_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_id    uuid NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES employees(id),
  assigned_date  date NOT NULL DEFAULT CURRENT_DATE,
  completion_date date,
  status         text NOT NULL DEFAULT 'assigned'
                 CHECK (status IN ('assigned','in_progress','completed','cancelled')),
  score          numeric(6,2),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (training_id, employee_id)
);
CREATE INDEX training_assignments_employee_id_idx ON training_assignments(employee_id);

CREATE TABLE training_certificates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employees(id),
  title          text NOT NULL,
  provider       text,
  source         text NOT NULL DEFAULT 'internal' CHECK (source IN ('internal','external')),
  issue_date     date,
  expiry_date    date,
  attachment_file_id uuid,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX training_certificates_employee_id_idx ON training_certificates(employee_id);

-- ============================================================================
-- PROJECT MANAGEMENT
-- ============================================================================

CREATE TABLE clients (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  contact_person text,
  email          text,
  phone          text,
  address        text,
  notes          text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE UNIQUE INDEX clients_name_unique ON clients(lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE projects (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  client_id          uuid NOT NULL REFERENCES clients(id),
  project_lead_id    uuid REFERENCES employees(id),
  approximate_tasks  integer NOT NULL DEFAULT 0,
  summary            text NOT NULL DEFAULT '',
  start_date         date,
  duration_days      integer NOT NULL DEFAULT 0,
  ending_date        date,
  status             text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','in_progress','on_hold','completed','cancelled')),
  progress           numeric(5,2) NOT NULL DEFAULT 0,
  version            integer NOT NULL DEFAULT 1,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CHECK (ending_date IS NULL OR start_date IS NULL OR ending_date >= start_date)
);
CREATE INDEX projects_client_id_idx ON projects(client_id);
CREATE INDEX projects_project_lead_id_idx ON projects(project_lead_id);
CREATE INDEX projects_status_idx ON projects(status);

CREATE TABLE project_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  role        text NOT NULL DEFAULT 'member',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, employee_id)
);
CREATE INDEX project_members_employee_id_idx ON project_members(employee_id);

CREATE TABLE tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title             text NOT NULL,
  description       text NOT NULL DEFAULT '',
  assignee_id       uuid REFERENCES employees(id),
  priority          text NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low','medium','high','urgent')),
  planned_start     date,
  planned_end       date,
  actual_completion date,
  status            text NOT NULL DEFAULT 'todo'
                    CHECK (status IN ('todo','in_progress','review','done','blocked','cancelled')),
  progress_percent  numeric(5,2) NOT NULL DEFAULT 0,
  estimated_hours   numeric(8,2),
  version           integer NOT NULL DEFAULT 1,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CHECK (progress_percent BETWEEN 0 AND 100)
);
CREATE INDEX tasks_project_id_idx ON tasks(project_id);
CREATE INDEX tasks_assignee_id_idx ON tasks(assignee_id);
CREATE INDEX tasks_status_idx ON tasks(status);

CREATE TABLE daily_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employees(id),
  project_id     uuid REFERENCES projects(id),
  task_id        uuid REFERENCES tasks(id),
  work_date      date NOT NULL DEFAULT CURRENT_DATE,
  work_description text NOT NULL DEFAULT '',
  hours          numeric(5,2) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'submitted'
                 CHECK (status IN ('draft','submitted','approved','rejected')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX daily_tasks_employee_id_idx ON daily_tasks(employee_id);
CREATE INDEX daily_tasks_project_id_idx ON daily_tasks(project_id);

CREATE TABLE meetings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id),
  place       text NOT NULL,
  held_at     timestamptz NOT NULL,
  purpose     text NOT NULL,
  outcomes    text NOT NULL DEFAULT '',
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX meetings_project_id_idx ON meetings(project_id);

CREATE TABLE meeting_attendees (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, employee_id)
);

-- ============================================================================
-- FILES
-- ============================================================================

CREATE TABLE files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module           text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        uuid,
  storage_key      text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  size_bytes       bigint NOT NULL DEFAULT 0,
  mime_type        text NOT NULL DEFAULT '',
  scan_status      text NOT NULL DEFAULT 'pending'
                   CHECK (scan_status IN ('pending','clean','quarantined','failed')),
  uploaded_by      uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX files_entity_idx ON files(entity_type, entity_id);

CREATE TABLE upload_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL UNIQUE,
  entity_type text NOT NULL,
  entity_id   uuid,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','expired')),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- OTHER HR (Recommendation field sets — Spec §21 / MI-04)
-- ============================================================================

CREATE TABLE loans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid NOT NULL REFERENCES employees(id),
  amount            numeric(12,2) NOT NULL DEFAULT 0,
  interest_rate     numeric(5,2) NOT NULL DEFAULT 0,
  monthly_deduction numeric(12,2) NOT NULL DEFAULT 0,
  loan_date         date,
  start_month       text,
  end_month         text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','cancelled')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX loans_employee_id_idx ON loans(employee_id);

CREATE TABLE resignations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employees(id),
  notice_date    date,
  effective_date date,
  reason         text,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resignations_employee_id_idx ON resignations(employee_id);

CREATE TABLE notices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  body         text NOT NULL DEFAULT '',
  category     text NOT NULL DEFAULT 'general',
  published_at timestamptz,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TABLE hr_policies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  body          text NOT NULL DEFAULT '',
  category      text NOT NULL DEFAULT 'general',
  effective_date date,
  attachment_file_id uuid REFERENCES files(id),
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE id_cards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employees(id),
  card_number  text NOT NULL UNIQUE,
  issued_date  date,
  expiry_date  date,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX id_cards_employee_id_idx ON id_cards(employee_id);

CREATE TABLE bulk_upload_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module             text NOT NULL,
  original_filename  text NOT NULL,
  storage_key        text,
  total_rows         integer NOT NULL DEFAULT 0,
  success_count      integer NOT NULL DEFAULT 0,
  error_count        integer NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','completed','failed')),
  error_report_key   text,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);

-- ============================================================================
-- AUDIT (Phase 24; soft-delete + meta-audit per ADR-004)
-- ============================================================================

CREATE TABLE activity_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  log_name     text NOT NULL,
  description  text NOT NULL DEFAULT '',
  entity_type  text,
  entity_id    uuid,
  before_value jsonb,
  after_value  jsonb,
  request_id   text,
  is_hidden    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_logs_actor_user_id_idx ON activity_logs(actor_user_id);
CREATE INDEX activity_logs_entity_idx ON activity_logs(entity_type, entity_id);
CREATE INDEX activity_logs_created_at_idx ON activity_logs(created_at DESC);

CREATE TABLE meta_audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  action       text NOT NULL,
  target_log_id uuid REFERENCES activity_logs(id) ON DELETE SET NULL,
  detail       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- NOTIFICATIONS (Recommendation, feature-flagged — Spec Phase 14 / MI-03)
-- ============================================================================

CREATE TABLE notification_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type          text NOT NULL,
  recipient_user_id   uuid REFERENCES users(id),
  template            text NOT NULL,
  context             jsonb,
  channel             text NOT NULL DEFAULT 'email',
  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','sent','failed','delivered','bounced')),
  attempts            integer NOT NULL DEFAULT 0,
  provider_message_id text,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);
CREATE INDEX notification_deliveries_status_idx ON notification_deliveries(status);

-- ============================================================================
-- JOBS (Phase 9 DB-backed queue)
-- ============================================================================

CREATE TABLE jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL,
  status       text NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','running','completed','failed','dlq')),
  payload      jsonb,
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  last_error   text,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  completed_at timestamptz
);
CREATE INDEX jobs_status_available_at_idx ON jobs(status, available_at);

CREATE TABLE job_runs (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id    uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  run_at    timestamptz NOT NULL DEFAULT now(),
  status    text NOT NULL,
  detail    jsonb
);
CREATE INDEX job_runs_job_id_idx ON job_runs(job_id);
