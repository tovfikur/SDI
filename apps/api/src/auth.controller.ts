import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException, BadRequestException, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createSession, hashPassword, verifyPassword, revokeSession, revokeAllSessionsForUser } from '@jsk/shared-auth';
import { query } from '@jsk/shared-kernel';
import { sendEmail } from '@jsk/domain-notifications';
import { randomInt } from 'crypto';
import { clearSessionCookies, setSessionCookies, resolveRequestSession } from './auth/session';
import type { RequestWithSession } from './auth/session';

const LOGIN_ATTEMPTS = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

const RESET_REQUESTS = new Map<string, { count: number; last: number }>();
const RESET_REQUEST_COOLDOWN_MS = 60 * 1000;
const RESET_REQUEST_MAX_PER_HOUR = 5;
const RESET_VERIFY_ATTEMPTS = new Map<string, { count: number; until: number }>();
const RESET_MAX_VERIFY_ATTEMPTS = 5;
const RESET_VERIFY_LOCK_MS = 10 * 60 * 1000;
const RESET_CODE_TTL_MS = 10 * 60 * 1000;

interface PublicUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  employeeId: string | null;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
}

function toPublicUser(identity: { id: string; username: string; email: string; full_name: string; is_super_admin: boolean; employee_id: string | null; must_change_password: boolean; roles: string[]; permissions: string[] }): PublicUser {
  return {
    id: identity.id,
    username: identity.username,
    email: identity.email,
    fullName: identity.full_name,
    isSuperAdmin: identity.is_super_admin,
    employeeId: identity.employee_id,
    mustChangePassword: identity.must_change_password,
    roles: identity.roles,
    permissions: identity.permissions,
  };
}

