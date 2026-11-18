import type { ReactElement } from 'react';
import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { SubNav } from '../../components/SubNav';
import { Icons } from '../../components/Icon';

const TABS = [
  { to: 'mobile', label: 'My Attendance', icon: Icons.UserClock },
  { to: 'form', label: 'Attendance Form', icon: Icons.Clock },
  { to: 'monthly', label: 'Monthly Attendance', icon: Icons.CalendarDays },
  { to: 'custom', label: 'Custom Record', icon: Icons.Filter },
  { to: 'individual', label: 'Individual Record', icon: Icons.UserTie },
  { to: 'missing', label: 'Missing', icon: Icons.CircleQuestion },
  { to: 'pending', label: 'Pending', icon: Icons.Hourglass },
];

export function AttendancePage(): ReactElement {
  return (
    <div>
      <PageHeader title="Attendance" subtitle="Record, review and reconcile employee attendance." />
      <SubNav items={TABS} basePath="/hr/attendance" />
      <div style={{ marginTop: '1rem' }}>
        <Outlet />
      </div>
    </div>
  );
}
