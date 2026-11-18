import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res, UseGuards, BadRequestException, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { randomBytes } from 'crypto';
import { hashPassword, revokeAllSessionsForUser } from '@jsk/shared-auth';
import { sendEmail } from '@jsk/domain-notifications';
import {
  departments, employeeTypes, positions, subDepartments, holidays, setupRules, branches,
  listEmployees, listEmployeesPage, exportEmployees, getEmployee, createEmployee, updateEmployee,
  removeEmployee, setEmployeeStatus, createPerformance, listPerformances, listPerformancesPage,
  createTransfer, listTransfers,
  listIdCards, createIdCard, removeIdCard,
  listResignations, createResignation, updateResignationStatus,
  listNotices, createNotice, updateNotice, removeNotice,
  listLoans, createLoan, updateLoanStatus,
  listPolicies, createPolicy, updatePolicy, removePolicy,
  getSettings, updateSettings,
  getPerformance, updatePerformance, removePerformance,
  updateTransferStatus,
  validateEmployeeCreate,
  employeeAnalytics, performanceTrend,
  validateSetupRuleInput,
  APPRAISAL_SECTION_A_CRITERIA, APPRAISAL_SECTION_B_CRITERIA, APPRAISAL_RATINGS, countWords,
  updateMyProfile,
} from '@jsk/domain-hr';
import type { ListInput } from '@jsk/domain-hr';
import { query } from '@jsk/shared-kernel';
import { Permissions, withIdentity } from './auth/guards';
import { hasAnyPermission } from '@jsk/shared-auth';
import type { RequestWithSession } from './auth/session';
import { hrDashboard } from './hr-dashboard.service';

/** Staff roles see the full HR dataset; plain employees only see their own. */
const HR_STAFF_PERMS = ['hr.employee.view', 'hr.employee.update', 'hr.employee.create', 'hr.employee.delete'];

const isPgUniqueViolation = (err: unknown, constraint: string): boolean =>
  err instanceof Error && /duplicate key value violates unique constraint/.test(err.message) && err.message.includes(constraint);

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function generateTempPassword(): string {
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out += CHARSET[randomBytes(1)[0] % CHARSET.length];
  }
  return out;
}

interface EmployeeCredentials {
  username: string;
  email: string | null;
  temporary_password: string;
}

/** Derive a login username from an employee code (emails are optional, so the
 *  portal account is keyed on employee_id + a stable username). */
function deriveLoginUsername(employeeCode: string): string {
  const base = employeeCode
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base) return base;
  return `user-${randomBytes(4).toString('hex')}`;
}

/** Creates (or reuses) the application login account for an employee. Returns
 *  the one-time credentials, or null when the email is already linked to an
 *  existing account. Employees without an email get a username derived from
 *  their employee code. */
async function ensureEmployeeUserAccount(employee: {
  id: string;
  employee_code: string;
  email: string | null;
  full_name: string;
}): Promise<EmployeeCredentials | null> {
  const email = (employee.email ?? '').trim().toLowerCase();
  const username = email || deriveLoginUsername(employee.employee_code);
  const existing = await query<{ id: string }>(
    'SELECT id FROM users WHERE lower(email) = $1 AND deleted_at IS NULL',
    [email]
  );
  if (email && existing.rows.length > 0) {
    // Email already has a linked account — never create a duplicate.
    return null;
  }
  const temporary_password = generateTempPassword();
  const passwordHash = hashPassword(temporary_password);
  const { rows } = await query(
    `INSERT INTO users (username, email, full_name, password_hash, is_active, employee_id, must_change_password)
     VALUES ($1, $2, $3, $4, true, $5, true)
     ON CONFLICT (username) DO NOTHING
     RETURNING id`,
    [username, email || null, employee.full_name, passwordHash, employee.id]
  );
  if (rows.length === 0) {
    throw new ConflictException('An account already exists for this employee.');
  }
  const employeeRole = await query<{ id: string }>('SELECT id FROM roles WHERE name = $1', ['employee']);
  if (employeeRole.rows.length > 0 && rows[0]?.id) {
    await query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [rows[0].id, employeeRole.rows[0].id]
    );
  }
  if (email) {
    try {
      await sendEmail({
        to: email,
        subject: 'SDI — Your new account credentials',
        text:
          `Hello ${employee.full_name},\n\n` +
          `Your SDI employee account has been created.\n\n` +
          `Login email: ${username}\n` +
          `Temporary password: ${temporary_password}\n\n` +
          `Sign in at the SDI portal. You will be asked to set a new password on first login.\n\n` +
          `If you did not expect this email, please contact your HR administrator.`,
      });
    } catch (error) {
      new Logger('EmployeeCredentials').warn(`welcome email failed for ${email}: ${(error as Error).message}`);
    }
  }
  return { username, email: email || null, temporary_password };
}

