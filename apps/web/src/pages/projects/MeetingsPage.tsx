import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { hr, projects, api } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon, Icons } from '../../components/Icon';

interface Row {
  id: string;
  project_id: string;
  project_name?: string;
  place: string;
  held_at: string;
  purpose?: string;
  outcomes?: string;
  status?: string;
  attendees?: { full_name?: string }[];
  attachments?: Attachment[];
}

interface Attachment {
  id: string;
  file_name: string;
  size_bytes?: number;
  mime_type?: string;
}

interface Project {
  id: string;
  name: string;
}

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

interface Paginated {
  items: Row[];
  total: number;
  page: number;
  per_page: number;
}

export function MeetingsPage(): ReactElement {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({
    project_id: '',
    place: '',
    held_at: new Date().toISOString().slice(0, 16),
    purpose: '',
    outcomes: '',
    attendee_ids: [] as string[],
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await projects.meetings({ page, perPage, search: debouncedSearch });
      const data = res.data as unknown as Paginated;
      setRows(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const [p, e] = await Promise.all([
          projects.list({ perPage: 100 }),
          hr.employees({ perPage: 100 }),
        ]);
        setProjectList((p.data as { items: Project[] }).items);
        setEmployees((e.data as { items: Employee[] }).items);
      } catch {
        /* lookups are optional */
      }
    })();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({
      project_id: projectList[0]?.id ?? '',
      place: '',
      held_at: new Date().toISOString().slice(0, 16),
      purpose: '',
      outcomes: '',
      attendee_ids: [],
    });
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = async (row: Row) => {
    setEditing(row);
    setForm({
      project_id: row.project_id,
      place: row.place,
      held_at: row.held_at.slice(0, 16),
      purpose: row.purpose ?? '',
      outcomes: row.outcomes ?? '',
      attendee_ids: [],
    });
    setFormError('');
    setModalOpen(true);
    try {
      const res = await projects.meeting(row.id);
      const full = res.data as Record<string, unknown>;
      const attendees = (full.attendees ?? []) as { employee_id?: string }[];
      setForm((f) => ({
        ...f,
        purpose: String(full.purpose ?? ''),
        outcomes: String(full.outcomes ?? ''),
        attendee_ids: attendees.map((a) => a.employee_id ?? '').filter(Boolean),
      }));
    } catch {
      /* keep baseline form */
    }
  };

  const save = async () => {
    if (!form.project_id || !form.place || !form.held_at) {
      setFormError('Project, place and date/time are required');
      return;
    }
    setSubmitting(true);
    setFormError('');
    const body = {
      project_id: form.project_id,
      place: form.place,
      held_at: new Date(form.held_at).toISOString(),
      purpose: form.purpose || undefined,
      outcomes: form.outcomes || undefined,
      attendee_ids: form.attendee_ids,
    };
    try {
      if (editing) {
        await projects.updateMeeting(editing.id, body);
      } else {
        await projects.createMeeting(body);
      }
      setModalOpen(false);
      toast(editing ? 'Meeting updated' : 'Meeting created', 'success');
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save meeting');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await projects.removeMeeting(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      toast('Meeting deleted', 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to delete meeting', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const empName = (id: string) => employees.find((e) => e.id === id)?.full_name ?? id;

  const downloadAttachment = async (attachmentId: string) => {
    try {
      const res = await api<{ data: { url: string; filename: string } }>(
        `/api/projects/meetings/attachments/${attachmentId}/download`
      );
      window.open(res.data.url, '_blank');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Download failed', 'error');
    }
  };

  const showDetail = async (row: Row) => {
    try {
      const res = await projects.meeting(row.id);
      const full = res.data as Record<string, unknown>;
      const attendees = (full.attendees ?? []) as { employee_id?: string; full_name?: string }[];
      const attachments = (full.attachments ?? []) as Attachment[];
      setDetail({
        ...row,
        attendees: attendees.map((a) => ({
          full_name: a.full_name ?? empName(a.employee_id ?? ''),
        })),
        attachments: attachments.map((a) => ({
          id: a.id,
          file_name: a.file_name,
          size_bytes: a.size_bytes,
          mime_type: a.mime_type,
        })),
      } as Row);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load meeting details', 'error');
    }
  };

  const toggleAttendee = (id: string) => {
    setForm((f) => ({
      ...f,
      attendee_ids: f.attendee_ids.includes(id)
        ? f.attendee_ids.filter((a) => a !== id)
        : [...f.attendee_ids, id],
    }));
  };

  const columns: DataColumn<Row>[] = [
    {
      key: 'project_name',
      header: 'Project',
      sortable: true,
      render: (r) => (
        <strong>
          {r.project_name ?? projectList.find((p) => p.id === r.project_id)?.name ?? '—'}
        </strong>
      ),
    },
    {
      key: 'purpose',
      header: 'Purpose',
      sortable: true,
      render: (r) => (
        <span className="daily-task-desc" title={r.purpose ?? ''}>
          {r.purpose || '—'}
        </span>
      ),
    },
    {
      key: 'held_at',
      header: 'Meeting Held',
      sortable: true,
      render: (r) => new Date(r.held_at).toLocaleString(),
    },
    { key: 'place', header: 'Meeting Place', sortable: true, render: (r) => r.place },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      render: (r) => (r.status ? <StatusBadge value={r.status} /> : <StatusBadge value="scheduled" />),
    },
    {
      key: 'actions',
      header: 'Action',
      align: 'center',
      render: (r) => (
        <div className="data-table-actions">
          <button className="icon-btn" title="View" aria-label="View" onClick={() => showDetail(r)}>
            <Icon icon={Icons.View} />
          </button>
          <button className="icon-btn" title="Edit" aria-label="Edit" onClick={() => openEdit(r)}>
            <Icon icon={Icons.Edit} />
          </button>
          <button
            className="icon-btn icon-btn-danger"
            title="Delete"
            aria-label="Delete"
            onClick={() => setDeleteTarget(r)}
          >
            <Icon icon={Icons.Trash} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Meeting List"
        subtitle="Plan and record project meetings."
        actions={
          can('pm.meeting.manage') && (
            <button className="btn-clay btn-clay-primary" onClick={openCreate}>
              + New Meeting
            </button>
          )
        }
      />

      <div className="activity-toolbar">
        <div className="activity-toolbar-left">
          <input
            className="search-input-clay"
            placeholder="Search project, purpose..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="data-table-perpage">
            <span>Show</span>
            <select
              className="form-control-clay form-control-sm"
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>entries</span>
          </div>
        </div>
        <div className="activity-toolbar-right"></div>
      </div>

      {error ? (
        <div className="panel-clay report-state-panel">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon icon={Icons.Warning} />
            </div>
            <div className="empty-state-title">Could not load meetings</div>
            <div className="empty-state-hint">{error}</div>
            <button
              className="btn-clay btn-clay-primary"
              onClick={() => {
                setError('');
                void load();
              }}
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          page={page}
          perPage={perPage}
          total={total}
          onPageChange={setPage}
          onPerPageChange={(p) => {
            setPerPage(p);
            setPage(1);
          }}
          csvFilename="meetings.csv"
          excelFilename="meetings.xls"
          printable
          emptyMessage={
            debouncedSearch ? 'No meetings match your search.' : 'No meetings scheduled.'
          }
        />
      )}

      <Modal
        title={editing ? 'Edit Meeting' : 'New Meeting'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel={editing ? 'Update' : 'Create'}
        busyLabel={editing ? 'Updating...' : 'Creating...'}
        wide
      >
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label className="form-label">
              Project <span className="form-required">*</span>
            </label>
            <select
              className="form-control-clay"
              value={form.project_id}
              onChange={(e) => setForm({ ...form, project_id: e.target.value })}
            >
              <option value="">—</option>
              {projectList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">
              Date & Time <span className="form-required">*</span>
            </label>
            <input
              type="datetime-local"
              className="form-control-clay"
              value={form.held_at}
              onChange={(e) => setForm({ ...form, held_at: e.target.value })}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">
            Meeting Place <span className="form-required">*</span>
          </label>
          <input
            className="form-control-clay"
            value={form.place}
            onChange={(e) => setForm({ ...form, place: e.target.value })}
            autoFocus
          />
        </div>
        <div className="form-group">
          <label className="form-label">Purpose</label>
          <textarea
            className="form-control-clay"
            rows={2}
            value={form.purpose}
            onChange={(e) => setForm({ ...form, purpose: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Notes / Outcomes</label>
          <textarea
            className="form-control-clay"
            rows={3}
            value={form.outcomes}
            onChange={(e) => setForm({ ...form, outcomes: e.target.value })}
          />
        </div>
        <div className="form-section-title">Attendees</div>
        <div className="filter-bar">
          {employees.map((e) => (
            <label
              key={e.id}
              className="form-inline-flex"
              style={{ gap: '0.35rem', fontSize: '0.8rem' }}
            >
              <input
                type="checkbox"
                checked={form.attendee_ids.includes(e.id)}
                onChange={() => toggleAttendee(e.id)}
              />
              {e.full_name} ({e.employee_code})
            </label>
          ))}
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>

      <Modal title="Meeting Details" open={detail !== null} onClose={() => setDetail(null)} wide>
        {detail && (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Project</label>
              <div>
                <strong>
                  {detail.project_name ??
                    projectList.find((p) => p.id === detail.project_id)?.name ??
                    '—'}
                </strong>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Date & Time</label>
              <div>{new Date(detail.held_at).toLocaleString()}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Place</label>
              <div>{detail.place}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Purpose</label>
              <div>{detail.purpose ?? '—'}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes / Outcomes</label>
              <div>{detail.outcomes ?? '—'}</div>
            </div>
            {detail.attendees && detail.attendees.length > 0 && (
              <div className="form-group">
                <label className="form-label">Attendees</label>
                <div>{detail.attendees.map((a) => a.full_name ?? '—').join(', ')}</div>
              </div>
            )}
            {detail.attachments && detail.attachments.length > 0 && (
              <div className="form-group">
                <label className="form-label">Attachments</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {detail.attachments.map((a) => (
                    <div
                      key={a.id}
                      className="form-inline"
                      style={{ gap: '0.5rem', alignItems: 'center' }}
                    >
                      <button
                        className="icon-btn"
                        title="Download"
                        aria-label="Download"
                        onClick={() => downloadAttachment(a.id)}
                      >
                        <Icon icon={Icons.Paperclip} />
                      </button>
                      <span>{a.file_name}</span>
                      {a.size_bytes ? (
                        <span className="form-hint">({(a.size_bytes / 1024).toFixed(1)} KB)</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ProtectedDeleteModal
        title="Delete Meeting"
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        submitting={submitting}
        message={<p>Are you sure you want to delete this meeting?</p>}
      />
    </div>
  );
}
