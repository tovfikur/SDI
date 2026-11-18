import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { usePermissions } from '../../auth-context';
import { hr, files, ApiError } from '../../api';
import type { EmployeeCredentials } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { StatusBadge } from '../../components/StatusBadge';
import { ChartCard } from '../../components/charts/ChartCard';
import { DonutChart, HorizontalBarChart } from '../../components/charts/charts';
import { statusColor, PALETTE } from '../../components/charts/chartTheme';
import { formatStatusLabel } from '../../utils/statusLabels';
import { useToast } from '../../components/Toast';
import { Icon, Icons } from '../../components/Icon';
import { AppointmentLetterUpload, LetterFileView } from '../../components/AppointmentLetterUpload';
import { EmployeePhotoUpload, EmployeeAvatar } from '../../components/EmployeePhotoUpload';

interface Row {
  id: string;
  employee_code: string;
  full_name: string;
  email: string | null;
  mobile: string | null;
  gender: string | null;
  marital_status?: string | null;
  blood_group?: string | null;
  contract_type?: string | null;
  joining_date: string | null;
  contract_end_date?: string | null;
  date_of_birth?: string | null;
  department_id?: string | null;
  branch_id?: string | null;
  sub_department_id?: string | null;
  position_id?: string | null;
  employee_type_id?: string | null;
  setup_rule_id?: string | null;
  department_name: string | null;
  branch_name: string | null;
  sub_department_name: string | null;
  position_name: string | null;
  employee_type_name: string | null;
  status: string;
  joining_letter_url: string | null;
  appointment_letter_file_id: string | null;
  photo_file_id: string | null;
  photo_url: string | null;
}

interface Lookup {
  id: string;
  name: string;
  title?: string;
  department_id?: string;
}

interface EmployeeFormData {
  employee_code: string;
  full_name: string;
  email: string;
  mobile: string;
  gender: string;
  marital_status: string;
  blood_group: string;
  contract_type: string;
  joining_date: string;
  contract_end_date: string;
  date_of_birth: string;
  department_id: string;
  branch_id: string;
  sub_department_id: string;
  position_id: string;
  employee_type_id: string;
  setup_rule_id: string;
}

const EMPTY_FORM: EmployeeFormData = {
  employee_code: '',
  full_name: '',
  email: '',
  mobile: '',
  gender: '',
  marital_status: '',
  blood_group: '',
  contract_type: '',
  joining_date: '',
  contract_end_date: '',
  date_of_birth: '',
  department_id: '',
  branch_id: '',
  sub_department_id: '',
  position_id: '',
  employee_type_id: '',
  setup_rule_id: '',
};

