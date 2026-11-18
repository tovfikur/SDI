import { describe, expect, it } from 'vitest';
import { isIsoDate, isIsoDateTime } from './iso8601';

describe('isIsoDate', () => {
  it('accepts real calendar dates', () => {
    expect(isIsoDate('2026-08-15')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
  });

  it('rejects malformed or impossible dates', () => {
    expect(isIsoDate('2024-02-30')).toBe(false);
    expect(isIsoDate('15-08-2026')).toBe(false);
    expect(isIsoDate('2026-8-15')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});

describe('isIsoDateTime', () => {
  it('accepts timezone-aware timestamps', () => {
    expect(isIsoDateTime('2026-08-15T10:30:00Z')).toBe(true);
    expect(isIsoDateTime('2026-08-15T10:30:00+02:00')).toBe(true);
    expect(isIsoDateTime('2026-08-15T10:30:00.123Z')).toBe(true);
  });

  it('rejects timestamps without an explicit zone and malformed values', () => {
    expect(isIsoDateTime('2026-08-15T10:30:00')).toBe(false);
    expect(isIsoDateTime('2026-08-15')).toBe(false);
    expect(isIsoDateTime('2026-08-15T10:30:00Z extra')).toBe(false);
  });
});