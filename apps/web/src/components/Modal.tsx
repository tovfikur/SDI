import type { ReactNode } from 'react';
import { Icon, Icons } from './Icon';

interface ModalProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  onSubmit?: () => void;
  submitting?: boolean;
  submitLabel?: string;
  busyLabel?: string;
  danger?: boolean;
  wide?: boolean;
  narrow?: boolean;
  footer?: ReactNode;
}

export function Modal({
  title,
  open,
  onClose,
  children,
  onSubmit,
  submitting,
  submitLabel = 'Save',
  busyLabel = 'Saving...',
  danger,
  wide,
  narrow,
  footer,
}: ModalProps) {
  if (!open) return null;
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (submitting) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal-content-clay ${wide ? 'modal-content-wide' : ''} ${narrow ? 'modal-content-narrow' : ''}`}
      >
        <div className="bottom-sheet-handle" />
        <div className="modal-header-clay">
          <div className="modal-title-clay">{title}</div>
          <button
            className="modal-close-btn"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <Icon icon={Icons.Close} size="xs" />
          </button>
        </div>
        <div className="modal-body-clay">{children}</div>
        <div className="modal-footer-clay">
          {footer ?? (
            <>
              <button
                className="btn-clay btn-clay-secondary"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              {onSubmit && (
                <button
                  className={`btn-clay ${danger ? 'btn-clay-danger' : 'btn-clay-primary'}`}
                  onClick={onSubmit}
                  disabled={submitting}
                >
                  {submitting && <span className="btn-spinner" aria-hidden="true" />}
                  {submitting ? busyLabel : submitLabel}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
