/**
 * Pagination contract (Spec Phase 6) and FR-003 list behavior.
 *
 * Phase 6: pagination is `page`, `per_page`; response includes `total`, `total_pages`.
 * FR-003: page-size from a fixed set (10/25/50/100, Assumption); invalid page/filter must be
 * clamped to a valid range, never 500.
 */

export const DEFAULT_PAGE = 1;
export const DEFAULT_PER_PAGE = 10;
export const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
export type PerPageOption = (typeof PER_PAGE_OPTIONS)[number];

export interface PaginationParams {
  page: number;
  per_page: PerPageOption;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  per_page: PerPageOption;
  total: number;
  total_pages: number;
}

function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) {
    return raw;
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    const n = Number(raw);
    return n >= 1 ? n : null;
  }
  return null;
}

/**
 * Parses and clamps raw `page` / `per_page` query values to the FR-003 contract.
 * Invalid or missing values fall back to defaults; non-standard page sizes are
 * clamped to the fixed set (never error).
 */
export function parsePagination(pageRaw: unknown, perPageRaw: unknown): PaginationParams {
  const page = parsePositiveInt(pageRaw) ?? DEFAULT_PAGE;
  const perPageCandidate = parsePositiveInt(perPageRaw) ?? DEFAULT_PER_PAGE;
  const per_page = PER_PAGE_OPTIONS.includes(perPageCandidate as PerPageOption)
    ? (perPageCandidate as PerPageOption)
    : DEFAULT_PER_PAGE;
  return { page, per_page };
}

/**
 * Computes total_pages for a PaginatedResponse.
 */
export function totalPages(total: number, perPage: PerPageOption): number {
  if (total <= 0) {
    return 0;
  }
  return Math.ceil(total / perPage);
}
