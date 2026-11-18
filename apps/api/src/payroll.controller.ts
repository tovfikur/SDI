import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  addAdjustment,
  approveRun,
  calculateRun,
  cancelRun,
  createComponent,
  createRun,
  createStructure,
  deactivateComponent,
  deactivateSalary,
  deactivateStructure,
  getPayslip,
  getPayrollSettings,
  getRun,
  listAdjustmentsForRun,
  listComponents,
  listEmployeeSalaries,
  listPayslips,
  listRunCandidates,
  listRunEntries,
  listRuns,
  listStructures,
  assignSalary,
  payRun,
  payrollRegister,
  salarySummary,
  departmentSummary,
  componentSummary,
  deductionSummary,
  paymentStatusSummary,
  setSalaryOverrides,
  updateComponent,
  updatePayrollSettings,
  updateStructure,
  getPayrollDashboard,
  getStructure,
  getEmployeeSalary,
} from '@jsk/domain-payroll';
import type {
  ComponentUpdateInput,
  StructureCreateInput,
  StructureUpdateInput,
  PayrollSettingsPatch,
} from '@jsk/domain-payroll';
import { query } from '@jsk/shared-kernel';
import { Permissions } from './auth/guards';
import type { RequestWithSession } from './auth/session';
import { hasAnyPermission, findUserByEmployeeId } from '@jsk/shared-auth';
import { notifyUsers } from './notify';

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
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function str(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`${field} is required`);
  }
  return value.trim();
}

/** Notify every employee who has an entry in the given payroll run. */
async function notifyRunEmployees(
  runId: string,
  input: { event_type: string; title: string; message: string; action_url: string }
): Promise<void> {
  try {
    const { rows } = await query<{ employee_id: string }>(
      `SELECT DISTINCT employee_id FROM payroll_entries WHERE run_id = $1::uuid`,
      [runId]
    );
    const users = await Promise.all(
      rows.map((r) => findUserByEmployeeId(r.employee_id))
    );
    await notifyUsers(
      users.map((u) => u?.id),
      input
    );
  } catch {
    /* notification failures must not break payroll */
  }
}

/** Maps domain error codes (Error('payroll.<code>')) to HTTP errors. */
function throwPayrollError(err: unknown): never {
  if (err instanceof Error && err.message.startsWith('payroll.')) {
    const code = err.message;
    switch (code) {
      case 'payroll_run.not_found':
        throw new NotFoundException('Payroll run not found');
      case 'payroll_run.duplicate_period':
        throw new BadRequestException('A payroll run already exists for this period');
      case 'payroll_run.locked':
        throw new BadRequestException('Approved or paid payroll runs cannot be modified');
      case 'payroll_run.must_be_calculated':
        throw new BadRequestException('The run must be calculated before it can be approved');
      case 'payroll_run.must_be_approved':
        throw new BadRequestException('The run must be approved before it can be paid');
      case 'payroll_run.invalid_period':
        throw new BadRequestException('Period must be the first day of a month (YYYY-MM-01)');
      case 'payroll_adjustment.invalid_amount':
        throw new BadRequestException('Adjustment amount must be a positive number');
      case 'salary_component.invalid_code':
        throw new BadRequestException('Component code must be 2-40 uppercase letters, digits or underscores');
      case 'salary_component.invalid_name':
        throw new BadRequestException('Component name is required');
      case 'salary_component.invalid_amount':
        throw new BadRequestException('Component amount must be a valid non-negative number');
      case 'salary_structure.invalid_name':
        throw new BadRequestException('Structure name is required');
      case 'salary_structure.invalid_amount':
        throw new BadRequestException('Structure component amount must be a valid non-negative number');
      case 'employee_salary.invalid_gross':
        throw new BadRequestException('Gross salary must be a valid non-negative number');
      case 'employee_salary.invalid_override':
        throw new BadRequestException('Override amount must be a valid non-negative number');
      case 'employee_salary.invalid_effective_from':
        throw new BadRequestException('Effective date is required');
      case 'employee_salary.inactive':
        throw new BadRequestException('This salary assignment is no longer active');
      default:
        throw new BadRequestException(err.message);
    }
  }
  throw err;
}

@Controller('api/payroll')
export class PayrollController {
  // ---- Payroll rules (settings) ---------------------------------------------

  @Get('settings')
  @UseGuards(Permissions('payroll.view'))
  async settings() {
    return { data: await getPayrollSettings() };
  }

