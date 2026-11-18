import { describe, it, expect } from 'vitest';
import {
  parseTimeToMinutes,
  shiftMinutes,
  isOvernightShift,
  isValidDayKeys,
  normalizeSetupRuleInput,
} from './setup-rules';

describe('parseTimeToMinutes', () => {
  it('parses valid times', () => {
    expect(parseTimeToMinutes('09:00')).toBe(540);
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
  });

  it('rejects invalid times', () => {
    expect(parseTimeToMinutes('24:00')).toBe(-1);
    expect(parseTimeToMinutes('9:00')).toBe(-1);
    expect(parseTimeToMinutes('09:60')).toBe(-1);
    expect(parseTimeToMinutes('')).toBe(-1);
    expect(parseTimeToMinutes('abc')).toBe(-1);
  });
});

describe('shiftMinutes', () => {
  it('computes normal shifts', () => {
    expect(shiftMinutes('09:00', '18:00')).toBe(540);
    expect(shiftMinutes('08:30', '17:00')).toBe(510);
  });

  it('supports overnight shifts where end <= start', () => {
    expect(shiftMinutes('22:00', '06:00')).toBe(480);
    expect(shiftMinutes('23:00', '07:00')).toBe(480);
    expect(shiftMinutes('20:00', '20:00')).toBe(1440); // 24h
  });

  it('returns 0 for invalid input', () => {
    expect(shiftMinutes('bad', '18:00')).toBe(0);
  });
});

describe('isOvernightShift', () => {
  it('flags overnight when end is earlier than start', () => {
    expect(isOvernightShift('22:00', '06:00')).toBe(true);
    expect(isOvernightShift('09:00', '18:00')).toBe(false);
  });
});

describe('isValidDayKeys', () => {
  it('accepts full set and subsets', () => {
    expect(isValidDayKeys(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'])).toBe(true);
    expect(isValidDayKeys(['sun', 'thu'])).toBe(true);
  });

  it('rejects empty, unknown, and non-array values', () => {
    expect(isValidDayKeys([])).toBe(false);
    expect(isValidDayKeys(['sunday'])).toBe(false);
    expect(isValidDayKeys(null)).toBe(false);
    expect(isValidDayKeys(undefined)).toBe(false);
    expect(isValidDayKeys('sun')).toBe(false);
  });
});

describe('normalizeSetupRuleInput', () => {
  it('maps raw body to DB-ready input', () => {
    const v = normalizeSetupRuleInput({
      title: '  Night Shift  ',
      employee_type_id: 'abc',
      work_pattern: 'Shift',
      daily_working_hour: '8.5',
      office_start_time: '22:00',
      office_end_time: '06:00',
      grace_period_minutes: '10',
      working_days: ['sun', 'mon', 'tue', 'wed', 'thu', 'sat', 'fri'],
      auto_calc_hours: true,
      is_active: true,
    });
    expect(v.title).toBe('Night Shift');
    expect(v.employee_type_id).toBe('abc');
    expect(v.work_pattern).toBe('Shift');
    expect(v.daily_working_hour).toBe(8.5);
    expect(v.grace_period_minutes).toBe(10);
    expect(v.auto_calc_hours).toBe(true);
  });

  it('coerces numeric strings and booleans', () => {
    const v = normalizeSetupRuleInput({
      title: 'X',
      grace_period_minutes: '0',
      daily_working_hour: '9',
      auto_calc_hours: 'false',
      is_active: false,
    });
    expect(v.grace_period_minutes).toBe(0);
    expect(v.daily_working_hour).toBe(9);
    expect(v.auto_calc_hours).toBe(false);
    expect(v.is_active).toBe(false);
  });

  it('defaults employee_type_id to null when empty', () => {
    const v = normalizeSetupRuleInput({ title: 'X', employee_type_id: '' });
    expect(v.employee_type_id).toBeNull();
  });
});