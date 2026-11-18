import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  leaveTypes, createApplication, listApplications, getApplication,
  approveApplication, rejectApplication, withdrawApplication, softDeleteApplication,
  totalLeavesMatrix, updateLeaveBalance, upsertLeaveBalance, generateLeavesForYear, createShortLeave, listShortLeaves, approveShortLeave,
  rejectShortLeave, leaveAnalytics,
} from '@jsk/domain-leave';
import { parseFilters, parseSort, query } from '@jsk/shared-kernel';
import type { FilterParam, SortParam } from '@jsk/shared-kernel';
import { Permissions, withIdentity } from './auth/guards';
import type { RequestWithSession } from './auth/session';
import { hasAnyPermission } from '@jsk/shared-auth';
import { notifyEmployee, notifyAdminsWithPermission } from './notify';

const LEAVE_STAFF_PERMS = ['hr.leave.view', 'hr.leave.manage', 'hr.leave.approve'];

/** Scoped list query: staff see everything, employees only their own records. */
function scopedFilters(
  q: Record<string, string>,
  employeeId: string | null,
  isStaff: boolean
): { filters: FilterParam[]; sort: SortParam | null; page: number; perPage: number } {
  const { filters, sort, page, perPage } = listQuery(q);
  if (!isStaff && employeeId) {
    filters.push({ field: 'employee_id', value: employeeId, operator: 'eq' });
  }
  return { filters, sort, page, perPage };
}

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

/** Map a thrown domain error (message = `leave.*` code) to a controlled HTTP error. */
function throwLeaveError(e: unknown): never {
  const code = e instanceof Error ? e.message : '';
  switch (code) {
    case 'leave.not_found':
      throw new NotFoundException('Leave application not found');
    case 'leave.already_approved':
      throw new ConflictException('This leave application has already been approved.');
    case 'leave.not_pending':
      throw new ConflictException('Only pending leave applications can be changed.');
    case 'leave.approved_days_invalid':
      throw new BadRequestException('Approved days must be a positive number.');
    case 'leave.approved_exceeds_requested':
      throw new BadRequestException('Approved days cannot exceed the requested days.');
    case 'leave.no_balance_row':
      throw new BadRequestException('No leave balance record found for this leave type and year.');
    case 'leave.insufficient_balance':
      throw new BadRequestException('Insufficient leave balance for the requested dates.');
    case 'leave.end_before_start':
      throw new BadRequestException('End date cannot be before the start date.');
    default:
      throw e;
  }
}

/** Validate + map a leave type payload to the `leave_types` schema fields. */
function normalizeLeaveType(body: Record<string, unknown>, isUpdate = false): Record<string, unknown> {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!isUpdate && !name) throw new BadRequestException('name is required');
  if (!isUpdate && !code) throw new BadRequestException('code is required');
  const result: Record<string, unknown> = {};
  if (name) result.name = name;
  if (code) result.code = code;
  if (body.annual_entitlement !== undefined && body.annual_entitlement !== null && body.annual_entitlement !== '') {
    const value = Number(body.annual_entitlement);
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException('annual_entitlement must be a non-negative number');
    }
    result.annual_entitlement = value;
  }
  if (body.is_paid !== undefined) result.is_paid = Boolean(body.is_paid);
  if (body.carry_forward !== undefined) result.carry_forward = Boolean(body.carry_forward);
  if (body.requires_document !== undefined) result.requires_document = Boolean(body.requires_document);
  if (body.gender_eligibility !== undefined && typeof body.gender_eligibility === 'string') {
    result.gender_eligibility = body.gender_eligibility;
  }
  if (body.max_consecutive_days !== undefined && body.max_consecutive_days !== null && body.max_consecutive_days !== '') {
    const mcd = Number(body.max_consecutive_days);
    if (!Number.isFinite(mcd) || mcd < 0) {
      throw new BadRequestException('max_consecutive_days must be a non-negative integer');
    }
    result.max_consecutive_days = Math.trunc(mcd);
  }
  return result;
}

