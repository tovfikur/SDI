import { describe, it, expect } from 'vitest';
import { haversineDistanceMeters } from './field-tracking';

describe('haversineDistanceMeters', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineDistanceMeters(23.8103, 90.4125, 23.8103, 90.4125)).toBe(0);
  });

  it('matches a known distance (~111 km per degree of latitude)', () => {
    const d = haversineDistanceMeters(23.81, 90.41, 24.81, 90.41);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('treats east-west distance as latitude-scaled', () => {
    const d = haversineDistanceMeters(23.81, 90.41, 23.81, 91.41);
    expect(d).toBeGreaterThan(100_000);
    expect(d).toBeLessThan(111_000);
  });

  it('is symmetric', () => {
    const a = haversineDistanceMeters(23.78, 90.4, 23.781, 90.401);
    const b = haversineDistanceMeters(23.781, 90.401, 23.78, 90.4);
    expect(a).toBe(b);
  });

  it('detects ~150 m offset used in check-in verification', () => {
    const d = haversineDistanceMeters(23.781, 90.401, 23.78, 90.4);
    expect(d).toBeGreaterThan(140);
    expect(d).toBeLessThan(165);
  });
});