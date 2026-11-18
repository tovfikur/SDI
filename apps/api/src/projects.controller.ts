import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import {
  clients, createProject, listProjects, getProject, updateProject, removeProject,
  projectDashboard, createTask, listTasks, updateTask, removeTask, isTaskAssignedTo, projectAnalytics, isProjectMember,
  createDailyTask, listDailyTasks, updateDailyTask, removeDailyTask, updateDailyTaskApproval, countTasksForEmployee,
  submitDailyTasks, countTasksOwnedBy, getDailyTaskStatuses, workLogSummary,
  canEmployeeEditLog, canEmployeeDeleteLog,
  createMeeting, listMeetings, getMeeting, updateMeeting, removeMeeting,
  projectReports,
  listSprints, createSprint, updateSprint, removeSprint,
  getTaskCounts, listMeetingAttachments, addMeetingAttachment, removeMeetingAttachment, getMeetingAttachmentDownload,
  updateProjectGeoLocation,
} from '@jsk/domain-projects';
import { parseFilters, parseSort } from '@jsk/shared-kernel';
import type { FilterParam, SortParam } from '@jsk/shared-kernel';
import { notifyEmployee, notifyAdminsWithPermission } from './notify';
import { hasAnyPermission } from '@jsk/shared-auth';
import { Permissions, withIdentity } from './auth/guards';
import type { RequestWithSession } from './auth/session';

function listQuery(q: Record<string, string>): {
  filters: FilterParam[]; sort: SortParam | null; page: number; perPage: number; search?: string;
} {
  return {
    filters: parseFilters(q),
    sort: parseSort(q['sort'], q['direction']),
    page: q['page'] ? parseInt(q['page'], 10) : 1,
    perPage: q['perPage'] ? parseInt(q['perPage'], 10) : 10,
    search: q['search'],
  };
}

/** Maps known domain error codes to meaningful client errors. */
function projectErrorToHttp(error: unknown): never {
  const msg = error instanceof Error ? error.message : '';
  if (msg === 'project.client_required') {
    throw new BadRequestException('A client is required for the project');
  }
  if (msg === 'project.card_color_invalid' || msg === 'project.text_color_invalid') {
    throw new BadRequestException(
      `${msg === 'project.card_color_invalid' ? 'Card color' : 'Text color'} must be a valid hex color such as #1E3A8A`
    );
  }
  if (msg === 'project.end_before_start') {
    throw new BadRequestException('Ending date cannot be before the start date');
  }
  throw error as Error;
}

@Controller('api/projects')
export class ProjectsController {
  // ---- Clients (FR-102) ---------------------------------------------------
  @Get('clients')
  @UseGuards(Permissions('pm.client.view'))
  async clientsList(@Query() q: Record<string, string>) {
    const { filters, sort, page, perPage, search } = listQuery(q);
    return { data: await clients.list({ filters, sort, page, per_page: perPage, search }) };
  }

  @Post('clients')
  @UseGuards(Permissions('pm.client.manage'))
  async newClient(@Body() body: Record<string, unknown>) {
    if (!body.name) throw new BadRequestException('name is required');
    return { success: true, data: await clients.create(body) };
  }

  @Put('clients/:id')
  @UseGuards(Permissions('pm.client.manage'))
  async updateClient(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return { success: true, data: await clients.update(id, body) };
  }

  @Delete('clients/:id')
  @UseGuards(Permissions('pm.client.manage'))
  async removeClient(@Param('id') id: string) {
    return { success: await clients.remove(id) };
  }

  // ---- Projects (FR-101, WF-009) ------------------------------------------
  @Get()
  async projects(@Req() req: RequestWithSession, @Query() q: Record<string, string>) {
    const { filters, sort, page, perPage } = listQuery(q);
    const identity = withIdentity(req);
    const employeeId =
      identity.employee_id && !identity.is_super_admin && !hasAnyPermission(identity, ['pm.project.view', 'pm.project.manage'])
        ? identity.employee_id
        : null;
    return { data: await listProjects({ filters, sort, page, per_page: perPage, employeeId }) };
  }

