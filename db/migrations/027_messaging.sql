-- Messaging module (conversations, members, messages, attachments, reactions).
-- Account-level feature: every active authenticated user can participate.

-- ─── conversations ──────────────────────────────────────────────────────────
CREATE TABLE conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL CHECK (type IN ('direct', 'group')),
  name            text,
  -- For direct conversations: canonical "userA:userB" key (sorted uuids) so the
  -- same pair always resolves to a single conversation (partial unique index).
  direct_key      text,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  archived_at     timestamptz,
  deleted_at      timestamptz,
  CHECK (type <> 'direct' OR name IS NULL),
  CHECK (type = 'direct' OR name IS NOT NULL)
);

-- One direct conversation per unordered user pair.
CREATE UNIQUE INDEX conversations_direct_key_uq ON conversations (direct_key) WHERE direct_key IS NOT NULL;
CREATE INDEX conversations_type_idx ON conversations (type) WHERE deleted_at IS NULL;

-- ─── conversation_members ───────────────────────────────────────────────────
CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  role            text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  left_at         timestamptz,
  -- Read position = highest messages.seq the member has seen.
  last_read_seq   bigint NOT NULL DEFAULT 0,
  last_read_at    timestamptz,
  muted           boolean NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX conv_members_user_active_idx ON conversation_members (user_id) WHERE left_at IS NULL;

-- ─── messages ───────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             bigint GENERATED ALWAYS AS IDENTITY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id  uuid NOT NULL REFERENCES users(id),
  body            text NOT NULL CHECK (deleted_at IS NOT NULL OR (char_length(body) <= 5000 AND char_length(btrim(body)) > 0)),
  message_type    text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'file', 'system')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  deleted_at      timestamptz
);

CREATE UNIQUE INDEX messages_seq_uq ON messages (seq);
CREATE INDEX messages_conv_seq_idx ON messages (conversation_id, seq DESC);
CREATE INDEX messages_sender_idx ON messages (sender_user_id);

-- ─── message_attachments (reuses existing files storage; no parallel store) ─
CREATE TABLE message_attachments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_id    uuid NOT NULL REFERENCES files(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, file_id)
);

CREATE INDEX msg_attachments_file_idx ON message_attachments (file_id);

-- ─── message_reactions ──────────────────────────────────────────────────────
CREATE TABLE message_reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id),
  emoji      text NOT NULL CHECK (char_length(emoji) <= 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
