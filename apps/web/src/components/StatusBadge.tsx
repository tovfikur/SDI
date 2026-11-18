import { formatStatusLabel } from '../utils/statusLabels';

const TONE_MAP: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  active: 'success',
  approved: 'success',
  completed: 'success',
  done: 'success',
  present: 'success',
  sent: 'success',
  paid: 'success',
  published: 'success',
  clean: 'success',
  confirmed: 'success',
  delivered: 'success',
  assigned: 'info',
  in_progress: 'info',
  processing: 'info',
  running: 'info',
  open: 'info',
  todo: 'info',
  queued: 'warning',
  pending: 'warning',
  submitted: 'warning',
  review: 'warning',
  on_hold: 'warning',
  late: 'warning',
  expired: 'warning',
  withdrawn: 'warning',
  planned: 'warning',
  scheduled: 'warning',
  holiday: 'info',
  leave: 'info',
  blocked: 'danger',
  rejected: 'danger',
  deleted: 'danger',
  failed: 'danger',
  absent: 'danger',
  missing: 'danger',
  overdue: 'danger',
  revoked: 'danger',
  bounced: 'danger',
  dlq: 'danger',
  weekend: 'neutral',
  upcoming: 'neutral',
  inactive: 'neutral',
  cancelled: 'neutral',
  closed: 'neutral',
  draft: 'neutral',
  cancelled_alt: 'neutral',
  calculated: 'info',
  unpaid: 'warning',
  bank_transfer: 'info',
  cheque: 'info',
};

export function StatusBadge({ value }: { value: string | boolean | null | undefined }) {
  if (value === null || value === undefined || value === '') return <span className="badge-clay">—</span>;
  const raw = String(value).toLowerCase();
  const tone = TONE_MAP[raw] ?? 'info';
  const className =
    tone === 'success'
      ? 'badge-clay-success'
      : tone === 'warning'
        ? 'badge-clay-warning'
        : tone === 'danger'
          ? 'badge-clay-danger'
          : tone === 'info'
            ? 'badge-clay-info'
            : 'badge-clay';
  return <span className={className}>{formatStatusLabel(raw)}</span>;
}
