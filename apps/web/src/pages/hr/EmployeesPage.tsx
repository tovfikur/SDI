import type { ReactElement } from 'react';
import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { SubNav } from '../../components/SubNav';
import { Icons } from '../../components/Icon';

const TABS = [
  { to: '', label: 'Employee', icon: Icons.UserTie },
  { to: 'positions', label: 'Position', icon: Icons.Briefcase },
  { to: 'types', label: 'Employee Type', icon: Icons.Tag },
  { to: 'transfer-out', label: 'Transfer Out', icon: Icons.RightFromBracket },
  { to: 'transfer-in', label: 'Transfer In', icon: Icons.RightToBracket },
  { to: 'inactive', label: 'Inactive', icon: Icons.Ban },
];

export function EmployeesPage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="Employee Management"
        subtitle="Manage employees, positions, employee types and transfers."
      />
      <SubNav items={TABS} basePath="/hr/employees" />
      <div style={{ marginTop: '1rem' }}>
        <Outlet />
      </div>
    </div>
  );
}
