-- 016_work_log.sql
-- Premium Work Log metadata (Spec: Work Log upgrade of daily_tasks).
-- Additive only; existing rows are untouched.

-- Rejection reason (required when a manager rejects a log).
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Submitted-at timestamp for the Draft -> Submitted transition.
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- Attachment(s) via the existing file-session infrastructure (file record ids).
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS attachment_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS daily_tasks_status_idx ON daily_tasks(status);