/**
 * Application Settings domain (Spec 6.1)
 */

import { query } from '@jsk/shared-kernel';

export async function getSettings() {
  const { rows } = await query('SELECT * FROM app_settings ORDER BY created_at LIMIT 1');
  return rows[0] ?? null;
}

export async function updateSettings(data: {
  company_title?: string;
  support_email?: string;
  support_phone?: string;
  timezone?: string;
  address?: string;
  footer_text?: string;
  currency?: string;
  country?: string;
  default_checkin_range?: number;
  header_logo_url?: string;
  sidebar_logo_url?: string;
  collapsed_logo_url?: string;
  login_bg_url?: string;
  favicon_url?: string;
}) {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      sets.push(`${key} = $${idx++}`);
      params.push(value);
    }
  }
  if (sets.length === 0) return getSettings();
  sets.push('updated_at = now()');
  const { rows } = await query(`UPDATE app_settings SET ${sets.join(', ')} WHERE id = (SELECT id FROM app_settings ORDER BY created_at LIMIT 1) RETURNING *`, params);
  return rows[0] ?? getSettings();
}
