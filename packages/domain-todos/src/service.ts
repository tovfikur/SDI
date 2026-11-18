import { query } from '@jsk/shared-kernel';

export interface EmployeeTodo {
  id: string;
  employee_id: string;
  todo_date: string;
  title: string;
  is_completed: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(date: unknown): string {
  const d = typeof date === 'string' ? date.trim() : '';
  if (!DATE_RE.test(d) || Number.isNaN(new Date(`${d}T00:00:00Z`).getTime())) {
    throw new Error('todo_date must be a valid date (YYYY-MM-DD)');
  }
  return d;
}

function assertTitle(title: unknown): string {
  const t = typeof title === 'string' ? title.trim() : '';
  if (t.length === 0) throw new Error('Title is required');
  if (t.length > 500) throw new Error('Title must be 500 characters or fewer');
  return t;
}

/** All todos for one employee on one date (owner view — any date). */
export async function listTodos(employeeId: string, date: string): Promise<EmployeeTodo[]> {
  const d = assertDate(date);
  const { rows } = await query<EmployeeTodo>(
    `SELECT id, employee_id, todo_date::text AS todo_date, title, is_completed,
            created_at, updated_at, completed_at
       FROM employee_todos
      WHERE employee_id = $1::uuid AND todo_date = $2::date AND deleted_at IS NULL
      ORDER BY created_at`,
    [employeeId, d]
  );
  return rows;
}

export async function createTodo(input: {
  employee_id: string;
  todo_date?: unknown;
  title: unknown;
}): Promise<EmployeeTodo> {
  const { rows } = await query<EmployeeTodo>(
    `INSERT INTO employee_todos (employee_id, todo_date, title)
     VALUES ($1::uuid, COALESCE($2::date, CURRENT_DATE), $3)
     RETURNING id, employee_id, todo_date::text AS todo_date, title, is_completed,
               created_at, updated_at, completed_at`,
    [input.employee_id, input.todo_date ? assertDate(input.todo_date) : null, assertTitle(input.title)]
  );
  return rows[0];
}

/**
 * Update an OWN todo. Ownership is enforced in the WHERE clause — a mismatched
 * employee_id updates nothing and returns null (caller maps to 404/403).
 */
export async function updateTodo(
  id: string,
  employeeId: string,
  patch: { title?: unknown; is_completed?: unknown }
): Promise<EmployeeTodo | null> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [id, employeeId];
  if (patch.title !== undefined) {
    params.push(assertTitle(patch.title));
    sets.push(`title = $${params.length}`);
  }
  if (patch.is_completed !== undefined) {
    params.push(Boolean(patch.is_completed));
    sets.push(`is_completed = $${params.length}`);
    // Stamp/clear the completion timestamp alongside the flag.
    sets.push(`completed_at = CASE WHEN $${params.length}::boolean THEN now() ELSE NULL END`);
  }
  const { rows } = await query<EmployeeTodo>(
    `UPDATE employee_todos SET ${sets.join(', ')}
      WHERE id = $1::uuid AND employee_id = $2::uuid
      RETURNING id, employee_id, todo_date::text AS todo_date, title, is_completed,
                created_at, updated_at, completed_at`,
    params
  );
  return rows[0] ?? null;
}

/** Soft-delete an OWN todo; ownership enforced in the WHERE clause. */
export async function deleteTodo(id: string, employeeId: string): Promise<boolean> {
  const { rows } = await query(
    `UPDATE employee_todos SET deleted_at = now()
      WHERE id = $1::uuid AND employee_id = $2::uuid AND deleted_at IS NULL
      RETURNING id`,
    [id, employeeId]
  );
  return rows.length > 0;
}
