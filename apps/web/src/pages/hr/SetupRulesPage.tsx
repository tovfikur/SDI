import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { hr } from '../../api';
import type { WorkScheduleRow } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon, Icons } from '../../components/Icon';

const DAYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;
const DAY_LABELS: Record<string, string> = {
  sat: 'Sat', sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri',
};
const DAY_ORDER: Record<string, number> = {
  sat: 0, sun: 1, mon: 2, tue: 3, wed: 4, thu: 5, fri: 6,
};
const WORK_PATTERNS = ['Fixed', '5 Days', '6 Days', '7 Days', 'Shift'] as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function timeToMinutes(t: string): number {
  if (!TIME_RE.test(t)) return -1;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Shift duration in minutes, supporting overnight shifts. */
function shiftMinutes(start: string, end: string): number {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s < 0 || e < 0) return 0;
  if (e <= s) return 24 * 60 - s + e;
  return e - s;
}

function formatHours(minutes: number): string {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(2)} h`;
}

interface FormState {
  title: string;
  employee_type_id: string;
  work_pattern: string;
  daily_working_hour: string;
  office_start_time: string;
  office_end_time: string;
  grace_period_minutes: string;
  working_days: string[];
  auto_calc_hours: boolean;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  title: '',
  employee_type_id: '',
  work_pattern: 'Fixed',
  daily_working_hour: '8',
  office_start_time: '09:00',
  office_end_time: '18:00',
  grace_period_minutes: '10',
  working_days: ['sun', 'mon', 'tue', 'wed', 'thu'],
  auto_calc_hours: true,
  is_active: true,
};

export function SetupRulesPage(): ReactElement {
  const { can } = usePermissions();
  const [rows, setRows] = useState<WorkScheduleRow[]>([]);
  const [employeeTypes, setEmployeeTypes] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkScheduleRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<WorkScheduleRow | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [listRes, typeRes] = await Promise.all([
        hr.setupRules({ page, perPage, search }),
        hr.employeeTypes({ perPage: 100 }),
      ]);
      setRows((listRes.data as { items: WorkScheduleRow[] }).items);
      setTotal((listRes.data as unknown as { total: number }).total);
      setEmployeeTypes((typeRes.data as { items: { id: string; name: string }[] }).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load work schedules');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const toForm = (r?: WorkScheduleRow | null): FormState => {
    if (!r) return { ...EMPTY_FORM, employee_type_id: employeeTypes[0]?.id ?? '' };
    return {
      title: r.title,
      employee_type_id: r.employee_type_id ?? '',
      work_pattern: r.work_pattern,
      daily_working_hour: r.daily_working_hour,
      office_start_time: r.office_start_time,
      office_end_time: r.office_end_time,
      grace_period_minutes: String(r.grace_period_minutes ?? 0),
      working_days: Array.isArray(r.working_days) && r.working_days.length > 0 ? r.working_days : ['sun', 'mon', 'tue', 'wed', 'thu'],
      auto_calc_hours: r.auto_calc_hours !== false,
      is_active: r.is_active !== false,
    };
  };

  const openCreate = () => {
    setEditing(null);
    setForm(toForm(null));
    setFormError('');
    setFieldErrors({});
    setModalOpen(true);
  };

  const openEdit = (row: WorkScheduleRow) => {
    setEditing(row);
    setForm(toForm(row));
    setFormError('');
    setFieldErrors({});
    setModalOpen(true);
  };

  const derived = useMemo(() => {
    const duration = shiftMinutes(form.office_start_time, form.office_end_time);
    const overnight = form.office_end_time < form.office_start_time;
    const computedHours = duration > 0 ? (duration / 60) : 0;
    return {
      duration,
      overnight,
      computedHours: Number.isInteger(computedHours) ? String(computedHours) : computedHours.toFixed(2),
      effectiveHours: form.auto_calc_hours ? (Number.isInteger(computedHours) ? computedHours.toFixed(2) : computedHours.toFixed(2)) : form.daily_working_hour,
      sortedDays: [...form.working_days].sort((a, b) => (DAY_ORDER[a] ?? 0) - (DAY_ORDER[b] ?? 0)),
    };
  }, [form.office_start_time, form.office_end_time, form.working_days, form.auto_calc_hours, form.daily_working_hour]);

  const toggleDay = (day: string) => {
    setForm((f) => {
      const has = f.working_days.includes(day);
      if (has && f.working_days.length === 1) return f;
      return { ...f, working_days: has ? f.working_days.filter((d) => d !== day) : [...f.working_days, day] };
    });
  };

  const save = async () => {
    setSubmitting(true);
    setFormError('');
    setFieldErrors({});
    const body = {
      title: form.title,
      employee_type_id: form.employee_type_id || null,
      work_pattern: form.work_pattern,
      daily_working_hour: Number(form.daily_working_hour) || 0,
      office_start_time: form.office_start_time,
      office_end_time: form.office_end_time,
      grace_period_minutes: Number(form.grace_period_minutes) || 0,
      working_days: [...form.working_days].sort((a, b) => (DAY_ORDER[a] ?? 0) - (DAY_ORDER[b] ?? 0)),
      auto_calc_hours: form.auto_calc_hours,
      is_active: form.is_active,
    };
    try {
      if (editing) {
        await hr.updateSetupRule(editing.id, body);
      } else {
        await hr.createSetupRule(body);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      const err = e as { fieldErrors?: Record<string, string>; message?: string };
      if (err?.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        setFieldErrors(err.fieldErrors);
      }
      setFormError(err?.message ?? 'Failed to save work schedule');
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    setDeleteBlocked('');
    try {
      await hr.deleteSetupRule(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code === 'schedule_in_use' || (err?.message ?? '').includes('assigned')) {
        setDeleteBlocked(err?.message ?? 'This schedule is assigned to employees.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to delete work schedule');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const deactivateAndClose = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    setFormError('');
    try {
      await hr.updateSetupRule(deleteTarget.id, {
        title: deleteTarget.title,
        employee_type_id: deleteTarget.employee_type_id,
        work_pattern: deleteTarget.work_pattern,
        daily_working_hour: Number(deleteTarget.daily_working_hour) || 8,
        office_start_time: deleteTarget.office_start_time,
        office_end_time: deleteTarget.office_end_time,
        grace_period_minutes: deleteTarget.grace_period_minutes ?? 0,
        working_days: Array.isArray(deleteTarget.working_days) ? deleteTarget.working_days : [],
        auto_calc_hours: deleteTarget.auto_calc_hours !== false,
        is_active: false,
      });
      setDeleteTarget(null);
      setDeleteBlocked('');
      await load();
    } catch (e) {
      setDeleteBlocked(e instanceof Error ? e.message : 'Failed to deactivate schedule');
    } finally {
      setSubmitting(false);
    }
  };

  const workingDaysLabel = (days: unknown): string => {
    if (!Array.isArray(days) || days.length === 0) return '—';
    return [...days].sort((a, b) => (DAY_ORDER[a as string] ?? 0) - (DAY_ORDER[b as string] ?? 0)).map((d) => DAY_LABELS[d as string] ?? d).join(' · ');
  };

  const columns: DataColumn<WorkScheduleRow>[] = [
    { key: 'title', header: 'Title', sortable: true, render: (r) => <strong>{r.title}</strong> },
    {
      key: 'employee_type_name',
      header: 'Employee Type',
      sortable: true,
      render: (r) =>
        r.employee_type_name ?? employeeTypes.find((t) => t.id === r.employee_type_id)?.name ?? '—',
    },
    {
      key: 'work_pattern',
      header: 'Pattern',
      render: (r) => <span className="badge-soft">{r.work_pattern}</span>,
    },
    {
      key: 'working_days',
      header: 'Working Days',
      render: (r) => <span className="schedule-days-cell">{workingDaysLabel(r.working_days)}</span>,
    },
    {
      key: 'daily_working_hour',
      header: 'Hours/Day',
      align: 'center',
      render: (r) => <span className="schedule-hours-cell">{formatHours(Number(r.daily_working_hour) * 60)}</span>,
    },
    {
      key: 'office_start_time',
      header: 'Office Hours',
      align: 'center',
      render: (r) => (
        <span className="schedule-hours-cell">
          {r.office_start_time} – {r.office_end_time}
          {r.office_end_time < r.office_start_time && (
            <span className="overnight-badge" title="Overnight shift">+1d</span>
          )}
        </span>
      ),
    },
    { key: 'grace_period_minutes', header: 'Grace (min)', align: 'center', sortable: true },
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
        <div className="data-table-actions">
          {can('hr.masters.update') && (
            <button className="icon-btn" title="Edit" onClick={() => openEdit(r)}>
              <Icon icon={Icons.Edit} />
            </button>
          )}
          {can('hr.masters.delete') && (
            <button
              className="icon-btn icon-btn-danger"
              title="Delete"
              onClick={() => {
                setDeleteBlocked('');
                setDeleteTarget(r);
              }}
            >
              <Icon icon={Icons.Trash} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const toggleStatus = () => {
    setForm((f) => ({ ...f, is_active: !f.is_active }));
  };

  const setField = (k: keyof FormState, v: string | string[] | boolean) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (typeof k === 'string') {
      setFieldErrors((prev) => {
        if (!prev[k]) return prev;
        const next = { ...prev };
        delete next[k];
        return next;
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="Work Schedule"
        subtitle="Configure work patterns, working days, shift hours, grace periods and attendance scheduling rules."
        actions={
          can('hr.masters.create') && (
            <button className="btn-clay btn-clay-primary" onClick={openCreate}>
              + New Schedule
            </button>
          )
        }
      />
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
        search={search}
        onSearch={(s) => {
          setSearch(s);
          setPage(1);
        }}
        searchPlaceholder="Search schedules..."
        csvFilename="setup-rules.csv"
        excelFilename="setup-rules.xls"
        printable
      />

      <Modal
        title={editing ? 'Edit Schedule' : 'New Schedule'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel={editing ? 'Update Schedule' : 'Create Schedule'}
        wide
      >
        {/* ===== Schedule Details ===== */}
        <div className="form-section-title">Schedule Details</div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Title <span className="form-required">*</span>
            </label>
            <input
              className="form-control-clay"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              placeholder="e.g. Office Staff (5 days)"
              autoFocus
            />
            {fieldErrors.title && <div className="form-error-text">{fieldErrors.title}</div>}
          </div>
          <div className="form-group">
            <label className="form-label">Employee Type</label>
            <select
              className="form-control-clay"
              value={form.employee_type_id}
              onChange={(e) => setField('employee_type_id', e.target.value)}
            >
              <option value="">— All —</option>
              {employeeTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {fieldErrors.employee_type_id && <div className="form-error-text">{fieldErrors.employee_type_id}</div>}
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Work Pattern</label>
            <div className="pattern-segment">
              {WORK_PATTERNS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`pattern-segment-btn ${form.work_pattern === p ? 'active' : ''}`}
                  onClick={() => setField('work_pattern', p)}
                >
                  {p}
                </button>
              ))}
            </div>
            {fieldErrors.work_pattern && <div className="form-error-text">{fieldErrors.work_pattern}</div>}
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <button
              type="button"
              className={`toggle-switch ${form.is_active ? 'on' : ''}`}
              onClick={toggleStatus}
              role="switch"
              aria-checked={form.is_active}
            >
              <span className="toggle-switch-track">
                <span className="toggle-switch-thumb" />
              </span>
              <span className="toggle-switch-label">{form.is_active ? 'Active' : 'Inactive'}</span>
            </button>
          </div>
        </div>

        {/* ===== Working Days & Hours ===== */}
        <div className="form-section-title">Working Days &amp; Hours</div>
        <div className="form-group">
          <label className="form-label">
            Working Days <span className="form-required">*</span>
          </label>
          <div className="day-chips">
            {DAYS.map((d) => (
              <button
                key={d}
                type="button"
                className={`day-chip ${form.working_days.includes(d) ? 'on' : ''}`}
                onClick={() => toggleDay(d)}
              >
                {DAY_LABELS[d]}
              </button>
            ))}
          </div>
          {fieldErrors.working_days && <div className="form-error-text">{fieldErrors.working_days}</div>}
        </div>
        <div className="form-row form-row-3">
          <div className="form-group">
            <label className="form-label">Office Start Time</label>
            <input
              type="time"
              className="form-control-clay"
              value={form.office_start_time}
              onChange={(e) => setField('office_start_time', e.target.value)}
            />
            {fieldErrors.office_start_time && <div className="form-error-text">{fieldErrors.office_start_time}</div>}
          </div>
          <div className="form-group">
            <label className="form-label">Office End Time</label>
            <input
              type="time"
              className="form-control-clay"
              value={form.office_end_time}
              onChange={(e) => setField('office_end_time', e.target.value)}
            />
            {fieldErrors.office_end_time && <div className="form-error-text">{fieldErrors.office_end_time}</div>}
            {derived.overnight && (
              <div className="overnight-hint">
                <Icon icon={Icons.Moon} size="xs" /> Overnight shift — ends next day
              </div>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">Daily Working Hours</label>
            <div className="hours-input-wrap">
              <input
                type="number"
                min={0.5}
                max={24}
                step={0.5}
                className="form-control-clay"
                value={form.auto_calc_hours ? derived.computedHours : form.daily_working_hour}
                disabled={form.auto_calc_hours}
                onChange={(e) => setField('daily_working_hour', e.target.value)}
              />
              <label className="auto-calc-toggle">
                <input
                  type="checkbox"
                  checked={form.auto_calc_hours}
                  onChange={(e) => setField('auto_calc_hours', e.target.checked)}
                />
                Auto-calc
              </label>
            </div>
            {fieldErrors.daily_working_hour && <div className="form-error-text">{fieldErrors.daily_working_hour}</div>}
            {form.auto_calc_hours && (
              <div className="auto-calc-hint">Auto-calculated from start/end time. Uncheck to override.</div>
            )}
          </div>
        </div>

        {/* ===== Attendance Rules ===== */}
        <div className="form-section-title">Attendance Rules</div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Grace Period (minutes)</label>
            <input
              type="number"
              min={0}
              className="form-control-clay"
              value={form.grace_period_minutes}
              onChange={(e) => setField('grace_period_minutes', e.target.value)}
            />
            {fieldErrors.grace_period_minutes && <div className="form-error-text">{fieldErrors.grace_period_minutes}</div>}
          </div>
          <div className="form-group">
            <label className="form-label">Schedule Preview</label>
            <div className="schedule-preview">
              <div className="schedule-preview-row">
                <span className="schedule-preview-key">Days</span>
                <span className="schedule-preview-days">
                  {derived.sortedDays.length > 0
                    ? derived.sortedDays.map((d) => DAY_LABELS[d] ?? d).join(', ')
                    : '—'}
                </span>
              </div>
              <div className="schedule-preview-row">
                <span className="schedule-preview-key">Off days</span>
                <span className="schedule-preview-off">
                  {DAYS.filter((d) => !form.working_days.includes(d)).map((d) => DAY_LABELS[d]).join(', ') || 'None'}
                </span>
              </div>
              <div className="schedule-preview-row">
                <span className="schedule-preview-key">Shift</span>
                <span>
                  {form.office_start_time} – {form.office_end_time}
                  {derived.overnight && ' (+1d)'}
                </span>
              </div>
              <div className="schedule-preview-row">
                <span className="schedule-preview-key">Duration</span>
                <span>{formatHours(derived.duration)}</span>
              </div>
              <div className="schedule-preview-row">
                <span className="schedule-preview-key">Effective hours</span>
                <span>{formatHours(Number(derived.effectiveHours) * 60)}</span>
              </div>
            </div>
          </div>
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>

      <ProtectedDeleteModal
        title="Delete Schedule"
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteBlocked('');
        }}
        onConfirm={doDelete}
        submitting={submitting}
        message={
          deleteBlocked ? (
            <div className="delete-blocked">
              <div className="delete-blocked-icon">
                <Icon icon={Icons.Warning} />
              </div>
              <p>
                <strong>{deleteTarget?.title}</strong> cannot be deleted because it is assigned to
                employees.
              </p>
              <p className="delete-blocked-message">{deleteBlocked}</p>
              <p className="delete-blocked-hint">
                Deactivate the schedule instead. Assigned employees keep their records, but attendance
                calculation stops using it.
              </p>
              <button
                className="btn-clay btn-clay-primary"
                onClick={deactivateAndClose}
                disabled={submitting}
              >
                {submitting && <span className="btn-spinner" aria-hidden="true" />}
                Deactivate Schedule
              </button>
            </div>
          ) : (
            <p>
              Are you sure you want to delete <strong>{deleteTarget?.title}</strong>? This action
              cannot be undone.
            </p>
          )
        }
      />
    </div>
  );
}