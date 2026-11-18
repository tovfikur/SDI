import {
  activeEmployeeCount,
  newHiresCount,
  pendingLeaveCount,
  recentHires,
  hiresByPosition,
  pendingLeaveRequests,
  loanRecovery,
  attentionEmployees,
  listNotices,
  employeeAnalytics,
  performanceTrend,
  computeTodayKPIs,
  computeLoanRecovery,
  computeAttention,
  computeHiresByPosition,
} from '@jsk/domain-hr';
import { attendanceAnalytics, todayByDepartment, listPendingAttendance } from '@jsk/domain-attendance';
import { listShortLeaves, leaveAnalytics } from '@jsk/domain-leave';

export interface HrDashboardInput {
  asOf?: string;
  hiresWindowDays?: number;
  pendingLimit?: number;
  recentLimit?: number;
}

/**
 * Aggregated HR dashboard payload. All datasets are fetched concurrently
 * (single round-trip) and reuse the existing HR/attendance/leave services.
 */
export async function hrDashboard(input: HrDashboardInput = {}): Promise<Record<string, unknown>> {
  const asOf = input.asOf ? new Date(input.asOf) : new Date();
  const hiresWindowDays = input.hiresWindowDays ?? 30;
  const pendingLimit = input.pendingLimit ?? 8;
  const recentLimit = input.recentLimit ?? 8;

  const att = await attendanceAnalytics(30);
  const [
    totalActive,
    newHires30,
    pendingLeavesTotal,
    pendingLeaves,
    recentHiresList,
    hiresByPosRows,
    loanRaw,
    attentionCandidates,
    pendingApprovals,
    shortLeaves,
    workforce,
    perf,
    notices,
    todayDept,
    leaveOverview,
  ] = await Promise.all([
    activeEmployeeCount(),
    newHiresCount(30),
    pendingLeaveCount(),
    pendingLeaveRequests(pendingLimit),
    recentHires(recentLimit),
    hiresByPosition(hiresWindowDays),
    loanRecovery(),
    attentionEmployees(),
    listPendingAttendance(),
    listShortLeaves(),
    employeeAnalytics(),
    performanceTrend(),
    listNotices(),
    todayByDepartment(asOf.toISOString().slice(0, 10)),
    leaveAnalytics(new Date().getFullYear()),
  ]);

  const todayKpis = computeTodayKPIs({
    totalActive,
    today: (att.today ?? []) as Array<{ status: string; n: number | string }>,
    pendingLeaveRequests: pendingLeavesTotal,
    newHires30,
  });

  const deptRows = todayDept.map((r) => {
    const present = Number(r.present);
    const late = Number(r.late);
    const absent = Number(r.absent);
    const leave = Number(r.leave);
    const attended = present + late;
    const marked = attended + absent;
    return {
      ...r,
      present,
      late,
      absent,
      leave,
      attendance_pct: marked > 0 ? Math.round((attended / marked) * 100) : 0,
    };
  });

  return {
    todayKpis,
    todayByDepartment: deptRows,
    attendanceTrend: att.trend ?? [],
    workforce,
    leaveOverview: leaveOverview.byStatus ?? [],
    performance: perf,
    notices,
    pendingLeaves: { items: pendingLeaves.items, total: pendingLeavesTotal },
    recentHires: recentHiresList,
    hiresByPosition: computeHiresByPosition(hiresByPosRows),
    loanRecovery: computeLoanRecovery(loanRaw),
    shortLeaves,
    attention: computeAttention(attentionCandidates as never, pendingApprovals.length, asOf),
  };
}