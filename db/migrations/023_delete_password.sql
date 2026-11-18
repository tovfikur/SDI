-- Admin Delete Protection Password (Spec: Admin Delete Protection).
-- Stores only the scrypt hash of the global delete password — plaintext is
-- never persisted. Rate-limit table tracks repeated wrong attempts per user.
CREATE TABLE IF NOT EXISTS delete_password_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  password_hash text NOT NULL,
  updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delete_password_attempts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  failed_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);