  @Get('dashboard')
  async dashboard() {
    return { data: await projectDashboard() };
  }

  @Get('analytics')
  async analytics(@Req() req: RequestWithSession) {
    const identity = withIdentity(req);
    if (identity.employee_id && !identity.is_super_admin && !hasAnyPermission(identity, ['pm.project.view', 'pm.task.manage'])) {
      return { data: await projectAnalytics(identity.employee_id) };
    }
    return { data: await projectAnalytics() };
  }

  @Get('reports')
  @UseGuards(Permissions('pm.project.view', 'report.view'))
  async reports(@Query() q: Record<string, string>) {
    if (q['status'] && !['open', 'in_progress', 'on_hold', 'completed', 'cancelled'].includes(q['status'])) {
      throw new BadRequestException('Invalid project status filter');
    }
    return projectReports({
      projectId: q['projectId'],
      clientId: q['clientId'],
      memberId: q['memberId'],
      status: q['status'],
      dateFrom: q['dateFrom'],
      dateTo: q['dateTo'],
      search: q['search'],
      sort: parseSort(q['sort'], q['direction']),
      page: q['page'] ? parseInt(q['page'], 10) : 1,
      perPage: q['perPage'] ? parseInt(q['perPage'], 10) : 10,
      all: q['all'] === 'true',
    });
  }

  // ---- Tasks (FR-103) -----------------------------------------------------
  @Get('tasks')
  async tasks(@Req() req: RequestWithSession, @Query() q: Record<string, string>) {
    const { filters, sort, page, perPage } = listQuery(q);
    // Self-service scope: employee accounts only ever see tasks assigned to them.
    const identity = withIdentity(req);
    if (identity.employee_id && !identity.is_super_admin) {
      filters.push({ field: 'assignee_id', operator: 'eq', value: identity.employee_id });
    }
    return { data: await listTasks({ filters, sort, page, per_page: perPage }) };
  }

  @Post('tasks')
  async newTask(@Req() req: RequestWithSession, @Body() body: Record<string, unknown>) {
    if (!body.project_id || !body.title) throw new BadRequestException('project_id and title are required');
    const identity = withIdentity(req);
    if (!hasAnyPermission(identity, ['pm.task.manage'])) {
      // Self-service: employees may create tasks only inside projects they are
      // part of; the backend always assigns the task to the requester.
      if (!identity.employee_id || !hasAnyPermission(identity, ['self.task.create'])) {
        throw new ForbiddenException('Insufficient permissions');
      }
      if (!(await isProjectMember(String(body.project_id), identity.employee_id))) {
        throw new ForbiddenException('Can only create tasks in projects you are part of');
      }
      body.assignee_id = identity.employee_id;
      body.status = body.status ?? 'todo';
    }
    const data = await createTask(body);
    const notifyIds = Array.isArray(body.assignee_ids)
      ? (body.assignee_ids as string[])
      : (data['assignee_id'] ? [data['assignee_id'] as string] : []);
    for (const empId of notifyIds) {
      await notifyEmployee(empId, {
        event_type: 'task.assigned',
        title: 'Task assigned to you',
        message: `"${String(data['title'] ?? body.title)}" has been assigned to you.`,
        action_url: '/me/tasks',
      });
    }
    return { success: true, data };
  }

