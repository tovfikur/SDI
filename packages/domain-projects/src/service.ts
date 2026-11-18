/**
 * Project management domain (Spec FR-100..106, SM-4/5, BR-012..015, WF-009/010).
 *
 * - Project ending date derived from start + duration (BR-014 canonical direction).
 * - Project progress = simple average of task progress % (BR-015 default).
 * - Inline client creation shares the project transaction (WF-009).
 */

import { query, withTransaction, insertRow, getById, list, softDeleteRow } from '@jsk/shared-kernel';
import type { ColumnMap, PaginatedResponse, Queryable } from '@jsk/shared-kernel';
import type { FilterParam, SortParam } from '@jsk/shared-kernel';
import { getDownloadUrlByKey } from '@jsk/domain-files';

const addDays = (dateStr: string, days: number): string => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const diffDays = (start: string, end: string): number =>
  Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86_400_000);

// ---------------------------------------------------------------------------
// Clients (FR-102)
// ---------------------------------------------------------------------------

export const clients = {
  async list(input: { filters?: FilterParam[] | undefined; search?: string | undefined; sort?: SortParam | null | undefined; page?: number | undefined; per_page?: number | undefined }): Promise<PaginatedResponse<Record<string, unknown>>> {
    return list({
      table: 'clients c',
      columns: {
        id: { type: 'uuid', sql: 'c.id' },
        name: { type: 'text', sql: 'c.name' },
        email: { type: 'text', sql: 'c.email' },
        is_active: { type: 'boolean', sql: 'c.is_active' },
      },
      filters: input.filters,
      search: input.search,
      searchableColumns: ['name', 'email'],
      sort: input.sort,
      defaultSort: { field: 'name', direction: 'asc' },
      activeOnly: true,
      pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
    });
  },
  async get(id: string): Promise<Record<string, unknown> | null> {
    return getById<Record<string, unknown>>('clients', id);
  },
  async create(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return insertRow('clients', data);
  },
  async update(id: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const { updateRow } = await import('@jsk/shared-kernel');
    return updateRow('clients', id, data);
  },
  async remove(id: string): Promise<boolean> {
    const { softDeleteRow } = await import('@jsk/shared-kernel');
    return softDeleteRow('clients', id);
  },
};

// ---------------------------------------------------------------------------
// Projects (FR-101, WF-009)
// ---------------------------------------------------------------------------

export interface CreateProjectInput {
  name: string;
  client_id?: string;
  client?: { name: string; contact_person?: string; email?: string; phone?: string };
  project_lead_id?: string;
  team_member_ids?: string[];
  approximate_tasks?: number;
  summary?: string;
  start_date?: string;
  duration_days?: number;
  ending_date?: string;
  status?: string;
  latitude?: number | null;
  longitude?: number | null;
  check_in_radius?: number | null;
  /** Optional per-project card appearance; null/undefined = default styling. */
  card_color?: string | null;
  text_color?: string | null;
  open_for_all?: boolean;
}

/**
 * Validates an optional CSS hex color (#rgb, #rgba, #rrggbb, #rrggbbaa).
 * Returns the lowercased value, null for empty/absent (reset to default), and
 * throws a stable domain error for malformed input so bad values can never
 * reach the DOM.
 */
export function normalizeOptionalColor(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`project.${field}_invalid`);
  const v = value.trim().toLowerCase();
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)) {
    throw new Error(`project.${field}_invalid`);
  }
  return v;
}

