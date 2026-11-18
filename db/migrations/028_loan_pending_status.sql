-- Allow ESS loan requests to start in `pending` state before HR approval.
ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_status_check;
ALTER TABLE loans ADD CONSTRAINT loans_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'closed'::text, 'cancelled'::text]));
