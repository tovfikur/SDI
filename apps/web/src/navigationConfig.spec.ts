import { describe, it, expect } from 'vitest';
import { NAVIGATION, filterNavItems, canViewNavItem } from './navigationConfig';

const admin = { id: '1', username: 'admin', fullName: 'a', email: 'e', isSuperAdmin: true, employeeId: 'emp-1', roles: [], permissions: ['*'] };
const employee = { id: '2', username: 'emp.demo', fullName: 'e', email: 'e', isSuperAdmin: false, employeeId: 'emp-2', roles: ['employee'], permissions: ['self.attendance.view', 'self.leave.apply', 'self.profile.view'] };
const system = { id: '3', username: 'svc', fullName: 's', email: 'e', isSuperAdmin: false, employeeId: null as string | null, roles: [], permissions: ['settings.manage'] };

describe('My Work employeeOnly gating', () => {
  const myWork = NAVIGATION.find((n) => n.label === 'My Work')!;
  it('parent marked employeeOnly and has no permission gate', () => {
    expect(myWork.employeeOnly).toBe(true);
    expect(myWork.requiredAnyPermission).toBeUndefined();
    expect(myWork.requiredPermission).toBeUndefined();
  });
  it('visible for employee-linked users, hidden for system accounts', () => {
    expect(canViewNavItem(myWork, admin)).toBe(true);
    expect(canViewNavItem(myWork, employee)).toBe(true);
    expect(canViewNavItem(myWork, { ...system })).toBe(false);
    expect(canViewNavItem(myWork, null)).toBe(false);
  });
  it('filtered tree: employee sees full personal section; system account does not', () => {
    const empTree = filterNavItems(NAVIGATION, employee);
    const mine = empTree.find((n) => n.label === 'My Work');
    expect(mine).toBeDefined();
    expect(mine!.children!.map((c) => c.label)).toEqual([
      'My Projects',
      'My Tasks',
      'My To Do',
      'My Timesheet',
      'My Attendance',
      'My Leave',
      'My Loans',
      'My Profile',
      'My Payslips',
      'My Performance',
      'Holidays & Notices',
    ]);
    const sysTree = filterNavItems(NAVIGATION, { ...system });
    expect(sysTree.find((n) => n.label === 'My Work')).toBeUndefined();
  });
  it('admin keeps all module groups incl. My Work', () => {
    const tree = filterNavItems(NAVIGATION, admin);
    expect(tree.map((n) => n.label)).toEqual([
      'Dashboard',
      'Messages',
      'My Work',
      'Workforce',
      'Attendance',
      'Leave',
      'Performance',
      'Training',
      'Projects',
      'Organization',
      'Employee Services',
      'Payroll',
      'Settings',
    ]);
  });
});
