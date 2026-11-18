import { describe, expect, it } from 'vitest';
import {
  computeTodayKPIs,
  computeLoanRecovery,
  computeAttention,
  computeHiresByPosition,
} from './hr-dashboard';
import type { Candidate } from './hr-dashboard';

describe('computeTodayKPIs (HR dashboard today metrics)', () => {
  const base = { totalActive: 100, today: [], pendingLeaveRequests: 3, newHires30: 5 };

  it('present today = Present + Late, absent = Absent + Missing', () => {
    const k = computeTodayKPIs({
      ...base,
      today: [
        { status: 'Present', n: 40 },
        { status: 'Late', n: 5 },
        { status: 'Absent', n: 3 },
        { status: 'Missing', n: 2 },
        { status: 'Leave', n: 4 },
      ],
    });
    expect(k.presentToday).toBe(45);
    expect(k.lateToday).toBe(5);
    expect(k.absentToday).toBe(5);
    expect(k.onLeaveToday).toBe(4);
    expect(k.totalActive).toBe(100);
    expect(k.pendingLeaveRequests).toBe(3);
    expect(k.newHires30).toBe(5);
  });

  it('zeroes out when no attendance rows exist', () => {
    const k = computeTodayKPIs(base);
    expect(k.presentToday).toBe(0);
    expect(k.lateToday).toBe(0);
    expect(k.absentToday).toBe(0);
    expect(k.onLeaveToday).toBe(0);
  });

  it('ignores unknown statuses and string counts', () => {
    const k = computeTodayKPIs({
      ...base,
      today: [
        { status: 'Present', n: '12' },
        { status: 'Holiday', n: 50 },
      ],
    });
    expect(k.presentToday).toBe(12);
    expect(k.lateToday).toBe(0);
  });
});

describe('computeLoanRecovery (loan repayment aggregation)', () => {
  it('computes progress from paid vs total installments', () => {
    const r = computeLoanRecovery({
      active_loans: 2,
      active_amount: 50000,
      total_payable: 55000,
      paid_total: 22000,
      paid_this_month: 5000,
      outstanding: 33000,
      overdue_count: 1,
      overdue_amount: 3000,
      installment_count: 12,
      paid_count: 6,
    });
    expect(r.progress_pct).toBe(50);
    expect(r.active_loans).toBe(2);
    expect(r.paid_this_month).toBe(5000);
    expect(r.overdue_count).toBe(1);
  });

  it('handles empty aggregate without NaN', () => {
    const r = computeLoanRecovery({});
    expect(r.progress_pct).toBe(0);
    expect(r.installment_count).toBe(0);
    expect(Number.isNaN(r.progress_pct)).toBe(false);
  });

  it('all installments paid → 100%', () => {
    const r = computeLoanRecovery({ installment_count: 10, paid_count: 10 });
    expect(r.progress_pct).toBe(100);
  });
});

describe('computeAttention (HR attention panel)', () => {
  const asOf = new Date('2026-08-20T00:00:00Z');
  const emp = (
    id: string,
    over: Partial<Pick<Candidate, 'date_of_birth' | 'joining_date' | 'contract_end_date'>> = {}
  ): Candidate => ({
    id,
    full_name: `Employee ${id}`,
    employee_code: `E-${id}`,
    date_of_birth: null,
    joining_date: null,
    contract_end_date: null,
    ...over,
  });

  it('flags contracts expiring within 30 days', () => {
    const att = computeAttention(
      [emp('a', { contract_end_date: '2026-09-05' }), emp('b', { contract_end_date: '2027-01-01' })],
      0,
      asOf
    );
    expect(att.expiringContracts).toHaveLength(1);
    expect(att.expiringContracts[0].id).toBe('a');
  });

  it('flags upcoming birthdays within 30 days', () => {
    const att = computeAttention(
      [emp('a', { date_of_birth: '1990-09-01' }), emp('b', { date_of_birth: '1990-10-01' })],
      0,
      asOf
    );
    expect(att.upcomingBirthdays.map((b) => b.id)).toEqual(['a']);
  });

  it('handles birthdays wrapping past New Year (Dec → Jan)', () => {
    const dec31 = new Date('2026-12-31T00:00:00Z');
    const att = computeAttention(
      [emp('a', { date_of_birth: '1990-01-15' }), emp('b', { date_of_birth: '1990-12-30' })],
      0,
      dec31
    );
    // Dec 30 already passed; only Jan 15 (next year) is upcoming
    expect(att.upcomingBirthdays.map((b) => b.id)).toEqual(['a']);
  });

  it('sorts by nearest upcoming occurrence across the year boundary', () => {
    const dec31 = new Date('2026-12-31T00:00:00Z');
    const att = computeAttention(
      [emp('a', { date_of_birth: '1990-01-15' }), emp('b', { date_of_birth: '1990-12-31' })],
      0,
      dec31
    );
    // today (Dec 31) sorts before Jan 15 of the new year
    expect(att.upcomingBirthdays.map((b) => b.id)).toEqual(['b', 'a']);
  });

  it('flags work anniversaries within 30 days', () => {
    const att = computeAttention(
      [emp('a', { joining_date: '2020-08-25' }), emp('b', { joining_date: '2020-07-01' })],
      0,
      asOf
    );
    expect(att.upcomingAnniversaries.map((a) => a.id)).toEqual(['a']);
  });

  it('reports pending attendance approvals and hides empty buckets', () => {
    const att = computeAttention([], 7, asOf);
    expect(att.pendingAttendanceApprovals).toBe(7);
    expect(att.expiringContracts).toHaveLength(0);
    expect(att.upcomingBirthdays).toHaveLength(0);
    expect(att.upcomingAnniversaries).toHaveLength(0);
  });
});

describe('computeHiresByPosition (new hires grouping)', () => {
  it('normalizes counts to numbers and sorts descending', () => {
    const rows = computeHiresByPosition([
      { position_id: 'b', position_name: 'Engineer', count: '2' },
      { position_id: 'a', position_name: 'Manager', count: '5' },
    ]);
    expect(rows[0].position_name).toBe('Manager');
    expect(rows[0].count).toBe(5);
    expect(rows[1].count).toBe(2);
  });
});