/**
 * Lightweight offline queue for field-tracking location points.
 * localStorage-backed; capped so it can never grow unbounded.
 */

export interface QueuedLocationPoint {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  altitude?: number | null;
  speed?: number | null;
  heading?: number | null;
  capturedAt: string;
  batteryLevel?: number | null;
}

export const MAX_QUEUE_POINTS = 500;
export const BATCH_FLUSH_SIZE = 100;

const QUEUE_KEY = 'jsk.field-tracking.queue';
const DEVICE_KEY = 'jsk.field-tracking.device-id';

export function readTrackingQueue(): QueuedLocationPoint[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedLocationPoint[]) : [];
  } catch {
    return [];
  }
}

export function pushTrackingQueue(points: QueuedLocationPoint[]): number {
  if (points.length === 0) return readTrackingQueue().length;
  const merged = [...readTrackingQueue(), ...points];
  const capped = merged.slice(-MAX_QUEUE_POINTS);
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(capped));
  } catch {
    /* storage full/unavailable — drop instead of crashing */
  }
  return capped.length;
}

export function clearTrackingQueue(): void {
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* noop */
  }
}

/** Stable per-browser device id for the tracking session. */
export function getTrackingDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return `dev-${Date.now()}`;
  }
}
