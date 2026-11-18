import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { attendance, hr } from '../../api';
import type { Branch } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon, Icons } from '../../components/Icon';
import { formatAttendanceTime, formatLateDuration } from '../../utils/time';

interface Row {
  id: string;
  employee_id: string;
  employee_code: string;
  full_name: string;
  work_date: string;
  status: string;
  late_minutes: number | null;
  late_out_minutes?: number | null;
  first_in?: string | null;
  last_out?: string | null;
  department_name?: string | null;
  branch_name?: string | null;
}

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
  department_id?: string | null;
}

interface Department {
  id: string;
  name: string;
}

function getInitialDates(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return {
    from: `${y}-${m}-01`,
    to: `${y}-${m}-${d}`,
  };
}

export function CustomAttendanceTab(): ReactElement {
  const init = useMemo(() => getInitialDates(), []);
  const [fromDate, setFromDate] = useState(init.from);
  const [toDate, setToDate] = useState(init.to);
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedEmp, setSelectedEmp] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [rows, setRows] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);

  const [recalcTarget, setRecalcTarget] = useState<Row | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recalcSuccess, setRecalcSuccess] = useState('');

  // Load departments, branches & employees for dropdowns
  useEffect(() => {
    async function loadMeta() {
      try {
        const [empRes, deptRes, branchRes] = await Promise.all([
          hr.employees({ perPage: 200 }),
          hr.departments(),
          hr.branches({ perPage: 100 }),
        ]);
        setEmployees((empRes.data as { items: Employee[] }).items ?? []);
        setDepartments((deptRes.data as { items: Department[] }).items ?? (deptRes.data as unknown as Department[]) ?? []);
        setBranches((branchRes.data as { items: Branch[] }).items ?? []);
      } catch {
        /* optional */
      }
    }
    void loadMeta();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!fromDate || !toDate) {
        setError('Please select both From Date and To Date.');
        setLoading(false);
        return;
      }
      if (fromDate > toDate) {
        setError('From Date cannot be later than To Date.');
        setLoading(false);
        return;
      }

      const params: Record<string, string | number> = {
        page,
        perPage,
        'filter[work_date]': `${fromDate}..${toDate}`,
      };

      if (selectedEmp) {
        params['filter[employee_id]'] = selectedEmp;
      } else {
        if (selectedDept) {
          params['filter[department_id]'] = selectedDept;
        }
        if (selectedBranch) {
          params['filter[branch_id]'] = selectedBranch;
        }
      }

      if (statusFilter) {
        params['filter[status]'] = statusFilter;
      }

      const res = await attendance.events(params);
      const data = res.data as { items: Row[]; total: number };
      setRows(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load custom attendance records');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, selectedDept, selectedBranch, selectedEmp, statusFilter, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyPreset = (preset: 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'lastMonth') => {
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    if (preset === 'today') {
      const t = fmt(now);
      setFromDate(t);
      setToDate(t);
    } else if (preset === 'yesterday') {
      const y = new Date(now.getTime() - 86400000);
      const yFmt = fmt(y);
      setFromDate(yFmt);
      setToDate(yFmt);
    } else if (preset === 'last7') {
      const s = new Date(now.getTime() - 6 * 86400000);
      setFromDate(fmt(s));
      setToDate(fmt(now));
    } else if (preset === 'thisMonth') {
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      setFromDate(`${y}-${m}-01`);
      setToDate(fmt(now));
    } else if (preset === 'lastMonth') {
      const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const m = now.getMonth() === 0 ? 12 : now.getMonth();
      const lastDay = new Date(y, m, 0).getDate();
      const mStr = String(m).padStart(2, '0');
      setFromDate(`${y}-${mStr}-01`);
      setToDate(`${y}-${mStr}-${String(lastDay).padStart(2, '0')}`);
    }
    setPage(1);
  };

  const handleRecalcSingle = async () => {
    if (!recalcTarget) return;
    setSubmitting(true);
    setRecalcSuccess('');
    try {
      await attendance.recalculate({
        employeeId: recalcTarget.employee_id,
        workDate: recalcTarget.work_date.slice(0, 10),
      });
      setRecalcTarget(null);
      setRecalcSuccess(`Recalculated attendance for ${recalcTarget.full_name} on ${recalcTarget.work_date.slice(0, 10)}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recalculation failed');
      setRecalcTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecalcRange = async () => {
    if (!fromDate || !toDate) return;
    if (!window.confirm(`Recalculate attendance records from ${fromDate} to ${toDate}?`)) return;
    setSubmitting(true);
    setError('');
    setRecalcSuccess('');
    try {
      const res = await attendance.recalcRange({
        startDate: fromDate,
        endDate: toDate,
        employeeIds: selectedEmp ? [selectedEmp] : undefined,
      });
      await load();
      setRecalcSuccess(`Successfully recalculated ${(res as { recalculated: number }).recalculated} record(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Batch recalculation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportCSV = () => {
    if (rows.length === 0) return;
    const headers = ['Employee ID', 'Employee Name', 'Department', 'Branch', 'Work Date', 'First In', 'Last Out', 'Status', 'Late In', 'Late Out'];
    const csvRows = rows.map((r) => [
      r.employee_code ?? '',
      `"${(r.full_name ?? '').replace(/"/g, '""')}"`,
      `"${(r.department_name ?? '').replace(/"/g, '""')}"`,
      `"${(r.branch_name ?? '').replace(/"/g, '""')}"`,
      r.work_date ? r.work_date.slice(0, 10) : '',
      formatAttendanceTime(r.first_in),
      formatAttendanceTime(r.last_out),
      r.status ?? '',
      formatLateDuration(r.late_minutes),
      formatLateDuration(r.late_out_minutes),
    ]);
    const csvContent = [headers.join(','), ...csvRows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `custom-attendance-records_${fromDate}_to_${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  // Metric summaries for the loaded rows
  const metrics = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;
    let leave = 0;
    for (const r of rows) {
      const st = (r.status || '').toLowerCase();
      if (st === 'present') present++;
      else if (st === 'late') late++;
      else if (st === 'absent') absent++;
      else if (st.includes('leave')) leave++;
    }
    return { present, late, absent, leave };
  }, [rows]);

  const columns: DataColumn<Row>[] = [
    {
      key: 'employee_code',
      header: 'ID',
      sortable: true,
      render: (r) => <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{r.employee_code}</span>,
    },
    {
      key: 'full_name',
      header: 'Employee',
      sortable: true,
      render: (r) => <strong>{r.full_name}</strong>,
    },
    {
      key: 'department_name',
      header: 'Department',
      render: (r) => r.department_name || '—',
    },
    {
      key: 'branch_name',
      header: 'Branch',
      render: (r) => r.branch_name || '—',
    },
    {
      key: 'work_date',
      header: 'Date',
      sortable: true,
      render: (r) => (r.work_date ? new Date(r.work_date).toLocaleDateString() : '—'),
    },
    {
      key: 'first_in',
      header: 'First In',
      render: (r) => formatAttendanceTime(r.first_in),
    },
    {
      key: 'last_out',
      header: 'Last Out',
      render: (r) => formatAttendanceTime(r.last_out),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      render: (r) => <StatusBadge value={r.status} />,
    },
    {
      key: 'late_minutes',
      header: 'Late In',
      align: 'center',
      sortable: true,
      render: (r) => formatLateDuration(r.late_minutes),
    },
    {
      key: 'late_out_minutes',
      header: 'Late Out',
      align: 'center',
      sortable: true,
      render: (r) => formatLateDuration(r.late_out_minutes),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <button
          className="btn-clay btn-clay-sm btn-clay-secondary"
          onClick={() => setRecalcTarget(r)}
          title="Recalculate attendance for this date"
        >
          Recalculate
        </button>
      ),
    },
  ];

  return (
    <div>
      {/* Filter and Controls Header */}
      <div className="panel-clay" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: 2 }}>
              From Date
            </label>
            <input
              type="date"
              className="form-control-clay"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: 2 }}>
              To Date
            </label>
            <input
              type="date"
              className="form-control-clay"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: 2 }}>
              Department
            </label>
            <select
              className="form-control-clay"
              value={selectedDept}
              onChange={(e) => {
                setSelectedDept(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: 2 }}>
              Branch
            </label>
            <select
              className="form-control-clay"
              value={selectedBranch}
              onChange={(e) => {
                setSelectedBranch(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: 2 }}>
              Employee
            </label>
            <select
              className="form-control-clay"
              value={selectedEmp}
              onChange={(e) => {
                setSelectedEmp(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Employees</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} ({emp.employee_code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: 2 }}>
              Status
            </label>
            <select
              className="form-control-clay"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Statuses</option>
              <option value="Present">Present</option>
              <option value="Late">Late</option>
              <option value="Absent">Absent</option>
              <option value="Leave">Leave</option>
              <option value="HolidayPresent">Holiday Present</option>
              <option value="RestDay">Rest Day</option>
            </select>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignSelf: 'flex-end' }}>
            <button
              className="btn-clay btn-clay-secondary"
              onClick={handleExportCSV}
              disabled={rows.length === 0}
              title="Export current filtered view to CSV"
            >
              <Icon icon={Icons.Upload} size="sm" /> Export CSV
            </button>
            <button
              className="btn-clay btn-clay-secondary"
              onClick={handlePrint}
              disabled={rows.length === 0}
              title="Print report"
            >
              <Icon icon={Icons.Print} size="sm" /> Print
            </button>
            <button
              className="btn-clay btn-clay-primary"
              onClick={handleRecalcRange}
              disabled={submitting}
              title="Recalculate attendance records within this date range"
            >
              <Icon icon={Icons.Refresh} size="sm" /> Recalculate Range
            </button>
          </div>
        </div>

        {/* Quick Date Range Presets */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', paddingTop: '0.4rem', borderTop: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginRight: '0.2rem' }}>Quick Filters:</span>
          <button type="button" className="btn-clay btn-clay-xs btn-clay-secondary" onClick={() => applyPreset('today')}>
            Today
          </button>
          <button type="button" className="btn-clay btn-clay-xs btn-clay-secondary" onClick={() => applyPreset('yesterday')}>
            Yesterday
          </button>
          <button type="button" className="btn-clay btn-clay-xs btn-clay-secondary" onClick={() => applyPreset('last7')}>
            Last 7 Days
          </button>
          <button type="button" className="btn-clay btn-clay-xs btn-clay-secondary" onClick={() => applyPreset('thisMonth')}>
            This Month
          </button>
          <button type="button" className="btn-clay btn-clay-xs btn-clay-secondary" onClick={() => applyPreset('lastMonth')}>
            Last Month
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="analytics-metrics" style={{ marginBottom: '1rem' }}>
        <div className="analytics-metric">
          <div className="analytics-metric-value">{total}</div>
          <div className="analytics-metric-label">Total Records Found</div>
        </div>
        <div className="analytics-metric">
          <div className="analytics-metric-value" style={{ color: 'var(--success, #16a34a)' }}>
            {metrics.present}
          </div>
          <div className="analytics-metric-label">Present (Current Page)</div>
        </div>
        <div className="analytics-metric">
          <div className="analytics-metric-value" style={{ color: 'var(--warning, #f59e0b)' }}>
            {metrics.late}
          </div>
          <div className="analytics-metric-label">Late (Current Page)</div>
        </div>
        <div className="analytics-metric">
          <div className="analytics-metric-value" style={{ color: 'var(--danger, #dc2626)' }}>
            {metrics.absent}
          </div>
          <div className="analytics-metric-label">Absent (Current Page)</div>
        </div>
        <div className="analytics-metric">
          <div className="analytics-metric-value" style={{ color: 'var(--info, #2563eb)' }}>
            {metrics.leave}
          </div>
          <div className="analytics-metric-label">On Leave (Current Page)</div>
        </div>
      </div>

      {recalcSuccess && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.6rem 0.9rem',
            background: 'rgba(22, 163, 74, 0.1)',
            borderRadius: 10,
            border: '1px solid rgba(22, 163, 74, 0.3)',
            color: 'var(--success, #16a34a)',
            fontSize: '0.85rem',
          }}
        >
          {recalcSuccess}
        </div>
      )}

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

      <DataTable
        rowKey={(r) => r.id}
        columns={columns}
        rows={rows}
        loading={loading}
        page={page}
        perPage={perPage}
        total={total}
        onPageChange={setPage}
        onPerPageChange={(p) => {
          setPerPage(p);
          setPage(1);
        }}
        emptyMessage="No custom attendance records match the selected date range and filters."
      />

      {/* Recalculate Modal */}
      {recalcTarget && (
        <Modal
          title="Recalculate Day"
          open={!!recalcTarget}
          onClose={() => setRecalcTarget(null)}
          onSubmit={handleRecalcSingle}
          submitting={submitting}
          submitLabel="Confirm Recalculate"
        >
          <p>
            Recalculate attendance derived day for <strong>{recalcTarget.full_name}</strong> ({recalcTarget.employee_code}) on{' '}
            <strong>{recalcTarget.work_date.slice(0, 10)}</strong>?
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            This recalculates First In, Last Out, Late Minutes, and Attendance Status based on the ingested punches and assigned shift schedule.
          </p>
        </Modal>
      )}
    </div>
  );
}
