-- Allow marking upload sessions as failed (e.g. presigned PUT never completed).
ALTER TABLE upload_sessions DROP CONSTRAINT IF EXISTS upload_sessions_status_check;
ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_status_check
  CHECK (status IN ('pending', 'confirmed', 'expired', 'failed'));
