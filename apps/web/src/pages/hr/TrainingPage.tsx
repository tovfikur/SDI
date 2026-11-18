import type { ReactElement } from 'react';
import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { SubNav } from '../../components/SubNav';
import { Icons } from '../../components/Icon';

const TABS = [
  { to: 'programs', label: 'Training Programs', icon: Icons.GraduationCap },
  { to: 'internal', label: 'Internal Certificates', icon: Icons.FileLines },
  { to: 'external', label: 'External Certificates', icon: Icons.Globe },
];

export function TrainingPage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="Training Management"
        subtitle="Manage training programs and employee certificates."
      />
      <SubNav items={TABS} basePath="/hr/training" />
      <div style={{ marginTop: '1rem' }}>
        <Outlet />
      </div>
    </div>
  );
}
