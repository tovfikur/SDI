import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Icon, Icons } from '../components/Icon';

export function AccessDeniedPage(): ReactElement {
  return (
    <div className="access-denied" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'var(--danger-soft, #fee2e2)',
          color: 'var(--danger, #dc2626)',
          fontSize: '1.6rem',
          marginBottom: '1rem',
        }}
      >
        <Icon icon={Icons.ShieldHalved} />
      </div>
      <h2 style={{ margin: '0 0 0.5rem', color: 'var(--text-main)' }}>Access Denied</h2>
      <p style={{ margin: '0 0 1.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
        You do not have permission to view this page.
      </p>
      <Link
        to="/"
        className="btn-clay btn-clay-primary"
        style={{ textDecoration: 'none', display: 'inline-block' }}
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
