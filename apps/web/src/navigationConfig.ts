/**
 * Single source of truth for all SDI navigation.
 * Renders: desktop sidebar, mobile bottom nav, mobile "More" menu,
 * and ensures route accessibility across all views.
 *
 * Each entry: label, icon (Font Awesome IconDefinition), to (route path),
 * optional children (sub-routes), optional requiredRole/requiredPermission for RBAC.
 *
 * IMPORTANT: every route MUST appear exactly once across NAVIGATION.
 * No duplicate labels — a module belongs to exactly one group.
 */

import { Icons } from './components/Icon';
import type { IconDefinition } from './components/Icon';
import { hasPermission } from './auth-context';
import type { CurrentUserInfo } from './auth-context';

export interface NavItem {
  label: string;
  icon: IconDefinition;
  to: string;
  /** Optional: only show if user has this role */
  requiredRole?: string;
  /** Optional: only show if user has this permission */
  requiredPermission?: string;
  /** Optional: only show if user has ANY of these permissions */
  requiredAnyPermission?: string[];
  /** Optional: only show when the user is linked to an employee record */
  employeeOnly?: boolean;
  /** Optional: sub-routes (drawer/dropdown items) */
  children?: NavItem[];
}

/** True when the current user may see this single nav entry (parent gates apply separately). */
export function canViewNavItem(item: NavItem, user: CurrentUserInfo | null): boolean {
  if (item.employeeOnly && !user?.employeeId) return false;
  if (item.requiredRole) {
    const roles = user?.roles ?? [];
    if (!roles.includes(item.requiredRole)) return false;
  }
  if (item.requiredPermission && !hasPermission(user, item.requiredPermission)) return false;
  if (
    item.requiredAnyPermission &&
    item.requiredAnyPermission.length > 0 &&
    !item.requiredAnyPermission.some((p) => hasPermission(user, p))
  ) {
    return false;
  }
  return true;
}

/**
 * RBAC-filtered navigation tree: drops entries the user cannot see and
 * removes parent groups that end up with zero visible children.
 */
export function filterNavItems(items: NavItem[], user: CurrentUserInfo | null): NavItem[] {
  const result: NavItem[] = [];
  for (const item of items) {
    if (!canViewNavItem(item, user)) continue;
    if (item.children && item.children.length > 0) {
      const children = filterNavItems(item.children, user);
      if (children.length === 0) continue;
      result.push({ ...item, children });
    } else {
      result.push(item);
    }
  }
  return result;
}

/** Sentinel route for the mobile "More" button (opens the menu, never navigates). */
export const MORE_NAV_TO = '#more';

/** Mobile bottom navigation — 5 visible items (shown <768px) */
export const MOBILE_BOTTOM_NAV: NavItem[] = [
  { label: 'Home', icon: Icons.Home, to: '/' },
  { label: 'Work', icon: Icons.Briefcase, to: '/me/projects' },
  { label: 'Check In/Out', icon: Icons.Fingerprint, to: '/hr/attendance/mobile' },
  { label: 'Attendance', icon: Icons.Clock, to: '/hr/attendance' },
  { label: 'Menu', icon: Icons.Menu, to: MORE_NAV_TO },
];

