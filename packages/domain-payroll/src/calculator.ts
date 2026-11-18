/**
 * Payroll calculator — the single source of truth for payroll math.
 *
 * All money is integer cents (BigInt). Policy comes from the effective
 * payroll_settings row + salary structure + live attendance/leave/loan data;
 * nothing business-specific is hardcoded here.
 *
 *   total_earnings   = structure earnings (+ overrides) + adjustment earnings
 *   total_deductions = structure deductions + attendance + late + unpaid leave
 *                      + loan installments + adjustment deductions
 *   net_pay          = total_earnings - total_deductions (rounded per rule)
 */

import { parseCents, centsToString, dailyRateCents, roundToCurrency, sumCents, percentOfCents } from './money';
import type { RoundingRule } from './money';
import type { SalaryCalculationBasis } from './settings';

export type LineSource =
  | 'structure'
  | 'override'
  | 'attendance'
  | 'late'
  | 'leave'
  | 'loan'
  | 'adjustment'
  | 'overtime';

export interface CalcComponent {
  id: string;
  name: string;
  code: string;
  type: 'earning' | 'deduction';
  calculation_type: 'fixed' | 'percentage' | 'formula';
  percentage_of_component: string | null;
  /** structure amount: fixed money value, or percentage points when percentage. */
  amount: string | null;
  sort_order: number;
}

export interface CalcAdjustment {
  type: 'earning' | 'deduction';
  amount: string;
  component_id: string | null;
  component_name: string | null;
  reason: string;
}

export interface CalcInput {
  grossSalary: string;
  basis: SalaryCalculationBasis;
  components: CalcComponent[];
  overrides: Map<string, string>; // component_id -> amount
  workingDays: number;
  absentDays: number;
  lateDays: number;
  unpaidLeaveDays: string; // decimal string, e.g. "2.5"
  loanDeduction: string;
  attendanceEnabled: boolean;
  lateEnabled: boolean;
  leaveEnabled: boolean;
  rounding: RoundingRule;
  adjustments: CalcAdjustment[];
}

export interface CalcLine {
  component_id: string | null;
  name: string;
  type: 'earning' | 'deduction';
  amount: string;
  source: LineSource;
  description: string;
}

export interface CalcResult {
  grossPay: string;
  totalEarnings: string;
  totalDeductions: string;
  netPay: string;
  attendanceDeduction: string;
  lateDeduction: string;
  unpaidLeaveDeduction: string;
  loanDeduction: string;
  adjustmentEarnings: string;
  adjustmentDeductions: string;
  workingDays: number;
  payableDays: number;
  absentDays: number;
  lateDays: number;
  unpaidLeaveDays: string;
  lines: CalcLine[];
}

function resolveComponentAmount(
  component: CalcComponent,
  computed: Map<string, bigint>,
  basisValue: bigint
): bigint | null {
  if (component.calculation_type === 'formula') return null; // manual only
  if (component.calculation_type === 'fixed') {
    return parseCents(component.amount);
  }
  // percentage — of another component when given, otherwise of the basis
  const base = component.percentage_of_component
    ? (computed.get(component.percentage_of_component) ?? 0n)
    : basisValue;
  return percentOfCents(base, component.amount ?? '0');
}

