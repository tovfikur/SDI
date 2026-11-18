/**
 * Work Schedule (Setup Rules) domain (Spec: Work Schedule module).
 *
 * Production-grade schedule configuration: work pattern, working days,
 * office hours, grace period, overnight shift support, and automatic daily
 * working hour calculation with explicit override.
 */

import { list, query, getById, insertRow, updateRow, softDeleteRow } from '@jsk/shared-kernel';
import type { PaginatedResponse } from '@jsk/shared-kernel';
import type { ListInput } from './masters';

export const WORK_PATTERNS = ['Fixed', '5 Days', '6 Days', '7 Days', 'Shift'] as const;
export type WorkPattern = (typeof WORK_PATTERNS)[number];

/** Canonical day keys: Sat .. Fri (matches JS Date.getDay() offset mapping). */
export const DAY_KEYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_KEY_TO_JS: Record<DayKey, number> = {
  sat: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5,
};

export const DAY_LABELS: Record<DayKey, string> = {
  sat: 'Sat', sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri',
};

export interface SetupRule {
  id: string;
  title: string;
  employee_type_id: string | null;
  work_pattern: string;
  daily_working_hour: string; // numeric(5,2) returned as string by pg
  office_start_time: string;
  office_end_time: string;
  grace_period_minutes: number;
  working_days: string[];
  auto_calc_hours: boolean;
  is_active: boolean;
}

