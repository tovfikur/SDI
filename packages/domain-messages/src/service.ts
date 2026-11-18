import { query, withTransaction } from '@jsk/shared-kernel';

/* ─── Types ────────────────────────────────────────────────────────────────── */

export type ConversationType = 'direct' | 'group';
export type MemberRole = 'owner' | 'admin' | 'member';

export interface MessagingUser {
  id: string;
  username: string;
  full_name: string;
  email: string;
  designation: string | null;
  department: string | null;
}

export interface ConversationSummary {
  id: string;
  type: ConversationType;
  name: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  archived_at: string | null;
  my_role: MemberRole;
  muted: boolean;
  unread_count: number;
  member_count: number;
  participants: { user_id: string; full_name: string }[];
  latest_message: {
    id: string;
    seq: number;
    sender_user_id: string;
    sender_name: string | null;
    body: string;
    message_type: string;
    created_at: string;
    deleted: boolean;
  } | null;
}

export interface MessageRow {
  id: string;
  seq: number;
  conversation_id: string;
  sender_user_id: string;
  sender_name: string | null;
  body: string;
  message_type: string;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  attachments: { id: string; file_id: string; filename: string; mime_type: string; size_bytes: string }[];
}

export interface ConversationDetail
  extends Omit<ConversationSummary, 'latest_message' | 'unread_count'> {
  members: {
    user_id: string;
    username: string;
    full_name: string;
    role: MemberRole;
    joined_at: string;
  }[];
  other_participant: { user_id: string; full_name: string } | null;
}

export const MAX_MESSAGE_LENGTH = 5000;
const MAX_GROUP_NAME = 120;
const MAX_MEMBER_LIMIT = 200;

/* ─── Real-time push hook (wired to the SSE gateway by the API layer) ──────── */

export interface MessagesPushEvent {
  event:
    | 'message:new'
    | 'message:updated'
    | 'message:deleted'
    | 'conversation:created'
    | 'conversation:updated'
    | 'conversation:read'
    | 'group:member_added'
    | 'group:member_removed';
  conversation_id: string;
  audience: string[];
  payload: unknown;
}

type PushHandler = (evt: MessagesPushEvent) => void;
let pushHandler: PushHandler | null = null;

export function setMessagesPushHandler(handler: PushHandler | null): void {
  pushHandler = handler;
}

async function emitToConversation(
  event: MessagesPushEvent['event'],
  conversationId: string,
  payload: unknown,
  excludeUserId?: string,
  knownAudience?: string[]
): Promise<void> {
  if (!pushHandler) return;
  const base = knownAudience ?? (await memberUserIds(conversationId));
  const audience = excludeUserId ? base.filter((id) => id !== excludeUserId) : base;
  if (audience.length === 0) return;
  pushHandler({ event, conversation_id: conversationId, audience, payload });
}

/* ─── Small helpers ────────────────────────────────────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, label: string): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!UUID_RE.test(v)) throw new Error(`${label} must be a valid uuid`);
  return v.toLowerCase();
}

function assertMessageBody(body: unknown): string {
  const t = typeof body === 'string' ? body.replace(/\r\n/g, '\n').trim() : '';
  if (t.length === 0) throw new Error('Message body is required');
  if (t.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
  }
  return t;
}

function assertGroupName(name: unknown): string {
  const t = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (t.length === 0) throw new Error('Group name is required');
  if (t.length > MAX_GROUP_NAME) {
    throw new Error(`Group name must be ${MAX_GROUP_NAME} characters or fewer`);
  }
  return t;
}

/** Canonical key for an unordered pair of users (prevents duplicate DMs). */
export function directKey(a: string, b: string): string {
  return [a.toLowerCase(), b.toLowerCase()].sort().join(':');
}

interface MemberCtx {
  role: MemberRole;
  left_at: string | null;
}

/** Fetch caller's membership or throw when not a participant. */
async function requireMembership(conversationId: string, userId: string): Promise<MemberCtx> {
  const { rows } = await query<{ role: MemberRole; left_at: string | null }>(
    `SELECT role, left_at FROM conversation_members
     WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
  const m = rows[0];
  if (!m || m.left_at) throw new Error('You are not a participant of this conversation');
  return m;
}

async function requireManager(ctx: MemberCtx): Promise<void> {
  if (ctx.role === 'member') {
    throw new Error('Only the group owner or group admins can perform this action');
  }
}

export async function memberUserIds(conversationId: string): Promise<string[]> {
  const { rows } = await query<{ user_id: string }>(
    `SELECT user_id FROM conversation_members
     WHERE conversation_id = $1 AND left_at IS NULL`,
    [conversationId]
  );
  return rows.map((r) => r.user_id);
}

async function assertOtherUserMessagable(otherUserId: string): Promise<void> {
  const { rows } = await query<{ ok: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL AND is_active = true
     ) AS ok`,
    [otherUserId]
  );
  if (!rows[0]?.ok) throw new Error('User not found or not active');
}

