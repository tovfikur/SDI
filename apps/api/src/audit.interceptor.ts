/**
 * Automatic audit interceptor (Spec Phase 24 / ADR-004).
 *
 * Records every state-changing request (POST/PUT/PATCH/DELETE) into `activity_logs`
 * with the authenticated actor, a human-readable action name derived from the route,
 * the created/updated entity id (extracted from the response body when available),
 * and a redacted copy of the payload. Audit failures never break the primary operation.
 */

import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { catchError, map, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import { writeActivity } from '@jsk/domain-audit';
import type { RequestWithSession } from './auth/session';
import { REQUEST_ID_HEADER } from '@jsk/shared-kernel';

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'currentPassword',
  'newPassword',
  'session_token',
  'csrf_token',
  'token',
  'secret',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function actionName(method: string, path: string): string {
  const clean = path.replace(/\/api\//, '').replace(/\/+$/, '');
  const segments = clean
    .split('/')
    .filter((s) => s && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s));
  const verb =
    { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }[method] ??
    method.toLowerCase();
  const target = segments.length > 0 ? segments.join('.').replace(/-/g, '_') : clean;
  return `${verb}.${target}`;
}

function extractEntityId(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const candidate = (body as Record<string, unknown>).data;
  if (candidate && typeof candidate === 'object') {
    const id = (candidate as Record<string, unknown>).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  const own = (body as Record<string, unknown>).id;
  return typeof own === 'string' && own.length > 0 ? own : undefined;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestWithSession>();
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (
      path === '/health' ||
      path === '/api/health' ||
      path.startsWith('/api/auth/login') ||
      path.startsWith('/api/audit') ||
      path.startsWith('/api/files') ||
      // Chat messages are high-frequency personal communication; group-level
      // admin actions are audited explicitly inside the messaging domain.
      path.startsWith('/api/messages') ||
      // High-frequency GPS pings are not meaningful audit events; the real
      // punches (check-in/check-out) are still audited.
      path === '/api/field-tracking/location' ||
      path === '/api/field-tracking/locations/batch'
    ) {
      return next.handle();
    }
    const body = redact(req.body ?? {});
    const requestId =
      (req as unknown as { requestId?: string }).requestId ??
      req.header(REQUEST_ID_HEADER) ??
      undefined;

    return next.handle().pipe(
      map((responseBody: unknown) => {
        const entityType = path.replace(/\/api\//, '').split('/')[0] ?? 'unknown';
        const description = `${method} ${path}`;
        const entityId = extractEntityId(responseBody);
        void writeActivity({
          actor_user_id: req.identity?.id ?? null,
          log_name: actionName(method, path),
          description,
          entity_type: entityType,
          entity_id: entityId ?? null,
          after_value: body,
          request_id: requestId ?? null,
        }).catch(() => {
          /* audit must never break the primary operation */
        });
        return responseBody;
      }),
      catchError((err: unknown) => {
        return throwError(() => err);
      })
    );
  }
}
