/**
 * Audit domain (Spec Phase 24, ADR-004): structured activity logging plus the
 * meta-audit trail (who recorded what action against which log row).
 */

import { query, list } from '@jsk/shared-kernel';
import type { PaginatedResponse } from '@jsk/shared-kernel';
import type { FilterParam, SortParam } from '@jsk/shared-kernel';

export interface ActivityInput {
  actor_user_id?: string | null;
  log_name: string;
  description?: string;
  entity_type?: string;
  entity_id?: string | null;
  before_value?: unknown;
  after_value?: unknown;
  request_id?: string | null;
}

export async function writeActivity(input: ActivityInput): Promise<{ id: string }> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO activity_logs (actor_user_id, log_name, description, entity_type, entity_id, before_value, after_value, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.actor_user_id ?? null,
      input.log_name,
      input.description ?? '',
      input.entity_type ?? null,
      input.entity_id ?? null,
      input.before_value != null ? JSON.stringify(input.before_value) : null,
      input.after_value != null ? JSON.stringify(input.after_value) : null,
      input.request_id ?? null,
    ]
  );
  return rows[0];
}

/** Meta-audit: records that an actor modified/fixed an existing activity entry. */
export async function writeMetaAudit(input: {
  actor_user_id?: string | null;
  action: string;
  target_log_id: string;
  detail?: unknown;
}): Promise<void> {
  await query(
    `INSERT INTO meta_audit_logs (actor_user_id, action, target_log_id, detail)
     VALUES ($1, $2, $3::uuid, $4)`,
    [input.actor_user_id ?? null, input.action, input.target_log_id, input.detail != null ? JSON.stringify(input.detail) : null]
  );
}

export async function listActivities(input: {
  filters?: FilterParam[];
  search?: string;
  sort?: SortParam | null;
  page?: number;
  per_page?: number;
  dateFrom?: string;
  dateTo?: string;
  all?: boolean;
}): Promise<PaginatedResponse<Record<string, unknown>>> {
  const extra: string[] = [];
  const extraParams: unknown[] = [];
  if (input.dateFrom) {
    extraParams.push(input.dateFrom);
    extra.push(`al.created_at >= $${extraParams.length}`);
  }
  if (input.dateTo) {
    extraParams.push(input.dateTo);
    extra.push(`al.created_at <= $${extraParams.length}`);
  }
  return list({
    table: 'activity_logs al',
    columns: {
      id: { type: 'uuid', sql: 'al.id' },
      log_name: { type: 'text', sql: 'al.log_name' },
      action: { type: 'text', sql: `split_part(al.log_name, '.', 1)` },
      description: { type: 'text', sql: 'al.description' },
      entity_type: { type: 'text', sql: 'al.entity_type' },
      entity_id: { type: 'uuid', sql: 'al.entity_id' },
      actor_user_id: { type: 'uuid', sql: 'al.actor_user_id' },
      created_at: { type: 'datetime', sql: 'al.created_at' },
      actor_name: { type: 'text', sql: 'u.full_name' },
      actor_email: { type: 'text', sql: 'u.email' },
    },
    joins: 'LEFT JOIN users u ON u.id = al.actor_user_id',
    filters: input.filters,
    search: input.search,
    searchableColumns: ['description', 'log_name', 'actor_name'],
    sort: input.sort,
    defaultSort: { field: 'created_at', direction: 'desc' },
    extraWhere: extra.length > 0 ? extra.join(' AND ') : undefined,
    extraParams: extraParams.length > 0 ? extraParams : undefined,
    pagination: input.all ? null : { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
  });
}

export async function deleteActivities(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await query(
    `DELETE FROM activity_logs WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  return rowCount ?? 0;
}

export async function getActivity(id: string): Promise<Record<string, unknown> | null> {
  const { rows } = await query(
    `SELECT al.*, u.full_name AS actor_name, u.email AS actor_email
       FROM activity_logs al LEFT JOIN users u ON u.id = al.actor_user_id
      WHERE al.id = $1::uuid`,
    [id]
  );
  return rows[0] ?? null;
}

export async function listMetaAudits(input: {
  filters?: FilterParam[];
  page?: number;
  per_page?: number;
}): Promise<PaginatedResponse<Record<string, unknown>>> {
  return list({
    table: 'meta_audit_logs ma',
    columns: {
      id: { type: 'uuid', sql: 'ma.id' },
      action: { type: 'text', sql: 'ma.action' },
      actor_user_id: { type: 'uuid', sql: 'ma.actor_user_id' },
      target_log_id: { type: 'uuid', sql: 'ma.target_log_id' },
      created_at: { type: 'datetime', sql: 'ma.created_at' },
    },
    filters: input.filters,
    defaultSort: { field: 'created_at', direction: 'desc' },
    pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
  });
}
