/**
 * Best-effort browser GPS tracking for field attendance.
 *
 * - `watchPosition` continuously refreshes the latest position.
 * - A ~10 minute interval uploads the latest position while the session is
 *   active; meaningful movement (>150m since last upload, at least 60s apart)
 *   uploads sooner.
 * - Failed uploads caused by network problems are queued in localStorage and
 *   flushed via the batch endpoint when connectivity returns.
 * - Background/locked-screen tracking is not guaranteed in a browser.
 *
 * Permission flow:
 * - On mount the Permissions API (when available) reports the initial state
 *   (granted / prompt / denied); `granted` immediately fetches the current
 *   position so it is ready before the user checks in.
 * - While the state is `prompt`, CHECK IN triggers `getCurrentPosition()` so
 *   the browser can show the native permission prompt.
 * - When `denied` no geolocation call is made; the user must change browser
 *   Site Settings and reload (see `retryLocation` for re-checking).
 * - Geolocation errors are mapped distinctly: code 1 (denied), code 2
 *   (position unavailable), code 3 (timeout).
 * - `localhost` is a secure context, so geolocation works there over plain
 *   HTTP; the code never rejects based on protocol.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fieldTracking, ApiError } from '../../api';
import type { FieldTrackingPointBody } from '../../api';
import {
  BATCH_FLUSH_SIZE,
  clearTrackingQueue,
  pushTrackingQueue,
  readTrackingQueue,
} from './fieldTrackingQueue';

export interface TrackingPosition extends FieldTrackingPointBody {
  capturedAt: string;
}

export type LocationPermissionState =
  'loading' | 'prompt' | 'granted' | 'denied' | 'location_error';

export type LocationCaptureReason = 'ok' | 'denied' | 'position' | 'timeout' | 'unsupported';

export interface CaptureResult {
  position: TrackingPosition | null;
  reason: LocationCaptureReason;
}

export const LOCATION_BLOCKED_MESSAGE =
  'Location access is blocked. Please allow Location permission from your browser Site Settings and reload this page.';

/** Human-friendly reason when no position could be captured for check-in. */
export function captureFailureMessage(reason: LocationCaptureReason): string {
  switch (reason) {
    case 'denied':
      return 'Location permission is required to check in.';
    case 'position':
      return 'Unable to determine your location.';
    case 'timeout':
      return 'Taking too long to get an accurate location — move to an open area and try again.';
    case 'unsupported':
      return 'Geolocation is not supported by this browser.';
    default:
      return 'Unable to determine your location. Please try again.';
  }
}

/** Map API errors (geofence, accuracy, range) to actionable messages. */
export function punchErrorMessage(e: unknown, action: 'in' | 'out'): string {
  if (e instanceof ApiError) {
    if (e.code === 'OUTSIDE_GEOFENCE') {
      return action === 'in'
        ? 'You are outside your allowed attendance area — move inside the geofence to check in.'
        : 'You are outside your allowed checkout area — move inside the geofence to check out.';
    }
    if (e.code === 'LOCATION_ACCURACY_INSUFFICIENT') {
      return 'Unable to confirm your location accurately. Please enable precise location and try again.';
    }
    if (e.code === 'OUTSIDE_PROJECT_RANGE') {
      return 'You are outside the assigned project attendance range.';
    }
  }
  return e instanceof Error ? e.message : `Failed to check ${action}`;
}

const UPLOAD_INTERVAL_MS = 10 * 60 * 1000;
const MOVEMENT_UPLOAD_MIN_GAP_MS = 60 * 1000;
const MOVEMENT_UPLOAD_DISTANCE_M = 150;

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 30000,
};

