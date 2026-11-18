import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { resolveRequestSession } from './session';
import type { RequestWithSession } from './session';
import { UnauthorizedException } from '@nestjs/common';

const PUBLIC_ROUTES: Array<{ method: string; path: RegExp }> = [
  { method: 'GET', path: /^\/health$/ },
  { method: 'GET', path: /^\/api\/health$/ },
  { method: 'GET', path: /^\/api\/auth\/me$/ },
  { method: 'GET', path: /^\/api\/auth\/csrf$/ },
  { method: 'POST', path: /^\/api\/auth\/login$/ },
  { method: 'POST', path: /^\/api\/auth\/forgot-password$/ },
  { method: 'POST', path: /^\/api\/auth\/verify-reset-code$/ },
  { method: 'POST', path: /^\/api\/auth\/reset-password$/ },
  { method: 'GET', path: /^\/api\/branding$/ },
  { method: 'GET', path: /^\/api\/branding\/background$/ },
  { method: 'GET', path: /^\/api\/files\/[0-9a-f-]+\/avatar$/ },
  { method: 'PUT', path: /^\/api\/files\/sessions\/[0-9a-f-]+\/upload$/i },
];

/** Global guard: every route requires a valid session except the whitelist. */
@Injectable()
export class GlobalAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithSession>();
    const res = context.switchToHttp().getResponse();
    const method = req.method.toUpperCase();
    const rawPath = req.path ?? req.url;
    const path = rawPath.split('?')[0];

    const isPublic = PUBLIC_ROUTES.some(
      (r) => (r.method === method || (method === 'HEAD' && r.method === 'GET')) && r.path.test(path)
    );
    if (isPublic) {
      return true;
    }

    const resolved = await resolveRequestSession(req, res);
    if (!resolved) {
      throw new UnauthorizedException('Not authenticated');
    }
    if (resolved.identity.must_change_password) {
      const allowed =
        path.startsWith('/api/auth/set-password') ||
        path.startsWith('/api/auth/me') ||
        path.startsWith('/api/auth/csrf') ||
        path.startsWith('/api/auth/logout');
      if (!allowed) {
        throw new UnauthorizedException('Password change required before accessing the application');
      }
    }
    req.identity = resolved.identity;
    req.sessionId = resolved.session.sessionId;
    return true;
  }
}
