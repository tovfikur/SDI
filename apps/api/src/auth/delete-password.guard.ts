/**
 * Global Delete Protection guard (Admin Delete Protection).
 *
 * Every DELETE request (except the file-infrastructure routes) requires:
 *   1. an admin-class identity (super admin / super_admin / hr_admin role),
 *   2. the correct delete password, submitted as `deletePassword` in the body.
 *
 * Only the scrypt hash is stored server-side; plaintext is never persisted or
 * returned. Repeated wrong attempts are rate-limited per user (5 strikes →
 * 15-minute lockout). The RBAC/soft-delete/dependency-check behavior of the
 * underlying delete handlers is unchanged.
 */

import { Injectable, ForbiddenException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { isAdminUser, verifyPassword } from '@jsk/shared-auth';
import { query } from '@jsk/shared-kernel';
import type { RequestWithSession } from './session';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class DeletePasswordGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithSession>();
    if (req.method.toUpperCase() !== 'DELETE') {
      return true;
    }
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (path.startsWith('/api/files')) {
      // File objects are removed as part of upload/replace flows across the
      // app (not standalone admin deletes) — keep them out of the gate.
      return true;
    }
    if (path.startsWith('/api/messages') || path.startsWith('/api/todos')) {
      // Messaging + personal to-dos: users delete their own soft-deletable
      // content; ownership is enforced per-item by the controllers. Not
      // admin-destructive operations.
      return true;
    }
    if (!req.identity) {
      return true; // session guard rejects before any deletion can run
    }

    if (!isAdminUser(req.identity)) {
      throw new ForbiddenException('DELETE_REQUIRES_ADMIN');
    }

    const submitted = (req.body as { deletePassword?: unknown } | undefined)?.deletePassword;
    if (typeof submitted !== 'string' || submitted.length === 0) {
      throw new ForbiddenException('INVALID_DELETE_PASSWORD');
    }

    const attempts = await query<{ failed_count: number; locked_until: string | null }>(
      'SELECT failed_count, locked_until FROM delete_password_attempts WHERE user_id = $1',
      [req.identity.id]
    );
    const lockedUntil = attempts.rows[0]?.locked_until
      ? new Date(attempts.rows[0].locked_until).getTime()
      : 0;
    if (lockedUntil > Date.now()) {
      throw new ForbiddenException('DELETE_PASSWORD_LOCKED');
    }

    const settings = await query<{ password_hash: string }>(
      'SELECT password_hash FROM delete_password_settings WHERE id = true'
    );
    if (settings.rows.length === 0) {
      throw new ForbiddenException('DELETE_PASSWORD_NOT_SET');
    }

    if (!verifyPassword(submitted, settings.rows[0].password_hash)) {
      const { rows: updated } = await query<{ failed_count: number; locked_until: string | null }>(
        `INSERT INTO delete_password_attempts (user_id, failed_count, locked_until, updated_at)
         VALUES ($1, 1, NULL, now())
         ON CONFLICT (user_id) DO UPDATE SET
           failed_count = delete_password_attempts.failed_count + 1,
           locked_until = CASE
             WHEN delete_password_attempts.failed_count + 1 >= $2 THEN now() + make_interval(mins => $3)
             ELSE delete_password_attempts.locked_until
           END,
           updated_at = now()
         RETURNING failed_count, locked_until`,
        [req.identity.id, MAX_ATTEMPTS, LOCK_MINUTES]
      );
      const failed = updated[0]?.failed_count ?? 1;
      if (failed >= MAX_ATTEMPTS) {
        throw new ForbiddenException('DELETE_PASSWORD_LOCKED');
      }
      throw new ForbiddenException('INVALID_DELETE_PASSWORD');
    }

    await query('DELETE FROM delete_password_attempts WHERE user_id = $1', [req.identity.id]);
    return true;
  }
}