export interface SetupRuleInput {
  title: string;
  employee_type_id: string | null;
  work_pattern: WorkPattern;
  daily_working_hour: number;
  office_start_time: string;
  office_end_time: string;
  grace_period_minutes: number;
  working_days: DayKey[];
  auto_calc_hours: boolean;
  is_active: boolean;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Parse "HH:MM" into minutes since midnight; -1 when invalid. */
export function parseTimeToMinutes(value: string): number {
  if (typeof value !== 'string' || !TIME_RE.test(value)) return -1;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/** Shift duration in minutes, supporting overnight shifts (end <= start). */
export function shiftMinutes(start: string, end: string): number {
  const s = parseTimeToMinutes(start);
  const e = parseTimeToMinutes(end);
  if (s < 0 || e < 0) return 0;
  if (e <= s) return 24 * 60 - s + e; // overnight
  return e - s;
}

export function isOvernightShift(start: string, end: string): boolean {
  const s = parseTimeToMinutes(start);
  const e = parseTimeToMinutes(end);
  if (s < 0 || e < 0) return false;
  return e <= s;
}

export function isValidDayKeys(days: unknown): days is DayKey[] {
  if (!Array.isArray(days) || days.length === 0) return false;
  return days.every((d) => typeof d === 'string' && (DAY_KEYS as readonly string[]).includes(d));
}

/** Validate a create/update payload; returns fieldErrors (empty = valid). */
export async function validateSetupRuleInput(
  raw: Record<string, unknown>,
  existingId?: string
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) errors.title = 'Title is required.';
  else if (title.length > 120) errors.title = 'Title must be 120 characters or fewer.';

  const pattern = raw.work_pattern;
  if (typeof pattern !== 'string' || !(WORK_PATTERNS as readonly string[]).includes(pattern)) {
    errors.work_pattern = 'Invalid work pattern.';
  }

  const start = typeof raw.office_start_time === 'string' ? raw.office_start_time : '';
  const end = typeof raw.office_end_time === 'string' ? raw.office_end_time : '';
  if (!TIME_RE.test(start)) errors.office_start_time = 'Invalid start time. Use HH:MM.';
  if (!TIME_RE.test(end)) errors.office_end_time = 'Invalid end time. Use HH:MM.';
  if (TIME_RE.test(start) && TIME_RE.test(end) && shiftMinutes(start, end) === 0) {
    errors.office_end_time = 'Shift cannot be 24 hours.';
  }

  const daily = raw.daily_working_hour;
  const auto = raw.auto_calc_hours === true || raw.auto_calc_hours === 'true';
  const dailyNum = typeof daily === 'number' ? daily : typeof daily === 'string' && daily.trim() !== '' ? Number(daily) : NaN;
  if (!Number.isFinite(dailyNum)) {
    errors.daily_working_hour = 'Daily working hours must be a number.';
  } else if (dailyNum < 0.5 || dailyNum > 24) {
    errors.daily_working_hour = 'Daily working hours must be between 0.5 and 24.';
  } else if (!auto && shiftMinutes(start, end) > 0 && dailyNum > shiftMinutes(start, end)) {
    errors.daily_working_hour = 'Override hours cannot exceed the shift duration.';
  }

  const grace = raw.grace_period_minutes;
  const graceNum = typeof grace === 'number' ? grace : typeof grace === 'string' && grace.trim() !== '' ? Number(grace) : NaN;
  if (!Number.isInteger(graceNum) || graceNum < 0) {
    errors.grace_period_minutes = 'Grace period must be a whole number of minutes (>= 0).';
  }

  if (!isValidDayKeys(raw.working_days)) {
    errors.working_days = 'Select at least one working day.';
  }

  const employeeTypeId = raw.employee_type_id;
  if (employeeTypeId !== null && employeeTypeId !== undefined && employeeTypeId !== '') {
    if (typeof employeeTypeId !== 'string') {
      errors.employee_type_id = 'Invalid employee type selected.';
    } else {
      const { rows } = await query('SELECT id FROM employee_types WHERE id = $1::uuid AND deleted_at IS NULL', [employeeTypeId]);
      if (rows.length === 0) errors.employee_type_id = 'Employee type not found.';
    }
  }

  if (title) {
    const { rows } = await query(
      `SELECT id FROM setup_rules WHERE lower(title) = lower($1) AND deleted_at IS NULL AND id <> $2::uuid`,
      [title, existingId ?? '00000000-0000-0000-0000-000000000000']
    );
    if (rows.length > 0) errors.title = 'A schedule with this title already exists.';
  }

  return errors;
}

/** Normalize a validated raw payload into DB-ready values. */
export function normalizeSetupRuleInput(raw: Record<string, unknown>): SetupRuleInput {
  const daily = typeof raw.daily_working_hour === 'number'
    ? raw.daily_working_hour
    : Number(raw.daily_working_hour ?? 8);
  const grace = typeof raw.grace_period_minutes === 'number'
    ? raw.grace_period_minutes
    : Number(raw.grace_period_minutes ?? 0);
  return {
    title: String(raw.title ?? '').trim(),
    employee_type_id: raw.employee_type_id ? String(raw.employee_type_id) : null,
    work_pattern: (raw.work_pattern as WorkPattern) ?? 'Fixed',
    daily_working_hour: daily,
    office_start_time: String(raw.office_start_time ?? '09:00'),
    office_end_time: String(raw.office_end_time ?? '18:00'),
    grace_period_minutes: grace,
    working_days: (raw.working_days as DayKey[]) ?? [],
    auto_calc_hours: raw.auto_calc_hours === true || raw.auto_calc_hours === 'true',
    is_active: raw.is_active !== false && raw.is_active !== 'false',
  };
}

export const setupRules = {
  async list(input: ListInput): Promise<PaginatedResponse<Record<string, unknown>>> {
    return list({
      table: 'setup_rules sr',
      columns: {
        id: { type: 'uuid', sql: 'sr.id' },
        title: { type: 'text', sql: 'sr.title' },
        employee_type_id: { type: 'uuid', sql: 'sr.employee_type_id' },
        work_pattern: { type: 'text', sql: 'sr.work_pattern' },
        daily_working_hour: { type: 'text', sql: 'sr.daily_working_hour' },
        office_start_time: { type: 'text', sql: 'sr.office_start_time' },
        office_end_time: { type: 'text', sql: 'sr.office_end_time' },
        grace_period_minutes: { type: 'int', sql: 'sr.grace_period_minutes' },
        working_days: { type: 'text', sql: 'sr.working_days' },
        auto_calc_hours: { type: 'boolean', sql: 'sr.auto_calc_hours' },
        is_active: { type: 'boolean', sql: 'sr.is_active' },
        employee_type_name: { type: 'text', sql: 'et.name' },
      },
      joins: `LEFT JOIN employee_types et ON et.id = sr.employee_type_id`,
      filters: input.filters,
      search: input.search,
      searchableColumns: ['title'],
      sort: input.sort,
      defaultSort: { field: 'title', direction: 'asc' },
      activeOnly: true,
      pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
    });
  },

  async get(id: string): Promise<SetupRule | null> {
    return getById<SetupRule>('setup_rules', id);
  },

  async create(raw: Record<string, unknown>): Promise<SetupRule> {
    const input = normalizeSetupRuleInput(raw);
    return insertRow<SetupRule>('setup_rules', { ...input });
  },

  async update(id: string, raw: Record<string, unknown>): Promise<SetupRule | null> {
    const input = normalizeSetupRuleInput(raw);
    return updateRow<SetupRule>('setup_rules', id, { ...input });
  },

  /**
   * Prevent deletion while any employee is assigned to this schedule.
   * Throws with a clear message; callers should offer deactivation instead.
   */
  async remove(id: string): Promise<boolean> {
    const { rows } = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM employees WHERE setup_rule_id = $1::uuid AND deleted_at IS NULL`,
      [id]
    );
    if ((rows[0]?.n ?? 0) > 0) {
      throw new Error(`schedule_in_use: Cannot delete "${id}" — ${rows[0].n} employee(s) are assigned to this schedule. Deactivate it instead.`);
    }
    return softDeleteRow('setup_rules', id);
  },
};