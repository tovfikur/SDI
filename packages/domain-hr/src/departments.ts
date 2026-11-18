import { query } from '@jsk/shared-kernel';

export interface Department {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface SubDepartment {
  id: string;
  departmentId: string;
  name: string;
  isActive: boolean;
}

interface DeptRow {
  id: string;
  name: string;
  is_active: boolean;
  created_at: Date;
}

interface SubDeptRow {
  id: string;
  department_id: string;
  name: string;
  is_active: boolean;
}

export async function getDepartments(): Promise<Department[]> {
  const res = await query<DeptRow>(
    'SELECT id, name, is_active, created_at FROM departments WHERE deleted_at IS NULL ORDER BY name ASC'
  );

  return res.rows.map((r: DeptRow) => ({
    id: r.id,
    name: r.name,
    isActive: r.is_active,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function createDepartment(name: string): Promise<Department> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Department name is required');
  }

  const existing = await query(
    'SELECT id FROM departments WHERE lower(name) = lower($1) AND deleted_at IS NULL',
    [trimmed]
  );
  if (existing.rows.length > 0) {
    throw new Error(`Department with name "${trimmed}" already exists`);
  }

  const res = await query<DeptRow>(
    'INSERT INTO departments (name) VALUES ($1) RETURNING id, name, is_active, created_at',
    [trimmed]
  );

  const r = res.rows[0];
  return {
    id: r.id,
    name: r.name,
    isActive: r.is_active,
    createdAt: r.created_at.toISOString(),
  };
}

export async function getSubDepartments(departmentId?: string): Promise<SubDepartment[]> {
  let sql = 'SELECT id, department_id, name, is_active FROM sub_departments WHERE deleted_at IS NULL';
  const params: unknown[] = [];

  if (departmentId) {
    sql += ' AND department_id = $1';
    params.push(departmentId);
  }
  sql += ' ORDER BY name ASC';

  const res = await query<SubDeptRow>(sql, params);
  return res.rows.map((r: SubDeptRow) => ({
    id: r.id,
    departmentId: r.department_id,
    name: r.name,
    isActive: r.is_active,
  }));
}
