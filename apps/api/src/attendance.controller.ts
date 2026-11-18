import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ingestEvent, bulkIngest, monthlyManualEntry, recalculateEmployeeDay, recalculateRange,
  listMissingAttendance, listPendingAttendance, approvePending, rejectPending,
  upsertDeviceMapping, listDeviceMappings,
  reportLateAttendance, reportAttendanceLog, reportDailyPresent,
  reportMonthlySummary, reportMonthlyDetail, reportDailyWorksheet,
  geoCheckin, listPendingGeo, attendanceAnalytics, fieldTrackingAnalytics,
  getIndividualAttendanceCalendar,
} from '@jsk/domain-attendance';
import { parseFilters, parseSort } from '@jsk/shared-kernel';
import { query } from '@jsk/shared-kernel';
import { notifyEmployee } from './notify';
import type { FilterParam, SortParam } from '@jsk/shared-kernel';
import { Permissions, withIdentity } from './auth/guards';
import type { RequestWithSession } from './auth/session';
import { hasAnyPermission } from '@jsk/shared-auth';

function listQuery(q: Record<string, string>): {
  filters: FilterParam[]; sort: SortParam | null; page: number; perPage: number;
} {
  return {
    filters: parseFilters(q),
    sort: parseSort(q['sort'], q['direction']),
    page: q['page'] ? parseInt(q['page'], 10) : 1,
    perPage: q['perPage'] ? parseInt(q['perPage'], 10) : 10,
  };
}

@Controller('api/attendance')
export class AttendanceController {
  // ---- Analytics (BR-018) ---------------------------------------------------
  @Get('analytics')
  async analytics(@Req() req: RequestWithSession, @Query('days') days?: string) {
    const identity = withIdentity(req);
    const n = days ? Math.min(90, Math.max(7, parseInt(days, 10) || 30)) : 30;
    if (hasAnyPermission(identity, ['hr.attendance.manage', 'hr.attendance.approve', 'report.view'])) {
      return { data: await attendanceAnalytics(n) };
    }
    if (identity.employee_id) {
      return { data: await attendanceAnalytics(n, identity.employee_id) };
    }
    throw new ForbiddenException('Insufficient permissions');
  }

  // ---- Field-force analytics (BR-018) ---------------------------------------
  @Get('field/analytics')
  async fieldAnalytics(@Req() req: RequestWithSession) {
    const identity = withIdentity(req);
    if (hasAnyPermission(identity, ['hr.attendance.manage', 'hr.attendance.approve', 'report.view'])) {
      return { data: await fieldTrackingAnalytics() };
    }
    if (identity.employee_id) {
      return { data: await fieldTrackingAnalytics(identity.employee_id) };
    }
    throw new ForbiddenException('Insufficient permissions');
  }
  // ---- Events (FR-050) ----------------------------------------------------
  @Post('events')
  @UseGuards(Permissions('hr.attendance.manage'))
  async ingest(@Body() body: { employeeId: string; eventTime: string; source?: string; deviceEmployeeId?: string }) {
    const result = await ingestEvent({
      employee_id: body.employeeId,
      event_time: body.eventTime,
      source: body.source,
      device_employee_id: body.deviceEmployeeId,
    });
    return { success: true, inserted: result.inserted };
  }

  @Post('events/bulk')
  @UseGuards(Permissions('hr.attendance.manage'))
  async ingestBulk(@Body() body: { events: Array<{ employeeId: string; eventTime: string; source?: string }> }) {
    const events = (body.events ?? []).map((e) => ({
      employee_id: e.employeeId,
      event_time: e.eventTime,
      source: e.source,
    }));
    const result = await bulkIngest(events);
    return { success: true, ...result };
  }

  @Post('manual-entry')
  @UseGuards(Permissions('hr.attendance.manage'))
  async manualEntry(@Body() body: { employeeId: string; year: number; month: number; timeIn: string; timeOut: string }) {
    await monthlyManualEntry({
      employee_id: body.employeeId,
      year: body.year,
      month: body.month,
      time_in: body.timeIn,
      time_out: body.timeOut,
    });
    return { success: true };
  }

  @Post('recalculate')
  @UseGuards(Permissions('hr.attendance.manage'))
  async recalculate(@Body() body: { employeeId: string; workDate: string }) {
    const result = await recalculateEmployeeDay(body.employeeId, body.workDate);
    return { success: true, data: result };
  }

  @Post('recalculate/range')
  @UseGuards(Permissions('hr.attendance.manage'))
  async recalcRange(@Body() body: { startDate: string; endDate: string; employeeIds?: string[] }) {
    const count = await recalculateRange(body.startDate, body.endDate, body.employeeIds);
    return { success: true, recalculated: count };
  }

