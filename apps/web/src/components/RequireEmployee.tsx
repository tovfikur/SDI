import type { ReactElement } from 'react';
import { useCurrentUser } from '../auth-context';
import { AccessDeniedPage } from '../pages/AccessDeniedPage';

/**
 * Route-level guard for employee self-service pages (/me/*).
 * Renders the 403 page when the user has no linked employee record.
 * Backend still scopes all data to the authenticated user's own employeeId.
 */
export function RequireEmployee({ children }: { children: ReactElement }): ReactElement {
  const user = useCurrentUser();
  if (!user?.employeeId) {
    return <AccessDeniedPage />;
  }
  return children;
}