export async function createProject(input: CreateProjectInput): Promise<Record<string, unknown>> {
  return withTransaction(async (client) => {
    let clientId = input.client_id;
    if (!clientId && input.client) {
      // Check for existing client by name first (case-insensitive, matching the DB unique index)
      const existing = await client.query('SELECT id FROM clients WHERE lower(name) = lower($1)', [input.client.name]);
      if (existing.rows[0]) {
        clientId = existing.rows[0].id;
      } else {
        const { rows } = await client.query(
          `INSERT INTO clients (name, contact_person, email, phone)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [input.client.name, input.client.contact_person ?? null, input.client.email ?? null, input.client.phone ?? null]
        );
        clientId = rows[0].id;
      }
    }
    if (!clientId) {
      throw new Error('project.client_required');
    }

    const start = input.start_date ?? new Date().toISOString().slice(0, 10);
    const duration = input.duration_days ?? (input.ending_date ? diffDays(start, input.ending_date) : 0);
    const ending = input.ending_date ?? addDays(start, duration);
    if (ending < start) {
      throw new Error('project.end_before_start');
    }

    const cardColor = normalizeOptionalColor(input.card_color, 'card_color');
    const textColor = normalizeOptionalColor(input.text_color, 'text_color');
    const openForAll = input.open_for_all !== false;
    const { rows } = await client.query<Record<string, unknown>>(
      `INSERT INTO projects (name, client_id, project_lead_id, approximate_tasks, summary, start_date, duration_days, ending_date, status,
                             latitude, longitude, check_in_radius, card_color, text_color, open_for_all)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8::date, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        input.name,
        clientId,
        input.project_lead_id ?? null,
        input.approximate_tasks ?? 0,
        input.summary ?? '',
        start,
        duration,
        ending,
        input.status ?? 'open',
        input.latitude ?? null,
        input.longitude ?? null,
        input.check_in_radius ?? 100,
        cardColor,
        textColor,
        openForAll,
      ]
    );
    const project = rows[0];

    for (const memberId of input.team_member_ids ?? []) {
      await client.query(
        `INSERT INTO project_members (project_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [project.id, memberId]
      );
    }
    return project;
  });
}

const PROJECT_COLUMNS: ColumnMap = {
  id: { type: 'uuid', sql: 'p.id' },
  name: { type: 'text', sql: 'p.name' },
  client_id: { type: 'uuid', sql: 'p.client_id' },
  project_lead_id: { type: 'uuid', sql: 'p.project_lead_id' },
  status: { type: 'text', sql: 'p.status' },
  start_date: { type: 'date', sql: 'p.start_date' },
  ending_date: { type: 'date', sql: 'p.ending_date' },
  client_name: { type: 'text', sql: 'c.name' },
  lead_name: { type: 'text', sql: 'e.full_name' },
  latitude: { type: 'numeric', sql: 'p.latitude' },
  longitude: { type: 'numeric', sql: 'p.longitude' },
  check_in_radius: { type: 'numeric', sql: 'p.check_in_radius' },
  open_for_all: { type: 'boolean', sql: 'p.open_for_all' },
};

export async function listProjects(input: { filters?: FilterParam[]; sort?: SortParam | null; page?: number; per_page?: number; employeeId?: string | null }): Promise<PaginatedResponse<Record<string, unknown>>> {
  return list({
    table: 'projects p',
    columns: PROJECT_COLUMNS,
    joins: `LEFT JOIN clients c ON c.id = p.client_id
            LEFT JOIN employees e ON e.id = p.project_lead_id`,
    select: `p.*, c.name AS client_name, e.full_name AS lead_name,
             (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.status <> 'cancelled') AS task_total,
             (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.status = 'done') AS task_done`,
    filters: input.filters,
    sort: input.sort,
    defaultSort: { field: 'name', direction: 'asc' },
    activeOnly: true,
    pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
    ...(input.employeeId
      ? {
          extraWhere:
            '(p.open_for_all = true OR p.project_lead_id = $1::uuid OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.employee_id = $1::uuid))',
          extraParams: [input.employeeId],
        }
      : {}),
  });
}

/** True when the employee leads the project, the project is open to all, or is listed in project_members. */
export async function isProjectMember(projectId: string, employeeId: string): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM projects p
        WHERE p.id = $1::uuid
          AND (p.open_for_all = true
            OR p.project_lead_id = $2::uuid
            OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.employee_id = $2::uuid))
     ) AS exists`,
    [projectId, employeeId]
  );
  return rows[0]?.exists ?? false;
}

export async function getProject(id: string): Promise<Record<string, unknown> | null> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT p.*, c.name AS client_name, e.full_name AS lead_name
         FROM projects p
         LEFT JOIN clients c ON c.id = p.client_id
         LEFT JOIN employees e ON e.id = p.project_lead_id
        WHERE p.id = $1::uuid`,
      [id]
    );
    if (rows.length === 0) return null;
    const project = rows[0];
    project.members = (await client.query(
      `SELECT m.*, e.full_name FROM project_members m JOIN employees e ON e.id = m.employee_id WHERE m.project_id = $1`,
      [id]
    )).rows;
    project.taskSummary = (await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE t.status <> 'cancelled')::int AS total,
         COUNT(*) FILTER (WHERE t.status = 'todo')::int AS todo,
         COUNT(*) FILTER (WHERE t.status = 'in_progress')::int AS in_progress,
         COUNT(*) FILTER (WHERE t.status = 'review')::int AS review,
         COUNT(*) FILTER (WHERE t.status = 'done')::int AS done,
         COUNT(*) FILTER (WHERE t.status = 'blocked')::int AS blocked,
         COUNT(*) FILTER (WHERE t.status = 'cancelled')::int AS cancelled
       FROM tasks t WHERE t.project_id = $1 AND t.deleted_at IS NULL`,
      [id]
    )).rows[0] ?? { total: 0, todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0, cancelled: 0 };
    return project;
  });
}

export async function updateProject(id: string, data: Record<string, unknown> & { version?: number }): Promise<Record<string, unknown> | null> {
  // Progress is derived from tasks (BR-015) — never manually written.
  const { progress: _ignoredProgress, version, ...rest } = data;
  // Optional appearance colors: '' / null reset to default (stored as NULL).
  if ('card_color' in rest) rest.card_color = normalizeOptionalColor(rest.card_color, 'card_color');
  if ('text_color' in rest) rest.text_color = normalizeOptionalColor(rest.text_color, 'text_color');
  // `summary` is NOT NULL in the schema; empty edits keep the create-path behavior.
  if ('summary' in rest && (rest.summary === null || rest.summary === undefined || rest.summary === '')) {
    rest.summary = '';
  }
  const payload: Record<string, unknown> = { ...rest };
  if (rest.start_date && rest.duration_days !== undefined) {
    payload.ending_date = addDays(rest.start_date as string, Number(rest.duration_days));
  }
  if (version !== undefined) payload.version = version;
  if (Array.isArray(rest.team_member_ids)) {
    const memberIds = rest.team_member_ids as string[];
    delete payload.team_member_ids;
    await query(`DELETE FROM project_members WHERE project_id = $1::uuid`, [id]);
    for (const memberId of memberIds) {
      await query(
        `INSERT INTO project_members (project_id, employee_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`,
        [id, memberId]
      );
    }
  }
  const { updateRow } = await import('@jsk/shared-kernel');
  return updateRow('projects', id, payload, { versioned: version !== undefined });
}

/**
 * Task progress semantics (BR-015, automatic project progress):
 * - A task's contribution is its explicit progress_percent (0..100), except that
 *   a completed (status = 'done') task always contributes 100%.
 * - Cancelled tasks are excluded from the denominator (no longer required).
 * - Weighting: estimated_hours when positive, otherwise equal weight (1).
 * - No applicable tasks → 0%, never NaN.
 */
export interface TaskProgressRow {
  status: string;
  progress_percent: number | string | null;
  estimated_hours: number | string | null;
}

export interface ProjectProgressResult {
  /** 0..100, rounded to 2 decimals */
  progress: number;
  totalWeight: number;
  earnedWeight: number;
  totalTasks: number;
  completedTasks: number;
}

