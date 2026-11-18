/**
 * HR master data (Spec FR-010..024, FR-065): departments, sub-departments,
 * employee types, positions, setup rules, holidays — list/filter/export shared
 * query layer (HC-04), CRUD with soft delete and BR-001/AM-01 uniqueness.
 */

import { list, getById, insertRow, updateRow, softDeleteRow, withTransaction } from '@jsk/shared-kernel';
import type { ColumnMap, PaginatedResponse } from '@jsk/shared-kernel';
import type { FilterParam, SortParam } from '@jsk/shared-kernel';

export interface MasterRecord {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ListInput {
  filters?: FilterParam[] | undefined;
  search?: string | undefined;
  sort?: SortParam | null | undefined;
  page?: number | undefined;
  per_page?: number | undefined;
}

export const EMPLOYEE_COLUMNS: ColumnMap = {
  id: { type: 'uuid', sql: 'e.id' },
  employee_code: { type: 'text', sql: 'e.employee_code' },
  full_name: { type: 'text', sql: 'e.full_name' },
  email: { type: 'text', sql: 'e.email' },
  mobile: { type: 'text', sql: 'e.mobile' },
  department_id: { type: 'uuid', sql: 'e.department_id' },
  sub_department_id: { type: 'uuid', sql: 'e.sub_department_id' },
  employee_type_id: { type: 'uuid', sql: 'e.employee_type_id' },
  position_id: { type: 'uuid', sql: 'e.position_id' },
  branch_id: { type: 'uuid', sql: 'e.branch_id' },
  gender: { type: 'text', sql: 'e.gender' },
  blood_group: { type: 'text', sql: 'e.blood_group' },
  contract_type: { type: 'text', sql: 'e.contract_type' },
  marital_status: { type: 'text', sql: 'e.marital_status' },
  status: { type: 'text', sql: 'e.status' },
  department_name: { type: 'text', sql: 'd.name' },
  sub_department_name: { type: 'text', sql: 'sd.name' },
  employee_type_name: { type: 'text', sql: 'et.name' },
  position_name: { type: 'text', sql: 'p.name' },
  branch_name: { type: 'text', sql: 'b.name' },
  joining_letter_url: { type: 'text', sql: 'e.joining_letter_url' },
  appointment_letter_file_id: { type: 'uuid', sql: 'e.appointment_letter_file_id' },
  photo_file_id: { type: 'uuid', sql: 'e.photo_file_id' },
};

export const EMPLOYEE_JOINS = `LEFT JOIN departments d ON d.id = e.department_id
            LEFT JOIN sub_departments sd ON sd.id = e.sub_department_id
            LEFT JOIN employee_types et ON et.id = e.employee_type_id
            LEFT JOIN positions p ON p.id = e.position_id
            LEFT JOIN branches b ON b.id = e.branch_id`;

export const EMPLOYEE_SELECT = `e.*,
            d.name AS department_name,
            sd.name AS sub_department_name,
            et.name AS employee_type_name,
            p.name AS position_name,
            b.name AS branch_name`;

export async function listEmployees(input: ListInput): Promise<PaginatedResponse<Record<string, unknown>>> {
  return list({
    table: 'employees e',
    columns: EMPLOYEE_COLUMNS,
    joins: EMPLOYEE_JOINS,
    select: EMPLOYEE_SELECT,
    filters: input.filters,
    search: input.search,
    searchableColumns: ['full_name', 'employee_code', 'email'],
    sort: input.sort,
    defaultSort: { field: 'full_name', direction: 'asc' },
    activeOnly: true,
    pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
  });
}

export async function exportEmployees(filters?: FilterParam[]): Promise<Record<string, unknown>[]> {
  const result = await list({
    table: 'employees e',
    columns: EMPLOYEE_COLUMNS,
    joins: EMPLOYEE_JOINS,
    select: EMPLOYEE_SELECT,
    filters,
    defaultSort: { field: 'full_name', direction: 'asc' },
    activeOnly: true,
    pagination: null,
  });
  return result.items;
}

// ---------------------------------------------------------------------------
// Generic master CRUD factory
// ---------------------------------------------------------------------------

function masterService(table: string, _label: string, uniqueOn: (client: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }, name: string) => Promise<unknown>) {
  return {
    async list(input: ListInput): Promise<PaginatedResponse<MasterRecord>> {
      return list({
        table,
        columns: {
          id: { type: 'uuid', sql: 'id' },
          name: { type: 'text', sql: 'name' },
          is_active: { type: 'boolean', sql: 'is_active' },
        },
        filters: input.filters,
        search: input.search,
        searchableColumns: ['name'],
        sort: input.sort,
        defaultSort: { field: 'name', direction: 'asc' },
        activeOnly: true,
        pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
      });
    },

    async get(id: string): Promise<MasterRecord | null> {
      return getById<MasterRecord>(table, id);
    },

    async create(data: { name: string; is_active?: boolean }): Promise<MasterRecord> {
      return withTransaction(async (client) => {
        await uniqueOn(client, data.name.trim());
        const result = await insertRow<MasterRecord>(
          table,
          { name: data.name.trim(), is_active: data.is_active ?? true },
          client
        );
        return result;
      });
    },

    async update(id: string, data: { name?: string; is_active?: boolean }): Promise<MasterRecord | null> {
      return updateRow<MasterRecord>(table, id, {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.is_active !== undefined ? { is_active: data.is_active } : {}),
      });
    },

    async remove(id: string): Promise<boolean> {
      return softDeleteRow(table, id);
    },
  };
}