  @Put('settings')
  @UseGuards(Permissions('payroll.run'))
  async updateSettings(@Body() body: Record<string, unknown>) {
    try {
      const patch: PayrollSettingsPatch = {};
      if (body['periodLabel'] !== undefined) patch.period_label = str(body['periodLabel'], 'periodLabel');
      if (body['salaryCalculationBasis'] === 'gross_salary' || body['salaryCalculationBasis'] === 'basic_salary') {
        patch.salary_calculation_basis = body['salaryCalculationBasis'];
      }
      const attendance = toBoolean(body['attendanceDeduction']);
      const late = toBoolean(body['lateDeduction']);
      const overtime = toBoolean(body['overtimeEnabled']);
      const leave = toBoolean(body['unpaidLeaveDeduction']);
      if (attendance !== undefined) patch.attendance_deduction = attendance;
      if (late !== undefined) patch.late_deduction = late;
      if (overtime !== undefined) patch.overtime_enabled = overtime;
      if (leave !== undefined) patch.unpaid_leave_deduction = leave;
      if (body['roundingRule'] === 'nearest' || body['roundingRule'] === 'ceil' || body['roundingRule'] === 'floor') {
        patch.rounding_rule = body['roundingRule'];
      }
      if (body['workingDayCalculation'] === 'calendar_days' || body['workingDayCalculation'] === 'scheduled_working_days') {
        patch.working_day_calculation = body['workingDayCalculation'];
      }
      const paymentDay = toNumber(body['defaultPaymentDay']);
      if (paymentDay !== null && paymentDay >= 1 && paymentDay <= 28) {
        patch.default_payment_day = paymentDay;
      }
      if (typeof body['defaultCurrency'] === 'string' && body['defaultCurrency'].trim()) {
        patch.default_currency = body['defaultCurrency'].trim().toUpperCase();
      }
      return { success: true, data: await updatePayrollSettings(patch) };
    } catch (err) {
      throwPayrollError(err);
    }
  }

  // ---- Salary components -----------------------------------------------------

  @Get('salary-components')
  @UseGuards(Permissions('salary_component.view'))
  async components(@Query() q: Record<string, string>) {
    return {
      data: await listComponents({
        ...(q['type'] === 'earning' || q['type'] === 'deduction' ? { type: q['type'] } : {}),
        ...(q['activeOnly'] === 'true' ? { activeOnly: true } : {}),
      }),
    };
  }

  @Post('salary-components')
  @UseGuards(Permissions('salary_component.manage'))
  async createComponentRoute(@Body() body: Record<string, unknown>) {
    try {
      const calculationType = body['calculationType'];
      if (calculationType !== 'fixed' && calculationType !== 'percentage' && calculationType !== 'formula') {
        throw new BadRequestException('calculationType must be fixed, percentage or formula');
      }
      const type = body['type'];
      if (type !== 'earning' && type !== 'deduction') {
        throw new BadRequestException('type must be earning or deduction');
      }
      const component = await createComponent({
        name: str(body['name'], 'name'),
        code: str(body['code'], 'code'),
        type,
        calculation_type: calculationType,
        percentage_of_component: typeof body['percentageOfComponent'] === 'string' ? body['percentageOfComponent'] : null,
        default_amount: typeof body['defaultAmount'] === 'string' ? body['defaultAmount'] : null,
        taxable: toBoolean(body['taxable']) ?? false,
        is_active: toBoolean(body['isActive']) ?? true,
        sort_order: toNumber(body['sortOrder']) ?? 0,
      });
      return { success: true, data: component };
    } catch (err) {
      throwPayrollError(err);
    }
  }

  @Patch('salary-components/:id')
  @UseGuards(Permissions('salary_component.manage'))
  async updateComponentRoute(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    try {
      if (!isUuid(id)) throw new BadRequestException('Invalid component id');
      const patch: ComponentUpdateInput = {};
      if (body['name'] !== undefined) patch.name = String(body['name']);
      const type = body['type'];
      if (type === 'earning' || type === 'deduction') patch.type = type;
      const calcType = body['calculationType'];
      if (calcType === 'fixed' || calcType === 'percentage' || calcType === 'formula') patch.calculation_type = calcType;
      if (body['percentageOfComponent'] !== undefined) {
        patch.percentage_of_component = body['percentageOfComponent'] === null ? null : String(body['percentageOfComponent']);
      }
      if (body['defaultAmount'] !== undefined) patch.default_amount = body['defaultAmount'] === null ? null : String(body['defaultAmount']);
      const taxable = toBoolean(body['taxable']);
      const isActive = toBoolean(body['isActive']);
      if (taxable !== undefined) patch.taxable = taxable;
      if (isActive !== undefined) patch.is_active = isActive;
      const sortOrder = toNumber(body['sortOrder']);
      if (sortOrder !== null) patch.sort_order = sortOrder;
      const component = await updateComponent(id, patch);
      if (!component) throw new NotFoundException('Component not found');
      return { success: true, data: component };
    } catch (err) {
      throwPayrollError(err);
    }
  }

