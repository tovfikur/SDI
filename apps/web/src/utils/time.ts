/**
 * Time and attendance duration formatting helpers.
 */

export function formatAttendanceTime(timeStr?: string | null): string {
  if (!timeStr) return '—';
  const trimmed = String(timeStr).trim();
  if (!trimmed || trimmed === '—' || trimmed.toLowerCase() === 'invalid date') return '—';

  // If full ISO timestamp (e.g. 2026-11-16T09:30:00Z)
  if (trimmed.includes('T')) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      let h = d.getHours();
      const m = String(d.getMinutes()).padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12;
      if (h === 0) h = 12;
      return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
    }
  }

  // If time string e.g. "09:30:00", "09:30", "9:30:00"
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    let h = parseInt(match[1], 10);
    const m = match[2];
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  }

  // Fallback
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  }

  return trimmed;
}

export function parseMinutesFromTime(str?: string | null): number | null {
  if (!str) return null;
  const trimmed = String(str).trim();
  if (trimmed.includes('T')) {
    const d = new Date(trimmed);
    return !isNaN(d.getTime()) ? d.getHours() * 60 + d.getMinutes() : null;
  }
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  return match ? parseInt(match[1], 10) * 60 + parseInt(match[2], 10) : null;
}

export function computeWorkingHours(firstIn?: string | null, lastOut?: string | null): string {
  if (!firstIn || !lastOut) return '—';
  const start = parseMinutesFromTime(firstIn);
  const end = parseMinutesFromTime(lastOut);
  if (start == null || end == null) return '—';
  let diff = end - start;
  if (diff < 0) diff += 24 * 60; // overnight shift
  const hrs = Math.floor(diff / 60);
  const mins = diff % 60;
  return `${hrs}h ${mins}m`;
}

/**
 * Formats late minutes into hour/minute format as requested by user (e.g. "1:30 Mins", "0:30 Mins").
 */
export function formatLateDuration(minutes?: number | null): string {
  if (minutes == null || minutes <= 0) return '0';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')} Mins`;
}
