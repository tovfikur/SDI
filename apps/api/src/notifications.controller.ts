import { Controller, Get, Post, HttpCode, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  countUnreadNotifications,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@jsk/domain-notifications';
import type { RequestWithSession } from './auth/session';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import for Nest DI
import { NotificationsGateway } from './notifications.gateway';

/** The global guard always populates identity for non-public routes. */
function identityOf(req: RequestWithSession): { id: string } {
  if (!req.identity) {
    throw new Error('Missing authenticated identity');
  }
  return req.identity;
}

/**
 * User-scoped in-app notifications. Every handler resolves the recipient from
 * the authenticated session — a user can only ever see/mutate their own rows.
 */
@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly gateway: NotificationsGateway) {}

  @Get('my')
  async mine(@Req() req: RequestWithSession, @Query() q: Record<string, string>) {
    const page = q['page'] ? Math.max(1, parseInt(q['page'], 10)) : 1;
    const perPage = q['perPage'] ? Math.max(1, parseInt(q['perPage'], 10)) : 10;
    const data = await listMyNotifications({ userId: identityOf(req).id, page, per_page: perPage });
    return { success: true, data };
  }

  @Get('my/unread-count')
  async unreadCount(@Req() req: RequestWithSession) {
    return { success: true, data: { count: await countUnreadNotifications(identityOf(req).id) } };
  }

  @Post('my/read-all')
  @HttpCode(200)
  async readAll(@Req() req: RequestWithSession) {
    return { success: true, data: { updated: await markAllNotificationsRead(identityOf(req).id) } };
  }

  @Post('my/:id/read')
  @HttpCode(200)
  async markRead(@Req() req: RequestWithSession, @Param('id') id: string) {
    const updated = await markNotificationRead(identityOf(req).id, id);
    return { success: true, data: { updated } };
  }

  /** Authenticated SSE stream for the current user. Reconnects natively. */
  @Get('stream')
  async stream(@Req() req: RequestWithSession, @Res() res: Response): Promise<void> {
    const userId = identityOf(req).id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`event: connected\ndata: {"userId":"${userId}"}\n\n`);

    const unsubscribe = this.gateway.subscribe(userId, res);
    const ping = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        clearInterval(ping);
        unsubscribe();
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  }
}