export function calculatePayroll(input: CalcInput): CalcResult {
  const grossCents = parseCents(input.grossSalary);
  const basisValue =
    input.basis === 'basic_salary'
      ? (input.components.find((c) => c.calculation_type === 'fixed' && c.code === 'BASIC')
          ? parseCents(input.components.find((c) => c.calculation_type === 'fixed' && c.code === 'BASIC')?.amount)
          : grossCents)
      : grossCents;

  // Resolve structure lines (percentage components may reference earlier ones).
  const sorted = [...input.components].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const computed = new Map<string, bigint>();
  const lines: CalcLine[] = [];
  for (const component of sorted) {
    const override = input.overrides.get(component.id);
    const overrideCents = override !== undefined ? parseCents(override) : null;
    if (overrideCents !== null) {
      computed.set(component.id, overrideCents);
      if (overrideCents !== 0n) {
        lines.push({
          component_id: component.id,
          name: component.name,
          type: component.type,
          amount: centsToString(overrideCents),
          source: 'override',
          description: 'Manual override',
        });
      }
      continue;
    }
    const amount = resolveComponentAmount(component, computed, basisValue);
    if (amount === null || amount === 0n) continue;
    computed.set(component.id, amount);
    lines.push({
      component_id: component.id,
      name: component.name,
      type: component.type,
      amount: centsToString(amount),
      source: 'structure',
      description:
        component.calculation_type === 'percentage'
          ? component.percentage_of_component
            ? `Percentage of ${sorted.find((c) => c.id === component.percentage_of_component)?.name ?? 'component'}`
            : `Percentage of ${input.basis === 'basic_salary' ? 'Basic' : 'Gross'}`
          : component.calculation_type,
    });
  }

  const structureEarnings = sumCents(
    lines.filter((l) => l.type === 'earning' && (l.source === 'structure' || l.source === 'override')).map((l) => parseCents(l.amount))
  );

  // Attendance / leave / late deductions (per configured policy).
  const dailyRate = dailyRateCents(structureEarnings, input.workingDays);
  const absentCents = input.attendanceEnabled ? BigInt(input.absentDays) * dailyRate : 0n;
  const lateCents = input.lateEnabled ? BigInt(input.lateDays) * dailyRate : 0n;
  const leaveDaysCents = parseCents(input.unpaidLeaveDays);
  const leaveCents = input.leaveEnabled ? (leaveDaysCents * dailyRate) / 100n : 0n;
  const loanCents = parseCents(input.loanDeduction);

  if (absentCents !== 0n) {
    lines.push({
      component_id: null,
      name: 'Absence Deduction',
      type: 'deduction',
      amount: centsToString(absentCents),
      source: 'attendance',
      description: `${input.absentDays} absent day(s)`,
    });
  }
  if (lateCents !== 0n) {
    lines.push({
      component_id: null,
      name: 'Late Deduction',
      type: 'deduction',
      amount: centsToString(lateCents),
      source: 'late',
      description: `${input.lateDays} late day(s)`,
    });
  }
  if (leaveCents !== 0n) {
    lines.push({
      component_id: null,
      name: 'Unpaid Leave Deduction',
      type: 'deduction',
      amount: centsToString(leaveCents),
      source: 'leave',
      description: `${input.unpaidLeaveDays} unpaid leave day(s)`,
    });
  }
  if (loanCents !== 0n) {
    lines.push({
      component_id: null,
      name: 'Loan Deduction',
      type: 'deduction',
      amount: centsToString(loanCents),
      source: 'loan',
      description: 'Due installment(s)',
    });
  }

  // Manual adjustments.
  let adjustmentEarnings = 0n;
  let adjustmentDeductions = 0n;
  for (const adj of input.adjustments) {
    const amount = parseCents(adj.amount);
    if (adj.type === 'earning') adjustmentEarnings += amount;
    else adjustmentDeductions += amount;
    lines.push({
      component_id: adj.component_id,
      name: adj.component_name ?? (adj.type === 'earning' ? 'Additional Earnings' : 'Other Deduction'),
      type: adj.type,
      amount: centsToString(amount),
      source: 'adjustment',
      description: adj.reason,
    });
  }

  const totalEarnings = structureEarnings + adjustmentEarnings;
  const totalDeductions = sumCents(
    lines.filter((l) => l.type === 'deduction').map((l) => parseCents(l.amount))
  );
  const netCents = roundToCurrency(totalEarnings - totalDeductions, input.rounding);

  const payableDays = Math.max(0, input.workingDays - input.absentDays);

  return {
    grossPay: centsToString(structureEarnings),
    totalEarnings: centsToString(totalEarnings),
    totalDeductions: centsToString(totalDeductions),
    netPay: centsToString(netCents),
    attendanceDeduction: centsToString(absentCents),
    lateDeduction: centsToString(lateCents),
    unpaidLeaveDeduction: centsToString(leaveCents),
    loanDeduction: centsToString(loanCents),
    adjustmentEarnings: centsToString(adjustmentEarnings),
    adjustmentDeductions: centsToString(adjustmentDeductions),
    workingDays: input.workingDays,
    payableDays,
    absentDays: input.absentDays,
    lateDays: input.lateDays,
    unpaidLeaveDays: input.unpaidLeaveDays,
    lines,
  };
}

/** Calendar days in a month (YYYY-MM-DD of the first day). */
export function daysInMonth(monthFirst: string): number {
  const [y, m] = monthFirst.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Scheduled working days: weekdays (Mon–Thu) minus public holidays on those days. */
export function scheduledWorkingDays(monthFirst: string, holidays: string[]): number {
  const [y, m] = monthFirst.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const holidaySet = new Set(holidays);
  let count = 0;
  for (let d = 1; d <= last; d += 1) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow === 5 || dow === 6) continue; // Fri/Sat weekend (BD)
    const iso = `${monthFirst.slice(0, 7)}-${String(d).padStart(2, '0')}`;
    if (holidaySet.has(iso)) continue;
    count += 1;
  }
  return count;
}