export function calculateTaskProgress(rows: TaskProgressRow[]): ProjectProgressResult {
  let totalWeight = 0;
  let earnedWeight = 0;
  let totalTasks = 0;
  let completedTasks = 0;
  for (const row of rows) {
    if (!row || row.status === 'cancelled') continue;
    const hours = Number(row.estimated_hours);
    const weight = Number.isFinite(hours) && hours > 0 ? hours : 1;
    const explicit = Number(row.progress_percent);
    const pct = Number.isFinite(explicit) ? Math.min(100, Math.max(0, explicit)) : 0;
    const contribution = row.status === 'done' ? 1 : pct / 100;
    totalWeight += weight;
    earnedWeight += weight * contribution;
    totalTasks += 1;
    if (row.status === 'done') completedTasks += 1;
  }
  const progress = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 10000) / 100 : 0;
  return { progress, totalWeight, earnedWeight, totalTasks, completedTasks };
}

/**
 * Recomputes project progress from the current applicable task state (BR-015)
 * and persists it on the project row. Single source of truth on the backend.
 */
export async function recomputeProjectProgress(projectId: string, queryable?: Queryable): Promise<ProjectProgressResult> {
  const { rows } = await query<TaskProgressRow>(
    `SELECT status, progress_percent, estimated_hours FROM tasks WHERE project_id = $1 AND deleted_at IS NULL`,
    [projectId],
    queryable
  );
  const result = calculateTaskProgress(rows);
  await query(`UPDATE projects SET progress = $2, updated_at = now() WHERE id = $1::uuid`, [projectId, result.progress], queryable);
  return result;
}

export async function removeProject(id: string): Promise<boolean> {
  const { softDeleteRow } = await import('@jsk/shared-kernel');
  return softDeleteRow('projects', id);
}

export async function projectDashboard(): Promise<Record<string, unknown>> {
  const taskStatus = (await query(`SELECT status, count(*)::int AS n FROM tasks GROUP BY status`)).rows;
  const projects = (await query(
    `SELECT p.id, p.name, c.name AS client, e.full_name AS lead, p.progress, p.start_date, p.ending_date,
            p.duration_days, p.status, p.approximate_tasks, p.card_color, p.text_color,
            (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.status <> 'cancelled') AS task_total,
            (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.status = 'done') AS task_done
       FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id
       LEFT JOIN employees e ON e.id = p.project_lead_id
      WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC`
  )).rows;
  return { taskStatus, projects };
}

/**
 * Project analytics (BR-018): global task status/priority distribution,
 * per-assignee workload (factual: active, done, overdue), and upcoming
 * deadlines. `employeeId` restricts workload + status to one assignee.
 */
export async function projectAnalytics(employeeId?: string | null): Promise<Record<string, unknown>> {
  const scope = employeeId ? ` WHERE assignee_id = $1::uuid AND deleted_at IS NULL` : ` WHERE deleted_at IS NULL`;
  const params: unknown[] = employeeId ? [employeeId] : [];
  const [taskStatus, priorities, workload, deadlines, byStatus, completionTrend] = await Promise.all([
    query(
      `SELECT status, COUNT(*)::int AS n FROM tasks${scope} GROUP BY status ORDER BY n DESC`,
      params
    ),
    query(
      `SELECT priority, COUNT(*)::int AS n FROM tasks${scope} GROUP BY priority ORDER BY n DESC`,
      params
    ),
    query(
      `SELECT p.status, COUNT(*)::int AS n FROM projects p
        WHERE p.deleted_at IS NULL GROUP BY p.status ORDER BY n DESC`,
      []
    ),
    query(
      `SELECT to_char(date_trunc('week', COALESCE(actual_completion, planned_end)), 'YYYY-MM-DD') AS week,
              COUNT(*)::int AS n
         FROM tasks
        WHERE deleted_at IS NULL AND status = 'done'
          AND COALESCE(actual_completion, planned_end) >= CURRENT_DATE - 180
        GROUP BY week ORDER BY week`,
      []
    ),
    query(
      `SELECT e.full_name, e.id AS employee_id,
              COUNT(*) FILTER (WHERE t.status NOT IN ('done','cancelled'))::int AS active,
              COUNT(*) FILTER (WHERE t.status = 'done')::int AS done,
              COUNT(*) FILTER (WHERE t.status NOT IN ('done','cancelled') AND t.planned_end < CURRENT_DATE)::int AS overdue
         FROM tasks t JOIN employees e ON e.id = t.assignee_id
        WHERE t.deleted_at IS NULL${employeeId ? ' AND t.assignee_id = $1::uuid' : ''}
        GROUP BY e.full_name, e.id
        ORDER BY active DESC LIMIT 12`,
      params
    ),
    query(
      `SELECT p.name, t.title, t.planned_end, t.status
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.deleted_at IS NULL AND t.status NOT IN ('done','cancelled')
          AND t.planned_end IS NOT NULL AND t.planned_end BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
        ORDER BY t.planned_end LIMIT 10`,
      []
    ),
  ]);
  return {
    taskStatus: taskStatus.rows,
    priorities: priorities.rows,
    workload: workload.rows,
    deadlines: deadlines.rows,
    byStatus: byStatus.rows,
    completionTrend: completionTrend.rows,
  };
}

// ---------------------------------------------------------------------------
// Tasks (FR-103, SM-5)
// ---------------------------------------------------------------------------

export async function createTask(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  return withTransaction(async (client) => {
    const status = (data.status as string | undefined) ?? 'todo';
    const progress = status === 'done' ? 100 : (data.progress_percent ?? 0);
    const assigneeIds = Array.isArray(data.assignee_ids)
      ? (data.assignee_ids as string[])
      : (data.assignee_id ? [data.assignee_id as string] : []);
    const primaryAssignee = assigneeIds[0] ?? (data.assignee_id as string) ?? null;

    const { rows } = await client.query(
      `INSERT INTO tasks (project_id, title, description, assignee_id, priority, planned_start, planned_end, status, progress_percent, estimated_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        data.project_id,
        data.title,
        data.description ?? '',
        primaryAssignee,
        data.priority ?? 'medium',
        data.planned_start ?? null,
        data.planned_end ?? null,
        status,
        progress,
        data.estimated_hours ?? null,
      ]
    );
    const task = rows[0];
    for (const empId of assigneeIds) {
      await client.query(
        `INSERT INTO task_assignees (task_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [task.id, empId]
      );
    }
    await recomputeProjectProgress(data.project_id as string, client);
    return task;
  });
}

