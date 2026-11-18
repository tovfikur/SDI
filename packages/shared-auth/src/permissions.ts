export type RoleName =
  | 'super_admin'
  | 'hr_admin'
  | 'hr_manager'
  | 'project_manager'
  | 'employee'
  | 'viewer';

export interface UserContext {
  id: string;
  username: string;
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  employeeId?: string | null;
  roles: RoleName[];
  permissions: string[];
}

export function hasPermission(user: UserContext, requiredPermission: string): boolean {
  if (user.isSuperAdmin || user.roles.includes('super_admin')) {
    return true;
  }
  return user.permissions.includes(requiredPermission);
}

export function canAccessEmployeeRecord(
  user: UserContext,
  targetEmployeeId: string,
  requiredHRRolePermission?: string
): boolean {
  if (user.isSuperAdmin || user.roles.includes('super_admin') || user.roles.includes('hr_admin') || user.roles.includes('hr_manager')) {
    if (requiredHRRolePermission) {
      return hasPermission(user, requiredHRRolePermission);
    }
    return true;
  }
  // Employee self-service check
  return user.employeeId !== null && user.employeeId === targetEmployeeId;
}
