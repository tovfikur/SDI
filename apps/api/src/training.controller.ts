import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  trainings, assignEmployees, completeAssignment, updateAssignmentStatus,
  certificates, myTrainings,
} from '@jsk/domain-training';
import { parseFilters, parseSort, isIsoDateTime, query } from '@jsk/shared-kernel';
import type { FilterParam, SortParam } from '@jsk/shared-kernel';
import { Permissions, withIdentity } from './auth/guards';
import type { RequestWithSession } from './auth/session';
import { hasAnyPermission, findUserByEmployeeId } from '@jsk/shared-auth';
import { notifyUsers } from './notify';

const TRAINING_STATUSES = ['planned', 'scheduled', 'in_progress', 'completed', 'cancelled'];

/** Validate + normalize a training program payload. */
function normalizeTraining(body: Record<string, unknown>, isUpdate = false): Record<string, unknown> {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!isUpdate && !title) throw new BadRequestException('title is required');
  if (isUpdate && body.title !== undefined && !title) throw new BadRequestException('title cannot be empty');

  const result: Record<string, unknown> = {};
  if (title) result.title = title;
  if (body.trainer !== undefined) {
    if (body.trainer !== null && typeof body.trainer !== 'string') {
      throw new BadRequestException('trainer must be a string');
    }
    result.trainer = body.trainer;
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      throw new BadRequestException('description must be a string');
    }
    result.description = body.description;
  }
  if (body.venue !== undefined) {
    if (body.venue !== null && typeof body.venue !== 'string') {
      throw new BadRequestException('venue must be a string');
    }
    result.venue = body.venue;
  }
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !TRAINING_STATUSES.includes(body.status)) {
      throw new BadRequestException(`status must be one of: ${TRAINING_STATUSES.join(', ')}`);
    }
    result.status = body.status;
  }
  if (body.schedule !== undefined && body.schedule !== null) {
    if (typeof body.schedule !== 'string' || !isIsoDateTime(body.schedule)) {
      throw new BadRequestException('schedule must be an ISO-8601 datetime (YYYY-MM-DDTHH:mm:ss±HH:MM)');
    }
    result.schedule = body.schedule;
  }
  if (body.duration_hours !== undefined && body.duration_hours !== null && body.duration_hours !== '') {
    const value = Number(body.duration_hours);
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException('duration_hours must be a positive number');
    }
    result.duration_hours = value;
  }
  if (body.max_participants !== undefined && body.max_participants !== null && body.max_participants !== '') {
    const value = Number(body.max_participants);
    if (!Number.isInteger(value) || value < 1) {
      throw new BadRequestException('max_participants must be a positive integer');
    }
    result.max_participants = value;
  }
  return result;
}

@Controller('api/training')
export class TrainingController {
  // ---- Programs (HC-02) ---------------------------------------------------
  @Get()
  async list(@Query() q: Record<string, string>) {
    const filters: FilterParam[] = parseFilters(q);
    const sort: SortParam | null = parseSort(q['sort'], q['direction']);
    const page = q['page'] ? parseInt(q['page'], 10) : 1;
    const perPage = q['perPage'] ? parseInt(q['perPage'], 10) : 10;
    return { data: await trainings.list({ filters, sort, page, per_page: perPage, search: q['search'] }) };
  }

  @Get('my')
  async mine(@Req() req: RequestWithSession, @Query('employeeId') employeeId?: string) {
    const identity = withIdentity(req);
    // Self-service: employees can only read their own training assignments.
    if (!hasAnyPermission(identity, ['hr.training.view'])) {
      if (!identity.employee_id) {
        throw new ForbiddenException('No employee profile is linked to this user');
      }
      if (employeeId && employeeId !== identity.employee_id) {
        throw new ForbiddenException('Insufficient permissions');
      }
      employeeId = identity.employee_id;
    }
    if (!employeeId) throw new BadRequestException('employeeId is required');
    return { data: await myTrainings(employeeId) };
  }

  // Certificates list must come BEFORE the :id wildcard (Express matches in declaration order).
  @Get('certificates')
  @UseGuards(Permissions('hr.training.view'))
  async certificatesList(@Query() q: Record<string, string>) {
    const page = q['page'] ? parseInt(q['page'], 10) : 1;
    const perPage = q['perPage'] ? parseInt(q['perPage'], 10) : 10;
    return { data: await certificates.list({ employee_id: q['employeeId'], search: q['search'], page, per_page: perPage }) };
  }

  @Get(':id')
  @UseGuards(Permissions('hr.training.view'))
  async get(@Param('id') id: string) {
    const training = await trainings.get(id);
    if (!training) throw new NotFoundException('Training not found');
    return { data: training };
  }

  @Post()
  @UseGuards(Permissions('hr.training.manage'))
  async create(@Body() body: Record<string, unknown>) {
    return { success: true, data: await trainings.create(normalizeTraining(body) as never) };
  }

  @Put(':id')
  @UseGuards(Permissions('hr.training.manage'))
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return { success: true, data: await trainings.update(id, normalizeTraining(body, true) as never) };
  }

  @Delete(':id')
  @UseGuards(Permissions('hr.training.manage'))
  async remove(@Param('id') id: string) {
    return { success: await trainings.remove(id) };
  }

  // ---- Assignments / evaluation -------------------------------------------
  @Post(':id/assign')
  @UseGuards(Permissions('hr.training.manage'))
  async assign(@Param('id') id: string, @Body() body: { employeeIds?: string[] }) {
    const result = await assignEmployees(id, body.employeeIds ?? []);
    const { rows } = await query<{ title: string }>(
      `SELECT title FROM trainings WHERE id = $1::uuid`,
      [id]
    );
    const title = rows[0]?.title ?? 'Training';
    const employeeIds = body.employeeIds ?? [];
    const users = await Promise.all(employeeIds.map((employeeId) => findUserByEmployeeId(employeeId)));
    await notifyUsers(
      users.map((u) => u?.id),
      {
        event_type: 'training.assigned',
        title: 'Training assigned',
        message: `You have been assigned to "${title}".`,
        action_url: '/hr/training/programs',
      }
    );
    return { success: true, ...result };
  }

  @Post('assignments/:id/complete')
  @UseGuards(Permissions('hr.training.manage'))
  async complete(@Param('id') id: string, @Body() body: { status?: string; score?: number; completionDate?: string; notes?: string }) {
    return { success: true, data: await completeAssignment(id, {
      status: body.status,
      score: body.score,
      completion_date: body.completionDate,
      notes: body.notes,
    }) };
  }

  @Post('assignments/:id/status')
  @UseGuards(Permissions('hr.training.manage'))
  async setStatus(@Param('id') id: string, @Body() body: { status?: string }) {
    if (!body.status) throw new BadRequestException('status is required');
    return { success: true, data: await updateAssignmentStatus(id, body.status) };
  }

  // ---- Certificates --------------------------------------------------------
  @Post('certificates')
  @UseGuards(Permissions('hr.training.manage'))
  async createCertificate(@Body() body: Record<string, unknown>) {
    if (!body.employee_id || !body.title) throw new BadRequestException('employee_id and title are required');
    return { success: true, data: await certificates.create(body) };
  }

  @Delete('certificates/:id')
  @UseGuards(Permissions('hr.training.manage'))
  async removeCertificate(@Param('id') id: string) {
    return { success: await certificates.remove(id) };
  }
}
