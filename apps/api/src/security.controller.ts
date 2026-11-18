/**
 * Security settings (Admin Delete Protection): Set/Change the global Delete
 * Password. Only the scrypt hash is stored; plaintext is never persisted or
 * returned.
 */

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { hashPassword, isAdminUser } from '@jsk/shared-auth';
import { query } from '@jsk/shared-kernel';
import { SessionGuard, withIdentity } from './auth/guards';
import type { RequestWithSession } from './auth/session';

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;

@Controller('api/security')
export class SecurityController {
  @Get('delete-password')
  @UseGuards(SessionGuard)
  async deletePasswordStatus(@Req() req: RequestWithSession): Promise<{
    success: boolean;
    data: { configured: boolean; updated_at: string | null };
  }> {
    const identity = withIdentity(req);
    if (!isAdminUser(identity)) {
      throw new ForbiddenException('DELETE_REQUIRES_ADMIN');
    }
    const { rows } = await query<{ updated_at: string }>(
      'SELECT updated_at FROM delete_password_settings WHERE id = true'
    );
    return {
      success: true,
      data: { configured: rows.length > 0, updated_at: rows[0]?.updated_at ?? null },
    };
  }

  @Post('delete-password')
  @UseGuards(SessionGuard)
  async setDeletePassword(
    @Req() req: RequestWithSession,
    @Body() body: { password?: unknown }
  ): Promise<{ success: boolean; data: { configured: true; updated_at: string } }> {
    const identity = withIdentity(req);
    if (!isAdminUser(identity)) {
      throw new ForbiddenException('DELETE_REQUIRES_ADMIN');
    }
    const password = typeof body?.password === 'string' ? body.password : '';
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      throw new BadRequestException(
        `Delete password must be between ${MIN_PASSWORD} and ${MAX_PASSWORD} characters.`
      );
    }
    const hash = hashPassword(password);
    const { rows } = await query<{ updated_at: string }>(
      `INSERT INTO delete_password_settings (id, password_hash, updated_by, updated_at)
       VALUES (true, $1, $2, now())
       ON CONFLICT (id) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING updated_at`,
      [hash, identity.id]
    );
    return { success: true, data: { configured: true, updated_at: rows[0].updated_at } };
  }
}