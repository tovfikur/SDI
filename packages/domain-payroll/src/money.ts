/**
 * Money as integer cents (BigInt) — decimal-safe payroll arithmetic.
 *
 * The database stores money as numeric(14,2), which node-postgres serializes as
 * plain strings. All calculation happens in integer cents (BigInt) so floating
 * point precision bugs are impossible; values are converted back to canonical
 * decimal strings only at the boundary.
 */

export type Cents = bigint;

/**
 * Parses a numeric(14,2)-style value (string, number, null) into integer cents.
 * Negative or malformed values throw — payroll math never ingests them; domain
 * entry points translate this into friendly errors.
 */
export function parseCents(value: unknown): Cents {
  if (value === null || value === undefined || value === '') return 0n;
  const s = String(value).trim();
  if (s === '') return 0n;
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error('money.invalid_amount');
  }
  const neg = s.startsWith('-');
  const t = neg ? s.slice(1) : s;
  const [wholeRaw, fracRaw = ''] = t.split('.');
  const whole = /^\d+$/.test(wholeRaw) ? wholeRaw : '0';
  const frac = /^\d+$/.test(fracRaw) ? (fracRaw + '00').slice(0, 2) : '00';
  const cents = BigInt(whole) * 100n + BigInt(frac);
  if (neg) throw new Error('money.negative_amount');
  return cents;
}

/** Formats integer cents as a canonical decimal string ("1234.56", "-12.30"). */
export function centsToString(cents: Cents): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${neg ? '-' : ''}${whole.toString()}.${frac.toString().padStart(2, '0')}`;
}

/** Rounding rules applied to net pay (nearest / ceil / floor whole currency unit). */
export type RoundingRule = 'nearest' | 'ceil' | 'floor';

export function roundToCurrency(cents: Cents, rule: RoundingRule): Cents {
  const whole = cents / 100n;
  const rem = cents % 100n;
  if (rule === 'nearest') {
    const down = whole * 100n;
    return rem >= 50n ? down + 100n : down;
  }
  if (rule === 'ceil') {
    return (rem === 0n ? whole : whole + (cents >= 0n ? 1n : 0n)) * 100n;
  }
  return whole * 100n;
}

/** Rounds a fraction (e.g. a percentage of an amount) to the nearest cent. */
export function percentOfCents(base: Cents, percent: unknown): Cents {
  const pctCents = parseCents(percent); // "50" -> 5000 (50.00 as cents)
  const product = base * pctCents; // base_cents * percent * 100
  // result = product / 10000, rounded half away from zero (result is in cents)
  const sign = product < 0n ? -1n : 1n;
  const abs = sign * product;
  const div = abs / 10000n;
  const rem = abs % 10000n;
  return sign * (rem >= 5000n ? div + 1n : div);
}

/** daily rate = gross / working days, rounded to the nearest cent. */
export function dailyRateCents(gross: Cents, workingDays: number): Cents {
  if (workingDays <= 0) return 0n;
  const abs = gross < 0n ? -gross : gross;
  const div = abs / BigInt(workingDays);
  const rem = abs % BigInt(workingDays);
  const rounded = rem * 2n >= BigInt(workingDays) ? div + 1n : div;
  return gross < 0n ? -rounded : rounded;
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((acc, v) => acc + v, 0n);
}