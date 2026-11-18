import type { ReactElement, ReactNode } from 'react';
import { formatStatusLabel } from '../../utils/statusLabels';

/** Shared empty state — never render a broken graph when there is no data. */
export function AnalyticsEmptyState({
  message = 'No data available for this period.',
}: {
  message?: string;
}): ReactElement {
  return (
    <div className="analytics-empty">
      <span className="analytics-empty-icon" aria-hidden="true">
        ◌
      </span>
      <span className="analytics-empty-text">{message}</span>
    </div>
  );
}

/** Loading placeholder — no "0, 0, 0" flashes before data arrives. */
export function ChartSkeleton(): ReactElement {
  return (
    <div className="chart-skeleton" aria-busy="true" aria-label="Loading chart">
      <div className="chart-skeleton-line" style={{ width: '38%' }} />
      <div className="chart-skeleton-bars">
        <span style={{ height: '55%' }} />
        <span style={{ height: '80%' }} />
        <span style={{ height: '45%' }} />
        <span style={{ height: '95%' }} />
        <span style={{ height: '65%' }} />
        <span style={{ height: '75%' }} />
        <span style={{ height: '50%' }} />
      </div>
    </div>
  );
}

export function ChartCard({
  title,
  subtitle,
  actions,
  loading = false,
  empty = false,
  emptyMessage,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={`analytics-card${className ? ` ${className}` : ''}`}>
      <div className="analytics-card-head">
        <div className="analytics-card-titles">
          <h3 className="analytics-card-title">{title}</h3>
          {subtitle && <p className="analytics-card-sub">{subtitle}</p>}
        </div>
        {actions && <div className="analytics-card-actions">{actions}</div>}
      </div>
      <div className="analytics-card-body">
        {loading ? (
          <ChartSkeleton />
        ) : empty ? (
          <AnalyticsEmptyState {...(emptyMessage ? { message: emptyMessage } : {})} />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/** Themed recharts tooltip with humanized labels. */
export function ChartTooltip({
  active,
  payload,
  label,
  labelMap,
  valueFormatter,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string }>;
  label?: string | number;
  labelMap?: Record<string, string>;
  valueFormatter?: (value: number | string, name: string) => string;
}): ReactElement | null {
  if (!active || !payload || payload.length === 0) return null;
  const humanize = (name: string | undefined): string =>
    name == null ? '' : (labelMap?.[name] ?? formatStatusLabel(name));
  return (
    <div className="chart-tooltip">
      {label != null && label !== '' && (
        <div className="chart-tooltip-label">{humanize(String(label))}</div>
      )}
      {payload.map((entry, i) => (
        <div key={`${entry.dataKey ?? entry.name ?? i}`} className="chart-tooltip-row">
          <span className="chart-tooltip-dot" style={{ background: entry.color }} />
          <span className="chart-tooltip-name">{humanize(entry.name)}</span>
          <strong className="chart-tooltip-value">
            {valueFormatter ? valueFormatter(entry.value ?? 0, entry.name ?? '') : String(entry.value ?? 0)}
          </strong>
        </div>
      ))}
    </div>
  );
}

/** Themed legend row (also used as clickable segment list for donuts). */
export function ChartLegend({
  items,
  onItemClick,
}: {
  items: Array<{ key: string; label?: string; color: string; value?: number | string }>;
  onItemClick?: (key: string) => void;
}): ReactElement {
  return (
    <div className="chart-legend">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className="chart-legend-item"
          onClick={onItemClick ? () => onItemClick(item.key) : undefined}
          title={onItemClick ? `Filter by ${item.label ?? formatStatusLabel(item.key)}` : undefined}
        >
          <span className="chart-legend-dot" style={{ background: item.color }} />
          <span className="chart-legend-label">{item.label ?? formatStatusLabel(item.key)}</span>
          {item.value !== undefined && <span className="chart-legend-value">{String(item.value)}</span>}
        </button>
      ))}
    </div>
  );
}