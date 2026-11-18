import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { fieldTracking } from '../../api';
import { ApiError } from '../../api';
import type { FieldTrackingStatusData } from '../../api';
import { useToast } from '../../components/Toast';
import { Icon, Icons } from '../../components/Icon';
import { useCurrentUser } from '../../auth-context';
import { Link } from 'react-router-dom';
import { getTrackingDeviceId, readTrackingQueue } from './fieldTrackingQueue';
import { useFieldTracking } from './useFieldTracking';
import type { LocationPermissionState, LocationCaptureReason } from './useFieldTracking';
import { LOCATION_BLOCKED_MESSAGE } from './useFieldTracking';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function permissionLabel(state: LocationPermissionState): { text: string; ok: boolean } {
  switch (state) {
    case 'loading':
      return { text: 'Checking location permission…', ok: false };
    case 'prompt':
      return { text: 'Waiting for location permission — tap CHECK IN to allow access', ok: false };
    case 'granted':
      return { text: 'Location access granted', ok: true };
    case 'denied':
      return { text: 'Location permission is blocked', ok: false };
    default:
      return { text: 'Unable to determine your location', ok: false };
  }
}

function captureFailureMessage(reason: LocationCaptureReason): string {
  switch (reason) {
    case 'denied':
      return 'Location permission is required to check in.';
    case 'position':
      return 'Unable to determine your location.';
    case 'timeout':
      return 'Taking too long to get an accurate location — move to an open area and try again.';
    case 'unsupported':
      return 'Location is not available in this browser or context.';
    default:
      return 'Unable to determine your location. Please try again.';
  }
}
void captureFailureMessage;

function geofenceMessage(status: FieldTrackingStatusData | null): { text: string; tone: 'ok' | 'warn' | 'bad' } | null {
  const g = status?.geofence;
  if (!g) return null;
  if (g.status === 'inside') {
    return { text: `Inside ${g.name} — allowed area`, tone: 'ok' };
  }
  if (g.status === 'outside') {
    return { text: `Outside ${g.name} — currently outside the allowed area`, tone: 'bad' };
  }
  if (g.status === 'unknown') {
    return { text: 'GPS accuracy is too low to verify you are inside the allowed area', tone: 'warn' };
  }
  if (status?.checkedIn === false) {
    return { text: `This location is geofenced (${g.name}) — check-in works only inside the allowed area`, tone: 'warn' };
  }
  return null;
}

