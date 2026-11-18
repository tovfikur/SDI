-- 021_in_app_notifications.sql
-- Extend notification_deliveries for in-app notifications.

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS action_url text,
  ADD COLUMN IF NOT EXISTS read_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS notification_deliveries_recipient_inapp_idx
  ON notification_deliveries (recipient_user_id, created_at DESC)
  WHERE channel = 'in_app';