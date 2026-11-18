import { enqueueInAppNotification } from '@jsk/domain-notifications';
import { findUserByEmployeeId } from '@jsk/shared-auth';
import { query } from '@jsk/shared-kernel';

/**
 * Delivery helpers for in-app notifications. Failures are swallowed so a
 * notification problem can never break the underlying business operation.
 */
export async function notifyEmployee(
  employeeId: string | null | undefined,
  input: { event_type: string; title: string; message?: string; action_url?: string }
): Promise<void> {
  try {
    const user = await findUserByEmployeeId(employeeId);
    if (!user) return;
    await enqueueInAppNotification({ recipient_user_id: user.id, ...input });
  } catch {
    /* ignore */
  }
}

export async function notifyUsers(
  userIds: Array<string | null | undefined>,
  input: { event_type: string; title: string; message?: string; action_url?: string }
): Promise<void> {
  await Promise.all(
    userIds
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map((userId) =>
        enqueueInAppNotification({ recipient_user_id: userId, ...input }).catch(() => undefined)
      )
  );
}

export async function notifyAdminsWithPermission(
  permissions: string[],
  input: { event_type: string; title: string; message?: string; action_url?: string }
): Promise<void> {
  try {
    const { rows } = await query<{ user_id: string }>(
      `SELECT DISTINCT ur.user_id
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
        WHERE rp.permission_id = ANY($1::text[])`,
      [permissions]
    );
    await Promise.all(
      rows.map((r) =>
        enqueueInAppNotification({ recipient_user_id: r.user_id, ...input }).catch(() => undefined)
      )
    );
  } catch {
    /* ignore */
  }
}