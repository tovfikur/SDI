import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { hr } from '../../api';
import type { Branch } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon, Icons } from '../../components/Icon';
import { Circle, MapContainer, Marker, TileLayer } from 'react-leaflet';
import L from 'leaflet';

const defaultPin = L.divIcon({
  className: 'branch-map-pin',
  html: '<div style="background:#017833;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-size:14px;border:2px solid #fff;">🏢</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

export function BranchesPage(): ReactElement {
  const { can } = usePermissions();
  const [rows, setRows] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);

  const [form, setForm] = useState({
    name: '',
    code: '',
    address: '',
    latitude: '23.8103',
    longitude: '90.4125',
    radius_meters: '150',
    is_active: true,
  });

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hr.branches({ page, perPage, search });
      const data = res.data;
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load branches');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      code: '',
      address: '',
      latitude: '23.8103',
      longitude: '90.4125',
      radius_meters: '150',
      is_active: true,
    });
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (row: Branch) => {
    setEditing(row);
    setForm({
      name: row.name,
      code: row.code ?? '',
      address: row.address ?? '',
      latitude: row.latitude ? String(row.latitude) : '23.8103',
      longitude: row.longitude ? String(row.longitude) : '90.4125',
      radius_meters: row.radius_meters ? String(row.radius_meters) : '150',
      is_active: row.is_active,
    });
    setFormError('');
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      setFormError('Branch name is required');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        address: form.address.trim() || undefined,
        latitude: form.latitude ? parseFloat(form.latitude) : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
        radius_meters: form.radius_meters ? parseFloat(form.radius_meters) : 100,
        is_active: form.is_active,
      };

      if (editing) {
        await hr.updateBranch(editing.id, payload);
      } else {
        await hr.createBranch(payload);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save branch');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await hr.deleteBranch(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete branch');
    } finally {
      setSubmitting(false);
    }
  };

  const latNum = parseFloat(form.latitude);
  const lngNum = parseFloat(form.longitude);
  const radNum = parseFloat(form.radius_meters) || 100;
  const hasValidCoords = !isNaN(latNum) && !isNaN(lngNum) && latNum >= -90 && latNum <= 90 && lngNum >= -180 && lngNum <= 180;

  const columns: DataColumn<Branch>[] = [
    {
      key: 'name',
      header: 'Branch Name',
      sortable: true,
      render: (r) => (
        <div>
          <strong>{r.name}</strong>
          {r.code && (
            <span style={{ marginLeft: '0.4rem', color: 'var(--text-dim)', fontSize: '0.8rem', fontWeight: 600 }}>
              [{r.code}]
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'address',
      header: 'Address / Location',
      render: (r) => r.address || '—',
    },
    {
      key: 'coordinates',
      header: 'GPS Center & Range',
      render: (r) =>
        r.latitude && r.longitude ? (
          <span style={{ fontSize: '0.82rem', fontFamily: 'monospace' }}>
            {Number(r.latitude).toFixed(4)}, {Number(r.longitude).toFixed(4)} ({r.radius_meters ?? 100}m)
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'is_active',
      header: 'Status',
      align: 'center',
      render: (r) => <StatusBadge value={r.is_active ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <div className="table-actions">
          {can('hr.masters.update') && (
            <button className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => openEdit(r)} title="Edit branch">
              <Icon icon={Icons.Edit} size="sm" />
            </button>
          )}
          {can('hr.masters.delete') && (
            <button
              className="btn-clay btn-clay-sm btn-clay-danger"
              onClick={() => setDeleteTarget(r)}
              title="Delete branch"
            >
              <Icon icon={Icons.Trash} size="sm" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Branches"
        subtitle="Manage company branches, regional offices and map geolocation centers."
        actions={
          can('hr.masters.create') ? (
            <button className="btn-clay btn-clay-primary" onClick={openCreate}>
              <Icon icon={Icons.Plus} size="sm" /> Add Branch
            </button>
          ) : undefined
        }
      />

      <div className="filter-bar" style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          className="form-control-clay form-control-sm"
          placeholder="Search branches..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          style={{ maxWidth: 300 }}
        />
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
        emptyMessage="No branches found. Click 'Add Branch' to create one."
      />

      <Modal
        title={editing ? 'Edit Branch' : 'New Branch'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel={editing ? 'Save Changes' : 'Create Branch'}
      >
        {formError && (
          <div className="alert-box alert-box-error" style={{ marginBottom: 12 }}>
            {formError}
          </div>
        )}
        <div className="form-group-clay">
          <label className="form-label-clay">
            Branch Name <span style={{ color: 'var(--danger)' }}>*</span>
          </label>
          <input
            type="text"
            className="form-control-clay"
            placeholder="e.g. Head Office (Dhaka)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
          <div className="form-group-clay">
            <label className="form-label-clay">Branch Code</label>
            <input
              type="text"
              className="form-control-clay"
              placeholder="e.g. HO-DHK"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </div>
          <div className="form-group-clay">
            <label className="form-label-clay">Radius (meters)</label>
            <input
              type="number"
              className="form-control-clay"
              placeholder="100"
              value={form.radius_meters}
              onChange={(e) => setForm({ ...form, radius_meters: e.target.value })}
            />
          </div>
        </div>

        <div className="form-group-clay">
          <label className="form-label-clay">Address / Location Description</label>
          <input
            type="text"
            className="form-control-clay"
            placeholder="e.g. 123 Main Road, Motijheel, Dhaka"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
          <div className="form-group-clay">
            <label className="form-label-clay">Latitude</label>
            <input
              type="number"
              step="any"
              className="form-control-clay"
              placeholder="e.g. 23.8103"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
            />
          </div>
          <div className="form-group-clay">
            <label className="form-label-clay">Longitude</label>
            <input
              type="number"
              step="any"
              className="form-control-clay"
              placeholder="e.g. 90.4125"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
            />
          </div>
        </div>

        {hasValidCoords && (
          <div style={{ marginTop: '0.5rem', marginBottom: '0.8rem' }}>
            <label className="form-label-clay" style={{ marginBottom: 4, display: 'block' }}>
              Map Preview:
            </label>
            <div style={{ height: 180, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
              <MapContainer
                key={`${latNum}-${lngNum}`}
                center={[latNum, lngNum]}
                zoom={14}
                style={{ height: '100%', width: '100%' }}
                scrollWheelZoom={false}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <Marker position={[latNum, lngNum]} icon={defaultPin} />
                <Circle center={[latNum, lngNum]} radius={radNum} pathOptions={{ color: '#017833', fillOpacity: 0.2 }} />
              </MapContainer>
            </div>
          </div>
        )}

        <div className="form-group-clay" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
          <input
            type="checkbox"
            id="branch-active-checkbox"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          <label htmlFor="branch-active-checkbox" style={{ fontSize: '0.85rem', cursor: 'pointer', margin: 0 }}>
            Active Branch
          </label>
        </div>
      </Modal>

      <ProtectedDeleteModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        submitting={submitting}
        title="Delete Branch"
        message={`Are you sure you want to delete branch "${deleteTarget?.name}"?`}
      />
    </div>
  );
}
