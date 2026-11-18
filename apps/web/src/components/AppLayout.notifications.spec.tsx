import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InAppNotificationItem } from '../api';

const notifItems: InAppNotificationItem[] = [
  {
    id: 'n-1',
    recipient_user_id: 'u-admin',
    title: 'Leave approved',
    message: 'Your leave was approved',
    action_url: '/hr/leave/applications',
    event_type: 'leave.approved',
    created_at: '2026-08-20T10:00:00Z',
    read_at: null,
  },
  {
    id: 'n-2',
    recipient_user_id: 'u-admin',
    title: 'Old notice',
    message: null,
    action_url: null,
    event_type: 'task.assigned',
    created_at: '2026-08-19T10:00:00Z',
    read_at: '2026-08-19T11:00:00Z',
  },
];

const mocks = vi.hoisted(() => ({
  getMeCached: vi.fn(),
  mine: vi.fn(),
  unreadCount: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await import('../api');
  return {
    ...actual,
    API_BASE: 'http://localhost:3000',
    fetchCsrf: vi.fn().mockResolvedValue('csrf-token'),
    getMeCached: mocks.getMeCached,
    logout: vi.fn().mockResolvedValue(undefined),
    notifications: {
      mine: mocks.mine,
      unreadCount: mocks.unreadCount,
      markRead: mocks.markRead,
      markAllRead: mocks.markAllRead,
    },
  };
});

import { AppLayout } from './AppLayout';

function renderApp() {
  const router = createMemoryRouter([{ path: '/', element: <AppLayout /> }], {
    initialEntries: ['/'],
  });
  return { router, view: render(<RouterProvider router={router} />) };
}

describe('AppLayout notification bell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMeCached.mockResolvedValue({
      authenticated: true,
      user: {
        id: 'u-admin',
        username: 'admin',
        fullName: 'Administrator',
        email: 'admin@jsk.local',
        isSuperAdmin: true,
        employeeId: null,
        mustChangePassword: false,
        roles: ['admin'],
        permissions: ['*'],
      },
    });
    mocks.mine.mockResolvedValue({ success: true, data: { items: notifItems, total: 2 } });
    mocks.unreadCount.mockResolvedValue({ success: true, data: { count: 1 } });
    mocks.markRead.mockResolvedValue({ success: true, data: { updated: true } });
    mocks.markAllRead.mockResolvedValue({ success: true, data: { updated: 1 } });
  });

  it('renders a bell with an unread badge and a dropdown of the latest notifications', async () => {
    renderApp();
    const bell = await screen.findByRole('button', { name: /notifications/i });
    expect(bell).toBeTruthy();
    await waitFor(() => expect(mocks.unreadCount).toHaveBeenCalled());
    expect(screen.getByText('1')).toBeTruthy();

    fireEvent.click(bell);
    expect(await screen.findByText('Leave approved')).toBeTruthy();
    expect(screen.getByText('Old notice')).toBeTruthy();
  });

  it('marks a notification read and navigates to its action_url when clicked', async () => {
    const { router } = renderApp();
    const bell = await screen.findByRole('button', { name: /notifications/i });
    fireEvent.click(bell);
    const item = await screen.findByText('Leave approved');
    fireEvent.click(item);

    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith('n-1'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/hr/leave/applications'));
  });

  it('marks all notifications read', async () => {
    renderApp();
    const bell = await screen.findByRole('button', { name: /notifications/i });
    fireEvent.click(bell);
    const markAll = await screen.findByRole('button', { name: /mark all read/i });
    fireEvent.click(markAll);
    await waitFor(() => expect(mocks.markAllRead).toHaveBeenCalled());
  });
});