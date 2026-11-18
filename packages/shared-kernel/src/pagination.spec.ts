import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE,
  DEFAULT_PER_PAGE,
  parsePagination,
  PER_PAGE_OPTIONS,
  totalPages,
} from './pagination';

describe('parsePagination (FR-003: clamp, never 500)', () => {
  it('falls back to defaults when page/per_page are missing', () => {
    const result = parsePagination(undefined, undefined);
    expect(result).toEqual({ page: DEFAULT_PAGE, per_page: DEFAULT_PER_PAGE });
  });

  it('parses valid numeric strings', () => {
    expect(parsePagination('3', '25')).toEqual({ page: 3, per_page: 25 });
  });

  it('clamps invalid page values to the default page', () => {
    expect(parsePagination('0', undefined).page).toBe(DEFAULT_PAGE);
    expect(parsePagination('-5', undefined).page).toBe(DEFAULT_PAGE);
    expect(parsePagination('abc', undefined).page).toBe(DEFAULT_PAGE);
    expect(parsePagination('2.5', undefined).page).toBe(DEFAULT_PAGE);
  });

  it('accepts numbers directly', () => {
    expect(parsePagination(2, 50)).toEqual({ page: 2, per_page: 50 });
  });

  it('clamps non-standard per_page to the default (fixed option set)', () => {
    for (const perPage of ['15', '0', '-1', '999', 'abc', 33]) {
      expect(parsePagination(undefined, perPage).per_page).toBe(DEFAULT_PER_PAGE);
    }
  });

  it('accepts every option in PER_PAGE_OPTIONS', () => {
    for (const option of PER_PAGE_OPTIONS) {
      expect(parsePagination(undefined, String(option)).per_page).toBe(option);
    }
  });
});

describe('totalPages', () => {
  it('returns 0 for an empty result set', () => {
    expect(totalPages(0, 10)).toBe(0);
  });

  it('rounds up partial pages', () => {
    expect(totalPages(11, 10)).toBe(2);
    expect(totalPages(25, 10)).toBe(3);
  });

  it('returns 1 for a result set that fits one page', () => {
    expect(totalPages(10, 10)).toBe(1);
  });
});