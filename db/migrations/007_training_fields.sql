-- Training programs: add duration/capacity fields used by the UI, and extend
-- the status CHECK to include 'in_progress' (frontend already sends it).

ALTER TABLE trainings
  ADD COLUMN IF NOT EXISTS duration_hours numeric(6,1),
  ADD COLUMN IF NOT EXISTS max_participants integer;

ALTER TABLE trainings DROP CONSTRAINT IF EXISTS trainings_status_check;
ALTER TABLE trainings ADD CONSTRAINT trainings_status_check
  CHECK (status IN ('planned','scheduled','in_progress','completed','cancelled'));
