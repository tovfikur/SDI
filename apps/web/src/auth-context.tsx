import { createContext, useContext, useMemo } from 'react';

export interface CurrentUserInfo {
  id: string;
  username: string;
  fullName: string;
  email: string;
  isSuperAdmin: boolean;
  employeeId?: string | null;
  roles?: string[];
  permissions?: string[];
}

export const CurrentUserContext = createContext<CurrentUserInfo | null>(null);

export function useCurrentUser(): CurrentUserInfo | null {
  return useContext(CurrentUserContext);
}

/** Super admin bypasses permission checks (identity.permissions = ['*']). */
export function hasPermission(user: CurrentUserInfo | null, permission: string): boolean {
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

/** True if the user has ANY of the given permissions (empty list → false). */
export function hasAnyPermission(user: CurrentUserInfo | null, permissions: string[]): boolean {
  if (!user) return false;
  if (permissions.length === 0) return false;
  if (user.isSuperAdmin) return true;
  return permissions.some((p) => hasPermission(user, p));
}

/** True if the user has ALL of the given permissions (empty list → true). */
export function hasAllPermissions(user: CurrentUserInfo | null, permissions: string[]): boolean {
  if (!user) return false;
  if (permissions.length === 0) return true;
  if (user.isSuperAdmin) return true;
  return permissions.every((p) => hasPermission(user, p));
}

/** Permission helpers bound to the current user (use inside a component). */
export function usePermissions(): {
  can: (permission: string) => boolean;
  canAny: (permissions: string[]) => boolean;
  canAll: (permissions: string[]) => boolean;
} {
  const user = useCurrentUser();
  return useMemo(
    () => ({
      can: (permission: string) => hasPermission(user, permission),
      canAny: (permissions: string[]) => hasAnyPermission(user, permissions),
      canAll: (permissions: string[]) => hasAllPermissions(user, permissions),
    }),
    [user]
  );
}

export function isAdminUser(user: CurrentUserInfo | null): boolean {
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  if (user.username === 'admin') return true;
  return Array.isArray(user.roles) && user.roles.some((r) => /admin/i.test(r));
}
