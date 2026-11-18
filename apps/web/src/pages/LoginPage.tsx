import { useEffect, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { API_BASE, getBranding, getMeCached, login } from '../api';
import { Icon, Icons } from '../components/Icon';

export function LoginPage(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);
  const [alreadyAuthed, setAlreadyAuthed] = useState(false);
  const [bgUrl, setBgUrl] = useState<string | null>(null);

  const resetSuccess = new URLSearchParams(location.search).get('reset') === 'success';

  const resolveBgUrl = (stored: string): string => {
    if (/^https?:\/\//i.test(stored)) return stored;
    if (stored.startsWith('/')) return `${API_BASE}${stored}`;
    return `${API_BASE}/${stored}`;
  };

  const bgStyle: CSSProperties | undefined = bgUrl
    ? {
        backgroundImage: `url("${resolveBgUrl(bgUrl)}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
      }
    : undefined;

  useEffect(() => {
    let cancelled = false;
    getBranding()
      .then((res) => {
        if (!cancelled && res.data.login_bg_url) {
          setBgUrl(res.data.login_bg_url);
        }
      })
      .catch(() => {
        /* keep gradient fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const destination = !from || from === '/login' ? '/' : from;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await getMeCached();
        if (!cancelled && me.authenticated && me.user) {
          setAlreadyAuthed(true);
        }
      } catch {
        /* not authenticated — show login form */
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Username and password are required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const data = await login(username, password);
      if (data.mustChangePassword) {
        navigate('/set-password', { replace: true });
        return;
      }
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className={bgUrl ? 'login-screen login-screen-has-bg' : 'login-screen'} style={bgStyle}>
        {bgUrl && <div className="login-bg-overlay" />}
        <div className="login-card">
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Loading...
          </div>
        </div>
      </div>
    );
  }

  if (alreadyAuthed) {
    return <Navigate to={destination} replace />;
  }

  return (
    <div className={bgUrl ? 'login-screen login-screen-has-bg' : 'login-screen'} style={bgStyle}>
      {bgUrl && <div className="login-bg-overlay" />}
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <img src="/sdi-logo-transparent.png" alt="SDI" className="login-logo-img" />
          <div className="login-logo">SDI</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.4rem' }}>
            Self Development Initiatives
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <input
              type="text"
              className="form-control-clay"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="Enter your username"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-control-clay"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter your password"
                style={{ paddingRight: '2.75rem' }}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((s) => !s)}
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <Icon icon={Icons.Hide} /> : <Icon icon={Icons.View} />}
              </button>
            </div>
          </div>

          {resetSuccess && (
            <div
              style={{
                background: 'rgba(22, 163, 74, 0.12)',
                border: '1px solid rgba(22, 163, 74, 0.35)',
                color: 'var(--success)',
                borderRadius: '8px',
                padding: '0.6rem 0.85rem',
                fontSize: '0.85rem',
                marginBottom: '1rem',
                textAlign: 'center',
              }}
            >
              Password reset successfully. Please sign in.
            </div>
          )}

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: '0.825rem', marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          <button
            className="btn-clay btn-clay-primary"
            style={{ width: '100%', minHeight: '44px' }}
            disabled={submitting}
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          <Link className="text-link" to="/forgot-password">
            Forgot password?
          </Link>
        </div>
      </div>
    </div>
  );
}