function fromGeoPosition(p: GeolocationPosition): TrackingPosition {
  return {
    latitude: p.coords.latitude,
    longitude: p.coords.longitude,
    accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
    altitude: Number.isFinite(p.coords.altitude ?? NaN) ? p.coords.altitude : null,
    speed: Number.isFinite(p.coords.speed ?? NaN) ? p.coords.speed : null,
    heading: Number.isFinite(p.coords.heading ?? NaN) ? p.coords.heading : null,
    capturedAt: new Date().toISOString(),
  };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function geolocationSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/**
 * Accuracy (meters) at which a fix is considered good enough to stop the
 * best-reading acquisition window early.
 */
export const GOOD_ENOUGH_ACCURACY_M = 30;

/** How long the best-reading acquisition window keeps sampling GPS fixes. */
const BEST_FIX_WINDOW_MS = 8000;

/**
 * High-accuracy location acquisition with retry/best-reading semantics.
 *
 * Takes an immediate high-accuracy fix, then keeps watching for up to
 * BEST_FIX_WINDOW_MS and resolves with the reading that has the smallest
 * `coords.accuracy`. Stops early once a sufficiently accurate fix arrives.
 * Never fails on the first inaccurate reading — only when no fix at all was
 * obtained within the window.
 */
export function acquireBestPosition(): Promise<CaptureResult> {
  return new Promise((resolve) => {
    if (!geolocationSupported()) {
      resolve({ position: null, reason: 'unsupported' });
      return;
    }
    let settled = false;
    let watchId: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let best: TrackingPosition | null = null;
    let sawDenied = false;
    let sawUnavailable = false;

    const isMobileDevice = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (timer !== null) clearTimeout(timer);
      const reason: LocationCaptureReason = !best
        ? sawDenied
          ? 'denied'
          : sawUnavailable
            ? 'position'
            : 'timeout'
        : 'ok';
      resolve({ position: best, reason });
    };

    const consider = (p: GeolocationPosition): void => {
      const pos = fromGeoPosition(p);
      if (!best || ((pos.accuracy ?? Infinity) < (best.accuracy ?? Infinity))) {
        best = pos;
      }
      if ((best.accuracy ?? Infinity) <= (isMobileDevice ? GOOD_ENOUGH_ACCURACY_M : 500)) {
        finish();
      }
    };

    // Fast resolution with enableHighAccuracy: false (essential for desktop/PC Wi-Fi and IP geolocation)
    navigator.geolocation.getCurrentPosition(
      consider,
      (err) => {
        if (err.code === 1) sawDenied = true;
        else if (err.code === 2) sawUnavailable = true;
      },
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 5000 }
    );

    // Initial quick fix (also triggers browser permission prompt and satellite GPS on mobile)
    navigator.geolocation.getCurrentPosition(
      consider,
      (err) => {
        if (err.code === 1) sawDenied = true;
        else if (err.code === 2) sawUnavailable = true;
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 }
    );

    // Refinement window: keep the most accurate reading seen
    try {
      watchId = navigator.geolocation.watchPosition(
        consider,
        (err) => {
          if (err.code === 1) sawDenied = true;
          else if (err.code === 2) sawUnavailable = true;
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: BEST_FIX_WINDOW_MS }
      );
    } catch {
      /* ignore */
    }

    timer = setTimeout(finish, isMobileDevice ? BEST_FIX_WINDOW_MS + 1000 : 3500);
  });
}

function permissionQuery(): Promise<PermissionStatus> | null {
  if (typeof navigator === 'undefined' || !navigator.permissions) return null;
  try {
    return navigator.permissions.query({ name: 'geolocation' });
  } catch {
    return null;
  }
}

function permissionMessage(reason: LocationCaptureReason): string {
  switch (reason) {
    case 'denied':
      return LOCATION_BLOCKED_MESSAGE;
    case 'timeout':
      return 'Location request timed out. Please try again.';
    case 'unsupported':
      return 'Location is not available in this browser or context.';
    default:
      return 'Unable to determine your location. Please try again.';
  }
}

export interface UseFieldTrackingResult {
  permissionState: LocationPermissionState;
  gpsActive: boolean;
  position: TrackingPosition | null;
  locationError: string | null;
  lastUploadAt: Date | null;
  pendingOffline: number;
  startWatching: () => void;
  stopWatching: () => void;
  capturePosition: () => Promise<CaptureResult>;
  retryLocation: () => void;
  sendPositionNow: () => Promise<boolean>;
}

