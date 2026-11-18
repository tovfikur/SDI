/**
 * Decimal-as-string helpers (NFR-008).
 *
 * NFR-008: all decimal-typed fields (score, hours, leave days, money) are serialized as
 * strings to avoid floating-point drift in JSON (Phase 6). These helpers keep that
 * convention consistent across modules.
 */

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Returns true when the value is a canonical decimal string (no exponent, no whitespace,
 * no NaN/Infinity). Used to validate DTOs carrying money/score/hours/leave-day fields.
 */
export function isValidDecimal(value: string): boolean {
  return DECIMAL_RE.test(value);
}

/**
 * Converts a finite number to its canonical decimal string form.
 * Throws on non-finite input so invalid numeric values fail loudly at the edge.
 */
export function toDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Cannot serialize non-finite number as decimal string: ${String(value)}`);
  }
  return String(value);
}
