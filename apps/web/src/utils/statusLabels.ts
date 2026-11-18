/**
 * Centralized status formatting (presentation-only).
 *
 * Backend/database values are never changed; this maps them to human-readable
 * Title Case labels for display.
 */

const STATUS_LABELS: Record<string, string> = {
  // Generic lifecycle
  active: 'Active',
  inactive: 'Inactive',
  open: 'Open',
  closed: 'Closed',
  draft: 'Draft',
  planned: 'Planned',
  scheduled: 'Scheduled',
  deleted: 'Deleted',
  assigned: 'Assigned',
  clean: 'Clean',
  // Approval-style flows
  pending: 'Pending',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  submitted: 'Submitted',
  withdrawn: 'Withdrawn',
  confirmed: 'Confirmed',
  // Task / project statuses
  todo: 'To Do',
  in_progress: 'In Progress',
  review: 'In Review',
  done: 'Done',
  blocked: 'Blocked',
  on_hold: 'On Hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
  not_started: 'Not Started',
  partially_done: 'Partially Done',
  overdue: 'Overdue',
  // Attendance
  present: 'Present',
  absent: 'Absent',
  missing: 'Missing',
  late: 'Late',
  holiday: 'Holiday',
  holidaypresent: 'Present (Holiday)',
  leave: 'Leave',
  weekend: 'Weekend',
  upcoming: 'Upcoming',
  on_duty: 'On Duty',
  checked_in: 'Checked In',
  checked_out: 'Checked Out',
  // Payments / notifications / jobs
  paid: 'Paid',
  unpaid: 'Unpaid',
  sent: 'Sent',
  delivered: 'Delivered',
  bounced: 'Bounced',
  queued: 'Queued',
  running: 'Running',
  processing: 'Processing',
  failed: 'Failed',
  dlq: 'DLQ',
  published: 'Published',
  expired: 'Expired',
  revoked: 'Revoked',
  // Payroll
  calculated: 'Calculated',
  partially_paid: 'Partially Paid',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  fixed: 'Fixed',
  percentage: 'Percentage',
  formula: 'Formula',
  earning: 'Earning',
  deduction: 'Deduction',
  nearest: 'Nearest',
  ceil: 'Ceiling',
  floor: 'Floor',
  calendar_days: 'Calendar Days',
  scheduled_working_days: 'Scheduled Working Days',
  gross_salary: 'Gross Salary',
  basic_salary: 'Basic Salary',
};

/** Human-readable label for a technical status value (null/empty → '—'). */
export function formatStatusLabel(status: string | null | undefined): string {
  if (status === null || status === undefined || String(status).trim() === '') return '—';
  const key = String(status)
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  const explicit = STATUS_LABELS[key];
  if (explicit) return explicit;
  return key
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