export function EmployeeListTab(): ReactElement {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [rows, setRows] = useState<Row[]>([]);
  const [lookups, setLookups] = useState<{
    departments: Lookup[];
    branches: Lookup[];
    subDepartments: Lookup[];
    positions: Lookup[];
    types: Lookup[];
    setupRules: Lookup[];
  }>({
    departments: [],
    branches: [],
    subDepartments: [],
    positions: [],
    types: [],
    setupRules: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [workforce, setWorkforce] = useState<Record<string, unknown> | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [credentials, setCredentials] = useState<EmployeeCredentials | null>(null);
  const [credentialCopied, setCredentialCopied] = useState(false);
  const [resetCreds, setResetCreds] = useState<EmployeeCredentials | null>(null);
  const [resetCopied, setResetCopied] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [resetTarget, setResetTarget] = useState<Row | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetForceChange, setResetForceChange] = useState(true);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetFormError, setResetFormError] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<EmployeeFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [letterFile, setLetterFile] = useState<{ file_id: string; filename: string } | null>(null);
  const [photoFile, setPhotoFile] = useState<{ file_id: string; preview: string } | null>(null);
  const [detailLetterName, setDetailLetterName] = useState('');

  useEffect(() => {
    if (detail?.appointment_letter_file_id) {
      setDetailLetterName('');
      files.fileDownload(detail.appointment_letter_file_id).then((res) => setDetailLetterName(res.data.filename)).catch(() => {});
    } else {
      setDetailLetterName('');
    }
  }, [detail]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hr.employees({ page, perPage, search, ...filters });
      const data = res.data as { items: Row[]; total: number };
      setRows((data.items ?? []).filter((x) => x !== null && typeof x === 'object'));
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load employees');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, search, filters]);

  const loadLookups = useCallback(async () => {
    try {
      const [d, b, s, p, t, r] = await Promise.all([
        hr.departments({ perPage: 100 }),
        hr.branches({ perPage: 100 }),
        hr.subDepartments({ perPage: 100 }),
        hr.positions({ perPage: 100 }),
        hr.employeeTypes({ perPage: 100 }),
        hr.setupRules({ perPage: 100 }),
      ]);
      setLookups({
        departments: (d.data as { items: Lookup[] }).items,
        branches: (b.data as { items: Lookup[] }).items ?? [],
        subDepartments: (s.data as { items: Lookup[] }).items,
        positions: (p.data as { items: Lookup[] }).items,
        types: (t.data as { items: Lookup[] }).items,
        setupRules: (r.data as { items: Lookup[] }).items,
      });
    } catch {
      /* lookups optional */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const key of ['departmentId', 'employeeTypeId', 'status', 'gender']) {
      const v = searchParams.get(key);
      if (v) next[key] = v;
    }
    if (Object.keys(next).length > 0) setFilters((f) => ({ ...f, ...next }));
  }, []);

  useEffect(() => {
    const deep = (location.state as { openEmployee?: { id?: string } } | null)?.openEmployee;
    if (!deep?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await hr.employee(deep.id as string);
        if (!cancelled) setDetail(res.data as unknown as Row);
      } catch {
        /* deep link best-effort */
      } finally {
        if (!cancelled) navigate('.', { replace: true, state: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.state]);

  // openCreate replaced by wizard route — kept for potential future use
  const _openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setFieldErrors({});
    setModalOpen(true);
  };
  void _openCreate;

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm({
      employee_code: row.employee_code,
      full_name: row.full_name,
      email: row.email ?? '',
      mobile: row.mobile ?? '',
      gender: row.gender ?? '',
      marital_status: row.marital_status ?? '',
      blood_group: row.blood_group ?? '',
      contract_type: row.contract_type ?? '',
      joining_date: (row.joining_date ?? '').slice(0, 10),
      contract_end_date: (row.contract_end_date ?? '').slice(0, 10),
      date_of_birth: (row.date_of_birth ?? '').slice(0, 10),
      department_id: row.department_id ?? '',
      branch_id: row.branch_id ?? '',
      sub_department_id: row.sub_department_id ?? '',
      position_id: row.position_id ?? '',
      employee_type_id: row.employee_type_id ?? '',
      setup_rule_id: row.setup_rule_id ?? '',
    });
    setLetterFile(
      row.appointment_letter_file_id
        ? { file_id: row.appointment_letter_file_id, filename: row.employee_code ? `${row.employee_code} appointment letter` : 'Appointment Letter' }
        : null
    );
    setPhotoFile(row.photo_file_id ? { file_id: row.photo_file_id, preview: '' } : null);
    if (row.appointment_letter_file_id) {
      files.fileDownload(row.appointment_letter_file_id).then((res) => {
        setLetterFile((prev) => (prev && prev.file_id === row.appointment_letter_file_id ? { file_id: prev.file_id, filename: res.data.filename } : prev));
      }).catch(() => { /* keep fallback filename */ });
    }
    setFormError('');
    setFieldErrors({});
    setModalOpen(true);
  };

  const save = async () => {
    if (submitting) return;
    const nextErrors: Record<string, string> = {};
    if (!form.full_name.trim()) {
      nextErrors.full_name = 'Full Name is required.';
    }
    if (form.joining_date && form.contract_end_date && form.contract_end_date < form.joining_date) {
      nextErrors.contract_end_date = 'Contract End Date cannot be before Joining Date.';
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setFormError('Please fix the highlighted fields and try again.');
      return;
    }

    setSubmitting(true);
    setFormError('');
    setFieldErrors({});
    const body: Record<string, unknown> = {
      employee_code: form.employee_code || undefined,
      full_name: form.full_name.trim(),
      email: form.email || undefined,
      mobile: form.mobile || undefined,
      gender: form.gender || undefined,
      marital_status: form.marital_status || undefined,
      blood_group: form.blood_group || undefined,
      contract_type: form.contract_type || undefined,
      joining_date: form.joining_date || undefined,
      contract_end_date: form.contract_end_date || undefined,
      date_of_birth: form.date_of_birth || undefined,
      department_id: form.department_id || undefined,
      branch_id: form.branch_id || undefined,
      sub_department_id: form.sub_department_id || undefined,
      position_id: form.position_id || undefined,
      employee_type_id: form.employee_type_id || undefined,
      setup_rule_id: form.setup_rule_id || undefined,
      appointment_letter_file_id: letterFile ? letterFile.file_id : null,
      photo_file_id: photoFile ? photoFile.file_id : null,
    };
    try {
      if (editing) {
        await hr.updateEmployee(editing.id, body);
      } else {
        const res = await hr.createEmployee(body);
        setCredentials(res.data.credentials);
      }
      setModalOpen(false);
      toast(editing ? 'Employee updated' : 'Employee created', 'success');
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        setFieldErrors(e.fieldErrors ?? {});
        setFormError(e.message);
      } else {
        setFormError(e instanceof Error ? e.message : 'Failed to save employee');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await hr.deleteEmployee(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      toast('Employee deleted', 'success');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete employee');
    } finally {
      setSubmitting(false);
    }
  };

  const setStatus = async (row: Row, status: string) => {
    try {
      await hr.setEmployeeStatus(row.id, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status');
    }
  };

  const copyCredentials = async (creds: EmployeeCredentials, copiedKey: 'credentialCopied' | 'resetCopied') => {
    const loginId = creds.email ?? creds.username;
    const text = loginId ? `Login email: ${loginId}\nTemporary password: ${creds.temporary_password}` : creds.temporary_password;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      if (loginId) textarea.value = text;
      else textarea.value = creds.temporary_password;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    if (copiedKey === 'credentialCopied') setCredentialCopied(true);
    else setResetCopied(true);
  };

  const copyPassword = async (creds: EmployeeCredentials) => {
    try {
      await navigator.clipboard.writeText(creds.temporary_password);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = creds.temporary_password;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setPasswordCopied(true);
  };

  const doResetLoginPassword = async () => {
    if (!resetTarget) return;
    if (resetPassword.length > 0 && (resetPassword.length < 8 || resetPassword.length > 72)) {
      setResetFormError('Temporary password must be between 8 and 72 characters.');
      return;
    }
    setResetSubmitting(true);
    setResetFormError('');
    try {
      const res = await hr.resetLoginPassword(resetTarget.id, {
        ...(resetPassword.trim() ? { password: resetPassword.trim() } : {}),
        forceChange: resetForceChange,
      });
      setResetTarget(null);
      setResetPassword('');
      setResetForceChange(true);
      setResetCreds(res.data);
      setResetCopied(false);
      setPasswordCopied(false);
    } catch (e) {
      setResetFormError(e instanceof Error ? e.message : 'Failed to reset login password');
    } finally {
      setResetSubmitting(false);
    }
  };

  const openResetDialog = (row: Row) => {
    setResetTarget(row);
    setResetPassword('');
    setResetForceChange(true);
    setResetFormError('');
  };

  const changeDepartment = (departmentId: string) => {
    setForm((f) => ({ ...f, department_id: departmentId, sub_department_id: '' }));
  };

  const filteredSubDepartments = form.department_id
    ? lookups.subDepartments.filter((d) => d.department_id === form.department_id)
    : lookups.subDepartments;

  const fieldHint = (name: keyof EmployeeFormData) =>
    fieldErrors[name] ? <div className="form-error-text">{fieldErrors[name]}</div> : null;

  useEffect(() => {
    let cancelled = false;
    async function fetchWorkforce() {
      setAnalyticsLoading(true);
      try {
        const res = await hr.workforceAnalytics();
        if (!cancelled) setWorkforce((res.data ?? {}) as Record<string, unknown>);
      } catch {
        /* optional */
      }
      if (!cancelled) setAnalyticsLoading(false);
    }
    void fetchWorkforce();
    return () => {
      cancelled = true;
    };
  }, []);

  const setFilter = (key: string, value: string) => {
    setFilters((f) => {
      const next = { ...f };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
    const nextParams = new URLSearchParams(searchParams);
    if (value) nextParams.set(key, value);
    else nextParams.delete(key);
    setSearchParams(nextParams, { replace: true });
    setPage(1);
  };

  const byDepartment = (workforce?.byDepartment as Array<{ id: string; name: string; n: number }>) ?? [];
  const byType = (workforce?.byType as Array<{ id: string; name: string; n: number }>) ?? [];
  const byStatus = (workforce?.byStatus as Array<{ name: string; n: number }>) ?? [];

  const filterBtn = (key: string, value: string, label: string) => (
    <button
      className={`btn-clay btn-clay-sm ${filters[key] === value ? 'btn-clay-primary' : 'btn-clay-secondary'}`}
      onClick={() => setFilter(key, filters[key] === value ? '' : value)}
    >
      {label}
    </button>
  );

  const columns: DataColumn<Row>[] = [
    {
      key: 'employee_code',
      header: 'Employee ID',
      sortable: true,
      render: (r) => (
        <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{r.employee_code}</span>
      ),
    },
    {
      key: 'full_name',
      header: 'Name',
      sortable: true,
      render: (r) => (
        <button
          className="btn-clay btn-clay-sm"
          style={{ textAlign: 'left', display: 'inline-flex', alignItems: 'center', gap: 8 }}
          onClick={() => setDetail(r)}
        >
          <EmployeeAvatar fileId={r.photo_file_id} url={r.photo_url} name={r.full_name} size={30} />
          <strong>{r.full_name}</strong>
        </button>
      ),
    },
    { key: 'email', header: 'Email', render: (r) => r.email ?? '—' },
    { key: 'mobile', header: 'Mobile', render: (r) => r.mobile ?? '—' },
    { key: 'department_name', header: 'Department', render: (r) => r.department_name ?? '—' },
    { key: 'branch_name', header: 'Branch', render: (r) => r.branch_name ?? '—' },
    { key: 'sub_department_name', header: 'Sub Department', render: (r) => r.sub_department_name ?? '—' },
    { key: 'position_name', header: 'Position', render: (r) => r.position_name ?? '—' },
    { key: 'employee_type_name', header: 'Type', render: (r) => r.employee_type_name ?? '—' },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      render: (r) => <StatusBadge value={r.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <div className="data-table-actions">
          {can('hr.employee.update') && (
            <button className="icon-btn" title="Edit" onClick={() => openEdit(r)}>
              <Icon icon={Icons.Edit} />
            </button>
          )}
          {can('hr.employee.update') && (
            <button
              className="icon-btn"
              title="Reset login password"
              onClick={() => openResetDialog(r)}
            >
              <Icon icon={Icons.Key} />
            </button>
          )}
          {r.status === 'active' ? (
            <button
              className="icon-btn"
              title="Deactivate"
              onClick={() => setStatus(r, 'inactive')}
            >
              <Icon icon={Icons.Ban} />
            </button>
          ) : (
            <button
              className="icon-btn icon-btn-success"
              title="Activate"
              onClick={() => setStatus(r, 'active')}
            >
              <Icon icon={Icons.Check} />
            </button>
          )}
          {can('hr.employee.delete') && (
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
      <div className="filter-bar">
        {filterBtn('status', 'active', 'Active')}
        {filterBtn('status', 'inactive', 'Inactive')}
        {filterBtn('gender', 'Male', 'Male')}
        {filterBtn('gender', 'Female', 'Female')}
      </div>

      <div className="analytics-grid analytics-grid-wide">
        <ChartCard
          title="Headcount by Department"
          subtitle="Click a bar to filter the employee table"
          loading={analyticsLoading}
          empty={byDepartment.length === 0}
        >
          <HorizontalBarChart
            data={byDepartment.map((d) => ({ name: d.name, n: d.n }))}
            nameKey="name"
            valueKey="n"
            onBarClick={(entry) => {
              const raw = byDepartment.find((d) => d.name === String(entry.name));
              if (raw) setFilter('departmentId', filters.departmentId === raw.id ? '' : raw.id);
            }}
          />
        </ChartCard>

        <ChartCard
          title="Employee Mix"
          subtitle="Employment type & status — click to filter"
          loading={analyticsLoading}
          empty={byType.length === 0 && byStatus.length === 0}
        >
          <div className="analytics-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 0 }}>
            <div>
              <DonutChart
                data={byType.map((t, i) => ({ key: t.name, value: t.n, color: PALETTE[i % PALETTE.length] }))}
                onSliceClick={(entry) => {
                  const raw = byType.find((t) => t.name === String(entry));
                  if (raw) setFilter('employeeTypeId', filters.employeeTypeId === raw.id ? '' : raw.id);
                }}
                height={150}
              />
              <div className="chart-legend" style={{ justifyContent: 'center' }}>
                {byType.map((t, i) => (
                  <button
                    key={t.name}
                    type="button"
                    className="chart-legend-item"
                    style={
                      filters.employeeTypeId === t.id
                        ? { borderColor: 'var(--primary)', color: 'var(--primary)', background: 'var(--brand-soft)' }
                        : undefined
                    }
                    onClick={() => setFilter('employeeTypeId', filters.employeeTypeId === t.id ? '' : t.id)}
                  >
                    <span className="chart-legend-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                    <span className="chart-legend-label">{t.name}</span>
                    <span className="chart-legend-value">{t.n}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <DonutChart
                data={byStatus.map((t) => ({ key: t.name, value: t.n, color: statusColor(t.name) }))}
                onSliceClick={(entry) => {
                  const raw = byStatus.find((t) => t.name === String(entry));
                  if (raw) setFilter('status', filters.status === raw.name ? '' : raw.name);
                }}
                height={150}
              />
              <div className="chart-legend" style={{ justifyContent: 'center' }}>
                {byStatus.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    className="chart-legend-item"
                    style={
                      filters.status === t.name
                        ? { borderColor: 'var(--primary)', color: 'var(--primary)', background: 'var(--brand-soft)' }
                        : undefined
                    }
                    onClick={() => setFilter('status', filters.status === t.name ? '' : t.name)}
                  >
                    <span className="chart-legend-dot" style={{ background: statusColor(t.name) }} />
                    <span className="chart-legend-label">{formatStatusLabel(t.name)}</span>
                    <span className="chart-legend-value">{t.n}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </ChartCard>
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
        search={search}
        onSearch={(s) => {
          setSearch(s);
          setPage(1);
        }}
        searchPlaceholder="Search by name, employee ID or email..."
        csvFilename="employees.csv"
        excelFilename="employees.xls"
        printable
        toolbarExtra={
          <>
            <select
              className="form-control-clay form-control-clay-sm"
              style={{ minWidth: 160 }}
              value={filters['filter[branch_id]'] || ''}
              onChange={(e) => {
                const v = e.target.value;
                setFilters((prev) => {
                  const next = { ...prev };
                  if (v) next['filter[branch_id]'] = v;
                  else delete next['filter[branch_id]'];
                  return next;
                });
                setPage(1);
              }}
            >
              <option value="">All Branches</option>
              {lookups.branches?.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <a
              className="btn-clay btn-clay-secondary btn-clay-sm"
              href={hr.employeesExportUrl}
              style={{ textDecoration: 'none' }}
            >
              Full Export
            </a>
            {can('hr.employee.create') && (
              <button className="btn-clay btn-clay-primary btn-clay-sm" onClick={() => navigate('/hr/employees/create')}>
                + New Employee
              </button>
            )}
          </>
        }
      />

      <Modal
        title={editing ? `Edit ${editing.full_name}` : 'New Employee'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting}
        submitLabel={editing ? 'Update' : 'Create'}
        busyLabel={editing ? 'Updating...' : 'Creating...'}
        wide
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Employee ID</label>
            <input
              className="form-control-clay"
              value={form.employee_code}
              onChange={(e) => setForm({ ...form, employee_code: e.target.value })}
              placeholder="Auto-generated if empty"
            />
            {fieldHint('employee_code')}
          </div>
          <div className="form-group">
            <label className="form-label">
              Full Name <span className="form-required">*</span>
            </label>
            <input
              className={`form-control-clay${fieldErrors.full_name ? ' form-control-clay-invalid' : ''}`}
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="e.g. John Doe"
              autoFocus
            />
            {fieldHint('full_name')}
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-control-clay"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="john.doe@company.com"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Mobile</label>
            <input
              className="form-control-clay"
              value={form.mobile}
              onChange={(e) => setForm({ ...form, mobile: e.target.value })}
              placeholder="+8801XXXXXXXXX"
            />
          </div>
        </div>
        <div className="form-row form-row-3">
          <div className="form-group">
            <label className="form-label">Gender</label>
            <select
              className="form-control-clay"
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value })}
            >
              <option value="">—</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Marital Status</label>
            <select
              className="form-control-clay"
              value={form.marital_status}
              onChange={(e) => setForm({ ...form, marital_status: e.target.value })}
            >
              <option value="">—</option>
              <option value="Single">Single</option>
              <option value="Married">Married</option>
              <option value="Divorced">Divorced</option>
              <option value="Widowed">Widowed</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Blood Group</label>
            <select
              className="form-control-clay"
              value={form.blood_group}
              onChange={(e) => setForm({ ...form, blood_group: e.target.value })}
            >
              <option value="">—</option>
              {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row form-row-3">
          <div className="form-group">
            <label className="form-label">Contract Type</label>
            <select
              className="form-control-clay"
              value={form.contract_type}
              onChange={(e) => setForm({ ...form, contract_type: e.target.value })}
            >
              <option value="">—</option>
              <option value="permanent">Permanent</option>
              <option value="contractual">Contractual</option>
              <option value="probation">Probation</option>
              <option value="intern">Intern</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Joining Date</label>
            <input
              type="date"
              className="form-control-clay"
              value={form.joining_date}
              onChange={(e) => setForm({ ...form, joining_date: e.target.value })}
            />
            {fieldHint('joining_date')}
          </div>
          <div className="form-group">
            <label className="form-label">Contract End Date</label>
            <input
              type="date"
              className={`form-control-clay${fieldErrors.contract_end_date ? ' form-control-clay-invalid' : ''}`}
              value={form.contract_end_date}
              onChange={(e) => setForm({ ...form, contract_end_date: e.target.value })}
            />
            {fieldHint('contract_end_date')}
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Date of Birth</label>
          <input
            type="date"
            className="form-control-clay"
            value={form.date_of_birth}
            onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
          />
          {fieldHint('date_of_birth')}
        </div>
        <div className="form-row form-row-3">
          <div className="form-group">
            <label className="form-label">Branch</label>
            <select
              className="form-control-clay"
              value={form.branch_id}
              onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
            >
              <option value="">— Select Branch —</option>
              {lookups.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Department</label>
            <select
              className={`form-control-clay${fieldErrors.department_id ? ' form-control-clay-invalid' : ''}`}
              value={form.department_id}
              onChange={(e) => changeDepartment(e.target.value)}
            >
              <option value="">—</option>
              {lookups.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {fieldHint('department_id')}
          </div>
          <div className="form-group">
            <label className="form-label">Sub Department</label>
            <select
              className={`form-control-clay${fieldErrors.sub_department_id ? ' form-control-clay-invalid' : ''}`}
              value={form.sub_department_id}
              onChange={(e) => setForm({ ...form, sub_department_id: e.target.value })}
              disabled={!form.department_id}
            >
              <option value="">—</option>
              {filteredSubDepartments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {fieldHint('sub_department_id')}
          </div>
        </div>
        <div className="form-row form-row-3">
          <div className="form-group">
            <label className="form-label">Position</label>
            <select
              className={`form-control-clay${fieldErrors.position_id ? ' form-control-clay-invalid' : ''}`}
              value={form.position_id}
              onChange={(e) => setForm({ ...form, position_id: e.target.value })}
            >
              <option value="">—</option>
              {lookups.positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {fieldHint('position_id')}
          </div>
          <div className="form-group">
            <label className="form-label">Employee Type</label>
            <select
              className={`form-control-clay${fieldErrors.employee_type_id ? ' form-control-clay-invalid' : ''}`}
              value={form.employee_type_id}
              onChange={(e) => setForm({ ...form, employee_type_id: e.target.value })}
            >
              <option value="">—</option>
              {lookups.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {fieldHint('employee_type_id')}
          </div>
          <div className="form-group">
            <label className="form-label">Work Schedule</label>
            <select
              className={`form-control-clay${fieldErrors.setup_rule_id ? ' form-control-clay-invalid' : ''}`}
              value={form.setup_rule_id}
              onChange={(e) => setForm({ ...form, setup_rule_id: e.target.value })}
            >
              <option value="">—</option>
              {lookups.setupRules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
            {fieldHint('setup_rule_id')}
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Employee Photo</label>
          <EmployeePhotoUpload
            value={photoFile}
            legacyUrl={editing?.photo_url ?? null}
            onChange={(v) => setPhotoFile(v)}
            disabled={submitting}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Appointment Letter</label>
          <AppointmentLetterUpload
            value={letterFile}
            onChange={(v) => setLetterFile(v)}
            disabled={submitting}
          />
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>

      <Modal title="Employee Details" open={detail !== null} onClose={() => setDetail(null)}>
        {detail && (
          <div className="employee-profile-head">
            <EmployeeAvatar fileId={detail.photo_file_id} url={detail.photo_url} name={detail.full_name} size={84} />
            <div className="employee-profile-head-info">
              <strong>{detail.full_name}</strong>
              <span>{detail.employee_code}</span>
              <Link
                to={`/me/todo?employee=${detail.id}&name=${encodeURIComponent(detail.full_name)}`}
                className="btn btn-outline"
                style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                title="View this employee's to-do list for today (read-only)"
              >
                View Today's To Do
              </Link>
            </div>
          </div>
        )}
        {detail && (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Name</label>
              <div>{detail.full_name}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Employee ID</label>
              <div>{detail.employee_code}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <div>{detail.email ?? '—'}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Mobile</label>
              <div>{detail.mobile ?? '—'}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Department</label>
              <div>{detail.department_name ?? '—'}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Branch</label>
              <div>{detail.branch_name ?? '—'}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Position</label>
              <div>{detail.position_name ?? '—'}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <div>
                <StatusBadge value={detail.status} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Joining Date</label>
              <div>
                {detail.joining_date ? new Date(detail.joining_date).toLocaleDateString() : '—'}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Appointment Letter</label>
              <div>
                {detail.appointment_letter_file_id ? (
                  <LetterFileView fileId={detail.appointment_letter_file_id} filename={detailLetterName || 'Appointment Letter'} />
                ) : detail.joining_letter_url ? (
                  <a href={detail.joining_letter_url} target="_blank" rel="noopener noreferrer" className="file-uploader-open">
                    <Icon icon={Icons.ExternalLink} size="sm" />
                    <span>View joining letter</span>
                  </a>
                ) : (
                  '—'
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title="Employee Created — Login Credentials"
        open={credentials !== null}
        onClose={() => setCredentials(null)}
        footer={
          <button className="btn-clay btn-clay-primary" onClick={() => setCredentials(null)}>
            Done
          </button>
        }
      >
        <p style={{ marginBottom: '0.85rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          These credentials are shown once. Share them with the employee securely.
        </p>
        {credentials && (
          <div className="panel-clay" style={{ padding: '1rem 1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Login ID / Email</label>
              <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>{credentials.email ?? credentials.username}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Temporary Password</label>
              <div style={{ fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.04em' }}>
                {credentials.temporary_password}
              </div>
            </div>
            <div className="form-help-text" style={{ marginTop: '0.4rem' }}>
              The employee must change this password on first login.
            </div>
          </div>
        )}
        <div className="data-table-actions" style={{ marginTop: '1rem', justifyContent: 'flex-end' }}>
          {credentials && (
            <button
              className="btn-clay btn-clay-sm btn-clay-secondary"
              onClick={() => void copyCredentials(credentials, 'credentialCopied')}
            >
              {credentialCopied ? 'Copied!' : 'Copy Credentials'}
            </button>
          )}
        </div>
      </Modal>

      <Modal
        title="Login Password Reset"
        open={resetCreds !== null}
        onClose={() => setResetCreds(null)}
        footer={
          <button className="btn-clay btn-clay-primary" onClick={() => setResetCreds(null)}>
            Done
          </button>
        }
      >
        <p style={{ marginBottom: '0.85rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          The employee's password has been reset. The temporary password below is shown only
          once — share it securely.
        </p>
        {resetCreds && (
          <div className="panel-clay" style={{ padding: '1rem 1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Login ID / Email</label>
              <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>{resetCreds.email ?? resetCreds.username}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Temporary Password</label>
              <div style={{ fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.04em' }}>
                {resetCreds.temporary_password}
              </div>
            </div>
            <div className="form-help-text" style={{ marginTop: '0.4rem' }}>
              {resetCreds.must_change_password === false
                ? 'The employee can keep this password or change it in their profile.'
                : 'The employee must change this password on next login.'}
            </div>
          </div>
        )}
        <div className="data-table-actions" style={{ marginTop: '1rem', justifyContent: 'flex-end' }}>
          {resetCreds && (
            <>
              <button
                className="btn-clay btn-clay-sm btn-clay-primary"
                onClick={() => void copyPassword(resetCreds)}
              >
                {passwordCopied ? 'Copied!' : 'Copy Password'}
              </button>
              <button
                className="btn-clay btn-clay-sm btn-clay-secondary"
                onClick={() => void copyCredentials(resetCreds, 'resetCopied')}
              >
                {resetCopied ? 'Copied!' : 'Copy Credentials'}
              </button>
            </>
          )}
        </div>
      </Modal>

      <Modal
        title="Reset Login Password"
        open={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        onSubmit={() => void doResetLoginPassword()}
        submitting={resetSubmitting}
        submitLabel="Reset Password"
      >
        <p style={{ marginBottom: '0.85rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Reset the login password for{' '}
          <strong>{resetTarget ? `${resetTarget.full_name} (${resetTarget.employee_code})` : ''}</strong>.
          Existing sessions will be revoked and the new password will be shown to you only once.
        </p>
        <div className="form-group">
          <label className="form-label">New Temporary Password</label>
          <input
            type="text"
            className="form-control-clay"
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
            placeholder="Leave blank to generate a secure password"
            autoComplete="new-password"
          />
          <div className="form-help-text">
            Optional — 8 to 72 characters. If left blank, a secure password is generated.
          </div>
        </div>
        <div className="form-group">
          <label className="form-label form-inline-flex" style={{ gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={resetForceChange}
              onChange={(e) => setResetForceChange(e.target.checked)}
            />
            Force password change on next login
          </label>
        </div>
        {resetFormError && <div className="form-error-text">{resetFormError}</div>}
      </Modal>

      <ProtectedDeleteModal
        title="Delete Employee"
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        submitting={submitting}
        message={
          <p>
            Are you sure you want to delete <strong>{deleteTarget?.full_name}</strong> (
            {deleteTarget?.employee_code})? This action cannot be undone.
          </p>
        }
      />
    </div>
  );
}
