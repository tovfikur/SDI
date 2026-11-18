/**
 * Attendance calculation service (Spec BR-004..007, SM-1, HC-01).
 *
 * Pure function of raw events + Setup Rule + Holiday + approved Leave — never
 * mutates raw events; the derived `attendance_days` row is always recomputable
 * and recalculation is idempotent (ADR-002).
 *
 * Status derivation (interpretation documented in PARITY_GAPS.md):
 *   - holiday with events             -> HolidayPresent
 *   - holiday without events          -> NoData
 *   - approved leave covering the day -> Leave
 *   - no events on a working day      -> Absent
 *   - a single event (no in/out pair) -> Missing
 *   - first check-in after start+grace-> Late
 *   - otherwise                       -> Present
 */

export const ORG_TZ = 'Asia/Dhaka';

export interface RawEvent {
  event_time: string;
}

export interface SetupRuleForCalc {
  office_start_time: string;
  office_end_time: string;
  grace_period_minutes: number;
  /** Lowercase day keys ('sat'..'fri') the employee is expected to work. */
  working_days: string[];
}

export interface DayInput {
  date: string; // YYYY-MM-DD (work date in org timezone)
  events: RawEvent[];
  setupRule: SetupRuleForCalc | null;
  isHoliday: boolean;
  hasApprovedLeave: boolean;
}

export interface DayResult {
  status: string;
  first_in: string | null;
  last_out: string | null;
  total_work_minutes: number;
  late_minutes: number;
  late_out_minutes: number;
  early_out_minutes: number;
  early_closing: boolean;
}

const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

const toTime = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const DAY_KEY_BY_UTC_INDEX = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Lowercase day key for a YYYY-MM-DD date (UTC-based weekday lookup). */
export function weekdayKey(date: string): string {
  return DAY_KEY_BY_UTC_INDEX[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** Overnight shift when end time is earlier than (or equal to) start time. */
export function isOvernightShift(start: string, end: string): boolean {
  return toMinutes(end) <= toMinutes(start);
}

/** Local HH:MM of an ISO event timestamp in the org timezone. */
function eventTimeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: ORG_TZ }).slice(0, 5);
}

export function calculateDay(input: DayInput): DayResult {
  const sorted = input.events
    .map((e) => new Date(e.event_time))
    .sort((a, b) => a.getTime() - b.getTime());

  const result: DayResult = {
    status: 'NoData',
    first_in: null,
    last_out: null,
    total_work_minutes: 0,
    late_minutes: 0,
    late_out_minutes: 0,
    early_out_minutes: 0,
    early_closing: false,
  };

  if (input.isHoliday) {
    if (sorted.length > 0) {
      result.status = 'HolidayPresent';
      result.first_in = eventTimeOf(input.events[0].event_time);
      result.last_out = eventTimeOf(input.events[sorted.length - 1].event_time);
    }
    return result;
  }

  if (input.hasApprovedLeave) {
    result.status = 'Leave';
    return result;
  }

  const isScheduledOffDay =
    input.setupRule !== null &&
    input.setupRule.working_days.length > 0 &&
    !input.setupRule.working_days.includes(weekdayKey(input.date));

  if (isScheduledOffDay) {
    if (sorted.length > 0) {
      result.status = 'Present';
      result.first_in = eventTimeOf(input.events[0].event_time);
      result.last_out = eventTimeOf(input.events[sorted.length - 1].event_time);
    }
    return result;
  }

  if (sorted.length === 0) {
    result.status = 'Absent';
    return result;
  }

  if (!input.setupRule) {
    result.status = 'NoData';
    return result;
  }

  // Bucket event times to local "time-of-day" using the org timezone.
  const times = sorted.map((d) => toMinutes(d.toLocaleTimeString('en-GB', { timeZone: ORG_TZ })));
  const firstIn = times[0];
  const lastOut = times[times.length - 1];

  result.first_in = toTime(firstIn);
  result.last_out = toTime(lastOut);

  const start = toMinutes(input.setupRule.office_start_time);
  const end = toMinutes(input.setupRule.office_end_time);
  const grace = input.setupRule.grace_period_minutes;
  const overnight = end <= start;

  // Total worked minutes — handle overnight shifts where checkout lands
  // after midnight (i.e. earlier wall-clock time than check-in).
  if (overnight && lastOut < firstIn) {
    result.total_work_minutes = lastOut + 24 * 60 - firstIn;
  } else {
    result.total_work_minutes = Math.max(0, lastOut - firstIn);
  }

  // Calculate late in
  let isLate = false;
  let lateMins = 0;
  if (!overnight && firstIn > start + grace) {
    isLate = true;
    lateMins = firstIn - (start + grace);
  } else if (overnight && firstIn < start) {
    // Post-midnight check-in on an overnight shift counts against the start.
    const shiftedStart = start - 24 * 60;
    if (firstIn > shiftedStart + grace) {
      isLate = true;
      lateMins = firstIn - (shiftedStart + grace);
    }
  } else if (firstIn > start + grace) {
    isLate = true;
    lateMins = firstIn - (start + grace);
  }

  result.late_minutes = lateMins;

  // Determine status:
  // 1. If check-in is late, the status MUST be 'Late' even if only 1 event recorded.
  // 2. If on-time and only 1 event recorded:
  //    - If today/future date (in progress), status is 'Present' (currently checked in).
  //    - If past day, status is 'Missing' (missing checkout).
  const todayInOrgTz = new Date().toLocaleDateString('en-CA', { timeZone: ORG_TZ });
  const isPastDay = input.date < todayInOrgTz;

  if (isLate) {
    result.status = 'Late';
  } else if (sorted.length === 1) {
    result.status = isPastDay ? 'Missing' : 'Present';
  } else {
    result.status = 'Present';
  }

  // Late out (stayed past end time) vs Early closing (left before end time)
  if (sorted.length > 1) {
    if (!overnight) {
      if (lastOut < end) {
        result.early_closing = true;
        result.early_out_minutes = end - lastOut;
        result.late_out_minutes = 0;
      } else if (lastOut > end) {
        result.late_out_minutes = lastOut - end;
        result.early_out_minutes = 0;
      }
    } else {
      const normalizedLastOut = lastOut < start ? lastOut + 24 * 60 : lastOut;
      const normalizedEnd = end + 24 * 60;
      if (normalizedLastOut < normalizedEnd) {
        result.early_closing = true;
        result.early_out_minutes = normalizedEnd - normalizedLastOut;
        result.late_out_minutes = 0;
      } else if (normalizedLastOut > normalizedEnd) {
        result.late_out_minutes = normalizedLastOut - normalizedEnd;
        result.early_out_minutes = 0;
      }
    }
  }

  return result;
}
