-- Personal daily to-do / work notes (My Work → My To Do).
-- Lightweight per-employee checklist, separate from project tasks.
CREATE TABLE IF NOT EXISTS employee_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  todo_date date NOT NULL,
  title text NOT NULL,
  is_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_employee_todos_emp_date
  ON employee_todos (employee_id, todo_date);

ALTER TABLE employee_todos ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
