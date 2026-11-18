import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { attendance, hr } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon, Icons } from '../../components/Icon';
import { useCurrentUser } from '../../auth-context';
import { computeWorkingHours, formatAttendanceTime, formatLateDuration, parseMinutesFromTime } from '../../utils/time';
import { printIndividualAttendanceReport } from '../../utils/export';

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
  remarks?: string | null;
}

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
  department_name?: string | null;
  position_name?: string | null;
  branch_name?: string | null;
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

export function IndividualAttendanceTab(): ReactElement {
  const user = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const init = useMemo(() => getInitialDates(), []);
  const [fromDate, setFromDate] = useState(init.from);
  const [toDate, setToDate] = useState(init.to);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(31);
  const [total, setTotal] = useState(0);

  const [recalcTarget, setRecalcTarget] = useState<Row | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recalcSuccess, setRecalcSuccess] = useState('');

  // Load employee list
  useEffect(() => {
    async function loadEmployees() {
      try {
        const res = await hr.employees({ perPage: 250 });
        const list = (res.data as { items: Employee[] }).items ?? [];
        setEmployees(list);

        // Priority for preselection: URL param -> current user's employeeId -> first employee
        const paramId = searchParams.get('employeeId');
        if (paramId && list.some((e) => e.id === paramId)) {
          setSelectedEmpId(paramId);
        } else if (user?.employeeId && list.some((e) => e.id === user.employeeId)) {
          setSelectedEmpId(user.employeeId);
        } else if (list.length > 0 && !selectedEmpId) {
          setSelectedEmpId(list[0].id);
        }
      } catch {
        /* optional */
      }
    }
    void loadEmployees();
  }, [user?.employeeId, searchParams]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === selectedEmpId) ?? null,
    [employees, selectedEmpId]
  );

  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees;
    const q = searchQuery.toLowerCase();
    return employees.filter(
      (e) =>
        e.full_name.toLowerCase().includes(q) ||
        (e.employee_code && e.employee_code.toLowerCase().includes(q)) ||
        (e.department_name && e.department_name.toLowerCase().includes(q))
    );
  }, [employees, searchQuery]);

  const load = useCallback(async () => {
    if (!selectedEmpId) {
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
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

      const res = await attendance.events({
        page,
        perPage,
        'filter[employee_id]': selectedEmpId,
        'filter[work_date]': `${fromDate}..${toDate}`,
        sort: 'work_date',
        direction: 'desc',
      });
      const data = res.data as { items: Row[]; total: number };
      setRows(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load employee attendance records');
    } finally {
      setLoading(false);
    }
  }, [selectedEmpId, fromDate, toDate, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyPreset = (preset: 'thisMonth' | 'lastMonth' | 'last30' | 'thisYear') => {
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    if (preset === 'thisMonth') {
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
    } else if (preset === 'last30') {
      const s = new Date(now.getTime() - 29 * 86400000);
      setFromDate(fmt(s));
      setToDate(fmt(now));
    } else if (preset === 'thisYear') {
      const y = now.getFullYear();
      setFromDate(`${y}-01-01`);
      setToDate(fmt(now));
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
      setRecalcSuccess(`Recalculated attendance on ${recalcTarget.work_date.slice(0, 10)}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recalculation failed');
      setRecalcTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecalcEmployeeRange = async () => {
    if (!selectedEmpId || !fromDate || !toDate) return;
    if (!window.confirm(`Recalculate attendance for ${selectedEmployee?.full_name} from ${fromDate} to ${toDate}?`)) return;
    setSubmitting(true);
    setError('');
    setRecalcSuccess('');
    try {
      const res = await attendance.recalcRange({
        startDate: fromDate,
        endDate: toDate,
        employeeIds: [selectedEmpId],
      });
      await load();
      setRecalcSuccess(`Successfully recalculated ${(res as { recalculated: number }).recalculated} day(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Employee range recalculation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportCSV = () => {
    if (rows.length === 0 || !selectedEmployee) return;
    const headers = ['Date', 'Day', 'First In', 'Last Out', 'Working Hours', 'Status', 'Late In', 'Late Out'];
    const csvRows = rows.map((r) => {
      const d = r.work_date ? new Date(r.work_date) : null;
      const dayName = d ? d.toLocaleDateString(undefined, { weekday: 'short' }) : '';
      return [
        r.work_date ? r.work_date.slice(0, 10) : '',
        dayName,
        formatAttendanceTime(r.first_in),
        formatAttendanceTime(r.last_out),
        computeWorkingHours(r.first_in, r.last_out),
        r.status ?? '',
        formatLateDuration(r.late_minutes),
        formatLateDuration(r.late_out_minutes),
      ];
    });
    const titleRow = [`"Employee: ${selectedEmployee.full_name} (${selectedEmployee.employee_code}) - Period: ${fromDate} to ${toDate}"`];
    const csvContent = [titleRow.join(','), headers.join(','), ...csvRows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `individual-attendance_${selectedEmployee.employee_code}_${fromDate}_to_${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    if (!selectedEmployee) return;

    let totalWorkMinutes = 0;
    for (const r of rows) {
      if (r.first_in && r.last_out) {
        const start = parseMinutesFromTime(r.first_in);
        const end = parseMinutesFromTime(r.last_out);
        if (start != null && end != null) {
          let diff = end - start;
          if (diff < 0) diff += 24 * 60;
          totalWorkMinutes += diff;
        }
      }
    }
    const totHrs = Math.floor(totalWorkMinutes / 60);
    const totMins = totalWorkMinutes % 60;
    const totalWorkingHours = `${totHrs}h ${totMins}m`;

    const dayRows = rows.map((r) => {
      const d = new Date(r.work_date);
      return {
        date: r.work_date.slice(0, 10),
        day: d.toLocaleDateString(undefined, { weekday: 'short' }),
        firstIn: formatAttendanceTime(r.first_in),
        lastOut: formatAttendanceTime(r.last_out),
        workingHours: computeWorkingHours(r.first_in, r.last_out),
        lateIn: formatLateDuration(r.late_minutes),
        lateOut: formatLateDuration(r.late_out_minutes),
        status: r.status,
        remarks: r.remarks ? String(r.remarks) : '',
      };
    });

    const weekendDays = Math.max(0, rows.length - stats.present - stats.late - stats.absent - stats.leave);

    printIndividualAttendanceReport({
      employee: {
        name: selectedEmployee.full_name,
        code: selectedEmployee.employee_code,
        department: selectedEmployee.department_name,
        designation: selectedEmployee.position_name,
        branch: selectedEmployee.branch_name,
      },
      period: { from: fromDate, to: toDate },
      summary: {
        totalDays: rows.length,
        presentDays: stats.present,
        lateDays: stats.late,
        absentDays: stats.absent,
        leaveDays: stats.leave,
        weekendDays,
        totalLateDuration: formatLateDuration(stats.totalLateMinutes),
        totalWorkingHours,
      },
      days: dayRows,
    });
  };

  // Summary statistics for the loaded records
  const stats = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;
    let leave = 0;
    let totalLateMinutes = 0;

    for (const r of rows) {
      const st = (r.status || '').toLowerCase();
      if (st === 'present') present++;
      else if (st === 'late') {
        late++;
        if (r.late_minutes) totalLateMinutes += Number(r.late_minutes);
      } else if (st === 'absent') absent++;
      else if (st.includes('leave')) leave++;
    }
    return { present, late, absent, leave, totalLateMinutes };
  }, [rows]);

  const columns: DataColumn<Row>[] = [
    {
      key: 'work_date',
      header: 'Date & Day',
      sortable: true,
      render: (r) => {
        if (!r.work_date) return '—';
        const d = new Date(r.work_date);
        const dayStr = d.toLocaleDateString(undefined, { weekday: 'short' });
        return (
          <div>
            <strong>{d.toLocaleDateString()}</strong>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginLeft: '0.4rem' }}>
              ({dayStr})
            </span>
          </div>
        );
      },
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
      key: 'hours',
      header: 'Working Hours',
      align: 'center',
      render: (r) => computeWorkingHours(r.first_in, r.last_out),
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
      {/* Control Panel */}
      <div className="panel-clay" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ minWidth: 260, flex: '1 1 260px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: 2 }}>
              Select Employee
            </label>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <input
                type="text"
                placeholder="Filter by name/code..."
                className="form-control-clay"
                style={{ width: 140, fontSize: '0.8rem' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select
                className="form-control-clay"
                style={{ flex: 1 }}
                value={selectedEmpId}
                onChange={(e) => {
                  setSelectedEmpId(e.target.value);
                  setSearchParams({ employeeId: e.target.value });
                  setPage(1);
                }}
              >
                {filteredEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name} ({emp.employee_code}) {emp.department_name ? `— ${emp.department_name}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ width: 140 }}>
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

          <div style={{ width: 140 }}>
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

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignSelf: 'flex-end' }}>
            <button
              className="btn-clay btn-clay-secondary"
              onClick={handleExportCSV}
              disabled={rows.length === 0}
              title="Export this employee's records to CSV"
            >
              <Icon icon={Icons.Upload} size="sm" /> Export CSV
            </button>
            <button
              className="btn-clay btn-clay-secondary"
              onClick={handlePrint}
              disabled={rows.length === 0}
              title="Print attendance card"
            >
              <Icon icon={Icons.Print} size="sm" /> Print Card
            </button>
            <button
              className="btn-clay btn-clay-primary"
              onClick={handleRecalcEmployeeRange}
              disabled={submitting || !selectedEmpId}
              title="Recalculate all days for this employee in period"
            >
              <Icon icon={Icons.Refresh} size="sm" /> Recalc Employee
            </button>
          </div>
        </div>

        {/* Quick Date Range Presets */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', paddingTop: '0.4rem', borderTop: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginRight: '0.2rem' }}>Quick Filters:</span>
          <button type="button" className="btn-clay btn-clay-xs btn-clay-secondary" onClick={() => applyPreset('thisMonth')}>
            This Month
          </button>
          <button type="button" className="btn-clay btn-clay-xs btn-clay-secondary" onClick={() => applyPreset('lastMonth')}>
            Last Month
          </button>
          <button type="button" className="btn-clay btn-clay-xs btn-clay-secondary" onClick={() => applyPreset('last30')}>
            Last 30 Days
          </button>
          <button type="button" className="btn-clay btn-clay-xs btn-clay-secondary" onClick={() => applyPreset('thisYear')}>
            This Year
          </button>
        </div>
      </div>

      {/* Employee Profile Header & Summary */}
      {selectedEmployee && (
        <div
          className="panel-clay"
          style={{
            marginBottom: '1rem',
            background: 'var(--panel-bg, rgba(255, 255, 255, 0.7))',
            borderLeft: '4px solid var(--primary, #017833)',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)' }}>
                {selectedEmployee.full_name}
              </h3>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                ID: <strong>{selectedEmployee.employee_code}</strong> · Department:{' '}
                <strong>{selectedEmployee.department_name || '—'}</strong> · Branch:{' '}
                <strong>{selectedEmployee.branch_name || '—'}</strong> · Position:{' '}
                <strong>{selectedEmployee.position_name || '—'}</strong>
              </div>
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>
              Period: <strong>{fromDate}</strong> to <strong>{toDate}</strong>
            </div>
          </div>
        </div>
      )}

      {/* Metrics Row */}
      <div className="analytics-metrics" style={{ marginBottom: '1rem' }}>
        <div className="analytics-metric">
          <div className="analytics-metric-value">{total}</div>
          <div className="analytics-metric-label">Total Days Recorded</div>
        </div>
        <div className="analytics-metric">
          <div className="analytics-metric-value" style={{ color: 'var(--success, #16a34a)' }}>
            {stats.present}
          </div>
          <div className="analytics-metric-label">Days Present</div>
        </div>
        <div className="analytics-metric">
          <div className="analytics-metric-value" style={{ color: 'var(--warning, #f59e0b)' }}>
            {stats.late}
          </div>
          <div className="analytics-metric-label">Days Late</div>
        </div>
        <div className="analytics-metric">
          <div className="analytics-metric-value" style={{ color: 'var(--danger, #dc2626)' }}>
            {stats.absent}
          </div>
          <div className="analytics-metric-label">Days Absent</div>
        </div>
        <div className="analytics-metric">
          <div className="analytics-metric-value" style={{ color: 'var(--info, #2563eb)' }}>
            {stats.leave}
          </div>
          <div className="analytics-metric-label">Days on Leave</div>
        </div>
        <div className="analytics-metric">
          <div className="analytics-metric-value" style={{ color: 'var(--warning, #f59e0b)' }}>
            {formatLateDuration(stats.totalLateMinutes)}
          </div>
          <div className="analytics-metric-label">Total Late Duration</div>
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
        emptyMessage="No attendance logs found for this employee within the selected period."
      />

      {/* Recalculate Modal */}
      {recalcTarget && (
        <Modal
          title="Recalculate Attendance Day"
          open={!!recalcTarget}
          onClose={() => setRecalcTarget(null)}
          onSubmit={handleRecalcSingle}
          submitting={submitting}
          submitLabel="Confirm Recalculate"
        >
          <p>
            Recalculate attendance derived day for <strong>{recalcTarget.full_name}</strong> on{' '}
            <strong>{recalcTarget.work_date.slice(0, 10)}</strong>?
          </p>
        </Modal>
      )}
    </div>
  );
}
