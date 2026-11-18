/**
 * Generic, allow-listed repository layer (Spec Phase 6 filter/sort/pagination
 * contract; closes HC-04 by sharing one query builder between list + export).
 *
 * All filter/sort columns must be declared in the per-module `ColumnMap`; any
 * other key is rejected. Values are always parameterized and cast to the column
 * type — never string-interpolated into SQL (SEC-002).
 */

import { query, withTransaction } from './db/client';
import type { Queryable } from './db/client';
import { parsePagination, totalPages, DEFAULT_PER_PAGE } from './pagination';
import type { PaginationParams, PaginatedResponse } from './pagination';
import type { FilterParam, SortParam } from './filters';

export type ColumnType = 'text' | 'int' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'uuid' | 'timestamptz' | 'numeric';

export interface ColumnSpec {
  /** Declared type used for parameter casts. */
  type: ColumnType;
  /** Qualified SQL reference, e.g. `e.full_name`. */
  sql: string;
}

export type ColumnMap = Record<string, ColumnSpec>;

export interface ListOptions {
  table: string;
  /** Allow-list of filterable/sortable columns. */
  columns: ColumnMap;
  filters?: FilterParam[] | undefined;
  /** Plain-text search term (ILIKE against `searchableColumns`). */
  search?: string | undefined;
  searchableColumns?: string[] | undefined;
  sort?: SortParam | null | undefined;
  defaultSort?: SortParam | undefined;
  /** Extra SQL JOIN clauses. */
  joins?: string | undefined;
  /** SELECT list (defaults to `table`.*). */
  select?: string | undefined;
  /** Extra WHERE conditions appended as `AND (...)` using $n placeholders. */
  extraWhere?: string | undefined;
  extraParams?: unknown[] | undefined;
  /** When true, appends `deleted_at IS NULL`. */
  activeOnly?: boolean | undefined;
  /** Override pagination (used by export endpoints to stream everything). */
  pagination?: PaginationParams | null | undefined;
  queryable?: Queryable | undefined;
}

const CASTS: Record<ColumnType, string> = {
  text: 'text',
  int: 'integer',
  decimal: 'numeric',
  boolean: 'boolean',
  date: 'date',
  datetime: 'timestamptz',
  uuid: 'uuid',
  timestamptz: 'timestamptz',
  numeric: 'numeric',
};

