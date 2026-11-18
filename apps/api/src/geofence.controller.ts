import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createAssignment,
  createGeofence,
  deactivateGeofence,
  getGeofence,
  listAssignments,
  listGeofenceEvents,
  listGeofences,
  removeAssignment,
  updateAssignment,
  updateGeofence,
  geofenceLiveSummary,
} from '@jsk/domain-geofence';
import type {
  AssignmentCreateInput,
  AssignmentUpdateInput,
  GeofenceUpdateInput,
} from '@jsk/domain-geofence';
import { Permissions } from './auth/guards';
import type { RequestWithSession } from './auth/session';

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Maps domain error codes (thrown as Error('geofence.<code>')) to HTTP errors. */
function throwGeofenceError(err: unknown): never {
  if (err instanceof Error && err.message.startsWith('geofence.')) {
    const code = err.message;
    switch (code) {
      case 'geofence.not_found':
        throw new NotFoundException('Geofence not found');
      case 'geofence.invalid_name':
        throw new BadRequestException('Geofence name is required');
      case 'geofence.invalid_coordinates':
        throw new BadRequestException('Invalid geofence center coordinates');
      case 'geofence.invalid_radius':
        throw new BadRequestException('Invalid geofence radius (must be between 10 m and 100 km)');
      case 'geofence.invalid_scope':
        throw new BadRequestException('A geofence assignment must target exactly one scope');
      case 'geofence.assignment_exists':
        throw new ConflictException('This scope already has a geofence assignment');
      default:
        throw new BadRequestException(err.message);
    }
  }
  throw err;
}

@Controller('api/geofences')
export class GeofenceController {
  // ---- Configuration (geofences + assignments) -------------------------------

  @Get()
  @UseGuards(Permissions('geofence.view'))
  async list(@Query() q: Record<string, string>) {
    try {
      const input: { page?: number; per_page?: number; search?: string; status?: 'active' | 'inactive' } = {};
      if (q['page']) input.page = parseInt(q['page'], 10);
      if (q['perPage']) input.per_page = parseInt(q['perPage'], 10);
      if (q['search']) input.search = q['search'];
      if (q['status'] === 'active' || q['status'] === 'inactive') input.status = q['status'];
      return { data: await listGeofences(input) };
    } catch (err) {
      throwGeofenceError(err);
    }
  }

  @Post()
  @UseGuards(Permissions('geofence.manage'))
  async create(@Req() req: RequestWithSession, @Body() body: Record<string, unknown>) {
    try {
      const latitude = toNumber(body['centerLatitude']);
      const longitude = toNumber(body['centerLongitude']);
      const radius = toNumber(body['radiusMeters']);
      if (latitude === null || longitude === null || radius === null) {
        throw new BadRequestException(
          'centerLatitude, centerLongitude and radiusMeters are required'
        );
      }
      const geofence = await createGeofence({
        name: typeof body['name'] === 'string' ? body['name'] : '',
        ...(typeof body['description'] === 'string'
          ? { description: body['description'] }
          : {}),
        center_latitude: latitude,
        center_longitude: longitude,
        radius_meters: radius,
        ...(req.identity?.id ? { created_by: req.identity.id } : {}),
      });
      return { success: true, data: geofence };
    } catch (err) {
      throwGeofenceError(err);
    }
  }

  // ---- Breach history + live summary -----------------------------------------

  @Get('breaches')
  @UseGuards(Permissions('geofence.breach.view'))
  async breaches(@Query() q: Record<string, string>) {
    try {
      const input: {
        employee_id?: string;
        geofence_id?: string;
        event_type?: 'entered' | 'exited';
        date_from?: string;
        date_to?: string;
        page?: number;
        per_page?: number;
      } = {};
      if (q['employeeId']) input.employee_id = q['employeeId'];
      if (q['geofenceId']) input.geofence_id = q['geofenceId'];
      if (q['eventType'] === 'entered' || q['eventType'] === 'exited') {
        input.event_type = q['eventType'];
      }
      if (q['dateFrom']) input.date_from = q['dateFrom'];
      if (q['dateTo']) input.date_to = q['dateTo'];
      if (q['page']) input.page = parseInt(q['page'], 10);
      if (q['perPage']) input.per_page = parseInt(q['perPage'], 10);
      return { data: await listGeofenceEvents(input) };
    } catch (err) {
      throwGeofenceError(err);
    }
  }

  @Get('live/summary')
  @UseGuards(Permissions('geofence.breach.view'))
  async liveSummary() {
    return { data: await geofenceLiveSummary() };
  }