async function employeeExists(id: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false;
  const { rows } = await query<{ id: string }>('SELECT id FROM employees WHERE id = $1::uuid', [id]);
  return rows.length > 0;
}

function validateAppraisalInput(body: Record<string, unknown>): void {
  const validSections = (s: unknown, fixedCriteria: readonly string[], section: 'A' | 'B'): void => {
    if (s === undefined || s === null) return;
    if (!Array.isArray(s)) throw new BadRequestException(`section_${section} must be an array`);
    for (const row of s as Array<Record<string, unknown>>) {
      const criterion = String(row.criterion ?? '').trim();
      if (!criterion) throw new BadRequestException(`section_${section} criterion is required`);
      const rating = row.rating;
      if (typeof rating !== 'string' || !APPRAISAL_RATINGS.includes(rating as never)) {
        throw new BadRequestException(`section_${section} rating for "${criterion}" must be one of ${APPRAISAL_RATINGS.join(', ')}`);
      }
      if (!fixedCriteria.includes(criterion)) {
        throw new BadRequestException(`section_${section} criterion "${criterion}" is not a valid appraisal criterion`);
      }
    }
    const expected = fixedCriteria.length;
    if ((s as unknown[]).length > expected) {
      throw new BadRequestException(`section_${section} accepts at most ${expected} criteria`);
    }
  };
  validSections(body.section_a, APPRAISAL_SECTION_A_CRITERIA as readonly string[], 'A');
  validSections(body.section_b, APPRAISAL_SECTION_B_CRITERIA as readonly string[], 'B');
  if (body.employee_comments !== undefined && body.employee_comments !== null) {
    const text = String(body.employee_comments);
    if (countWords(text) > 500) {
      throw new BadRequestException('employee_comments must not exceed 500 words');
    }
  }
  if (body.next_review_date && typeof body.next_review_date === 'string') {
    if (Number.isNaN(new Date(body.next_review_date).getTime())) {
      throw new BadRequestException('next_review_date must be a valid date');
    }
    if (body.performance_date && typeof body.performance_date === 'string') {
      const perf = new Date(body.performance_date).getTime();
      const next = new Date(body.next_review_date).getTime();
      if (!Number.isNaN(perf) && next < perf) {
        throw new BadRequestException('next_review_date cannot be before the performance date');
      }
    }
  }
}

