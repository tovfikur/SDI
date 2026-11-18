import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type L from 'leaflet';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { fieldTracking, hr } from '../../api';
import { ChartCard } from '../../components/charts/ChartCard';
import { AreaTrendChart, DonutChart, HorizontalBarChart } from '../../components/charts/charts';
import type { Branch, FieldTrackingLiveEntry } from '../../api';
import { Icons, Icon } from '../../components/Icon';
import {
  coloredPin,
  formatClock,
  formatSeen,
  isValidCoordinate,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
} from './fieldMap';

const POLL_INTERVAL_MS = 30_000;

function isEntryStale(e: FieldTrackingLiveEntry): boolean {
  if (!e.last_seen_at) return true;
  const diffMs = Date.now() - new Date(e.last_seen_at).getTime();
  return Number.isNaN(diffMs) || diffMs > 30 * 60 * 1000;
}

function pinColor(e: FieldTrackingLiveEntry): string {
  if (isEntryStale(e)) {
    return '#94a3b8'; // Stale / offline
  }
  if (e.geofence?.status === 'outside') {
    return e.geofence.flag_exit ? '#dc2626' : '#f59e0b';
  }
  if (e.geofence?.status === 'unknown') {
    return '#f59e0b';
  }
  return '#16a34a';
}

function geofenceLabel(e: FieldTrackingLiveEntry): { text: string; tone: 'ok' | 'warn' | 'bad' } | null {
  const g = e.geofence;
  if (!g) return null;
  if (g.status === 'inside') return { text: `Inside ${g.name}`, tone: 'ok' };
  if (g.status === 'outside') {
    return { text: `Outside ${g.name}`, tone: g.flag_exit ? 'bad' : 'warn' };
  }
  if (g.status === 'unknown') return { text: 'GPS accuracy too low', tone: 'warn' };
  return null;
}

