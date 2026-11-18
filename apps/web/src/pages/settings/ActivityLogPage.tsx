import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { audit } from '../../api';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { useToast } from '../../components/Toast';
import { isAdminUser, useCurrentUser } from '../../auth-context';
import { downloadCsv, exportExcel, printTable } from '../../utils/export';
import { Icon, Icons } from '../../components/Icon';

interface AuditLog {
  id: string;
  log_name: string;
  description: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  created_at: string;
  after_value: unknown;
  before_value: unknown;
  request_id: string | null;
}

interface LogFilters {
  dateFrom: string;
  dateTo: string;
  logToken: string;
  action: string;
  doneBy: string;
}

const EMPTY_FILTERS: LogFilters = {
  dateFrom: '',
  dateTo: '',
  logToken: '',
  action: '',
  doneBy: '',
};

const MODULES: { label: string; token: string }[] = [
  { label: 'Department', token: 'departments' },
  { label: 'Sub Department', token: 'sub_departments' },
  { label: 'Work Schedule', token: 'setup_rules' },
  { label: 'Employee', token: 'employees' },
  { label: 'Employee Type', token: 'employee_types' },
  { label: 'Position', token: 'positions' },
  { label: 'Transfer', token: 'transfers' },
  { label: 'Employee Performance', token: 'performance' },
  { label: 'Attendance', token: 'attendance' },
  { label: 'Holiday', token: 'holidays' },
  { label: 'Leave Application', token: 'leave.applications' },
  { label: 'Leave Type', token: 'leave.types' },
  { label: 'Short Leave', token: 'short_leaves' },
  { label: 'Training Program', token: 'training.programs' },
  { label: 'Certificate', token: 'certificates' },
  { label: 'Notice', token: 'notices' },
  { label: 'ID Card', token: 'id_cards' },
  { label: 'HR Policy', token: 'policies' },
  { label: 'Loan', token: 'loans' },
  { label: 'Resignation', token: 'resignations' },
  { label: 'Client', token: 'clients' },
  { label: 'Project', token: 'projects' },
  { label: 'Task', token: 'tasks' },
  { label: 'Daily Task', token: 'daily_tasks' },
  { label: 'Meeting', token: 'meetings' },
  { label: 'Notification', token: 'notifications' },
  { label: 'File', token: 'files' },
];

const VERB_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  approve: 'Approved',
  reject: 'Rejected',
};