@Controller('api/leave')
export class LeaveController {
  // ---- Leave types (FR-074) ----------------------------------------------
  @Get('types')
  async typesList(@Query() q: Record<string, string>) {
    const { filters, sort, page, perPage } = listQuery(q);
    return { data: await leaveTypes.list({ filters, sort, page, per_page: perPage }) };
  }

  @Post('types')
  @UseGuards(Permissions('hr.leave.manage'))
  async createType(@Body() body: Record<string, unknown>) {
    const data = normalizeLeaveType(body);
    const dup = await query<{ id: string }>(
      'SELECT id FROM leave_types WHERE code = $1 AND deleted_at IS NULL',
      [data.code]
    );
    if (dup.rows.length > 0) {
      throw new ConflictException(`A leave type with code "${data.code}" already exists.`);
    }
    return { success: true, data: await leaveTypes.create(data as never) };
  }

  @Put('types/:id')
  @UseGuards(Permissions('hr.leave.manage'))
  async updateType(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const data = normalizeLeaveType(body, true);
    if (data.code) {
      const dup = await query<{ id: string }>(
        'SELECT id FROM leave_types WHERE code = $1 AND id <> $2::uuid AND deleted_at IS NULL',
        [data.code, id]
      );
      if (dup.rows.length > 0) {
        throw new ConflictException(`A leave type with code "${data.code}" already exists.`);
      }
    }
    return { success: true, data: await leaveTypes.update(id, data as never) };
  }

  @Delete('types/:id')
  @UseGuards(Permissions('hr.leave.manage'))
  async deleteType(@Param('id') id: string) {
    return { success: await leaveTypes.remove(id) };
  }

  // ---- Applications (FR-070/071, WF-006/007) ------------------------------
  // Self-service: any authenticated user with an employee record can read
  // their own leave applications. The query scopes to employee_id.
  @Get('applications')
  async applications(@Req() req: RequestWithSession, @Query() q: Record<string, string>) {
    const identity = withIdentity(req);
    const isStaff = hasAnyPermission(identity, LEAVE_STAFF_PERMS);
    const { filters, sort, page, perPage } = scopedFilters(q, identity.employee_id, isStaff);
    return { data: await listApplications({ filters, sort, page, per_page: perPage }) };
  }

  @Get('analytics')
  async analytics(@Req() req: RequestWithSession, @Query('year') year?: string) {
    const identity = withIdentity(req);
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    const isStaff = hasAnyPermission(identity, LEAVE_STAFF_PERMS);
    return {
      data: await leaveAnalytics(y, isStaff ? null : identity.employee_id),
    };
  }

