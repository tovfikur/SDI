import type { ReactElement } from 'react';
import { useCurrentUser, isAdminUser } from '../auth-context';
import { DashboardPage } from './DashboardPage';
import { EmployeeDashboardPage } from './self/EmployeeDashboardPage';

/**
 * Landing page dispatcher: users with a linked employee profile who are not
 * admins get the employee self-service dashboard; everyone else keeps the
 * legacy admin dashboard.
 */
export function HomePage(): ReactElement {
  const user = useCurrentUser();
  const isEmployee = Boolean(user?.employeeId) && !isAdminUser(user);
  return isEmployee ? <EmployeeDashboardPage /> : <DashboardPage />;
}