  @Put('tasks/:id')
  async updateTask(@Req() req: RequestWithSession, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const identity = withIdentity(req);
    if (hasAnyPermission(identity, ['pm.task.manage'])) {
      const data = await updateTask(id, body);
      if (data && (body.assignee_ids || body.assignee_id)) {
        const notifyIds = Array.isArray(body.assignee_ids)
          ? (body.assignee_ids as string[])
          : (data['assignee_id'] ? [data['assignee_id'] as string] : []);
        for (const empId of notifyIds) {
          await notifyEmployee(empId, {
            event_type: 'task.assigned',
            title: 'Task assigned to you',
            message: `"${String(data['title'] ?? '')}" has been assigned to you.`,
            action_url: '/me/tasks',
          });
        }
      }
      return { success: true, data };
    }
    // Self-service: an assignee may update only status/progress/title/description of their own task.
    if (!identity.employee_id) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (!(await isTaskAssignedTo(id, identity.employee_id))) {
      throw new ForbiddenException('Can only update tasks assigned to you');
    }
    const allowed: Record<string, unknown> = {};
    if (body.status !== undefined) allowed.status = body.status;
    if (body.progress_percent !== undefined) allowed.progress_percent = body.progress_percent;
    if (body.title !== undefined) allowed.title = body.title;
    if (body.description !== undefined) allowed.description = body.description;
    if (body.assignee_id !== undefined && body.assignee_id !== identity.employee_id) {
      throw new ForbiddenException('Employees cannot reassign tasks');
    }
    if (Object.keys(allowed).length === 0) {
      throw new ForbiddenException('Employees may only update task status, progress, title or description');
    }
    return { success: true, data: await updateTask(id, allowed) };
  }

  @Delete('tasks/:id')
  @UseGuards(Permissions('pm.task.manage'))
  async removeTask(@Param('id') id: string) {
    return { success: await removeTask(id) };
  }

  // ---- Work Log / Daily tasks (FR-104) ------------------------------------
  // Self-service: any authenticated user with an employee record can read
  // their own daily tasks. The query already scopes to employee_id for
  // non-staff users; no permission guard needed.
  @Get('daily-tasks')
  async dailyTasks(@Req() req: RequestWithSession, @Query() q: Record<string, string>) {
    const identity = withIdentity(req);
    const { filters, page, perPage, search } = listQuery(q);
    // Hard scope: normal employees can only ever see their own logs.
    const canSeeAll =
      identity.is_super_admin || hasAnyPermission(identity, ['pm.daily_task.approve']);
    if (identity.employee_id && !canSeeAll) {
      filters.push({ field: 'employee_id', operator: 'eq', value: identity.employee_id });
    }
    return { data: await listDailyTasks({ filters, page, per_page: perPage, search }) };
  }

  @Get('daily-tasks/summary')
  async dailyTasksSummary(@Req() req: RequestWithSession) {
    const identity = withIdentity(req);
    const canSeeAll =
      identity.is_super_admin || hasAnyPermission(identity, ['pm.daily_task.approve']);
    return { data: await workLogSummary(canSeeAll ? null : identity.employee_id) };
  }

  @Post('daily-tasks')
  @UseGuards(Permissions('pm.daily_task.manage', 'pm.daily_task.approve'))
  async newDailyTask(@Req() req: RequestWithSession, @Body() body: Record<string, unknown>) {
    const identity = withIdentity(req);
    const isManager = hasAnyPermission(identity, ['pm.daily_task.approve']);
    // The employee comes from the authenticated session — never trust a
    // client-supplied employee_id for one's own timesheet. Only managers /
    // super admins may log on behalf of someone else via an explicit id.
    const canLogForOthers = identity.is_super_admin || isManager;
    if (!canLogForOthers || !body.employee_id) {
      if (!identity.employee_id) {
        throw new ForbiddenException('No employee profile found for the logged-in user');
      }
      body.employee_id = identity.employee_id;
    }
    if (!body.work_date) {
      throw new BadRequestException('work_date is required');
    }
    if (body.work_description === undefined && body.description !== undefined) {
      body.work_description = body.description;
    }
    if (body.hours !== undefined && (Number(body.hours) < 0 || Number(body.hours) > 24)) {
      throw new BadRequestException('hours must be between 0 and 24');
    }
    // New logs always start as Draft (workflow: Draft -> Submitted -> Approved).
    body.status = 'draft';
    return { success: true, data: await createDailyTask(body) };
  }

