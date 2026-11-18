-- Employees without an email can still get a portal login keyed by employee_id.
-- The login lookup is username-based, so email is now optional on users.
-- (username retains its NOT NULL UNIQUE constraint, which is the arbiter for
-- ON CONFLICT (username).)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;