  // ---- Individual Attendance Calendar ------------------------------------
  @Get('individual')
  async individual(
    @Req() req: RequestWithSession,
    @Query('employeeId') employeeId?: string,
    @Query('month') month?: string,
  ) {
    const identity = withIdentity(req);
    const isHrOrAdmin = hasAnyPermission(identity, [
      'hr.attendance.view',
      'hr.attendance.manage',
      'hr.attendance.approve',
      'report.view',
      'hr.employee.view',
    ]);

    let targetEmployeeId = employeeId;
    if (!isHrOrAdmin) {
      if (!identity.employee_id) {
        throw new ForbiddenException('No associated employee record found.');
      }
      targetEmployeeId = identity.employee_id;
    } else if (!targetEmployeeId) {
      targetEmployeeId = identity.employee_id ?? (
        (await query<{ id: string }>(`SELECT id FROM employees WHERE deleted_at IS NULL ORDER BY full_name ASC LIMIT 1`)).rows[0]?.id
      );
    }

    if (!targetEmployeeId) {
      return { success: false, error: 'No employee found.' };
    }

    try {
      const data = await getIndividualAttendanceCalendar(targetEmployeeId, month);
      return { success: true, data };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Employee not found')) {
        throw new NotFoundException(e.message);
      }
      throw e;
    }
  }

  // ---- Derived days (FR-051) ----------------------------------------------
  @Get('days')
  async days(@Req() req: RequestWithSession, @Query() q: Record<string, string>) {
    const { filters, sort, page, perPage } = listQuery(q);
    const identity = withIdentity(req);
    if (identity.employee_id && !hasAnyPermission(identity, ['hr.attendance.view', 'hr.attendance.manage', 'hr.attendance.approve'])) {
      filters.push({ field: 'employee_id', operator: 'eq', value: identity.employee_id });
    }
    return { data: await reportAttendanceLog(filters, sort, page, perPage) };
  }

  // ---- Queues (FR-052/053) ------------------------------------------------
  @Get('missing')
  async missing(@Req() req: RequestWithSession) {
    const identity = withIdentity(req);
    const employeeId =
      identity.employee_id && !hasAnyPermission(identity, ['hr.attendance.view', 'hr.attendance.manage'])
        ? identity.employee_id
        : null;
    return { data: await listMissingAttendance(undefined, employeeId) };
  }

  @Get('pending')
  @UseGuards(Permissions('hr.attendance.approve'))
  async pending() {
    return { data: await listPendingAttendance() };
  }

  @Post('pending/:id/approve')
  @UseGuards(Permissions('hr.attendance.approve'))
  async approvePendingRoute(@Param('id') id: string, @Body() body: { userId: string }) {
    const { rows } = await query<{ employee_id: string }>(
      `SELECT employee_id FROM attendance_pending WHERE id = $1::uuid`,
      [id]
    );
    const employeeId = rows[0]?.employee_id ?? null;
    await approvePending(id, body.userId ?? '00000000-0000-0000-0000-000000000000');
    await notifyEmployee(employeeId, {
      event_type: 'attendance.approved',
      title: 'Attendance approved',
      message: 'Your attendance entry has been approved.',
      action_url: '/hr/attendance/form',
    });
    return { success: true };
  }

  @Post('pending/:id/reject')
  @UseGuards(Permissions('hr.attendance.approve'))
  async rejectPendingRoute(@Param('id') id: string, @Body() body: { userId: string }) {
    const { rows } = await query<{ employee_id: string }>(
      `SELECT employee_id FROM attendance_pending WHERE id = $1::uuid`,
      [id]
    );
    const employeeId = rows[0]?.employee_id ?? null;
    await rejectPending(id, body.userId ?? '00000000-0000-0000-0000-000000000000');
    await notifyEmployee(employeeId, {
      event_type: 'attendance.rejected',
      title: 'Attendance rejected',
      message: 'Your attendance entry was rejected.',
      action_url: '/hr/attendance/form',
    });
    return { success: true };
  }

  // ---- Device mapping (FR-050) --------------------------------------------
  @Get('device-mappings')
  async deviceMappings() {
    return { data: await listDeviceMappings() };
  }

  @Post('device-mappings')
  @UseGuards(Permissions('hr.attendance.manage'))
  async addDeviceMapping(@Body() body: { employeeId: string; deviceEmployeeId: string; notes?: string }) {
    return { success: true, data: await upsertDeviceMapping(body.employeeId, body.deviceEmployeeId, body.notes) };
  }

  // ---- Reports (FR-054..060) ----------------------------------------------
  @Get('reports/late')
  @UseGuards(Permissions('report.view', 'hr.attendance.view'))
  async late(@Query() q: Record<string, string>) {
    const { filters, page, perPage } = listQuery(q);
    return { data: await reportLateAttendance(filters, page, perPage) };
  }

  @Get('reports/daily-present')
  @UseGuards(Permissions('report.view', 'hr.attendance.view'))
  async dailyPresent(@Query('date') date?: string) {
    if (!date) return { data: [], error: 'date is required' };
    return { data: await reportDailyPresent(date) };
  }

  @Get('reports/monthly-summary')
  @UseGuards(Permissions('report.view', 'hr.attendance.view'))
  async monthlySummary(@Query('year') year?: string, @Query('month') month?: string) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    const m = month ? parseInt(month, 10) : new Date().getMonth() + 1;
    return { data: await reportMonthlySummary(y, m) };
  }

  @Get('reports/monthly-detail')
  @UseGuards(Permissions('report.view', 'hr.attendance.view'))
  async monthlyDetail(@Query() q: Record<string, string>) {
    const { filters, page, perPage } = listQuery(q);
    return { data: await reportMonthlyDetail(filters, page, perPage) };
  }

  @Get('reports/worksheet')
  @UseGuards(Permissions('report.view', 'hr.attendance.view'))
  async worksheet(@Query() q: Record<string, string>) {
    const { filters, page, perPage } = listQuery(q);
    return { data: await reportDailyWorksheet(filters, page, perPage) };
  }

  // ---- Geo-fence (Spec 2.1) ------------------------------------------------
  @Post('geo-checkin')
  @UseGuards(Permissions('hr.attendance.manage'))
  async geoCheckinEndpoint(@Body() body: {
    employee_id: string; event_time: string;
    latitude: number; longitude: number;
    device_metadata?: Record<string, unknown>;
    allowed_latitude?: number; allowed_longitude?: number; allowed_radius_meters?: number;
  }) {
    return { success: true, data: await geoCheckin(body) };
  }

  @Get('pending-geo')
  @UseGuards(Permissions('hr.attendance.approve'))
  async pendingGeo(@Query('status') status?: string) {
    return { data: await listPendingGeo({ status }) };
  }
}