/* ─── Audit sink (wired by API layer to domain-audit writeActivity) ────────── */

type AuditSink = (input: {
  actor_user_id: string;
  log_name: string;
  entity_type: string;
  entity_id: string;
  after_value?: Record<string, unknown>;
}) => Promise<unknown>;

let auditSink: AuditSink | null = null;

export function setAuditSink(sink: AuditSink | null): void {
  auditSink = sink;
}

/** Optional hook so the API layer can push refreshed unread counts. */
export type NotificationRefreshHook = (recipientUserId: string) => void;
let notificationRefreshHook: NotificationRefreshHook | null = null;

export function setNotificationRefreshHook(hook: NotificationRefreshHook | null): void {
  notificationRefreshHook = hook;
}

async function auditGroupAction(
  actorUserId: string,
  logName: string,
  conversationId: string,
  after?: Record<string, unknown>
): Promise<void> {
  if (!auditSink) return;
  await auditSink({
    actor_user_id: actorUserId,
    log_name: logName,
    entity_type: 'conversation',
    entity_id: conversationId,
    ...(after !== undefined ? { after_value: after } : {}),
  }).catch(() => {
    /* audit must never break messaging */
  });
}

/* ─── User search (safe fields only) ──────────────────────────────────────── */

/**
 * Search active users for messaging. Returns only safe display fields — never
 * password hashes, session data, payroll or private HR records.
 */