function buildWhere(opts: ListOptions): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const { columns } = opts;
  // Alias of the primary table (e.g. `employees e` -> `e`) so activeOnly and
  // extra filters never collide with join tables that share column names.
  const alias = opts.table.trim().split(/\s+/).pop() ?? opts.table;

  if (opts.activeOnly) {
    clauses.push(`${alias}.deleted_at IS NULL`);
  }

  for (const filter of opts.filters ?? []) {
    const spec = columns[filter.field];
    if (!spec) {
      continue; // unknown filter is ignored, never SQL-injected
    }
    const cast = CASTS[spec.type];
    const ph = `$${params.length + 1}`;
    if (filter.operator === 'in') {
      const values = filter.value.split(',').map((v) => v.trim()).filter(Boolean);
      if (values.length > 0) {
        clauses.push(`${spec.sql} = ANY(${ph}::${cast}[])`);
        params.push(values);
      }
    } else if (filter.operator === 'like') {
      clauses.push(`${spec.sql}::text ILIKE '%' || ${ph} || '%'`);
      params.push(filter.value);
    } else if (filter.operator === 'gte') {
      clauses.push(`${spec.sql} >= ${ph}::${cast}`);
      params.push(filter.value);
    } else if (filter.operator === 'lte') {
      clauses.push(`${spec.sql} <= ${ph}::${cast}`);
      params.push(filter.value);
    } else if (filter.operator === 'eq' && filter.value.includes('..')) {
      // Range shorthand `lo..hi` -> BETWEEN lo AND hi (used for date/month ranges).
      const [lo, hi] = filter.value.split('..', 2).map((v) => v.trim());
      if (lo && hi) {
        clauses.push(`${spec.sql} BETWEEN $${params.length + 1}::${cast} AND $${params.length + 2}::${cast}`);
        params.push(lo, hi);
      }
    } else {
      clauses.push(`${spec.sql} = ${ph}::${cast}`);
      params.push(filter.value);
    }
  }

  if (opts.search && opts.searchableColumns && opts.searchableColumns.length > 0) {
    const searchClauses = opts.searchableColumns
      .map((field) => {
        const spec = columns[field];
        if (!spec) {
          return null;
        }
        const ph = `$${params.length + 1}`;
        params.push(opts.search ?? '');
        return `${spec.sql}::text ILIKE '%' || ${ph} || '%'`;
      })
      .filter((c): c is string => c !== null);
    if (searchClauses.length > 0) {
      clauses.push(`(${searchClauses.join(' OR ')})`);
    }
  }

  if (opts.extraWhere) {
    const base = params.length;
    clauses.push(
      `(${opts.extraWhere.replace(/\$(\d+)/g, (_, n: string) => `$${base + Number(n)}`)})`
    );
    params.push(...(opts.extraParams ?? []));
  }

  return { sql: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

function buildSort(opts: ListOptions): string {
  const sort = opts.sort ?? opts.defaultSort ?? null;
  if (!sort) {
    return '';
  }
  const spec = opts.columns[sort.field];
  if (!spec) {
    return '';
  }
  return ` ORDER BY ${spec.sql} ${sort.direction.toUpperCase()}`;
}

export async function list<T extends object = Record<string, unknown>>(
  opts: ListOptions
): Promise<PaginatedResponse<T>> {
  const pagination = opts.pagination ?? parsePagination(undefined, undefined);
  const { sql: whereSql, params } = buildWhere(opts);
  const orderSql = buildSort(opts);
  const alias = opts.table.trim().split(/\s+/).pop() ?? opts.table;
  const select = opts.select ?? `${alias}.*`;

  const countQuery = `SELECT count(*)::int AS total FROM ${opts.table} ${opts.joins ?? ''} ${whereSql}`;
  const { rows: countRows } = await query<{ total: number }>(countQuery, params, opts.queryable);
  const total = countRows[0]?.total ?? 0;

  if (pagination === null) {
    const dataSql = `SELECT ${select} FROM ${opts.table} ${opts.joins ?? ''} ${whereSql} ${orderSql}`;
    const { rows } = await query<T>(dataSql, params, opts.queryable);
    return { items: rows, page: 1, per_page: DEFAULT_PER_PAGE, total, total_pages: totalPages(total, DEFAULT_PER_PAGE) };
  }

  const offset = (pagination.page - 1) * pagination.per_page;
  const dataSql = `SELECT ${select} FROM ${opts.table} ${opts.joins ?? ''} ${whereSql} ${orderSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const { rows } = await query<T>(dataSql, [...params, pagination.per_page, offset], opts.queryable);

  return {
    items: rows,
    page: pagination.page,
    per_page: pagination.per_page,
    total,
    total_pages: totalPages(total, pagination.per_page),
  };
}

export async function getById<T extends object>(
  table: string,
  id: string,
  select = '*',
  queryable?: Queryable
): Promise<T | null> {
  const { rows } = await query<T>(`SELECT ${select} FROM ${table} WHERE id = $1::uuid`, [id], queryable);
  return rows[0] ?? null;
}

export async function insertRow<T extends object>(
  table: string,
  data: Record<string, unknown>,
  queryable?: Queryable
): Promise<T> {
  const keys = Object.keys(data);
  const params = keys.map((k) => data[k]);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await query<T>(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    params,
    queryable
  );
  return rows[0];
}

export interface UpdateOptions {
  /** Enables optimistic concurrency: WHERE version = $n and increments it. */
  versioned?: boolean;
  queryable?: Queryable;
}

export async function updateRow<T extends object>(
  table: string,
  id: string,
  data: Record<string, unknown>,
  opts: UpdateOptions = {}
): Promise<T | null> {
  const setKeys = Object.keys(data).filter((k) => k !== 'version');
  const setClause = setKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const params: unknown[] = setKeys.map((k) => data[k]);
  params.push(id);
  let where = `id = $${params.length}::uuid`;
  if (opts.versioned) {
    where += ` AND version = $${params.length + 1}`;
    params.push(data['version'] ?? 1);
  }
  const setTail = opts.versioned ? `, version = version + 1` : '';
  const { rows } = await query<T>(
    `UPDATE ${table} SET ${setClause}${setTail}, updated_at = now() WHERE ${where} RETURNING *`,
    params,
    opts.queryable
  );
  return rows[0] ?? null;
}

/** Soft delete: sets deleted_at (and status='deleted' for the employees table). */
export async function softDeleteRow(
  table: string,
  id: string,
  extraSet: Record<string, unknown> = {}
): Promise<boolean> {
  const setKeys = Object.keys(extraSet);
  const extraClause = setKeys.length > 0 ? `, ${setKeys.map((k, i) => `${k} = $${i + 2}`).join(', ')}` : '';
  const params: unknown[] = [id, ...setKeys.map((k) => extraSet[k])];
  const { rowCount } = await query(
    `UPDATE ${table} SET deleted_at = now()${extraClause} WHERE id = $1::uuid AND deleted_at IS NULL`,
    params
  );
  return (rowCount ?? 0) > 0;
}

export async function hardDelete(table: string, id: string, queryable?: Queryable): Promise<boolean> {
  const { rowCount } = await query(`DELETE FROM ${table} WHERE id = $1::uuid`, [id], queryable);
  return (rowCount ?? 0) > 0;
}

export { withTransaction };
