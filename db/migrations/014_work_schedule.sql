-- ============================================================================
-- 014_work_schedule.sql
-- Extends setup_rules with production-grade work schedule fields:
--   - working_days      : explicit Sat..Fri working day selector
--   - auto_calc_hours   : auto-calculate daily hours from start/end, with
--                         explicit numeric override when disabled
-- Normalizes legacy work_pattern values to the canonical set.
-- ============================================================================

ALTER TABLE setup_rules
  ADD COLUMN IF NOT EXISTS working_days text[]
    NOT NULL DEFAULT ARRAY['sat','sun','mon','tue','wed','thu','fri'],
  ADD COLUMN IF NOT EXISTS auto_calc_hours boolean NOT NULL DEFAULT true;

-- Normalize legacy work pattern values to canonical labels.
UPDATE setup_rules
   SET work_pattern = '5 Days'
 WHERE work_pattern IN ('5_days', '5 Days') AND deleted_at IS NULL;

UPDATE setup_rules
   SET work_pattern = '6 Days'
 WHERE work_pattern IN ('6_days', '6 Days') AND deleted_at IS NULL;

UPDATE setup_rules
   SET work_pattern = '7 Days'
 WHERE work_pattern IN ('7_days', '7 Days') AND deleted_at IS NULL;

UPDATE setup_rules
   SET work_pattern = 'Shift'
 WHERE work_pattern IN ('shift', 'Shift') AND deleted_at IS NULL;

UPDATE setup_rules
   SET work_pattern = 'Fixed'
 WHERE deleted_at IS NULL
   AND work_pattern NOT IN ('Fixed','5 Days','6 Days','7 Days','Shift');

-- Seeded 9-6 office schedule is a 5-day (Sun..Thu) pattern.
UPDATE setup_rules
   SET working_days = ARRAY['sun','mon','tue','wed','thu'],
       work_pattern = '5 Days'
 WHERE title = 'Fixed 9-6 (Permanent)' AND deleted_at IS NULL;