@Controller('api/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { username?: string; password?: string },
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const { username, password } = body ?? {};
    const identifier = (username ?? '').trim();
    if (!identifier || !password) {
      throw new BadRequestException('Username and password are required');
    }

    const ip = req.ip ?? 'unknown';
    const key = `${ip}:${identifier.toLowerCase()}`;
    const state = LOGIN_ATTEMPTS.get(key);
    if (state && state.until > Date.now()) {
      throw new UnauthorizedException('Too many attempts — try again in a few minutes');
    }

    const { rows } = await query<{
      id: string;
      username: string;
      email: string;
      full_name: string;
      password_hash: string;
      is_super_admin: boolean;
      is_active: boolean;
      employee_id: string | null;
      must_change_password: boolean;
    }>(
      `SELECT u.id, u.username, u.email, u.full_name, u.password_hash, u.is_super_admin, u.is_active, u.employee_id, u.must_change_password
         FROM users u
         LEFT JOIN employees e ON e.id = u.employee_id
        WHERE (lower(u.username) = lower($1) OR lower(u.email) = lower($1) OR lower(e.employee_code) = lower($1))
          AND u.deleted_at IS NULL
          AND (e.id IS NULL OR e.status != 'deleted')
        ORDER BY
          (lower(u.username) = lower($1)) DESC,
          (lower(u.email) = lower($1)) DESC,
          u.created_at ASC
        LIMIT 1`,
      [identifier]
    );

    if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash) || !rows[0].is_active) {
      const current = LOGIN_ATTEMPTS.get(key);
      const count = (current?.count ?? 0) + 1;
      if (count >= MAX_ATTEMPTS) {
        LOGIN_ATTEMPTS.set(key, { count, until: Date.now() + LOCK_MS });
      } else {
        LOGIN_ATTEMPTS.set(key, { count, until: 0 });
      }
      this.logger.warn(`failed login attempt for "${identifier}" from ${ip}`);
      throw new UnauthorizedException('Invalid credentials');
    }
    LOGIN_ATTEMPTS.delete(key);
    LOGIN_ATTEMPTS.delete(`${ip}:${rows[0].username.toLowerCase()}`);
    if (rows[0].email) {
      LOGIN_ATTEMPTS.delete(`${ip}:${rows[0].email.toLowerCase()}`);
    }

    const user = rows[0];
    const session = await createSession(user.id, req.headers['user-agent'] ?? 'unknown', ip);
    setSessionCookies(res, session.token, session.csrf_token);

    const { loadIdentity } = await import('@jsk/shared-auth');
    const identity = await loadIdentity(user.id);
    if (!identity) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return res.status(HttpStatus.OK).json({ success: true, user: toPublicUser(identity), mustChangePassword: identity.must_change_password });
  }

  @Get('me')
  async me(@Req() req: Request, @Res() res: Response): Promise<Response> {
    const resolved = await resolveRequestSession(req, res);
    if (!resolved) {
      return res.status(HttpStatus.OK).json({ authenticated: false });
    }
    return res.status(HttpStatus.OK).json({ authenticated: true, user: toPublicUser(resolved.identity) });
  }

  @Get('csrf')
  @HttpCode(HttpStatus.OK)
  async csrf(@Req() req: RequestWithSession, @Res() res: Response): Promise<Response> {
    const resolved = await resolveRequestSession(req, res);
    if (!resolved) {
      throw new UnauthorizedException('Not authenticated');
    }
    return res.status(HttpStatus.OK).json({ csrfToken: resolved.session.csrfToken });
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: RequestWithSession, @Res() res: Response): Promise<Response> {
    const resolved = await resolveRequestSession(req);
    if (resolved) {
      await revokeSession(resolved.session.sessionId);
    }
    clearSessionCookies(res);
    return res.status(HttpStatus.OK).json({ success: true });
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() body: { currentPassword?: string; newPassword?: string },
    @Req() req: RequestWithSession,
    @Res() res: Response
  ): Promise<Response> {
    const resolved = await resolveRequestSession(req, res);
    if (!resolved) {
      throw new UnauthorizedException('Not authenticated');
    }
    const { currentPassword, newPassword } = body ?? {};
    if (!currentPassword || !newPassword) {
      throw new BadRequestException('currentPassword and newPassword are required');
    }
    if (newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }
    const { rows } = await query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [resolved.identity.id]);
    if (rows.length === 0 || !verifyPassword(currentPassword, rows[0].password_hash)) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const newHash = hashPassword(newPassword);
    await query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [resolved.identity.id, newHash]);
    await revokeAllSessionsForUser(resolved.identity.id, resolved.session.sessionId);
    return res.status(HttpStatus.OK).json({ success: true });
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() body: { email?: string }, @Req() req: Request, @Res() res: Response): Promise<Response> {
    const email = (body?.email ?? '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('A valid email is required');
    }
    const ip = req.ip ?? 'unknown';
    const key = `${email}|${ip}`;
    const state = RESET_REQUESTS.get(key);
    const now = Date.now();
    if (state) {
      if (state.count >= RESET_REQUEST_MAX_PER_HOUR) {
        throw new HttpException('Too many reset requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
      }
      if (state.last + RESET_REQUEST_COOLDOWN_MS > now) {
        throw new HttpException('Please wait before requesting another code.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    const { rows } = await query<{ id: string; email: string; full_name: string }>(
      'SELECT id, email, full_name FROM users WHERE lower(email) = $1 AND deleted_at IS NULL AND is_active = true',
      [email]
    );
    const user = rows[0];

    if (user) {
      const code = String(randomInt(100000, 1000000));
      const tokenHash = hashPassword(code);
      await query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + ($3 || ' seconds')::interval)`,
        [user.id, tokenHash, Math.floor(RESET_CODE_TTL_MS / 1000)]
      );
      await query(
        `UPDATE password_reset_tokens SET used_at = now()
          WHERE user_id = $1 AND used_at IS NULL AND expires_at > now() AND id <> (
            SELECT id FROM password_reset_tokens
             WHERE user_id = $1 AND expires_at > now() AND used_at IS NULL
             ORDER BY created_at DESC LIMIT 1
          )`,
        [user.id]
      );
      try {
        const sent = await sendEmail({
          to: user.email,
          subject: 'SDI — Password reset code',
          text: `Your SDI password reset code is ${code}. It expires in 10 minutes.`,
        });
        if (!sent) {
          this.logger.log(`[password-reset] code for ${user.email}: ${code}`);
        }
      } catch (error) {
        this.logger.warn(`[password-reset] email failed for ${user.email}: ${(error as Error).message}`);
        if ((process.env.NODE_ENV ?? 'development') === 'development') {
          this.logger.log(`[password-reset] code for ${user.email}: ${code}`);
        }
      }
    }

    RESET_REQUESTS.set(key, { count: (state?.count ?? 0) + 1, last: now });
    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'If that email exists, a verification code has been sent.',
    });
  }

  @Post('verify-reset-code')
  @HttpCode(HttpStatus.OK)
  async verifyResetCode(@Body() body: { email?: string; code?: string }, @Res() res: Response): Promise<Response> {
    const email = (body?.email ?? '').trim().toLowerCase();
    const code = (body?.code ?? '').trim();
    if (!email || !/^\d{6}$/.test(code)) {
      throw new BadRequestException('Email and a 6-digit code are required');
    }

    const key = email;
    const attempts = RESET_VERIFY_ATTEMPTS.get(key);
    if (attempts && attempts.until > Date.now()) {
      throw new HttpException('Too many attempts. Request a new code.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const { rows } = await query<{ id: string }>(
      'SELECT id FROM users WHERE lower(email) = $1 AND deleted_at IS NULL AND is_active = true',
      [email]
    );
    if (rows.length === 0) {
      throw new BadRequestException('Invalid or expired code');
    }

    const { rows: tokens } = await query<{ id: string; token_hash: string; expires_at: Date }>(
      `SELECT id, token_hash, expires_at
         FROM password_reset_tokens
        WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`,
      [rows[0].id]
    );
    const token = tokens[0];

    if (!token || !verifyPassword(code, token.token_hash)) {
      const count = (attempts?.count ?? 0) + 1;
      if (count >= RESET_MAX_VERIFY_ATTEMPTS) {
        RESET_VERIFY_ATTEMPTS.set(key, { count, until: Date.now() + RESET_VERIFY_LOCK_MS });
        await query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1::uuid`, [token?.id ?? '00000000-0000-0000-0000-000000000000']);
      } else {
        RESET_VERIFY_ATTEMPTS.set(key, { count, until: 0 });
      }
      throw new BadRequestException('Invalid or expired code');
    }

    await query(`UPDATE password_reset_tokens SET verified_at = now() WHERE id = $1::uuid`, [token.id]);
    return res.status(HttpStatus.OK).json({ success: true });
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() body: { email?: string; code?: string; newPassword?: string },
    @Res() res: Response
  ): Promise<Response> {
    const email = (body?.email ?? '').trim().toLowerCase();
    const code = (body?.code ?? '').trim();
    const newPassword = body?.newPassword ?? '';
    if (!email || !/^\d{6}$/.test(code)) {
      throw new BadRequestException('Email and a 6-digit code are required');
    }
    if (newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }

    const { rows } = await query<{ id: string }>(
      'SELECT id FROM users WHERE lower(email) = $1 AND deleted_at IS NULL AND is_active = true',
      [email]
    );
    if (rows.length === 0) {
      throw new BadRequestException('Invalid or expired code');
    }

    const { rows: tokens } = await query<{ id: string; token_hash: string; verified_at: Date | null }>(
      `SELECT id, token_hash, verified_at
         FROM password_reset_tokens
        WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`,
      [rows[0].id]
    );
    const token = tokens[0];

    if (!token || !token.verified_at || !verifyPassword(code, token.token_hash)) {
      throw new BadRequestException('Invalid or expired code');
    }

    const newHash = hashPassword(newPassword);
    await query(
      `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
      [rows[0].id, newHash]
    );
    await query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1::uuid`, [token.id]);
    await revokeAllSessionsForUser(rows[0].id);
    RESET_VERIFY_ATTEMPTS.delete(email);
    return res.status(HttpStatus.OK).json({ success: true });
  }

  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  async setPassword(
    @Body() body: { newPassword?: string },
    @Req() req: RequestWithSession,
    @Res() res: Response
  ): Promise<Response> {
    const resolved = await resolveRequestSession(req, res);
    if (!resolved) {
      throw new UnauthorizedException('Not authenticated');
    }
    if (!resolved.identity.must_change_password) {
      throw new BadRequestException('Password change is not required for this account.');
    }
    const newPassword = body?.newPassword ?? '';
    if (newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }
    const newHash = hashPassword(newPassword);
    await query(
      `UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now()
        WHERE id = $1`,
      [resolved.identity.id, newHash]
    );
    return res.status(HttpStatus.OK).json({ success: true });
  }

  @Get('sessions')
  @HttpCode(HttpStatus.OK)
  async sessions(@Req() req: RequestWithSession, @Res() res: Response): Promise<Response> {
    const resolved = await resolveRequestSession(req, res);
    if (!resolved) {
      throw new UnauthorizedException('Not authenticated');
    }
    const { listSessionsForUser } = await import('@jsk/shared-auth');
    const sessions = await listSessionsForUser(resolved.identity.id);
    return res.status(HttpStatus.OK).json({ data: sessions });
  }

  @Get('revoke-others')
  @HttpCode(HttpStatus.OK)
  async revokeOthers(@Req() req: RequestWithSession, @Res() res: Response): Promise<Response> {
    const resolved = await resolveRequestSession(req, res);
    if (!resolved) {
      throw new UnauthorizedException('Not authenticated');
    }
    await revokeAllSessionsForUser(resolved.identity.id, resolved.session.sessionId);
    return res.status(HttpStatus.OK).json({ success: true });
  }
}
