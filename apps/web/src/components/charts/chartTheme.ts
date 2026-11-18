import { useTheme } from '../../theme-context';

export const BRAND = '#2563eb';
export const SUCCESS = '#10b981';
export const WARNING = '#f59e0b';
export const DANGER = '#ef4444';
export const NEUTRAL = '#64748b';
export const VIOLET = '#3b82f6';
export const CYAN = '#06b6d4';
export const PINK = '#ec4899';

export const PALETTE = [BRAND, SUCCESS, WARNING, DANGER, VIOLET, CYAN, NEUTRAL, PINK];

/** Semantic colors keyed by raw status value (humanized labels via statusLabels). */
export const STATUS_COLORS: Record<string, string> = {
  done: SUCCESS,
  completed: SUCCESS,
  approved: SUCCESS,
  active: SUCCESS,
  present: SUCCESS,
  paid: SUCCESS,
  sent: SUCCESS,
  published: SUCCESS,
  confirmed: SUCCESS,
  delivered: SUCCESS,
  clean: SUCCESS,
  in_progress: BRAND,
  processing: BRAND,
  running: BRAND,
  on_duty: BRAND,
  checked_in: BRAND,
  assigned: BRAND,
  open: BRAND,
  submitted: BRAND,
  queued: WARNING,
  pending: WARNING,
  review: WARNING,
  on_hold: WARNING,
  late: WARNING,
  planned: WARNING,
  scheduled: WARNING,
  withdrawn: WARNING,
  expired: WARNING,
  high: WARNING,
  blocked: DANGER,
  rejected: DANGER,
  failed: DANGER,
  absent: DANGER,
  missing: DANGER,
  overdue: DANGER,
  urgent: DANGER,
  cancelled: NEUTRAL,
  inactive: NEUTRAL,
  closed: NEUTRAL,
  draft: NEUTRAL,
  todo: NEUTRAL,
  low: NEUTRAL,
  medium: BRAND,
};

export function statusColor(value: string | null | undefined): string {
  const key = String(value ?? '').toLowerCase();
  return STATUS_COLORS[key] ?? BRAND;
}

export interface ChartTheme {
  dark: boolean;
  text: string;
  textDim: string;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  legendBg: string;
}

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  return {
    dark,
    text: dark ? '#cbd5e1' : '#475569',
    textDim: dark ? '#64748b' : '#94a3b8',
    grid: dark ? '#293548' : '#e2e8f0',
    axis: dark ? '#94a3b8' : '#94a3b8',
    tooltipBg: dark ? '#1e293b' : '#ffffff',
    tooltipBorder: dark ? '#334155' : '#e2e8f0',
    tooltipText: dark ? '#e2e8f0' : '#1e293b',
    legendBg: dark ? '#172033' : '#f8fafc',
  };
}