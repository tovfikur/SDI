import { query } from '@jsk/shared-kernel';

export interface RecordActivityLogPayload {
  actorUserId?: string;
  logName: string;
  description: string;
  entityType?: string;
  entityId?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  requestId?: string;
}

export interface ListAuditLogFilter {
  actorUserId?: string;
  logName?: string;
  search?: string;
  page?: number;
  perPage?: number;
}

export async function recordActivityLog(payload: RecordActivityLogPayload): Promise<string> {
  const { actorUserId, logName, description, entityType, entityId, beforeValue, afterValue, requestId } = payload;

  const res = await query<{ id: string }>(
    `INSERT INTO activity_logs (
       actor_user_id, log_name, description, entity_type, entity_id, before_value, after_value, request_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      actorUserId || null,
      logName,
      description,
      entityType || null,
      entityId || null,
      beforeValue ? JSON.stringify(beforeValue) : null,
      afterValue ? JSON.stringify(afterValue) : null,
      requestId || null,
    ]
  );

  return res.rows[0].id;
}

export async function listActivityLogs(filters: ListAuditLogFilter = {}) {
  const page = Math.max(1, filters.page || 1);
  const perPage = Math.min(100, Math.max(10, filters.perPage || 10));
  const offset = (page - 1) * perPage;

  let whereSql = ' WHERE a.is_hidden = false';
  const params: unknown[] = [];

  if (filters.actorUserId) {
    params.push(filters.actorUserId);
    whereSql += ` AND a.actor_user_id = $${params.length}`;
  }

  if (filters.search) {
    params.push(`%${filters.search}%`);
    whereSql += ` AND (a.log_name ILIKE $${params.length} OR a.description ILIKE $${params.length})`;
  }

  const countRes = await query<{ count: string }>(`SELECT count(*)::text as count FROM activity_logs a ${whereSql}`, params);
  const total = parseInt(countRes.rows[0].count, 10);

  const sql = `
    SELECT
      a.id, a.log_name, a.description, a.entity_type, a.entity_id, a.created_at,
      u.full_name as actor_name, u.username as actor_username
    FROM activity_logs a
    LEFT JOIN users u ON a.actor_user_id = u.id
    ${whereSql}
    ORDER BY a.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const res = await query<{
    id: string;
    log_name: string;
    description: string;
    entity_type: string | null;
    entity_id: string | null;
    created_at: Date;
    actor_name: string | null;
    actor_username: string | null;
  }>(sql, [...params, perPage, offset]);

  return {
    data: res.rows.map((r) => ({
      id: r.id,
      logName: r.log_name,
      description: r.description,
      entityType: r.entity_type,
      entityId: r.entity_id,
      createdAt: r.created_at.toISOString(),
      doneBy: r.actor_name || r.actor_username || 'System',
    })),
    meta: {
      page,
      perPage,
      total,
      totalPages: Math.ceil(total / perPage),
    },
  };
}

/**
 * Super Admin soft-delete retention (C-01 resolution / ADR-004)
 */
export async function softDeleteActivityLogs(logIds: string[], actorUserId: string): Promise<void> {
  if (logIds.length === 0) return;

  await query('UPDATE activity_logs SET is_hidden = true WHERE id = ANY($1)', [logIds]);

  // Record secondary meta audit entry
  await query(
    'INSERT INTO meta_audit_logs (actor_user_id, action, detail) VALUES ($1, $2, $3)',
    [actorUserId, 'LOG_SOFT_DELETE', JSON.stringify({ count: logIds.length, logIds })]
  );
}
