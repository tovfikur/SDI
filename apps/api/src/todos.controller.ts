import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestWithSession } from './auth/session';
import { withIdentity } from './auth/guards';
import {
  createTodo,
  deleteTodo,
  listTodos,
  updateTodo,
} from '@jsk/domain-todos';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireEmployee(req: RequestWithSession): string {
  const identity = withIdentity(req);
  if (!identity.employee_id) {
    throw new ForbiddenException('No employee profile found for the logged-in user');
  }
  return identity.employee_id;
}

function serverToday(): string {
  // Local server date (consistent with attendance/work-log day boundaries).
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

@Controller('api/todos')
export class TodosController {
  /** Own list — any date (owner history). */
  @Get()
  async list(@Req() req: RequestWithSession, @Query('date') date?: string) {
    const employeeId = requireEmployee(req);
    const d = date && DATE_RE.test(date) ? date : serverToday();
    return { success: true, data: await listTodos(employeeId, d) };
  }

  /**
   * Another employee's TODAY list — read-only snapshot. The date is always
   * forced to the server's today: colleagues may see what someone is working
   * on right now, never their history or future.
   */
  @Get('employees/:employeeId')
  async listOthersToday(@Req() req: Request, @Param('employeeId') employeeId: string) {
    withIdentity(req); // must be authenticated
    if (!/^[0-9a-fA-F-]{36}$/.test(employeeId)) {
      throw new BadRequestException('Invalid employee id');
    }
    return { success: true, data: await listTodos(employeeId, serverToday()) };
  }

  /** Create an own todo. Owner comes from the session — client ids ignored. */
  @Post()
  async create(@Req() req: RequestWithSession, @Body() body: Record<string, unknown>) {
    const employeeId = requireEmployee(req);
    const todo = await createTodo({
      employee_id: employeeId,
      todo_date: typeof body.todo_date === 'string' && body.todo_date ? body.todo_date : undefined,
      title: body.title,
    });
    return { success: true, data: todo };
  }

  /** Update/complete/delete are restricted to the owning employee in SQL. */
  @Patch(':id')
  async update(
    @Req() req: RequestWithSession,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ) {
    const employeeId = requireEmployee(req);
    const patch: { title?: unknown; is_completed?: unknown } = {};
    if ('title' in body) patch.title = body.title;
    if ('is_completed' in body) patch.is_completed = body.is_completed;
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Nothing to update');
    }
    const todo = await updateTodo(id, employeeId, patch);
    if (!todo) throw new ForbiddenException('You can only modify your own to-do items');
    return { success: true, data: todo };
  }

  @Delete(':id')
  async remove(@Req() req: RequestWithSession, @Param('id') id: string) {
    const employeeId = requireEmployee(req);
    const ok = await deleteTodo(id, employeeId);
    if (!ok) throw new ForbiddenException('You can only delete your own to-do items');
    return { success: true };
  }
}
