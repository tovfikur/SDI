/** True when `value` matches `YYYY-MM` and is a real calendar month. */
export function isValidMonth(value: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return year >= 1900 && year <= 2100 && month >= 1 && month <= 12;
}

/** Last day (1-31) of a `YYYY-MM` month. */
export function lastDayOfMonth(month: string): number {
  const [year, monthIndex] = month.split('-').map(Number);
  return new Date(year, monthIndex, 0).getDate();
}

/**
 * Date filter range for a `YYYY-MM` month: `YYYY-MM-01..YYYY-MM-DD`,
 * using the real last day so short months never produce an invalid date.
 */
export function monthRange(month: string): string {
  const last = lastDayOfMonth(month);
  return `${month}-01..${month}-${String(last).padStart(2, '0')}`;
}

/** Local wall-clock `YYYY-MM-DDTHH:mm` for a `datetime-local` input. */
export function toLocalDateTimeInput(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** Display `YYYY-MM` as a friendly label, e.g. `August 2026`. */
export function formatMonthLabel(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number);
  const label = new Date(year, monthIndex - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  return Number.isNaN(year) || Number.isNaN(monthIndex) ? month : label;
}