export async function listTasks(input: { filters?: FilterParam[]; sort?: SortParam | null; page?: number; per_page?: number }): Promise<PaginatedResponse<Record<string, unknown>>> {
  return list({
    table: 'tasks t',
    columns: {
      id: { type: 'uuid', sql: 't.id' },
      project_id: { type: 'uuid', sql: 't.project_id' },
      title: { type: 'text', sql: 't.title' },
      status: { type: 'text', sql: 't.status' },
      priority: { type: 'text', sql: 't.priority' },
      assignee_id: { type: 'uuid', sql: 't.assignee_id' },
      progress_percent: { type: 'decimal', sql: 't.progress_percent' },
      project_name: { type: 'text', sql: 'p.name' },
      assignee_name: { type: 'text', sql: 'e.full_name' },
    },
    joins: `JOIN projects p ON p.id = t.project_id
            LEFT JOIN employees e ON e.id = t.assignee_id`,
    select: `t.*, p.name AS project_name, e.full_name AS assignee_name,
             ARRAY(SELECT ta.employee_id FROM task_assignees ta WHERE ta.task_id = t.id) AS assignee_ids,
             (SELECT string_agg(emp.full_name, ', ') FROM task_assignees ta JOIN employees emp ON emp.id = ta.employee_id WHERE ta.task_id = t.id) AS all_assignees`,
    filters: input.filters,
    sort: input.sort,
    defaultSort: { field: 'title', direction: 'asc' },
    activeOnly: true,
    pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
  });
}

export async function updateTask(id: string, data: Record<string, unknown> & { version?: number }): Promise<Record<string, unknown> | null> {
  const { version, ...rest } = data;
  return withTransaction(async (client) => {
    const { rows: existingRows } = await client.query<{ project_id: string; status: string }>(
      `SELECT project_id, status FROM tasks WHERE id = $1::uuid AND deleted_at IS NULL`,
      [id]
    );
    const existing = existingRows[0];
    if (!existing) return null;

    const payload: Record<string, unknown> = { ...rest };
    // Completion semantics: done always counts 100%; reopening resets to 0
    // unless the caller explicitly supplies a new partial progress.
    if (rest.status === 'done') {
      payload.progress_percent = 100;
    } else if (
      existing.status === 'done' &&
      rest.status !== undefined &&
      rest.status !== 'done' &&
      payload.progress_percent === undefined
    ) {
      payload.progress_percent = 0;
    }
    if (version !== undefined) payload.version = version;

    if (data.assignee_ids !== undefined) {
      const assigneeIds = Array.isArray(data.assignee_ids) ? (data.assignee_ids as string[]) : [];
      delete payload.assignee_ids;
      payload.assignee_id = assigneeIds[0] ?? null;
      await client.query(`DELETE FROM task_assignees WHERE task_id = $1::uuid`, [id]);
      for (const empId of assigneeIds) {
        await client.query(
          `INSERT INTO task_assignees (task_id, employee_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`,
          [id, empId]
        );
      }
    }

    const { updateRow } = await import('@jsk/shared-kernel');
    const result = await updateRow<Record<string, unknown>>('tasks', id, payload, { versioned: version !== undefined, queryable: client });

    const newProjectId = rest.project_id !== undefined ? (rest.project_id as string) : existing.project_id;
    if (rest.project_id !== undefined && rest.project_id !== existing.project_id) {
      await recomputeProjectProgress(existing.project_id, client);
    }
    await recomputeProjectProgress(newProjectId, client);
    return result;
  });
}