  @Delete('salary-components/:id')
  @UseGuards(Permissions('salary_component.manage'))
  async deactivateComponentRoute(@Param('id') id: string) {
    if (!isUuid(id)) throw new BadRequestException('Invalid component id');
    const ok = await deactivateComponent(id);
    if (!ok) throw new NotFoundException('Component not found');
    return { success: true, data: { id, is_active: false } };
  }

  // ---- Salary structures -----------------------------------------------------

  @Get('salary-structures')
  @UseGuards(Permissions('salary_structure.view'))
  async structures() {
    return { data: await listStructures() };
  }

  @Get('salary-structures/:id')
  @UseGuards(Permissions('salary_structure.view'))
  async structureDetail(@Param('id') id: string) {
    if (!isUuid(id)) throw new BadRequestException('Invalid structure id');
    const structure = await getStructure(id);
    if (!structure) throw new NotFoundException('Structure not found');
    return { data: structure };
  }

  @Post('salary-structures')
  @UseGuards(Permissions('salary_structure.manage'))
  async createStructureRoute(@Body() body: Record<string, unknown>) {
    try {
      const input: StructureCreateInput = {
        name: str(body['name'], 'name'),
        ...(typeof body['description'] === 'string' ? { description: body['description'] } : {}),
        ...(body['isActive'] !== undefined ? { is_active: Boolean(body['isActive']) } : {}),
      };
      if (Array.isArray(body['components'])) {
        input.components = body['components'].map((c) => {
          const comp = c as Record<string, unknown>;
          const calculationType = comp['calculationType'];
          return {
            component_id: str(comp['componentId'], 'componentId'),
            ...(calculationType === 'fixed' || calculationType === 'percentage' || calculationType === 'formula'
              ? { calculation_type: calculationType as 'fixed' | 'percentage' | 'formula' }
              : {}),
            ...(comp['percentageOfComponent'] !== undefined && comp['percentageOfComponent'] !== null
              ? { percentage_of_component: String(comp['percentageOfComponent']) }
              : {}),
            ...(comp['amount'] !== undefined && comp['amount'] !== null ? { amount: String(comp['amount']) } : {}),
          };
        });
      }
      return { success: true, data: await createStructure(input) };
    } catch (err) {
      throwPayrollError(err);
    }
  }

  @Patch('salary-structures/:id')
  @UseGuards(Permissions('salary_structure.manage'))
  async updateStructureRoute(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    try {
      if (!isUuid(id)) throw new BadRequestException('Invalid structure id');
      const patch: StructureUpdateInput = {};
      if (body['name'] !== undefined) patch.name = String(body['name']);
      if (body['description'] !== undefined) patch.description = String(body['description']);
      if (body['isActive'] !== undefined) patch.is_active = Boolean(body['isActive']);
      if (Array.isArray(body['components'])) {
        patch.components = body['components'].map((c) => {
          const comp = c as Record<string, unknown>;
          const calculationType = comp['calculationType'];
          return {
            component_id: str(comp['componentId'], 'componentId'),
            ...(calculationType === 'fixed' || calculationType === 'percentage' || calculationType === 'formula'
              ? { calculation_type: calculationType as 'fixed' | 'percentage' | 'formula' }
              : {}),
            ...(comp['percentageOfComponent'] !== undefined && comp['percentageOfComponent'] !== null
              ? { percentage_of_component: String(comp['percentageOfComponent']) }
              : {}),
            ...(comp['amount'] !== undefined && comp['amount'] !== null ? { amount: String(comp['amount']) } : {}),
          };
        });
      }
      const structure = await updateStructure(id, patch);
      if (!structure) throw new NotFoundException('Structure not found');
      return { success: true, data: structure };
    } catch (err) {
      throwPayrollError(err);
    }
  }

