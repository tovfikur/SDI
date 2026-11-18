-- 018_employee_photo.sql
-- Employee Photo file reference.
-- Replaces the Photo URL input with the file-session upload infrastructure
-- (confirmed file record id stored on the employee).
-- Additive only; existing photo_url values are preserved.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_file_id uuid;

CREATE INDEX IF NOT EXISTS employees_photo_file_idx ON employees(photo_file_id);