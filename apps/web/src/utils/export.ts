export interface ExportColumn {
  key: string;
  header: string;
}

function rowValue(row: Record<string, unknown>, key: string): unknown {
  if (key in row) return row[key];
  const direct = (row as Record<string, unknown>)[key];
  if (direct !== undefined) return direct;
  return '';
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[], columns: ExportColumn[]): void {
  const header = columns.map((c) => csvEscape(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => csvEscape(rowValue(r, c.key))).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${header}\n${body}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Excel-compatible .xls export via an HTML table (no external dependency). */
export function exportExcel(filename: string, rows: Record<string, unknown>[], columns: ExportColumn[]): void {
  const header = `<tr>${columns.map((c) => `<th>${csvEscape(c.header)}</th>`).join('')}</tr>`;
  const body = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${csvEscape(rowValue(r, c.key))}</td>`).join('')}</tr>`)
    .join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Report</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table border="1">${header}${body}</table></body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xls') ? filename : `${filename}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Opens a printable window with a plain light table. */
export function printTable(title: string, rows: Record<string, unknown>[], columns: ExportColumn[]): void {
  const header = `<tr>${columns.map((c) => `<th>${csvEscape(c.header)}</th>`).join('')}</tr>`;
  const body = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${csvEscape(rowValue(r, c.key))}</td>`).join('')}</tr>`)
    .join('');
  const win = window.open('', '_blank', 'width=1100,height=700');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${csvEscape(title)}</title><style>
    body{font-family:sans-serif;padding:24px;color:#111}
    h2{margin-bottom:8px}
    table{border-collapse:collapse;width:100%;font-size:12px}
    th,td{border:1px solid #999;padding:6px 8px;text-align:left}
    th{background:#eee}
    @media print{body{padding:0}}
  </style></head><body><h2>${csvEscape(title)}</h2><table>${header}${body}</table><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
  win.document.close();
}

/** SDI-branded printable business report with header, meta lines, and table. */
export function printReportWindow(
  title: string,
  metaLines: string[],
  rows: Record<string, unknown>[],
  columns: ExportColumn[]
): void {
  const header = `<tr>${columns.map((c) => `<th>${csvEscape(c.header)}</th>`).join('')}</tr>`;
  const body = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${csvEscape(rowValue(r, c.key))}</td>`).join('')}</tr>`)
    .join('');
  const meta = metaLines.map((line) => `<p class="meta">${csvEscape(line)}</p>`).join('');
  const win = window.open('', '_blank', 'width=1200,height=800');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${csvEscape(title)}</title><style>
    *{box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;padding:28px 32px;color:#1e293b;background:#fff}
    .brand{display:flex;align-items:center;gap:14px;border-bottom:3px solid #1e3a8a;padding-bottom:14px;margin-bottom:16px}
    .brand-logo{width:52px;height:52px;background:#1e3a8a;color:#fff;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800}
    .brand-name{font-size:20px;font-weight:800;letter-spacing:-0.01em}
    .brand-sub{font-size:12px;color:#64748b}
    h2{margin:4px 0 2px;font-size:18px}
    .meta{margin:2px 0;font-size:12px;color:#64748b}
    table{border-collapse:collapse;width:100%;font-size:12px;margin-top:10px}
    th,td{border:1px solid #cbd5e1;padding:7px 9px;text-align:left}
    th{background:#f1f5f9;font-weight:700;text-transform:uppercase;font-size:10.5px;letter-spacing:0.03em}
    tr:nth-child(even) td{background:#f8fafc}
    .footer{margin-top:18px;font-size:10.5px;color:#94a3b8;text-align:right}
    @media print{body{padding:0}}
  </style></head><body>
    <div class="brand">
      <div class="brand-logo">SDI</div>
      <div>
        <div class="brand-name">SDI</div>
        <div class="brand-sub">Self Development Initiative</div>
      </div>
    </div>
    <h2>${csvEscape(title)}</h2>
    ${meta}
    <table>${header}${body}</table>
    <div class="footer">SDI Enterprise — generated ${new Date().toLocaleString()}</div>
    <script>window.onload=()=>setTimeout(()=>window.print(),350)</script>
  </body></html>`);
  win.document.close();
}

export interface WorklogSummaryReportData {
  employee: {
    name: string;
    code: string;
    department?: string;
    branch?: string;
    designation?: string;
  };
  period: {
    from: string;
    to: string;
  };
  attendanceSummary: {
    totalDays: number;
    workedDays: number;
    lateCount: number;
    lateDuration: string;
    offDayDutyDays: number;
    outsideGeofenceDays: number;
    leaveDays: number;
    absentDays: number;
  };
  worklogs: Array<{
    date: string;
    project: string;
    task: string;
    description: string;
    hours: string | number;
    status: string;
    feedback?: string;
  }>;
}

export function printWorklogSummaryReport(data: WorklogSummaryReportData): void {
  const win = window.open('', '_blank', 'width=1200,height=850');
  if (!win) return;
  const rowsHtml =
    data.worklogs.length > 0
      ? data.worklogs
          .map(
            (w) => `
        <tr>
          <td style="white-space:nowrap;">${csvEscape(w.date)}</td>
          <td><strong>${csvEscape(w.project)}</strong>${
              w.task !== '—'
                ? `<br/><span style="font-size:10px;color:#64748b">${csvEscape(w.task)}</span>`
                : ''
            }</td>
          <td>${csvEscape(w.description)}</td>
          <td style="text-align:center;">${csvEscape(w.hours)}h</td>
          <td style="text-align:center;"><span class="badge ${
            w.status === 'approved'
              ? 'badge-success'
              : w.status === 'rejected'
              ? 'badge-danger'
              : 'badge-warning'
          }">${csvEscape(w.status)}</span></td>
          <td>${csvEscape(w.feedback || '—')}</td>
        </tr>
      `
          )
          .join('')
      : `<tr><td colspan="6" style="text-align:center;padding:16px;color:#94a3b8;">No daily worklogs recorded for this period.</td></tr>`;

  win.document.write(`<!DOCTYPE html><html><head><title>Worklog Summary - ${csvEscape(
    data.employee.name
  )}</title><style>
    @page { size: A4 portrait; margin: 10mm; }
    *{box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;padding:12px;color:#1e293b;background:#fff;font-size:11px;line-height:1.4}
    .header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #017833;padding-bottom:10px;margin-bottom:12px}
    .brand-title{font-size:18px;font-weight:800;color:#017833;letter-spacing:-0.01em}
    .brand-sub{font-size:11px;color:#64748b}
    .report-title{font-size:14px;font-weight:700;color:#1e293b;text-align:right}
    .report-period{font-size:11px;color:#64748b;text-align:right}
    .info-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;background:#f8fafc;padding:10px;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:12px}
    .info-item{font-size:11px}
    .info-label{font-size:9.5px;color:#64748b;text-transform:uppercase;font-weight:600;display:block}
    .info-val{font-weight:700;color:#0f172a}
    .summary-title{font-size:11.5px;font-weight:700;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.04em;color:#017833}
    .stats-table{width:100%;border-collapse:collapse;margin-bottom:12px}
    .stats-table th,.stats-table td{border:1px solid #cbd5e1;padding:6px 8px;text-align:center;font-size:10.5px}
    .stats-table th{background:#f1f5f9;color:#475569;font-weight:600}
    .stats-table td{font-weight:700;color:#0f172a}
    .table-main{width:100%;border-collapse:collapse;margin-top:6px;font-size:11px}
    .table-main th,.table-main td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
    .table-main th{background:#f8fafc;font-weight:700;text-transform:uppercase;font-size:10px;color:#475569}
    .table-main tr:nth-child(even) td{background:#fafbfc}
    .badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:9.5px;font-weight:700;text-transform:uppercase}
    .badge-success{background:#dcfce7;color:#15803d}
    .badge-warning{background:#fef3c7;color:#b45309}
    .badge-danger{background:#fee2e2;color:#b91c1c}
    .signatures{display:flex;justify-content:space-between;margin-top:36px;padding-top:8px}
    .sig-line{border-top:1px solid #94a3b8;width:180px;text-align:center;padding-top:4px;font-size:10.5px;color:#475569}
    .footer{margin-top:16px;font-size:10px;color:#94a3b8;display:flex;justify-content:space-between;border-top:1px solid #f1f5f9;padding-top:6px}
    @media print{body{padding:0}button{display:none}}
  </style></head><body>
    <div class="header">
      <div>
        <div class="brand-title">SDI · Self Development Initiative</div>
        <div class="brand-sub">Employee Worklog & Monthly Attendance Summary</div>
      </div>
      <div>
        <div class="report-title">Monthly Worklog Report</div>
        <div class="report-period">Period: ${csvEscape(data.period.from)} to ${csvEscape(
    data.period.to
  )}</div>
      </div>
    </div>

    <div class="info-grid">
      <div class="info-item"><span class="info-label">Employee</span><span class="info-val">${csvEscape(
        data.employee.name
      )}</span></div>
      <div class="info-item"><span class="info-label">Employee ID</span><span class="info-val">${csvEscape(
        data.employee.code
      )}</span></div>
      <div class="info-item"><span class="info-label">Department</span><span class="info-val">${csvEscape(
        data.employee.department || '—'
      )}</span></div>
      <div class="info-item"><span class="info-label">Branch</span><span class="info-val">${csvEscape(
        data.employee.branch || '—'
      )}</span></div>
    </div>

    <div class="summary-title">Monthly Attendance Performance Summary</div>
    <table class="stats-table">
      <thead>
        <tr>
          <th>Total Days</th>
          <th>Days Worked</th>
          <th>Late Count</th>
          <th>Total Late</th>
          <th>Off-Day Duty</th>
          <th>Field Duty (Outside)</th>
          <th>Leave Days</th>
          <th>Absent Days</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${data.attendanceSummary.totalDays}</td>
          <td style="color:#16a34a">${data.attendanceSummary.workedDays}</td>
          <td style="color:#f59e0b">${data.attendanceSummary.lateCount}</td>
          <td style="color:#f59e0b">${csvEscape(
            data.attendanceSummary.lateDuration
          )}</td>
          <td>${data.attendanceSummary.offDayDutyDays}</td>
          <td>${data.attendanceSummary.outsideGeofenceDays}</td>
          <td style="color:#2563eb">${data.attendanceSummary.leaveDays}</td>
          <td style="color:#dc2626">${data.attendanceSummary.absentDays}</td>
        </tr>
      </tbody>
    </table>

    <div class="summary-title" style="margin-top:10px">Daily Tasks & Worklogs</div>
    <table class="table-main">
      <thead>
        <tr>
          <th style="width:75px">Date</th>
          <th style="width:140px">Project & Task</th>
          <th>Work Description</th>
          <th style="width:55px;text-align:center">Hours</th>
          <th style="width:70px;text-align:center">Status</th>
          <th style="width:120px">Supervisor Note</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="signatures">
      <div class="sig-line">Employee Signature</div>
      <div class="sig-line">Supervisor / Lead Signature</div>
      <div class="sig-line">HR / Management Approval</div>
    </div>

    <div class="footer">
      <span>SDI Management System · Confidential</span>
      <span>Generated on ${new Date().toLocaleString()}</span>
    </div>
    <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
  </body></html>`);
  win.document.close();
}

export interface IndividualAttendanceReportData {
  employee: {
    name: string;
    code: string;
    department?: string | null | undefined;
    designation?: string | null | undefined;
    branch?: string | null | undefined;
  };
  period: { from: string; to: string };
  summary: {
    totalDays: number;
    presentDays: number;
    lateDays: number;
    absentDays: number;
    leaveDays: number;
    weekendDays: number;
    totalLateDuration: string;
    totalWorkingHours: string;
  };
  days: Array<{
    date: string;
    day: string;
    firstIn: string;
    lastOut: string;
    workingHours: string;
    lateIn: string;
    lateOut?: string;
    status: string;
    remarks?: string;
  }>;
}

export function printIndividualAttendanceReport(data: IndividualAttendanceReportData): void {
  const win = window.open('', '_blank', 'width=1150,height=850');
  if (!win) return;

  const rowsHtml =
    data.days.length > 0
      ? data.days
          .map((d) => {
            const st = (d.status || '').toLowerCase();
            const badgeClass =
              st === 'present'
                ? 'badge-success'
                : st === 'late'
                ? 'badge-warning'
                : st === 'absent'
                ? 'badge-danger'
                : 'badge-info';
            return `
        <tr>
          <td style="white-space:nowrap;font-weight:600;">${csvEscape(d.date)}</td>
          <td style="color:#64748b;text-align:center;">${csvEscape(d.day)}</td>
          <td style="text-align:center;">${csvEscape(d.firstIn)}</td>
          <td style="text-align:center;">${csvEscape(d.lastOut)}</td>
          <td style="text-align:center;font-weight:600;">${csvEscape(d.workingHours)}</td>
          <td style="text-align:center;color:${d.lateIn !== '0' && d.lateIn !== '—' ? '#b45309' : '#64748b'};">${csvEscape(d.lateIn)}</td>
          <td style="text-align:center;"><span class="badge ${badgeClass}">${csvEscape(d.status)}</span></td>
          <td style="font-size:10px;color:#64748b;">${csvEscape(d.remarks || '—')}</td>
        </tr>
      `;
          })
          .join('')
      : `<tr><td colspan="8" style="text-align:center;padding:16px;color:#94a3b8;">No attendance records found for this period.</td></tr>`;

  win.document.write(`<!DOCTYPE html><html><head><title>Attendance Card - ${csvEscape(
    data.employee.name
  )}</title><style>
    @page { size: A4 portrait; margin: 8mm; }
    *{box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;padding:10px;color:#1e293b;background:#fff;font-size:10.5px;line-height:1.35}
    .header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #017833;padding-bottom:8px;margin-bottom:10px}
    .brand-title{font-size:17px;font-weight:800;color:#017833;letter-spacing:-0.01em}
    .brand-sub{font-size:10.5px;color:#64748b}
    .report-title{font-size:13.5px;font-weight:700;color:#1e293b;text-align:right}
    .report-period{font-size:10.5px;color:#64748b;text-align:right}
    .info-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;background:#f8fafc;padding:8px 10px;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:10px}
    .info-item{font-size:10.5px}
    .info-label{font-size:9px;color:#64748b;text-transform:uppercase;font-weight:600;display:block}
    .info-val{font-weight:700;color:#0f172a}
    .summary-title{font-size:11px;font-weight:700;margin:0 0 5px;text-transform:uppercase;letter-spacing:0.04em;color:#017833}
    .stats-table{width:100%;border-collapse:collapse;margin-bottom:10px}
    .stats-table th,.stats-table td{border:1px solid #cbd5e1;padding:5px 6px;text-align:center;font-size:10px}
    .stats-table th{background:#f1f5f9;color:#475569;font-weight:600}
    .stats-table td{font-weight:700;color:#0f172a}
    .table-main{width:100%;border-collapse:collapse;margin-top:4px;font-size:10px}
    .table-main th,.table-main td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left}
    .table-main th{background:#f8fafc;font-weight:700;text-transform:uppercase;font-size:9.5px;color:#475569}
    .table-main tr:nth-child(even) td{background:#fafbfc}
    .badge{display:inline-block;padding:2px 5px;border-radius:3px;font-size:9px;font-weight:700;text-transform:uppercase}
    .badge-success{background:#dcfce7;color:#15803d}
    .badge-warning{background:#fef3c7;color:#b45309}
    .badge-danger{background:#fee2e2;color:#b91c1c}
    .badge-info{background:#e0f2fe;color:#0369a1}
    .signatures{display:flex;justify-content:space-between;margin-top:28px;padding-top:6px}
    .sig-line{border-top:1px solid #94a3b8;width:170px;text-align:center;padding-top:3px;font-size:10px;color:#475569}
    .footer{margin-top:12px;font-size:9.5px;color:#94a3b8;display:flex;justify-content:space-between;border-top:1px solid #f1f5f9;padding-top:4px}
    @media print{body{padding:0}button{display:none}}
  </style></head><body>
    <div class="header">
      <div>
        <div class="brand-title">SDI · Self Development Initiative</div>
        <div class="brand-sub">Employee Monthly Attendance Card & Performance Summary</div>
      </div>
      <div>
        <div class="report-title">Monthly Attendance Card</div>
        <div class="report-period">Period: ${csvEscape(data.period.from)} to ${csvEscape(data.period.to)}</div>
      </div>
    </div>

    <div class="info-grid">
      <div class="info-item"><span class="info-label">Employee</span><span class="info-val">${csvEscape(data.employee.name)}</span></div>
      <div class="info-item"><span class="info-label">Employee ID</span><span class="info-val">${csvEscape(data.employee.code)}</span></div>
      <div class="info-item"><span class="info-label">Department</span><span class="info-val">${csvEscape(data.employee.department || '—')}</span></div>
      <div class="info-item"><span class="info-label">Designation</span><span class="info-val">${csvEscape(data.employee.designation || '—')}</span></div>
      <div class="info-item"><span class="info-label">Branch</span><span class="info-val">${csvEscape(data.employee.branch || '—')}</span></div>
    </div>

    <div class="summary-title">Total Monthly Summary</div>
    <table class="stats-table">
      <thead>
        <tr>
          <th>Total Days</th>
          <th>Present Days</th>
          <th>Late Count</th>
          <th>Total Late</th>
          <th>Absent Days</th>
          <th>Leave Days</th>
          <th>Weekend / Holiday</th>
          <th>Total Hours</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${data.summary.totalDays}</td>
          <td style="color:#16a34a">${data.summary.presentDays}</td>
          <td style="color:#f59e0b">${data.summary.lateDays}</td>
          <td style="color:#f59e0b">${csvEscape(data.summary.totalLateDuration)}</td>
          <td style="color:#dc2626">${data.summary.absentDays}</td>
          <td style="color:#2563eb">${data.summary.leaveDays}</td>
          <td>${data.summary.weekendDays}</td>
          <td style="color:#0f172a">${csvEscape(data.summary.totalWorkingHours)}</td>
        </tr>
      </tbody>
    </table>

    <div class="summary-title" style="margin-top:8px">Day-by-Day Attendance Record</div>
    <table class="table-main">
      <thead>
        <tr>
          <th style="width:75px">Date</th>
          <th style="width:40px;text-align:center">Day</th>
          <th style="width:70px;text-align:center">First In</th>
          <th style="width:70px;text-align:center">Last Out</th>
          <th style="width:75px;text-align:center">Working Hours</th>
          <th style="width:75px;text-align:center">Late Time</th>
          <th style="width:75px;text-align:center">Status</th>
          <th>Remarks</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="signatures">
      <div class="sig-line">Employee Signature</div>
      <div class="sig-line">Supervisor / Lead Signature</div>
      <div class="sig-line">HR / Management Approval</div>
    </div>

    <div class="footer">
      <span>SDI HRM System · Confidential</span>
      <span>Generated on ${new Date().toLocaleString()}</span>
    </div>
    <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
  </body></html>`);
  win.document.close();
}