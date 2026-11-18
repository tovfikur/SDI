-- Payroll module (SDI HRM):
-- Configurable salary components, structures, per-employee salary history,
-- payroll rules, runs with snapshotted entries, adjustments, payments and
-- payslips. Backend is the source of truth; all monetary columns are numeric(14,2)
-- (serialized by pg as decimal strings) and calculated with integer-cents math.
--
-- Safety model:
--  * employee salary changes are additive rows (history preserved).
--  * approved/paid payroll entries carry a jsonb snapshot + line rows, so they
--    never recalculate from live configuration.
--  * structures/components are deactivated (deleted_at / is_active) rather than
--    hard-deleted when history depends on them.

-- ---------------------------------------------------------------------------
-- Salary components (earnings / deductions, fixed | percentage | formula)
-- ---------------------------------------------------------------------------
CREATE TABLE salary_components (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  code                    text NOT NULL UNIQUE,
  type                    text NOT NULL CHECK (type IN ('earning','deduction')),
  calculation_type        text NOT NULL DEFAULT 'fixed'
                          CHECK (calculation_type IN ('fixed','percentage','formula')),
  percentage_of_component uuid REFERENCES salary_components(id),
  default_amount          numeric(14,2),
  taxable                 boolean NOT NULL DEFAULT false,
  is_active               boolean NOT NULL DEFAULT true,
  sort_order              integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);
CREATE INDEX salary_components_type_idx ON salary_components(type);
CREATE INDEX salary_components_active_idx ON salary_components(is_active) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Salary structures (a named bundle of components)
-- ---------------------------------------------------------------------------
CREATE TABLE salary_structures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE salary_structure_components (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id            uuid NOT NULL REFERENCES salary_structures(id) ON DELETE CASCADE,
  component_id            uuid NOT NULL REFERENCES salary_components(id),
  calculation_type        text NOT NULL DEFAULT 'fixed'
                          CHECK (calculation_type IN ('fixed','percentage','formula')),
  percentage_of_component uuid REFERENCES salary_components(id),
  amount                  numeric(14,2),
  UNIQUE (structure_id, component_id)
);
CREATE INDEX salary_structure_components_structure_idx
  ON salary_structure_components(structure_id);

-- ---------------------------------------------------------------------------
-- Employee salary assignment (additive history, never mutated in place)
-- ---------------------------------------------------------------------------
CREATE TABLE employee_salaries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id          uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  salary_structure_id  uuid NOT NULL REFERENCES salary_structures(id),
  gross_salary         numeric(14,2) NOT NULL CHECK (gross_salary >= 0),
  currency             text NOT NULL DEFAULT 'BDT',
  effective_from       date NOT NULL,
  effective_to         date,
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by           uuid REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX employee_salaries_employee_idx ON employee_salaries(employee_id);
CREATE INDEX employee_salaries_effective_idx ON employee_salaries(effective_from, effective_to);

-- Per-assignment component overrides (authorized users may override amounts).
CREATE TABLE employee_salary_overrides (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_salary_id   uuid NOT NULL REFERENCES employee_salaries(id) ON DELETE CASCADE,
  component_id         uuid NOT NULL REFERENCES salary_components(id),
  amount               numeric(14,2) NOT NULL,
  UNIQUE (employee_salary_id, component_id)
);
CREATE INDEX employee_salary_overrides_salary_idx ON employee_salary_overrides(employee_salary_id);

