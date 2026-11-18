import { query, withTransaction } from '@jsk/shared-kernel';
import type { PoolClient } from 'pg';

export interface CreateClientPayload {
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface CreateProjectPayload {
  name: string;
  clientId?: string;
  inlineClientName?: string;
  projectLeadId?: string;
  summary?: string;
  startDate?: string;
  durationDays?: number;
  endingDate?: string;
  memberIds?: string[];
  userId: string;
}

export async function createClient(payload: CreateClientPayload): Promise<string> {
  const name = payload.name.trim();
  if (!name) {
    throw new Error('Client name is required');
  }

  const existing = await query('SELECT id FROM clients WHERE lower(name) = lower($1) AND deleted_at IS NULL', [name]);
  if (existing.rows.length > 0) {
    throw new Error(`Client "${name}" already exists`);
  }

  const res = await query<{ id: string }>(
    `INSERT INTO clients (name, contact_person, email, phone, address)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [name, payload.contactPerson || null, payload.email || null, payload.phone || null, payload.address || null]
  );

  return res.rows[0].id;
}

export async function createProject(payload: CreateProjectPayload): Promise<string> {
  const { name, inlineClientName, projectLeadId, summary, startDate, durationDays, endingDate, memberIds, userId } = payload;

  if (!name || !name.trim()) {
    throw new Error('Project name is required');
  }

  return withTransaction(async (client: PoolClient) => {
    let clientId = payload.clientId;

    // Inline client creation (WF-009)
    if (!clientId && inlineClientName && inlineClientName.trim()) {
      const cName = inlineClientName.trim();
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM clients WHERE lower(name) = lower($1) AND deleted_at IS NULL',
        [cName]
      );

      if (existing.rows.length > 0) {
        clientId = existing.rows[0].id;
      } else {
        const newClient = await client.query<{ id: string }>(
          'INSERT INTO clients (name) VALUES ($1) RETURNING id',
          [cName]
        );
        clientId = newClient.rows[0].id;
      }
    }

    if (!clientId) {
      throw new Error('Client is required for project creation');
    }

    let calculatedEndingDate = endingDate || null;
    const days = durationDays || 0;

    if (startDate && days > 0 && !calculatedEndingDate) {
      const start = new Date(startDate);
      const end = new Date(start.getTime() + days * 86_400_000);
      calculatedEndingDate = end.toISOString().slice(0, 10);
    }

    const projRes = await client.query<{ id: string }>(
      `INSERT INTO projects (
         name, client_id, project_lead_id, summary, start_date, duration_days, ending_date, status, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8) RETURNING id`,
      [name.trim(), clientId, projectLeadId || null, summary || '', startDate || null, days, calculatedEndingDate, userId]
    );

    const projectId = projRes.rows[0].id;

    if (memberIds && memberIds.length > 0) {
      for (const memberId of memberIds) {
        await client.query(
          `INSERT INTO project_members (project_id, employee_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
          [projectId, memberId]
        );
      }
    }

    return projectId;
  });
}
