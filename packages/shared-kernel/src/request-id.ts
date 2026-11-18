/**
 * X-Request-Id contract (Spec Phase 6).
 *
 * Phase 6: every request gets an `X-Request-Id` (generated if absent), propagated into logs
 * and Activity Log entries. It is a correlation identifier only and must never be trusted
 * for logic (FOUND-003 security note).
 */

import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';
export const REQUEST_ID_CTX = 'requestId';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true for an acceptable incoming request id (UUID shape).
 */
export function isValidRequestId(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Generates a new request id.
 */
export function generateRequestId(): string {
  return randomUUID();
}
