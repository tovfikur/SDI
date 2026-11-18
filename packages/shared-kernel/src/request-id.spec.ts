import { describe, expect, it } from 'vitest';
import { generateRequestId, isValidRequestId, REQUEST_ID_HEADER } from './request-id';

describe('isValidRequestId', () => {
  it('accepts canonical UUIDs (any case)', () => {
    expect(isValidRequestId('11111111-2222-3333-4444-555555555555')).toBe(true);
    expect(isValidRequestId('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')).toBe(true);
  });

  it('rejects non-UUID values', () => {
    expect(isValidRequestId('')).toBe(false);
    expect(isValidRequestId('not-a-uuid')).toBe(false);
    expect(isValidRequestId('11111111222233334444555555555555')).toBe(false);
  });
});

describe('generateRequestId', () => {
  it('generates valid UUIDs', () => {
    expect(isValidRequestId(generateRequestId())).toBe(true);
  });

  it('generates unique values', () => {
    expect(generateRequestId()).not.toBe(generateRequestId());
  });
});

describe('REQUEST_ID_HEADER', () => {
  it('matches the Phase 6 header contract', () => {
    expect(REQUEST_ID_HEADER).toBe('x-request-id');
  });
});