export async function removeTask(id: string): Promise<boolean> {
  const { rows } = await query<{ project_id: string }>(
    `SELECT project_id FROM tasks WHERE id = $1::uuid AND deleted_at IS NULL`,
    [id]
  );
  const removed = await softDeleteRow('tasks', id);
  if (removed && rows[0]?.project_id) {
    await recomputeProjectProgress(rows[0].project_id);
  }
  return removed;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Work Log (FR-104) — premium upgrade of daily_tasks
// ---------------------------------------------------------------------------

export const WORK_LOG_STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const;
export type WorkLogStatus = (typeof WORK_LOG_STATUSES)[number];

/** Employees may create/edit/delete only their own Draft/Rejected logs. */
export const WORK_LOG_EMPLOYEE_EDITABLE = ['draft', 'rejected'] as const;

/** Managers can Approve/Reject Draft or Submitted logs (Submitted is the gate). */
export const WORK_LOG_APPROVAL_ELIGIBLE = ['draft', 'submitted'] as const;

export function canEmployeeEditLog(status: string | null | undefined): boolean {
  return (WORK_LOG_EMPLOYEE_EDITABLE as readonly string[]).includes(status ?? '');
}

export function canEmployeeDeleteLog(status: string | null | undefined): boolean {
  return (WORK_LOG_EMPLOYEE_EDITABLE as readonly string[]).includes(status ?? '');
}

export function canManagerActOnLog(status: string | null | undefined): boolean {
  return (WORK_LOG_APPROVAL_ELIGIBLE as readonly string[]).includes(status ?? '');
}

/** Workflow: Draft -> Submitted -> Approved; Submitted -> Rejected -> resubmit. */
export function applyWorkLogTransition(
  currentStatus: string | null | undefined,
  action: 'submit' | 'approve' | 'reject'
): WorkLogStatus | null {
  if (action === 'submit') {
    if (currentStatus === 'draft' || currentStatus === 'rejected') return 'submitted';
    return null;
  }
  if (currentStatus === 'draft' || currentStatus === 'submitted') {
    return action === 'approve' ? 'approved' : 'rejected';
  }
  return null;
}

export async function createDailyTask(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const attachmentIds = Array.isArray(data.attachment_ids)
    ? data.attachment_ids.filter((id) => typeof id === 'string' && id)
    : [];
  return insertRow('daily_tasks', {
    employee_id: data.employee_id,
    project_id: data.project_id ?? null,
    task_id: data.task_id ?? null,
    work_description: data.work_description ?? data.description ?? '',
    hours: data.hours ?? 0,
    work_date: data.work_date ?? new Date().toISOString().slice(0, 10),
    status: 'draft',
    attachment_ids: attachmentIds,
  });
}

export async function updateDailyTask(id: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (data.description !== undefined && data.work_description === undefined) {
    data.work_description = data.description;
  }
  const allowed = ['project_id', 'task_id', 'work_date', 'work_description', 'hours', 'attachment_ids'];
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  for (const field of allowed) {
    if (data[field] !== undefined) {
      if (field === 'attachment_ids') {
        const ids = Array.isArray(data[field])
          ? (data[field] as unknown[]).filter((x) => typeof x === 'string' && x)
          : [];
        sets.push(`${field} = $${idx++}::uuid[]`);
        params.push(ids);
      } else {
        sets.push(`${field} = $${idx++}`);
        params.push(data[field]);
      }
    }
  }
  if (sets.length === 0) return null;
  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await query(`UPDATE daily_tasks SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`, params);
  return rows[0] ?? null;
}

export async function removeDailyTask(id: string): Promise<boolean> {
  await query(`DELETE FROM daily_tasks WHERE id = $1::uuid`, [id]);
  return true;
}

/**
 * Employee self-service: submit own Draft/Rejected logs for approval.
 * Transition happens only for eligible statuses; returns the number changed.
 */
export async function submitDailyTasks(ids: string[], employeeId: string): Promise<number> {
  const { rowCount } = await query(
    `UPDATE daily_tasks
        SET status = 'submitted',
            submitted_at = now(),
            rejection_reason = NULL,
            rejected_by = NULL,
            rejected_at = NULL,
            updated_at = now()
      WHERE id = ANY($1::uuid[])
        AND employee_id = $2::uuid
        AND status IN ('draft', 'rejected')`,
    [ids, employeeId]
  );
  return rowCount ?? 0;
}

export async function listDailyTasks(input: { filters?: FilterParam[] | undefined; search?: string | undefined; page?: number | undefined; per_page?: number | undefined }): Promise<PaginatedResponse<Record<string, unknown>>> {
  return list({
    table: 'daily_tasks dt',
    columns: {
      id: { type: 'uuid', sql: 'dt.id' },
      employee_id: { type: 'uuid', sql: 'dt.employee_id' },
      project_id: { type: 'uuid', sql: 'dt.project_id' },
      task_id: { type: 'uuid', sql: 'dt.task_id' },
      work_date: { type: 'date', sql: 'dt.work_date' },
      status: { type: 'text', sql: 'dt.status' },
      work_description: { type: 'text', sql: 'dt.work_description' },
      hours: { type: 'decimal', sql: 'dt.hours' },
      full_name: { type: 'text', sql: 'e.full_name' },
      project_name: { type: 'text', sql: 'p.name' },
      task_name: { type: 'text', sql: 't.title' },
      approved_by: { type: 'text', sql: 'dt.approved_by' },
      rejected_by: { type: 'text', sql: 'dt.rejected_by' },
    },
    joins: `JOIN employees e ON e.id = dt.employee_id
            LEFT JOIN projects p ON p.id = dt.project_id
            LEFT JOIN tasks t ON t.id = dt.task_id
            LEFT JOIN users ua ON ua.id = dt.approved_by
            LEFT JOIN users ur ON ur.id = dt.rejected_by`,
    select: `dt.id, dt.employee_id, dt.project_id, dt.task_id, dt.work_date::text AS work_date, dt.status,
             dt.work_description, dt.hours, dt.created_at, dt.updated_at,
             dt.approved_by, dt.approved_at, dt.rejected_by, dt.rejected_at,
             dt.rejection_reason, dt.submitted_at, dt.attachment_ids,
             e.full_name, e.employee_code, p.name AS project_name, t.title AS task_name,
             ua.full_name AS approved_by_name, ur.full_name AS rejected_by_name`,
    filters: input.filters,
    search: input.search,
    searchableColumns: ['full_name', 'work_description', 'project_name', 'task_name'],
    defaultSort: { field: 'work_date', direction: 'desc' },
    pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
  });
}

/**
 * Approves or rejects work logs (approval workflow).
 * Only draft/submitted rows transition; already approved/rejected rows are
 * left untouched so the returned count reflects actual transitions.
 */
export async function updateDailyTaskApproval(
  ids: string[],
  action: 'approved' | 'rejected',
  actorUserId: string,
  rejectionReason?: string | null
): Promise<number> {
  const { rowCount } = await query(
    `UPDATE daily_tasks
        SET status = $2,
            approved_by = CASE WHEN $2 = 'approved' THEN $3::uuid ELSE NULL END,
            approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE NULL END,
            rejected_by = CASE WHEN $2 = 'rejected' THEN $3::uuid ELSE NULL END,
            rejected_at = CASE WHEN $2 = 'rejected' THEN now() ELSE NULL END,
            rejection_reason = CASE WHEN $2 = 'rejected' THEN $4 ELSE NULL END,
            submitted_at = CASE WHEN $2 = 'approved' THEN COALESCE(submitted_at, now()) ELSE submitted_at END,
            updated_at = now()
      WHERE id = ANY($1::uuid[]) AND status IN ('draft', 'submitted')`,
    [ids, action, actorUserId, rejectionReason ?? null]
  );
  return rowCount ?? 0;
}

/** Scope check: logs that belong to the given employee (self-service). */
export async function countTasksForEmployee(ids: string[], employeeId: string): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM daily_tasks WHERE id = ANY($1::uuid[]) AND employee_id = $2::uuid`,
    [ids, employeeId]
  );
  return rows[0]?.n ?? 0;
}

/** Scope check: logs owned by the current user's employee record (self-approval guard). */
export async function countTasksOwnedBy(ids: string[], employeeId: string): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM daily_tasks WHERE id = ANY($1::uuid[]) AND employee_id = $2::uuid`,
    [ids, employeeId]
  );
  return rows[0]?.n ?? 0;
}