  @Post('daily-tasks/submit')
  @UseGuards(Permissions('pm.daily_task.manage'))
  async submitDailyTasks(@Req() req: RequestWithSession, @Body() body: { ids?: string[] }) {
    const identity = withIdentity(req);
    if (!identity.employee_id) {
      throw new ForbiddenException('Self-service submission requires an employee account');
    }
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : [];
    if (ids.length === 0) {
      throw new BadRequestException('ids are required');
    }
    const owned = await countTasksForEmployee(ids, identity.employee_id);
    if (owned !== ids.length) {
      throw new ForbiddenException('Can only submit your own work logs');
    }
    const updated = await submitDailyTasks(ids, identity.employee_id);
    await notifyAdminsWithPermission(['pm.daily_task.approve'], {
      event_type: 'daily_task.submitted',
      title: 'Work Log Submitted',
      message: `${identity.email || 'An employee'} submitted ${ids.length} work log entry/entries for approval.`,
      action_url: '/projects/daily-tasks',
    });
    return { success: true, updated };
  }

  @Post('daily-tasks/approve')
  @UseGuards(Permissions('pm.daily_task.approve'))
  async approveDailyTasks(@Req() req: RequestWithSession, @Body() body: { ids?: string[]; action?: string; rejection_reason?: string }) {
    const identity = withIdentity(req);
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : [];
    if (ids.length === 0) {
      throw new BadRequestException('ids are required');
    }
    if (body.action !== 'approve' && body.action !== 'reject') {
      throw new BadRequestException('action must be "approve" or "reject"');
    }
    if (body.action === 'reject') {
      const reason = String(body.rejection_reason ?? '').trim();
      if (reason.length === 0) {
        throw new BadRequestException('rejection_reason is required when rejecting');
      }
    }
    // Employees can never approve/reject — even their own logs.
    if (identity.employee_id) {
      const owned = await countTasksOwnedBy(ids, identity.employee_id);
      if (owned > 0) {
        throw new ForbiddenException('You cannot approve or reject your own work logs');
      }
    }
    const updated = await updateDailyTaskApproval(
      ids,
      body.action === 'approve' ? 'approved' : 'rejected',
      identity.id,
      body.rejection_reason
    );
    // Notify owner employees of the approval or rejection
    try {
      const { query } = await import('@jsk/shared-kernel');
      const { rows: taskOwners } = await query<{ employee_id: string }>(
        `SELECT DISTINCT employee_id FROM daily_tasks WHERE id = ANY($1::uuid[])`,
        [ids]
      );
      for (const row of taskOwners) {
        await notifyEmployee(row.employee_id, {
          event_type: body.action === 'approve' ? 'daily_task.approved' : 'daily_task.rejected',
          title: body.action === 'approve' ? 'Work Log Approved' : 'Work Log Rejected',
          message: body.action === 'approve'
            ? 'Your submitted work log entries have been approved.'
            : `Your work log entries were rejected: ${body.rejection_reason || 'See details in work log'}`,
          action_url: '/me/worklog',
        });
      }
    } catch {
      /* ignore notification failure */
    }
    return { success: true, updated };
  }

  @Put('daily-tasks/:id')
  @UseGuards(Permissions('pm.daily_task.manage', 'pm.daily_task.approve'))
  async editDailyTask(@Req() req: RequestWithSession, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const identity = withIdentity(req);
    const isManager = hasAnyPermission(identity, ['pm.daily_task.approve']);
    const canSeeAll = identity.is_super_admin || isManager;
    if (identity.employee_id && !canSeeAll) {
      const owned = await countTasksForEmployee([id], identity.employee_id);
      if (owned !== 1) {
        throw new ForbiddenException('Cannot edit work logs of other employees');
      }
    }
    const [row] = await getDailyTaskStatuses([id]);
    if (!row) throw new NotFoundException('Work log not found');
    if (identity.employee_id && !canSeeAll && !canEmployeeEditLog(row.status)) {
      throw new ForbiddenException('Only Draft or Rejected logs can be edited');
    }
    if (canSeeAll && row.status === 'approved' && !identity.is_super_admin) {
      throw new ForbiddenException('Approved work logs are read-only');
    }
    if (identity.employee_id && !canSeeAll) {
      body.employee_id = identity.employee_id;
    }
    delete body.status;
    delete body.approved_by;
    delete body.rejected_by;
    return { success: true, data: await updateDailyTask(id, body) };
  }

