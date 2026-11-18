import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());

vi.mock('@jsk/shared-kernel', async () => {
  const actual = await import('@jsk/shared-kernel');
  return {
    ...actual,
    query: mockQuery,
  };
});

import {
  enqueueInAppNotification,
  listMyNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  setInAppPushHandler,
} from './service';

describe('in-app notification domain', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('enqueueInAppNotification inserts an in_app/sent row and returns the mapped shape', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'n1',
          recipient_user_id: 'u1',
          title: 'Leave approved',
          message: 'Approved',
          action_url: '/hr/leave/applications',
          event_type: 'leave.approved',
          created_at: '2026-08-20T10:00:00Z',
          read_at: null,
        },
      ],
    });

    const row = await enqueueInAppNotification({
      recipient_user_id: 'u1',
      title: 'Leave approved',
      message: 'Approved',
      action_url: '/hr/leave/applications',
      event_type: 'leave.approved',
    });

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("'in_app'");
    expect(sql).toContain("'sent'");
    expect(row.title).toBe('Leave approved');
    expect(row.event_type).toBe('leave.approved');
  });

  it('pushes to the registered handler with the recipient id', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'n2',
          recipient_user_id: 'u42',
          title: 'Task assigned',
          message: null,
          action_url: null,
          event_type: 'task.assigned',
          created_at: '2026-08-20T10:00:00Z',
          read_at: null,
        },
      ],
    });
    const handler = vi.fn();
    setInAppPushHandler(handler);

    await enqueueInAppNotification({
      recipient_user_id: 'u42',
      title: 'Task assigned',
      event_type: 'task.assigned',
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].recipient_user_id).toBe('u42');
    setInAppPushHandler(null);
  });

  it('does not throw when the push handler fails', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'n3',
          recipient_user_id: 'u1',
          title: 'T',
          message: null,
          action_url: null,
          event_type: 'e',
          created_at: '2026-08-20T10:00:00Z',
          read_at: null,
        },
      ],
    });
    setInAppPushHandler(() => {
      throw new Error('boom');
    });

    await expect(
      enqueueInAppNotification({ recipient_user_id: 'u1', title: 'T', event_type: 'e' })
    ).resolves.toBeTruthy();
    setInAppPushHandler(null);
  });

  it('scopes every query to the current user and in_app channel', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'n4', recipient_user_id: 'u9' }] })
      .mockResolvedValueOnce({ rows: [{ n: 3 }] });

    const result = await listMyNotifications({ userId: 'u9', page: 2, per_page: 5 });

    const listSql = mockQuery.mock.calls[0][0] as string;
    const listParams = mockQuery.mock.calls[0][1] as unknown[];
    expect(listSql).toContain('recipient_user_id = $1');
    expect(listSql).toContain("channel = 'in_app'");
    expect(listParams[0]).toBe('u9');
    expect(listParams[1]).toBe(5);
    expect(listParams[2]).toBe(5); // offset (page 2)
    expect(result.total).toBe(3);
  });

  it('countUnreadNotifications filters by user and unread', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 7 }] });
    const n = await countUnreadNotifications('u5');
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('recipient_user_id = $1');
    expect(sql).toContain("channel = 'in_app'");
    expect(sql).toContain('read_at IS NULL');
    expect(n).toBe(7);
  });

  it('markNotificationRead targets only the owner and unread rows', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const ok = await markNotificationRead('u5', 'n9');
    const sql = mockQuery.mock.calls[0][0] as string;
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(ok).toBe(true);
    expect(params[0]).toBe('n9');
    expect(params[1]).toBe('u5');
    expect(sql).toContain('read_at IS NULL');
  });

  it('markAllNotificationsRead updates only the owner unread rows', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 4 });
    const updated = await markAllNotificationsRead('u5');
    const sql = mockQuery.mock.calls[0][0] as string;
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(updated).toBe(4);
    expect(params[0]).toBe('u5');
    expect(sql).toContain('recipient_user_id = $1');
    expect(sql).toContain('read_at IS NULL');
  });
});