  @Delete('salary-structures/:id')
  @UseGuards(Permissions('salary_structure.manage'))
  async deactivateStructureRoute(@Param('id') id: string) {
    if (!isUuid(id)) throw new BadRequestException('Invalid structure id');
    const ok = await deactivateStructure(id);
    if (!ok) throw new NotFoundException('Structure not found');
    return { success: true, data: { id, is_active: false } };
  }

  // ---- Employee salary assignment --------------------------------------------

  @Get('employees')
  @UseGuards(Permissions('employee_salary.view'))
  async employees() {
    const { rows } = await query<{
      id: string;
      employee_code: string;
      full_name: string;
      department_name: string | null;
    }>(
      `SELECT e.id, e.employee_code, e.full_name, d.name AS department_name
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
        WHERE e.status = 'active' AND e.deleted_at IS NULL
        ORDER BY e.employee_code`
    );
    return { data: rows };
  }

  @Get('employee-salaries')
  @UseGuards(Permissions('employee_salary.view'))
  async employeeSalaries(@Query() q: Record<string, string>) {
    return {
      data: await listEmployeeSalaries({
        ...(q['employeeId'] ? { employee_id: q['employeeId'] } : {}),
        ...(q['status'] === 'active' || q['status'] === 'inactive' ? { status: q['status'] } : {}),
      }),
    };
  }

  @Get('employee-salaries/:id')
  @UseGuards(Permissions('employee_salary.view'))
  async employeeSalaryDetail(@Param('id') id: string) {
    if (!isUuid(id)) throw new BadRequestException('Invalid salary id');
    const salary = await getEmployeeSalary(id);
    if (!salary) throw new NotFoundException('Salary assignment not found');
    return { data: salary };
  }

  @Post('employee-salaries')
  @UseGuards(Permissions('employee_salary.manage'))
  async assignSalaryRoute(@Req() req: RequestWithSession, @Body() body: Record<string, unknown>) {
    try {
      const salary = await assignSalary(
        {
          employee_id: str(body['employeeId'], 'employeeId'),
          salary_structure_id: str(body['salaryStructureId'], 'salaryStructureId'),
          gross_salary: str(body['grossSalary'], 'grossSalary'),
          currency: typeof body['currency'] === 'string' && body['currency'] ? body['currency'].toUpperCase() : 'BDT',
          effective_from: str(body['effectiveFrom'], 'effectiveFrom'),
          ...(Array.isArray(body['overrides'])
            ? {
                overrides: body['overrides'].map((o) => {
                  const override = o as Record<string, unknown>;
                  return {
                    component_id: str(override['componentId'], 'componentId'),
                    amount: str(override['amount'], 'amount'),
                  };
                }),
              }
            : {}),
        },
        req.identity?.id ?? null
      );
      return { success: true, data: salary };
    } catch (err) {
      throwPayrollError(err);
    }
  }

  @Patch('employee-salaries/:id/overrides')
  @UseGuards(Permissions('employee_salary.manage'))
  async setOverridesRoute(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    try {
      if (!isUuid(id)) throw new BadRequestException('Invalid salary id');
      if (!Array.isArray(body['overrides'])) throw new BadRequestException('overrides array is required');
      const overrides = body['overrides'].map((o) => {
        const override = o as Record<string, unknown>;
        return {
          component_id: str(override['componentId'], 'componentId'),
          amount: str(override['amount'], 'amount'),
        };
      });
      const salary = await setSalaryOverrides(id, overrides);
      if (!salary) throw new NotFoundException('Salary assignment not found');
      return { success: true, data: salary };
    } catch (err) {
      throwPayrollError(err);
    }
  }

  @Delete('employee-salaries/:id')
  @UseGuards(Permissions('employee_salary.manage'))
  async deactivateSalaryRoute(@Param('id') id: string) {
    if (!isUuid(id)) throw new BadRequestException('Invalid salary id');
    const ok = await deactivateSalary(id);
    if (!ok) throw new NotFoundException('Salary assignment not found');
    return { success: true, data: { id, status: 'inactive' } };
  }

  // ---- Payroll runs ----------------------------------------------------------

  @Get('runs')
  @UseGuards(Permissions('payroll.view'))
  async runs(@Query() q: Record<string, string>) {
    return {
      data: await listRuns({
        ...(q['page'] ? { page: parseInt(q['page'], 10) } : {}),
        ...(q['perPage'] ? { per_page: parseInt(q['perPage'], 10) } : {}),
        ...(q['status'] === 'draft' || q['status'] === 'calculated' || q['status'] === 'approved' || q['status'] === 'paid' || q['status'] === 'cancelled'
          ? { status: q['status'] }
          : {}),
      }),
    };
  }

