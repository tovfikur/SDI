import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Modal } from './Modal';

/**
 * Confirmation modal for protected (admin) deletes. Requires the Delete
 * Password (Settings → Security) before running `onConfirm`. The password is
 * kept only in component state for the single request — never persisted to
 * localStorage/sessionStorage and never reused automatically.
 */
export function ProtectedDeleteModal({
  open,
  title,
  message,
  onClose,
  onConfirm,
  submitting = false,
  danger = true,
  submitLabel = 'Delete',
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  onClose: () => void;
  onConfirm: (deletePassword: string) => Promise<void> | void;
  submitting?: boolean;
  danger?: boolean;
  submitLabel?: string;
}): ReactElement {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const confirm = async () => {
    if (password.length === 0) {
      setError('Enter the Delete Password to continue.');
      return;
    }
    setError('');
    try {
      await onConfirm(password);
      setPassword('');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Deletion failed';
      if (
        message === 'INVALID_DELETE_PASSWORD' ||
        message === 'DELETE_PASSWORD_LOCKED' ||
        message === 'DELETE_PASSWORD_NOT_SET' ||
        message === 'DELETE_REQUIRES_ADMIN'
      ) {
        setError(
          message === 'DELETE_PASSWORD_LOCKED'
            ? 'Too many failed attempts. Try again later.'
            : message === 'DELETE_PASSWORD_NOT_SET'
              ? 'No Delete Password is configured. Set one in Settings → Security.'
              : message === 'DELETE_REQUIRES_ADMIN'
                ? 'Only admins can delete.'
                : 'Invalid Delete Password.'
        );
      } else {
        setError(message);
      }
    }
  };

  return (
    <Modal
      title={title}
      open={open}
      onClose={() => {
        setPassword('');
        setError('');
        onClose();
      }}
      onSubmit={() => void confirm()}
      submitting={submitting}
      submitLabel={submitLabel}
      danger={danger}
    >
      {message}
      <div className="form-group">
        <label className="form-label">
          Delete Password <span className="form-required">*</span>
        </label>
        <input
          type="password"
          className="form-control-clay"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter the admin Delete Password"
          autoComplete="new-password"
          disabled={submitting}
        />
        <div className="form-help-text">
          Required to confirm this deletion. The password is never stored in this browser.
        </div>
      </div>
      {error && <div className="form-error-text">{error}</div>}
    </Modal>
  );
}