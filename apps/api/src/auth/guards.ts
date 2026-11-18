import { Injectable, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { hasAnyPermission, validateCsrf } from '@jsk/shared-auth';
import type { UserIdentity } from '@jsk/shared-auth';
import { CSRF_COOKIE, CSRF_HEADER, parseCookies, resolveRequestSession } from './session';
import type { RequestWithSession } from './session';

export function withIdentity(req: RequestWithSession): UserIdentity {
  if (!req.identity) {
    throw new UnauthorizedException('Not authenticated');
  }
  return req.identity;
}

/** Requires a valid session; refreshes the CSRF cookie on every request. */
@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithSession>();
    const res = context.switchToHttp().getResponse();
    const resolved = await resolveRequestSession(req, res);
    if (!resolved) {
      throw new UnauthorizedException('Not authenticated');
    }
    req.identity = resolved.identity;
    req.sessionId = resolved.session.sessionId;
    return true;
  }
}

/** Blocks CSRF on state-changing requests: header token must match the session. */
@Injectable()
export class CsrfGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithSession>();
    if (!req.sessionId) {
      throw new UnauthorizedException('Not authenticated');
    }
    const headerToken = req.header(CSRF_HEADER);
    if (!headerToken) {
      throw new ForbiddenException('Missing CSRF token');
    }
    const cookieToken = parseCookies(req)[CSRF_COOKIE];
    const matches = await validateCsrf(req.sessionId, headerToken);
    if (!matches || (cookieToken !== undefined && cookieToken !== headerToken)) {
      throw new ForbiddenException('Invalid CSRF token');
    }
    return true;
  }
}

/**
 * Permission guard factory: `@UseGuards(Permissions('hr.employee.view'))`.
 * Super Admin bypasses via `hasAnyPermission` (identity.permissions = ['*']).
 */
export function Permissions(...permissions: string[]): typeof SessionGuard {
  @Injectable()
  class PermissionGuard extends SessionGuard {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const ok = await super.canActivate(context);
      if (!ok) {
        return false;
      }
      const req = context.switchToHttp().getRequest<RequestWithSession>();
      const identity = req.identity as UserIdentity;
      if (permissions.length > 0 && !hasAnyPermission(identity, permissions)) {
        throw new ForbiddenException('Insufficient permissions');
      }
      return true;
    }
  }
  return PermissionGuard;
}