function MapFocusController({
  target,
  selectedSessionId,
  markerRefs,
}: {
  target: [number, number] | null;
  selectedSessionId: string | null;
  markerRefs: React.MutableRefObject<Map<string, L.Marker>>;
}): null {
  const map = useMap();

  useEffect(() => {
    if (!target) return undefined;
    map.flyTo(target, 16, { animate: true, duration: 1.2 });
    if (selectedSessionId) {
      const timer = setTimeout(() => {
        const marker = markerRefs.current.get(selectedSessionId);
        if (marker) {
          marker.openPopup();
        }
      }, 400);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [target, selectedSessionId, map, markerRefs]);

  return null;
}

export function FieldLiveTab(): ReactElement {
  const [entries, setEntries] = useState<FieldTrackingLiveEntry[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [outsideOnly, setOutsideOnly] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());

  const load = async () => {
    try {
      const res = await fieldTracking.live();
      setEntries(res.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load live tracking');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    async function loadBranches() {
      try {
        const res = await hr.branches({ perPage: 100 });
        setBranches((res.data as { items: Branch[] }).items ?? []);
      } catch {
        /* optional */
      }
    }
    void loadBranches();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchAnalytics() {
      setAnalyticsLoading(true);
      try {
        const res = await fieldTracking.analytics();
        if (!cancelled) setAnalytics(res.data as Record<string, unknown>);
      } catch {
        /* optional */
      }
      if (!cancelled) setAnalyticsLoading(false);
    }
    void fetchAnalytics();
    return () => {
      cancelled = true;
    };
  }, []);

  const validEntries = entries.filter((e) => isValidCoordinate(e.latitude, e.longitude));
  const byTeam = (analytics?.byTeam as Array<{ team: string; n: number }>) ?? [];
  const geofenceSummary = analytics?.geofence as
    | { trackingNow: number; inside: number; outside: number; noGeofence: number; flaggedOutside: number }
    | undefined;
  const activityTrend = (analytics?.activityTrend as Array<{ date: string; n: number }>) ?? [];
  const outsideCount = geofenceSummary?.flaggedOutside ?? 0;
  const geofenceMix = [
    { key: 'Inside', value: geofenceSummary?.inside ?? 0, color: '#16a34a' },
    { key: 'Outside', value: geofenceSummary?.outside ?? 0, color: '#dc2626' },
    { key: 'No geofence', value: geofenceSummary?.noGeofence ?? 0, color: '#94a3b8' },
  ].filter((g) => g.value > 0);

  const branchFiltered = selectedBranchId
    ? entries.filter((e) => e.branch_id === selectedBranchId)
    : entries;

  const shownEntries = outsideOnly
    ? branchFiltered.filter((e) => e.geofence?.status === 'outside' && e.geofence.flag_exit)
    : branchFiltered;

  const mapEntries = shownEntries.filter((e) => isValidCoordinate(e.latitude, e.longitude));

  const selectedEntry = entries.find((e) => e.session_id === selectedSessionId);
  const selectedBranch = branches.find((b) => b.id === selectedBranchId);
  const targetCoords: [number, number] | null =
    selectedEntry && isValidCoordinate(selectedEntry.latitude, selectedEntry.longitude)
      ? [selectedEntry.latitude as number, selectedEntry.longitude as number]
      : selectedBranch && isValidCoordinate(selectedBranch.latitude, selectedBranch.longitude)
        ? [selectedBranch.latitude as number, selectedBranch.longitude as number]
        : null;

  const boundaries = new Map<string, { lat: number; lng: number; radius: number; name: string }>();
  for (const e of validEntries) {
    if (e.geofence) {
      boundaries.set(e.geofence.id, {
        lat: e.geofence.center_latitude,
        lng: e.geofence.center_longitude,
        radius: e.geofence.radius_meters,
        name: e.geofence.name,
      });
    }
  }

  return (
    <div>
      <div className="analytics-metrics">
        <div className="analytics-metric">
          <div className="analytics-metric-value">{String(analytics?.activeOnDuty ?? entries.length)}</div>
          <div className="analytics-metric-label">Active on duty</div>
        </div>
        <div className="analytics-metric">
          <div className="analytics-metric-value">{String(analytics?.sessionsToday ?? '—')}</div>
          <div className="analytics-metric-label">Sessions today</div>
        </div>
        <div className="analytics-metric">
          <div className="analytics-metric-value">{String(analytics?.pointsLast24h ?? '—')}</div>
          <div className="analytics-metric-label">Check-in points (24h)</div>
        </div>
        <div className="analytics-metric">
          <div className="analytics-metric-value">
            {geofenceSummary ? String(geofenceSummary.inside) : '—'}
          </div>
          <div className="analytics-metric-label">Inside geofence</div>
        </div>
        <button
          className={`analytics-metric ${outsideCount > 0 ? 'metric-clickable' : ''}`}
          onClick={() => {
            if (outsideCount > 0) setOutsideOnly((o) => !o);
          }}
          title={outsideCount > 0 ? 'Filter the map/list to flagged outside employees' : undefined}
        >
          <div className="analytics-metric-value" style={{ color: outsideCount > 0 ? 'var(--danger)' : undefined }}>
            {String(outsideCount)}
          </div>
          <div className="analytics-metric-label">Outside geofence{outsideOnly ? ' (filtered)' : ''}</div>
        </button>
      </div>

      {!analyticsLoading && byTeam.length > 0 && (
        <div className="analytics-grid" style={{ marginBottom: '0.75rem' }}>
          <ChartCard
            title="Active by Team"
            subtitle="Field employees currently on duty per team"
            loading={analyticsLoading}
            empty={byTeam.length === 0}
          >
            <HorizontalBarChart
              data={byTeam.map((t) => ({ name: t.team || 'Unassigned', active: t.n }))}
              nameKey="name"
              valueKey="active"
              height={Math.max(140, byTeam.length * 34)}
            />
          </ChartCard>

          <ChartCard
            title="Inside vs Outside Geofence"
            subtitle="Live geofence state of active sessions"
            loading={analyticsLoading}
            empty={geofenceMix.length === 0}
          >
            <DonutChart data={geofenceMix} height={180} />
            <div className="chart-legend">
              {geofenceMix.map((g) => (
                <span key={g.key} className="chart-legend-item">
                  <span className="chart-legend-dot" style={{ background: g.color }} />
                  <span className="chart-legend-label">{g.key}</span>
                  <span className="chart-legend-value">{g.value}</span>
                </span>
              ))}
            </div>
          </ChartCard>
        </div>
      )}

      {!analyticsLoading && activityTrend.length > 0 && (
        <ChartCard
          title="Tracking Activity"
          subtitle="Tracking sessions per day over the last 14 days"
          loading={analyticsLoading}
          empty={activityTrend.length === 0}
        >
          <AreaTrendChart
            data={activityTrend.map((t) => ({ date: t.date, n: t.n }))}
            xKey="date"
            series={[{ key: 'n', color: 'var(--primary)' }]}
            valueFormatter={(v) => `${v} sessions`}
            height={180}
          />
        </ChartCard>
      )}

      <div className="stats-grid">
        <div className="stat-card-clay">
          <div>
            <div className="stat-label">Active field employees</div>
            <div className="stat-value">{entries.length}</div>
          </div>
        </div>
        <div className="stat-card-clay">
          <div>
            <div className="stat-label">Last refresh</div>
            <div className="stat-value" style={{ fontSize: '1.1rem' }}>
              {new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div
          className="data-table-error"
          style={{
            marginBottom: '1rem',
            padding: '0.6rem 0.9rem',
            background: 'var(--danger-bg)',
            borderRadius: 10,
            border: '1px solid var(--danger-border)',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}
      {loading && <div style={{ color: 'var(--text-dim)' }}>Loading live tracking…</div>}

      <div className="panel-clay" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: 2 }}>
              Filter by Branch
            </label>
            <select
              className="form-control-clay"
              style={{ minWidth: 220 }}
              value={selectedBranchId}
              onChange={(e) => {
                setSelectedBranchId(e.target.value);
                setSelectedSessionId(null);
              }}
            >
              <option value="">All Branches ({branches.length})</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} {b.code ? `(${b.code})` : ''}
                </option>
              ))}
            </select>
          </div>
          {selectedBranch && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', alignSelf: 'flex-end', paddingBottom: 6 }}>
              Showing members for: <strong style={{ color: 'var(--primary)' }}>{selectedBranch.name}</strong>
              {isValidCoordinate(selectedBranch.latitude, selectedBranch.longitude) ? ' · Map centered on branch' : ''}
              <button
                type="button"
                className="btn-clay btn-clay-xs btn-clay-secondary"
                style={{ marginLeft: '0.6rem' }}
                onClick={() => {
                  setSelectedBranchId('');
                  setSelectedSessionId(null);
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="glass-panel" style={{ flex: '1 1 280px', minWidth: 260, maxHeight: 640, overflowY: 'auto' }}>
          {shownEntries.length === 0 && !loading && (
            <div className="empty-state">
              <div className="empty-state-icon">◈</div>
              <div className="empty-state-title">
                {outsideOnly ? 'No flagged outside employees' : 'No employees checked in'}
              </div>
              <div className="empty-state-hint">
                {outsideOnly
                  ? 'Employees inside their geofence or with flagging disabled are hidden.'
                  : 'Field employees will appear here in real time once they check in from the field.'}
              </div>
            </div>
          )}
          {shownEntries.map((e) => {
            const isSelected = selectedSessionId === e.session_id;
            const hasGps = isValidCoordinate(e.latitude, e.longitude);
            return (
              <div
                key={e.session_id}
                className="live-stat-row"
                onClick={() => {
                  if (hasGps) {
                    setSelectedSessionId(e.session_id);
                  }
                }}
                style={{
                  cursor: hasGps ? 'pointer' : 'default',
                  borderLeft: isSelected ? '4px solid var(--primary, #017833)' : '4px solid transparent',
                  background: isSelected ? 'rgba(1, 120, 51, 0.08)' : undefined,
                  transition: 'all 0.2s ease',
                  boxShadow: isSelected ? '0 0 0 1px var(--primary, #017833)' : undefined,
                }}
                title={hasGps ? 'Click to zoom and point to employee on GPS map' : 'No GPS coordinates available'}
              >
                <div>
                  <div
                    className="live-stat-value"
                    style={{
                      fontSize: '0.9rem',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>{e.employee_name}</span>
                    <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>
                      ({e.employee_code})
                    </span>
                    {isSelected && (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          color: 'var(--primary)',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.2rem',
                        }}
                      >
                        <Icon icon={Icons.LocationDot} size="xs" /> Focused
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                    {[e.position_name, e.department_name].filter(Boolean).join(' · ') || '—'}
                  </div>
                  {e.branch_name && (
                    <div style={{ fontSize: '0.74rem', color: 'var(--primary)', marginTop: '0.15rem', fontWeight: 600 }}>
                      🏢 {e.branch_name}
                    </div>
                  )}
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                    Checked in {formatClock(e.started_at)} · last seen {formatSeen(e.last_seen_at)}
                  </div>
                  {geofenceLabel(e) && (
                    <div
                      className={`attendance-geofence-status`}
                      data-tone={geofenceLabel(e)?.tone}
                      style={{ marginTop: '0.3rem' }}
                    >
                      {geofenceLabel(e)?.text}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
                  <span
                    className={`badge-clay ${
                      isEntryStale(e)
                        ? 'badge-clay'
                        : e.geofence?.status === 'outside' && e.geofence.flag_exit
                          ? 'badge-clay-danger'
                          : e.geofence?.status === 'outside'
                            ? 'badge-clay-warning'
                            : 'badge-clay-success'
                    }`}
                  >
                    {isEntryStale(e)
                      ? 'IDLE / NO GPS'
                      : e.geofence?.status === 'inside'
                        ? 'INSIDE'
                        : e.geofence?.status === 'outside'
                          ? 'OUTSIDE'
                          : e.geofence
                            ? 'UNKNOWN'
                            : 'ACTIVE'}
                  </span>
                  {hasGps && (
                    <span style={{ fontSize: '0.72rem', color: isSelected ? 'var(--primary)' : 'var(--text-dim)' }}>
                      {isSelected ? '🎯 On Map' : '📍 Click to locate'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div
          className="map-shell"
          style={{
            flex: '3 1 480px',
            minWidth: 320,
            height: 640,
          }}
        >
          <MapContainer
            center={DEFAULT_MAP_CENTER}
            zoom={DEFAULT_MAP_ZOOM}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapFocusController
              target={targetCoords}
              selectedSessionId={selectedSessionId}
              markerRefs={markerRefs}
            />
            {[...boundaries.values()].map((b) => (
              <Circle
                key={`${b.lat},${b.lng}`}
                center={[b.lat, b.lng]}
                radius={b.radius}
                pathOptions={{ color: '#017833', fillColor: '#017833', fillOpacity: 0.06, weight: 1 }}
              >
                <Popup>
                  <div style={{ fontSize: '0.8rem' }}>{b.name}</div>
                </Popup>
              </Circle>
            ))}
            {selectedBranch && isValidCoordinate(selectedBranch.latitude, selectedBranch.longitude) && (
              <>
                <Circle
                  center={[selectedBranch.latitude as number, selectedBranch.longitude as number]}
                  radius={selectedBranch.radius_meters || 300}
                  pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.15, weight: 2 }}
                >
                  <Popup>
                    <div style={{ fontSize: '0.85rem' }}>
                      <div style={{ fontWeight: 700, color: '#2563eb' }}>🏢 {selectedBranch.name}</div>
                      {selectedBranch.code && <div>Code: {selectedBranch.code}</div>}
                      {selectedBranch.address && <div>Address: {selectedBranch.address}</div>}
                      <div>Radius: {selectedBranch.radius_meters || 300}m</div>
                    </div>
                  </Popup>
                </Circle>
                <Marker
                  position={[selectedBranch.latitude as number, selectedBranch.longitude as number]}
                  icon={coloredPin('#2563eb')}
                >
                  <Popup>
                    <div style={{ fontSize: '0.85rem' }}>
                      <div style={{ fontWeight: 700, color: '#2563eb' }}>🏢 Branch: {selectedBranch.name}</div>
                      {selectedBranch.address && <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>{selectedBranch.address}</div>}
                    </div>
                  </Popup>
                </Marker>
              </>
            )}
            {mapEntries.map((e) => (
              <Marker
                key={e.session_id}
                ref={(ref) => {
                  if (ref) {
                    markerRefs.current.set(e.session_id, ref);
                  } else {
                    markerRefs.current.delete(e.session_id);
                  }
                }}
                eventHandlers={{
                  click: () => {
                    setSelectedSessionId(e.session_id);
                  },
                }}
                position={[e.latitude as number, e.longitude as number]}
                icon={coloredPin(pinColor(e))}
              >
                <Popup>
                  <div style={{ fontSize: '0.85rem', minWidth: 160 }}>
                    <div style={{ fontWeight: 700 }}>{e.employee_name}</div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>
                      {e.employee_code}
                    </div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>
                      {[e.position_name, e.department_name].filter(Boolean).join(' · ') || '—'}
                    </div>
                    <hr
                      style={{
                        margin: '0.4rem 0',
                        border: 'none',
                        borderTop: '1px solid var(--border-subtle)',
                      }}
                    />
                    <div>Checked in: {formatClock(e.started_at)}</div>
                    <div>Last seen: {formatSeen(e.last_seen_at)}</div>
                    {e.accuracy != null && <div>Accuracy: ±{Math.round(e.accuracy)}m</div>}
                    {geofenceLabel(e) && (
                      <div style={{ marginTop: '0.3rem' }}>Geofence: {geofenceLabel(e)?.text}</div>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
