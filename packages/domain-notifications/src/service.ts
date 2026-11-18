/**
 * Notifications domain (Spec Phase 14 / MI-03, feature-flagged): DB-backed
 * delivery queue consumed by the worker. Channels are pluggable; the default
 * email channel sends via SMTP (Mailpit in dev). Flag `NOTIFICATIONS_ENABLED`
 * to activate.
 */

import { query, list } from '@jsk/shared-kernel';
import type { PaginatedResponse } from '@jsk/shared-kernel';
import type { FilterParam } from '@jsk/shared-kernel';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string | undefined;
  pass?: string | undefined;
  from: string;
  ssl?: boolean | undefined;
}

export type DeliveryChannel = 'email' | 'in_app';

interface Renderer {
  (template: string, context: Record<string, unknown>): string;
}

let transporter: Transporter | null = null;
let smtpFrom = 'jsk@example.com';
let renderTemplate: Renderer = (template, context) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(context[key] ?? ''));

/** Registered by the API layer so in-app deliveries are pushed to the SSE hub. */
export type InAppPushHandler = (delivery: {
  id: string;
  recipient_user_id: string;
  title: string;
  message: string | null;
  action_url: string | null;
  event_type: string;
  created_at: string;
}) => void;

let inAppPushHandler: InAppPushHandler | null = null;

export function setInAppPushHandler(fn: InAppPushHandler | null): void {
  inAppPushHandler = fn;
}

export interface InAppNotificationRow {
  id: string;
  recipient_user_id: string;
  title: string;
  message: string | null;
  action_url: string | null;
  event_type: string;
  created_at: string;
  read_at: string | null;
}

/** Persist an in-app notification and push it to the recipient's SSE stream (if any). */
export async function enqueueInAppNotification(input: {
  recipient_user_id: string;
  title: string;
  message?: string;
  action_url?: string;
  event_type: string;
}): Promise<InAppNotificationRow> {
  const { rows } = await query<InAppNotificationRow>(
    `INSERT INTO notification_deliveries
       (event_type, recipient_user_id, template, channel, status, sent_at, title, message, action_url)
     VALUES ($1, $2, $3, 'in_app', 'sent', now(), $4, $5, $6)
     RETURNING id, recipient_user_id, title, message, action_url, event_type, created_at, read_at`,
    [
      input.event_type,
      input.recipient_user_id,
      input.title,
      input.title,
      input.message ?? null,
      input.action_url ?? null,
    ]
  );
  const row = rows[0];
  if (row && inAppPushHandler) {
    try {
      inAppPushHandler(row);
    } catch {
      /* SSE push failures must never break the caller */
    }
  }
  return row;
}

export function configureMail(smtp: SmtpConfig): void {
  smtpFrom = smtp.from;
  transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.ssl ?? false,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? '' } : undefined,
  });
}

export function setTemplateRenderer(fn: Renderer): void {
  renderTemplate = fn;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ delivered: boolean; messageId?: string }> {
  if (!transporter) {
    return { delivered: false };
  }
  const info = await transporter.sendMail({
    from: smtpFrom,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  return { delivered: true, messageId: info.messageId };
}

export async function enqueueNotification(input: {
  event_type: string;
  recipient_user_id?: string;
  recipient_email?: string;
  template: string;
  context?: Record<string, unknown>;
  channel?: DeliveryChannel;
}): Promise<{ id: string }> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO notification_deliveries (event_type, recipient_user_id, template, context, channel)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      input.event_type,
      input.recipient_user_id ?? null,
      input.template,
      input.context != null ? JSON.stringify(input.context) : null,
      input.channel ?? 'email',
    ]
  );
  return rows[0];
}

