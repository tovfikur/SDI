/**
 * Server-side session management (Spec Phase 7): HttpOnly cookie session,
 * DB-backed so it can be revoked; sliding expiration with an absolute max
 * lifetime; CSRF token bound to the session.
 */

import { createHash, randomBytes } from 'node:crypto';
import { query } from '@jsk/shared-kernel';

const ABSOLUTE_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 days absolute
const SLIDING_MS = 60 * 60 * 1000; // 1h of inactivity to refresh

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_token_hash: string;
  expires_at: string;
  last_activity_at: string;
  revoked_at: string | null;
}

export interface ActiveSession {
  id: string;
  /** Raw session token — returned exactly once for the login cookie. */
  token: string;
  csrf_token: string;
  expires_at: string;
}

export async function createSession(
  userId: string,
  userAgent: string,
  ip: string | null,
  now = new Date()
): Promise<ActiveSession> {
  const token = newToken();
  const csrf = newToken();
  const expiresAt = new Date(now.getTime() + ABSOLUTE_MAX_MS);
  const { rows } = await query<SessionRow>(
    `INSERT INTO sessions (user_id, token_hash, csrf_token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5::inet, $6) RETURNING id, expires_at`,
    [userId, sha256(token), sha256(csrf), userAgent, ip ?? '0.0.0.0', expiresAt.toISOString()]
  );
  return { id: rows[0].id, token, csrf_token: csrf, expires_at: rows[0].expires_at };
}

/**
 * Validates a raw token. Returns the user id + a fresh CSRF token on success
 * (sliding expiry refresh handled by the caller persisting the new cookie).
 */
export async function validateSession(
  token: string,
  now = new Date()
): Promise<{ sessionId: string; userId: string; csrfToken: string } | null> {
  const { rows } = await query<SessionRow>(
    `SELECT id, user_id, csrf_token_hash, expires_at FROM sessions
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [sha256(token)]
  );
  if (rows.length === 0) {
    return null;
  }
  const session = rows[0];
  if (new Date(session.expires_at) <= now) {
    return null;
  }
  // Sliding expiry: refresh if within the sliding window of the absolute max.
  const refreshAt = new Date(now.getTime() + SLIDING_MS);
  if (new Date(session.expires_at) < refreshAt) {
    const newExpiry = new Date(now.getTime() + ABSOLUTE_MAX_MS);
    await query(
      `UPDATE sessions SET expires_at = $2, last_activity_at = now() WHERE id = $1`,
      [session.id, newExpiry.toISOString()]
    );
  } else {
    await query(`UPDATE sessions SET last_activity_at = now() WHERE id = $1`, [session.id]);
  }
  // Rotate CSRF token on every validated request for extra defence.
  const csrf = newToken();
  await query(`UPDATE sessions SET csrf_token_hash = $2 WHERE id = $1`, [session.id, sha256(csrf)]);
  return { sessionId: session.id, userId: session.user_id, csrfToken: csrf };
}

export async function validateCsrf(token: string, csrf: string): Promise<boolean> {
  const { rows } = await query<SessionRow>(
    `SELECT csrf_token_hash FROM sessions WHERE id = $1 AND revoked_at IS NULL`,
    [token]
  );
  return rows.length === 1 && rows[0].csrf_token_hash === sha256(csrf);
}

export async function revokeSession(sessionId: string): Promise<void> {
  await query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [sessionId]);
}

export async function revokeAllSessionsForUser(
  userId: string,
  exceptSessionId?: string
): Promise<void> {
  if (exceptSessionId) {
    await query(
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
      [userId, exceptSessionId]
    );
  } else {
    await query(
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
  }
}

export async function listSessionsForUser(
  userId: string
): Promise<Array<{ id: string; user_agent: string; created_at: string; last_activity_at: string }>> {
  const { rows } = await query<{ id: string; user_agent: string; created_at: string; last_activity_at: string }>(
    `SELECT id, user_agent, created_at, last_activity_at FROM sessions
     WHERE user_id = $1 AND revoked_at IS NULL ORDER BY last_activity_at DESC`,
    [userId]
  );
  return rows;
}

/** Deletes expired sessions. Returns number removed. */
export async function purgeExpiredSessions(now = new Date()): Promise<number> {
  const { rowCount } = await query(
    `DELETE FROM sessions WHERE expires_at < $1 OR revoked_at IS NOT NULL`,
    [now.toISOString()]
  );
  return rowCount ?? 0;
}
