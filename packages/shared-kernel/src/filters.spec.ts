import { describe, expect, it } from 'vitest';
import { parseFilters, parseSort } from './filters';

describe('parseFilters (filter[field]=value)', () => {
  it('returns an empty list when no filters are provided', () => {
    expect(parseFilters(undefined)).toEqual([]);
  });

  it('parses filter[field]=value entries', () => {
    const result = parseFilters({ 'filter[department]': 'engineering', 'filter[status]': 'active' });
    expect(result).toEqual([
      { field: 'department', value: 'engineering', operator: 'eq' },
      { field: 'status', value: 'active', operator: 'eq' },
    ]);
  });

  it('ignores non-filter keys and null/undefined values', () => {
    const result = parseFilters({ page: '2', 'filter[name]': null, 'filter[code]': undefined });
    expect(result).toEqual([]);
  });
});

describe('parseSort (sort + direction)', () => {
  it('returns null when no sort field is present', () => {
    expect(parseSort(undefined, 'asc')).toBeNull();
    expect(parseSort('  ', 'asc')).toBeNull();
  });

  it('defaults direction to asc', () => {
    expect(parseSort('name', undefined)).toEqual({ field: 'name', direction: 'asc' });
  });

  it('parses desc direction explicitly', () => {
    expect(parseSort('name', 'desc')).toEqual({ field: 'name', direction: 'desc' });
  });

  it('clamps any non-desc direction to asc', () => {
    expect(parseSort('name', 'sideways')).toEqual({ field: 'name', direction: 'asc' });
  });
});