/** All authorized SDI modules — complete, canonical list. Each route appears once. */
export const NAVIGATION: NavItem[] = [
  { label: 'Dashboard', icon: Icons.Dashboard, to: '/' },
  { label: 'Messages', icon: Icons.PaperPlane, to: '/messages' },
  {
    label: 'My Work',
    icon: Icons.UserGear,
    to: '/me/projects',
    employeeOnly: true,
    children: [
      {
        label: 'My Projects',
        icon: Icons.Briefcase,
        to: '/me/projects',
      },
      {
        label: 'My Tasks',
        icon: Icons.ListCheck,
        to: '/me/tasks',
      },
      {
        label: 'My To Do',
        icon: Icons.Success,
        to: '/me/todo',
      },
      {
        label: 'My Timesheet',
        icon: Icons.ClipboardList,
        to: '/me/worklog',
      },
      {
        label: 'My Attendance',
        icon: Icons.Clock,
        to: '/me/attendance',
      },
      {
        label: 'My Leave',
        icon: Icons.CalendarMinus,
        to: '/me/leave',
      },
      {
        label: 'My Loans',
        icon: Icons.SackDollar,
        to: '/me/loans',
      },
      {
        label: 'My Profile',
        icon: Icons.UserTie,
        to: '/me/profile',
      },
      {
        label: 'My Payslips',
        icon: Icons.FileInvoiceDollar,
        to: '/me/payslips',
      },
      {
        label: 'Holidays & Notices',
        icon: Icons.Globe,
        to: '/me/organization',
      },
    ],
  },
  {
    label: 'Workforce',
    icon: Icons.Users,
    to: '/hr/dashboard',
    children: [
      {
        label: 'HR Dashboard',
        icon: Icons.Home,
        to: '/hr/dashboard',
        requiredPermission: 'hr.masters.view',
      },
      {
        label: 'Employees',
        icon: Icons.UserTie,
        to: '/hr/employees',
        requiredPermission: 'hr.employee.view',
      },
      {
        label: 'Departments',
        icon: Icons.Building,
        to: '/hr/departments',
        requiredPermission: 'hr.masters.view',
      },
      {
        label: 'Sub Departments',
        icon: Icons.Sitemap,
        to: '/hr/sub-departments',
        requiredPermission: 'hr.masters.view',
      },
      {
        label: 'Branches',
        icon: Icons.BuildingColumns,
        to: '/hr/branches',
        requiredPermission: 'hr.masters.view',
      },
    ],
  },
  {
    label: 'Attendance',
    icon: Icons.Clock,
    to: '/hr/attendance',
    children: [
      {
        label: 'Attendance Records',
        icon: Icons.ClipboardList,
        to: '/hr/attendance',
        requiredPermission: 'hr.attendance.view',
      },
      {
        label: 'Custom Record',
        icon: Icons.Filter,
        to: '/hr/attendance/custom',
        requiredPermission: 'hr.attendance.view',
      },
      {
        label: 'Individual Record',
        icon: Icons.UserTie,
        to: '/hr/attendance/individual',
        requiredPermission: 'hr.attendance.view',
      },
      {
        label: 'Field Force Tracking',
        icon: Icons.MapLocationDot,
        to: '/hr/field-tracking',
        requiredPermission: 'hr.attendance.field.view_all',
      },
      {
        label: 'Attendance Reports',
        icon: Icons.ChartBar,
        to: '/hr/attendance-report',
        requiredPermission: 'report.view',
      },
    ],
  },
  {
    label: 'Leave',
    icon: Icons.CalendarMinus,
    to: '/hr/leave',
    requiredAnyPermission: ['hr.leave.view', 'self.leave.apply'],
  },
  {
    label: 'Training',
    icon: Icons.GraduationCap,
    to: '/hr/training',
    requiredAnyPermission: ['hr.training.view', 'self.training.view'],
  },
  {
    label: 'Projects',
    icon: Icons.Briefcase,
    to: '/projects/dashboard',
    children: [
      {
        label: 'Dashboard',
        icon: Icons.Dashboard,
        to: '/projects/dashboard',
        requiredPermission: 'pm.project.view',
      },
      {
        label: 'Employee Tasks',
        icon: Icons.UserGear,
        to: '/projects/employee-tasks',
        requiredPermission: 'pm.task.view',
      },
      {
        label: 'Clients',
        icon: Icons.Handshake,
        to: '/projects/clients',
        requiredPermission: 'pm.client.view',
      },
      {
        label: 'Project List',
        icon: Icons.FolderOpen,
        to: '/projects/list',
        requiredPermission: 'pm.project.view',
      },
      {
        label: 'Manage Tasks',
        icon: Icons.ListCheck,
        to: '/projects/tasks',
        requiredPermission: 'pm.task.view',
      },
      {
        label: 'Work Log',
        icon: Icons.ClipboardList,
        to: '/projects/daily-tasks',
        requiredPermission: 'pm.daily_task.view',
      },
      {
        label: 'Project Reports',
        icon: Icons.ChartLine,
        to: '/projects/reports',
        requiredPermission: 'report.view',
      },
    ],
  },
  {
    label: 'Meetings',
    icon: Icons.CalendarDays,
    to: '/projects/meetings',
    requiredPermission: 'pm.meeting.view',
  },
  {
    label: 'Organization',
    icon: Icons.Globe,
    to: '/hr/holidays',
    children: [
      {
        label: 'Holidays',
        icon: Icons.CalendarDay,
        to: '/hr/holidays',
        requiredPermission: 'hr.masters.view',
      },
      {
        label: 'Notices',
        icon: Icons.Bullhorn,
        to: '/hr/notices',
        requiredPermission: 'hr.notices.read',
      },
      {
        label: 'Policies',
        icon: Icons.FileLines,
        to: '/hr/policies',
        requiredPermission: 'hr.policies.read',
      },
      {
        label: 'ID Cards',
        icon: Icons.IdCard,
        to: '/hr/id-cards',
        requiredPermission: 'hr.employee.view',
      },
    ],
  },
  {
    label: 'Employee Services',
    icon: Icons.UserGear,
    to: '/hr/loans',
    children: [
      {
        label: 'Loans',
        icon: Icons.SackDollar,
        to: '/hr/loans',
        requiredPermission: 'hr.employee.view',
      },
      {
        label: 'Resignations',
        icon: Icons.PersonWalkingArrowRight,
        to: '/hr/resignations',
        requiredPermission: 'hr.employee.view',
      },
    ],
  },
  {
    label: 'Payroll',
    icon: Icons.SackDollar,
    to: '/payroll/dashboard',
    children: [
      {
        label: 'Payroll Dashboard',
        icon: Icons.ChartPie,
        to: '/payroll/dashboard',
        requiredPermission: 'payroll.view',
      },
      {
        label: 'Employee Salaries',
        icon: Icons.Wallet,
        to: '/payroll/employee-salaries',
        requiredPermission: 'employee_salary.view',
      },
      {
        label: 'Payroll Run',
        icon: Icons.Calculator,
        to: '/payroll/runs',
        requiredPermission: 'payroll.view',
      },
      {
        label: 'Payslips',
        icon: Icons.FileInvoiceDollar,
        to: '/payroll/payslips',
        requiredAnyPermission: ['payslip.self', 'payslip.view_all'],
      },
      {
        label: 'Payments',
        icon: Icons.CreditCard,
        to: '/payroll/payments',
        requiredPermission: 'payroll.view',
      },
      {
        label: 'Payroll Reports',
        icon: Icons.ChartBar,
        to: '/payroll/reports',
        requiredPermission: 'payroll.report',
      },
    ],
  },
  {
    label: 'Settings',
    icon: Icons.Gear,
    to: '/settings/software-setup',
    children: [
      {
        label: 'Software Setup',
        icon: Icons.Sliders,
        to: '/settings/software-setup',
        requiredPermission: 'settings.manage',
      },
      {
        label: 'Work Schedule',
        icon: Icons.CalendarDays,
        to: '/hr/setup-rules',
        requiredPermission: 'hr.masters.view',
      },
      {
        label: 'Payroll Rules',
        icon: Icons.Sliders,
        to: '/settings/payroll-rules',
        requiredPermission: 'payroll.view',
      },
      {
        label: 'Salary Components',
        icon: Icons.Coins,
        to: '/settings/salary-components',
        requiredPermission: 'salary_component.view',
      },
      {
        label: 'Salary Structures',
        icon: Icons.PiggyBank,
        to: '/settings/salary-structures',
        requiredPermission: 'salary_structure.view',
      },
      {
        label: 'Activity Log',
        icon: Icons.ShieldHalved,
        to: '/settings/activity-log',
        requiredPermission: 'audit.view',
      },
      {
        label: 'Meta Audit',
        icon: Icons.Fingerprint,
        to: '/settings/meta-audit',
        requiredPermission: 'settings.manage',
      },
      {
        label: 'Appearance',
        icon: Icons.Sun,
        to: '/settings/appearance',
      },
    ],
  },
];