  @Get('runs/:id')
  @UseGuards(Permissions('payroll.view'))
  async runDetail(@Param('id') id: string) {
    if (!isUuid(id)) throw new BadRequestException('Invalid run id');
    const run = await getRun(id);
    if (!run) throw new NotFoundException('Payroll run not found');
    return { data: run };
  }

  @Post('runs')
  @UseGuards(Permissions('payroll.run'))
  async createRunRoute(@Req() req: RequestWithSession, @Body() body: Record<string, unknown>) {
    try {
      const run = await createRun(str(body['period'], 'period'), req.identity?.id ?? null);
      return { success: true, data: run };
    } catch (err) {
      throwPayrollError(err);
    }
  }

  @Get('runs/:id/candidates')
  @UseGuards(Permissions('payroll.run'))
  async runCandidates(@Param('id') id: string) {
    const run = await getRun(id);
    if (!run) throw new NotFoundException('Payroll run not found');
    return { data: await listRunCandidates(String(run.period_month).slice(0, 10)) };
  }

  @Post('runs/:id/calculate')
  @UseGuards(Permissions('payroll.run'))
  async calculateRunRoute(@Req() req: RequestWithSession, @Param('id') id: string) {
    try {
      if (!isUuid(id)) throw new BadRequestException('Invalid run id');
      return { success: true, data: await calculateRun(id, req.identity?.id ?? null) };
    } catch (err) {
      throwPayrollError(err);
    }
  }

  @Post('runs/:id/approve')
  @UseGuards(Permissions('payroll.approve'))
  async approveRunRoute(@Req() req: RequestWithSession, @Param('id') id: string) {
    try {
      if (!isUuid(id)) throw new BadRequestException('Invalid run id');
      const data = await approveRun(id, req.identity?.id ?? null);
      await notifyRunEmployees(id, {
        event_type: 'payroll.approved',
        title: 'Payroll approved',
        message: `Your salary for ${data['period_month'] ?? ''} has been approved.`,
        action_url: '/payroll/payslips',
      });
      return { success: true, data };
    } catch (err) {
      throwPayrollError(err);
    }
  }

  @Post('runs/:id/pay')
  @UseGuards(Permissions('payroll.pay'))
  async payRunRoute(@Req() req: RequestWithSession, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    try {
      if (!isUuid(id)) throw new BadRequestException('Invalid run id');
      const method = body['paymentMethod'];
      if (method !== 'bank_transfer' && method !== 'cash' && method !== 'cheque' && method !== 'other') {
        throw new BadRequestException('paymentMethod must be bank_transfer, cash, cheque or other');
      }
      const data = await payRun(
        id,
        {
          payment_date: str(body['paymentDate'], 'paymentDate'),
          payment_method: method,
          ...(typeof body['paymentReference'] === 'string' ? { payment_reference: body['paymentReference'] } : {}),
          ...(typeof body['paymentNotes'] === 'string' ? { payment_notes: body['paymentNotes'] } : {}),
        },
        req.identity?.id ?? null
      );
      await notifyRunEmployees(id, {
        event_type: 'payroll.paid',
        title: 'Salary paid',
        message: `Your salary for ${String(data?.['period_month'] ?? '')} has been paid (${method.replaceAll('_', ' ')}).`,
        action_url: '/payroll/payments',
      });
      return { success: true, data };
    } catch (err) {
      throwPayrollError(err);
    }
  }

  @Post('runs/:id/cancel')
  @UseGuards(Permissions('payroll.run'))
  async cancelRunRoute(@Req() req: RequestWithSession, @Param('id') id: string) {
    try {
      if (!isUuid(id)) throw new BadRequestException('Invalid run id');
      return { success: true, data: await cancelRun(id, req.identity?.id ?? null) };
    } catch (err) {
      throwPayrollError(err);
    }
  }

  @Get('runs/:id/entries')
  @UseGuards(Permissions('payroll.view'))
  async runEntries(@Param('id') id: string, @Query() q: Record<string, string>) {
    if (!isUuid(id)) throw new BadRequestException('Invalid run id');
    return {
      data: await listRunEntries(id, {
        ...(q['employeeId'] ? { employee_id: q['employeeId'] } : {}),
      }),
    };
  }