function uniqueInTable(table: string, _field: string) {
  return async (
    client: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> },
    value: string
  ): Promise<void> => {
    const { rows } = await client.query(
      `SELECT id FROM ${table} WHERE lower(name) = lower($1) AND deleted_at IS NULL`,
      [value]
    );
    if (rows.length > 0) {
      throw new Error(`${table}.name.unique`);
    }
  };
}

export const departments = masterService('departments', 'Department', uniqueInTable('departments', 'name'));
export const employeeTypes = masterService('employee_types', 'EmployeeType', uniqueInTable('employee_types', 'name'));
export const positions = masterService('positions', 'Position', uniqueInTable('positions', 'name'));

export const branches = {
  async list(input: ListInput): Promise<PaginatedResponse<Record<string, unknown>>> {
    return list({
      table: 'branches b',
      columns: {
        id: { type: 'uuid', sql: 'b.id' },
        name: { type: 'text', sql: 'b.name' },
        code: { type: 'text', sql: 'b.code' },
        address: { type: 'text', sql: 'b.address' },
        latitude: { type: 'numeric', sql: 'b.latitude' },
        longitude: { type: 'numeric', sql: 'b.longitude' },
        radius_meters: { type: 'numeric', sql: 'b.radius_meters' },
        is_active: { type: 'boolean', sql: 'b.is_active' },
        created_at: { type: 'date', sql: 'b.created_at' },
      },
      filters: input.filters,
      search: input.search,
      searchableColumns: ['b.name', 'b.code', 'b.address'],
      sort: input.sort,
      defaultSort: { field: 'name', direction: 'asc' },
      activeOnly: true,
      pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
    });
  },

  async get(id: string): Promise<Record<string, unknown> | null> {
    return getById<Record<string, unknown>>('branches', id);
  },

  async create(data: {
    name: string;
    code?: string;
    address?: string;
    latitude?: number | null;
    longitude?: number | null;
    radius_meters?: number;
    is_active?: boolean;
  }): Promise<Record<string, unknown>> {
    return withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id FROM branches WHERE lower(name) = lower($1) AND deleted_at IS NULL`,
        [data.name.trim()]
      );
      if (rows.length > 0) {
        throw new Error('branches.name.unique');
      }
      return insertRow<Record<string, unknown>>(
        'branches',
        {
          name: data.name.trim(),
          code: data.code?.trim() || null,
          address: data.address?.trim() || '',
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
          radius_meters: data.radius_meters ?? 100,
          is_active: data.is_active ?? true,
        },
        client
      );
    });
  },

  async update(
    id: string,
    data: {
      name?: string;
      code?: string;
      address?: string;
      latitude?: number | null;
      longitude?: number | null;
      radius_meters?: number;
      is_active?: boolean;
    }
  ): Promise<Record<string, unknown> | null> {
    return updateRow<Record<string, unknown>>('branches', id, {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.code !== undefined ? { code: data.code?.trim() || null } : {}),
      ...(data.address !== undefined ? { address: data.address?.trim() || '' } : {}),
      ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
      ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
      ...(data.radius_meters !== undefined ? { radius_meters: data.radius_meters } : {}),
      ...(data.is_active !== undefined ? { is_active: data.is_active } : {}),
    });
  },

  async remove(id: string): Promise<boolean> {
    return softDeleteRow('branches', id);
  },
};

// Sub-departments have a composite uniqueness (per parent department)
export const subDepartments = {
  ...masterService('sub_departments', 'SubDepartment', async () => {}),
  async list(input: ListInput): Promise<PaginatedResponse<Record<string, unknown>>> {
    return list({
      table: 'sub_departments sd',
      columns: {
        id: { type: 'uuid', sql: 'sd.id' },
        name: { type: 'text', sql: 'sd.name' },
        is_active: { type: 'boolean', sql: 'sd.is_active' },
        department_id: { type: 'uuid', sql: 'sd.department_id' },
      },
      filters: input.filters,
      search: input.search,
      searchableColumns: ['name'],
      sort: input.sort,
      defaultSort: { field: 'name', direction: 'asc' },
      activeOnly: true,
      pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
    });
  },
  async create(data: { name: string; department_id: string; is_active?: boolean }): Promise<MasterRecord> {
    return withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id FROM sub_departments WHERE department_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL`,
        [data.department_id, data.name.trim()]
      );
      if (rows.length > 0) {
        throw new Error('sub_departments.name.unique');
      }
      return insertRow<MasterRecord>(
        'sub_departments',
        { name: data.name.trim(), department_id: data.department_id, is_active: data.is_active ?? true },
        client
      );
    });
  },
};