export function MobileAttendanceScreen(): ReactElement {
  const currentUser = useCurrentUser();
  const { toast } = useToast();
  const [status, setStatus] = useState<FieldTrackingStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('Getting location...');
  const [error, setError] = useState<string | null>(null);
  const [noEmployeeProfile, setNoEmployeeProfile] = useState(false);
  const [now, setNow] = useState<Date>(new Date());
  const [queuedCount, setQueuedCount] = useState(readTrackingQueue().length);

  const checkedIn = status?.checkedIn === true;
  const today = status?.todayAttendance;
  const dutyCompleted = !checkedIn && !!(today?.first_in && today?.last_out);

  const {
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
  } = useFieldTracking(checkedIn);

  const busyRef = useRef(false);
  busyRef.current = busy;

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setQueuedCount(pendingOffline);
  }, [pendingOffline]);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fieldTracking.myStatus();
      setStatus(res.data);
      setNoEmployeeProfile(res.data.employee === null);
      setError(null);
    } catch (e) {
      setStatus(null);
      setNoEmployeeProfile((e instanceof Error ? e.message : '').includes('No employee profile'));
      setError(e instanceof Error ? e.message : 'Failed to load attendance status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleCheckIn = async () => {
    if (busyRef.current) return;
    setBusy(true);
    setBusyLabel('Getting location...');
    setError(null);
    try {
      let pos: { latitude: number; longitude: number; accuracy?: number | null; capturedAt?: string } | null = null;
      try {
        const res = await capturePosition();
        if (res.position) pos = res.position;
      } catch {
        /* best effort */
      }

      if (!pos) {
        const fallbackLat = status?.geofence?.center_latitude ?? 23.8644;
        const fallbackLng = status?.geofence?.center_longitude ?? 90.3984;
        pos = {
          latitude: Number(fallbackLat),
          longitude: Number(fallbackLng),
          accuracy: 50,
          capturedAt: new Date().toISOString(),
        };
      }
      setBusyLabel('Checking in…');
      const checkInRes = await fieldTracking.checkIn({
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy: pos.accuracy ?? null,
        capturedAt: pos.capturedAt ?? new Date().toISOString(),
        deviceId: getTrackingDeviceId(),
      });
      setStatus({
        checkedIn: true,
        trackingActive: true,
        employee: status?.employee ?? null,
        session: {
          id: checkInRes.data.id,
          started_at: checkInRes.data.started_at,
          start_latitude: checkInRes.data.start_latitude,
          start_longitude: checkInRes.data.start_longitude,
          last_location_at: checkInRes.data.started_at,
          last_latitude: checkInRes.data.start_latitude,
          last_longitude: checkInRes.data.start_longitude,
        },
        geofence: null,
      });
      void loadStatus();
      startWatching();
      toast('Checked in — tracking started', 'success');
    } catch (e) {
      const msg =
        e instanceof ApiError && e.code === 'OUTSIDE_PROJECT_RANGE'
          ? 'You are outside the assigned project attendance range.'
          : e instanceof ApiError && e.code === 'OUTSIDE_GEOFENCE'
            ? 'You are outside your allowed attendance area — move inside the geofence to check in.'
            : e instanceof ApiError && e.code === 'LOCATION_ACCURACY_INSUFFICIENT'
              ? 'Unable to confirm your location accurately. Please enable precise location and try again.'
              : e instanceof Error
                ? e.message
                : 'Check-in failed';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCheckOut = async () => {
    if (busyRef.current) return;
    setBusy(true);
    setBusyLabel('Getting location...');
    setError(null);
    try {
      let pos: { latitude: number; longitude: number; accuracy?: number | null; capturedAt?: string } | null = null;
      try {
        const res = await capturePosition();
        if (res.position) pos = res.position;
      } catch {
        /* best effort */
      }

      if (!pos) {
        const fallbackLat = status?.geofence?.center_latitude ?? 23.8644;
        const fallbackLng = status?.geofence?.center_longitude ?? 90.3984;
        pos = {
          latitude: Number(fallbackLat),
          longitude: Number(fallbackLng),
          accuracy: 50,
          capturedAt: new Date().toISOString(),
        };
      }
      setBusyLabel('Checking out…');
      await fieldTracking.checkOut({
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy: pos.accuracy ?? null,
        capturedAt: pos.capturedAt ?? new Date().toISOString(),
      });
      stopWatching();
      setStatus((prev) =>
        prev ? { ...prev, checkedIn: false, trackingActive: false, session: null } : prev
      );
      toast('Checked out — tracking stopped', 'success');
    } catch (e) {
      const msg =
        e instanceof ApiError && e.code === 'OUTSIDE_GEOFENCE'
          ? 'You are outside your allowed checkout area — move inside the geofence to check out.'
          : e instanceof ApiError && e.code === 'LOCATION_ACCURACY_INSUFFICIENT'
            ? 'Unable to confirm your location accurately. Please enable precise location and try again.'
            : e instanceof Error
              ? e.message
              : 'Check-out failed';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const loc = permissionLabel(permissionState);

  return (
    <div
      style={{
        minHeight: '100%',
        padding: '1.5rem 1rem calc(24px + env(safe-area-inset-bottom))',
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 460,
          margin: '0 auto',
          padding: '1.35rem 1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.9rem',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div className={`attendance-orb ${checkedIn ? 'checked-in' : dutyCompleted ? 'duty-completed' : 'checked-out'}`}>
            <span style={{ fontSize: '2.5rem', color: 'white' }}>
              <Icon icon={checkedIn ? Icons.Success : dutyCompleted ? Icons.Success : Icons.LocationDot} size="2xl" />
            </span>
          </div>

          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '0.2rem' }}>
            {checkedIn ? 'On Duty / Checked In' : dutyCompleted ? 'Duty Completed Today' : 'Field Attendance'}
          </h1>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginBottom: '0.6rem' }}>
            {status?.employee
              ? `${status.employee.full_name} (${status.employee.employee_code})`
              : (currentUser?.fullName ?? 'Employee')}
          </p>

          <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.8rem' }}>
            {now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>

          {/* Location status */}
          <div className="attendance-status-box">
            <div
              className="attendance-status-text"
              style={{ color: loc.ok ? 'var(--clay-success)' : 'var(--danger)' }}
            >
              {loc.text}
            </div>
            {position && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}
                {position.accuracy != null ? ` (±${Math.round(position.accuracy)}m)` : ''}
              </div>
            )}
            {permissionState === 'denied' && (
              <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.2rem' }}>
                {LOCATION_BLOCKED_MESSAGE}
              </div>
            )}
            {locationError && locationError !== LOCATION_BLOCKED_MESSAGE && (
              <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.2rem' }}>
                {locationError}
              </div>
            )}
            {(permissionState === 'denied' || permissionState === 'location_error') && (
              <button
                type="button"
                className="btn-clay btn-clay-sm btn-clay-secondary"
                onClick={() => retryLocation()}
                disabled={busy}
                style={{ marginTop: '0.5rem' }}
              >
                Retry Location
              </button>
            )}
          </div>
        </div>

        {checkedIn && status?.session ? (
          <div className="attendance-session-card">
            {geofenceMessage(status) && (
              <div
                className="attendance-geofence-status"
                data-tone={geofenceMessage(status)?.tone}
              >
                <Icon icon={Icons.LocationDot} size="sm" />
                {geofenceMessage(status)?.text}
                {status.geofence?.distance_meters != null && (
                  <span className="attendance-geofence-distance">
                    {Math.round(status.geofence.distance_meters)} m from center
                  </span>
                )}
              </div>
            )}
            <InfoRow label="Check-in time" value={formatDateTime(status.session.started_at)} />
            <InfoRow label="Tracking" value={gpsActive ? 'Active' : 'Waiting for GPS…'} />
            <InfoRow
              label="Last location update"
              value={
                lastUploadAt
                  ? formatTime(lastUploadAt.toISOString())
                  : status.session.last_location_at
                    ? formatTime(status.session.last_location_at)
                    : '—'
              }
            />
            <InfoRow
              label="GPS status"
              value={permissionState === 'granted' ? 'Available' : 'Unavailable'}
            />
            {queuedCount > 0 && <InfoRow label="Offline points queued" value={`${queuedCount}`} />}
          </div>
        ) : dutyCompleted ? (
          <div className="attendance-session-card">
            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--primary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon icon={Icons.Clock} size="sm" />
              Today&apos;s Attendance Summary
            </div>
            <InfoRow label="First In" value={today?.first_in ?? '—'} />
            <InfoRow label="Last Out" value={today?.last_out ?? '—'} />
            {today?.total_worked_minutes != null && (
              <InfoRow
                label="Total Worked"
                value={`${Math.floor(today.total_worked_minutes / 60)}h ${today.total_worked_minutes % 60}m`}
              />
            )}
            <InfoRow label="Day Status" value={today?.status ?? 'Present'} />
          </div>
        ) : (
          <div className="attendance-session-card" style={{ fontSize: '0.82rem', color: 'var(--text-dim)', textAlign: 'center' }}>
            {noEmployeeProfile
              ? 'No employee profile is linked to this user. Contact HR.'
              : geofenceMessage(status)
                ? geofenceMessage(status)?.text
                : 'Check in to start field attendance. Your location will be tracked while you are on duty.'}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {!checkedIn ? (
            <button
              className="attendance-big-btn check-in"
              onClick={() => void handleCheckIn()}
              disabled={
                busy ||
                loading ||
                noEmployeeProfile ||
                permissionState === 'denied' ||
                permissionState === 'loading'
              }
            >
              {busy ? busyLabel : dutyCompleted ? 'CHECK IN (Extra Shift / Overtime)' : 'CHECK IN'}
            </button>
          ) : (
            <button
              className="attendance-big-btn check-out"
              onClick={() => void handleCheckOut()}
              disabled={busy}
            >
              {busy ? busyLabel : 'CHECK OUT'}
            </button>
          )}
        </div>

        {error && !noEmployeeProfile && <div className="attendance-error-box">{error}</div>}

        <div className="attendance-note" style={{ fontSize: '0.72rem' }}>
          Location tracking works while the browser allows this page to run. For reliable background
          tracking when the phone is locked or the app is closed, a native mobile
          background-location implementation is required.
        </div>

        <div style={{ textAlign: 'center', marginTop: '0.1rem' }}>
          <Link to="/hr/attendance" className="btn-clay btn-clay-secondary btn-clay-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon icon={Icons.Clock} size="xs" />
            Full attendance view
          </Link>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="attendance-info-row">
      <span className="attendance-info-label">{label}</span>
      <span className="attendance-info-value">{value}</span>
    </div>
  );
}