export async function searchUsers(
  currentUserId: string,
  q: string,
  limitRaw = 20
): Promise<MessagingUser[]> {
  const term = typeof q === 'string' ? q.trim().replace(/[%_\\]/g, '') : '';
  const limit = Math.min(Math.max(1, Math.floor(Number(limitRaw) || 20)), 50);
  const params: unknown[] = [currentUserId];
  let where = 'u.deleted_at IS NULL AND u.is_active = true AND u.id <> $1';
  if (term.length > 0) {
    params.push(`%${term}%`);
    where += ` AND (u.full_name ILIKE $2 OR u.username ILIKE $2 OR u.email ILIKE $2 OR e.employee_code ILIKE $2)`;
  }
  params.push(limit);
  const { rows } = await query<MessagingUser>(
    `SELECT u.id, u.username, u.full_name, u.email,
            p.name AS designation, d.name AS department
     FROM users u
     LEFT JOIN employees e ON e.id = u.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN positions p ON p.id = e.position_id
     WHERE ${where}
     ORDER BY u.full_name ASC, u.username ASC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

/* ─── Conversations ───────────────────────────────────────────────────────── */

/**
 * Conversation list for the sidebar: conversation info + latest message +
 * unread count + participant names in a fixed number of queries (no N+1).
 */
export async function listConversations(
  userId: string,
  opts: { page?: number; perPage?: number } = {}
): Promise<{ items: ConversationSummary[]; total: number }> {
  const page = Math.max(1, Number(opts.page ?? 1));
  const perPage = Math.min(Math.max(1, Number(opts.perPage ?? 30)), 100);
  const offset = (page - 1) * perPage;

  const countRes = await query<{ total: string }>(
    `SELECT count(*)::text AS total FROM conversation_members cm
     JOIN conversations c ON c.id = cm.conversation_id
     WHERE cm.user_id = $1 AND cm.left_at IS NULL AND c.deleted_at IS NULL`,
    [userId]
  );

  const idsRes = await query<{ id: string }>(
    `SELECT c.id FROM conversation_members cm
     JOIN conversations c ON c.id = cm.conversation_id
     WHERE cm.user_id = $1 AND cm.left_at IS NULL AND c.deleted_at IS NULL
     ORDER BY GREATEST(c.last_message_at, c.created_at) DESC NULLS LAST
     LIMIT ${perPage} OFFSET ${offset}`,
    [userId]
  );
  const ids = idsRes.rows.map((r) => r.id);
  if (ids.length === 0) return { items: [], total: Number(countRes.rows[0]?.total ?? 0) };
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const meIdx = `$${ids.length + 1}`;

  const [baseR, partsR, latestR] = await Promise.all([
    query<{
      id: string;
      type: ConversationType;
      name: string | null;
      created_by: string;
      created_at: string;
      updated_at: string;
      last_message_at: string | null;
      archived_at: string | null;
      my_role: MemberRole;
      muted: boolean;
      unread_count: string;
      member_count: string;
    }>(
      `SELECT c.id, c.type, c.name, c.created_by, c.created_at, c.updated_at,
              c.last_message_at, c.archived_at,
              cm.role AS my_role, cm.muted,
              (SELECT count(*) FROM messages m
                WHERE m.conversation_id = c.id AND m.seq > cm.last_read_seq
                  AND m.sender_user_id <> ${meIdx} AND m.deleted_at IS NULL)::text AS unread_count,
              (SELECT count(*) FROM conversation_members x
                WHERE x.conversation_id = c.id AND x.left_at IS NULL)::text AS member_count
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ${meIdx}
       WHERE c.id IN (${placeholders}) AND c.deleted_at IS NULL`,
      [...ids, userId]
    ),
    query<{ conversation_id: string; user_id: string; full_name: string }>(
      `SELECT cm.conversation_id, cm.user_id, u.full_name
       FROM conversation_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.conversation_id IN (${placeholders}) AND cm.left_at IS NULL`,
      ids
    ),
    query<{
      conversation_id: string;
      id: string;
      seq: string;
      sender_user_id: string;
      body: string;
      message_type: string;
      created_at: string;
      deleted_at: string | null;
      sender_name: string | null;
    }>(
      `SELECT DISTINCT ON (m.conversation_id)
              m.conversation_id, m.id, m.seq::text AS seq, m.sender_user_id, m.body,
              m.message_type, m.created_at, m.deleted_at, su.full_name AS sender_name
       FROM messages m LEFT JOIN users su ON su.id = m.sender_user_id
       WHERE m.conversation_id IN (${placeholders})
       ORDER BY m.conversation_id, m.seq DESC`,
      ids
    ),
  ]);

  const byId = new Map<string, ConversationSummary>();
  for (const r of baseR.rows) {
    byId.set(r.id, {
      id: r.id,
      type: r.type,
      name: r.name,
      created_by: r.created_by,
      created_at: r.created_at,
      updated_at: r.updated_at,
      last_message_at: r.last_message_at,
      archived_at: r.archived_at,
      my_role: r.my_role,
      muted: r.muted,
      unread_count: Number(r.unread_count),
      member_count: Number(r.member_count),
      participants: [],
      latest_message: null,
    });
  }
  for (const p of partsR.rows) {
    byId.get(p.conversation_id)?.participants.push({ user_id: p.user_id, full_name: p.full_name });
  }
  for (const l of latestR.rows) {
    const conv = byId.get(l.conversation_id);
    if (!conv) continue;
    conv.latest_message = {
      id: l.id,
      seq: Number(l.seq),
      sender_user_id: l.sender_user_id,
      sender_name: l.sender_name,
      body: l.deleted_at ? '' : l.body,
      message_type: l.message_type,
      created_at: l.created_at,
      deleted: l.deleted_at !== null,
    };
  }
  const items = ids.map((id) => byId.get(id)).filter((x): x is ConversationSummary => Boolean(x));
  return { items, total: Number(countRes.rows[0]?.total ?? 0) };
}

export async function getOrCreateDirect(userId: string, otherUserId: string): Promise<string> {
  const me = assertUuid(userId, 'userId');
  const other = assertUuid(otherUserId, 'otherUserId');
  if (me === other) throw new Error('You cannot start a direct conversation with yourself');
  await assertOtherUserMessagable(other);

  const key = directKey(me, other);
  const existing = await query<{ id: string }>(
    `SELECT id FROM conversations WHERE direct_key = $1 AND deleted_at IS NULL`,
    [key]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await query<{ id: string }>(
    `INSERT INTO conversations (type, direct_key, created_by)
     VALUES ('direct', $1, $2)
     ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [key, me]
  );
  let conversationId = inserted.rows[0]?.id;
  if (!conversationId) {
    const again = await query<{ id: string }>(
      `SELECT id FROM conversations WHERE direct_key = $1 AND deleted_at IS NULL`,
      [key]
    );
    conversationId = again.rows[0].id;
  }

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       VALUES ($1, $2, 'owner'), ($1, $3, 'owner')
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [conversationId, me, other]
    );
  });

  void emitToConversation('conversation:created', conversationId!, { id: conversationId }, undefined, [
    me,
    other,
  ]);
  return conversationId!;
}

