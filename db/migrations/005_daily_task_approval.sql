-- Daily task approval workflow (Reference parity: Pending -> Approved / Rejected)
-- Additive only; existing rows are untouched.

ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id);
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES users(id);
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

CREATE INDEX IF NOT EXISTS daily_tasks_employee_date_idx ON daily_tasks(employee_id, work_date);
