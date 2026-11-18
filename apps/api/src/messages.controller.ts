import {
  Body,
  Controller,
  Delete,
  BadRequestException,
  ForbiddenException,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  addMembers,
  createGroup,
  deleteConversation,
  deleteMessage,
  editMessage,
  getConversation,
  getOrCreateDirect,
  leaveConversation,
  listConversations,
  listMessages,
  markRead,
  removeMember,
  renameGroup,
  searchUsers,
  sendMessage,
  setMemberRole,
  setMuted,
  toggleReaction,
  unreadTotal,
  MAX_MESSAGE_LENGTH,
} from '@jsk/domain-messages';
import { createUploadSession, confirmUpload, getDownloadUrl, streamFile, FilesError } from '@jsk/domain-files';
import { query } from '@jsk/shared-kernel';
import type { RequestWithSession } from './auth/session';
import { MessagesGateway } from './messages.gateway';
import { contentDisposition, proxyUploadUrl, requestOrigin } from './file-urls';

const MESSAGING_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** The global guard always populates identity for non-public routes. */
function identityOf(req: RequestWithSession): { id: string } {
  if (!req.identity) {
    throw new Error('Missing authenticated identity');
  }
  return req.identity;
}

function bad(err: unknown): never {
  if (err instanceof FilesError) {
    throw new HttpException(err.message, 400);
  }
  const msg = err instanceof Error ? err.message : 'Unexpected error';
  if (msg.includes('not a participant')) throw new ForbiddenException(msg);
  throw new BadRequestException(msg);
}

