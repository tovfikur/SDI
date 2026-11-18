import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { useNavigate } from 'react-router-dom';
import { hr, projects } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { ChartCard } from '../../components/charts/ChartCard';
import { HorizontalBarChart } from '../../components/charts/charts';
import { PageHeader } from '../../components/PageHeader';
import { isValidHex, PROJECT_COLOR_PRESETS, projectProgressStyle } from '../../utils/projectCard';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon, Icons } from '../../components/Icon';
import { Circle, MapContainer, Marker, TileLayer } from 'react-leaflet';

interface Row {
  id: string;
  name: string;
  client_id: string | null;
  client_name?: string | null;
  project_lead_id: string | null;
  lead_name?: string | null;
  approximate_tasks: number | null;
  summary: string | null;
  start_date: string | null;
  duration_days: number | null;
  ending_date: string | null;
  status: string;
  progress: number | string;
  task_total?: number;
  task_done?: number;
  latitude: number | null;
  longitude: number | null;
  check_in_radius: number | null;
  card_color: string | null;
  text_color: string | null;
  open_for_all?: boolean;
  team_member_ids?: string[];
}

interface Client {
  id: string;
  name: string;
}

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

export function ProjectListPage(): ReactElement {
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [deadlines, setDeadlines] = useState<Array<{ project?: string; title: string; planned_end: string | null; status: string }>>([]);
  const [workload, setWorkload] = useState<Array<Record<string, unknown>>>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({
    name: '',
    client_id: '',
    project_lead_id: '',
    approximate_tasks: '',
    summary: '',
    start_date: new Date().toISOString().slice(0, 10),
    duration_days: '',
    status: 'open',
    latitude: '',
    longitude: '',
    check_in_radius: '100',
    card_color: '',
    text_color: '',
    open_for_all: true,
    team_member_ids: [] as string[],
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [clientError, setClientError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await projects.list({ page, perPage });
      const data = res.data as { items: Row[]; total: number };
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [page, perPage]);

  const loadLookups = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([
        projects.clients({ perPage: 100 }),
        hr.employees({ perPage: 100 }),
      ]);
      setClients((c.data as { items: Client[] }).items);
      setEmployees((e.data as { items: Employee[] }).items);
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    let cancelled = false;
    async function fetchAnalytics() {
      setAnalyticsLoading(true);
      await projects
        .analytics()
        .then((res) => {
          const d = res.data as { deadlines: Array<{ project?: string; title: string; planned_end: string | null; status: string }>; workload: Array<Record<string, unknown>> };
          if (!cancelled) {
            setDeadlines(d.deadlines ?? []);
            setWorkload(d.workload ?? []);
          }
        })
        .catch(() => undefined);
      if (!cancelled) setAnalyticsLoading(false);
    }
    void fetchAnalytics();
    return () => {
      cancelled = true;
    };
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      client_id: clients[0]?.id ?? '',
      project_lead_id: '',
      approximate_tasks: '',
      summary: '',
      start_date: new Date().toISOString().slice(0, 10),
      duration_days: '',
      status: 'open',
      latitude: '',
      longitude: '',
      check_in_radius: '100',
      card_color: '',
      text_color: '',
      open_for_all: true,
      team_member_ids: [],
    });
    setFormError('');
    setClientError('');
    setModalOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm({
      name: row.name,
      client_id: row.client_id ?? '',
      project_lead_id: row.project_lead_id ?? '',
      approximate_tasks: row.approximate_tasks != null ? String(row.approximate_tasks) : '',
      summary: row.summary ?? '',
      start_date: (row.start_date ?? '').slice(0, 10),
      duration_days: row.duration_days != null ? String(row.duration_days) : '',
      status: row.status,
      latitude: row.latitude != null ? String(row.latitude) : '',
      longitude: row.longitude != null ? String(row.longitude) : '',
      check_in_radius: row.check_in_radius != null ? String(row.check_in_radius) : '100',
      card_color: row.card_color ?? '',
      text_color: row.text_color ?? '',
      open_for_all: row.open_for_all ?? true,
      team_member_ids: row.team_member_ids ?? [],
    });
    setFormError('');
    setClientError('');
    setModalOpen(true);
  };

  const save = async () => {
    setSubmitting(true);
    setFormError('');
    if (!form.client_id) {
      setClientError('Please select a client.');
      setFormError('Client is required.');
      setSubmitting(false);
      return;
    }
    if (!isValidHex(form.card_color) && form.card_color.trim() !== '') {
      setFormError('Card color must be a valid hex color such as #1E3A8A.');
      setSubmitting(false);
      return;
    }
    if (!isValidHex(form.text_color) && form.text_color.trim() !== '') {
      setFormError('Text color must be a valid hex color such as #1E3A8A.');
      setSubmitting(false);
      return;
    }
    const body = {
      name: form.name,
      client_id: form.client_id || null,
      project_lead_id: form.project_lead_id || null,
      approximate_tasks: form.approximate_tasks ? Number(form.approximate_tasks) : null,
      summary: form.summary || null,
      start_date: form.start_date || null,
      duration_days: form.duration_days ? Number(form.duration_days) : null,
      status: form.status,
      latitude: form.latitude.trim() !== '' ? Number(form.latitude) : null,
      longitude: form.longitude.trim() !== '' ? Number(form.longitude) : null,
      check_in_radius: form.check_in_radius.trim() !== '' ? Number(form.check_in_radius) : 100,
      // Empty string = keep/reset default styling (stored as NULL).
      card_color: form.card_color.trim() || null,
      text_color: form.text_color.trim() || null,
      open_for_all: form.open_for_all,
      team_member_ids: form.open_for_all ? [] : form.team_member_ids,
    };
    try {
      if (editing) {
        await projects.update(editing.id, body);
      } else {
        await projects.create(body);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save project');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await projects.remove(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete project');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataColumn<Row>[] = [
    { key: 'name', header: 'Project', sortable: true, render: (r) => <strong>{r.name}</strong> },
    {
      key: 'client_name',
      header: 'Client',
      render: (r) => r.client_name ?? clients.find((c) => c.id === r.client_id)?.name ?? '—',
    },
    {
      key: 'lead_name',
      header: 'Manager / Lead',
      render: (r) =>
        r.lead_name ?? employees.find((e) => e.id === r.project_lead_id)?.full_name ?? '—',
    },
    {
      key: 'open_for_all',
      header: 'Access',
      align: 'center',
      render: (r) =>
        r.open_for_all === false ? (
          <span className="badge-clay badge-clay-secondary" title="Restricted to assigned team members">
            Assigned Only
          </span>
        ) : (
          <span className="badge-clay badge-clay-success" title="Accessible by all organization members">
            Open for All
          </span>
        ),
    },
    {
      key: 'approximate_tasks',
      header: 'Tasks',
      align: 'center',
      render: (r) => r.approximate_tasks ?? '—',
    },
    {
      key: 'start_date',
      header: 'Start',
      render: (r) => (r.start_date ? new Date(r.start_date).toLocaleDateString() : '—'),
    },
    {
      key: 'ending_date',
      header: 'End',
      render: (r) => (r.ending_date ? new Date(r.ending_date).toLocaleDateString() : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      render: (r) => <StatusBadge value={r.status} />,
    },
    {
      key: 'progress',
      header: 'Progress',
      render: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <div className="progress-clay" style={{ width: 80 }}>
              <div
                className="progress-fill"
                style={projectProgressStyle(r.card_color, r.text_color, Number(r.progress ?? 0))}
              />
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {String(r.progress ?? 0)}%
            </span>
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
            {r.task_done ?? 0} / {r.task_total ?? 0} tasks done
          </span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <div className="data-table-actions">
          <button className="icon-btn" title="View" onClick={() => setDetail(r)}>
            <Icon icon={Icons.View} />
          </button>
          {can('pm.project.manage') && (
            <button className="icon-btn" title="Edit" onClick={() => openEdit(r)}>
              <Icon icon={Icons.Edit} />
            </button>
          )}
          {can('pm.project.manage') && (
            <button
              className="icon-btn icon-btn-danger"
              title="Delete"
              onClick={() => setDeleteTarget(r)}
            >
              <Icon icon={Icons.Trash} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Project List"
        subtitle="All projects with progress tracking."
        actions={
          can('pm.project.manage') && (
            <button className="btn-clay btn-clay-primary" onClick={openCreate}>
              + New Project
            </button>
          )
        }
      />
      <div className="analytics-grid analytics-grid-wide">
        <ChartCard
          title="Upcoming Deadlines"
          subtitle="Tasks due within the next 30 days — click a row to open filtered tasks"
          loading={analyticsLoading}
          empty={deadlines.length === 0}
        >
          {deadlines.length === 0 ? (
            <div className="data-table-state">No upcoming deadlines.</div>
          ) : (
            <div className="deadline-list">
              {deadlines.map((d, i) => (
                <button
                  key={`${d.title}-${i}`}
                  type="button"
                  className="deadline-row"
                  onClick={() => navigate(`/projects/tasks`)}
                >
                  <div className="deadline-row-main">
                    <span className="deadline-row-title">{d.title}</span>
                    <span className="deadline-row-project">{d.project ?? '—'}</span>
                  </div>
                  <span className="badge-clay badge-clay-warning">
                    {d.planned_end ? new Date(d.planned_end).toLocaleDateString() : '—'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </ChartCard>

        {workload.length > 0 && (
          <ChartCard
            title="Team Workload"
            subtitle="Tasks per employee (active / done / overdue) — click a bar for that employee's tasks"
            loading={analyticsLoading}
            empty={workload.length === 0}
          >
            <HorizontalBarChart
              data={workload.map((w) => ({
                name: String(w.full_name ?? '—'),
                active: Number(w.active ?? 0),
              }))}
              nameKey="name"
              valueKey="active"
              onBarClick={(entry) => {
                const emp = workload.find((w) => w.full_name === String(entry.name));
                if (emp?.employee_id) {
                  navigate(`/projects/employee-tasks?employee_id=${encodeURIComponent(String(emp.employee_id))}`);
                }
              }}
            />
          </ChartCard>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        page={page}
        perPage={perPage}
        total={total}
        onPageChange={setPage}
        onPerPageChange={(p) => {
          setPerPage(p);
          setPage(1);
        }}
        csvFilename="projects.csv"
        excelFilename="projects.xls"
        printable
        emptyMessage="No projects yet."
      />

      <Modal
        title={editing ? 'Edit Project' : 'New Project'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel={editing ? 'Update' : 'Create'}
        wide
      >
        <div className="form-group">
          <label className="form-label">
            Project Name <span className="form-required">*</span>
          </label>
          <input
            className="form-control-clay"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Client <span className="form-required">*</span>
            </label>
            <select
              className={`form-control-clay${clientError ? ' form-control-clay-invalid' : ''}`}
              value={form.client_id}
              onChange={(e) => {
                setForm({ ...form, client_id: e.target.value });
                setClientError('');
              }}
            >
              <option value="">— Select client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {clientError && <div className="form-error-text">{clientError}</div>}
          </div>
          <div className="form-group">
            <label className="form-label">Project Manager / Lead</label>
            <select
              className="form-control-clay"
              value={form.project_lead_id}
              onChange={(e) => setForm({ ...form, project_lead_id: e.target.value })}
            >
              <option value="">— Select Project Manager —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name} ({e.employee_code})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-group" style={{ margin: '0.8rem 0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={form.open_for_all}
              onChange={(e) => setForm({ ...form, open_for_all: e.target.checked })}
              style={{ width: 16, height: 16 }}
            />
            <span>Open for all employees (All organization employees can view & work on this project)</span>
          </label>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginLeft: 24, marginTop: 2 }}>
            Uncheck to restrict this project to specific assigned team members only.
          </div>
        </div>

        {!form.open_for_all && (
          <div className="form-group" style={{ marginBottom: '1rem', padding: '0.8rem', background: 'var(--bg-card-subtle, rgba(0,0,0,0.02))', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
            <label className="form-label" style={{ fontWeight: 600 }}>
              Assigned Project Members ({form.team_member_ids.length} selected)
            </label>
            <div style={{ maxHeight: 180, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.4rem', marginTop: '0.4rem' }}>
              {employees.map((e) => {
                const isChecked = form.team_member_ids.includes(e.id);
                return (
                  <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(ev) => {
                        const next = ev.target.checked
                          ? [...form.team_member_ids, e.id]
                          : form.team_member_ids.filter((id) => id !== e.id);
                        setForm({ ...form, team_member_ids: next });
                      }}
                    />
                    <span>{e.full_name} ({e.employee_code})</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        <div className="form-row form-row-3">
          <div className="form-group">
            <label className="form-label">Approximate Tasks</label>
            <input
              type="number"
              min={0}
              className="form-control-clay"
              value={form.approximate_tasks}
              onChange={(e) => setForm({ ...form, approximate_tasks: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Start Date</label>
            <input
              type="date"
              className="form-control-clay"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Duration (days)</label>
            <input
              type="number"
              min={0}
              className="form-control-clay"
              value={form.duration_days}
              onChange={(e) => setForm({ ...form, duration_days: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row form-row-3">
          <div className="form-group">
            <label className="form-label">Latitude</label>
            <input
              type="number"
              step="any"
              min={-90}
              max={90}
              className="form-control-clay"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
              placeholder="e.g. 23.8103"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Longitude</label>
            <input
              type="number"
              step="any"
              min={-180}
              max={180}
              className="form-control-clay"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
              placeholder="e.g. 90.4125"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Check-in Range (meters)</label>
            <input
              type="number"
              min={0}
              className="form-control-clay"
              value={form.check_in_radius}
              onChange={(e) => setForm({ ...form, check_in_radius: e.target.value })}
              placeholder="100"
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Preview map</label>
          {(() => {
            const lat = Number(form.latitude);
            const lng = Number(form.longitude);
            const radius = Number(form.check_in_radius);
            const valid = form.latitude.trim() !== '' && form.longitude.trim() !== '' && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
            if (!valid) {
              return <div className="form-help-text">Enter valid latitude and longitude to preview the check-in area.</div>;
            }
            return (
              <div style={{ height: 220, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
                <MapContainer center={[lat, lng]} zoom={15} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
                  <Circle center={[lat, lng]} radius={Number.isFinite(radius) && radius > 0 ? radius : 100} pathOptions={{ color: '#0f5c2e', fillColor: '#0f5c2e', fillOpacity: 0.15 }} />
                  <Marker position={[lat, lng]} />
                </MapContainer>
              </div>
            );
          })()}
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Status</label>
            <select
              className="form-control-clay"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Summary</label>
          <textarea
            className="form-control-clay"
            rows={3}
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
          />
        </div>

        <h3 className="form-section-title" style={{ marginTop: '0.5rem' }}>Project Color</h3>
        <div className="form-group">
          <label className="form-label">Color scheme</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              title="Default (blue accent)"
              aria-pressed={form.card_color === '' && form.text_color === ''}
              onClick={() => setForm({ ...form, card_color: '', text_color: '' })}
              style={{
                width: 64, height: 40, borderRadius: 8, cursor: 'pointer', fontSize: '0.68rem', fontWeight: 700,
                border: form.card_color === '' && form.text_color === '' ? '2px solid var(--primary, #2563eb)' : '1px solid var(--border-subtle)',
                background: 'var(--surface-muted, #f1f5f9)', color: 'var(--text-main, #1e293b)',
              }}
            >
              Default
            </button>
            {PROJECT_COLOR_PRESETS.map((preset) => {
              const active = form.card_color.toLowerCase() === preset.card && form.text_color.toLowerCase() === preset.text;
              return (
                <button
                  key={preset.name}
                  type="button"
                  title={preset.name}
                  aria-pressed={active}
                  onClick={() => setForm({ ...form, card_color: preset.card, text_color: preset.text })}
                  style={{
                    width: 64, height: 40, borderRadius: 8, cursor: 'pointer', fontSize: '0.68rem', fontWeight: 700,
                    border: active ? '2px solid var(--primary, #2563eb)' : '1px solid var(--border-subtle)',
                    background: preset.card, color: preset.text,
                  }}
                >
                  {preset.name}
                </button>
              );
            })}
          </div>
          <div className="form-hint">Applies to this project's cards, badges and progress bars everywhere. "Default" uses the standard blue accent.</div>
        </div>
        <details style={{ marginBottom: '0.75rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Custom colors (advanced)</summary>
        <div className="form-row">
          {([
            { key: 'card_color', label: 'Card Color', pickerFallback: '#f8fafc' },
            { key: 'text_color', label: 'Text Color', pickerFallback: '#1e293b' },
          ] as const).map(({ key, label, pickerFallback }) => {
            const hex = form[key];
            return (
              <div className="form-group" key={key}>
                <label className="form-label">{label}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="color"
                    aria-label={`${label} picker`}
                    value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : pickerFallback}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value.toLowerCase() })}
                    style={{ width: 42, height: 34, padding: 2, border: '1px solid var(--border-subtle)', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}
                  />
                  <input
                    className="form-control-clay"
                    value={hex}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    onBlur={() => {
                      const v = form[key].trim();
                      if (v !== '' && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3}|[0-9a-fA-F]{2})?$/.test(v)) {
                        setFormError(`${label} must be a valid hex color such as #1E3A8A.`);
                      }
                    }}
                    placeholder="#1E3A8A"
                    maxLength={9}
                    style={{ flex: 1 }}
                  />
                  {hex !== '' && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      title={`Reset ${label.toLowerCase()} to default`}
                      onClick={() => setForm({ ...form, [key]: '' })}
                    >
                      Reset
                    </button>
                  )}
                </div>
                {hex === '' && <div className="form-hint">Empty = application default.</div>}
              </div>
            );
          })}
        </div>
        </details>
        <div className="form-group">
          <label className="form-label">Live preview</label>
          <div
            style={{
              background: form.card_color.trim() || 'var(--surface-muted, #f1f5f9)',
              color: form.text_color.trim() || 'var(--text-main, #1e293b)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 10,
              padding: '0.85rem 1rem',
              maxWidth: 420,
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 800 }}>
              <span>{form.name.trim() || 'Project name'}</span>
              <span style={{ fontSize: '0.72rem', border: '1px solid currentColor', borderRadius: 999, padding: '1px 8px', opacity: 0.85 }}>
                {form.status === 'in_progress' ? 'In Progress' : form.status === 'on_hold' ? 'On Hold' : form.status.charAt(0).toUpperCase() + form.status.slice(1)}
              </span>
            </div>
            <div style={{ fontSize: '0.8rem', marginTop: 4, opacity: 0.75 }}>
              Client &bull; Lead &bull; Dates
            </div>
            <div style={{ height: 6, borderRadius: 999, background: 'rgba(127,127,127,0.25)', margin: '10px 0 6px' }}>
              <div style={{ width: '62%', height: '100%', borderRadius: 999, background: 'currentColor', opacity: 0.55, ...(form.card_color.trim() === '' ? { background: '#2563eb' } : {}) }} />
            </div>
            {form.card_color.trim() === '' && form.text_color.trim() === '' && (
              <div style={{ fontSize: '0.72rem', opacity: 0.6 }}>Default styling preview</div>
            )}
          </div>
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>

      <Modal title="Project Details" open={detail !== null} onClose={() => setDetail(null)} wide>
        {detail && (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Name</label>
              <div>
                <strong>{detail.name}</strong>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <div>
                <StatusBadge value={detail.status} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Progress</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className="progress-clay" style={{ width: 140 }}>
                    <div
                      className="progress-fill"
                      style={projectProgressStyle(detail.card_color, detail.text_color, Number(detail.progress ?? 0))}
                    />
                  </div>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {String(detail.progress ?? 0)}%
                  </span>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                  Calculated automatically from project tasks — {detail.task_done ?? 0} of{' '}
                  {detail.task_total ?? 0} applicable tasks completed
                </span>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Client</label>
              <div>
                {detail.client_name ?? clients.find((c) => c.id === detail.client_id)?.name ?? '—'}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Lead</label>
              <div>
                {detail.lead_name ??
                  employees.find((e) => e.id === detail.project_lead_id)?.full_name ??
                  '—'}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Start — End</label>
              <div>
                {detail.start_date ? new Date(detail.start_date).toLocaleDateString() : '—'} —{' '}
                {detail.ending_date ? new Date(detail.ending_date).toLocaleDateString() : '—'}
              </div>
            </div>
            {detail.summary && (
              <div className="form-group">
                <label className="form-label">Summary</label>
                <div>{detail.summary}</div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ProtectedDeleteModal
        title="Delete Project"
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        submitting={submitting}
        message={
          <p>
          Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
        </p>
        }
      />
    </div>
  );
}
