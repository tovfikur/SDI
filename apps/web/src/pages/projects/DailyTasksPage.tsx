import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import { attendance, files, hr, projects } from '../../api';
import type { WorkLogRow, WorkLogSummary } from '../../api';
import { Modal } from '../../components/Modal';
import { ProtectedDeleteModal } from '../../components/ProtectedDeleteModal';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { useCurrentUser } from '../../auth-context';
import { downloadCsv, exportExcel, printReportWindow, printWorklogSummaryReport } from '../../utils/export';
import { formatLateDuration } from '../../utils/time';
import { Icon, Icons } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

interface Project {
  id: string;
  name: string;
}

interface TaskRow {
  id: string;
  title: string;
  project_id: string | null;
}

const PER_PAGE_OPTIONS = [10, 25, 50, 100];

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const EMPTY_FILTERS = { employeeId: '', projectId: '', status: '', dateFrom: '', dateTo: '' };

const formatDate = (d: string | null | undefined): string =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString() : '—';

const formatDateTime = (d: string | null | undefined): string =>
  d ? new Date(d).toLocaleString() : '—';

export function DailyTasksPage(): ReactElement {
  const user = useCurrentUser();
  const { toast } = useToast();

  const isApprover = Boolean(
    user && (user.isSuperAdmin || user.permissions?.includes('pm.daily_task.approve'))
  );
  const canSelfManage = Boolean(
    user && (user.isSuperAdmin || user.permissions?.includes('pm.daily_task.manage'))
  );
  const lockedEmployeeId = !isApprover ? (user?.employeeId ?? '') : '';
  const canCreate = isApprover || canSelfManage;

  const [rows, setRows] = useState<WorkLogRow[]>([]);
  const [summary, setSummary] = useState<WorkLogSummary>({
    today_hours: 0,
    week_hours: 0,
    pending: 0,
    approved: 0,
  });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [taskList, setTaskList] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkLogRow | null>(null);
  const [viewTarget, setViewTarget] = useState<WorkLogRow | null>(null);
  const [attachments, setAttachments] = useState<Array<{ id: string; filename: string }>>([]);
  const [form, setForm] = useState({
    employee_id: '',
    project_id: '',
    task_id: '',
    work_date: '',
    hours: '',
    work_description: '',
    attachment_ids: [] as string[],
  });
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WorkLogRow | null>(null);
  const [submitTargets, setSubmitTargets] = useState<WorkLogRow[] | null>(null);
  const [approveTargets, setApproveTargets] = useState<WorkLogRow[] | null>(null);
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject'>('approve');
  const [rejectionReason, setRejectionReason] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'excel' | 'print' | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    void (async () => {
      try {
        const [e, p, t] = await Promise.all([
          hr.employees({ perPage: 100 }),
          projects.list({ perPage: 100 }),
          projects.tasks({ perPage: 100 }),
        ]);
        setEmployees((e.data as { items: Employee[] }).items ?? []);
        setProjectList((p.data as { items: Project[] }).items ?? []);
        setTaskList((t.data as { items: TaskRow[] }).items ?? []);
      } catch {
        /* lookups are optional */
      }
    })();
  }, []);

  const buildParams = useCallback(
    (pageNum: number, per: number): Record<string, string | number> => {
      const params: Record<string, string | number> = { page: pageNum, perPage: per };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filters.employeeId) params['filter[employee_id]'] = `eq:${filters.employeeId}`;
      if (filters.projectId) params['filter[project_id]'] = `eq:${filters.projectId}`;
      if (filters.status) params['filter[status]'] = `eq:${filters.status}`;
      if (filters.dateFrom) params['filter[work_date]'] = `gte:${filters.dateFrom}`;
      if (filters.dateTo) params['filter[work_date]'] = `lte:${filters.dateTo}`;
      return params;
    },
    [debouncedSearch, filters]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await projects.dailyTasks(buildParams(page, perPage));
      setRows(res.data.items ?? []);
      setTotal(res.data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load work logs');
    } finally {
      setLoading(false);
    }
  }, [buildParams, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadSummary = useCallback(async () => {
    try {
      const res = await projects.dailyTasksSummary();
      setSummary(res.data);
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary, rows.length === 0]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const applyFilters = () => {
    if (draftFilters.dateFrom && draftFilters.dateTo && draftFilters.dateFrom > draftFilters.dateTo) {
      toast('Date From cannot be later than Date To', 'error');
      return;
    }
    setFilters(draftFilters);
    setPage(1);
    setFilterOpen(false);
  };

  const resetFilters = () => {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
    setFilterOpen(false);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOnPage = rows.every((r) => next.has(r.id));
      if (allOnPage) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      employee_id: lockedEmployeeId,
      project_id: '',
      task_id: '',
      work_date: new Date().toISOString().slice(0, 10),
      hours: '',
      work_description: '',
      attachment_ids: [],
    });
    setAttachments([]);
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (row: WorkLogRow) => {
    setEditing(row);
    setForm({
      employee_id: row.employee_id,
      project_id: row.project_id ?? '',
      task_id: row.task_id ?? '',
      work_date: row.work_date.slice(0, 10),
      hours: row.hours,
      work_description: row.work_description,
      attachment_ids: Array.isArray(row.attachment_ids) ? row.attachment_ids : [],
    });
    setAttachments([]);
    setFormError('');
    setModalOpen(true);
  };

  const canEditRow = (row: WorkLogRow): boolean => {
    if (user?.isSuperAdmin) return true;
    if (isApprover) return row.status !== 'approved';
    return canSelfManage && (row.status === 'draft' || row.status === 'rejected');
  };

  const canDeleteRow = canEditRow;

  const canSubmitRow = (row: WorkLogRow): boolean =>
    !isApprover && canSelfManage && (row.status === 'draft' || row.status === 'rejected');

  const canApproveRow = (row: WorkLogRow): boolean =>
    isApprover && (row.status === 'draft' || row.status === 'submitted') && row.employee_id !== lockedEmployeeId;

  const validateForm = (): string => {
    if (!form.employee_id) return 'Employee is required.';
    if (!form.work_date) return 'Work date is required.';
    const hours = Number(form.hours);
    if (form.hours !== '' && (Number.isNaN(hours) || hours < 0 || hours > 24)) {
      return 'Hours must be a number between 0 and 24.';
    }
    if (!form.work_description.trim()) return 'Work description is required.';
    return '';
  };

  const save = async () => {
    const validation = validateForm();
    if (validation) {
      setFormError(validation);
      return;
    }
    setSubmitting(true);
    setFormError('');
    const body = {
      employee_id: form.employee_id,
      project_id: form.project_id || null,
      task_id: form.task_id || null,
      work_date: form.work_date,
      hours: form.hours === '' ? 0 : Number(form.hours),
      work_description: form.work_description.trim(),
      attachment_ids: form.attachment_ids,
    };
    try {
      if (editing) {
        await projects.updateDailyTask(editing.id, body);
      } else {
        await projects.createDailyTask(body);
      }
      setModalOpen(false);
      toast(editing ? 'Work log updated' : 'Work log created', 'success');
      await load();
      await loadSummary();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save work log');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files ?? []);
    if (fileList.length === 0) return;
    setUploading(true);
    try {
      for (const f of fileList) {
        const sess = await files.createUploadSession({
          module: 'worklog',
          entity_type: 'daily_task',
          original_filename: f.name,
          mime_type: f.type || 'application/octet-stream',
          size_bytes: f.size,
        });
        await fetch(sess.upload_url, { method: 'PUT', body: f });
        const confirmed = await files.confirmUpload(sess.session_id);
        const id = confirmed.data.id;
        setForm((prev) => ({
          ...prev,
          attachment_ids: [...prev.attachment_ids, id],
        }));
        setAttachments((prev) => [...prev, { id, filename: confirmed.data.original_filename }]);
      }
      toast(`${fileList.length} attachment(s) uploaded`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Attachment upload failed', 'error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setForm((prev) => ({
      ...prev,
      attachment_ids: prev.attachment_ids.filter((x) => x !== id),
    }));
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const openAttachment = async (id: string) => {
    try {
      const res = await files.fileDownload(id);
      window.open(res.data.url, '_blank');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to open attachment', 'error');
    }
  };

  const doSubmit = async () => {
    if (!submitTargets) return;
    setSubmitting(true);
    try {
      const res = await projects.submitDailyTasks(submitTargets.map((r) => r.id));
      const updated = (res as { updated?: number }).updated ?? submitTargets.length;
      setSubmitTargets(null);
      toast(`${updated} log${updated === 1 ? '' : 's'} submitted for approval`, 'success');
      await load();
      await loadSummary();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Submission failed', 'error');
      setSubmitTargets(null);
    } finally {
      setSubmitting(false);
    }
  };

  const doApprove = async () => {
    if (!approveTargets) return;
    if (approvalAction === 'reject' && rejectionReason.trim().length === 0) {
      toast('Rejection reason is required', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await projects.approveDailyTasks(
        approveTargets.map((r) => r.id),
        approvalAction,
        approvalAction === 'reject' ? rejectionReason : ''
      );
      const updated = (res as { updated?: number }).updated ?? approveTargets.length;
      setApproveTargets(null);
      setRejectionReason('');
      setSelected(new Set());
      toast(
        `${updated} log${updated === 1 ? '' : 's'} ${approvalAction === 'approve' ? 'approved' : 'rejected'}`,
        'success'
      );
      await load();
      await loadSummary();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Approval failed', 'error');
      setApproveTargets(null);
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (deletePassword: string) => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await projects.removeDailyTask(deleteTarget.id, deletePassword);
      setDeleteTarget(null);
      toast('Work log deleted', 'success');
      await load();
      await loadSummary();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to delete work log', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const exportColumns = [
    { key: 'employee', header: 'Employee' },
    { key: 'project', header: 'Project' },
    { key: 'task', header: 'Task' },
    { key: 'date', header: 'Work Date' },
    { key: 'hours', header: 'Hours' },
    { key: 'description', header: 'Description' },
    { key: 'status', header: 'Status' },
    { key: 'submitted', header: 'Submitted At' },
    { key: 'reviewed', header: 'Reviewed By' },
  ];

  const filterSummaryText = (): string => {
    const parts: string[] = [];
    if (filters.employeeId) {
      const e = employees.find((x) => x.id === filters.employeeId);
      if (e) parts.push(`Employee: ${e.full_name}`);
    }
    if (filters.projectId) {
      const p = projectList.find((x) => x.id === filters.projectId);
      if (p) parts.push(`Project: ${p.name}`);
    }
    if (filters.status) parts.push(`Status: ${filters.status}`);
    if (filters.dateFrom) parts.push(`From: ${formatDate(filters.dateFrom)}`);
    if (filters.dateTo) parts.push(`To: ${formatDate(filters.dateTo)}`);
    if (debouncedSearch) parts.push(`Search: "${debouncedSearch}"`);
    return parts.length > 0 ? parts.join(' | ') : 'All work logs';
  };

  const handleExport = async (kind: 'csv' | 'excel' | 'print') => {
    setExporting(kind);
    try {
      const collected: WorkLogRow[] = [];
      let p = 1;
      let fetched = 0;
      const pp = 100;
      do {
        const res = await projects.dailyTasks(buildParams(p, pp));
        collected.push(...(res.data.items ?? []));
        fetched = res.data.items?.length ?? 0;
        p += 1;
      } while (fetched === pp);
      const mapped = collected.map((r) => ({
        employee: `${r.full_name} (${r.employee_code})`,
        project: r.project_name ?? '—',
        task: r.task_name ?? '—',
        date: formatDate(r.work_date),
        hours: r.hours,
        description: r.work_description || '—',
        status: r.status,
        submitted: formatDateTime(r.submitted_at),
        reviewed: r.status === 'approved' ? r.approved_by_name ?? r.approved_by ?? '—' : r.status === 'rejected' ? r.rejected_by_name ?? r.rejected_by ?? '—' : '—',
      }));
      if (kind === 'csv') {
        downloadCsv('work-log.csv', mapped, exportColumns);
      } else if (kind === 'excel') {
        exportExcel('work-log.xls', mapped, exportColumns);
      } else {
        printReportWindow(
          'Daily Work Log',
          [
            'Self Development Initiative',
            `Generated: ${new Date().toLocaleString()}`,
            `Filters: ${filterSummaryText()}`,
          ],
          mapped,
          exportColumns
        );
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed', 'error');
    } finally {
      setExporting(null);
    }
  };

  const handlePrintSummaryReport = async () => {
    setExporting('print');
    try {
      const targetEmpId = filters.employeeId || lockedEmployeeId || (employees[0]?.id ?? '');
      if (!targetEmpId) {
        toast('Please select an employee to generate the worklog summary report.', 'error');
        setExporting(null);
        return;
      }
      const now = new Date();
      const curMonth = now.toISOString().slice(0, 7);
      const dFrom = filters.dateFrom || `${curMonth}-01`;
      const dTo = filters.dateTo || now.toISOString().slice(0, 10);

      // Load employee details
      let empName = '';
      let empCode = '';
      let empDept = '';
      let empBranch = '';
      let empDesignation = '';
      try {
        const empRes = await hr.employee(targetEmpId);
        const emp = empRes.data as Record<string, unknown>;
        empName = String(emp.full_name || '');
        empCode = String(emp.employee_code || '');
        empDept = String(emp.department_name || '');
        empBranch = String(emp.branch_name || '');
        empDesignation = String(emp.position_name || '');
      } catch {
        const fallback = employees.find((e) => e.id === targetEmpId);
        if (fallback) {
          empName = fallback.full_name;
          empCode = fallback.employee_code;
        }
      }

      // Load attendance events for the period
      let attEvents: Record<string, unknown>[] = [];
      try {
        const attRes = await attendance.events({
          'filter[employee_id]': targetEmpId,
          'filter[work_date]': `${dFrom}..${dTo}`,
          perPage: 100,
        });
        attEvents = ((attRes.data as { items: Record<string, unknown>[] }).items ?? []) as Record<string, unknown>[];
      } catch {
        /* optional */
      }

      // Compute days in period
      const startMs = new Date(dFrom).getTime();
      const endMs = new Date(dTo).getTime();
      const totalDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);

      let workedDays = 0;
      let lateCount = 0;
      let totalLateMinutes = 0;
      let offDayDutyDays = 0;
      let outsideGeofenceDays = 0;
      let leaveDays = 0;
      let absentDays = 0;

      for (const ev of attEvents) {
        const st = String(ev.status || '').toLowerCase();
        const lMin = Number(ev.late_minutes || 0);
        if (st === 'present') {
          workedDays++;
        } else if (st === 'late') {
          workedDays++;
          lateCount++;
          totalLateMinutes += lMin;
        } else if (st.includes('holidaypresent') || st.includes('restdaypresent')) {
          workedDays++;
          offDayDutyDays++;
        } else if (st.includes('leave')) {
          leaveDays++;
        } else if (st === 'absent' || st === 'missing') {
          absentDays++;
        }
        if (ev.outside_geofence || ev.geofence_status === 'outside') {
          outsideGeofenceDays++;
        }
      }

      // Load worklogs
      const wlRes = await projects.dailyTasks({
        employeeId: targetEmpId,
        dateFrom: dFrom,
        dateTo: dTo,
        perPage: 100,
      });
      const worklogs = (wlRes.data.items ?? []).map((w) => ({
        date: formatDate(w.work_date),
        project: w.project_name ?? '—',
        task: w.task_name ?? '—',
        description: w.work_description || '—',
        hours: w.hours,
        status: w.status,
        feedback: (w.status === 'approved' ? w.approved_by_name : w.status === 'rejected' ? w.rejected_by_name : '') || '',
      }));

      printWorklogSummaryReport({
        employee: {
          name: empName || 'Employee',
          code: empCode,
          department: empDept,
          branch: empBranch,
          designation: empDesignation,
        },
        period: { from: dFrom, to: dTo },
        attendanceSummary: {
          totalDays,
          workedDays,
          lateCount,
          lateDuration: formatLateDuration(totalLateMinutes),
          offDayDutyDays,
          outsideGeofenceDays,
          leaveDays,
          absentDays,
        },
        worklogs,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to generate summary report', 'error');
    } finally {
      setExporting(null);
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

  const shownStart = total === 0 ? 0 : (page - 1) * perPage + 1;
  const shownEnd = Math.min(page * perPage, total);
  const selectedSubmitable = rows.filter((r) => selected.has(r.id) && canSubmitRow(r));
  const selectedActionable = rows.filter((r) => selected.has(r.id) && canApproveRow(r));

  const columns = [
    { key: 'full_name', header: 'Employee' },
    { key: 'project_name', header: 'Project' },
    { key: 'work_date', header: 'Work Date' },
    { key: 'hours', header: 'Hours' },
    { key: 'work_description', header: 'Description' },
    { key: 'status', header: 'Status', align: 'center' as const },
    { key: 'actions', header: 'Action', align: 'center' as const },
  ];

  const availableTasks = form.project_id
    ? taskList.filter((t) => t.project_id === form.project_id)
    : taskList;

  const actionButtons = (row: WorkLogRow) => {
    const showSubmit = canSubmitRow(row);
    const showApprove = canApproveRow(row);
    const showEdit = canEditRow(row);
    const showDelete = canDeleteRow(row);
    if (!showSubmit && !showApprove && !showEdit && !showDelete) return null;
    return (
      <div className="data-table-actions">
        <button className="icon-btn" title="View" onClick={() => void showDetail(row)}>
          <Icon icon={Icons.View} />
        </button>
        {showSubmit && (
          <button
            className="icon-btn icon-btn-info"
            title="Submit for Approval"
            onClick={() => setSubmitTargets([row])}
          >
            <Icon icon={Icons.PaperPlane} />
          </button>
        )}
        {showApprove && (
          <>
            <button
              className="icon-btn icon-btn-success"
              title="Approve"
              onClick={() => {
                setApprovalAction('approve');
                setRejectionReason('');
                setApproveTargets([row]);
              }}
            >
              <Icon icon={Icons.Check} />
            </button>
            <button
              className="icon-btn icon-btn-danger"
              title="Reject"
              onClick={() => {
                setApprovalAction('reject');
                setRejectionReason('');
                setApproveTargets([row]);
              }}
            >
              <Icon icon={Icons.Close} />
            </button>
          </>
        )}
        {showEdit && (
          <button className="icon-btn" title="Edit" onClick={() => openEdit(row)}>
            <Icon icon={Icons.Edit} />
          </button>
        )}
        {showDelete && (
          <button
            className="icon-btn icon-btn-danger"
            title="Delete"
            onClick={() => setDeleteTarget(row)}
          >
            <Icon icon={Icons.Trash} />
          </button>
        )}
      </div>
    );
  };

  const showDetail = async (row: WorkLogRow) => {
    setViewTarget(row);
    if (Array.isArray(row.attachment_ids) && row.attachment_ids.length > 0) {
      try {
        const names = await Promise.all(
          row.attachment_ids.map(async (id) => {
            try {
              const res = await files.fileDownload(id);
              return { id, filename: res.data.filename };
            } catch {
              return { id, filename: `attachment-${id.slice(0, 8)}` };
            }
          })
        );
        setAttachments(names);
      } catch {
        setAttachments([]);
      }
    } else {
      setAttachments([]);
    }
  };

  const statCards = [
    {
      label: 'Today Logged Hours',
      value: Number(summary.today_hours ?? 0).toFixed(2),
      icon: Icons.Clock,
      cls: 'badge-clay-info',
    },
    {
      label: 'This Week Hours',
      value: Number(summary.week_hours ?? 0).toFixed(2),
      icon: Icons.CalendarDays,
      cls: 'badge-clay',
    },
    {
      label: 'Pending Approval',
      value: summary.pending ?? 0,
      icon: Icons.Hourglass,
      cls: 'badge-clay-warning',
    },
    {
      label: 'Approved',
      value: summary.approved ?? 0,
      icon: Icons.Check,
      cls: 'badge-clay-success',
    },
  ];

  return (
    <div className="report-page">
      <PageHeader
        title="Daily Work Log"
        subtitle="Log daily work hours, submit for approval, and review team entries."
        actions={
          canCreate && (
            <button className="btn-clay btn-clay-primary" onClick={openCreate}>
              + Add Work Log
            </button>
          )
        }
      />

      <div className="stats-grid">
        {statCards.map((s) => (
          <div key={s.label} className="stat-card-clay">
            <div>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value">{s.value}</div>
            </div>
            <span className={`badge-clay ${s.cls}`}>
              <Icon icon={s.icon} />
            </span>
          </div>
        ))}
      </div>

      <div className="activity-toolbar">
        <div className="activity-toolbar-left">
          <button className="btn-clay btn-clay-secondary" onClick={() => setFilterOpen(true)}>
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
          {activeFilterCount > 0 && (
            <button className="btn-clay btn-clay-secondary" onClick={resetFilters}>
              Reset
            </button>
          )}
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
        </div>
        <div className="activity-toolbar-right">
          <input
            className="search-input-clay"
            placeholder="Search employee, description, project, task..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="activity-export-group">
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              disabled={exporting !== null}
              onClick={() => handleExport('csv')}
            >
              {exporting === 'csv' ? 'Exporting...' : 'CSV'}
            </button>
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              disabled={exporting !== null}
              onClick={() => handleExport('excel')}
            >
              {exporting === 'excel' ? 'Exporting...' : 'Excel'}
            </button>
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              disabled={exporting !== null}
              onClick={() => handleExport('print')}
            >
              {exporting === 'print' ? 'Preparing...' : 'PDF'}
            </button>
            <button
              className="btn-clay btn-clay-secondary btn-clay-sm"
              disabled={exporting !== null}
              onClick={() => handleExport('print')}
            >
              {exporting === 'print' ? 'Preparing...' : 'Print'}
            </button>
            <button
              className="btn-clay btn-clay-primary btn-clay-sm"
              disabled={exporting !== null}
              onClick={handlePrintSummaryReport}
              title="Download single-page worklog & monthly attendance summary report"
            >
              <Icon icon={Icons.Print} size="xs" /> Worklog Summary Report
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="panel-clay report-state-panel">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon icon={Icons.Warning} />
            </div>
            <div className="empty-state-title">Could not load work logs</div>
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
        <>
          <div className="data-table-clay">
            <div className="daily-task-list-header">
              <div className="daily-task-list-title">Work Log Entries</div>
              <div className="daily-task-list-actions">
                {selectedSubmitable.length > 0 && (
                  <button
                    className="btn-clay btn-clay-primary btn-clay-sm"
                    disabled={submitting}
                    onClick={() => setSubmitTargets(selectedSubmitable)}
                  >
                    Submit Selected ({selectedSubmitable.length})
                  </button>
                )}
                {selectedActionable.length > 0 && isApprover && (
                  <>
                    <button
                      className="btn-clay btn-clay-secondary btn-clay-sm"
                      disabled={submitting}
                      onClick={() => {
                        setApprovalAction('approve');
                        setRejectionReason('');
                        setApproveTargets(selectedActionable);
                      }}
                    >
                      Approve Selected ({selectedActionable.length})
                    </button>
                    <button
                      className="btn-clay btn-clay-danger btn-clay-sm"
                      disabled={submitting}
                      onClick={() => {
                        setApprovalAction('reject');
                        setRejectionReason('');
                        setApproveTargets(selectedActionable);
                      }}
                    >
                      Reject Selected ({selectedActionable.length})
                    </button>
                  </>
                )}
                {canCreate && (
                  <button className="btn-clay btn-clay-primary btn-clay-sm" onClick={openCreate}>
                    + Add Work Log
                  </button>
                )}
              </div>
            </div>
            <div className="report-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 36, textAlign: 'center' }}>
                      {(isApprover || selectedSubmitable.length > 0 || selectedActionable.length > 0) && (
                        <input
                          type="checkbox"
                          checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                          onChange={toggleSelectAll}
                        />
                      )}
                    </th>
                    <th style={{ width: 48, textAlign: 'center' }}>SL</th>
                    {columns.map((col) => (
                      <th key={col.key} style={{ textAlign: col.align ?? 'left' }}>
                        {col.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={`sk-${i}`}>
                        {Array.from({ length: columns.length + 2 }).map((_, j) => (
                          <td key={j} className="skeleton-cell">
                            <div
                              className="skeleton skeleton-line"
                              style={{ width: `${55 + ((i * 13 + j * 7) % 40)}%` }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 2} className="data-table-state">
                        <div className="empty-state">
                          <div className="empty-state-icon">
                            <Icon icon={Icons.FolderOpen} />
                          </div>
                          <div className="empty-state-title">
                            {activeFilterCount > 0 || debouncedSearch
                              ? 'No work logs match the selected filters.'
                              : 'No work logs recorded.'}
                          </div>
                          {activeFilterCount > 0 || debouncedSearch ? (
                            <button className="btn-clay btn-clay-secondary" onClick={resetFilters}>
                              Reset Filters
                            </button>
                          ) : canCreate ? (
                            <button className="btn-clay btn-clay-secondary" onClick={openCreate}>
                              Add Work Log
                            </button>
                          ) : (
                            <div className="empty-state-hint">
                              Logs you create will appear here.
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, idx) => (
                      <tr key={row.id}>
                        <td style={{ textAlign: 'center' }}>
                          {(isApprover || canSubmitRow(row)) && (
                            <input
                              type="checkbox"
                              checked={selected.has(row.id)}
                              onChange={() => toggleSelect(row.id)}
                            />
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>{(page - 1) * perPage + idx + 1}</td>
                        <td>
                          <strong>{row.full_name}</strong>
                          <div className="daily-task-subline">{row.employee_code}</div>
                        </td>
                        <td>{row.project_name ?? '—'}</td>
                        <td>{formatDate(row.work_date)}</td>
                        <td style={{ textAlign: 'center' }}>{row.hours}</td>
                        <td>
                          <span className="daily-task-desc" title={row.work_description || ''}>
                            {row.work_description || '—'}
                          </span>
                          {row.task_name && <div className="daily-task-subline">{row.task_name}</div>}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <StatusBadge value={row.status} />
                        </td>
                        <td style={{ textAlign: 'center' }}>{actionButtons(row)}</td>
                      </tr>
                    ))
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
                  disabled={page <= 1 || loading}
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
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {!loading && (
            <div className="daily-mobile-cards">
              {rows.map((row, idx) => (
                <div key={row.id} className="report-card">
                  <div className="report-card-head">
                    <span className="report-card-name">
                      {row.full_name} <span className="daily-task-subline">{row.employee_code}</span>
                    </span>
                    <StatusBadge value={row.status} />
                  </div>
                  <div className="report-card-row">
                    <span>{row.project_name ?? '—'}</span>
                    <span>
                      {formatDate(row.work_date)} · {row.hours}h
                    </span>
                  </div>
                  <div className="daily-card-desc">{row.work_description || '—'}</div>
                  {row.task_name && <div className="daily-task-subline">{row.task_name}</div>}
                  <div className="report-card-meta">
                    <span>#{idx + 1 + (page - 1) * perPage}</span>
                    <span className="daily-card-actions">
                      <button
                        className="icon-btn"
                        title="View"
                        onClick={() => void showDetail(row)}
                      >
                        <Icon icon={Icons.View} />
                      </button>
                      {canSubmitRow(row) && (
                        <button
                          className="icon-btn icon-btn-info"
                          title="Submit for Approval"
                          onClick={() => setSubmitTargets([row])}
                        >
                          <Icon icon={Icons.PaperPlane} />
                        </button>
                      )}
                      {canApproveRow(row) && (
                        <>
                          <button
                            className="icon-btn icon-btn-success"
                            title="Approve"
                            onClick={() => {
                              setApprovalAction('approve');
                              setRejectionReason('');
                              setApproveTargets([row]);
                            }}
                          >
                            <Icon icon={Icons.Check} />
                          </button>
                          <button
                            className="icon-btn icon-btn-danger"
                            title="Reject"
                            onClick={() => {
                              setApprovalAction('reject');
                              setRejectionReason('');
                              setApproveTargets([row]);
                            }}
                          >
                            <Icon icon={Icons.Close} />
                          </button>
                        </>
                      )}
                      {canEditRow(row) && (
                        <button className="icon-btn" title="Edit" onClick={() => openEdit(row)}>
                          <Icon icon={Icons.Edit} />
                        </button>
                      )}
                      {canDeleteRow(row) && (
                        <button
                          className="icon-btn icon-btn-danger"
                          title="Delete"
                          onClick={() => setDeleteTarget(row)}
                        >
                          <Icon icon={Icons.Trash} />
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              ))}
              {rows.length === 0 && (
                <div className="panel-clay report-state-panel">
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <Icon icon={Icons.FolderOpen} />
                    </div>
                    <div className="empty-state-title">
                      {activeFilterCount > 0 || debouncedSearch
                        ? 'No work logs match the selected filters.'
                        : 'No work logs recorded.'}
                    </div>
                    {activeFilterCount > 0 || debouncedSearch ? (
                      <button className="btn-clay btn-clay-secondary" onClick={resetFilters}>
                        Reset Filters
                      </button>
                    ) : (
                      canCreate && (
                        <button className="btn-clay btn-clay-secondary" onClick={openCreate}>
                          Add Work Log
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Modal
        title={editing ? 'Edit Work Log' : 'Add Work Log'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        submitting={submitting || uploading}
        submitLabel={editing ? 'Update' : 'Create'}
        busyLabel={editing ? 'Updating...' : 'Creating...'}
        wide
      >
        <div className="form-group">
          <label className="form-label">
            Employee <span className="form-required">*</span>
          </label>
          {lockedEmployeeId && !editing ? (
            <input
              className="form-control-clay"
              value={
                employees.find((e) => e.id === lockedEmployeeId)?.full_name ??
                lockedEmployeeId
              }
              disabled
            />
          ) : (
            <select
              className="form-control-clay"
              value={form.employee_id}
              disabled={Boolean(lockedEmployeeId)}
              onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
            >
              <option value="">—</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name} ({e.employee_code})
                </option>
              ))}
            </select>
          )}
          {lockedEmployeeId && (
            <div className="form-hint">Employee is set from your account for self-service.</div>
          )}
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Work Date <span className="form-required">*</span>
            </label>
            <input
              type="date"
              className="form-control-clay"
              value={form.work_date}
              onChange={(e) => setForm({ ...form, work_date: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Hours</label>
            <input
              type="number"
              min="0"
              max="24"
              step="0.5"
              className="form-control-clay"
              placeholder="0"
              value={form.hours}
              onChange={(e) => setForm({ ...form, hours: e.target.value })}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Project</label>
            <select
              className="form-control-clay"
              value={form.project_id}
              onChange={(e) => {
                const projectId = e.target.value;
                setForm((f) => ({
                  ...f,
                  project_id: projectId,
                  task_id: '',
                }));
              }}
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
            <label className="form-label">Related Task</label>
            <select
              className="form-control-clay"
              value={form.task_id}
              disabled={!form.project_id}
              onChange={(e) => setForm({ ...form, task_id: e.target.value })}
            >
              <option value="">{form.project_id ? '—' : 'Select a project first'}</option>
              {availableTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">
            Work Description / Accomplishments <span className="form-required">*</span>
          </label>
          <textarea
            className="form-control-clay"
            rows={4}
            placeholder="What was worked on, deliverables, accomplishments..."
            value={form.work_description}
            onChange={(e) => setForm({ ...form, work_description: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Attachment(s)</label>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="form-control-clay"
            onChange={(e) => void handleFiles(e)}
          />
          {uploading && <div className="form-hint">Uploading attachment(s)...</div>}
          {form.attachment_ids.length > 0 && (
            <div className="worklog-attachment-list">
              {form.attachment_ids.map((id) => {
                const known = attachments.find((a) => a.id === id);
                return (
                  <span key={id} className="worklog-attachment-chip">
                    <Icon icon={Icons.Paperclip} size="xs" />
                    {known?.filename ?? `attachment-${id.slice(0, 8)}`}
                    <button
                      className="worklog-attachment-remove"
                      aria-label="Remove attachment"
                      onClick={() => removeAttachment(id)}
                    >
                      <Icon icon={Icons.Close} size="xs" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
        {formError && <div className="form-error-text">{formError}</div>}
      </Modal>

      <Modal
        title="Work Log Details"
        open={viewTarget !== null}
        onClose={() => setViewTarget(null)}
        wide
      >
        {viewTarget && (
          <div className="detail-list">
            <div className="detail-row">
              <span className="detail-label">Employee</span>
              <span className="detail-value">
                {viewTarget.full_name} ({viewTarget.employee_code})
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Project</span>
              <span className="detail-value">{viewTarget.project_name ?? '—'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Related Task</span>
              <span className="detail-value">{viewTarget.task_name ?? '—'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Work Date</span>
              <span className="detail-value">{formatDate(viewTarget.work_date)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Hours</span>
              <span className="detail-value">{viewTarget.hours}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Description</span>
              <span className="detail-value">{viewTarget.work_description || '—'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Status</span>
              <span className="detail-value">
                <StatusBadge value={viewTarget.status} />
              </span>
            </div>
            {viewTarget.submitted_at && (
              <div className="detail-row">
                <span className="detail-label">Submitted At</span>
                <span className="detail-value">{formatDateTime(viewTarget.submitted_at)}</span>
              </div>
            )}
            {viewTarget.status === 'approved' && (
              <div className="detail-row">
                <span className="detail-label">Approved By / At</span>
                <span className="detail-value">
                  {viewTarget.approved_by_name ?? viewTarget.approved_by ?? '—'} ·{' '}
                  {formatDateTime(viewTarget.approved_at)}
                </span>
              </div>
            )}
            {viewTarget.status === 'rejected' && (
              <>
                <div className="detail-row">
                  <span className="detail-label">Rejected By / At</span>
                  <span className="detail-value">
                    {viewTarget.rejected_by_name ?? viewTarget.rejected_by ?? '—'} ·{' '}
                    {formatDateTime(viewTarget.rejected_at)}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Rejection Reason</span>
                  <span className="detail-value">{viewTarget.rejection_reason || '—'}</span>
                </div>
              </>
            )}
            {Array.isArray(viewTarget.attachment_ids) && viewTarget.attachment_ids.length > 0 && (
              <div className="detail-row">
                <span className="detail-label">Attachments</span>
                <span className="detail-value">
                  <div className="worklog-attachment-list">
                    {viewTarget.attachment_ids.map((id) => {
                      const known = attachments.find((a) => a.id === id);
                      return (
                        <button
                          key={id}
                          className="worklog-attachment-chip worklog-attachment-link"
                          onClick={() => void openAttachment(id)}
                        >
                          <Icon icon={Icons.Paperclip} size="xs" />
                          {known?.filename ?? `attachment-${id.slice(0, 8)}`}
                        </button>
                      );
                    })}
                  </div>
                </span>
              </div>
            )}
            <div className="detail-row">
              <span className="detail-label">Created</span>
              <span className="detail-value">{formatDateTime(viewTarget.created_at)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Last Updated</span>
              <span className="detail-value">{formatDateTime(viewTarget.updated_at)}</span>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title="Submit for Approval"
        open={submitTargets !== null}
        onClose={() => setSubmitTargets(null)}
        onSubmit={doSubmit}
        submitting={submitting}
        submitLabel="Submit"
        busyLabel="Submitting..."
      >
        <p>
          You are submitting {submitTargets?.length ?? 0} work log entry/entries for approval.
          Once submitted, logs can no longer be edited until reviewed.
        </p>
      </Modal>

      <Modal
        title={
          approveTargets === null
            ? ''
            : approvalAction === 'approve'
              ? approveTargets.length === 1
                ? 'Confirm Approval'
                : 'Confirm Bulk Approval'
              : approveTargets.length === 1
                ? 'Reject Work Log'
                : 'Reject Selected Work Logs'
        }
        open={approveTargets !== null}
        onClose={() => {
          setApproveTargets(null);
          setRejectionReason('');
        }}
        onSubmit={doApprove}
        submitting={submitting}
        submitLabel={approvalAction === 'approve' ? 'Approve' : 'Reject'}
        busyLabel={approvalAction === 'approve' ? 'Approving...' : 'Rejecting...'}
        danger={approvalAction === 'reject'}
      >
        <p>
          {approvalAction === 'approve'
            ? `Approve ${approveTargets?.length ?? 0} work log entry/entries?`
            : `You have selected ${approveTargets?.length ?? 0} work log entry/entries to reject.`}
        </p>
        {approvalAction === 'reject' ? (
          <div className="form-group" style={{ marginTop: '0.6rem' }}>
            <label className="form-label">
              Rejection Reason <span className="form-required">*</span>
            </label>
            <textarea
              className="form-control-clay"
              rows={3}
              placeholder="Explain why the log is being rejected..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
            {rejectionReason.trim().length === 0 && (
              <div className="form-hint">A rejection reason is required.</div>
            )}
          </div>
        ) : (
          <p className="form-hint">
            Only draft and submitted entries will be approved; already reviewed entries are
            skipped.
          </p>
        )}
      </Modal>

      <ProtectedDeleteModal
        title="Delete Work Log"
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        submitting={submitting}
        message={<p>Are you sure you want to delete this work log entry?</p>}
      />

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
                <div className="modal-title-clay">Filter Work Logs</div>
                <button className="modal-close-btn" onClick={() => setFilterOpen(false)}>
                  <Icon icon={Icons.Close} />
                </button>
              </div>
              <div className="modal-body-clay">
                {isApprover && (
                  <div className="form-group">
                    <label className="form-label">Employee</label>
                    <select
                      className="form-control-clay"
                      value={draftFilters.employeeId}
                      onChange={(e) =>
                        setDraftFilters((f) => ({ ...f, employeeId: e.target.value }))
                      }
                    >
                      <option value="">All employees</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.full_name} ({e.employee_code})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Project</label>
                  <select
                    className="form-control-clay"
                    value={draftFilters.projectId}
                    onChange={(e) =>
                      setDraftFilters((f) => ({ ...f, projectId: e.target.value }))
                    }
                  >
                    <option value="">All projects</option>
                    {projectList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select
                    className="form-control-clay"
                    value={draftFilters.status}
                    onChange={(e) =>
                      setDraftFilters((f) => ({ ...f, status: e.target.value }))
                    }
                  >
                    <option value="">All statuses</option>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Date From</label>
                    <input
                      type="date"
                      className="form-control-clay"
                      value={draftFilters.dateFrom}
                      onChange={(e) =>
                        setDraftFilters((f) => ({ ...f, dateFrom: e.target.value }))
                      }
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
              </div>
              <div className="modal-footer-clay">
                <button className="btn-clay btn-clay-secondary" onClick={resetFilters}>
                  Reset
                </button>
                <button className="btn-clay btn-clay-primary" onClick={applyFilters}>
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}