import { describe, it, expect } from 'vitest';
import { calculateDay, weekdayKey, isOvernightShift } from './calculation';
import type { SetupRuleForCalc } from './calculation';

function rule(overrides: Partial<SetupRuleForCalc> = {}): SetupRuleForCalc {
  return {
    office_start_time: '09:00',
    office_end_time: '18:00',
    grace_period_minutes: 15,
    working_days: ['sun', 'mon', 'tue', 'wed', 'thu'],
    ...overrides,
  };
}

function ev(hour: number, minute = 0): { event_time: string } {
  return { event_time: `2026-08-17T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+06:00` };
}

const WORK_DAY = '2026-08-17'; // Monday
const OFF_DAY = '2026-08-15'; // Saturday

describe('weekdayKey', () => {
  it('maps dates to lowercase day keys', () => {
    expect(weekdayKey('2026-08-17')).toBe('mon');
    expect(weekdayKey('2026-08-15')).toBe('sat');
    expect(weekdayKey('2026-08-16')).toBe('sun');
    expect(weekdayKey('2026-08-21')).toBe('fri');
  });
});

describe('isOvernightShift', () => {
  it('detects overnight shifts', () => {
    expect(isOvernightShift('22:00', '06:00')).toBe(true);
    expect(isOvernightShift('09:00', '18:00')).toBe(false);
  });
});

describe('calculateDay — working/off days', () => {
  it('marks no-events off day as NoData (not Absent)', () => {
    const res = calculateDay({
      date: OFF_DAY,
      events: [],
      setupRule: rule(),
      isHoliday: false,
      hasApprovedLeave: false,
    });
    expect(res.status).toBe('NoData');
  });

  it('marks no-events working day as Absent', () => {
    const res = calculateDay({
      date: WORK_DAY,
      events: [],
      setupRule: rule(),
      isHoliday: false,
      hasApprovedLeave: false,
    });
    expect(res.status).toBe('Absent');
  });

  it('marks off-day with events as Present (not Late)', () => {
    const res = calculateDay({
      date: OFF_DAY,
      events: [ev(11, 30), ev(15, 0)],
      setupRule: rule(),
      isHoliday: false,
      hasApprovedLeave: false,
    });
    expect(res.status).toBe('Present');
    expect(res.late_minutes).toBe(0);
    expect(res.first_in).toBe('11:30');
    expect(res.last_out).toBe('15:00');
  });

  it('falls back to working every day when working_days is empty', () => {
    const res = calculateDay({
      date: OFF_DAY,
      events: [],
      setupRule: rule({ working_days: [] }),
      isHoliday: false,
      hasApprovedLeave: false,
    });
    expect(res.status).toBe('Absent');
  });
});

describe('calculateDay — on-time / late', () => {
  it('marks early arrival as Present', () => {
    const res = calculateDay({
      date: WORK_DAY,
      events: [ev(8, 55), ev(17, 55)],
      setupRule: rule(),
      isHoliday: false,
      hasApprovedLeave: false,
    });
    expect(res.status).toBe('Present');
    expect(res.late_minutes).toBe(0);
  });

  it('marks arrival within grace as Present', () => {
    const res = calculateDay({
      date: WORK_DAY,
      events: [ev(9, 10), ev(17, 55)],
      setupRule: rule(),
      isHoliday: false,
      hasApprovedLeave: false,
    });
    expect(res.status).toBe('Present');
  });

  it('marks arrival after grace as Late with minutes', () => {
    const res = calculateDay({
      date: WORK_DAY,
      events: [ev(9, 30), ev(17, 55)],
      setupRule: rule(),
      isHoliday: false,
      hasApprovedLeave: false,
    });
    expect(res.status).toBe('Late');
    expect(res.late_minutes).toBe(15);
  });

  it('marks single event as Missing', () => {
    const res = calculateDay({
      date: WORK_DAY,
      events: [ev(9, 0)],
      setupRule: rule(),
      isHoliday: false,
      hasApprovedLeave: false,
    });
    expect(res.status).toBe('Missing');
  });
});

describe('calculateDay — overnight shifts', () => {
  const night = rule({ office_start_time: '22:00', office_end_time: '06:00', grace_period_minutes: 15, working_days: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] });

  it('computes total minutes spanning midnight', () => {
    const res = calculateDay({
      date: WORK_DAY,
      events: [
        { event_time: '2026-08-17T22:00:00+06:00' },
        { event_time: '2026-08-18T05:30:00+06:00' },
      ],
      setupRule: night,
      isHoliday: false,
      hasApprovedLeave: false,
    });
    expect(res.status).toBe('Present');
    expect(res.total_work_minutes).toBe(450); // 22:00 -> 05:30 next day
  });

  it('marks post-midnight check-in as Late against previous-day start', () => {
    const res = calculateDay({
      date: WORK_DAY,
      events: [
        { event_time: '2026-08-18T00:30:00+06:00' },
        { event_time: '2026-08-18T05:30:00+06:00' },
      ],
      setupRule: night,
      isHoliday: false,
      hasApprovedLeave: false,
    });
    // 00:30 is 2h30m after 22:00 start minus 15m grace
    expect(res.status).toBe('Late');
    expect(res.late_minutes).toBe(135);
  });

  it('does not double-count non-overnight shift minutes', () => {
    const res = calculateDay({
      date: WORK_DAY,
      events: [ev(9, 0), ev(18, 0)],
      setupRule: rule(),
      isHoliday: false,
      hasApprovedLeave: false,
    });
    expect(res.total_work_minutes).toBe(540);
  });
});

describe('calculateDay — holiday and leave precedence', () => {
  it('holiday without events stays NoData even on working day', () => {
    const res = calculateDay({
      date: WORK_DAY,
      events: [],
      setupRule: rule(),
      isHoliday: true,
      hasApprovedLeave: false,
    });
    expect(res.status).toBe('NoData');
  });

  it('approved leave wins over attendance events', () => {
    const res = calculateDay({
      date: WORK_DAY,
      events: [ev(9, 0), ev(18, 0)],
      setupRule: rule(),
      isHoliday: false,
      hasApprovedLeave: true,
    });
    expect(res.status).toBe('Leave');
  });
});