export async function createGroup(
  userId: string,
  name: string,
  memberIdsInput: string[]
): Promise<string> {
  const owner = assertUuid(userId, 'userId');
  const groupName = assertGroupName(name);
  const uniqueOthers = [
    ...new Set(memberIdsInput.map((id) => assertUuid(id, 'member')).filter((id) => id !== owner)),
  ];
  if (uniqueOthers.length + 1 > MAX_MEMBER_LIMIT) {
    throw new Error(`Groups are limited to ${MAX_MEMBER_LIMIT} members`);
  }
  for (const other of uniqueOthers) {
    await assertOtherUserMessagable(other);
  }

  const { rows } = await query<{ id: string }>(
    `INSERT INTO conversations (type, name, created_by) VALUES ('group', $1, $2) RETURNING id`,
    [groupName, owner]
  );
  const conversationId = rows[0].id as string;

  await withTransaction(async (client) => {
    const values: unknown[] = [conversationId, owner];
    const tuples = [`($1, $2, 'owner')`];
    uniqueOthers.forEach((id, i) => {
      values.push(id);
      tuples.push(`($1, $${i + 3}, 'member')`);
    });
    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`,
      values
    );
  });

  await writeSystemMessage(conversationId, `Group "${groupName}" was created`, owner, [
    owner,
    ...uniqueOthers,
  ]);
  await auditGroupAction(owner, 'messaging.group_created', conversationId, { name: groupName });
  void emitToConversation('conversation:created', conversationId, { id: conversationId }, undefined, [
    owner,
    ...uniqueOthers,
  ]);
  return conversationId;
}

export async function getConversation(userId: string, conversationId: string): Promise<ConversationDetail> {
  const convId = assertUuid(conversationId, 'conversationId');
  await requireMembership(convId, userId);
  const { rows } = await query<{
    id: string;
    type: ConversationType;
    name: string | null;
    created_by: string;
    created_at: string;
    updated_at: string;
    last_message_at: string | null;
    archived_at: string | null;
    muted: boolean;
    member_count: string;
  }>(
    `SELECT c.id, c.type, c.name, c.created_by, c.created_at, c.updated_at,
            c.last_message_at, c.archived_at, cm.muted,
            (SELECT count(*) FROM conversation_members x
              WHERE x.conversation_id = c.id AND x.left_at IS NULL)::text AS member_count
     FROM conversations c JOIN conversation_members cm
       ON cm.conversation_id = c.id AND cm.user_id = $2
     WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [convId, userId]
  );
  const c = rows[0];

  const membersRes = await query<{
    user_id: string;
    username: string;
    full_name: string;
    role: MemberRole;
    joined_at: string;
  }>(
    `SELECT cm.user_id, u.username, u.full_name, cm.role, cm.joined_at
     FROM conversation_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.conversation_id = $1 AND cm.left_at IS NULL
     ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
              u.full_name ASC`,
    [convId]
  );

  const others =
    c.type === 'direct'
      ? membersRes.rows.filter((m) => m.user_id !== userId).map((p) => ({ user_id: p.user_id, full_name: p.full_name }))
      : [];
  return {
    id: c.id,
    type: c.type,
    name: c.type === 'direct' ? null : c.name,
    created_by: c.created_by,
    created_at: c.created_at,
    updated_at: c.updated_at,
    last_message_at: c.last_message_at,
    archived_at: c.archived_at,
    my_role: (membersRes.rows.find((m) => m.user_id === userId)?.role ?? 'member') as MemberRole,
    muted: c.muted,
    member_count: Number(c.member_count),
    participants: others,
    other_participant: others[0] ?? null,
    members: membersRes.rows,
  };
}

/** Rename a group. Owner/admin only; direct conversations cannot be renamed. */
export async function renameGroup(userId: string, conversationId: string, name: string): Promise<void> {
  const convId = assertUuid(conversationId, 'conversationId');
  const groupName = assertGroupName(name);
  const ctx = await requireMembership(convId, userId);
  await requireManager(ctx);
  const typeRes = await query<{ type: ConversationType }>(
    `SELECT type FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
    [convId]
  );
  if (typeRes.rows[0]?.type !== 'group') throw new Error('Only group conversations can be renamed');

  await query(`UPDATE conversations SET name = $2, updated_at = now() WHERE id = $1`, [convId, groupName]);
  await writeSystemMessage(convId, `Group renamed to "${groupName}"`, userId);
  await auditGroupAction(userId, 'messaging.group_renamed', convId, { name: groupName });
  void emitToConversation('conversation:updated', convId, { id: convId, name: groupName });
}

/** Delete/archive: owner-only soft delete of a group conversation. */
export async function deleteConversation(userId: string, conversationId: string): Promise<boolean> {
  const convId = assertUuid(conversationId, 'conversationId');
  const ctx = await requireMembership(convId, userId);
  if (ctx.role !== 'owner') throw new Error('Only the group owner can delete this group');
  const { rowCount } = await query(
    `UPDATE conversations SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL`,
    [convId]
  );
  void emitToConversation('conversation:updated', convId, { id: convId, deleted: true });
  await auditGroupAction(userId, 'messaging.group_deleted', convId);
  return (rowCount ?? 0) > 0;
}

export async function setMuted(userId: string, conversationId: string, muted: boolean): Promise<void> {
  const convId = assertUuid(conversationId, 'conversationId');
  await requireMembership(convId, userId);
  await query(`UPDATE conversation_members SET muted = $3 WHERE conversation_id = $1 AND user_id = $2`, [
    convId,
    userId,
    Boolean(muted),
  ]);
}

/* ─── Group membership management ─────────────────────────────────────────── */

export async function addMembers(
  actorUserId: string,
  conversationId: string,
  newUserIds: string[]
): Promise<number> {
  const convId = assertUuid(conversationId, 'conversationId');
  const actor = assertUuid(actorUserId, 'actorUserId');
  const ctx = await requireMembership(convId, actor);
  await requireManager(ctx);

  const convRes = await query<{ type: ConversationType }>(
    `SELECT type FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
    [convId]
  );
  if (convRes.rows[0]?.type !== 'group') throw new Error('Members can only be added to groups');

  const uniqueNew = [...new Set(newUserIds.map((id) => assertUuid(id, 'member')))];
  if (uniqueNew.length === 0) throw new Error('No members provided');
  if (actor && uniqueNew.includes(actor)) {
    throw new Error('You are already a member of this group');
  }

  const countRes = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM conversation_members
     WHERE conversation_id = $1 AND left_at IS NULL`,
    [convId]
  );
  if (Number(countRes.rows[0]?.n ?? 0) + uniqueNew.length > MAX_MEMBER_LIMIT) {
    throw new Error(`Groups are limited to ${MAX_MEMBER_LIMIT} members`);
  }

  let added = 0;
  const addedNames: string[] = [];
  for (const target of uniqueNew) {
    await assertOtherUserMessagable(target);
    const ins = await query(
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (conversation_id, user_id) DO UPDATE
         SET left_at = NULL, joined_at = now(), role = 'member'
       WHERE conversation_members.left_at IS NOT NULL`,
      [convId, target]
    );
    if ((ins.rowCount ?? 0) > 0) {
      added += 1;
      const nm = await query<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [target]);
      addedNames.push(nm.rows[0]?.full_name ?? 'user');
    }
  }
  if (added > 0) {
    await writeSystemMessage(
      convId,
      `${addedNames.join(', ')} ${addedNames.length === 1 ? 'was' : 'were'} added to the group`,
      actor
    );
    await auditGroupAction(actor, 'messaging.member_added', convId, { users: addedNames });
    await emitToConversation('group:member_added', convId, { added: addedNames });
  }
  return added;
}