  @Get(':id')
  @UseGuards(Permissions('geofence.view'))
  async detail(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw new BadRequestException('Invalid geofence id');
    }
    const geofence = await getGeofence(id);
    if (!geofence) {
      throw new NotFoundException('Geofence not found');
    }
    return { data: { ...geofence, assignments: await listAssignments(id) } };
  }

  @Patch(':id')
  @UseGuards(Permissions('geofence.manage'))
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    try {
      if (!isUuid(id)) {
        throw new BadRequestException('Invalid geofence id');
      }
      const patch: GeofenceUpdateInput = {};
      if (body['name'] !== undefined) patch.name = String(body['name']);
      if (body['description'] !== undefined) patch.description = String(body['description']);
      const lat = toNumber(body['centerLatitude']);
      const lng = toNumber(body['centerLongitude']);
      if (lat !== null) patch.center_latitude = lat;
      if (lng !== null) patch.center_longitude = lng;
      const radius = toNumber(body['radiusMeters']);
      if (radius !== null) patch.radius_meters = radius;
      if (body['status'] === 'active' || body['status'] === 'inactive') patch.status = body['status'];
      const geofence = await updateGeofence(id, patch);
      if (!geofence) {
        throw new NotFoundException('Geofence not found');
      }
      return { success: true, data: geofence };
    } catch (err) {
      throwGeofenceError(err);
    }
  }

  @Delete(':id')
  @UseGuards(Permissions('geofence.manage'))
  async deactivate(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw new BadRequestException('Invalid geofence id');
    }
    const ok = await deactivateGeofence(id);
    if (!ok) {
      throw new NotFoundException('Geofence not found');
    }
    return { success: true, data: { id, status: 'inactive' } };
  }

  // ---- Assignments -----------------------------------------------------------

  @Get(':id/assignments')
  @UseGuards(Permissions('geofence.view'))
  async assignments(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw new BadRequestException('Invalid geofence id');
    }
    return { data: await listAssignments(id) };
  }

  @Post(':id/assignments')
  @UseGuards(Permissions('geofence.assign'))
  async createAssignmentRoute(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    try {
      if (!isUuid(id)) {
        throw new BadRequestException('Invalid geofence id');
      }
      const scopeType = body['scopeType'];
      const scopeId = typeof body['scopeId'] === 'string' ? body['scopeId'] : '';
      if (
        !['employee', 'department', 'employee_type', 'setup_rule'].includes(String(scopeType)) ||
        !scopeId
      ) {
        throw new BadRequestException('scopeType (employee|department|employee_type|setup_rule) and scopeId are required');
      }
      const input: AssignmentCreateInput = {
        geofence_id: id,
        scope: { type: scopeType as AssignmentCreateInput['scope']['type'], id: scopeId },
      };
      const enabled = toBoolean(body['enabled']);
      const restrictIn = toBoolean(body['restrictCheckIn']);
      const restrictOut = toBoolean(body['restrictCheckOut']);
      const monitor = toBoolean(body['monitorExit']);
      const flag = toBoolean(body['flagExit']);
      if (enabled !== undefined) input.enabled = enabled;
      if (restrictIn !== undefined) input.restrict_check_in = restrictIn;
      if (restrictOut !== undefined) input.restrict_check_out = restrictOut;
      if (monitor !== undefined) input.monitor_exit = monitor;
      if (flag !== undefined) input.flag_exit = flag;
      return { success: true, data: await createAssignment(input) };
    } catch (err) {
      throwGeofenceError(err);
    }
  }

  @Patch('assignments/:assignmentId')
  @UseGuards(Permissions('geofence.assign'))
  async updateAssignmentRoute(@Param('assignmentId') assignmentId: string, @Body() body: Record<string, unknown>) {
    try {
      if (!isUuid(assignmentId)) {
        throw new BadRequestException('Invalid assignment id');
      }
      const patch: AssignmentUpdateInput = {};
      const enabled = toBoolean(body['enabled']);
      const restrictIn = toBoolean(body['restrictCheckIn']);
      const restrictOut = toBoolean(body['restrictCheckOut']);
      const monitor = toBoolean(body['monitorExit']);
      const flag = toBoolean(body['flagExit']);
      if (enabled !== undefined) patch.enabled = enabled;
      if (restrictIn !== undefined) patch.restrict_check_in = restrictIn;
      if (restrictOut !== undefined) patch.restrict_check_out = restrictOut;
      if (monitor !== undefined) patch.monitor_exit = monitor;
      if (flag !== undefined) patch.flag_exit = flag;
      const assignment = await updateAssignment(assignmentId, patch);
      if (!assignment) {
        throw new NotFoundException('Assignment not found');
      }
      return { success: true, data: assignment };
    } catch (err) {
      throwGeofenceError(err);
    }
  }

  @Delete('assignments/:assignmentId')
  @UseGuards(Permissions('geofence.assign'))
  async removeAssignmentRoute(@Param('assignmentId') assignmentId: string) {
    if (!isUuid(assignmentId)) {
      throw new BadRequestException('Invalid assignment id');
    }
    const ok = await removeAssignment(assignmentId);
    if (!ok) {
      throw new NotFoundException('Assignment not found');
    }
    return { success: true, data: { id: assignmentId, removed: true } };
  }
}