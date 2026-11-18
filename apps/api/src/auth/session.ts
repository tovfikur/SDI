/**
 * Cookie-session plumbing for the HTTP layer (Spec Phase 7). The raw session
 * token and the rotating CSRF token travel as cookies; the CSRF value is also
 * required in the X-CSRF-Token header for state-changing requests.
 */

import type { Request, Response } from 'express';
import { loadIdentity, validateSession } from '@jsk/shared-auth';
import type { UserIdentity } from '@jsk/shared-auth';

export const SESSION_COOKIE = 'jsk_session';
export const CSRF_COOKIE = 'jsk_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const SESSION_MAX_AGE_S = 7 * 24 * 3600;

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  csrfToken: string;
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) {
    return {};
  }
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
  }
  return cookies;
}

function cookieFlags(forSession: boolean): string {
  const secure = process.env.COOKIE_SECURE === 'true';
  const sameSite = process.env.COOKIE_SAME_SITE ?? 'lax';
  return `Path=/; SameSite=${sameSite}${forSession ? '; HttpOnly' : ''}${secure ? '; Secure' : ''}; Max-Age=${SESSION_MAX_AGE_S}`;
}

export function setSessionCookies(res: Response, sessionToken: string, csrfToken: string): void {
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; ${cookieFlags(true)}`,
    `${CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; ${cookieFlags(false)}`,
  ]);
}

export function clearSessionCookies(res: Response): void {
  const secure = process.env.COOKIE_SECURE === 'true';
  const sameSite = process.env.COOKIE_SAME_SITE ?? 'lax';
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=${sameSite}${secure ? '; Secure' : ''}; Max-Age=0`,
    `${CSRF_COOKIE}=; Path=/; SameSite=${sameSite}${secure ? '; Secure' : ''}; Max-Age=0`,
  ]);
}

/** Validates the request session cookie and returns session + identity (or null). */
export async function resolveRequestSession(
  req: Request,
  res?: Response
): Promise<{ session: ResolvedSession; identity: UserIdentity } | null> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) {
    return null;
  }
  const session = await validateSession(token);
  if (!session) {
    return null;
  }
  const identity = await loadIdentity(session.userId);
  if (!identity || !identity.is_active) {
    return null;
  }
  if (res) {
    setSessionCookies(res, token, session.csrfToken);
  }
  return { session, identity };
}

export interface RequestWithSession extends Request {
  sessionId?: string;
  identity?: UserIdentity;
}
