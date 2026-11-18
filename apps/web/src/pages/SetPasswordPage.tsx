import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { getMeCached, setPassword } from '../api';

export function SetPasswordPage(): ReactElement {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);
  const [redirect, setRedirect] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await getMeCached();
        if (!cancelled) {
          if (!me.authenticated) {
            setRedirect('/login');
          } else if (me.user && !me.user.mustChangePassword) {
            setRedirect('/');
          } else {
            setChecking(false);
          }
        }
      } catch {
        if (!cancelled) setRedirect('/login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await setPassword(newPassword);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setSubmitting(false);
    }
  };

  if (redirect) {
    return <Navigate to={redirect} replace />;
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <img src="/sdi-logo-transparent.png" alt="SDI" className="login-logo-img" />
          <div className="login-logo">SDI</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.4rem' }}>
            Set a new password to continue
          </p>
        </div>

        {checking ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Checking...
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)}>
            <div className="form-group">
              <label className="form-label">New Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-control-clay"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-control-clay"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Repeat new password"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <label className="text-link" style={{ cursor: 'pointer', fontSize: '0.825rem' }}>
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                  style={{ marginRight: '0.35rem' }}
                />
                Show passwords
              </label>
            </div>
            {error && (
              <div style={{ color: 'var(--danger)', fontSize: '0.825rem', marginBottom: '1rem' }}>{error}</div>
            )}
            <button
              className="btn-clay btn-clay-primary"
              style={{ width: '100%', minHeight: '44px' }}
              disabled={submitting}
            >
              {submitting ? 'Updating...' : 'Set New Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}