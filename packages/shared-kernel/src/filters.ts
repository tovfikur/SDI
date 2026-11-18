/**
 * Filter / sort contract (Spec Phase 6).
 *
 * Phase 6 param shapes: `filter[field]=value`, `sort=field`, `direction=asc|desc`.
 * The same param shape is used by both list and export endpoints (closes HC-04 —
 * a single parsing layer guarantees identical selection semantics).
 * Sort fields must be validated against an allow-list per module (SEC-002).
 */

export type SortDirection = 'asc' | 'desc';

export const SORT_DIRECTIONS: readonly SortDirection[] = ['asc', 'desc'];

export interface SortParam {
  field: string;
  direction: SortDirection;
}

export type FilterOperator = 'eq' | 'like' | 'in' | 'gte' | 'lte';

export interface FilterParam {
  field: string;
  value: string;
  operator: FilterOperator;
}

const FILTER_KEY_RE = /^filter\[(.+)\]$/;

/**
 * Parses a `filter[field]=value` query object into an ordered list of filter params.
 * Unknown keys (not matching `filter[...]`) are ignored.
 *
 * Accepts both shapes Express/q s may produce:
 *  - flat keys:   `filter[status]` -> literal key `filter[status]`
 *  - nested:      `filter[status]` -> `{ filter: { status: ... } }`
 * Repeated `filter[field]` params arrive as an array under the nested shape and
 * are pushed as separate filters (e.g. gte + lte date ranges).
 *
 * Values may carry an explicit operator prefix: `like:term`, `gte:2026-01-01`,
 * `lte:...`, `in:a,b,c` (defaults to `eq`). This lets modules express range and
 * partial-match filters without changing the param contract.
 */
export function parseFilters(raw: Record<string, unknown> | undefined): FilterParam[] {
  if (!raw) {
    return [];
  }
  const filters: FilterParam[] = [];
  const push = (field: string, rawValue: unknown) => {
    if (rawValue === undefined || rawValue === null) {
      return;
    }
    const value = String(rawValue);
    const opMatch = /^(like|gte|lte|in|eq):(.*)$/.exec(value);
    if (opMatch) {
      filters.push({ field, value: opMatch[2], operator: opMatch[1] as FilterOperator });
      return;
    }
    filters.push({ field, value, operator: 'eq' });
  };
  for (const key of Object.keys(raw)) {
    const match = FILTER_KEY_RE.exec(key);
    if (match) {
      push(match[1], raw[key]);
      continue;
    }
    if (key === 'filter' && raw[key] !== null && typeof raw[key] === 'object') {
      for (const field of Object.keys(raw[key] as Record<string, unknown>)) {
        const value = (raw[key] as Record<string, unknown>)[field];
        if (Array.isArray(value)) {
          value.forEach((v) => push(field, v));
        } else {
          push(field, value);
        }
      }
    }
  }
  return filters;
}

/**
 * Parses `sort` / `direction` query params. `direction` is clamped to asc|desc (asc default).
 * Returns null when no sort field is present.
 */
export function parseSort(sortRaw: unknown, directionRaw: unknown): SortParam | null {
  if (typeof sortRaw !== 'string' || sortRaw.trim() === '') {
    return null;
  }
  const field = sortRaw.trim();
  const direction: SortDirection = directionRaw === 'desc' ? 'desc' : 'asc';
  return { field, direction };
}