  @Delete('daily-tasks/:id')
  @UseGuards(Permissions('pm.daily_task.manage', 'pm.daily_task.approve'))
  async deleteDailyTask(@Req() req: RequestWithSession, @Param('id') id: string) {
    const identity = withIdentity(req);
    const isManager = hasAnyPermission(identity, ['pm.daily_task.approve']);
    const canSeeAll = identity.is_super_admin || isManager;
    if (identity.employee_id && !canSeeAll) {
      const owned = await countTasksForEmployee([id], identity.employee_id);
      if (owned !== 1) {
        throw new ForbiddenException('Cannot delete work logs of other employees');
      }
    }
    const [row] = await getDailyTaskStatuses([id]);
    if (!row) throw new NotFoundException('Work log not found');
    if (identity.employee_id && !canSeeAll && !canEmployeeDeleteLog(row.status)) {
      throw new ForbiddenException('Only Draft or Rejected logs can be deleted');
    }
    if (canSeeAll && row.status === 'approved' && !identity.is_super_admin) {
      throw new ForbiddenException('Approved work logs are read-only');
    }
    return { success: await removeDailyTask(id) };
  }

  // ---- Meetings (FR-105, WF-010) ------------------------------------------
  @Get('meetings')
  async meetings(@Query() q: Record<string, string>) {
    const { filters, page, perPage, search } = listQuery(q);
    return { data: await listMeetings({ filters, page, per_page: perPage, search }) };
  }

  @Get('meetings/:id')
  async meeting(@Param('id') id: string) {
    const meeting = await getMeeting(id);
    if (!meeting) throw new NotFoundException('Meeting not found');
    return { data: meeting };
  }

  @Post('meetings')
  @UseGuards(Permissions('pm.meeting.manage'))
  async newMeeting(@Body() body: Record<string, unknown>) {
    if (!body.project_id || !body.place || !body.held_at) {
      throw new BadRequestException('project_id, place and held_at are required');
    }
    const data = await createMeeting(body);
    const attendeeIds = Array.isArray(body.attendee_ids) ? (body.attendee_ids as string[]) : [];
    for (const empId of attendeeIds) {
      await notifyEmployee(empId, {
        event_type: 'meeting.invitation',
        title: 'Meeting Scheduled',
        message: `You are invited to meeting: "${String(body.purpose || body.place || 'Project Meeting')}" on ${String(body.held_at || '')}.`,
        action_url: '/projects/meetings',
      });
    }
    return { success: true, data };
  }

  @Put('meetings/:id')
  @UseGuards(Permissions('pm.meeting.manage'))
  async editMeeting(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return { success: true, data: await updateMeeting(id, body) };
  }

  @Delete('meetings/:id')
  @UseGuards(Permissions('pm.meeting.manage'))
  async deleteMeeting(@Param('id') id: string) {
    return { success: await removeMeeting(id) };
  }

  // ---- Meeting Attachments (Spec 5.3) --------------------------------------
  @Get('meetings/:id/attachments')
  @UseGuards(Permissions('pm.meeting.view'))
  async meetingAttachments(@Param('id') id: string) {
    return { data: await listMeetingAttachments(id) };
  }

  @Post('meetings/:id/attachments')
  @UseGuards(Permissions('pm.meeting.manage'))
  async addAttachment(@Param('id') id: string, @Body() body: { file_name: string; file_size: number; mime_type?: string; storage_key: string }) {
    return { success: true, data: await addMeetingAttachment({ ...body, meeting_id: id }) };
  }

