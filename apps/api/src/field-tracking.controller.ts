import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  fieldCheckIn,
  fieldCheckOut,
  recordFieldLocation,
  recordFieldLocationsBatch,
  getFieldTrackingStatus,
  listFieldTrackingLive,
  getFieldTrackingRoute,
  listFieldTrackingSessions,
  FIELD_LOCATION_BATCH_MAX,
} from '@jsk/domain-attendance';
import type { FieldLocationPointInput } from '@jsk/domain-attendance';
import { isIsoDate } from '@jsk/shared-kernel';
import { Permissions } from './auth/guards';
import type { RequestWithSession } from './auth/session';

/** The authenticated user's own mapped employee (never trusted from the client). */
function employeeIdOf(req: RequestWithSession): string {
  const employeeId = req.identity?.employee_id ?? null;
  if (!employeeId) {
    throw new BadRequestException('No employee profile is linked to this user');
  }
  return employeeId;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function numOrNull(value: unknown): number | null {
  return toFiniteNumber(value);
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function toPoint(body: Record<string, unknown>, requireCoords: boolean): FieldLocationPointInput {
  const latitude = toFiniteNumber(body['latitude']);
  const longitude = toFiniteNumber(body['longitude']);
  if (requireCoords && (latitude === null || longitude === null)) {
    throw new BadRequestException('latitude and longitude are required');
  }
  return {
    latitude: latitude as number,
    longitude: longitude as number,
    accuracy: numOrNull(body['accuracy']),
    altitude: numOrNull(body['altitude']),
    speed: numOrNull(body['speed']),
    heading: numOrNull(body['heading']),
    captured_at: strOrNull(body['capturedAt']),
    battery_level: toFiniteNumber(body['batteryLevel']),
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Maps domain error codes (thrown as Error('field_tracking.<code>')) to HTTP errors. */
function throwFieldTrackingError(err: unknown): never {
  if (err instanceof Error && err.message.startsWith('field_tracking.')) {
    const code = err.message;
    switch (code) {
      case 'field_tracking.already_active':
        throw new ConflictException('You are already checked in');
      case 'field_tracking.no_active_session':
        throw new BadRequestException('No active field tracking session — check in first');
      case 'field_tracking.batch_too_large':
        throw new BadRequestException(
          `Batch too large — maximum ${FIELD_LOCATION_BATCH_MAX} points per request`
        );
      case 'field_tracking.invalid_latitude':
        throw new BadRequestException('Invalid latitude (must be between -90 and 90)');
      case 'field_tracking.invalid_longitude':
        throw new BadRequestException('Invalid longitude (must be between -180 and 180)');
      case 'field_tracking.invalid_accuracy':
        throw new BadRequestException('Invalid accuracy (must be a non-negative number)');
      case 'field_tracking.invalid_captured_at':
        throw new BadRequestException('Invalid capturedAt (expected an ISO-8601 timestamp)');
      case 'field_tracking.invalid_date':
        throw new BadRequestException('Invalid date (expected YYYY-MM-DD)');
      case 'field_tracking.checkin_event_conflict':
        throw new ConflictException('Check-in attendance event could not be recorded');
      case 'field_tracking.checkout_event_conflict':
        throw new ConflictException('Check-out attendance event could not be recorded');
      default:
        throw new BadRequestException(err.message);
    }
  }
  if (err instanceof Error && err.message === 'OUTSIDE_PROJECT_RANGE') {
    throw new ForbiddenException({
      message: 'You are outside the assigned project attendance range.',
      code: 'OUTSIDE_PROJECT_RANGE',
      insideProjectRange: false,
    });
  }
  if (err instanceof Error && err.message.startsWith('geofence.')) {
    const code = err.message;
    switch (code) {
      case 'geofence.outside_checkin':
        throw new ForbiddenException({
          message: 'You are outside your allowed attendance area.',
          code: 'OUTSIDE_GEOFENCE',
          insideGeofence: false,
        });
      case 'geofence.outside_checkout':
        throw new ForbiddenException({
          message: 'You are outside your allowed checkout area.',
          code: 'OUTSIDE_GEOFENCE',
          insideGeofence: false,
        });
      case 'geofence.accuracy_insufficient':
        throw new UnprocessableEntityException({
          message: 'GPS accuracy is too low — move to an open area and try again.',
          code: 'LOCATION_ACCURACY_INSUFFICIENT',
          insideGeofence: null,
        });
      default:
        throw new BadRequestException(err.message);
    }
  }
  throw err;
}

@Controller('api/field-tracking')
export class FieldTrackingController {
  // ---- Employee self service -------------------------------------------------

  @Post('check-in')
  async checkIn(@Req() req: RequestWithSession, @Body() body: Record<string, unknown>) {
    try {
      const point = toPoint(body, true);
      const session = await fieldCheckIn({
        employee_id: employeeIdOf(req),
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy ?? null,
        device_id: strOrNull(body['deviceId']),
        captured_at: point.captured_at ?? null,
      });
      return { success: true, data: session };
    } catch (err) {
      throwFieldTrackingError(err);
    }
  }

  @Post('location')
  async location(@Req() req: RequestWithSession, @Body() body: Record<string, unknown>) {
    try {
      const point = toPoint(body, true);
      const result = await recordFieldLocation({
        employee_id: employeeIdOf(req),
        point,
      });
      return { success: true, ...result };
    } catch (err) {
      throwFieldTrackingError(err);
    }
  }

  @Post('locations/batch')
  async locationsBatch(@Req() req: RequestWithSession, @Body() body: { points?: unknown }) {
    try {
      if (!Array.isArray(body.points)) {
        throw new BadRequestException('points array is required');
      }
      const points = body.points.map((raw) =>
        toPoint((raw as Record<string, unknown>) ?? {}, true)
      );
      const result = await recordFieldLocationsBatch({
        employee_id: employeeIdOf(req),
        points,
      });
      return { success: true, ...result };
    } catch (err) {
      throwFieldTrackingError(err);
    }
  }

  @Post('check-out')
  async checkOut(@Req() req: RequestWithSession, @Body() body: Record<string, unknown>) {
    try {
      const point = toPoint(body, true);
      const session = await fieldCheckOut({
        employee_id: employeeIdOf(req),
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy ?? null,
        captured_at: point.captured_at ?? null,
      });
      return { success: true, data: session };
    } catch (err) {
      throwFieldTrackingError(err);
    }
  }

  @Get('me/status')
  async meStatus(@Req() req: RequestWithSession) {
    return { data: await getFieldTrackingStatus(employeeIdOf(req)) };
  }

  // ---- Admin / manager -------------------------------------------------------

  @Get('live')
  @UseGuards(Permissions('hr.attendance.field.view_all', 'hr.attendance.field.report'))
  async live() {
    return { data: await listFieldTrackingLive() };
  }

  @Get('employees/:employeeId/route')
  @UseGuards(Permissions('hr.attendance.field.view_all', 'hr.attendance.field.report'))
  async route(@Param('employeeId') employeeId: string, @Query('date') date?: string) {
    try {
      if (!employeeId || !isUuid(employeeId)) {
        throw new BadRequestException('Invalid employeeId');
      }
      const routeDate = date && date.trim() !== '' ? date.trim() : todayInOrgTime();
      if (!isIsoDate(routeDate)) {
        throw new BadRequestException('Invalid date (expected YYYY-MM-DD)');
      }
      return { data: await getFieldTrackingRoute(employeeId, routeDate) };
    } catch (err) {
      throwFieldTrackingError(err);
    }
  }

  @Get('sessions')
  @UseGuards(Permissions('hr.attendance.field.view_all', 'hr.attendance.field.report'))
  async sessions(@Query() q: Record<string, string>) {
    try {
      const input: {
        employee_id?: string;
        status?: string;
        date_from?: string;
        date_to?: string;
        page?: number;
        per_page?: number;
      } = {};
      if (q['employeeId']) input.employee_id = q['employeeId'];
      if (q['status']) input.status = q['status'];
      if (q['dateFrom']) input.date_from = q['dateFrom'];
      if (q['dateTo']) input.date_to = q['dateTo'];
      if (q['page']) input.page = parseInt(q['page'], 10);
      if (q['perPage']) input.per_page = parseInt(q['perPage'], 10);
      return { data: await listFieldTrackingSessions(input) };
    } catch (err) {
      throwFieldTrackingError(err);
    }
  }
}

/** YYYY-MM-DD in the org timezone (Asia/Dhaka). */
function todayInOrgTime(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
}
