import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { forgotPassword, resetPassword, verifyResetCode } from '../api';

type Step = 'email' | 'code' | 'password';

const RESEND_COOLDOWN_SECONDS = 60;

export function ForgotPasswordPage(): ReactElement {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown(Math.max(0, cooldown - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError('Please enter a valid email address.');
      return;
    }
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const res = await forgotPassword(normalized);
      setMessage(res.message);
      setStep('code');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async () => {
    const normalized = email.trim().toLowerCase();
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit verification code.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await verifyResetCode(normalized, code.trim());
      setStep('password');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code');
    } finally {
      setSubmitting(false);
    }
  };

  const submitPassword = async (e: React.FormEvent) => {
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
      await resetPassword(email.trim().toLowerCase(), code.trim(), newPassword);
      navigate('/login?reset=success', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const backToLogin = (
    <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
      <Link className="text-link" to="/login">
        ← Back to sign in
      </Link>
    </div>
  );

  return (
    <div className="login-screen">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <img src="/sdi-logo-transparent.png" alt="SDI" className="login-logo-img" />
          <div className="login-logo">SDI</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.4rem' }}>
            Reset your password
          </p>
        </div>

        {step === 'email' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
          >
            <div className="form-group">
              <label className="form-label">Registered email</label>
              <input
                type="email"
                className="form-control-clay"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="Enter your registered email"
              />
            </div>
            {message && (
              <div style={{ color: 'var(--success)', fontSize: '0.825rem', marginBottom: '1rem' }}>{message}</div>
            )}
            {error && (
              <div style={{ color: 'var(--danger)', fontSize: '0.825rem', marginBottom: '1rem' }}>{error}</div>
            )}
            <button
              className="btn-clay btn-clay-primary"
              style={{ width: '100%', minHeight: '44px' }}
              disabled={submitting}
            >
              {submitting ? 'Sending...' : 'Send verification code'}
            </button>
            {backToLogin}
          </form>
        )}

        {step === 'code' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verifyCode();
            }}
          >
            <div className="form-group">
              <label className="form-label">Verification code</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                className="form-control-clay"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="6-digit code"
                autoFocus
              />
            </div>
            {error && (
              <div style={{ color: 'var(--danger)', fontSize: '0.825rem', marginBottom: '1rem' }}>{error}</div>
            )}
            <button
              className="btn-clay btn-clay-primary"
              style={{ width: '100%', minHeight: '44px' }}
              disabled={submitting || cooldown > 0}
            >
              {submitting ? 'Verifying...' : 'Verify code'}
            </button>
            <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.825rem' }}>
              {cooldown > 0 ? (
                <span style={{ color: 'var(--text-muted)' }}>
                  Resend code in {cooldown}s
                </span>
              ) : (
                <button type="button" className="text-link" onClick={() => void sendCode()}>
                  Resend code
                </button>
              )}
            </div>
            {backToLogin}
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={(e) => void submitPassword(e)}>
            <div className="form-group">
              <label className="form-label">New password</label>
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
              <label className="form-label">Confirm password</label>
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
              {submitting ? 'Resetting...' : 'Reset password'}
            </button>
            {backToLogin}
          </form>
        )}
      </div>
    </div>
  );
}