function parseListQuery(q: {
  page?: string; perPage?: string; search?: string; sort?: string; dir?: string;
  departmentId?: string; subDepartmentId?: string; employeeTypeId?: string; positionId?: string; status?: string; gender?: string;
}): { filters: ListInput['filters']; search?: string | undefined; sort?: ListInput['sort']; page?: number; per_page?: number } {
  const filters: NonNullable<ListInput['filters']> = [];
  const eq = (field: string, value: string | undefined) => {
    if (value) filters.push({ field, value, operator: 'eq' });
  };
  eq('department_id', q.departmentId);
  eq('sub_department_id', q.subDepartmentId);
  eq('employee_type_id', q.employeeTypeId);
  eq('position_id', q.positionId);
  eq('status', q.status);
  eq('gender', q.gender);
  const sort = q.sort ? { field: q.sort, direction: (q.dir === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc' } : null;
  return {
    filters,
    search: q.search,
    sort,
    page: q.page ? parseInt(q.page, 10) : 1,
    per_page: q.perPage ? parseInt(q.perPage, 10) : 10,
  };
}

@Controller('api/hr')
export class HrController {
  // ---- Masters (FR-010..024) ---------------------------------------------
  @Get('departments')
  async departmentsList(@Query() q: Record<string, string>) {
    return { data: await departments.list(parseListQuery(q)) };
  }

  @Get('sub-departments')
  async subDepartmentsList(@Query() q: Record<string, string>) {
    return { data: await subDepartments.list(parseListQuery(q)) };
  }

  @Get('employee-types')
  async employeeTypesList(@Query() q: Record<string, string>) {
    return { data: await employeeTypes.list(parseListQuery(q)) };
  }

  @Get('positions')
  async positionsList(@Query() q: Record<string, string>) {
    return { data: await positions.list(parseListQuery(q)) };
  }

  @Get('holidays')
  async holidaysList(@Query() q: Record<string, string>) {
    return { data: await holidays.list(parseListQuery(q)) };
  }

  @Get('setup-rules')
  async setupRulesList(@Query() q: Record<string, string>) {
    return { data: await setupRules.list(parseListQuery(q)) };
  }

  @Get('branches')
  async branchesList(@Query() q: Record<string, string>) {
    return { data: await branches.list(parseListQuery(q)) };
  }

  @Get('branches/:id')
  async getBranch(@Param('id') id: string) {
    const b = await branches.get(id);
    if (!b) throw new NotFoundException('Branch not found');
    return { data: b };
  }

  @Post('branches')
  @UseGuards(Permissions('hr.masters.create'))
  async createBranch(@Body() body: { name: string; code?: string; address?: string; latitude?: number; longitude?: number; radius_meters?: number }) {
    if (!body.name?.trim()) throw new BadRequestException('name is required');
    return { success: true, data: await branches.create(body) };
  }

  @Put('branches/:id')
  @UseGuards(Permissions('hr.masters.update'))
  async updateBranch(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return { success: true, data: await branches.update(id, body as any) };
  }

  @Delete('branches/:id')
  @UseGuards(Permissions('hr.masters.delete'))
  async deleteBranch(@Param('id') id: string) {
    return { success: await branches.remove(id) };
  }

  @Post('departments')
  @UseGuards(Permissions('hr.masters.create'))
  async createDepartment(@Body() body: { name: string }) {
    if (!body.name?.trim()) throw new BadRequestException('name is required');
    return { success: true, data: await departments.create(body) };
  }

  @Put('departments/:id')
  @UseGuards(Permissions('hr.masters.update'))
  async updateDepartment(@Param('id') id: string, @Body() body: { name?: string; is_active?: boolean }) {
    return { success: true, data: await departments.update(id, body) };
  }

  @Delete('departments/:id')
  @UseGuards(Permissions('hr.masters.delete'))
  async deleteDepartment(@Param('id') id: string) {
    return { success: await departments.remove(id) };
  }

  @Post('sub-departments')
  @UseGuards(Permissions('hr.masters.create'))
  async createSubDepartment(@Body() body: { name: string; department_id: string }) {
    if (!body.name?.trim() || !body.department_id) throw new BadRequestException('name and department_id are required');
    return { success: true, data: await subDepartments.create(body) };
  }

  @Put('sub-departments/:id')
  @UseGuards(Permissions('hr.masters.update'))
  async updateSubDepartment(@Param('id') id: string, @Body() body: { name?: string; is_active?: boolean }) {
    return { success: true, data: await subDepartments.update(id, body) };
  }

  @Delete('sub-departments/:id')
  @UseGuards(Permissions('hr.masters.delete'))
  async deleteSubDepartment(@Param('id') id: string) {
    return { success: await subDepartments.remove(id) };
  }

  @Post('employee-types')
  @UseGuards(Permissions('hr.masters.create'))
  async createEmployeeType(@Body() body: { name: string }) {
    return { success: true, data: await employeeTypes.create(body) };
  }

  @Put('employee-types/:id')
  @UseGuards(Permissions('hr.masters.update'))
  async updateEmployeeType(@Param('id') id: string, @Body() body: { name?: string; is_active?: boolean }) {
    return { success: true, data: await employeeTypes.update(id, body) };
  }

  @Delete('employee-types/:id')
  @UseGuards(Permissions('hr.masters.delete'))
  async deleteEmployeeType(@Param('id') id: string) {
    return { success: await employeeTypes.remove(id) };
  }

  @Post('positions')
  @UseGuards(Permissions('hr.masters.create'))
  async createPosition(@Body() body: { name: string }) {
    return { success: true, data: await positions.create(body) };
  }

  @Put('positions/:id')
  @UseGuards(Permissions('hr.masters.update'))
  async updatePosition(@Param('id') id: string, @Body() body: { name?: string; is_active?: boolean }) {
    return { success: true, data: await positions.update(id, body) };
  }

  @Delete('positions/:id')
  @UseGuards(Permissions('hr.masters.delete'))
  async deletePosition(@Param('id') id: string) {
    return { success: await positions.remove(id) };
  }

  @Post('holidays')
  @UseGuards(Permissions('hr.masters.create'))
  async createHoliday(@Body() body: { title?: string; holiday_date?: string; type?: string; description?: string }) {
    if (!body.title?.trim() || !body.holiday_date) throw new BadRequestException('title and holiday_date are required');
    return { success: true, data: await holidays.create({ title: body.title, holiday_date: body.holiday_date, ...body }) };
  }

  @Put('holidays/:id')
  @UseGuards(Permissions('hr.masters.update'))
  async updateHoliday(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return { success: true, data: await holidays.update(id, body) };
  }

  @Delete('holidays/:id')
  @UseGuards(Permissions('hr.masters.delete'))
  async deleteHoliday(@Param('id') id: string) {
    return { success: await holidays.remove(id) };
  }

  @Post('setup-rules')
  @UseGuards(Permissions('hr.masters.create'))
  async createSetupRule(@Body() body: Record<string, unknown>) {
    const fieldErrors = await validateSetupRuleInput(body);
    if (Object.keys(fieldErrors).length > 0) {
      throw new BadRequestException({ message: 'Validation failed', fieldErrors });
    }
    return { success: true, data: await setupRules.create(body) };
  }

  @Put('setup-rules/:id')
  @UseGuards(Permissions('hr.masters.update'))
  async updateSetupRule(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const fieldErrors = await validateSetupRuleInput(body, id);
    if (Object.keys(fieldErrors).length > 0) {
      throw new BadRequestException({ message: 'Validation failed', fieldErrors });
    }
    return { success: true, data: await setupRules.update(id, body) };
  }

  @Delete('setup-rules/:id')
  @UseGuards(Permissions('hr.masters.delete'))
  async deleteSetupRule(@Param('id') id: string) {
    try {
      return { success: await setupRules.remove(id) };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('schedule_in_use:')) {
        throw new BadRequestException({ message: err.message.slice('schedule_in_use:'.length).trim(), code: 'schedule_in_use' });
      }
      throw err;
    }
  }

  // ---- HR Dashboard (aggregated, permission-protected) ---------------------
  @Get('dashboard')
  @UseGuards(Permissions('hr.employee.view', 'hr.attendance.manage', 'hr.attendance.approve', 'report.view'))
  async dashboard(@Query() q: { asOf?: string; hiresWindowDays?: string }) {
    const hiresWindowDays = q.hiresWindowDays ? parseInt(q.hiresWindowDays, 10) : undefined;
    if (hiresWindowDays !== undefined && ![30, 90, 365].includes(hiresWindowDays)) {
      throw new BadRequestException('hiresWindowDays must be 30, 90 or 365');
    }
    const input: { asOf?: string; hiresWindowDays?: number } = {};
    if (q.asOf) input.asOf = q.asOf;
    if (hiresWindowDays !== undefined) input.hiresWindowDays = hiresWindowDays;
    return { data: await hrDashboard(input) };
  }

  // ---- Employees (FR-025..040) -------------------------------------------

  // Employee self-service: own profile & contract (ESS)
  @Get('me')
  async me(@Req() req: RequestWithSession) {
    const identity = withIdentity(req);
    if (!identity.employee_id) throw new NotFoundException('No employee profile linked to this account');
    const employee = await getEmployee(identity.employee_id);
    if (!employee) throw new NotFoundException('Employee profile not found');
    const { rows } = await query<{
      department_name: string | null;
      sub_department_name: string | null;
      position_name: string | null;
      employee_type_name: string | null;
      supervisor_name: string | null;
    }>(
      `SELECT d.name AS department_name,
              sd.name AS sub_department_name,
              p.name AS position_name,
              et.name AS employee_type_name,
              sup.full_name AS supervisor_name
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
         LEFT JOIN sub_departments sd ON sd.id = e.sub_department_id
         LEFT JOIN positions p ON p.id = e.position_id
         LEFT JOIN employee_types et ON et.id = e.employee_type_id
         LEFT JOIN employees sup ON sup.id = e.supervisor_id
        WHERE e.id = $1`,
      [identity.employee_id]
    );
    return { data: { ...employee, ...(rows[0] ?? {}) } };
  }

  // Employee self-service: update own editable profile fields (ESS)
  // No permission guard — any authenticated user with an employee record
  // can update their own profile. Backend enforces employee ownership.
  @Put('me/profile')
  async updateMyProfileEndpoint(@Req() req: RequestWithSession, @Body() body: Record<string, unknown>) {
    const identity = withIdentity(req);
    if (!identity.employee_id) throw new NotFoundException('No employee profile linked to this account');
    const employee = await updateMyProfile(identity.employee_id, {
      employee: (body['employee'] as Record<string, unknown> | undefined) ?? {},
      bank: (body['bank'] as Record<string, unknown> | undefined) ?? {},
      address: (body['address'] as Record<string, unknown> | undefined) ?? {},
    });
    if (!employee) throw new NotFoundException('Employee profile not found');
    return { success: true, data: employee };
  }

  @Get('employees')
  async employeesList(@Req() req: RequestWithSession, @Query() q: Record<string, string>) {
    const parsed = parseListQuery(q);
    const identity = withIdentity(req);
    if (identity.employee_id && !hasAnyPermission(identity, HR_STAFF_PERMS)) {
      parsed.filters = [...(parsed.filters ?? []), { field: 'id', operator: 'eq', value: identity.employee_id }];
    }
    return { data: await listEmployees({ ...parsed, filters: parsed.filters ?? [] }) };
  }

  @Get('analytics/employees')
  @UseGuards(Permissions('hr.employee.view'))
  async workforceAnalytics() {
    return { data: await employeeAnalytics() };
  }

  @Get('analytics/performance')
  @UseGuards(Permissions('hr.employee.view', 'report.view'))
  async performanceTrendEndpoint() {
    return { data: await performanceTrend() };
  }

  @Get('employees/inactive')
  async inactiveList(@Req() req: RequestWithSession, @Query() q: Record<string, string>) {
    const parsed = parseListQuery(q);
    const identity = withIdentity(req);
    if (identity.employee_id && !hasAnyPermission(identity, HR_STAFF_PERMS)) {
      parsed.filters = [...(parsed.filters ?? []), { field: 'id', operator: 'eq', value: identity.employee_id }];
    }
    return { data: await listEmployeesPage({ ...parsed, filters: parsed.filters ?? [], status: 'inactive' }) };
  }

  @Get('employees/export')
  async employeesExport(@Req() req: RequestWithSession, @Res() res: Response) {
    const identity = withIdentity(req);
    if (identity.employee_id && !hasAnyPermission(identity, HR_STAFF_PERMS)) {
      throw new NotFoundException('Employee export requires staff permissions');
    }
    const rows = await exportEmployees();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"');
    if (rows.length === 0) {
      return res.send('');
    }
    const headers = Object.keys(rows[0]);
    const escape = (v: unknown): string => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.map(escape).join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
    return res.send(csv);
  }

  @Get('employees/:id')
  async employee(@Req() req: RequestWithSession, @Param('id') id: string) {
    const identity = withIdentity(req);
    if (identity.employee_id && !hasAnyPermission(identity, HR_STAFF_PERMS) && identity.employee_id !== id) {
      throw new NotFoundException('Employee not found');
    }
    const employee = await getEmployee(id);
    if (!employee) throw new NotFoundException('Employee not found');
    return { data: employee };
  }

  @Post('employees')
  @UseGuards(Permissions('hr.employee.create'))
  async create(@Body() body: Record<string, unknown>) {
    const fieldErrors = await validateEmployeeCreate(body as never);
    if (Object.keys(fieldErrors).length > 0) {
      throw new BadRequestException({
        message: 'Employee could not be created. Please review the highlighted fields.',
        code: 'EMPLOYEE_VALIDATION',
        fieldErrors,
      });
    }
    try {
      const employee = await createEmployee(body as never);
      const credentials = await ensureEmployeeUserAccount(employee);
      return { success: true, data: { employee, credentials } };
    } catch (e) {
      if (isPgUniqueViolation(e, 'employees_employee_code_key')) {
        throw new ConflictException('Employee ID already exists.');
      }
      throw e;
    }
  }

  @Post('employees/wizard')
  @UseGuards(Permissions('hr.employee.create'))
  async wizard(@Body() body: Record<string, unknown>) {
    const fieldErrors = await validateEmployeeCreate(body as never);
    if (Object.keys(fieldErrors).length > 0) {
      throw new BadRequestException({
        message: 'Employee could not be created. Please review the highlighted fields.',
        code: 'EMPLOYEE_VALIDATION',
        fieldErrors,
      });
    }
    try {
      const employee = await createEmployee(body as never);
      const credentials = await ensureEmployeeUserAccount(employee);
      return { success: true, data: { employee, credentials } };
    } catch (e) {
      if (isPgUniqueViolation(e, 'employees_employee_code_key')) {
        throw new ConflictException('Employee ID already exists.');
      }
      throw e;
    }
  }

  @Post('employees/:id/reset-login-password')
  @UseGuards(Permissions('hr.employee.update'))
  async resetLoginPassword(
    @Param('id') id: string,
    @Body() body: { password?: string; forceChange?: boolean }
  ) {
    const employee = await getEmployee(id);
    if (!employee) throw new NotFoundException('Employee not found');

    let temporary_password = '';
    if (body?.password && body.password.trim().length > 0) {
      const custom = body.password;
      if (typeof custom !== 'string' || custom.length < 8 || custom.length > 72) {
        throw new BadRequestException('Temporary password must be between 8 and 72 characters.');
      }
      temporary_password = custom;
    } else {
      temporary_password = generateTempPassword();
    }
    const mustChange = body?.forceChange !== false; // secure default: force change on next login
    const passwordHash = hashPassword(temporary_password);
    const email = (employee.email ?? '').trim().toLowerCase();

    const { rows: users } = await query<{ id: string; username: string; email: string | null }>(
      'SELECT id, username, email FROM users WHERE (employee_id = $1::uuid OR (lower(email) = $2 AND employee_id IS NULL)) AND deleted_at IS NULL ORDER BY created_at LIMIT 1',
      [id, email]
    );
    // Use the actual login account's credentials in the response/email when the
    // employee already has a user (its login username may differ from the
    // employee email); fall back to the employee email for new accounts.
    const loginUsername = users.length > 0 ? users[0].username : email || deriveLoginUsername(employee.employee_code);
    const loginEmail = users.length > 0 ? users[0].email : email || null;
    if (users.length === 0) {
      const { rows: inserted } = await query<{ id: string }>(
        `INSERT INTO users (username, email, full_name, password_hash, is_active, employee_id, must_change_password)
         VALUES ($1, $2, $3, $4, true, $5, $6)
         ON CONFLICT (username) DO NOTHING
         RETURNING id`,
        [loginUsername, loginEmail, employee.full_name, passwordHash, id, mustChange]
      );
      if (inserted.length === 0) {
        throw new ConflictException('An account already exists for this employee.');
      }
      const employeeRole = await query<{ id: string }>('SELECT id FROM roles WHERE name = $1', ['employee']);
      if (employeeRole.rows.length > 0 && inserted[0]?.id) {
        await query(
          `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [inserted[0].id, employeeRole.rows[0].id]
        );
      }
    } else {
      await query(
        `UPDATE users SET password_hash = $2, must_change_password = $3, is_active = true, updated_at = now()
          WHERE id = $1`,
        [users[0].id, passwordHash, mustChange]
      );
      await revokeAllSessionsForUser(users[0].id);
    }

    if (loginEmail) {
      try {
        await sendEmail({
          to: loginEmail,
          subject: 'SDI — Your password has been reset',
          text:
            `Hello ${employee.full_name},\n\n` +
            `Your SDI login password has been reset by an administrator.\n\n` +
            `Login email: ${loginUsername}\n` +
            `Temporary password: ${temporary_password}\n\n` +
            (mustChange
              ? `Sign in and set a new password on your next login.\n\n`
              : `Sign in with this password.\n\n`) +
            `If you did not expect this email, please contact your HR administrator.`,
        });
      } catch (error) {
        new Logger('EmployeeCredentials').warn(`reset email failed for ${loginEmail}: ${(error as Error).message}`);
      }
    }

    return {
      success: true,
      data: {
        username: loginUsername,
        email: loginEmail,
        temporary_password,
        must_change_password: mustChange,
      },
    };
  }

  @Put('employees/:id')
  @UseGuards(Permissions('hr.employee.update'))
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return { success: true, data: await updateEmployee(id, body as never) };
  }

  @Delete('employees/:id')
  @UseGuards(Permissions('hr.employee.delete'))
  async remove(@Param('id') id: string) {
    return { success: await removeEmployee(id) };
  }

  @Post('employees/:id/status')
  @UseGuards(Permissions('hr.employee.update'))
  async status(@Param('id') id: string, @Body() body: { status?: 'active' | 'inactive' }) {
    if (body.status !== 'active' && body.status !== 'inactive') {
      throw new BadRequestException('status must be active or inactive');
    }
    return { success: true, data: await setEmployeeStatus(id, body.status) };
  }

  // ---- Performance (FR-041) ----------------------------------------------
  @Get('performances')
  async performancesPage(@Req() req: RequestWithSession, @Query() q: Record<string, string>) {
    const identity = withIdentity(req);
    if (identity.employee_id && !hasAnyPermission(identity, HR_STAFF_PERMS)) {
      q = { ...q, employeeId: identity.employee_id };
    }
    const page = q.page ? parseInt(q.page, 10) : 1;
    const perPage = q.perPage ? parseInt(q.perPage, 10) : 10;
    return {
      data: await listPerformancesPage(
        { employee_id: q.employeeId, date_from: q.dateFrom, date_to: q.dateTo, search: q.search },
        { page, per_page: perPage }
      ),
    };
  }

  @Get('employees/:id/performance')
  async performances(@Req() req: RequestWithSession, @Param('id') id: string) {
    const identity = withIdentity(req);
    if (identity.employee_id && !hasAnyPermission(identity, HR_STAFF_PERMS) && identity.employee_id !== id) {
      throw new NotFoundException('Employee performance not found');
    }
    return { data: await listPerformances(id) };
  }

  @Post('employees/:id/performance')
  @UseGuards(Permissions('hr.employee.performance'))
  async addPerformance(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    validateAppraisalInput(body);
    return { success: true, data: await createPerformance({ ...body, employee_id: id } as never) };
  }

  @Get('employees/:id/performance/:performanceId')
  async performance(@Req() req: RequestWithSession, @Param('id') id: string, @Param('performanceId') performanceId: string) {
    const identity = withIdentity(req);
    const performance = await getPerformance(performanceId);
    if (!performance) throw new NotFoundException('Performance record not found');
    if (
      identity.employee_id &&
      !hasAnyPermission(identity, HR_STAFF_PERMS) &&
      (identity.employee_id !== id || String(performance.employee_id ?? '') !== identity.employee_id)
    ) {
      throw new NotFoundException('Performance record not found');
    }
    return { data: performance };
  }

  @Put('employees/:id/performance/:performanceId')
  @UseGuards(Permissions('hr.employee.performance'))
  async editPerformance(@Param('id') _id: string, @Param('performanceId') performanceId: string, @Body() body: Record<string, unknown>) {
    validateAppraisalInput(body);
    return { success: true, data: await updatePerformance(performanceId, body as never) };
  }

  @Delete('employees/:id/performance/:performanceId')
  @UseGuards(Permissions('hr.employee.performance'))
  async deletePerformance(@Param('id') _id: string, @Param('performanceId') performanceId: string) {
    return { success: await removePerformance(performanceId) };
  }

  // ---- Transfers (FR-042) -------------------------------------------------
  @Get('transfers')
  async allTransfers(@Req() req: RequestWithSession, @Query() q: { employeeId?: string; transferType?: string }) {
    const identity = withIdentity(req);
    let employeeId = q.employeeId;
    if (identity.employee_id && !hasAnyPermission(identity, HR_STAFF_PERMS)) {
      employeeId = identity.employee_id;
    }
    const rows = await listTransfers(employeeId);
    if (q.transferType) {
      return { data: rows.filter((t) => (t as Record<string, unknown>).transfer_type === q.transferType) };
    }
    return { data: rows };
  }

  @Get('employees/:id/transfers')
  async transfers(@Req() req: RequestWithSession, @Param('id') id: string) {
    const identity = withIdentity(req);
    if (identity.employee_id && !hasAnyPermission(identity, HR_STAFF_PERMS) && identity.employee_id !== id) {
      throw new NotFoundException('Transfers not found');
    }
    return { data: await listTransfers(id) };
  }

  @Post('employees/:id/transfers')
  @UseGuards(Permissions('hr.employee.transfer'))
  async addTransfer(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return { success: true, data: await createTransfer({ ...body, employee_id: id } as never) };
  }

  @Put('transfers/:id/status')
  @UseGuards(Permissions('hr.employee.transfer'))
  async updateTransfer(@Param('id') id: string, @Body() body: { status: string }) {
    const valid = ['pending', 'approved', 'rejected', 'cancelled'];
    if (!valid.includes(body.status)) throw new BadRequestException(`status must be one of ${valid.join(', ')}`);
    return { success: true, data: await updateTransferStatus(id, body.status) };
  }

  // ---- ID Cards (FR-041) ---------------------------------------------------
  @Get('id-cards')
  async idCards(@Req() req: RequestWithSession, @Query('employeeId') employeeId?: string) {
    const identity = withIdentity(req);
    if (identity.employee_id && !hasAnyPermission(identity, HR_STAFF_PERMS)) {
      employeeId = identity.employee_id;
    }
    return { data: await listIdCards({ employee_id: employeeId }) };
  }

  @Post('id-cards')
  @UseGuards(Permissions('hr.employee.create'))
  async addIdCard(@Body() body: { employee_id: string; card_number: string; issued_date?: string; expiry_date?: string }) {
    return { success: true, data: await createIdCard(body) };
  }

  @Delete('id-cards/:id')
  @UseGuards(Permissions('hr.employee.delete'))
  async deleteIdCard(@Param('id') id: string) {
    return { success: await removeIdCard(id) };
  }

  // ---- Resignations (FR-042) -----------------------------------------------
  @Get('resignations')
  async resignations(@Req() req: RequestWithSession, @Query('status') status?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('perPage') perPage?: string) {
    const identity = withIdentity(req);
    if (identity.employee_id && !hasAnyPermission(identity, HR_STAFF_PERMS)) {
      const rows = await listResignations({ employee_id: identity.employee_id });
      return { data: rows };
    }
    const pagination: { page?: number; per_page?: number } = {};
    if (page) pagination.page = Number(page);
    if (perPage) pagination.per_page = Number(perPage);
    return { data: await listResignations({ status, search }, pagination) };
  }

  @Post('resignations')
  @UseGuards(Permissions('hr.employee.update'))
  async addResignation(@Body() body: { employee_id: string; notice_date: string; effective_date: string; reason?: string }) {
    if (!body.employee_id) throw new BadRequestException('Employee is required.');
    if (!(await employeeExists(body.employee_id))) throw new BadRequestException('Selected employee does not exist.');
    if (body.notice_date && body.effective_date && body.effective_date < body.notice_date) {
      throw new BadRequestException('Effective date cannot be earlier than notice date.');
    }
    return { success: true, data: await createResignation(body) };
  }

  @Put('resignations/:id/status')
  @UseGuards(Permissions('hr.employee.update'))
  async updateResignation(@Param('id') id: string, @Body() body: { status: string }) {
    return { success: true, data: await updateResignationStatus(id, body.status) };
  }

  // ---- Notices (FR-043) ----------------------------------------------------
  @Get('notices')
  async notices() {
    return { data: await listNotices() };
  }

  @Post('notices')
  @UseGuards(Permissions('hr.masters.create'))
  async addNotice(@Body() body: { title: string; body: string; category?: string }) {
    return { success: true, data: await createNotice(body) };
  }

  @Put('notices/:id')
  @UseGuards(Permissions('hr.masters.update'))
  async editNotice(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return { success: true, data: await updateNotice(id, body as never) };
  }

  @Delete('notices/:id')
  @UseGuards(Permissions('hr.masters.delete'))
  async deleteNotice(@Param('id') id: string) {
    return { success: await removeNotice(id) };
  }

  // ---- Loans (FR-044) ------------------------------------------------------
  @Get('loans')
  async loans(@Req() req: RequestWithSession, @Query('employeeId') employeeId?: string, @Query('status') status?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('perPage') perPage?: string) {
    const identity = withIdentity(req);
    if (identity.employee_id && !hasAnyPermission(identity, HR_STAFF_PERMS)) {
      employeeId = identity.employee_id;
    }
    const pagination: { page?: number; per_page?: number } = {};
    if (page) pagination.page = Number(page);
    if (perPage) pagination.per_page = Number(perPage);
    return { data: await listLoans({ employee_id: employeeId, status, search }, pagination) };
  }

  // Employee self-service: apply for a loan (ESS). Backend forces the
  // requester as the loan owner; requests always start in `pending`.
  @Post('loans/self')
  async selfApplyLoan(@Req() req: RequestWithSession, @Body() body: { amount: number; interest_rate: number; loan_date: string; start_month?: string; installment_count: number; deduction_day: number; notes?: string }) {
    const identity = withIdentity(req);
    if (!identity.employee_id) throw new BadRequestException('No employee profile linked to this account');
    if (!body.amount || body.amount <= 0) throw new BadRequestException('Loan amount is required.');
    return { success: true, data: await createLoan({ ...body, employee_id: identity.employee_id, status: 'pending' }) };
  }

  @Post('loans')
  @UseGuards(Permissions('hr.employee.update'))
  async addLoan(@Body() body: { employee_id: string; amount: number; interest_rate: number; loan_date: string; start_month?: string; installment_count: number; deduction_day: number; notes?: string }) {
    if (!body.employee_id) throw new BadRequestException('Employee is required.');
    if (!(await employeeExists(body.employee_id))) throw new BadRequestException('Selected employee does not exist.');
    return { success: true, data: await createLoan(body) };
  }

  @Put('loans/:id/status')
  @UseGuards(Permissions('hr.employee.update'))
  async updateLoan(@Param('id') id: string, @Body() body: { status: string }) {
    return { success: true, data: await updateLoanStatus(id, body.status) };
  }

  // ---- HR Policies (FR-045) ------------------------------------------------
  @Get('policies')
  async policies(@Query('category') category?: string) {
    return { data: await listPolicies({ category }) };
  }

  @Post('policies')
  @UseGuards(Permissions('hr.masters.create'))
  async addPolicy(@Body() body: { title: string; body: string; category?: string }) {
    return { success: true, data: await createPolicy(body) };
  }

  @Put('policies/:id')
  @UseGuards(Permissions('hr.masters.update'))
  async editPolicy(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return { success: true, data: await updatePolicy(id, body as never) };
  }

  @Delete('policies/:id')
  @UseGuards(Permissions('hr.masters.delete'))
  async deletePolicy(@Param('id') id: string) {
    return { success: await removePolicy(id) };
  }

  // ---- App Settings (Spec 6.1) ---------------------------------------------
  @Get('settings')
  async appSettings() {
    return { data: await getSettings() };
  }

  @Put('settings')
  @UseGuards(Permissions('hr.masters.update'))
  async editAppSettings(@Body() body: Record<string, unknown>) {
    return { success: true, data: await updateSettings(body as never) };
  }
}