/** Fetch statuses of the given logs (for permission checks before mutating). */
export async function getDailyTaskStatuses(ids: string[]): Promise<Array<{ id: string; status: string; employee_id: string | null }>> {
  if (ids.length === 0) return [];
  const { rows } = await query<{ id: string; status: string; employee_id: string | null }>(
    `SELECT id, status, employee_id::text AS employee_id FROM daily_tasks WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  return rows;
}

/** Aggregated Work Log summary (today hours, week hours, pending, approved). */
export async function workLogSummary(scopeEmployeeId?: string | null): Promise<Record<string, unknown>> {
  const where = scopeEmployeeId ? `WHERE dt.employee_id = $1::uuid` : '';
  const params = scopeEmployeeId ? [scopeEmployeeId] : [];
  const { rows } = await query(
    `SELECT
       COALESCE(round(SUM(dt.hours) FILTER (WHERE dt.work_date = CURRENT_DATE)::numeric, 2), 0)::float8 AS today_hours,
       COALESCE(round(SUM(dt.hours) FILTER (WHERE dt.work_date >= date_trunc('week', CURRENT_DATE))::numeric, 2), 0)::float8 AS week_hours,
       COUNT(*) FILTER (WHERE dt.status = 'submitted')::int AS pending,
       COUNT(*) FILTER (WHERE dt.status = 'approved')::int AS approved
     FROM daily_tasks dt
     ${where}`,
    params
  );
  return rows[0] ?? { today_hours: 0, week_hours: 0, pending: 0, approved: 0 };
}
// Meetings (FR-105, WF-010, BR-013)
// ---------------------------------------------------------------------------

export const MEETING_ATTACHMENT_ALLOWLIST = [
  'mp4', 'mov', 'avi', 'doc', 'docx', 'pdf', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip',
];
export const MEETING_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

export async function createMeeting(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO meetings (project_id, place, held_at, purpose, outcomes, created_by)
       VALUES ($1, $2, $3::timestamptz, $4, $5, $6) RETURNING *`,
      [
        data.project_id,
        data.place,
        data.held_at,
        data.purpose,
        data.outcomes ?? '',
        data.created_by ?? null,
      ]
    );
    const meeting = rows[0];
    for (const employeeId of (data.attendee_ids as string[] | undefined) ?? []) {
      await client.query(
        `INSERT INTO meeting_attendees (meeting_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [meeting.id, employeeId]
      );
    }
    return meeting;
  });
}

export async function listMeetings(input: { filters?: FilterParam[] | undefined; search?: string | undefined; page?: number | undefined; per_page?: number | undefined }): Promise<PaginatedResponse<Record<string, unknown>>> {
  return list({
    table: 'meetings m',
    columns: {
      id: { type: 'uuid', sql: 'm.id' },
      project_id: { type: 'uuid', sql: 'm.project_id' },
      place: { type: 'text', sql: 'm.place' },
      held_at: { type: 'datetime', sql: 'm.held_at' },
      purpose: { type: 'text', sql: 'm.purpose' },
      outcomes: { type: 'text', sql: 'm.outcomes' },
      project_name: { type: 'text', sql: 'p.name' },
    },
      joins: `JOIN projects p ON p.id = m.project_id`,
    select: `m.*, p.name AS project_name`,
    filters: input.filters,
    search: input.search,
    searchableColumns: ['m.purpose', 'm.place', 'm.outcomes', 'p.name'],
    defaultSort: { field: 'held_at', direction: 'desc' },
    activeOnly: true,
    pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
  });
}

export async function getMeeting(id: string): Promise<Record<string, unknown> | null> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT m.*, p.name AS project_name FROM meetings m JOIN projects p ON p.id = m.project_id WHERE m.id = $1::uuid`,
      [id]
    );
    if (rows.length === 0) return null;
    const meeting = rows[0];
    meeting.attendees = (await client.query(
      `SELECT a.employee_id, e.full_name FROM meeting_attendees a JOIN employees e ON e.id = a.employee_id WHERE a.meeting_id = $1`,
      [id]
    )).rows;
    meeting.attachments = (await client.query(
      `SELECT ma.id, ma.file_name, ma.file_size, ma.mime_type, ma.storage_key FROM meeting_attachments ma WHERE ma.meeting_id = $1`,
      [id]
    )).rows;
    return meeting;
  });
}

export async function attachMeetingFile(meetingId: string, fileId: string): Promise<void> {
  await query(`INSERT INTO meeting_attachments (meeting_id, file_id) VALUES ($1, $2::uuid)`, [meetingId, fileId]);
}

export async function getMeetingAttachmentDownload(attachmentId: string): Promise<{ url: string; filename: string }> {
  const { rows } = await query<{ storage_key: string; file_name: string }>(
    `SELECT storage_key, file_name FROM meeting_attachments WHERE id = $1::uuid`,
    [attachmentId]
  );
  if (rows.length === 0) {
    throw new Error('meeting_attachment.not_found');
  }
  return getDownloadUrlByKey(rows[0].storage_key, rows[0].file_name);
}