function humanLabel(logName: string): string {
  const segments = logName.split('.').slice(1).join('.');
  for (const m of MODULES) {
    if (segments.includes(m.token)) return m.label;
  }
  if (!segments) return 'System';
  const words = segments.split(/[._]+/).filter(Boolean);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function actionVerb(logName: string): string {
  const verb = logName.split('.')[0] ?? '';
  return VERB_LABELS[verb] ?? verb.charAt(0).toUpperCase() + verb.slice(1);
}

function entityName(afterValue: unknown): string | null {
  if (!afterValue || typeof afterValue !== 'object') return null;
  const obj = afterValue as Record<string, unknown>;
  for (const key of ['name', 'title', 'full_name', 'employee_code']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

function humanDescription(log: AuditLog): string {
  const verb = actionVerb(log.log_name);
  const label = humanLabel(log.log_name);
  const name = entityName(log.after_value);
  return name ? `${label} "${name}" ${verb.toLowerCase()}` : `${label} ${verb.toLowerCase()}`;
}

function formatAuditDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
  const h = d.getHours() % 12 || 12;
  return `${dd}-${mm}-${yyyy} ${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}

function actionTone(verb: string): string {
  switch (verb) {
    case 'Created':
      return 'badge-clay-info';
    case 'Updated':
      return 'badge-clay-warning';
    case 'Deleted':
      return 'badge-clay-danger';
    case 'Approved':
      return 'badge-clay-success';
    case 'Rejected':
      return 'badge-clay-danger';
    default:
      return 'badge-clay';
  }
}

const PER_PAGE_OPTIONS = [10, 25, 50, 100];

export function ActivityLogPage(): ReactElement {
  const user = useCurrentUser();
  const isAdmin = isAdminUser(user);
  const { toast } = useToast();

  const [rows, setRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters] = useState<LogFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<LogFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<AuditLog | null>(null);
  const [bulkTarget, setBulkTarget] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

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

  const buildParams = useCallback(
    (pageNum: number, per: number, all = false): Record<string, string | number> => {
      const params: Record<string, string | number> = { page: pageNum, perPage: per };
      if (all) params.all = 'true';
      if (debouncedSearch) params.search = debouncedSearch;
      if (filters.dateFrom) params.dateFrom = filters.dateFrom;
      if (filters.dateTo) params.dateTo = `${filters.dateTo}T23:59:59`;
      if (filters.logToken) params['filter[log_name]'] = `like:${filters.logToken}`;
      if (filters.action) params['filter[action]'] = `eq:${filters.action}`;
      if (filters.doneBy) params['filter[actor_name]'] = `like:${filters.doneBy}`;
      return params;
    },
    [debouncedSearch, filters]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await audit.logs(buildParams(page, perPage));
      const data = res.data as { items: AuditLog[]; total: number };
      setRows(data.items);
      setTotal(data.total);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity log');
    } finally {
      setLoading(false);
    }
  }, [buildParams, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportColumns = [
    { key: 'sl', header: 'SL' },
    { key: 'date', header: 'Date' },
    { key: 'logName', header: 'Log Name' },
    { key: 'description', header: 'Description' },
    { key: 'doneBy', header: 'Done By' },
    { key: 'action', header: 'Action' },
  ];

  const fetchAllFiltered = async (): Promise<AuditLog[]> => {
    const res = await audit.logs(buildParams(1, perPage, true));
    const data = res.data as { items: AuditLog[] };
    return data.items;
  };

  const handleExport = async (kind: 'csv' | 'excel' | 'print') => {
    try {
      const items = await fetchAllFiltered();
      const mapped = items.map((row, i) => ({
        sl: i + 1,
        date: formatAuditDate(row.created_at),
        logName: humanLabel(row.log_name),
        description: humanDescription(row),
        doneBy: row.actor_name ?? 'System Administrator',
        action: actionVerb(row.log_name),
      }));
      if (kind === 'csv') downloadCsv('activity-log.csv', mapped, exportColumns);
      else if (kind === 'excel') exportExcel('activity-log.xls', mapped, exportColumns);
      else printTable('Activity Log', mapped, exportColumns);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed', 'error');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2
  );
  const pageItems = pageNumbers.reduce<number[]>((acc, p) => {
    if (acc.length && p - acc[acc.length - 1] > 1) acc.push(-1);
    acc.push(p);
    return acc;
  }, []);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const r of rows) next.delete(r.id);
      } else {
        for (const r of rows) next.add(r.id);
      }
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const performDelete = async (ids: string[], deletePassword: string) => {
    setSubmitting(true);
    try {
      await audit.deleteLogs(ids, deletePassword);
      toast(`Deleted ${ids.length} activity log${ids.length > 1 ? 's' : ''}.`, 'success');
      setDeleteTarget(null);
      setBulkTarget(false);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to delete log entries', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const shownStart = total === 0 ? 0 : (page - 1) * perPage + 1;
  const shownEnd = Math.min(page * perPage, total);

  return (
    <div>
      {/* Toolbar */}
      <div className="activity-toolbar">
        <div className="activity-toolbar-left">
          {isAdmin && (
            <button
              className="btn-clay btn-clay-danger"
              disabled={selected.size === 0}
              onClick={() => setBulkTarget(true)}
            >
              Delete Selected{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
          )}
          <button className="btn-clay btn-clay-secondary" onClick={() => setFilterOpen(true)}>
            Filter
          </button>
        </div>
        <div className="activity-toolbar-right">
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
              {PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>entries</span>
          </div>
          <input
            className="search-input-clay"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="activity-export-group">
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              onClick={() => handleExport('csv')}
            >
              CSV
            </button>
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              onClick={() => handleExport('excel')}
            >
              Excel
            </button>
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              onClick={() => handleExport('print')}
            >
              Print
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="data-table-state data-table-error">{error}</div>
      ) : (
        <div className="data-table-clay">
          <div className="activity-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '42px' }}>
                    <input
                      type="checkbox"
                      className="row-checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      title="Select all displayed"
                    />
                  </th>
                  <th style={{ width: '52px' }}>SL</th>
                  <th style={{ width: '150px' }}>Date</th>
                  <th style={{ width: '180px' }}>Log Name</th>
                  <th>Description</th>
                  <th style={{ width: '170px' }}>Done By</th>
                  <th style={{ width: '110px' }}>Action</th>
                  <th style={{ width: '96px' }} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`sk-${i}`}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="skeleton-cell">
                          <div
                            className="skeleton skeleton-line"
                            style={{ width: j === 4 ? '70%' : '85%' }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="data-table-state">
                      <div className="empty-state">
                        <div className="empty-state-icon">
                          <Icon icon={Icons.FolderOpen} />
                        </div>
                        <div className="empty-state-title">No activity found</div>
                        <div className="empty-state-hint">
                          Try adjusting your search or filters.
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => {
                    const verb = actionVerb(row.log_name);
                    return (
                      <tr
                        key={row.id}
                        className={selected.has(row.id) ? 'activity-row-selected' : undefined}
                      >
                        <td>
                          <input
                            type="checkbox"
                            className="row-checkbox"
                            checked={selected.has(row.id)}
                            onChange={() => toggleOne(row.id)}
                          />
                        </td>
                        <td className="activity-sl">{(page - 1) * perPage + idx + 1}</td>
                        <td className="activity-date">{formatAuditDate(row.created_at)}</td>
                        <td>
                          <div className="activity-logname">{humanLabel(row.log_name)}</div>
                        </td>
                        <td className="activity-desc">{humanDescription(row)}</td>
                        <td>{row.actor_name ?? 'System Administrator'}</td>
                        <td>
                          <span className={`badge-clay ${actionTone(verb)}`}>{verb}</span>
                        </td>
                        <td>
                          <div className="data-table-actions">
                            {isAdmin && (
                              <button
                                className="icon-btn icon-btn-danger"
                                title="Delete"
                                onClick={() => setDeleteTarget(row)}
                              >
                                <Icon icon={Icons.Trash} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="data-table-footer">
            <div className="data-table-total">
              {total === 0
                ? 'No entries'
                : `Showing ${shownStart} to ${shownEnd} of ${total} entries`}
            </div>
            <div className="data-table-pagination">
              <button
                className="btn-clay btn-clay-secondary btn-clay-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              {pageItems.map((p, i) =>
                p === -1 ? (
                  <span key={`gap-${i}`} className="data-table-page-gap">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    className={`btn-clay btn-clay-sm ${p === page ? 'btn-clay-primary' : 'btn-clay-secondary'}`}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                className="btn-clay btn-clay-secondary btn-clay-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile card list */}
      {!loading && !error && (
        <div className="activity-mobile-cards">
          {rows.map((row) => {
            const verb = actionVerb(row.log_name);
            return (
              <div
                key={row.id}
                className={`activity-card ${selected.has(row.id) ? 'activity-row-selected' : ''}`}
              >
                <div className="activity-card-head">
                  <input
                    type="checkbox"
                    className="row-checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                  />
                  <div className="activity-card-title">
                    <span className="activity-logname">{humanLabel(row.log_name)}</span>
                    <span className={`badge-clay ${actionTone(verb)}`}>{verb}</span>
                  </div>
                </div>
                <div className="activity-card-desc">{humanDescription(row)}</div>
                <div className="activity-card-meta">
                  <span>{row.actor_name ?? 'System Administrator'}</span>
                  <span>{formatAuditDate(row.created_at)}</span>
                </div>
                <div className="data-table-actions">
                  {isAdmin && (
                    <button
                      className="btn-clay btn-clay-sm btn-clay-danger"
                      onClick={() => setDeleteTarget(row)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="data-table-state">
              <div className="empty-state">
                <div className="empty-state-icon">
                  <Icon icon={Icons.FolderOpen} />
                </div>
                <div className="empty-state-title">No activity found</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filter panel */}
      {filterOpen && (
        <>
          {!isMobile && (
            <div className="filter-popover-backdrop" onClick={() => setFilterOpen(false)} />
          )}
          <div
            className={isMobile ? 'modal-overlay' : 'filter-popover'}
            onClick={isMobile ? () => setFilterOpen(false) : undefined}
          >
            <div
              className={isMobile ? 'modal-content-clay filter-sheet' : 'filter-popover-panel'}
              onClick={(e) => e.stopPropagation()}
            >
              {isMobile && <div className="bottom-sheet-handle" />}
              <div className="modal-header-clay">
                <div className="modal-title-clay">Filter Activity Log</div>
                <button className="modal-close-btn" onClick={() => setFilterOpen(false)}>
                  <Icon icon={Icons.Close} />
                </button>
              </div>
              <div className="modal-body-clay">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Date From</label>
                    <input
                      type="date"
                      className="form-control-clay"
                      value={draftFilters.dateFrom}
                      onChange={(e) => setDraftFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date To</label>
                    <input
                      type="date"
                      className="form-control-clay"
                      value={draftFilters.dateTo}
                      onChange={(e) => setDraftFilters((f) => ({ ...f, dateTo: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Log Name / Module</label>
                    <select
                      className="form-control-clay"
                      value={draftFilters.logToken}
                      onChange={(e) => setDraftFilters((f) => ({ ...f, logToken: e.target.value }))}
                    >
                      <option value="">All Modules</option>
                      {MODULES.map((m) => (
                        <option key={m.token} value={m.token}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Action Type</label>
                    <select
                      className="form-control-clay"
                      value={draftFilters.action}
                      onChange={(e) => setDraftFilters((f) => ({ ...f, action: e.target.value }))}
                    >
                      <option value="">All Actions</option>
                      <option value="create">Created</option>
                      <option value="update">Updated</option>
                      <option value="delete">Deleted</option>
                      <option value="approve">Approved</option>
                      <option value="reject">Rejected</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Done By / User</label>
                  <input
                    className="form-control-clay"
                    placeholder="Search by user name..."
                    value={draftFilters.doneBy}
                    onChange={(e) => setDraftFilters((f) => ({ ...f, doneBy: e.target.value }))}
                  />
                </div>
              </div>
              <div className="modal-footer-clay">
                <button
                  className="btn-clay btn-clay-secondary"
                  onClick={() => {
                    setDraftFilters(EMPTY_FILTERS);
                    setFilters(EMPTY_FILTERS);
                    setPage(1);
                    setFilterOpen(false);
                  }}
                >
                  Reset
                </button>
                <button
                  className="btn-clay btn-clay-primary"
                  onClick={() => {
                    setFilters(draftFilters);
                    setPage(1);
                    setFilterOpen(false);
                  }}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Single delete confirm */}
      <ProtectedDeleteModal
        title="Delete Log Entry"
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={(deletePassword) => (deleteTarget ? performDelete([deleteTarget.id], deletePassword) : Promise.resolve())}
        submitting={submitting}
        message={
          <p>
            Are you sure you want to delete this activity log entry —{' '}
            <strong>{deleteTarget ? humanDescription(deleteTarget) : ''}</strong>?
          </p>
        }
      />

      {/* Bulk delete confirm */}
      <ProtectedDeleteModal
        title="Delete Selected Items"
        open={bulkTarget}
        onClose={() => setBulkTarget(false)}
        onConfirm={(deletePassword) => performDelete([...selected], deletePassword)}
        submitting={submitting}
        message={
          <p>
            You have selected <strong>{selected.size}</strong> activity log{' '}
            {selected.size === 1 ? 'entry' : 'entries'}. This action cannot be undone.
          </p>
        }
      />
    </div>
  );
}
