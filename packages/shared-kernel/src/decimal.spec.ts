import { describe, expect, it } from 'vitest';
import { isValidDecimal, toDecimalString } from './decimal';

describe('isValidDecimal (NFR-008 decimal-as-string)', () => {
  it('accepts integers and decimals', () => {
    expect(isValidDecimal('0')).toBe(true);
    expect(isValidDecimal('42')).toBe(true);
    expect(isValidDecimal('3.14')).toBe(true);
    expect(isValidDecimal('-7.5')).toBe(true);
  });

  it('rejects non-canonical forms', () => {
    expect(isValidDecimal('1e3')).toBe(false);
    expect(isValidDecimal('1.2.3')).toBe(false);
    expect(isValidDecimal('')).toBe(false);
    expect(isValidDecimal('abc')).toBe(false);
    expect(isValidDecimal(' 1 ')).toBe(false);
    expect(isValidDecimal('.5')).toBe(false);
    expect(isValidDecimal('NaN')).toBe(false);
  });
});

describe('toDecimalString', () => {
  it('serializes finite numbers', () => {
    expect(toDecimalString(42)).toBe('42');
    expect(toDecimalString(3.5)).toBe('3.5');
  });

  it('throws on non-finite input', () => {
    expect(() => toDecimalString(Number.NaN)).toThrow(TypeError);
    expect(() => toDecimalString(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => toDecimalString(Number.NEGATIVE_INFINITY)).toThrow(TypeError);
  });
});