/** More navigation — filtered by RBAC, rendered in mobile "More" menu */
export function getMoreNavigation(_pathname: string): NavItem[] {
  const bottomSet = new Set(MOBILE_BOTTOM_NAV.map((i) => i.to));

  const result: NavItem[] = [];
  for (const item of NAVIGATION) {
    if (item.children && item.children.length > 0) {
      const children: NavItem[] = [];
      for (const child of item.children) {
        if (bottomSet.has(child.to)) continue;
        const entry: NavItem = {
          label: child.label,
          icon: child.icon,
          to: child.to,
        };
        if (child.requiredRole) entry.requiredRole = child.requiredRole;
        if (child.requiredPermission) entry.requiredPermission = child.requiredPermission;
        if (child.requiredAnyPermission) entry.requiredAnyPermission = child.requiredAnyPermission;
        if (child.employeeOnly) entry.employeeOnly = child.employeeOnly;
        children.push(entry);
      }
      if (children.length > 0) result.push({ ...item, children });
    } else {
      if (!bottomSet.has(item.to)) result.push(item);
    }
  }
  return result;
}

/** Mobile nav height constant */
export const MOBILE_NAV_HEIGHT = 72;

/** Mobile nav padding bottom for safe area */
export const MOBILE_NAV_PADDING_BOTTOM = 'env(safe-area-inset-bottom)';