  @Delete('meetings/attachments/:id')
  @UseGuards(Permissions('pm.meeting.manage'))
  async deleteAttachment(@Param('id') id: string) {
    return { success: await removeMeetingAttachment(id) };
  }

  @Get('meetings/attachments/:id/download')
  @UseGuards(Permissions('pm.meeting.view'))
  async downloadAttachment(@Param('id') id: string) {
    return { data: await getMeetingAttachmentDownload(id) };
  }

  // ---- Sprints (Spec 5.3) --------------------------------------------------
  @Get(':projectId/sprints')
  async sprints(@Req() req: RequestWithSession, @Param('projectId') projectId: string) {
    const identity = withIdentity(req);
    if (
      identity.employee_id &&
      !identity.is_super_admin &&
      !hasAnyPermission(identity, ['pm.project.view', 'pm.project.manage']) &&
      !(await isProjectMember(projectId, identity.employee_id))
    ) {
      throw new NotFoundException('Project not found');
    }
    return { data: await listSprints(projectId) };
  }

  @Post(':projectId/sprints')
  @UseGuards(Permissions('pm.project.manage'))
  async newSprint(@Param('projectId') projectId: string, @Body() body: { name: string; goal?: string; start_date?: string; end_date?: string }) {
    return { success: true, data: await createSprint({ ...body, project_id: projectId }) };
  }

  @Put('sprints/:id')
  @UseGuards(Permissions('pm.project.manage'))
  async editSprint(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return { success: true, data: await updateSprint(id, body as never) };
  }

  @Delete('sprints/:id')
  @UseGuards(Permissions('pm.project.manage'))
  async deleteSprint(@Param('id') id: string) {
    return { success: await removeSprint(id) };
  }

  // ---- Task Counts (Spec 5.3) ----------------------------------------------
  @Get(':projectId/task-counts')
  async taskCounts(@Req() req: RequestWithSession, @Param('projectId') projectId: string) {
    const identity = withIdentity(req);
    if (
      identity.employee_id &&
      !identity.is_super_admin &&
      !hasAnyPermission(identity, ['pm.project.view', 'pm.project.manage']) &&
      !(await isProjectMember(projectId, identity.employee_id))
    ) {
      throw new NotFoundException('Project not found');
    }
    return { data: await getTaskCounts(projectId) };
  }

  // ---- Geo-Location (Spec 5.2) ---------------------------------------------
  @Put(':projectId/geo-location')
  @UseGuards(Permissions('pm.project.manage'))
  async geoLocation(@Param('projectId') projectId: string, @Body() body: { latitude: number; longitude: number; check_in_radius?: number }) {
    return { success: true, data: await updateProjectGeoLocation(projectId, body) };
  }

  // ---- Project CRUD (:id must come last so static routes match first) ------
  @Get(':id')
  async project(@Req() req: RequestWithSession, @Param('id') id: string) {
    const identity = withIdentity(req);
    if (
      identity.employee_id &&
      !identity.is_super_admin &&
      !hasAnyPermission(identity, ['pm.project.view', 'pm.project.manage']) &&
      !(await isProjectMember(id, identity.employee_id))
    ) {
      throw new NotFoundException('Project not found');
    }
    const project = await getProject(id);
    if (!project) throw new NotFoundException('Project not found');
    return { data: project };
  }

  @Post()
  @UseGuards(Permissions('pm.project.manage'))
  async newProject(@Body() body: Record<string, unknown>) {
    if (!body.name) throw new BadRequestException('name is required');
    try {
      return { success: true, data: await createProject(body as never) };
    } catch (error) {
      projectErrorToHttp(error);
    }
  }

  @Put(':id')
  @UseGuards(Permissions('pm.project.manage'))
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    try {
      return { success: true, data: await updateProject(id, body as never) };
    } catch (error) {
      projectErrorToHttp(error);
    }
  }

  @Delete(':id')
  @UseGuards(Permissions('pm.project.manage'))
  async remove(@Param('id') id: string) {
    return { success: await removeProject(id) };
  }
}
