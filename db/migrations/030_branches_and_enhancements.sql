-- 030_branches_and_enhancements.sql
-- 1. Branches master table
CREATE TABLE IF NOT EXISTS branches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  code           text,
  address        text DEFAULT '',
  latitude       double precision CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90)),
  longitude      double precision CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180)),
  radius_meters  double precision DEFAULT 100 CHECK (radius_meters IS NULL OR radius_meters > 0),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS branches_name_unique ON branches(lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS branches_is_active_idx ON branches(is_active);

-- 2. Link employees to branch
ALTER TABLE employees ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS employees_branch_id_idx ON employees(branch_id);

-- 3. Enhance attendance_days for branch & late out tracking
ALTER TABLE attendance_days ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS attendance_days_branch_id_idx ON attendance_days(branch_id);
ALTER TABLE attendance_days ADD COLUMN IF NOT EXISTS late_out_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE attendance_days ADD COLUMN IF NOT EXISTS early_out_minutes integer NOT NULL DEFAULT 0;

-- 4. Projects access control: open_for_all flag
ALTER TABLE projects ADD COLUMN IF NOT EXISTS open_for_all boolean NOT NULL DEFAULT true;

-- 5. Multi-assignee support for tasks
CREATE TABLE IF NOT EXISTS task_assignees (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, employee_id)
);
CREATE INDEX IF NOT EXISTS task_assignees_task_id_idx ON task_assignees(task_id);
CREATE INDEX IF NOT EXISTS task_assignees_employee_id_idx ON task_assignees(employee_id);

-- Backfill task_assignees from existing tasks with assignee_id
INSERT INTO task_assignees (task_id, employee_id)
SELECT id, assignee_id FROM tasks WHERE assignee_id IS NOT NULL
ON CONFLICT (task_id, employee_id) DO NOTHING;

-- Seed default initial branches if table is empty
INSERT INTO branches (name, code, address, latitude, longitude, radius_meters)
SELECT 'Head Office (Dhaka)', 'HO-DHK', 'Dhaka, Bangladesh', 23.8103, 90.4125, 200
WHERE NOT EXISTS (SELECT 1 FROM branches);

INSERT INTO branches (name, code, address, latitude, longitude, radius_meters)
SELECT 'Chattogram Branch', 'BR-CTG', 'Chattogram, Bangladesh', 22.3569, 91.7832, 200
WHERE NOT EXISTS (SELECT 1 FROM branches WHERE code = 'BR-CTG');

INSERT INTO branches (name, code, address, latitude, longitude, radius_meters)
SELECT 'Cox''s Bazar Field Office', 'FO-CXB', 'Cox''s Bazar, Bangladesh', 21.4272, 92.0058, 300
WHERE NOT EXISTS (SELECT 1 FROM branches WHERE code = 'FO-CXB');

-- Associate any existing employees with Head Office initially if branch_id is null
UPDATE employees
SET branch_id = (SELECT id FROM branches WHERE code = 'HO-DHK' LIMIT 1)
WHERE branch_id IS NULL AND deleted_at IS NULL;