export async function updateMeeting(id: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  return withTransaction(async (client) => {
    const allowed = ['project_id', 'place', 'held_at', 'purpose', 'outcomes'];
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    for (const field of allowed) {
      if (data[field] !== undefined) { sets.push(`${field} = $${idx++}`); params.push(data[field]); }
    }
    if (sets.length === 0) return null;
    sets.push('updated_at = now()');
    params.push(id);
    const { rows } = await client.query(
      `UPDATE meetings SET ${sets.join(', ')} WHERE id = $${idx}::uuid AND deleted_at IS NULL RETURNING *`,
      params
    );
    if (rows.length === 0) return null;
    if (Array.isArray(data.attendee_ids)) {
      await client.query(`DELETE FROM meeting_attendees WHERE meeting_id = $1`, [id]);
      for (const employeeId of data.attendee_ids as string[]) {
        await client.query(
          `INSERT INTO meeting_attendees (meeting_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, employeeId]
        );
      }
    }
    return rows[0];
  });
}

export async function removeMeeting(id: string): Promise<boolean> {
  await query(`UPDATE meetings SET deleted_at = now() WHERE id = $1::uuid`, [id]);
  return true;
}

// ---------------------------------------------------------------------------
// PM reports (FR-106)
// ---------------------------------------------------------------------------

/**
 * Report semantics (matches BR-015 / service.ts header):
 * - project_progress  = avg(progress_percent) of non-cancelled, non-deleted tasks
 * - avg_task_progress = avg(progress_percent) of non-cancelled, non-deleted tasks
 *   (same population as project progress, so the two columns stay consistent)
 * - total_tasks / done_tasks count all non-deleted tasks
 * - member filter matches: project lead, project_members row, or task assignee
 */

export interface ProjectReportInput {
  projectId?: string;
  clientId?: string;
  memberId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  sort?: SortParam | null;
  page?: number;
  perPage?: number;
  all?: boolean;
}

const PROJECT_REPORT_SORTS: Record<string, string> = {
  name: 'report.name',
  client: 'report.client_name',
  status: 'report.status',
  progress: 'report.project_progress',
  start_date: 'report.start_date',
  ending_date: 'report.ending_date',
  task_count: 'report.total_tasks',
  avg_task_progress: 'report.avg_task_progress',
};

export const PROJECT_REPORT_STATUSES = ['open', 'in_progress', 'on_hold', 'completed', 'cancelled'];

const REPORT_SELECT = `
  SELECT p.id, p.name,
         c.id AS client_id, c.name AS client_name,
         e.id AS lead_id, e.full_name AS lead_name,
         p.status,
         p.start_date::text AS start_date, p.ending_date::text AS ending_date,
         round(avg(t.progress_percent) FILTER (
           WHERE t.deleted_at IS NULL AND t.status <> 'cancelled'), 2)::float8 AS project_progress,
         count(t.id) FILTER (WHERE t.deleted_at IS NULL)::int AS total_tasks,
         count(t.id) FILTER (WHERE t.deleted_at IS NULL AND t.status = 'done')::int AS done_tasks,
         round(avg(t.progress_percent) FILTER (
           WHERE t.deleted_at IS NULL AND t.status <> 'cancelled'), 2)::float8 AS avg_task_progress
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN employees e ON e.id = p.project_lead_id
    LEFT JOIN tasks t ON t.project_id = p.id
   WHERE p.deleted_at IS NULL`;

function buildReportFilters(input: ProjectReportInput): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (cond: string, value: unknown) => {
    params.push(value);
    where.push(cond.split('$n').join(`$${params.length}`));
  };

  if (input.projectId) add(`p.id = $n::uuid`, input.projectId);
  if (input.clientId) add(`p.client_id = $n::uuid`, input.clientId);
  if (input.status) {
    if (!PROJECT_REPORT_STATUSES.includes(input.status)) {
      throw new Error('report.invalid_status');
    }
    add(`p.status = $n`, input.status);
  }
  if (input.dateFrom) add(`p.start_date >= $n::date`, input.dateFrom);
  if (input.dateTo) add(`p.start_date <= $n::date`, input.dateTo);
  if (input.memberId) {
    add(
      `(p.project_lead_id = $n::uuid
        OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.employee_id = $n::uuid)
        OR EXISTS (SELECT 1 FROM tasks mt WHERE mt.project_id = p.id AND mt.assignee_id = $n::uuid AND mt.deleted_at IS NULL))`,
      input.memberId
    );
  }
  if (input.search && input.search.trim() !== '') {
    add(
      `(p.name ILIKE '%' || $n::text || '%'
        OR c.name ILIKE '%' || $n::text || '%'
        OR e.full_name ILIKE '%' || $n::text || '%'
        OR p.status ILIKE '%' || $n::text || '%')`,
      input.search.trim()
    );
  }
  return { sql: where.length > 0 ? ` AND ${where.join(' AND ')}` : '', params };
}

function reportOrder(input: ProjectReportInput): string {
  const field = input.sort?.field ?? 'name';
  const dir = input.sort?.direction === 'desc' ? 'DESC' : 'ASC';
  const col = PROJECT_REPORT_SORTS[field] ?? PROJECT_REPORT_SORTS['name'];
  return `ORDER BY ${col} ${dir} NULLS LAST, report.name ASC`;
}

export async function projectReports(input: ProjectReportInput): Promise<Record<string, unknown>> {
  const { sql: filterSql, params } = buildReportFilters(input);
  const orderSql = reportOrder(input);

  const reportCte = `WITH report AS (${REPORT_SELECT}${filterSql} GROUP BY p.id, c.id, c.name, e.id, e.full_name)`;

  const [{ rows: countRows }, { rows: summaryRows }] = await Promise.all([
    query(`SELECT count(*)::int AS total FROM (${REPORT_SELECT}${filterSql} GROUP BY p.id, c.id, c.name, e.id, e.full_name) r`, params),
    query(
      `SELECT
         count(*)::int AS total_projects,
         count(*) FILTER (WHERE status IN ('open','in_progress'))::int AS active_projects,
         count(*) FILTER (WHERE status = 'completed')::int AS completed_projects,
         coalesce(sum(total_tasks), 0)::int AS total_tasks,
         coalesce(sum(done_tasks), 0)::int AS completed_tasks,
         round(avg(project_progress) FILTER (WHERE project_progress IS NOT NULL)::numeric, 2)::float8 AS avg_project_progress
       FROM (${REPORT_SELECT}${filterSql} GROUP BY p.id, c.id, c.name, e.id, e.full_name) s`,
      params
    ),
  ]);

  const total = countRows[0]?.total ?? 0;
  const summary = summaryRows[0] ?? {
    total_projects: 0, active_projects: 0, completed_projects: 0,
    total_tasks: 0, completed_tasks: 0, avg_project_progress: null,
  };

  if (input.all) {
    const { rows } = await query(`${reportCte} SELECT * FROM report ${orderSql}`, params);
    return { data: { items: rows, total, summary } };
  }

  const page = input.page ?? 1;
  const perPage = input.perPage ?? 10;
  const offset = (page - 1) * perPage;
  const { rows } = await query(
    `${reportCte} SELECT * FROM report ${orderSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, offset]
  );
  return {
    data: {
      items: rows,
      page,
      per_page: perPage,
      total,
      total_pages: Math.max(1, Math.ceil(total / perPage)),
      summary,
    },
  };
}

// ---------------------------------------------------------------------------
// Sprints (Spec 5.3)
// ---------------------------------------------------------------------------

export async function listSprints(projectId: string) {
  const { rows } = await query(
    `SELECT * FROM sprints WHERE project_id = $1::uuid AND deleted_at IS NULL ORDER BY start_date`,
    [projectId]
  );
  return rows;
}

export async function createSprint(data: { project_id: string; name: string; goal?: string; start_date?: string; end_date?: string }) {
  const { rows } = await query(
    `INSERT INTO sprints (project_id, name, goal, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.project_id, data.name, data.goal ?? '', data.start_date ?? null, data.end_date ?? null]
  );
  return rows[0];
}

export async function updateSprint(id: string, data: { name?: string; goal?: string; start_date?: string; end_date?: string; status?: string }) {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name); }
  if (data.goal !== undefined) { sets.push(`goal = $${idx++}`); params.push(data.goal); }
  if (data.start_date !== undefined) { sets.push(`start_date = $${idx++}`); params.push(data.start_date); }
  if (data.end_date !== undefined) { sets.push(`end_date = $${idx++}`); params.push(data.end_date); }
  if (data.status !== undefined) { sets.push(`status = $${idx++}`); params.push(data.status); }
  if (sets.length === 0) return null;
  sets.push(`updated_at = now()`);
  params.push(id);
  const { rows } = await query(`UPDATE sprints SET ${sets.join(', ')} WHERE id = $${idx}::uuid AND deleted_at IS NULL RETURNING *`, params);
  return rows[0] ?? null;
}

export async function removeSprint(id: string) {
  await query(`UPDATE sprints SET deleted_at = now() WHERE id = $1::uuid`, [id]);
  return true;
}

// ---------------------------------------------------------------------------
// Task Counts (Spec 5.3 — counter tiles)
// ---------------------------------------------------------------------------

export async function getTaskCounts(projectId: string) {
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS total,
       COUNT(*) FILTER (WHERE status = 'todo')::int AS todo,
       COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
       COUNT(*) FILTER (WHERE status = 'review')::int AS review,
       COUNT(*) FILTER (WHERE status = 'done')::int AS done,
       COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
     FROM tasks WHERE project_id = $1::uuid AND deleted_at IS NULL`,
    [projectId]
  );
  return rows[0] ?? { total: 0, todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0, cancelled: 0 };
}

/** Ownership check: is the task assigned to the given employee (self-service). */
export async function isTaskAssignedTo(taskId: string, employeeId: string): Promise<boolean> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM tasks WHERE id = $1::uuid AND assignee_id = $2::uuid AND deleted_at IS NULL`,
    [taskId, employeeId]
  );
  return (rows[0]?.n ?? 0) === 1;
}

// ---------------------------------------------------------------------------
// Meeting Attachments (Spec 5.3)
// ---------------------------------------------------------------------------

export async function listMeetingAttachments(meetingId: string) {
  const { rows } = await query(
    `SELECT * FROM meeting_attachments WHERE meeting_id = $1::uuid ORDER BY created_at`,
    [meetingId]
  );
  return rows;
}

export async function addMeetingAttachment(data: { meeting_id: string; file_name: string; file_size: number; mime_type?: string; storage_key: string; uploaded_by?: string }) {
  const { rows } = await query(
    `INSERT INTO meeting_attachments (meeting_id, file_name, file_size, mime_type, storage_key, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [data.meeting_id, data.file_name, data.file_size, data.mime_type ?? 'application/octet-stream', data.storage_key, data.uploaded_by ?? null]
  );
  return rows[0];
}

export async function removeMeetingAttachment(id: string) {
  await query('DELETE FROM meeting_attachments WHERE id = $1::uuid', [id]);
  return true;
}

// ---------------------------------------------------------------------------
// Project Geo-Location (Spec 5.2)
// ---------------------------------------------------------------------------

export async function updateProjectGeoLocation(projectId: string, data: { latitude: number; longitude: number; check_in_radius?: number }) {
  const { rows } = await query(
    `UPDATE projects SET latitude = $2, longitude = $3, check_in_radius = $4, updated_at = now()
     WHERE id = $1::uuid AND deleted_at IS NULL RETURNING *`,
    [projectId, data.latitude, data.longitude, data.check_in_radius ?? 100]
  );
  return rows[0] ?? null;
}
