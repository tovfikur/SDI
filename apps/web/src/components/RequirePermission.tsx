import type { ReactElement } from 'react';
import { useCurrentUser, hasAnyPermission } from '../auth-context';
import { AccessDeniedPage } from '../pages/AccessDeniedPage';

/**
 * Route-level RBAC guard: renders the 403 page when the user has none of the
 * required permissions. Backend authorization still applies on every API call.
 */
export function RequirePermission({
  permissions,
  children,
}: {
  permissions: string[];
  children: ReactElement;
}): ReactElement {
  const user = useCurrentUser();
  if (!hasAnyPermission(user, permissions)) {
    return <AccessDeniedPage />;
  }
  return children;
}