export async function removeMember(
  actorUserId: string,
  conversationId: string,
  targetUserId: string
): Promise<void> {
  const convId = assertUuid(conversationId, 'conversationId');
  const actor = assertUuid(actorUserId, 'actorUserId');
  const target = assertUuid(targetUserId, 'targetUserId');
  const ctx = await requireMembership(convId, actor);
  await requireManager(ctx);

  if (actor === target) throw new Error('Use leave to remove yourself from the group');
  const tmRes = await query<{ role: MemberRole; left_at: string | null }>(
    `SELECT role, left_at FROM conversation_members
     WHERE conversation_id = $1 AND user_id = $2`,
    [convId, target]
  );
  const tm = tmRes.rows[0];
  if (!tm || tm.left_at) throw new Error('That user is not a member of this group');
  if (tm.role === 'owner') throw new Error('The owner cannot be removed. Transfer ownership first.');
  if (tm.role === 'admin' && ctx.role !== 'owner') {
    throw new Error('Only the group owner can remove a group admin');
  }

  await query(
    `UPDATE conversation_members SET left_at = now()
     WHERE conversation_id = $1 AND user_id = $2`,
    [convId, target]
  );
  const nm = await query<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [target]);
  await writeSystemMessage(
    convId,
    `${nm.rows[0]?.full_name ?? 'A member'} was removed from the group`,
    actor,
    [target]
  );
  await auditGroupAction(actor, 'messaging.member_removed', convId, { removed_user_id: target });
  await emitToConversation('group:member_removed', convId, { user_id: target });
}

export async function leaveConversation(userId: string, conversationId: string): Promise<void> {
  const convId = assertUuid(conversationId, 'conversationId');
  const ctx = await requireMembership(convId, userId);
  const convRes = await query<{ type: ConversationType }>(
    `SELECT type FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
    [convId]
  );
  if (convRes.rows[0]?.type === 'direct') {
    throw new Error('Direct conversations cannot be left');
  }
  if (ctx.role === 'owner') {
    throw new Error('Transfer ownership to another member before leaving the group');
  }
  await query(
    `UPDATE conversation_members SET left_at = now()
     WHERE conversation_id = $1 AND user_id = $2`,
    [convId, userId]
  );
  const nm = await query<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [userId]);
  await writeSystemMessage(
    convId,
    `${nm.rows[0]?.full_name ?? 'A member'} left the group`,
    userId
  );
  void emitToConversation('group:member_removed', convId, { user_id: userId });
}

/** Role management: promote/demote admins and transfer ownership (owner only). */
export async function setMemberRole(
  actorUserId: string,
  conversationId: string,
  targetUserId: string,
  role: MemberRole
): Promise<void> {
  const convId = assertUuid(conversationId, 'conversationId');
  const actor = assertUuid(actorUserId, 'actorUserId');
  const target = assertUuid(targetUserId, 'targetUserId');
  if (role !== 'admin' && role !== 'member' && role !== 'owner') throw new Error('Invalid role');
  const ctx = await requireMembership(convId, actor);
  if (ctx.role !== 'owner') throw new Error('Only the group owner can change member roles');
  if (actor === target) throw new Error('You cannot change your own role');

  const tm = await requireMembership(convId, target);

  if (role === 'admin' && tm.role === 'member') {
    await query(
      `UPDATE conversation_members SET role = 'admin'
       WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [convId, target]
    );
    const nm = await query<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [target]);
    await writeSystemMessage(convId, `${nm.rows[0]?.full_name ?? 'A member'} is now a group admin`, actor);
    await emitToConversation('conversation:updated', convId, { id: convId });
  } else if (role === 'member' && tm.role === 'admin') {
    await query(
      `UPDATE conversation_members SET role = 'member'
       WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [convId, target]
    );
    const nm = await query<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [target]);
    await writeSystemMessage(
      convId,
      `${nm.rows[0]?.full_name ?? 'A member'} is no longer a group admin`,
      actor
    );
    await emitToConversation('conversation:updated', convId, { id: convId });
  } else if (role === 'owner' && tm.role !== 'owner') {
    // Ownership transfer inside one transaction: target → owner, actor → admin.
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE conversation_members SET role = 'owner'
         WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
        [convId, target]
      );
      await client.query(
        `UPDATE conversation_members SET role = 'admin'
         WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
        [convId, actor]
      );
    });
    const nm = await query<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [target]);
    await writeSystemMessage(convId, `${nm.rows[0]?.full_name ?? 'A member'} is now the group owner`, actor);
    await auditGroupAction(actor, 'messaging.owner_transferred', convId, { new_owner_user_id: target });
    await emitToConversation('conversation:updated', convId, { id: convId });
  } else {
    throw new Error('Unsupported role transition');
  }
}

