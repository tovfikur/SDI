/**
 * ISO-8601 date/time conventions (Spec Phase 6, NFR-008).
 *
 * Phase 6: ISO-8601 dates/timestamps in the API; timezone-aware timestamps stored,
 * converted to the org timezone for display only at the edge.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Validates an ISO date (`YYYY-MM-DD`) that is also a real calendar date.
 * Uses component round-trip because Date.parse silently rolls invalid dates (e.g. 2024-02-30).
 */
export function isIsoDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Validates an ISO datetime with explicit timezone offset or Z suffix, and a real date part.
 */
export function isIsoDateTime(value: string): boolean {
  if (!DATETIME_RE.test(value)) {
    return false;
  }
  return isIsoDate(value.slice(0, 10)) && !Number.isNaN(Date.parse(value));
}