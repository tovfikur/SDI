-- 015_performance_appraisal.sql
-- Premium Performance Appraisal System (Spec 1.3, Sections A-F)
-- Normalizes Section A/B fixed criteria, Section C classification fields,
-- Section E (Development Plan) and Section F (Next Period Goals) into
-- relational child tables instead of legacy concatenated strings.

-- Section A/B: tag each score row with its section and chosen rating label.
ALTER TABLE employee_performance_scores
  ADD COLUMN section text NOT NULL DEFAULT 'A'
  CHECK (section IN ('A', 'B'));

ALTER TABLE employee_performance_scores
  ADD COLUMN rating text
  CHECK (rating IN ('Poor', 'Need Improvement', 'Good', 'Very Good', 'Excellent') OR rating IS NULL);

-- Section C: reviewer recommendations + signature, and next review scheduling.
ALTER TABLE employee_performances
  ADD COLUMN reviewer_recommendations text;

ALTER TABLE employee_performances
  ADD COLUMN reviewer_signature text;

ALTER TABLE employee_performances
  ADD COLUMN next_review_date date;

-- Section E: Development Plan (repeatable rows).
CREATE TABLE employee_performance_development_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_id   uuid NOT NULL REFERENCES employee_performances(id) ON DELETE CASCADE,
  improvement_area text,
  expected_outcome text,
  mentor_name      text,
  start_date       date,
  end_date         date,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_performance_dev_plans_perf_idx
  ON employee_performance_development_plans(performance_id);

-- Section F: Next Period Goals (repeatable rows).
CREATE TABLE employee_performance_next_goals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performance_id uuid NOT NULL REFERENCES employee_performances(id) ON DELETE CASCADE,
  goal           text,
  target_period  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_performance_next_goals_perf_idx
  ON employee_performance_next_goals(performance_id);

-- Drop legacy concatenated Section E/F columns (now normalized into child tables).
ALTER TABLE employee_performances DROP COLUMN IF EXISTS development_areas;
ALTER TABLE employee_performances DROP COLUMN IF EXISTS expected_outcomes;
ALTER TABLE employee_performances DROP COLUMN IF EXISTS mentor_name;
ALTER TABLE employee_performances DROP COLUMN IF EXISTS development_start_date;
ALTER TABLE employee_performances DROP COLUMN IF EXISTS development_end_date;
ALTER TABLE employee_performances DROP COLUMN IF EXISTS next_period_goals;
ALTER TABLE employee_performances DROP COLUMN IF EXISTS target_completion_periods;