/* ─── Messages ─────────────────────────────────────────────────────────────── */

interface RawMsgRow {
  id: string;
  seq: string;
  conversation_id: string;
  sender_user_id: string;
  body: string;
  message_type: string;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  sender_name: string | null;
}

const MSG_SELECT = `m.id, m.seq::text AS seq, m.conversation_id, m.sender_user_id, m.body,
  m.message_type, m.created_at, m.updated_at, m.deleted_at, su.full_name AS sender_name`;

async function attachDetails(rows: RawMsgRow[]): Promise<MessageRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const atts = await query<{
    message_id: string;
    id: string;
    file_id: string;
    original_filename: string;
    mime_type: string;
    size_bytes: string;
  }>(
    `SELECT ma.message_id, ma.id, ma.file_id, f.original_filename, f.mime_type,
            f.size_bytes::text AS size_bytes
     FROM message_attachments ma JOIN files f ON f.id = ma.file_id
     WHERE ma.message_id IN (${placeholders})`,
    ids
  );
  const byMsg = new Map<string, MessageRow['attachments']>();
  for (const a of atts.rows) {
    const list = byMsg.get(a.message_id) ?? [];
    list.push({
      id: a.id,
      file_id: a.file_id,
      filename: a.original_filename,
      mime_type: a.mime_type,
      size_bytes: a.size_bytes,
    });
    byMsg.set(a.message_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    seq: Number(r.seq),
    conversation_id: r.conversation_id,
    sender_user_id: r.sender_user_id,
    sender_name: r.sender_name,
    body: r.deleted_at ? 'This message was deleted' : r.body,
    message_type: r.message_type,
    created_at: r.created_at,
    updated_at: r.updated_at,
    deleted_at: r.deleted_at,
    attachments: byMsg.get(r.id) ?? [],
  }));
}

async function loadMessageRows(sql: string, params: unknown[]): Promise<MessageRow[]> {
  const { rows } = await query<RawMsgRow>(sql, params);
  return attachDetails(rows);
}

async function writeSystemMessage(
  conversationId: string,
  body: string,
  actorUserId: string,
  knownAudience?: string[]
): Promise<void> {
  const { rows } = await query<{ id: string; seq: string; created_at: string }>(
    `INSERT INTO messages (conversation_id, sender_user_id, body, message_type)
     VALUES ($1, $2, $3, 'system') RETURNING id, seq::text AS seq, created_at`,
    [conversationId, actorUserId, body.slice(0, MAX_MESSAGE_LENGTH)]
  );
  await query(`UPDATE conversations SET last_message_at = $2, updated_at = now() WHERE id = $1`, [
    conversationId,
    rows[0].created_at,
  ]);
  void emitToConversation(
    'message:new',
    conversationId,
    { id: rows[0].id, seq: Number(rows[0].seq), conversation_id: conversationId, message_type: 'system' },
    undefined,
    knownAudience
  );
}

