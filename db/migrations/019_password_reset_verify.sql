-- 019_password_reset_verify.sql
-- Add verified_at to password_reset_tokens for the two-step reset flow.

ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_created_idx
  ON password_reset_tokens (user_id, created_at DESC);