  @Get('applications/:id')
  async application(@Req() req: RequestWithSession, @Param('id') id: string) {
    const identity = withIdentity(req);
    const app = await getApplication(id);
    if (!app) throw new NotFoundException('Leave application not found');
    if (
      !hasAnyPermission(identity, LEAVE_STAFF_PERMS) &&
      app.employee_id !== identity.employee_id
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return { data: app };
  }

  @Post('applications')
  async apply(@Req() req: RequestWithSession, @Body() body: {
    employeeId: string; leaveTypeId: string; startDate: string; endDate: string;
    reason?: string; hardCopy?: boolean; attachmentFileId?: string;
  }) {
    const identity = withIdentity(req);
    let { employeeId } = body ?? {};
    const isStaff = hasAnyPermission(identity, ['hr.leave.manage', 'hr.leave.approve', 'hr.leave.view']);
    // Self-service: employees can only submit for themselves — never trust the client.
    if (!isStaff) {
      if (!identity.employee_id) {
        throw new ForbiddenException('No employee profile is linked to this user');
      }
      employeeId = identity.employee_id;
    }
    const leaveTypeId = body?.leaveTypeId || (body as any)?.leave_type_id;
    const startDate = body?.startDate || (body as any)?.start_date;
    const endDate = body?.endDate || (body as any)?.end_date;
    if (!employeeId || !leaveTypeId || !startDate || !endDate) {
      throw new BadRequestException('employeeId, leaveTypeId, startDate and endDate are required');
    }
    try {
      const data = await createApplication({
        employee_id: employeeId,
        leave_type_id: leaveTypeId,
        start_date: startDate,
        end_date: endDate,
        reason: body.reason,
        hard_copy: body.hardCopy,
        attachment_file_id: body.attachmentFileId,
      });
      // Notify HR / Admins that a new leave application was submitted
      await notifyAdminsWithPermission(['hr.leave.approve', 'hr.leave.manage'], {
        event_type: 'leave.applied',
        title: 'New Leave Application',
        message: `${identity.email || 'An employee'} applied for leave from ${startDate} to ${endDate}.`,
        action_url: '/hr/leave',
      });
      return {
        success: true,
        data,
      };
    } catch (e) {
      throwLeaveError(e);
    }
  }

  @Post('applications/:id/approve')
  @UseGuards(Permissions('hr.leave.approve'))
  async approve(@Param('id') id: string, @Body() body: { userId?: string; approvedDays?: number; comment?: string }) {
    if (!body.userId) throw new BadRequestException('userId is required');
    try {
      const data = await approveApplication(id, body.userId, body.approvedDays, body.comment);
      await notifyEmployee(data['employee_id'] as string | null, {
        event_type: 'leave.approved',
        title: 'Leave approved',
        message: 'Your leave application has been approved.',
        action_url: '/me/leave',
      });
      return { success: true, data };
    } catch (e) {
      throwLeaveError(e);
    }
  }

  @Post('applications/:id/reject')
  @UseGuards(Permissions('hr.leave.approve'))
  async reject(@Param('id') id: string, @Body() body: { userId?: string; comment?: string }) {
    if (!body.userId) throw new BadRequestException('userId is required');
    try {
      const data = await rejectApplication(id, body.userId, body.comment);
      await notifyEmployee(data['employee_id'] as string | null, {
        event_type: 'leave.rejected',
        title: 'Leave rejected',
        message: 'Your leave application has been rejected.',
        action_url: '/me/leave',
      });
      return { success: true, data };
    } catch (e) {
      throwLeaveError(e);
    }
  }

  @Post('applications/:id/withdraw')
  async withdraw(@Req() req: RequestWithSession, @Param('id') id: string) {
    const identity = withIdentity(req);
    if (!hasAnyPermission(identity, LEAVE_STAFF_PERMS)) {
      const app = await getApplication(id);
      if (!app || app.employee_id !== identity.employee_id) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }
    return { success: true, data: await withdrawApplication(id) };
  }

  @Delete('applications/:id')
  async remove(@Req() req: RequestWithSession, @Param('id') id: string) {
    const identity = withIdentity(req);
    if (!hasAnyPermission(identity, LEAVE_STAFF_PERMS)) {
      const app = await getApplication(id);
      if (!app || app.employee_id !== identity.employee_id) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }
    return { success: await softDeleteApplication(id) };
  }

  // ---- Balances (FR-072/073, BR-008) --------------------------------------
  @Get('balances')
  async balances(
    @Req() req: RequestWithSession,
    @Query('employeeId') employeeId?: string,
    @Query('year') year?: string
  ) {
    const identity = withIdentity(req);
    let target = employeeId;
    if (!hasAnyPermission(identity, LEAVE_STAFF_PERMS)) {
      target = identity.employee_id ?? undefined;
    }
    return { data: await totalLeavesMatrix(target, year ? parseInt(year, 10) : undefined) };
  }

  @Post('generate')
  @UseGuards(Permissions('hr.leave.manage'))
  async generate(@Body() body: { year?: number }) {
    const result = await generateLeavesForYear(body.year ?? new Date().getFullYear());
    return { success: true, ...result };
  }

  @Put('balances/:id')
  @UseGuards(Permissions('hr.leave.manage'))
  async updateBalance(
    @Param('id') id: string,
    @Body() body: { total?: number; taken?: number; due?: number }
  ) {
    if (body.total !== undefined && (isNaN(Number(body.total)) || Number(body.total) < 0)) {
      throw new BadRequestException('total must be a non-negative number');
    }
    if (body.taken !== undefined && (isNaN(Number(body.taken)) || Number(body.taken) < 0)) {
      throw new BadRequestException('taken must be a non-negative number');
    }
    if (body.due !== undefined && (isNaN(Number(body.due)) || Number(body.due) < 0)) {
      throw new BadRequestException('due must be a non-negative number');
    }
    const payload: { total?: number; taken?: number; due?: number } = {};
    if (body.total !== undefined) payload.total = Number(body.total);
    if (body.taken !== undefined) payload.taken = Number(body.taken);
    if (body.due !== undefined) payload.due = Number(body.due);
    try {
      const data = await updateLeaveBalance(id, payload);
      return { success: true, data };
    } catch (e: any) {
      if (e.message === 'leave.balance_not_found') {
        throw new NotFoundException('Leave balance record not found');
      }
      if (e.message === 'leave.negative_balance') {
        throw new BadRequestException('Balance values cannot be negative');
      }
      throw e;
    }
  }

  @Post('balances')
  @UseGuards(Permissions('hr.leave.manage'))
  async createOrUpdateBalance(
    @Body() body: { employee_id: string; leave_type_id: string; year: number; total: number; taken?: number; due?: number }
  ) {
    if (!body.employee_id || !body.leave_type_id || !body.year) {
      throw new BadRequestException('employee_id, leave_type_id, and year are required');
    }
    if (isNaN(Number(body.total)) || Number(body.total) < 0) {
      throw new BadRequestException('total must be a non-negative number');
    }
    const payload: { total: number; taken?: number; due?: number } = {
      total: Number(body.total),
    };
    if (body.taken !== undefined) payload.taken = Number(body.taken);
    if (body.due !== undefined) payload.due = Number(body.due);
    try {
      const data = await upsertLeaveBalance(
        body.employee_id,
        body.leave_type_id,
        Number(body.year),
        payload
      );
      return { success: true, data };
    } catch (e: any) {
      if (e.message === 'leave.negative_balance') {
        throw new BadRequestException('Balance values cannot be negative');
      }
      throw e;
    }
  }

  // ---- Short leaves (FR-075) ----------------------------------------------
  @Get('short-leaves')
  async shortLeaves(@Req() req: RequestWithSession) {
    const identity = withIdentity(req);
    if (!hasAnyPermission(identity, LEAVE_STAFF_PERMS)) {
      return { data: (await listShortLeaves()).filter((r) => r.employee_id === identity.employee_id) };
    }
    return { data: await listShortLeaves() };
  }

  @Post('short-leaves')
  async addShortLeave(@Req() req: RequestWithSession, @Body() body: { employeeId: string; workDate: string; minutes: number; reason?: string }) {
    const identity = withIdentity(req);
    let employeeId = body.employeeId;
    if (!hasAnyPermission(identity, LEAVE_STAFF_PERMS)) {
      if (!identity.employee_id) {
        throw new ForbiddenException('No employee profile is linked to this user');
      }
      employeeId = identity.employee_id;
    }
    const workDate = body?.workDate || (body as any)?.work_date;
    if (!employeeId || !workDate || !body.minutes) {
      throw new BadRequestException('employeeId, workDate and minutes are required');
    }
    return {
      success: true,
      data: await createShortLeave({
        employee_id: employeeId,
        work_date: workDate,
        minutes: body.minutes,
        reason: body.reason,
      }),
    };
  }

  @Post('short-leaves/:id/approve')
  @UseGuards(Permissions('hr.leave.approve'))
  async approveShort(@Param('id') id: string, @Body() body: { userId: string }) {
    const data = await approveShortLeave(id, body.userId);
    await notifyEmployee(data['employee_id'] as string | null, {
      event_type: 'short_leave.approved',
      title: 'Short leave approved',
      message: 'Your short leave request has been approved.',
      action_url: '/hr/leave/short-leaves',
    });
    return { success: true, data };
  }

  @Post('short-leaves/:id/reject')
  @UseGuards(Permissions('hr.leave.approve'))
  async rejectShort(@Param('id') id: string, @Body() body: { userId: string }) {
    const data = await rejectShortLeave(id, body.userId);
    await notifyEmployee(data['employee_id'] as string | null, {
      event_type: 'short_leave.rejected',
      title: 'Short leave rejected',
      message: 'Your short leave request has been rejected.',
      action_url: '/hr/leave/short-leaves',
    });
    return { success: true, data };
  }
}
