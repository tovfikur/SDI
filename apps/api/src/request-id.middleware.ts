import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { generateRequestId, isValidRequestId, REQUEST_ID_HEADER } from '@jsk/shared-kernel';

export interface RequestWithId extends Request {
  requestId: string;
}

/**
 * Phase 6 contract: every request gets an X-Request-Id (generated if absent), propagated
 * into logs and Activity Log entries. The header is accepted only as a correlation
 * identifier — it is never trusted for logic.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const headerValue = req.header(REQUEST_ID_HEADER);
    const requestId =
      headerValue !== undefined && isValidRequestId(headerValue)
        ? headerValue
        : generateRequestId();
    (req as RequestWithId).requestId = requestId;
    next();
  }
}
