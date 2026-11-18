/**
 * RBAC + ownership authorization (Spec Phase 7 / ADR-003). Server-side only —
 * the permission check runs on every protected request; client claims are never
 * trusted for authorization decisions.
 *
 * Super Admin bypasses the permission table (is_super_admin = true).
 */

import { query } from '@jsk/shared-kernel';

export interface UserIdentity {
  id: string;
  username: string;
  full_name: string;
  email: string;
  is_super_admin: boolean;
  is_active: boolean;
  employee_id: string | null;
  must_change_password: boolean;
  permissions: string[];
  roles: string[];
}

export async function loadIdentity(userId: string): Promise<UserIdentity | null> {
  const { rows } = await query(
    `SELECT id, username, full_name, email, is_super_admin, is_active, employee_id, must_change_password
     FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (rows.length === 0) {
    return null;
  }
  const user = rows[0];
  const perms = await query(
    `SELECT DISTINCT p.code
       FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = $1`,
    [userId]
  );
  const roles = await query(`SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = $1`, [userId]);
  const roleNames = roles.rows.map((r) => r.name as string);
  const permissionsList = user.is_super_admin ? ['*'] : perms.rows.map((r) => r.code as string);

  // Fallback: any user linked to an employee record defaults to 'employee' role and permissions
  if (user.employee_id && roleNames.length === 0) {
    roleNames.push('employee');
    const defaultEmpPerms = await query<{ code: string }>(
      `SELECT DISTINCT p.code
         FROM permissions p
         JOIN role_permissions rp ON rp.permission_id = p.id
         JOIN roles r ON r.id = rp.role_id
        WHERE r.name = 'employee'`
    );
    for (const p of defaultEmpPerms.rows) {
      if (!permissionsList.includes(p.code)) {
        permissionsList.push(p.code);
      }
    }
  }

  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    email: user.email,
    is_super_admin: user.is_super_admin,
    is_active: user.is_active,
    employee_id: user.employee_id,
    must_change_password: Boolean(user.must_change_password),
    permissions: permissionsList,
    roles: roleNames,
  };
}

export function hasPermission(identity: UserIdentity, permission: string): boolean {
  if (!identity.is_active) {
    return false;
  }
  return identity.is_super_admin || identity.permissions.includes('*') || identity.permissions.includes(permission);
}

export function hasAnyPermission(identity: UserIdentity, permissions: string[]): boolean {
  return permissions.some((p) => hasPermission(identity, p));
}

/** Admin-class users: super admin flag, super admin role or HR admin role. */
export function isAdminUser(identity: UserIdentity | null | undefined): boolean {
  if (!identity || !identity.is_active) {
    return false;
  }
  if (identity.is_super_admin || identity.permissions.includes('*')) {
    return true;
  }
  return identity.roles.includes('super_admin') || identity.roles.includes('hr_admin');
}

/** Ownership scoping helper for self-service resources (Spec Phase 7). */
export function isOwnRecord(identity: UserIdentity, employeeId: string | null): boolean {
  return identity.is_super_admin || (identity.employee_id !== null && identity.employee_id === employeeId);
}

/** Resolve the login account linked to an employee (used to deliver in-app notifications). */
export async function findUserByEmployeeId(
  employeeId: string | null | undefined
): Promise<{ id: string; username: string; email: string; full_name: string } | null> {
  if (!employeeId) return null;
  const { rows } = await query<{ id: string; username: string; email: string; full_name: string }>(
    `SELECT id, username, email, full_name FROM users
      WHERE employee_id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [employeeId]
  );
  return rows[0] ?? null;
}