  @Get('runs/:id/adjustments')
  @UseGuards(Permissions('payroll.view'))
  async runAdjustments(@Param('id') id: string) {
    if (!isUuid(id)) throw new BadRequestException('Invalid run id');
    return { data: await listAdjustmentsForRun(id) };
  }

  @Post('runs/:id/adjustments')
  @UseGuards(Permissions('payroll.run'))
  async addAdjustmentRoute(@Req() req: RequestWithSession, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    try {
      if (!isUuid(id)) throw new BadRequestException('Invalid run id');
      const type = body['type'];
      if (type !== 'earning' && type !== 'deduction') {
        throw new BadRequestException('type must be earning or deduction');
      }
      const adjustment = await addAdjustment({
        payroll_run_id: id,
        employee_id: str(body['employeeId'], 'employeeId'),
        type,
        amount: str(body['amount'], 'amount'),
        ...(typeof body['salaryComponentId'] === 'string' && body['salaryComponentId']
          ? { salary_component_id: body['salaryComponentId'] }
          : {}),
        ...(typeof body['reason'] === 'string' ? { reason: body['reason'] } : {}),
        added_by: req.identity?.id ?? null,
      });
      return { success: true, data: adjustment };
    } catch (err) {
      throwPayrollError(err);
    }
  }

  // ---- Payslips (self-service + HR) ------------------------------------------

  // Self-service: any authenticated user with an employee record can read
  // their own payslips. The query already scopes to employee_id.
  @Get('payslips')
  async payslips(@Req() req: RequestWithSession, @Query() q: Record<string, string>) {
    try {
      const canViewAll = req.identity ? hasAnyPermission(req.identity, ['payslip.view_all']) : false;
      let employeeId: string | undefined;
      if (!canViewAll) {
        if (!req.identity?.employee_id) {
          throw new ForbiddenException('No employee record linked to this account');
        }
        employeeId = req.identity.employee_id;
      } else if (q['employeeId']) {
        employeeId = q['employeeId'];
      }
      return {
        data: await listPayslips({
          employee_id: employeeId,
          ...(q['period'] ? { period: q['period'] } : {}),
          ...(q['page'] ? { page: parseInt(q['page'], 10) } : {}),
          ...(q['perPage'] ? { per_page: parseInt(q['perPage'], 10) } : {}),
        }),
      };
    } catch (err) {
      throwPayrollError(err);
    }
  }

  @Get('payslips/:id')
  async payslipDetail(@Req() req: RequestWithSession, @Param('id') id: string) {
    if (!isUuid(id)) throw new BadRequestException('Invalid payslip id');
    const payslip = await getPayslip(id);
    if (!payslip) throw new NotFoundException('Payslip not found');
    const canViewAll = req.identity ? hasAnyPermission(req.identity, ['payslip.view_all']) : false;
    if (!canViewAll && payslip.employee_id !== req.identity?.employee_id) {
      throw new ForbiddenException('You can only view your own payslips');
    }
    return { data: payslip };
  }

  // ---- Reports & dashboard ---------------------------------------------------

  @Get('reports/:kind')
  @UseGuards(Permissions('payroll.report'))
  async report(@Param('kind') kind: string, @Query() q: Record<string, string>) {
    const scope: {
      period?: string;
      department_id?: string;
      employee_id?: string;
      payment_status?: 'unpaid' | 'paid';
    } = {
      ...(q['period'] ? { period: q['period'] } : {}),
      ...(q['departmentId'] ? { department_id: q['departmentId'] } : {}),
      ...(q['employeeId'] ? { employee_id: q['employeeId'] } : {}),
      ...(q['paymentStatus'] === 'unpaid' || q['paymentStatus'] === 'paid' ? { payment_status: q['paymentStatus'] as 'unpaid' | 'paid' } : {}),
    };
    switch (kind) {
      case 'register':
        return { data: await payrollRegister(scope) };
      case 'salary-summary':
        return { data: await salarySummary(scope) };
      case 'department-summary':
        return { data: await departmentSummary(scope) };
      case 'component-summary':
        return { data: await componentSummary(scope) };
      case 'deduction-summary':
        return { data: await deductionSummary(scope) };
      case 'payment-status':
        return { data: await paymentStatusSummary(scope) };
      default:
        throw new NotFoundException('Unknown report kind');
    }
  }

  @Get('dashboard')
  @UseGuards(Permissions('payroll.view'))
  async dashboard() {
    return { data: await getPayrollDashboard() };
  }
}