export function useFieldTracking(active: boolean): UseFieldTrackingResult {
  const [permissionState, setPermissionState] = useState<LocationPermissionState>('loading');
  const [gpsActive, setGpsActive] = useState(false);
  const [position, setPosition] = useState<TrackingPosition | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [lastUploadAt, setLastUploadAt] = useState<Date | null>(null);
  const [pendingOffline, setPendingOffline] = useState<number>(readTrackingQueue().length);

  const positionRef = useRef<TrackingPosition | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(active);
  const uploadingRef = useRef(false);
  const lastSentRef = useRef<{ at: number; latitude: number; longitude: number } | null>(null);
  const permListenerRef = useRef<{ status: PermissionStatus; onChange: () => void } | null>(null);

  activeRef.current = active;
  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  const flushQueue = useCallback(async (): Promise<number> => {
    const queued = readTrackingQueue();
    if (queued.length === 0) return 0;
    try {
      const res = await fieldTracking.locationsBatch({ points: queued.slice(0, BATCH_FLUSH_SIZE) });
      clearTrackingQueue();
      setPendingOffline(readTrackingQueue().length);
      setLastUploadAt(new Date());
      return res.saved;
    } catch {
      return 0;
    }
  }, []);

  const sendPosition = useCallback(
    async (pos: TrackingPosition): Promise<boolean> => {
      if (uploadingRef.current) return false;
      uploadingRef.current = true;
      try {
        try {
          await fieldTracking.location({
            latitude: pos.latitude,
            longitude: pos.longitude,
            accuracy: pos.accuracy ?? null,
            altitude: pos.altitude ?? null,
            speed: pos.speed ?? null,
            heading: pos.heading ?? null,
            capturedAt: pos.capturedAt,
          });
          lastSentRef.current = {
            at: Date.now(),
            latitude: pos.latitude,
            longitude: pos.longitude,
          };
          setLastUploadAt(new Date());
          await flushQueue();
          return true;
        } catch (err) {
          if (err instanceof TypeError) {
            // Network-level failure (fetch throws TypeError): keep for later.
            pushTrackingQueue([
              {
                latitude: pos.latitude,
                longitude: pos.longitude,
                accuracy: pos.accuracy ?? null,
                altitude: pos.altitude ?? null,
                speed: pos.speed ?? null,
                heading: pos.heading ?? null,
                capturedAt: pos.capturedAt,
              },
            ]);
            setPendingOffline(readTrackingQueue().length);
            setLocationError('Location upload failed — queued for retry');
          } else {
            setLocationError(err instanceof Error ? err.message : 'Location upload failed');
          }
          return false;
        }
      } finally {
        uploadingRef.current = false;
      }
    },
    [flushQueue]
  );

  const onPosition = useCallback(
    (p: GeolocationPosition) => {
      const pos = fromGeoPosition(p);
      positionRef.current = pos;
      setPosition(pos);
      setPermissionState('granted');
      setGpsActive(true);

      const last = lastSentRef.current;
      const now = Date.now();
      if (
        activeRef.current &&
        last &&
        now - last.at > MOVEMENT_UPLOAD_MIN_GAP_MS &&
        haversineMeters(last.latitude, last.longitude, pos.latitude, pos.longitude) >
          MOVEMENT_UPLOAD_DISTANCE_M
      ) {
        void sendPosition(pos);
      }
    },
    [sendPosition]
  );

  const applyPositionResult = useCallback((p: GeolocationPosition): TrackingPosition => {
    const pos = fromGeoPosition(p);
    positionRef.current = pos;
    setPosition(pos);
    setPermissionState('granted');
    setGpsActive(true);
    setLocationError(null);
    return pos;
  }, []);

  const requestCurrentPosition = useCallback(
    (resolve: (result: CaptureResult) => void): void => {
      if (!geolocationSupported()) {
        setPermissionState('location_error');
        setLocationError(permissionMessage('unsupported'));
        resolve({ position: null, reason: 'unsupported' });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ position: applyPositionResult(p), reason: 'ok' }),
        (err) => {
          const reason: LocationCaptureReason =
            err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'position';
          if (reason === 'denied') {
            setPermissionState('denied');
          } else {
            setPermissionState('location_error');
          }
          setLocationError(permissionMessage(reason));
          resolve({ position: null, reason });
        },
        GEO_OPTIONS
      );
    },
    [applyPositionResult]
  );

  const checkPermission = useCallback((): void => {
    if (!geolocationSupported()) {
      setPermissionState('location_error');
      setLocationError(permissionMessage('unsupported'));
      return;
    }
    const query = permissionQuery();
    if (!query) {
      // No Permissions API: assume the browser will prompt on first use.
      setPermissionState('prompt');
      return;
    }
    query
      .then((status) => {
        const apply = () => {
          if (status.state === 'granted') {
            setPermissionState('granted');
            requestCurrentPosition(() => {});
          } else if (status.state === 'denied') {
            setPermissionState('denied');
            setLocationError(LOCATION_BLOCKED_MESSAGE);
            setGpsActive(false);
          } else {
            setPermissionState('prompt');
          }
        };
        const onChange = () => apply();
        if (permListenerRef.current) {
          permListenerRef.current.status.removeEventListener(
            'change',
            permListenerRef.current.onChange
          );
        }
        permListenerRef.current = { status, onChange };
        status.addEventListener('change', onChange);
        apply();
      })
      .catch(() => {
        setPermissionState('prompt');
      });
  }, [requestCurrentPosition]);

  useEffect(() => {
    checkPermission();
    return () => {
      if (permListenerRef.current) {
        permListenerRef.current.status.removeEventListener(
          'change',
          permListenerRef.current.onChange
        );
        permListenerRef.current = null;
      }
    };
  }, [checkPermission]);

  const retryLocation = useCallback((): void => {
    setLocationError(null);
    if (!geolocationSupported()) {
      setPermissionState('location_error');
      setLocationError(permissionMessage('unsupported'));
      return;
    }
    const query = permissionQuery();
    if (!query) {
      // No Permissions API: attempt to obtain a position directly.
      requestCurrentPosition(() => {});
      return;
    }
    query
      .then((status) => {
        if (status.state === 'denied') {
          setPermissionState('denied');
          setLocationError(LOCATION_BLOCKED_MESSAGE);
          return;
        }
        requestCurrentPosition(() => {});
      })
      .catch(() => {
        requestCurrentPosition(() => {});
      });
  }, [requestCurrentPosition]);

  const startWatching = useCallback(() => {
    if (watchIdRef.current !== null) return;
    if (!geolocationSupported()) {
      setPermissionState('location_error');
      setLocationError(permissionMessage('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      onPosition,
      () => {
        /* the watch below will keep reporting; surface state from watch errors */
      },
      GEO_OPTIONS
    );
    watchIdRef.current = navigator.geolocation.watchPosition(
      onPosition,
      (err) => {
        // Watch failures keep the last known position; surface the state.
        const reason: LocationCaptureReason =
          err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'position';
        if (reason === 'denied') {
          setPermissionState('denied');
        } else {
          setPermissionState('location_error');
        }
        setLocationError(permissionMessage(reason));
      },
      GEO_OPTIONS
    );
  }, [onPosition]);

  const stopWatching = useCallback(() => {
    if (
      watchIdRef.current !== null &&
      typeof navigator !== 'undefined' &&
      'geolocation' in navigator
    ) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setGpsActive(false);
  }, []);

  const capturePosition = useCallback((): Promise<CaptureResult> => {
    return acquireBestPosition().then((result) => {
      if (result.position) {
        positionRef.current = result.position;
        setPosition(result.position);
        setPermissionState('granted');
        setGpsActive(true);
        setLocationError(null);
      } else if (result.reason === 'denied') {
        setPermissionState('denied');
        setLocationError(permissionMessage('denied'));
      } else if (result.reason !== 'ok') {
        setPermissionState('location_error');
        setLocationError(permissionMessage(result.reason));
      }
      return result;
    });
  }, []);

  const sendPositionNow = useCallback(async (): Promise<boolean> => {
    const pos = positionRef.current;
    if (!pos) return false;
    return sendPosition(pos);
  }, [sendPosition]);

  // Periodic upload while a session is active.
  useEffect(() => {
    if (!active) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    if (intervalRef.current !== null) return;
    intervalRef.current = setInterval(async () => {
      const pos = positionRef.current;
      if (!pos) return;
      const queued = readTrackingQueue();
      if (queued.length > 0) {
        await flushQueue();
        return;
      }
      await sendPosition(pos);
    }, UPLOAD_INTERVAL_MS);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [active, flushQueue, sendPosition]);

  // Always clean up on unmount.
  useEffect(
    () => () => {
      stopWatching();
    },
    [stopWatching]
  );

  return {
    permissionState,
    gpsActive,
    position,
    locationError,
    lastUploadAt,
    pendingOffline,
    startWatching,
    stopWatching,
    capturePosition,
    retryLocation,
    sendPositionNow,
  };
}