/** Worker: claim + deliver one queued notification; returns whether it was sent. */
export async function deliverOne(): Promise<{ delivered: boolean; messageId?: string }> {
  const { rows } = await query<{ id: string; template: string; context: string | null; attempts: number }>(
    `UPDATE notification_deliveries
        SET status='sent', attempts = attempts + 1, sent_at = now()
      WHERE id = (
        SELECT id FROM notification_deliveries
         WHERE status = 'queued' AND attempts < 3
         ORDER BY created_at LIMIT 1
         FOR UPDATE SKIP LOCKED
      ) RETURNING id, template, context, attempts`
  );
  if (rows.length === 0) {
    return { delivered: false };
  }
  const row = rows[0];
  const context = row.context ? (JSON.parse(row.context) as Record<string, unknown>) : {};
  const body = renderTemplate(row.template, context);

  try {
    const recipient = context['email'] ?? context['recipient_email'];
    if (!transporter || !recipient) {
      // no SMTP configured or no recipient: keep the row as sent (dev mode)
      return { delivered: true };
    }
    const info = await transporter.sendMail({
      from: smtpFrom,
      to: String(recipient),
      subject: context['subject'] != null ? String(context['subject']) : row.template,
      text: body,
    });
    await query(
      `UPDATE notification_deliveries SET status='delivered', provider_message_id = $2 WHERE id = $1::uuid`,
      [row.id, info.messageId ?? null]
    );
    return { delivered: true, messageId: info.messageId };
  } catch (error) {
    const lastError = error instanceof Error ? error.message : 'send failed';
    if (row.attempts >= 3) {
      await query(
        `UPDATE notification_deliveries SET status='failed', last_error = $2 WHERE id = $1::uuid`,
        [row.id, lastError]
      );
    } else {
      await query(
        `UPDATE notification_deliveries SET status='queued', last_error = $2, sent_at = NULL WHERE id = $1::uuid`,
        [row.id, lastError]
      );
    }
    return { delivered: false };
  }
}

export async function listNotifications(input: { filters?: FilterParam[]; page?: number; per_page?: number }): Promise<PaginatedResponse<Record<string, unknown>>> {
  return list({
    table: 'notification_deliveries nd',
    columns: {
      id: { type: 'uuid', sql: 'nd.id' },
      event_type: { type: 'text', sql: 'nd.event_type' },
      channel: { type: 'text', sql: 'nd.channel' },
      status: { type: 'text', sql: 'nd.status' },
      recipient_user_id: { type: 'uuid', sql: 'nd.recipient_user_id' },
      created_at: { type: 'datetime', sql: 'nd.created_at' },
      sent_at: { type: 'datetime', sql: 'nd.sent_at' },
    },
    filters: input.filters,
    defaultSort: { field: 'created_at', direction: 'desc' },
    pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
  });
}

export interface MyNotificationsResult {
  items: InAppNotificationRow[];
  total: number;
}

/** The current user's own in-app notifications (never anyone else's). */
export async function listMyNotifications(input: {
  userId: string;
  page?: number;
  per_page?: number;
}): Promise<MyNotificationsResult> {
  const page = Math.max(1, input.page ?? 1);
  const perPage = Math.min(50, Math.max(1, input.per_page ?? 10));
  const offset = (page - 1) * perPage;
  const { rows } = await query<InAppNotificationRow>(
    `SELECT id, recipient_user_id, title, message, action_url, event_type, created_at, read_at
       FROM notification_deliveries
      WHERE recipient_user_id = $1::uuid AND channel = 'in_app'
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [input.userId, perPage, offset]
  );
  const { rows: countRows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM notification_deliveries
      WHERE recipient_user_id = $1::uuid AND channel = 'in_app'`,
    [input.userId]
  );
  return { items: rows, total: countRows[0]?.n ?? 0 };
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM notification_deliveries
      WHERE recipient_user_id = $1::uuid AND channel = 'in_app' AND read_at IS NULL`,
    [userId]
  );
  return rows[0]?.n ?? 0;
}

/** Mark one of the current user's own notifications read. */
export async function markNotificationRead(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE notification_deliveries SET read_at = now()
      WHERE id = $1::uuid AND recipient_user_id = $2::uuid AND channel = 'in_app' AND read_at IS NULL`,
    [id, userId]
  );
  return (rowCount ?? 0) > 0;
}

/** Mark all of the current user's in-app notifications read. */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const { rowCount } = await query(
    `UPDATE notification_deliveries SET read_at = now()
      WHERE recipient_user_id = $1::uuid AND channel = 'in_app' AND read_at IS NULL`,
    [userId]
  );
  return rowCount ?? 0;
}

export async function countPending(): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM notification_deliveries WHERE status = 'queued'`
  );
  return rows[0]?.n ?? 0;
}
