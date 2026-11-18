import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { enqueueInAppNotification, countUnreadNotifications } from '@jsk/domain-notifications';
import { query, initDb } from '@jsk/shared-kernel';

let ADMIN_ID = '';
let OTHER_ID = '';

async function login(httpServer: Server, username: string, password: string): Promise<string> {
  const res = await request(httpServer)
    .post('/api/auth/login')
    .send({ username, password })
    .expect(200);
  const cookies = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

describe('Notifications API (in-app, user-scoped)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    initDb({ connectionString: process.env.DATABASE_URL ?? 'postgres://jsk:jsk@localhost:5432/jsk' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer();
    // Resolve the seeded admin's id at runtime — it is database-generated.
    const { rows: admins } = await query<{ id: string }>(
      `SELECT id FROM users WHERE username = 'admin' AND deleted_at IS NULL LIMIT 1`
    );
    ADMIN_ID = admins[0].id;
    // Dedicated "other user" so the test never depends on seeded data.
    const { rows: others } = await query<{ id: string }>(
      `INSERT INTO users (username, email, full_name, password_hash)
       VALUES ('__notif_test_other__', '__notif_test_other__@sdi.local', 'Notif Test Other', 'not-a-real-hash')
       ON CONFLICT (username) DO UPDATE SET full_name = 'Notif Test Other'
       RETURNING id`
    );
    OTHER_ID = others[0].id;
    await query(`DELETE FROM notification_deliveries WHERE channel = 'in_app'`);
  });

  afterAll(async () => {
    await query(`DELETE FROM notification_deliveries WHERE channel = 'in_app'`);
    await query(`DELETE FROM users WHERE id = $1`, [OTHER_ID]);
    await app.close();
  });

  it('rejects unauthenticated access to my notifications', async () => {
    await request(httpServer).get('/api/notifications/my').expect(401);
    await request(httpServer).get('/api/notifications/my/unread-count').expect(401);
    await request(httpServer).post('/api/notifications/my/read-all').expect(401);
  });

  it('returns only the current user, newest first', async () => {
    const cookie = await login(httpServer, 'admin', 'Admin@12345');

    await enqueueInAppNotification({
      recipient_user_id: ADMIN_ID,
      event_type: 'test.first',
      title: 'First',
      action_url: '/hr/attendance/form',
    });
    await enqueueInAppNotification({
      recipient_user_id: OTHER_ID,
      event_type: 'test.other',
      title: 'Other user',
    });

    const list = await request(httpServer).get('/api/notifications/my?perPage=10').set('Cookie', cookie).expect(200);
    expect(list.body.success).toBe(true);
    expect(list.body.data.total).toBe(1);
    expect(list.body.data.items[0].title).toBe('First');
    expect(list.body.data.items[0].action_url).toBe('/hr/attendance/form');

    const count = await request(httpServer).get('/api/notifications/my/unread-count').set('Cookie', cookie).expect(200);
    expect(count.body.data.count).toBe(1);
  });

  it('marks a single notification read', async () => {
    const cookie = await login(httpServer, 'admin', 'Admin@12345');
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM notification_deliveries WHERE recipient_user_id = $1 AND channel = 'in_app' ORDER BY created_at DESC LIMIT 1`,
      [ADMIN_ID]
    );
    const id = rows[0].id;

    const res = await request(httpServer)
      .post(`/api/notifications/my/${id}/read`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.data.updated).toBe(true);

    const count = await countUnreadNotifications(ADMIN_ID);
    expect(count).toBe(0);

    // marking again reports false (already read)
    const again = await request(httpServer)
      .post(`/api/notifications/my/${id}/read`)
      .set('Cookie', cookie)
      .expect(200);
    expect(again.body.data.updated).toBe(false);
  });

  it('cannot mark another user notification as read', async () => {
    const cookie = await login(httpServer, 'admin', 'Admin@12345');
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM notification_deliveries WHERE recipient_user_id = $1 AND channel = 'in_app' LIMIT 1`,
      [OTHER_ID]
    );
    const res = await request(httpServer)
      .post(`/api/notifications/my/${rows[0].id}/read`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.data.updated).toBe(false);
  });

  it('marks all read', async () => {
    const cookie = await login(httpServer, 'admin', 'Admin@12345');
    await enqueueInAppNotification({
      recipient_user_id: ADMIN_ID,
      event_type: 'test.all',
      title: 'Batch',
    });
    const res = await request(httpServer).post('/api/notifications/my/read-all').set('Cookie', cookie).expect(200);
    expect(res.body.data.updated).toBe(1);
    const count = await request(httpServer).get('/api/notifications/my/unread-count').set('Cookie', cookie).expect(200);
    expect(count.body.data.count).toBe(0);
  });

  it('stream requires authentication', async () => {
    await request(httpServer).get('/api/notifications/stream').expect(401);
  });
});