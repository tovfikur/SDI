import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { RequestIdMiddleware } from './request-id.middleware';

function makeReq(headers: Record<string, string | undefined>): Request {
  return { header: (name: string) => headers[name] } as Request;
}

describe('RequestIdMiddleware (Phase 6 X-Request-Id contract)', () => {
  it('generates a request id when the header is absent', () => {
    const req = makeReq({});
    const next = vi.fn();
    new RequestIdMiddleware().use(req, {} as Response, next);

    expect((req as { requestId: string }).requestId).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('passes through a valid incoming request id', () => {
    const req = makeReq({ 'x-request-id': '11111111-2222-3333-4444-555555555555' });
    const next = vi.fn();
    new RequestIdMiddleware().use(req, {} as Response, next);

    expect((req as { requestId: string }).requestId).toBe(
      '11111111-2222-3333-4444-555555555555',
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replaces an invalid incoming value with a generated id', () => {
    const req = makeReq({ 'x-request-id': 'not-a-uuid' });
    const next = vi.fn();
    new RequestIdMiddleware().use(req, {} as Response, next);

    expect((req as { requestId: string }).requestId).not.toBe('not-a-uuid');
    expect((req as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(next).toHaveBeenCalledTimes(1);
  });
});