export const holidays = {
  async list(input: ListInput): Promise<PaginatedResponse<Record<string, unknown>>> {
    return list({
      table: 'holidays h',
      columns: {
        id: { type: 'uuid', sql: 'h.id' },
        title: { type: 'text', sql: 'h.title' },
        holiday_date: { type: 'date', sql: 'h.holiday_date' },
        type: { type: 'text', sql: 'h.type' },
        is_active: { type: 'boolean', sql: 'h.is_active' },
      },
      filters: input.filters,
      search: input.search,
      searchableColumns: ['title'],
      sort: input.sort,
      defaultSort: { field: 'holiday_date', direction: 'desc' },
      activeOnly: true,
      pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
    });
  },

  async get(id: string): Promise<Record<string, unknown> | null> {
    return getById<Record<string, unknown>>('holidays', id);
  },

  async create(data: { title: string; holiday_date: string; type?: string; description?: string; is_active?: boolean }): Promise<Record<string, unknown>> {
    return withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id FROM holidays WHERE holiday_date = $1::date AND deleted_at IS NULL`,
        [data.holiday_date]
      );
      if (rows.length > 0) {
        throw new Error('holidays.date.unique');
      }
      return insertRow<Record<string, unknown>>(
        'holidays',
        {
          title: data.title.trim(),
          holiday_date: data.holiday_date,
          type: data.type ?? 'Public',
          description: data.description ?? '',
          is_active: data.is_active ?? true,
        },
        client
      );
    });
  },

  async update(id: string, data: { title?: string; holiday_date?: string; type?: string; description?: string; is_active?: boolean }): Promise<Record<string, unknown> | null> {
    return updateRow<Record<string, unknown>>('holidays', id, { ...data });
  },

  async remove(id: string): Promise<boolean> {
    return softDeleteRow('holidays', id);
  },
};