-- ---------------------------------------------------------------------------
-- Payroll rules (singleton configuration row)
-- ---------------------------------------------------------------------------
CREATE TABLE payroll_settings (
  id                         integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  period_label               text NOT NULL DEFAULT 'Monthly',
  salary_calculation_basis   text NOT NULL DEFAULT 'gross_salary'
                             CHECK (salary_calculation_basis IN ('gross_salary','basic_salary')),
  attendance_deduction       boolean NOT NULL DEFAULT true,
  late_deduction             boolean NOT NULL DEFAULT false,
  overtime_enabled           boolean NOT NULL DEFAULT false,
  unpaid_leave_deduction     boolean NOT NULL DEFAULT true,
  rounding_rule              text NOT NULL DEFAULT 'nearest'
                             CHECK (rounding_rule IN ('nearest','ceil','floor')),
  working_day_calculation    text NOT NULL DEFAULT 'calendar_days'
                             CHECK (working_day_calculation IN ('calendar_days','scheduled_working_days')),
  default_payment_day        integer NOT NULL DEFAULT 1 CHECK (default_payment_day BETWEEN 1 AND 28),
  default_currency           text NOT NULL DEFAULT 'BDT',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Payroll runs (a monthly batch for a set of employees)
-- ---------------------------------------------------------------------------
CREATE TABLE payroll_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month      date NOT NULL,               -- first day of the payroll month
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','calculated','approved','paid','cancelled')),
  payment_date      date,
  payment_method    text CHECK (payment_method IN ('bank_transfer','cash','cheque','other')),
  payment_reference text NOT NULL DEFAULT '',
  payment_notes     text NOT NULL DEFAULT '',
  gross_total       numeric(14,2) NOT NULL DEFAULT 0,
  earnings_total    numeric(14,2) NOT NULL DEFAULT 0,
  deductions_total  numeric(14,2) NOT NULL DEFAULT 0,
  net_total         numeric(14,2) NOT NULL DEFAULT 0,
  run_by            uuid REFERENCES users(id),
  calculated_by     uuid REFERENCES users(id),
  approved_by       uuid REFERENCES users(id),
  paid_by           uuid REFERENCES users(id),
  calculated_at     timestamptz,
  approved_at       timestamptz,
  paid_at           timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- One active run per month (cancelled runs do not block a re-run).
CREATE UNIQUE INDEX payroll_runs_period_unique
  ON payroll_runs(period_month) WHERE status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- Payroll entries (one snapshot per employee per run)
-- ---------------------------------------------------------------------------
CREATE TABLE payroll_entries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id        uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id           uuid NOT NULL REFERENCES employees(id),
  employee_salary_id    uuid NOT NULL REFERENCES employee_salaries(id),
  period_month          date NOT NULL,
  gross_pay             numeric(14,2) NOT NULL DEFAULT 0,
  total_earnings        numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions      numeric(14,2) NOT NULL DEFAULT 0,
  net_pay               numeric(14,2) NOT NULL DEFAULT 0,
  attendance_deduction  numeric(14,2) NOT NULL DEFAULT 0,
  late_deduction        numeric(14,2) NOT NULL DEFAULT 0,
  unpaid_leave_deduction numeric(14,2) NOT NULL DEFAULT 0,
  loan_deduction        numeric(14,2) NOT NULL DEFAULT 0,
  adjustment_earnings   numeric(14,2) NOT NULL DEFAULT 0,
  adjustment_deductions numeric(14,2) NOT NULL DEFAULT 0,
  working_days          integer NOT NULL DEFAULT 0,
  payable_days          integer NOT NULL DEFAULT 0,
  absent_days           integer NOT NULL DEFAULT 0,
  late_days             integer NOT NULL DEFAULT 0,
  unpaid_leave_days     numeric(6,2) NOT NULL DEFAULT 0,
  payment_status        text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid')),
  calculated_at         timestamptz NOT NULL DEFAULT now(),
  approved_at           timestamptz,
  paid_at               timestamptz,
  snapshot              jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (payroll_run_id, employee_id)
);
CREATE INDEX payroll_entries_employee_period_idx ON payroll_entries(employee_id, period_month);
CREATE INDEX payroll_entries_run_idx ON payroll_entries(payroll_run_id);

-- Detailed, snapshotted component lines (historical value, not live config).
CREATE TABLE payroll_entry_lines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_entry_id     uuid NOT NULL REFERENCES payroll_entries(id) ON DELETE CASCADE,
  salary_component_id  uuid REFERENCES salary_components(id),
  name                 text NOT NULL,
  type                 text NOT NULL CHECK (type IN ('earning','deduction')),
  amount               numeric(14,2) NOT NULL DEFAULT 0,
  source               text NOT NULL DEFAULT 'structure'
                       CHECK (source IN ('structure','override','attendance','late','leave','loan','adjustment','overtime')),
  description          text NOT NULL DEFAULT ''
);
CREATE INDEX payroll_entry_lines_entry_idx ON payroll_entry_lines(payroll_entry_id);

-- ---------------------------------------------------------------------------
-- Manual adjustments (bonus, commission, penalty, ...) — audited, never deleted
-- ---------------------------------------------------------------------------
CREATE TABLE payroll_adjustments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id       uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id          uuid NOT NULL REFERENCES employees(id),
  salary_component_id  uuid REFERENCES salary_components(id),
  type                 text NOT NULL CHECK (type IN ('earning','deduction')),
  amount               numeric(14,2) NOT NULL,
  reason               text NOT NULL DEFAULT '',
  added_by             uuid REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_adjustments_run_idx ON payroll_adjustments(payroll_run_id);
CREATE INDEX payroll_adjustments_employee_idx ON payroll_adjustments(employee_id);