export async function sendMessage(
  userId: string,
  conversationId: string,
  body: string,
  attachmentFileIdsInput: string[] = []
): Promise<MessageRow> {
  const convId = assertUuid(conversationId, 'conversationId');
  const text = assertMessageBody(body);
  await requireMembership(convId, userId);
  const files = [...new Set(attachmentFileIdsInput.map((f) => assertUuid(f, 'fileId')))].slice(0, 10);

  // Atomic insert of the message + its attachments + conversation touch.
  const inserted = await withTransaction(async (client) => {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, sender_user_id, body, message_type)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [convId, userId, text, files.length > 0 ? 'file' : 'text']
    );
    const msgId = ins.rows[0].id as string;
    for (const fileId of files) {
      await client.query(
        `INSERT INTO message_attachments (message_id, file_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [msgId, fileId]
      );
    }
    await client.query(
      `UPDATE conversations SET last_message_at = now(), updated_at = now() WHERE id = $1`,
      [convId]
    );
    return msgId;
  });

  const [detail] = await loadMessageRows(
    `SELECT ${MSG_SELECT} FROM messages m
     LEFT JOIN users su ON su.id = m.sender_user_id WHERE m.id = $1`,
    [inserted]
  );

  await emitToConversation('message:new', convId, detail, userId);
  await notifyOtherMembers(detail, userId);
  return detail;
}

async function notifyOtherMembers(message: MessageRow, senderId: string): Promise<void> {
  if (message.message_type === 'system') return;
  const audience = (await memberUserIds(message.conversation_id)).filter((id) => id !== senderId);
  if (audience.length === 0) return;
  const preview =
    message.body.length > 80 ? `${message.body.slice(0, 77)}…` : message.body;
  for (const recipientId of audience) {
    await upsertChatNotification({
      recipient_user_id: recipientId,
      title: message.sender_name ?? 'New message',
      message: preview,
      action_url: `/messages/${message.conversation_id}`,
    });
    if (notificationRefreshHook) notificationRefreshHook(recipientId);
  }
}

export async function listMessages(
  userId: string,
  conversationId: string,
  opts: { beforeSeq?: number; limit?: number } = {}
): Promise<{ items: MessageRow[]; has_more: boolean }> {
  const convId = assertUuid(conversationId, 'conversationId');
  await requireMembership(convId, userId);
  const limit = Math.min(Math.max(1, Math.floor(Number(opts.limit ?? 50))), 100);
  const beforeSeq =
    Number.isFinite(Number(opts.beforeSeq)) && Number(opts.beforeSeq) > 0
      ? Math.floor(Number(opts.beforeSeq))
      : null;

  const params: unknown[] = [convId, limit + 1];
  let where = `m.conversation_id = $1`;
  if (beforeSeq) {
    params.push(beforeSeq);
    where += ` AND m.seq < $${params.length}`;
  }
  const rows = await loadMessageRows(
    `SELECT ${MSG_SELECT} FROM messages m
     LEFT JOIN users su ON su.id = m.sender_user_id
     WHERE ${where}
     ORDER BY m.seq DESC
     LIMIT $2`,
    params
  );
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit).reverse(), has_more: hasMore };
}

export async function editMessage(userId: string, messageId: string, body: string): Promise<MessageRow> {
  const msgId = assertUuid(messageId, 'messageId');
  const text = assertMessageBody(body);
  const res = await query<{ conversation_id: string }>(
    `UPDATE messages SET body = $3, updated_at = now()
     WHERE id = $1 AND sender_user_id = $2 AND deleted_at IS NULL AND message_type = 'text'
     RETURNING conversation_id`,
    [msgId, userId, text]
  );
  if (!res.rows[0]) throw new Error('Message not found or you cannot edit this message');
  await requireMembership(res.rows[0].conversation_id, userId);
  const [detail] = await loadMessageRows(
    `SELECT ${MSG_SELECT} FROM messages m
     LEFT JOIN users su ON su.id = m.sender_user_id WHERE m.id = $1`,
    [msgId]
  );
  await emitToConversation('message:updated', res.rows[0].conversation_id, detail);
  return detail;
}

export async function deleteMessage(userId: string, messageId: string): Promise<boolean> {
  const msgId = assertUuid(messageId, 'messageId');
  // Soft delete; original content is wiped from the row.
  const res = await query<{ conversation_id: string }>(
    `UPDATE messages SET deleted_at = now(), body = ''
     WHERE id = $1 AND sender_user_id = $2 AND deleted_at IS NULL
     RETURNING conversation_id`,
    [msgId, userId]
  );
  if (!res.rows[0]) throw new Error('Message not found or you cannot delete this message');
  const [detail] = await loadMessageRows(
    `SELECT ${MSG_SELECT} FROM messages m
     LEFT JOIN users su ON su.id = m.sender_user_id WHERE m.id = $1`,
    [msgId]
  );
  await emitToConversation('message:deleted', res.rows[0].conversation_id, detail);
  return true;
}

export async function markRead(userId: string, conversationId: string): Promise<number> {
  const convId = assertUuid(conversationId, 'conversationId');
  await requireMembership(convId, userId);
  const maxRes = await query<{ seq: string | null }>(
    `SELECT max(seq)::text AS seq FROM messages WHERE conversation_id = $1`,
    [convId]
  );
  const maxSeq = Number(maxRes.rows[0]?.seq ?? 0);
  const upd = await query(
    `UPDATE conversation_members
     SET last_read_seq = GREATEST(last_read_seq, $3), last_read_at = now()
     WHERE conversation_id = $1 AND user_id = $2 AND last_read_seq < $3`,
    [convId, userId, maxSeq]
  );
  if ((upd.rowCount ?? 0) > 0) {
    void emitToConversation('conversation:read', convId, { conversation_id: convId, user_id: userId }, userId);
  }
  return unreadCountFor(convId, userId);
}

export async function unreadTotal(userId: string): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `SELECT coalesce(sum(x.n), 0)::text AS n FROM (
       SELECT (SELECT count(*) FROM messages m
               WHERE m.conversation_id = cm.conversation_id
                 AND m.seq > cm.last_read_seq
                 AND m.sender_user_id <> cm.user_id
                 AND m.deleted_at IS NULL) AS n
       FROM conversation_members cm
       WHERE cm.user_id = $1 AND cm.left_at IS NULL AND cm.muted = false
         AND EXISTS (
           SELECT 1 FROM conversations c
           WHERE c.id = cm.conversation_id AND c.deleted_at IS NULL
         )
     ) x`,
    [userId]
  );
  return Number(rows[0]?.n ?? 0);
}

async function unreadCountFor(conversationId: string, userId: string): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM messages m
     JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $2
     WHERE m.conversation_id = $1 AND m.seq > cm.last_read_seq
       AND m.sender_user_id <> $2 AND m.deleted_at IS NULL`,
    [conversationId, userId]
  );
  return Number(rows[0]?.n ?? 0);
}

/* ─── Reactions ────────────────────────────────────────────────────────────── */

export async function toggleReaction(
  userId: string,
  messageId: string,
  emojiRaw: string
): Promise<'added' | 'removed'> {
  const msgId = assertUuid(messageId, 'messageId');
  const emoji = typeof emojiRaw === 'string' ? emojiRaw.trim().slice(0, 16) : '';
  if (!emoji) throw new Error('Emoji is required');
  const convRes = await query<{ conversation_id: string }>(
    `SELECT conversation_id FROM messages WHERE id = $1 AND deleted_at IS NULL`,
    [msgId]
  );
  if (!convRes.rows[0]) throw new Error('Message not found');
  await requireMembership(convRes.rows[0].conversation_id, userId);
  const existing = await query(
    `SELECT 1 FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
    [msgId, userId, emoji]
  );
  if ((existing.rowCount ?? 0) > 0) {
    await query(
      `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [msgId, userId, emoji]
    );
    return 'removed';
  }
  await query(
    `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [msgId, userId, emoji]
  );
  return 'added';
}

/* ─── Attachments (files module reuse — membership-gated downloads) ───────── */

export async function attachmentFileIdsForMessage(
  userId: string,
  messageId: string
): Promise<string[]> {
  const msgId = assertUuid(messageId, 'messageId');
  const convRes = await query<{ conversation_id: string }>(
    `SELECT conversation_id FROM messages WHERE id = $1`,
    [msgId]
  );
  if (!convRes.rows[0]) throw new Error('Message not found');
  await requireMembership(convRes.rows[0].conversation_id, userId);
  const { rows } = await query<{ file_id: string }>(
    `SELECT file_id FROM message_attachments WHERE message_id = $1`,
    [msgId]
  );
  return rows.map((r) => r.file_id);
}

/** Verify a freshly-uploaded file may be attached by this user. */
export async function assertCanAttach(userId: string, messageId: string): Promise<void> {
  const convRes = await query<{ conversation_id: string; sender_user_id: string }>(
    `SELECT conversation_id, sender_user_id FROM messages WHERE id = $1`,
    [assertUuid(messageId, 'messageId')]
  );
  const row = convRes.rows[0];
  if (!row || row.sender_user_id !== userId) throw new Error('You cannot attach to this message');
  await requireMembership(row.conversation_id, userId);
}

/* ─── Cross-domain chat notification (deduped per recipient+conversation) ─── */

async function upsertChatNotification(input: {
  recipient_user_id: string;
  title: string;
  message: string;
  action_url: string;
}): Promise<void> {
  // One unread in-app notification per (recipient, conversation): refresh the
  // existing unread row instead of stacking duplicates for rapid messages.
  await query(
    `INSERT INTO notification_deliveries
       (event_type, recipient_user_id, template, channel, status, sent_at, title, message, action_url)
     SELECT 'chat.message', $1, 'chat_message', 'in_app', 'sent', now(), $2, $3, $4
     WHERE NOT EXISTS (
       SELECT 1 FROM notification_deliveries
       WHERE channel = 'in_app' AND recipient_user_id = $1
         AND read_at IS NULL AND action_url = $4 AND event_type = 'chat.message'
     )`,
    [input.recipient_user_id, input.title, input.message, input.action_url]
  );
}