function intParam(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

@Controller('api/messages')
export class MessagesController {
  constructor(private readonly gateway: MessagesGateway) {}

  private me(req: RequestWithSession): string {
    return identityOf(req).id;
  }

  /* ── Real-time stream (authenticated SSE; audience enforced by domain) ── */

  @Get('stream')
  async stream(@Req() req: RequestWithSession, @Res() res: Response): Promise<void> {
    const userId = this.me(req);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`event: connected\ndata: {"userId":"${userId}"}\n\n`);
    const unsubscribe = this.gateway.subscribe(userId, res);
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
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

  /* ── Conversations ────────────────────────────────────────────────────── */

  @Get('conversations')
  async conversations(
    @Req() req: RequestWithSession,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string
  ) {
    try {
      return {
        success: true,
        data: await listConversations(this.me(req), {
          page: intParam(page, 1),
          perPage: intParam(perPage, 30),
        }),
      };
    } catch (err) {
      bad(err);
    }
  }

  @Post('direct')
  async startDirect(@Req() req: RequestWithSession, @Body() body: { userId?: string }) {
    try {
      if (!body?.userId) throw new BadRequestException('userId is required');
      const id = await getOrCreateDirect(this.me(req), body.userId);
      return { success: true, data: { id } };
    } catch (err) {
      bad(err);
    }
  }

  @Post('groups')
  async createGroupRoute(
    @Req() req: RequestWithSession,
    @Body() body: { name?: string; memberIds?: string[] }
  ) {
    try {
      if (!body?.name) throw new BadRequestException('name is required');
      const id = await createGroup(this.me(req), body.name, Array.isArray(body.memberIds) ? body.memberIds : []);
      return { success: true, data: { id } };
    } catch (err) {
      bad(err);
    }
  }

  @Get('conversations/:id')
  async conversation(@Req() req: RequestWithSession, @Param('id') id: string) {
    try {
      return { success: true, data: await getConversation(this.me(req), id) };
    } catch (err) {
      bad(err);
    }
  }

  @Patch('conversations/:id')
  async patchConversation(
    @Req() req: RequestWithSession,
    @Param('id') id: string,
    @Body() body: { name?: string; muted?: boolean }
  ) {
    try {
      const userId = this.me(req);
      if (typeof body?.name === 'string') await renameGroup(userId, id, body.name);
      else if (typeof body?.muted === 'boolean') await setMuted(userId, id, body.muted);
      else throw new BadRequestException('Nothing to update');
      return { success: true, data: { updated: true } };
    } catch (err) {
      bad(err);
    }
  }

  /** Owner-only soft delete of a group. */
  @Delete('conversations/:id')
  async deleteConversationRoute(@Req() req: RequestWithSession, @Param('id') id: string) {
    try {
      return { success: true, data: { deleted: await deleteConversation(this.me(req), id) } };
    } catch (err) {
      bad(err);
    }
  }

  /* ── Members ──────────────────────────────────────────────────────────── */

  @Get('conversations/:id/members')
  async members(@Req() req: RequestWithSession, @Param('id') id: string) {
    try {
      const detail = await getConversation(this.me(req), id);
      return { success: true, data: detail.members };
    } catch (err) {
      bad(err);
    }
  }

  @Post('conversations/:id/members')
  async addMembersRoute(
    @Req() req: RequestWithSession,
    @Param('id') id: string,
    @Body() body: { userIds?: string[] }
  ) {
    try {
      const ids = Array.isArray(body?.userIds) ? body.userIds : [];
      const added = await addMembers(this.me(req), id, ids);
      return { success: true, data: { added } };
    } catch (err) {
      bad(err);
    }
  }

  @Delete('conversations/:id/members/:userId')
  async removeMemberRoute(
    @Req() req: RequestWithSession,
    @Param('id') id: string,
    @Param('userId') targetUserId: string
  ) {
    try {
      await removeMember(this.me(req), id, targetUserId);
      return { success: true, data: { removed: true } };
    } catch (err) {
      bad(err);
    }
  }

  @Patch('conversations/:id/members/:userId/role')
  async setRoleRoute(
    @Req() req: RequestWithSession,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() body: { role?: 'admin' | 'member' | 'owner' }
  ) {
    try {
      await setMemberRole(this.me(req), id, targetUserId, body?.role ?? 'member');
      return { success: true, data: { updated: true } };
    } catch (err) {
      bad(err);
    }
  }

  @Post('conversations/:id/leave')
  async leave(@Req() req: RequestWithSession, @Param('id') id: string) {
    try {
      await leaveConversation(this.me(req), id);
      return { success: true, data: { left: true } };
    } catch (err) {
      bad(err);
    }
  }

  /* ── Messages ─────────────────────────────────────────────────────────── */

  @Get('conversations/:id/messages')
  async messages(
    @Req() req: RequestWithSession,
    @Param('id') id: string,
    @Query('beforeSeq') beforeSeq?: string,
    @Query('limit') limit?: string
  ) {
    try {
      return {
        success: true,
        data: await listMessages(this.me(req), id, {
          beforeSeq: Number(beforeSeq),
          limit: intParam(limit, 50),
        }),
      };
    } catch (err) {
      bad(err);
    }
  }

  @Post('conversations/:id/messages')
  async send(
    @Req() req: RequestWithSession,
    @Param('id') id: string,
    @Body() body: { body?: string; fileIds?: string[] }
  ) {
    try {
      if (!body || typeof body.body !== 'string' || body.body.trim().length === 0) {
        throw new BadRequestException('Message body is required');
      }
      if (body.body.length > MAX_MESSAGE_LENGTH) {
        throw new BadRequestException(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
      }
      const msg = await sendMessage(
        this.me(req),
        id,
        body.body,
        Array.isArray(body.fileIds) ? body.fileIds : []
      );
      return { success: true, data: msg };
    } catch (err) {
      bad(err);
    }
  }

  @Patch('messages/:messageId')
  async edit(@Req() req: RequestWithSession, @Param('messageId') messageId: string, @Body() body: { body?: string }) {
    try {
      if (!body || typeof body.body !== 'string' || body.body.trim().length === 0) {
        throw new BadRequestException('Message body is required');
      }
      return { success: true, data: await editMessage(this.me(req), messageId, body.body) };
    } catch (err) {
      bad(err);
    }
  }

  @Delete('messages/:messageId')
  async deleteMsg(@Req() req: RequestWithSession, @Param('messageId') messageId: string) {
    try {
      return { success: true, data: { deleted: await deleteMessage(this.me(req), messageId) } };
    } catch (err) {
      bad(err);
    }
  }

  @Post('messages/:messageId/reactions')
  async react(
    @Req() req: RequestWithSession,
    @Param('messageId') messageId: string,
    @Body() body: { emoji?: string }
  ) {
    try {
      if (!body?.emoji) throw new BadRequestException('emoji is required');
      const result = await toggleReaction(this.me(req), messageId, body.emoji);
      return { success: true, data: { reaction: result } };
    } catch (err) {
      bad(err);
    }
  }

  /* ── Read state ───────────────────────────────────────────────────────── */

  @Post('conversations/:id/read')
  async read(@Req() req: RequestWithSession, @Param('id') id: string) {
    try {
      const remaining = await markRead(this.me(req), id);
      return { success: true, data: { unread: remaining } };
    } catch (err) {
      bad(err);
    }
  }

  @Get('unread-count')
  async unreadCount(@Req() req: RequestWithSession) {
    try {
      return { success: true, data: { count: await unreadTotal(this.me(req)) } };
    } catch (err) {
      bad(err);
    }
  }

  /* ── User discovery ───────────────────────────────────────────────────── */

  @Get('users/search')
  async userSearch(@Req() req: RequestWithSession, @Query('q') q?: string, @Query('limit') limit?: string) {
    return {
      success: true,
      data: await searchUsers(this.me(req), typeof q === 'string' ? q : '', intParam(limit, 20)),
    };
  }

  /* ── Attachments (reuses the existing files/storage pipeline safely) ──── */

  @Post('attachments/sessions')
  async createAttachmentSession(
    @Req() req: RequestWithSession,
    @Body()
    body: { original_filename?: string; mime_type?: string; size_bytes?: number }
  ) {
    try {
      if (!body?.original_filename) throw new BadRequestException('original_filename is required');
      const size = Number(body.size_bytes ?? 0);
      if (!Number.isFinite(size) || size < 0 || size > MESSAGING_MAX_UPLOAD_BYTES) {
        throw new BadRequestException(`Attachments are limited to ${MESSAGING_MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
      }
      const session = await createUploadSession({
        module: 'messaging',
        entity_type: 'message_attachment',
        original_filename: String(body.original_filename).slice(0, 255),
        mime_type: body.mime_type ? String(body.mime_type).slice(0, 100) : undefined,
        size_bytes: Math.floor(size),
        uploaded_by: this.me(req),
      });
      return { success: true, ...session, upload_url: proxyUploadUrl(req, session.session_id) };
    } catch (err) {
      bad(err);
    }
  }

  @Post('attachments/confirm')
  async confirmAttachment(
    @Req() req: RequestWithSession,
    @Body() body: { sessionId?: string }
  ) {
    try {
      if (!body?.sessionId) throw new BadRequestException('sessionId is required');
      const file = await confirmUpload(body.sessionId, this.me(req));
      return { success: true, data: file ? { id: file.id, filename: file.original_filename } : null };
    } catch (err) {
      bad(err);
    }
  }

  private async assertAttachmentAccess(req: RequestWithSession, fileIdRaw: string): Promise<string> {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(fileIdRaw)) throw new BadRequestException('fileId must be a valid uuid');
    // Membership check: the file must be attached to a message in one of my
    // conversations. Single parameterized query; the files table itself has
    // no ACLs so messaging enforces access here.
    const fileId = fileIdRaw.toLowerCase();
    const { rows } = await query<{ ok: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM message_attachments ma
         JOIN messages m ON m.id = ma.message_id
         JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
         WHERE ma.file_id = $1 AND cm.user_id = $2 AND cm.left_at IS NULL
       ) AS ok`,
      [fileId, this.me(req)]
    );
    if (!rows[0]?.ok) throw new ForbiddenException('You cannot access this attachment');
    return fileId;
  }

  /**
   * Secure attachment download: only conversation members get a link. Bytes are
   * streamed through the API (storage is internal-only).
   */
  @Get('files/:fileId/download')
  async downloadAttachment(@Req() req: RequestWithSession, @Param('fileId') fileIdRaw: string) {
    try {
      const fileId = await this.assertAttachmentAccess(req, fileIdRaw);
      const dl = await getDownloadUrl(fileId);
      return {
        success: true,
        data: { url: `${requestOrigin(req)}/api/messages/files/${fileId}/content`, filename: dl.filename },
      };
    } catch (err) {
      bad(err);
    }
  }

  @Get('files/:fileId/content')
  async attachmentContent(
    @Req() req: RequestWithSession,
    @Param('fileId') fileIdRaw: string,
    @Res() res: Response
  ): Promise<void> {
    const fileId = await this.assertAttachmentAccess(req, fileIdRaw);
    const file = await streamFile(fileId);
    if (!file) throw new NotFoundException('File not found');
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(file.mime_type || '', file.original_filename));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    file.stream.pipe(res);
  }
}
