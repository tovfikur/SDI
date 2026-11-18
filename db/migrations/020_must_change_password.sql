-- 020_must_change_password.sql
-- Force password change on first login for auto-created employee accounts.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS users_employee_id_idx ON users(employee_id);