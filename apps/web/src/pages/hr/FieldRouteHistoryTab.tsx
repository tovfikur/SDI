import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet';
import { fieldTracking, hr } from '../../api';
import type { FieldTrackingRouteData, FieldTrackingRouteSession } from '../../api';
import {
  coloredPin,
  formatClock,
  isValidCoordinate,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
} from './fieldMap';

interface EmployeeOption {
  id: string;
  full_name: string;
  employee_code: string;
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function FieldRouteHistoryTab(): ReactElement {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [route, setRoute] = useState<FieldTrackingRouteData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEmployees() {
      try {
        const res = await hr.employees({ perPage: 100 });
        if (!cancelled) setEmployees((res.data as { items: EmployeeOption[] }).items);
      } catch {
        /* employee picker is not critical */
      }
    }
    void loadEmployees();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRoute = async () => {
    if (!employeeId) {
      setError('Select an employee first');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fieldTracking.route(employeeId, { date });
      setRoute(res.data);
      setSelectedSession(res.data.sessions.length > 0 ? res.data.sessions[0].session_id : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load route');
      setRoute(null);
    } finally {
      setLoading(false);
    }
  };

  const session: FieldTrackingRouteSession | null =
    route?.sessions.find((s) => s.session_id === selectedSession) ?? null;

  const points = useMemo(() => {
    if (!session) return [];
    return session.points.filter((p) => isValidCoordinate(p.latitude, p.longitude));
  }, [session]);

  const polyline: [number, number][] = useMemo(
    () => points.map((p) => [p.latitude, p.longitude] as [number, number]),
    [points]
  );

  return (
    <div>
      <div className="filter-bar" style={{ alignItems: 'flex-end' }}>
        <div style={{ minWidth: 240, flex: '1 1 220px' }}>
          <label className="form-label">Employee</label>
          <select
            className="form-control-clay"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Select employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} ({e.employee_code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">Date</label>
          <input
            type="date"
            className="form-control-clay"
            value={date}
            max={todayLocal()}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <button
          className="btn-clay btn-clay-primary"
          onClick={() => void loadRoute()}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Load Route'}
        </button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.6rem 0.9rem',
            background: 'var(--danger-bg)',
            borderRadius: 10,
            border: '1px solid var(--danger-border)',
            color: 'var(--danger)',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      {route?.employee && (
        <div className="glass-panel" style={{ marginBottom: '1rem', maxWidth: 480 }}>
          <div className="glass-panel-title">{route.employee.full_name}</div>
          <div className="glass-panel-subtitle">
            {route.employee.employee_code} ·{' '}
            {[route.employee.position_name, route.employee.department_name]
              .filter(Boolean)
              .join(' · ') || '—'}
          </div>
        </div>
      )}

      {route && route.sessions.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">◈</div>
          <div className="empty-state-title">No sessions found</div>
          <div className="empty-state-hint">No field tracking sessions on this date.</div>
        </div>
      )}

      {route && route.sessions.length > 1 && (
        <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {route.sessions.map((s, i) => (
            <button
              key={s.session_id}
              className={`btn-clay btn-clay-sm ${selectedSession === s.session_id ? 'btn-clay-primary' : 'btn-clay-secondary'}`}
              onClick={() => setSelectedSession(s.session_id)}
            >
              Session {i + 1} ({formatClock(s.started_at)} – {formatClock(s.ended_at)})
            </button>
          ))}
        </div>
      )}

      {session && (
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ flex: '1 1 280px', minWidth: 260 }}>
            <div className="stat-card-clay" style={{ marginBottom: '0.75rem' }}>
              <div>
                <div className="stat-label">Check-in</div>
                <div className="stat-value" style={{ fontSize: '1.05rem' }}>
                  {formatClock(session.started_at)}
                </div>
              </div>
            </div>
            <div className="stat-card-clay" style={{ marginBottom: '0.75rem' }}>
              <div>
                <div className="stat-label">Check-out</div>
                <div className="stat-value" style={{ fontSize: '1.05rem' }}>
                  {formatClock(session.ended_at) ?? '—'}
                </div>
              </div>
            </div>
            <div className="stat-card-clay">
              <div>
                <div className="stat-label">GPS points</div>
                <div className="stat-value">{points.length}</div>
              </div>
            </div>
          </div>

          <div
            className="map-shell"
            style={{
              flex: '3 1 480px',
              minWidth: 320,
              height: 560,
            }}
          >
            <MapContainer
              center={
                isValidCoordinate(session.start_latitude, session.start_longitude)
                  ? [session.start_latitude, session.start_longitude]
                  : DEFAULT_MAP_CENTER
              }
              zoom={DEFAULT_MAP_ZOOM}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {polyline.length >= 2 && (
                <Polyline
                  positions={polyline}
                  pathOptions={{ color: '#2563eb', weight: 3, opacity: 0.75 }}
                />
              )}
              {session.geofence && (
                <Circle
                  center={[session.geofence.center_latitude, session.geofence.center_longitude]}
                  radius={session.geofence.radius_meters}
                  pathOptions={{ color: '#017833', fillColor: '#017833', fillOpacity: 0.06, weight: 1 }}
                >
                  <Popup>
                    <div style={{ fontSize: '0.8rem' }}>
                      Geofence: {session.geofence.name}
                    </div>
                  </Popup>
                </Circle>
              )}
              {session.geofence_events
                .filter((ev) => isValidCoordinate(ev.latitude, ev.longitude))
                .map((ev) => (
                  <CircleMarker
                    key={`${ev.occurred_at}-${ev.event_type}`}
                    center={[ev.latitude, ev.longitude]}
                    radius={7}
                    pathOptions={{
                      color: ev.event_type === 'exited' ? '#dc2626' : '#16a34a',
                      fillColor: ev.event_type === 'exited' ? '#fca5a5' : '#86efac',
                      fillOpacity: 0.9,
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <div style={{ fontSize: '0.8rem' }}>
                        <strong>{ev.event_type === 'exited' ? 'EXITED' : 'ENTERED'} geofence</strong>
                        <div style={{ color: 'var(--text-dim)' }}>{formatClock(ev.occurred_at)}</div>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
              {isValidCoordinate(session.start_latitude, session.start_longitude) && (
                <Marker
                  position={[session.start_latitude, session.start_longitude]}
                  icon={coloredPin('#16a34a')}
                >
                  <Popup>Check-in point — {formatClock(session.started_at)}</Popup>
                </Marker>
              )}
              {isValidCoordinate(session.end_latitude, session.end_longitude) && (
                <Marker
                  position={[session.end_latitude as number, session.end_longitude as number]}
                  icon={coloredPin('#dc2626')}
                >
                  <Popup>Check-out point — {formatClock(session.ended_at)}</Popup>
                </Marker>
              )}
              {points.map((p) => (
                <CircleMarker
                  key={`${p.captured_at}-${p.latitude}-${p.longitude}`}
                  center={[p.latitude, p.longitude]}
                  radius={4}
                  pathOptions={{
                    color: '#2563eb',
                    fillColor: '#93c5fd',
                    fillOpacity: 0.8,
                    weight: 1,
                  }}
                >
                  <Popup>
                    <div style={{ fontSize: '0.8rem' }}>
                      {formatClock(p.captured_at)}
                      {p.accuracy != null ? ` (±${Math.round(p.accuracy)}m)` : ''}
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        </div>
      )}
    </div>
  );
}