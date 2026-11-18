import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { API_BASE, fetchCsrf, getMeCached, logout, notifications } from '../api';
import type { InAppNotificationItem } from '../api';
import { ToastProvider } from './Toast';
import { Icon, Icons } from './Icon';
import type { IconDefinition } from './Icon';
import { CurrentUserContext, type CurrentUserInfo, useCurrentUser } from '../auth-context';
import {
  MORE_NAV_TO,
  NAVIGATION,
  MOBILE_BOTTOM_NAV,
  filterNavItems,
  canViewNavItem,
} from '../navigationConfig';

type CurrentUser = CurrentUserInfo;

interface NavEntry {
  label: string;
  icon: IconDefinition;
  to: string;
  requiredRole?: string;
  requiredPermission?: string;
  children?: NavEntry[];
}

/* ─── Desktop Sidebar ────────────────────────────────────────── */

function SidebarNavGroup({
  item,
  currentUser,
}: {
  item: NavEntry;
  currentUser: CurrentUser | null;
}) {
  const location = useLocation();
  const isChildActive = item.children?.some(
    (c) => location.pathname === c.to || location.pathname.startsWith(c.to + '/')
  );
  const [open, setOpen] = useState(isChildActive ?? false);

  useEffect(() => {
    if (isChildActive) setOpen(true);
  }, [isChildActive]);

  const visibleChildren = item.children?.filter((child) => canViewNavItem(child, currentUser));

  if (!visibleChildren || visibleChildren.length === 0) {
    return null;
  }

  return (
    <div className={`nav-group${isChildActive ? ' nav-group-active' : ''}`}>
      <button className="nav-group-toggle" onClick={() => setOpen(!open)}>
        <span className="nav-icon">
          <Icon icon={item.icon} />
        </span>
        <span className="nav-group-label">{item.label}</span>
        <span className={`nav-group-chevron${open ? ' open' : ''}`}>
          <Icon icon={Icons.ChevronDown} size="xs" />
        </span>
      </button>
      {open && visibleChildren && visibleChildren.length > 0 && (
        <div className="nav-group-children">
          {visibleChildren.map((child) => (
            <NavLink
              key={child.to}
              to={child.to}
              className={({ isActive }) =>
                `nav-child${isActive || location.pathname === child.to ? ' nav-link-active' : ''}`
              }
            >
              <span className="nav-child-icon">
                <Icon icon={child.icon} size="xs" />
              </span>
              <span>{child.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarNavSingle({ item, badge }: { item: NavEntry; badge?: number }) {
  const location = useLocation();
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `nav-link${isActive || (item.to === '/' && location.pathname === '/') ? ' nav-link-active' : ''}`
      }
    >
      <span className="nav-icon">
        <Icon icon={item.icon} />
      </span>
      <span>{item.label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="notification-badge" style={{ marginLeft: 'auto', fontSize: '0.68rem' }}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}

function Sidebar({
  collapsed,
  currentUser,
}: {
  collapsed: boolean;
  currentUser: CurrentUser | null;
}) {
  const [msgUnread, setMsgUnread] = useState(0);

  useEffect(() => {
    if (!currentUser) return;
    let disposed = false;
    async function fetchCount() {
      try {
        const r = await fetch(`${API_BASE}/api/messages/unread-count`, { credentials: 'include' });
        const j = await r.json();
        if (!disposed && j.success) setMsgUnread(j.data.count);
      } catch { /* ignore */ }
    }
    void fetchCount();
    const es = new EventSource(`${API_BASE}/api/messages/stream`, { withCredentials: true } as unknown as EventSourceInit);
    es.addEventListener('unread', () => { if (!disposed) void fetchCount(); });
    const refresh = () => { if (!disposed) void fetchCount(); };
    for (const ev of ['message:new', 'conversation:created', 'conversation:read'] as const) es.addEventListener(ev, refresh);
    return () => { disposed = true; es.close(); };
  }, [currentUser]);

  return (
    <aside className={`app-sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="brand-title">
          <img src="/sdi-mark.png" alt="SDI" className="brand-title-img" />
          <div className="brand-title-text">
            <span className="brand-name">SDI - Self Development Initiatives</span>
            <span className="brand-sub">HR &amp; PM Suite</span>
          </div>
        </div>
      </div>
      <nav className="sidebar-nav sidebar-scroll">
        {filterNavItems(NAVIGATION, currentUser).map((item) =>
          item.children && item.children.length > 0 ? (
            <SidebarNavGroup key={item.to} item={item} currentUser={currentUser} />
          ) : (
            <SidebarNavSingle key={item.to} item={item} badge={item.to === '/messages' ? msgUnread : 0} />
          )
        )}
      </nav>
    </aside>
  );
}

/* ─── Mobile Bottom Nav ──────────────────────────────────────── */

function MobileBottomNavItem({ item, isActive }: { item: NavEntry; isActive: boolean }) {
  return (
    <NavLink to={item.to} className={`mobile-nav-item${isActive ? ' mobile-active' : ''}`}>
      <span style={{ fontSize: '1.1rem' }}>
        <Icon icon={item.icon} />
      </span>
      <span>{item.label}</span>
    </NavLink>
  );
}

/* ─── Mobile More Menu ───────────────────────────────────────── */

function NavMenuItem({
  item,
  onSelect,
  level = 0,
  currentUser,
}: {
  item: NavEntry;
  onSelect: (to: string) => void;
  level?: number;
  currentUser?: CurrentUser | null;
}) {
  const styles =
    level === 0
      ? 'mobile-menu-row'
      : level === 1
        ? 'mobile-menu-sub-row'
        : 'mobile-menu-sub-sub-row';
  const indent = level * 16;

  if (item.children && item.children.length > 0) {
    const children = filterNavItems(item.children, currentUser ?? null);
    if (children.length === 0) return null;
    return (
      <div key={item.to} className={styles} style={{ paddingLeft: `${indent}px` }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            padding: '0.5rem 0.75rem',
            borderRadius: 8,
            fontWeight: 600,
            color: 'var(--text-main)',
            fontSize: 14,
            transition: 'background 0.15s ease',
          }}
        >
          <span className="mobile-menu-icon" style={{ width: 14, fontSize: '0.7rem' }}>
            <Icon icon={item.icon} />
          </span>
          <span>{item.label}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: 12 }}>
            <Icon icon={Icons.ChevronDown} size="xs" />
          </span>
        </div>
        <div
          style={{
            marginTop: 8,
            paddingLeft: `${16 * (level + 1)}px`,
            background: 'var(--surface-muted)',
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--text-dim)',
          }}
        >
          {children.map((child) => (
            <NavLink
              key={child.to}
              to={child.to}
              className="mobile-menu-sub-item"
              style={{
                display: 'block',
                padding: '0.4rem 0.7rem 0.4rem 2.4rem',
                fontSize: '0.74rem',
                color: 'var(--text-main)',
                textDecoration: 'none',
                borderRadius: 5,
              }}
              onClick={() => onSelect(child.to)}
            >
              <span className="mobile-menu-sub-icon" style={{ width: 10, fontSize: '0.6rem' }}>
                <Icon icon={child.icon} />
              </span>
              <span>{child.label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    );
  }

  return (
    <NavLink
      key={item.to}
      to={item.to}
      className="mobile-menu-item"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.75rem',
        fontSize: '0.88rem',
        color: 'var(--text-main)',
        textDecoration: 'none',
        borderRadius: 8,
        fontWeight: 500,
        transition: 'background 0.15s ease',
        margin: '0.2rem',
      }}
      onClick={() => onSelect(item.to)}
    >
      <span className="mobile-menu-icon" style={{ width: 18, fontSize: '0.8rem' }}>
        <Icon icon={item.icon} />
      </span>
      <span>{item.label}</span>
    </NavLink>
  );
}

function MobileMoreMenu({ onClose }: { onClose: () => void }) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const allNav = useMemo(
    () => filterNavItems(NAVIGATION, user),
    [user]
  );

  const handleSelect = (to: string) => {
    onClose();
    navigate(to);
  };

  const filteredNav = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allNav;
    return allNav
      .map((group) => {
        if (group.children && group.children.length > 0) {
          const matchingChildren = group.children.filter((c) =>
            c.label.toLowerCase().includes(q) || group.label.toLowerCase().includes(q)
          );
          if (matchingChildren.length > 0) {
            return { ...group, children: matchingChildren };
          }
          return null;
        }
        return group.label.toLowerCase().includes(q) ? group : null;
      })
      .filter((g): g is NavEntry => g !== null);
  }, [allNav, search]);

  const initials = user?.fullName
    ? user.fullName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase())
        .join('')
    : (user?.username?.[0]?.toUpperCase() ?? 'U');

  return (
    <div
      className="mobile-menu-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--overlay, rgba(15, 23, 42, 0.4))',
        backdropFilter: 'blur(4px)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        className="mobile-menu-panel sidebar-scroll"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '360px',
          background: 'var(--surface, #ffffff)',
          boxShadow: '4px 0 24px rgba(0, 0, 0, 0.15)',
          height: '100vh',
          maxHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem',
            borderBottom: '1px solid var(--border-subtle, rgba(0, 0, 0, 0.08))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <img src="/sdi-mark.png" alt="SDI" style={{ width: 28, height: 28, objectFit: 'contain' }} />
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--primary)', lineHeight: 1.1 }}>SDI</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>HR &amp; PM Suite</div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-dim)',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '4px',
            }}
            aria-label="Close menu"
          >
            <Icon icon={Icons.Close} />
          </button>
        </div>

        {/* User profile row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            background: 'var(--surface-muted, #f8fafc)',
            borderBottom: '1px solid var(--border-subtle, rgba(0, 0, 0, 0.08))',
          }}
        >
          <div className="user-avatar-clay" style={{ width: 36, height: 36, fontSize: '0.85rem' }}>
            {initials}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.fullName ?? user?.username ?? 'User'}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.roles?.join(', ') || (user?.username === 'admin' ? 'Administrator' : 'Employee')}
            </div>
          </div>
          <button
            className="btn-clay btn-clay-sm btn-clay-secondary"
            style={{ fontSize: '0.7rem', padding: '4px 8px' }}
            onClick={() => handleSelect('/me/profile')}
          >
            Profile
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-subtle, rgba(0, 0, 0, 0.08))' }}>
          <input
            type="search"
            className="form-control-clay"
            placeholder="Search modules..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
          />
        </div>

        {/* Navigation items */}
        <div style={{ flex: 1, padding: '0.5rem' }}>
          {filteredNav.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.82rem' }}>
              No modules found matching &ldquo;{search}&rdquo;
            </div>
          ) : (
            filteredNav.map((item) => (
              <NavMenuItem
                key={item.to}
                item={item}
                onSelect={handleSelect}
                currentUser={user as CurrentUser | null}
              />
            ))
          )}
        </div>

        {/* Sign Out */}
        <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-subtle, rgba(0, 0, 0, 0.08))' }}>
          <button
            className="btn-clay btn-clay-danger"
            style={{ width: '100%', padding: '0.6rem 1rem', fontSize: '0.85rem' }}
            onClick={() => {
              void logout().finally(() => navigate('/login', { replace: true }));
            }}
          >
            <Icon icon={Icons.RightFromBracket} size="sm" /> Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── App Layout ─────────────────────────────────────────────── */

export function AppLayout(): ReactElement {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState<InAppNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const notifUserId = currentUser?.id ?? null;

  const refreshNotifications = useMemo(
    () => async () => {
      setNotifLoading(true);
      try {
        const [listRes, countRes] = await Promise.all([
          notifications.mine({ page: 1, perPage: 10 }),
          notifications.unreadCount(),
        ]);
        setNotifItems(listRes.data.items);
        setUnreadCount(countRes.data.count);
      } catch {
        /* offline / not authed — ignore */
      } finally {
        setNotifLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (currentUser) {
      void refreshNotifications();
    }
  }, [currentUser, refreshNotifications]);

  /* SSE: real-time push + native auto-reconnect; refetch on every (re)connect. */
  useEffect(() => {
    if (!notifUserId) return;
    if (typeof EventSource === 'undefined') return;
    let disposed = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const connect = () => {
      if (disposed) return;
      try {
        es = new EventSource(`${API_BASE}/api/notifications/stream`, { withCredentials: true });
      } catch {
        retryTimer = setTimeout(connect, 5000);
        return;
      }
      es.addEventListener('notification', (ev) => {
        try {
          const delivery = JSON.parse((ev as MessageEvent).data) as InAppNotificationItem;
          setNotifItems((items) => {
            const rest = items.filter((n) => n.id !== delivery.id);
            return [delivery, ...rest].slice(0, 10);
          });
          setUnreadCount((c) => c + 1);
        } catch {
          /* malformed payload */
        }
      });
      es.onopen = () => {
        attempts = 0;
        void refreshNotifications();
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (disposed) return;
        attempts += 1;
        retryTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)));
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [notifUserId, refreshNotifications]);

  const openNotif = async (item: InAppNotificationItem) => {
    setNotifOpen(false);
    if (!item.read_at) {
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifItems((items) =>
        items.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n))
      );
      void notifications.markRead(item.id).catch(() => undefined);
    }
    if (item.action_url) {
      navigate(item.action_url);
    }
  };

  const markAllRead = async () => {
    try {
      await notifications.markAllRead();
      setUnreadCount(0);
      setNotifItems((items) => items.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    } catch {
      /* ignore */
    }
  };

  const initials =
    currentUser?.fullName
      ?.split(' ')
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      ?.toUpperCase() ?? 'SDI';

  useEffect(() => {
    let cancelled = false;
    async function checkAuth() {
      try {
        const me = await getMeCached();
        if (!cancelled && me.authenticated && me.user) {
          setCurrentUser(me.user);
          try {
            await fetchCsrf();
          } catch {
            /* CSRF token is optional */
          }
        }
      } catch {
        /* session check failed — treat as unauthenticated */
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    }
    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  const pageEntry =
    NAVIGATION.find((n) => n.to === location.pathname) ||
    NAVIGATION.flatMap((n) => n.children ?? []).find((c) => c.to === location.pathname) || {
      label: 'SDI',
      icon: Icons.Dashboard,
    };
  const crumbs = useMemo(() => {
    let groupLabel = '';
    if (location.pathname === '/') {
      groupLabel = 'Dashboard';
    } else {
      for (const entry of NAVIGATION) {
        if (entry.children) {
          const child = entry.children.find((c) => c.to === location.pathname);
          if (child) {
            groupLabel = entry.label;
            break;
          }
        }
      }
    }
    return { group: groupLabel, page: pageEntry.label };
  }, [location.pathname, pageEntry.label]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      /* noop */
    }
    navigate('/login', { replace: true });
  };

  if (!authChecked) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          color: 'var(--text-dim)',
        }}
      >
        Loading...
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <CurrentUserContext.Provider value={currentUser as CurrentUserInfo | null}>
      <ToastProvider>
        <div className="app-shell">
          <Sidebar collapsed={sidebarCollapsed} currentUser={currentUser} />

          <div className="app-container">
            <header className="app-topbar">
              <div className="topbar-left">
                <button
                  className="btn-clay btn-clay-secondary"
                  style={{ minHeight: '34px', width: '34px', padding: 0, flexShrink: 0 }}
                  onClick={() => {
                    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
                      setMobileMenuOpen((o) => !o);
                    } else {
                      setSidebarCollapsed((c) => !c);
                    }
                  }}
                  title="Toggle Sidebar / Menu"
                  aria-label="Toggle navigation menu"
                >
                  <Icon icon={Icons.Menu} />
                </button>
                <div>
                  {crumbs.group && crumbs.group !== crumbs.page && (
                    <div className="topbar-breadcrumb">
                      {crumbs.group}
                      <span className="crumb-sep">/</span>
                      <span className="crumb-current">{crumbs.page}</span>
                    </div>
                  )}
                  <div className="topbar-title">{crumbs.page}</div>
                </div>
              </div>
              <div className="topbar-actions" style={{ position: 'relative' }}>
                <div className="notification-bell-wrap" style={{ position: 'relative' }}>
                  <button
                    className="notification-bell"
                    onClick={() => {
                      setNotifOpen((o) => !o);
                      if (!notifOpen) void refreshNotifications();
                    }}
                    title="Notifications"
                    aria-label="Notifications"
                  >
                    <Icon icon={Icons.Bell} />
                    {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
                  </button>

                  {notifOpen && (
                    <>
                      <div
                        style={{ position: 'fixed', inset: 0, zIndex: 55 }}
                        onClick={() => setNotifOpen(false)}
                      />
                      <div className="notification-dropdown">
                        <div className="notification-dropdown-header">
                          <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Notifications</span>
                          {unreadCount > 0 && (
                            <button className="text-link" style={{ fontSize: '0.75rem' }} onClick={() => void markAllRead()}>
                              Mark all read
                            </button>
                          )}
                        </div>
                        <div className="notification-dropdown-body">
                          {notifItems.length === 0 ? (
                            <div className="notification-empty">
                              {notifLoading ? 'Loading...' : 'No notifications yet.'}
                            </div>
                          ) : (
                            notifItems.map((item) => (
                              <button
                                key={item.id}
                                className={`notification-item${item.read_at ? '' : ' notification-item-unread'}`}
                                onClick={() => void openNotif(item)}
                              >
                                <div className="notification-item-title">{item.title}</div>
                                {item.message && <div className="notification-item-msg">{item.message}</div>}
                                <div className="notification-item-time">
                                  {new Date(item.created_at).toLocaleString()}
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div
                  className="user-profile-clay"
                  onClick={() => setProfileOpen(!profileOpen)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="user-avatar-clay">{initials}</div>
                </div>
              </div>
            </header>

            <main className="app-main">
              <ErrorBoundary resetKeys={[location.pathname]}>
                <Outlet />
              </ErrorBoundary>
            </main>
          </div>

          <nav className="mobile-bottom-bar">
            {MOBILE_BOTTOM_NAV.filter((item) => canViewNavItem(item, currentUser)).map((item) =>
              item.to === MORE_NAV_TO ? (
                <button
                  key={item.to}
                  className="mobile-nav-item"
                  onClick={() => setMobileMenuOpen(true)}
                  style={{ background: 'none', border: 'none' }}
                >
                  <span style={{ fontSize: '1.15rem' }}>
                    <Icon icon={item.icon} />
                  </span>
                  <span>{item.label}</span>
                </button>
              ) : item.to === '/hr/attendance/mobile' ? (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `mobile-nav-item mobile-punch-tab${isActive ? ' mobile-active' : ''}`
                  }
                >
                  <div className="punch-icon-wrap">
                    <Icon icon={item.icon} />
                  </div>
                  <span>{item.label}</span>
                </NavLink>
              ) : (
                <MobileBottomNavItem
                  key={item.to}
                  item={item}
                  isActive={
                    item.to === '/'
                      ? location.pathname === '/'
                      : location.pathname === item.to || location.pathname.startsWith(item.to + '/')
                  }
                />
              )
            )}
          </nav>

          {mobileMenuOpen && <MobileMoreMenu onClose={() => setMobileMenuOpen(false)} />}

          {profileOpen && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 55 }}
                onClick={() => setProfileOpen(false)}
              />
              <div className="profile-dropdown" style={{ top: 62, right: 18 }}>
                <div className="profile-dropdown-header">
                  <div className="user-avatar-clay">{initials}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                      {currentUser.fullName ?? ''}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                      {currentUser.roles && currentUser.roles.length > 0
                        ? currentUser.roles.join(', ')
                        : currentUser.username === 'admin'
                          ? 'Administrator'
                          : ''}
                    </div>
                  </div>
                </div>
                <button
                  className="btn-clay btn-clay-danger profile-dropdown-logout"
                  style={{ width: '100%' }}
                  onClick={handleLogout}
                >
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </ToastProvider>
    </CurrentUserContext.Provider>
  );
}
