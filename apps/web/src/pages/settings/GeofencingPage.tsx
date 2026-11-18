import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { MapContainer, TileLayer, Circle, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { geofence, hr } from '../../api';
import type {
  Geofence,
  GeofenceAssignment,
  GeofenceEvent,
  GeofenceScopeType,
} from '../../api';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { Icon, Icons } from '../../components/Icon';
import { formatSeen, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../hr/fieldMap';

interface ScopeOption {
  id: string;
  label: string;
}

interface GeofenceForm {
  name: string;
  description: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusMeters: number;
  status: 'active' | 'inactive';
}

const EMPTY_FORM: GeofenceForm = {
  name: '',
  description: '',
  centerLatitude: DEFAULT_MAP_CENTER[0],
  centerLongitude: DEFAULT_MAP_CENTER[1],
  radiusMeters: 300,
  status: 'active',
};

const SCOPE_LABELS: Record<GeofenceScopeType, string> = {
  employee: 'Employee',
  department: 'Department',
  employee_type: 'Employee type',
  setup_rule: 'Work schedule',
};

function MapClickCapture({
  onMapClick,
}: {
  onMapClick: (lat: number, lng: number) => void;
}): ReactElement {
  useMapEvents({
    click: (e) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return <></>;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

function MapLocationSearch({
  onLocationSelect,
}: {
  onLocationSelect: (lat: number, lng: number) => void;
}): ReactElement {
  const map = useMap();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function doSearch(q: string) {
    if (q.trim().length < 3) {
      setResults([]);
      setOpen(false);
      setError('');
      return;
    }
    setSearching(true);
    setError('');
    setOpen(true);
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`, {
      headers: { Accept: 'application/json' },
    })
      .then((r) => {
        if (!r.ok) throw new Error('Request failed');
        return r.json();
      })
      .then((data: NominatimResult[]) => {
        setResults(data);
        setSearching(false);
      })
      .catch(() => {
        setError('Location search failed');
        setResults([]);
        setSearching(false);
      });
  }

  function handleChange(val: string) {
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 400);
  }

  function selectResult(r: NominatimResult) {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    map.flyTo([lat, lng], Math.max(map.getZoom(), 15));
    onLocationSelect(lat, lng);
    setQuery(r.display_name.split(',')[0]);
    setOpen(false);
    setResults([]);
  }

  return (
    <div
      ref={wrapperRef}
      className="geofence-location-search"
      style={{
        position: 'absolute',
        top: 10,
        left: 50,
        right: 10,
        zIndex: 1000,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
          overflow: 'hidden',
        }}
      >
        <span style={{ padding: '0 8px', color: '#888', display: 'flex', alignItems: 'center' }}>
          <Icon icon={Icons.Search} size="sm" />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (results.length > 0 || error) setOpen(true); }}
          placeholder="Search location..."
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            padding: '10px 10px 10px 0',
            fontSize: '0.85rem',
            background: 'transparent',
            color: 'var(--text-main, #1a1a1a)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            maxHeight: 240,
            overflowY: 'auto',
            zIndex: 1001,
            pointerEvents: 'auto',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {searching && (
            <div style={{ padding: '12px 14px', color: '#888', fontSize: '0.85rem' }}>
              Searching...
            </div>
          )}
          {!searching && error && (
            <div style={{ padding: '12px 14px', color: '#c00', fontSize: '0.85rem' }}>{error}</div>
          )}
          {!searching && !error && results.length === 0 && (
            <div style={{ padding: '12px 14px', color: '#888', fontSize: '0.85rem' }}>
              No locations found
            </div>
          )}
          {!searching && !error && results.map((r, i) => (
            <div
              key={i}
              style={{
                padding: '10px 14px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                borderBottom: i < results.length - 1 ? '1px solid #eee' : 'none',
                color: 'var(--text-main, #1a1a1a)',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#f5f5f5'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#fff'; }}
              onClick={() => selectResult(r)}
            >
              {r.display_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CenterUpdater({ center }: { center: [number, number] }): ReactElement {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return <></>;
}

export function GeofencingPage(): ReactElement {
  const { toast } = useToast();
  const [tab, setTab] = useState<'geofences' | 'breaches'>('geofences');

  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Geofence | null>(null);
  const [form, setForm] = useState<GeofenceForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const [assignTarget, setAssignTarget] = useState<Geofence | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Geofence | null>(null);
  const [removeTarget, setRemoveTarget] = useState<GeofenceAssignment | null>(null);
  const [assignments, setAssignments] = useState<GeofenceAssignment[]>([]);
  const [assignForm, setAssignForm] = useState({
    scopeType: 'employee' as GeofenceScopeType,
    scopeId: '',
    enabled: true,
    restrictCheckIn: true,
    restrictCheckOut: false,
    monitorExit: true,
    flagExit: true,
  });

  const [breaches, setBreaches] = useState<GeofenceEvent[]>([]);
  const [breachLoading, setBreachLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await geofence.list({ search, perPage: 100 });
      setGeofences(res.data.items);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load geofences', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadBreaches = useCallback(async () => {
    setBreachLoading(true);
    try {
      const res = await geofence.breaches({ perPage: 50 });
      setBreaches(res.data.items);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load breaches', 'error');
    } finally {
      setBreachLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (tab === 'breaches') {
      void loadBreaches();
    }
  }, [tab, loadBreaches]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (g: Geofence) => {
    setEditing(g);
    setForm({
      name: g.name,
      description: g.description,
      centerLatitude: g.center_latitude,
      centerLongitude: g.center_longitude,
      radiusMeters: g.radius_meters,
      status: g.status,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (form.name.trim() === '') {
      toast('Geofence name is required', 'error');
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await geofence.update(editing.id, {
          name: form.name,
          description: form.description,
          centerLatitude: form.centerLatitude,
          centerLongitude: form.centerLongitude,
          radiusMeters: form.radiusMeters,
          status: form.status,
        });
        toast('Geofence updated', 'success');
      } else {
        await geofence.create({
          name: form.name,
          description: form.description,
          centerLatitude: form.centerLatitude,
          centerLongitude: form.centerLongitude,
          radiusMeters: form.radiusMeters,
        });
        toast('Geofence created', 'success');
      }
      setFormOpen(false);
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const deactivate = async (g: Geofence, deletePassword: string) => {
    try {
      await geofence.deactivate(g.id, deletePassword);
      toast('Geofence deactivated', 'success');
      setDeactivateTarget(null);
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to deactivate', 'error');
    }
  };

  const openAssignments = async (g: Geofence) => {
    setAssignTarget(g);
    setAssignForm({
      scopeType: 'employee',
      scopeId: '',
      enabled: true,
      restrictCheckIn: true,
      restrictCheckOut: false,
      monitorExit: true,
      flagExit: true,
    });
    try {
      const res = await geofence.assignments(g.id);
      setAssignments(res.data);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load assignments', 'error');
    }
  };

  const addAssignment = async () => {
    if (!assignTarget || !assignForm.scopeId) {
      toast('Select a scope to assign', 'error');
      return;
    }
    try {
      await geofence.createAssignment(assignTarget.id, assignForm);
      toast('Assignment added', 'success');
      const res = await geofence.assignments(assignTarget.id);
      setAssignments(res.data);
      setAssignForm({ ...assignForm, scopeId: '' });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to add assignment', 'error');
    }
  };

  const updateAssignmentFlag = async (a: GeofenceAssignment, patch: Record<string, boolean>) => {
    try {
      await geofence.updateAssignment(a.id, patch);
      setAssignments((prev) => prev.map((x) => (x.id === a.id ? { ...x, ...patch } : x)));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed', 'error');
    }
  };

  const removeAssignment = async (a: GeofenceAssignment, deletePassword: string) => {
    try {
      await geofence.removeAssignment(a.id, deletePassword);
      setAssignments((prev) => prev.filter((x) => x.id !== a.id));
      setRemoveTarget(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Remove failed', 'error');
    }
  };

  const mapClick = useCallback((lat: number, lng: number) => {
    setForm((f) => ({ ...f, centerLatitude: lat, centerLongitude: lng }));
  }, []);

  const activeCount = geofences.filter((g) => g.status === 'active').length;

  return (
    <div>
      <PageHeader
        title="Geofencing"
        subtitle="Configure optional location areas for attendance and field force tracking. Leave unassigned to keep tracking unrestricted."
      />

      <div className="filter-bar" style={{ alignItems: 'flex-end' }}>
        <div style={{ minWidth: 240, flex: '1 1 220px' }}>
          <label className="form-label">Search</label>
          <input
            className="form-control-clay"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or description…"
          />
        </div>
        <button className="btn-clay btn-clay-primary" onClick={() => void load()}>
          Apply
        </button>
        <button className="btn-clay btn-clay-secondary" onClick={openCreate}>
          <Icon icon={Icons.Plus} size="sm" /> New Geofence
        </button>
      </div>

      <div className="settings-subnav" style={{ margin: '0.75rem 0' }}>
        <button
          className={`settings-nav-link ${tab === 'geofences' ? 'active' : ''}`}
          onClick={() => setTab('geofences')}
        >
          Geofences ({activeCount} active)
        </button>
        <button
          className={`settings-nav-link ${tab === 'breaches' ? 'active' : ''}`}
          onClick={() => setTab('breaches')}
        >
          Breach History
        </button>
      </div>

      {tab === 'geofences' && (
        <div>
          {loading ? (
            <div className="analytics-skeleton" style={{ height: 160 }} />
          ) : geofences.length === 0 ? (
            <div className="empty-state">No geofences yet — create one and assign it to apply.</div>
          ) : (
            <div className="table-wrap">
              <table className="table-clay">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Center</th>
                    <th>Radius</th>
                    <th>Assignments</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {geofences.map((g) => (
                    <tr key={g.id}>
                      <td>
                        <strong>{g.name}</strong>
                        {g.description && (
                          <div className="cell-subtext">{g.description}</div>
                        )}
                      </td>
                      <td>
                        <span className={`status-badge ${g.status === 'active' ? 'status-active' : 'status-inactive'}`}>
                          {g.status}
                        </span>
                      </td>
                      <td className="cell-mono">
                        {g.center_latitude.toFixed(5)}, {g.center_longitude.toFixed(5)}
                      </td>
                      <td>{Math.round(g.radius_meters)} m</td>
                      <td>{g.assignments_count ?? 0}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => void openEdit(g)}>
                            Edit
                          </button>
                          <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => void openAssignments(g)}>
                            Assign
                          </button>
                          {g.status === 'active' && (
                            <button className="btn-clay btn-clay-sm btn-clay-danger" onClick={() => setDeactivateTarget(g)}>
                              Deactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'breaches' && (
        <div>
          <p className="cell-subtext" style={{ marginBottom: '0.75rem' }}>
            ENTER / EXIT transitions across all geofenced sessions. Exits are jitter-stabilized
            (two consecutive outside fixes are required).
          </p>
          {breachLoading ? (
            <div className="analytics-skeleton" style={{ height: 160 }} />
          ) : breaches.length === 0 ? (
            <div className="empty-state">No geofence breach events recorded.</div>
          ) : (
            <div className="table-wrap">
              <table className="table-clay">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Employee</th>
                    <th>Event</th>
                    <th>Geofence</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {breaches.map((b) => (
                    <tr key={b.id}>
                      <td>{formatSeen(b.occurred_at)}</td>
                      <td>
                        {b.employee_name}
                        <span className="cell-subtext"> ({b.employee_code})</span>
                      </td>
                      <td>
                        <span className={`status-badge ${b.event_type === 'exited' ? 'status-warning' : 'status-active'}`}>
                          {b.event_type === 'exited' ? 'EXITED' : 'ENTERED'}
                        </span>
                      </td>
                      <td>{b.geofence_name}</td>
                      <td className="cell-mono">
                        {b.latitude.toFixed(5)}, {b.longitude.toFixed(5)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Modal
        title={editing ? `Edit Geofence — ${editing.name}` : 'New Geofence'}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel={editing ? 'Update' : 'Create'}
        wide
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Name <span className="form-required">*</span>
            </label>
            <input
              className="form-control-clay"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Head Office Dhaka"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <input
              className="form-control-clay"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional notes"
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Radius (meters)</label>
            <input
              type="number"
              min={10}
              max={100000}
              className="form-control-clay"
              value={form.radiusMeters}
              onChange={(e) =>
                setForm({ ...form, radiusMeters: Math.max(10, Number(e.target.value) || 10) })
              }
            />
          </div>
          {editing && (
            <div className="form-group">
              <label className="form-label">Status</label>
              <select
                className="form-control-clay"
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as 'active' | 'inactive' })
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Center</label>
            <input
              className="form-control-clay cell-mono"
              value={`${form.centerLatitude.toFixed(5)}, ${form.centerLongitude.toFixed(5)}`}
              readOnly
            />
          </div>
        </div>
        <div className="form-label" style={{ marginBottom: '0.35rem' }}>
          Click the map to set the center
        </div>
        <div style={{ height: 300, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', position: 'relative' }}>
          <MapContainer
            center={[form.centerLatitude, form.centerLongitude]}
            zoom={DEFAULT_MAP_ZOOM}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <CenterUpdater center={[form.centerLatitude, form.centerLongitude]} />
            <Circle
              center={[form.centerLatitude, form.centerLongitude]}
              radius={form.radiusMeters}
              pathOptions={{ color: 'var(--brand, #017833)', fillColor: 'var(--brand, #017833)', fillOpacity: 0.15 }}
            />
            <Marker
              position={[form.centerLatitude, form.centerLongitude]}
              icon={L.divIcon({
                className: 'field-map-pin',
                html: '<div class="field-map-pin-dot" style="background:var(--brand, #017833)"></div>',
                iconSize: [18, 18],
                iconAnchor: [9, 9],
              })}
            />
            <MapClickCapture onMapClick={mapClick} />
            <MapLocationSearch onLocationSelect={(lat, lng) => setForm((f) => ({ ...f, centerLatitude: lat, centerLongitude: lng }))} />
          </MapContainer>
        </div>
        {editing && (
          <p className="cell-subtext" style={{ marginTop: '0.6rem' }}>
            Changing the center or radius applies immediately to assigned employees. Deactivation is
            preferred over deletion — history is preserved.
          </p>
        )}
      </Modal>

      <Modal
        title={assignTarget ? `Assign — ${assignTarget.name}` : 'Assign'}
        open={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
        wide
        footer={
          <>
            <button className="btn-clay btn-clay-secondary" onClick={() => setAssignTarget(null)}>
              Close
            </button>
          </>
        }
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Scope type</label>
            <select
              className="form-control-clay"
              value={assignForm.scopeType}
              onChange={(e) =>
                setAssignForm({
                  ...assignForm,
                  scopeType: e.target.value as GeofenceScopeType,
                  scopeId: '',
                })
              }
            >
              <option value="employee">Employee</option>
              <option value="department">Department</option>
              <option value="employee_type">Employee type</option>
              <option value="setup_rule">Work schedule</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 2 }}>
            <label className="form-label">Scope</label>
            <ScopeSelect
              type={assignForm.scopeType}
              value={assignForm.scopeId}
              onChange={(v) => setAssignForm({ ...assignForm, scopeId: v })}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              <input
                type="checkbox"
                checked={assignForm.enabled}
                onChange={(e) => setAssignForm({ ...assignForm, enabled: e.target.checked })}
              />{' '}
              Enabled
            </label>
            <div className="cell-subtext">Disabled = geofence not applied to this scope.</div>
          </div>
          <div className="form-group">
            <label className="form-label">
              <input
                type="checkbox"
                checked={assignForm.restrictCheckIn}
                onChange={(e) =>
                  setAssignForm({ ...assignForm, restrictCheckIn: e.target.checked })
                }
              />{' '}
              Restrict check-in
            </label>
            <div className="cell-subtext">Refuse check-in while outside.</div>
          </div>
          <div className="form-group">
            <label className="form-label">
              <input
                type="checkbox"
                checked={assignForm.restrictCheckOut}
                onChange={(e) =>
                  setAssignForm({ ...assignForm, restrictCheckOut: e.target.checked })
                }
              />{' '}
              Restrict check-out
            </label>
            <div className="cell-subtext">Refuse check-out while outside.</div>
          </div>
          <div className="form-group">
            <label className="form-label">
              <input
                type="checkbox"
                checked={assignForm.monitorExit}
                onChange={(e) => setAssignForm({ ...assignForm, monitorExit: e.target.checked })}
              />{' '}
              Monitor exits
            </label>
            <div className="cell-subtext">Record ENTER / EXIT events.</div>
          </div>
          <div className="form-group">
            <label className="form-label">
              <input
                type="checkbox"
                checked={assignForm.flagExit}
                onChange={(e) => setAssignForm({ ...assignForm, flagExit: e.target.checked })}
              />{' '}
              Flag outside
            </label>
            <div className="cell-subtext">Highlight outside employees in the live map.</div>
          </div>
        </div>
        <button
          className="btn-clay btn-clay-primary"
          onClick={() => void addAssignment()}
          disabled={!assignForm.scopeId}
        >
          Add Assignment
        </button>

        <h4 style={{ margin: '1.25rem 0 0.5rem' }}>Current assignments</h4>
        {assignments.length === 0 ? (
          <div className="empty-state" style={{ fontSize: '0.85rem' }}>
            No assignments yet.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table-clay">
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>Enabled</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Monitor</th>
                  <th>Flag</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {SCOPE_LABELS[a.scope_type]}: {a.scope_name}
                    </td>
                    <td>
                      <Toggle
                        checked={a.enabled}
                        onToggle={(v) => void updateAssignmentFlag(a, { enabled: v })}
                      />
                    </td>
                    <td>
                      <Toggle
                        checked={a.restrict_check_in}
                        onToggle={(v) => void updateAssignmentFlag(a, { restrict_check_in: v })}
                      />
                    </td>
                    <td>
                      <Toggle
                        checked={a.restrict_check_out}
                        onToggle={(v) => void updateAssignmentFlag(a, { restrict_check_out: v })}
                      />
                    </td>
                    <td>
                      <Toggle
                        checked={a.monitor_exit}
                        onToggle={(v) => void updateAssignmentFlag(a, { monitor_exit: v })}
                      />
                    </td>
                    <td>
                      <Toggle
                        checked={a.flag_exit}
                        onToggle={(v) => void updateAssignmentFlag(a, { flag_exit: v })}
                      />
                    </td>
                    <td>
                      <button
                        className="btn-clay btn-clay-sm btn-clay-danger"
                        onClick={() => setRemoveTarget(a)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
      <ProtectedDeleteModal
        title="Deactivate Geofence"
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={(deletePassword) => (deactivateTarget && deactivate(deactivateTarget, deletePassword)) ?? Promise.resolve()}
        message={
          <p>
            Deactivate <strong>{deactivateTarget?.name}</strong>? Existing history is kept, but the
            geofence will stop applying.
          </p>
        }
      />
      <ProtectedDeleteModal
        title="Deactivate Geofence"
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={(deletePassword) => (deactivateTarget && deactivate(deactivateTarget, deletePassword)) ?? Promise.resolve()}
        message={
          <p>
            Deactivate <strong>{deactivateTarget?.name}</strong>? Existing history is kept, but the
            geofence will stop applying.
          </p>
        }
      />
      <ProtectedDeleteModal
        title="Remove Assignment"
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={(deletePassword) => (removeTarget && removeAssignment(removeTarget, deletePassword)) ?? Promise.resolve()}
        message={<p>Remove this assignment?</p>}
      />
    </div>
  );
}

function Toggle({ checked, onToggle }: { checked: boolean; onToggle: (v: boolean) => void }): ReactElement {
  return (
    <button
      type="button"
      className={`toggle-switch ${checked ? 'on' : ''}`}
      onClick={() => onToggle(!checked)}
      aria-pressed={checked}
    >
      <span className="toggle-knob" />
    </button>
  );
}

function ScopeSelect({
  type,
  value,
  onChange,
}: {
  type: GeofenceScopeType;
  value: string;
  onChange: (v: string) => void;
}): ReactElement {
  const [options, setOptions] = useState<ScopeOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const loader: Promise<{ data: { items: Array<{ id: string; full_name?: string; name?: string; title?: string }> } }> =
      type === 'employee'
        ? (hr.employees({ perPage: 100 }) as Promise<{ data: { items: Array<{ id: string; full_name?: string }> } }>)
        : type === 'department'
          ? (hr.departments() as Promise<{ data: { items: Array<{ id: string; name?: string }> } }>)
          : type === 'employee_type'
            ? (hr.employeeTypes() as Promise<{ data: { items: Array<{ id: string; name?: string }> } }>)
            : (hr.setupRules() as Promise<{ data: { items: Array<{ id: string; title?: string }> } }>);
    void loader
      .then((res) => {
        const items = res.data.items;
        const mapped: ScopeOption[] = items.map((it) => ({
          id: it.id,
          label:
            'full_name' in it && typeof it.full_name === 'string'
              ? it.full_name
              : 'name' in it && typeof it.name === 'string'
                ? it.name
                : 'title' in it && typeof it.title === 'string'
                  ? it.title
                  : it.id,
        }));
        if (!cancelled) setOptions(mapped);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  if (loading) return <span className="cell-subtext">Loading…</span>;
  return (
    <select className="form-control-clay" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select…</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}