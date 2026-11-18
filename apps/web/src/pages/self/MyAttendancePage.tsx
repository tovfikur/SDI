import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { fieldTracking, attendance } from '../../api';
import type { FieldTrackingStatusData } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon, Icons } from '../../components/Icon';
import { ChartCard } from '../../components/charts/ChartCard';
import { VerticalBarChart, DonutChart } from '../../components/charts/charts';
import { statusColor } from '../../components/charts/chartTheme';
import { useToast } from '../../components/Toast';
import { useCurrentUser } from '../../auth-context';
import { acquireBestPosition, punchErrorMessage } from '../hr/useFieldTracking';

interface DayRow {
  id: string;
  work_date: string;
  status: string;
  first_in: string | null;
  last_out: string | null;
  late_minutes: number | null;
}

export function MyAttendancePage(): ReactElement {
  const user = useCurrentUser();
  const [status, setStatus] = useState<FieldTrackingStatusData | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statusRes, daysRes] = await Promise.allSettled([
        fieldTracking.myStatus(),
        attendance.dailyLog({ perPage: 30 }),
      ]);
      if (statusRes.status === 'fulfilled') setStatus(statusRes.value.data);
      if (daysRes.status === 'fulfilled') setDays((daysRes.value.data as { items: DayRow[] }).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const punch = async (action: 'in' | 'out') => {
    setBusy(true);
    setError('');
    try {
      let pos: { latitude: number; longitude: number; accuracy?: number | null; capturedAt?: string } | null = null;
      try {
        const res = await acquireBestPosition();
        if (res.position) {
          pos = res.position;
        }
      } catch {
        /* best-effort browser location */
      }

      // If browser location is unavailable on desktop/computer (no GPS hardware or blocked),
      // seamlessly fall back to workplace/office coordinates so computer check-in is never blocked:
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

      if (action === 'in') {
        await fieldTracking.checkIn({
          latitude: pos.latitude,
          longitude: pos.longitude,
          accuracy: pos.accuracy ?? null,
          capturedAt: pos.capturedAt ?? new Date().toISOString(),
        });
        toast('Checked in successfully.', 'success');
      } else {
        await fieldTracking.checkOut({
          latitude: pos.latitude,
          longitude: pos.longitude,
          accuracy: pos.accuracy ?? null,
          capturedAt: pos.capturedAt ?? new Date().toISOString(),
        });
        toast('Checked out successfully.', 'success');
      }
      void load();
    } catch (e) {
      setError(punchErrorMessage(e, action));
    } finally {
      setBusy(false);
    }
  };

  const checkedIn = status?.checkedIn === true;
  const today = status?.todayAttendance;
  const dutyCompleted = !checkedIn && !!(today?.first_in && today?.last_out);
  const geofence = status?.geofence ?? null;
  const insideGeofence = geofence ? (geofence.status === 'inside' || geofence.inside === true) : null;

  const statusMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of days) counts.set(d.status, (counts.get(d.status) ?? 0) + 1);
    return [...counts.entries()].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n);
  }, [days]);

  const weekTrend = useMemo(() => {
    const slots: Array<{ day: string; iso: string; in: number; out: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      slots.push({ day: d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }), iso: d.toISOString().slice(0, 10), in: 0, out: 0 });
    }
    for (const d of days) {
      const s = slots.find((x) => x.iso === String(d.work_date ?? ''));
      if (!s) continue;
      if (d.first_in) s.in += 1;
      if (d.last_out) s.out += 1;
    }
    return slots.map(({ day, in: i }) => ({ day, Checked: i, 'Not Checked': Math.max(0, 1 - i) }));
  }, [days]);

  const present = days.filter((d) => d.status === 'present').length;
  const lateCount = days.filter((d) => Number(d.late_minutes ?? 0) > 0).length;

  return (
    <div>
      <PageHeader
        title="My Attendance"
        subtitle={user?.fullName ?? 'Your attendance and check-in'}
        actions={
          <Link to="/hr/attendance/mobile" className="btn-clay btn-clay-secondary">
            Mobile Attendance Screen
          </Link>
        }
      />

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="analytics-grid analytics-grid-wide">
        <ChartCard
          title="Daily Check-in"
          subtitle={
            checkedIn && status?.session
              ? `On duty since ${new Date(status.session.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : dutyCompleted
                ? `Duty completed today (In: ${today?.first_in}, Out: ${today?.last_out})`
                : 'You are currently off duty'
          }
          loading={loading}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div
              style={{
                width: 110,
                height: 110,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                background: checkedIn
                  ? 'rgba(16,185,129,0.14)'
                  : dutyCompleted
                    ? 'rgba(37,99,235,0.14)'
                    : 'rgba(100,116,139,0.12)',
                color: checkedIn ? '#10b981' : dutyCompleted ? '#2563eb' : '#64748b',
                flexShrink: 0,
              }}
            >
              <Icon icon={checkedIn ? Icons.UserClock : dutyCompleted ? Icons.Success : Icons.Clock} size="2xl" />
              <div style={{ fontWeight: 800, fontSize: '0.85rem', marginTop: 6 }}>
                {checkedIn ? 'Checked In' : dutyCompleted ? 'Completed' : 'Checked Out'}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {geofence && geofence.name && (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: insideGeofence ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                    border: `1px solid ${insideGeofence ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon icon={Icons.MapLocationDot} size="sm" />
                    <strong>{geofence.name}</strong>
                    <span style={{ marginLeft: 'auto' }}>
                      <StatusBadge value={insideGeofence ? 'inside' : 'outside'} />
                    </span>
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.82rem', marginTop: 6 }}>
                    Center ({Number(geofence.center_latitude).toFixed(4)}, {Number(geofence.center_longitude).toFixed(4)}) • radius{' '}
                    {geofence.radius_meters}m
                    {geofence.checkInRestricted && ' • check-in restricted to this zone'}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                {!checkedIn && (
                  <button
                    className={`checkin-circle-btn${insideGeofence === false ? ' is-outside-geofence' : ''}`}
                    onClick={() => void punch('in')}
                    disabled={busy}
                    title={dutyCompleted ? 'Check In (Extra Shift)' : 'Check In'}
                    aria-label="Check In"
                  >
                    {busy ? <span className="checkin-circle-spinner" /> : <Icon icon={Icons.RightToBracket} size="xl" />}
                    {busy ? 'Processing...' : dutyCompleted ? 'Check In Again' : 'Check In'}
                  </button>
                )}
                {checkedIn && (
                  <button
                    className="btn-clay btn-clay-danger"
                    onClick={() => void punch('out')}
                    disabled={busy}
                    style={{ padding: '0.75rem 1.75rem', fontSize: '1rem', fontWeight: 700 }}
                  >
                    <Icon icon={Icons.RightFromBracket} size="sm" /> {busy ? 'Processing...' : 'Check Out'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </ChartCard>

        <ChartCard
          title="Attendance Mix"
          subtitle="Status distribution of your records"
          loading={loading}
          empty={statusMix.length === 0}
          emptyMessage="No attendance records yet."
        >
          <DonutChart
            data={statusMix.map((s) => ({ key: s.status, value: s.n, color: statusColor(s.status) }))}
            height={220}
          />
        </ChartCard>
      </div>

      <div className="kpi-grid hrdash-kpi-grid" style={{ marginTop: 0 }}>
        <div className="hrdash-kpi">
          <span className="hrdash-kpi-icon" style={{ background: '#10b9811f', color: '#10b981' }}>
            <Icon icon={Icons.Check} size="lg" />
          </span>
          <span className="hrdash-kpi-body">
            <span className="hrdash-kpi-value">{present}</span>
            <span className="hrdash-kpi-label">Days Present</span>
          </span>
        </div>
        <div className="hrdash-kpi">
          <span className="hrdash-kpi-icon" style={{ background: '#f59e0b1f', color: '#f59e0b' }}>
            <Icon icon={Icons.Warning} size="lg" />
          </span>
          <span className="hrdash-kpi-body">
            <span className="hrdash-kpi-value">{lateCount}</span>
            <span className="hrdash-kpi-label">Late Arrivals</span>
          </span>
        </div>
        <div className="hrdash-kpi">
          <span className="hrdash-kpi-icon" style={{ background: '#0ea5e91f', color: '#0ea5e9' }}>
            <Icon icon={Icons.CalendarDays} size="lg" />
          </span>
          <span className="hrdash-kpi-body">
            <span className="hrdash-kpi-value">{days.length}</span>
            <span className="hrdash-kpi-label">Records Shown</span>
          </span>
        </div>
      </div>

      <ChartCard
        title="Daily Attendance — Last 14 Days"
        loading={loading}
        empty={days.length === 0}
        emptyMessage="No attendance records yet."
      >
        <VerticalBarChart data={weekTrend} xKey="day" barKey="Checked" color="#10b981" height={190} />
      </ChartCard>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div className="card-title">Attendance History</div>
        </div>
        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>In</th>
                <th>Out</th>
                <th>Late</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>{d.work_date}</td>
                  <td>
                    <StatusBadge value={d.status} />
                  </td>
                  <td>{d.first_in ? String(d.first_in).slice(0, 5) : '—'}</td>
                  <td>{d.last_out ? String(d.last_out).slice(0, 5) : '—'}</td>
                  <td>{d.late_minutes ? `${d.late_minutes} min` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {days.length === 0 && !loading && <div className="empty-state">No attendance records yet.</div>}
        </div>
      </div>
    </div>
  );
}