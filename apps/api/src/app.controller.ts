import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestWithId } from './request-id.middleware';

export interface HealthResponse {
  status: 'ok';
  service: 'api';
  requestId: string;
}

@Controller()
export class AppController {
  @Get('health')
  getHealth(@Req() req: Request): HealthResponse {
    const { requestId } = req as RequestWithId;
    return { status: 'ok', service: 'api', requestId };
  }

  @Get('api/health')
  getApiHealth(@Req() req: Request): HealthResponse {
    const { requestId } = req as RequestWithId;
    return { status: 'ok', service: 'api', requestId };
  }
}
