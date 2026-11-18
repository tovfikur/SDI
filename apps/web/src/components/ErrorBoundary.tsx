import { Component } from 'react';
import { useRouteError } from 'react-router-dom';
import type { ErrorInfo, ReactNode } from 'react';
import { Icon, Icons } from './Icon';

export function ErrorFallbackInner({ error }: { error?: unknown }) {
  if (error !== undefined && error !== null) {
    // eslint-disable-next-line no-console
    console.error('[App ErrorBoundary]', error);
  }
  return (
    <div className="panel-clay report-state-panel">
      <div className="empty-state">
        <div className="empty-state-icon">
          <Icon icon={Icons.Warning} size="xl" />
        </div>
        <div className="empty-state-title">Something went wrong</div>
        <div className="empty-state-hint">
          Something went wrong while loading this page. Please try again.
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
          <button className="btn-clay btn-clay-primary" onClick={() => window.location.reload()}>
            Retry
          </button>
          <button
            className="btn-clay btn-clay-secondary"
            onClick={() => (window.location.href = '/')}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** When any value in this array changes, the error state is reset. */
  resetKeys?: unknown[];
}

export class ErrorBoundary extends Component<Props> {
  override state: { hasError: boolean; error: unknown } = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error };
  }

  static getDerivedStateFromProps(props: Props, state: { hasError: boolean }) {
    if (state.hasError && props.resetKeys) {
      const prevKeys = (state as Record<string, unknown>)._prevResetKeys as unknown[] | undefined;
      if (!prevKeys || props.resetKeys.some((key, i) => key !== prevKeys[i])) {
        return { hasError: false, error: null, _prevResetKeys: props.resetKeys };
      }
    }
    return { _prevResetKeys: props.resetKeys };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[App ErrorBoundary]', error, info);
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return <>{this.props.fallback}</>;
      }
      return <ErrorFallbackInner error={this.state.error} />;
    }
    return this.props.children;
  }
}

/** Hook form for the route-level errorElement (React Router v6). */
export function ErrorElement() {
  const error = useRouteError();
  return <ErrorFallbackInner error={error} />;
}
