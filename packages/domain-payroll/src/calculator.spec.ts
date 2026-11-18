import { describe, it, expect } from 'vitest';
import { calculatePayroll, daysInMonth, scheduledWorkingDays } from '../src/calculator';
import type { CalcInput } from '../src/calculator';
import { parseCents, percentOfCents, roundToCurrency, dailyRateCents, centsToString } from '../src/money';

const GROSS = '60000.00';

function baseInput(): CalcInput {
  return {
    grossSalary: GROSS,
    basis: 'gross_salary' as const,
    components: [
      { id: 'basic', name: 'Basic Salary', code: 'BASIC', type: 'earning' as const, calculation_type: 'fixed' as const, percentage_of_component: null, amount: '30000.00', sort_order: 1 },
      { id: 'house', name: 'House Rent', code: 'HOUSE', type: 'earning' as const, calculation_type: 'percentage' as const, percentage_of_component: 'basic', amount: '30', sort_order: 2 },
      { id: 'transport', name: 'Transport', code: 'TRANSPORT', type: 'earning' as const, calculation_type: 'fixed' as const, percentage_of_component: null, amount: '2000.00', sort_order: 3 },
      { id: 'tax', name: 'Tax', code: 'TAX', type: 'deduction' as const, calculation_type: 'percentage' as const, percentage_of_component: null, amount: '5', sort_order: 4 },
    ],
    overrides: new Map<string, string>(),
    workingDays: 30,
    absentDays: 0,
    lateDays: 0,
    unpaidLeaveDays: '0',
    loanDeduction: '0',
    attendanceEnabled: true,
    lateEnabled: true,
    leaveEnabled: true,
    rounding: 'nearest' as const,
    adjustments: [],
  };
}

describe('calculatePayroll', () => {
  it('computes earnings, deductions and net from structure lines', () => {
    const r = calculatePayroll(baseInput());
    expect(r.grossPay).toBe('41000.00'); // 30000 + 9000 + 2000
    expect(r.totalEarnings).toBe('41000.00');
    expect(r.totalDeductions).toBe('3000.00'); // 5% of gross salary 60000
    expect(r.netPay).toBe('38000.00');
    expect(r.lines).toHaveLength(4);
  });

  it('applies an override instead of the structure amount', () => {
    const input = baseInput();
    input.overrides.set('transport', '3500.00');
    const r = calculatePayroll(input);
    expect(r.grossPay).toBe('42500.00');
    expect(r.lines.find((l) => l.name === 'Transport')?.amount).toBe('3500.00');
    expect(r.lines.find((l) => l.name === 'Transport')?.source).toBe('override');
  });

  it('deducts absence and unpaid leave at the daily rate, and loan installments', () => {
    const input = baseInput();
    input.absentDays = 2;
    input.unpaidLeaveDays = '1.5';
    input.loanDeduction = '5000.00';
    const daily = dailyRateCents(4100000n, 30);
    const r = calculatePayroll(input);
    expect(r.attendanceDeduction).toBe(centsToString(daily * 2n));
    expect(r.loanDeduction).toBe('5000.00');
    expect(r.lines.some((l) => l.source === 'loan')).toBe(true);
    expect(r.lines.some((l) => l.source === 'leave')).toBe(true);
    expect(r.lines.some((l) => l.source === 'attendance')).toBe(true);
    expect(r.netPay).toBeDefined();
  });

  it('adds manual adjustments and updates net', () => {
    const input = baseInput();
    input.adjustments = [
      { type: 'earning', amount: '5000.00', component_id: null, component_name: 'Bonus', reason: 'Festival bonus' },
      { type: 'deduction', amount: '1000.00', component_id: null, component_name: 'Penalty', reason: 'Late reporting' },
    ];
    const r = calculatePayroll(input);
    expect(r.adjustmentEarnings).toBe('5000.00');
    expect(r.adjustmentDeductions).toBe('1000.00');
    expect(r.totalEarnings).toBe('46000.00');
    expect(r.netPay).toBe('42000.00'); // 46000 - 3000 - 1000
  });

  it('rounds net pay per rule', () => {
    const input = baseInput();
    input.components[0].amount = '29999.99'; // house 30% -> 9000.00, gross 40999.99, tax 3000
    input.rounding = 'floor';
    const floor = calculatePayroll(input);
    input.rounding = 'ceil';
    const ceil = calculatePayroll(input);
    expect(floor.netPay).toBe('37999.00');
    expect(ceil.netPay).toBe('38000.00');
  });

  it('uses basic salary as percentage basis when configured', () => {
    const input = baseInput();
    input.basis = 'basic_salary';
    input.components[3].amount = '10'; // tax = 10% of basic
    const r = calculatePayroll(input);
    expect(r.totalDeductions).toBe('3000.00');
  });
});

describe('money helpers', () => {
  it('percentOfCents rounds half away from zero', () => {
    expect(percentOfCents(10000n, '50')).toBe(5000n);
    expect(percentOfCents(3333n, '50')).toBe(1667n); // 1666.5 -> 1667
    expect(percentOfCents(10000n, '5')).toBe(500n);
  });

  it('roundToCurrency applies nearest/ceil/floor', () => {
    expect(roundToCurrency(12345n, 'nearest')).toBe(12300n);
    expect(roundToCurrency(12350n, 'nearest')).toBe(12400n);
    expect(roundToCurrency(12345n, 'ceil')).toBe(12400n);
    expect(roundToCurrency(12345n, 'floor')).toBe(12300n);
  });

  it('dailyRateCents is the exact daily rate', () => {
    expect(dailyRateCents(4100000n, 30)).toBe(136667n);
  });

  it('parseCents handles decimals and rejects negatives', () => {
    expect(parseCents('1234.56')).toBe(123456n);
    expect(parseCents('0')).toBe(0n);
    expect(() => parseCents('-5.00')).toThrow();
  });
});

describe('working days', () => {
  it('calendar mode counts all days in the month', () => {
    expect(daysInMonth('2026-08-01')).toBe(31);
    expect(daysInMonth('2026-02-01')).toBe(28);
  });

  it('scheduled mode excludes weekend (Fri/Sat) and holidays', () => {
    // 2026-08-01 is a Saturday; month has 31 days → 22 Mon-Thu days.
    expect(scheduledWorkingDays('2026-08-01', [])).toBe(22);
    expect(scheduledWorkingDays('2026-08-01', ['2026-08-04'])).toBe(21);
  });
});