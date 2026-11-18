-- 003_performance_sections.sql
-- Adds Performance Appraisal Sections D-F (Spec 1.3)

-- Section D: Employee Comments (max 500-word statement)
ALTER TABLE employee_performances ADD COLUMN employee_comments text;

-- Section E: Development Plan
ALTER TABLE employee_performances ADD COLUMN development_areas text;
ALTER TABLE employee_performances ADD COLUMN expected_outcomes text;
ALTER TABLE employee_performances ADD COLUMN mentor_name text;
ALTER TABLE employee_performances ADD COLUMN development_start_date date;
ALTER TABLE employee_performances ADD COLUMN development_end_date date;

-- Section F: Next Period Goals
ALTER TABLE employee_performances ADD COLUMN next_period_goals text;
ALTER TABLE employee_performances ADD COLUMN target_completion_periods text;

-- Performance Classification (auto-computed from score)
ALTER TABLE employee_performances ADD COLUMN classification text
  CHECK (classification IN ('EE','AE','UE') OR classification IS NULL);
