-- 017_appointment_letter.sql
-- Appointment Letter file reference for employees.
-- Replaces the Joining Letter URL input with the file-session upload
-- infrastructure (confirmed file record id stored on the employee).
-- Additive only; existing joining_letter_url values are preserved.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS appointment_letter_file_id uuid;

CREATE INDEX IF NOT EXISTS employees_appointment_letter_idx ON employees(appointment_letter_file_id);