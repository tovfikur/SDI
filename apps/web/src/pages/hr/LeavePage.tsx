import type { ReactElement } from 'react';
import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { SubNav } from '../../components/SubNav';
import { Icons } from '../../components/Icon';

const TABS = [
  { to: 'applications', label: 'Applications', icon: Icons.FilePen },
  { to: 'types', label: 'Leave Types', icon: Icons.Tag },
  { to: 'balances', label: 'Leave Balances', icon: Icons.ScaleBalanced },
  { to: 'short-leaves', label: 'Short Leaves', icon: Icons.Clock },
];

export function LeavePage(): ReactElement {
  return (
    <div>
      <PageHeader title="Leave Management" subtitle="Apply, approve and track employee leave." />
      <SubNav items={TABS} basePath="/hr/leave" />
      <div style={{ marginTop: '1rem' }}>
        <Outlet />
      </div>
    </div>
  );
}
