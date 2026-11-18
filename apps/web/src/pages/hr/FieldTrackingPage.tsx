import type { ReactElement } from 'react';
import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { SubNav } from '../../components/SubNav';
import { Icons } from '../../components/Icon';

const TABS = [
  { to: '', label: 'Live Tracking', icon: Icons.MapLocationDot },
  { to: 'route-history', label: 'Route History', icon: Icons.Route },
];

export function FieldTrackingPage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="Field Force Tracking"
        subtitle="Live location and route history of field employees."
      />
      <SubNav items={TABS} basePath="/hr/field-tracking" />
      <div style={{ marginTop: '1rem' }}>
        <Outlet />
      </div>
    </div>
  );
}
