/**
 * Worker loop (Spec Phase 9 DB-backed queue): claims `jobs` rows with
 * FOR UPDATE SKIP LOCKED, dispatches to domain handlers, records `job_runs`,
 * retries with backoff, and moves exhausted jobs to the DLQ.
 */

import type { Logger } from '@nestjs/common';
import { query } from '@jsk/shared-kernel';
import { recalculateRange } from '@jsk/domain-attendance';
import { generateLeavesForYear } from '@jsk/domain-leave';
import { deliverOne } from '@jsk/domain-notifications';
import { purgeExpiredSessions } from '@jsk/shared-auth';

interface JobRow {
  id: string;
  type: string;
  payload: string | null;
  attempts: number;
  max_attempts: number;
}

interface HandlerContext {
  logger: Logger;
  jobId: string;
}

type JobHandler = (payload: Record<string, unknown>, ctx: HandlerContext) => Promise<unknown>;

const HANDLERS: Record<string, JobHandler> = {
  'attendance.recalculate': async (payload) => {
    const startDate = String(payload['start_date'] ?? new Date(Date.now() - 86400_000).toISOString().slice(0, 10));
    const endDate = String(payload['end_date'] ?? startDate);
    const employeeIds = payload['employee_ids'] as string[] | undefined;
    const count = await recalculateRange(startDate, endDate, employeeIds);
    return { recalculated: count };
  },
  'leave.generate': async (payload) => {
    const year = Number(payload['year'] ?? new Date().getFullYear());
    return generateLeavesForYear(year);
  },
  'notifications.deliver': async (payload) => {
    const max = Math.min(Number(payload['max'] ?? 10), 50);
    let delivered = 0;
    for (let i = 0; i < max; i += 1) {
      const result = await deliverOne();
      if (!result.delivered) break;
      delivered += 1;
    }
    return { delivered };
  },
  'sessions.purge': async () => {
    const removed = await purgeExpiredSessions();
    return { removed };
  },
};

const POLL_MS = 3_000;
const BACKOFF_BASE_MS = 5_000;

async function claimNext(): Promise<JobRow | null> {
  const { rows } = await query<JobRow>(
    `UPDATE jobs
        SET status = 'running', started_at = now(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM jobs
         WHERE status = 'queued' AND available_at <= now() AND attempts < max_attempts
         ORDER BY created_at LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, type, payload, attempts, max_attempts`
  );
  return rows[0] ?? null;
}

async function processJob(row: JobRow, logger: Logger): Promise<void> {
  const handler = HANDLERS[row.type];
  const payload = row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {};
  if (!handler) {
    logger.warn(`no handler for job type "${row.type}" (job ${row.id}) — sending to DLQ`);
    await query(`UPDATE jobs SET status='dlq', last_error='no handler' WHERE id = $1::uuid`, [row.id]);
    await query(`INSERT INTO job_runs (job_id, run_at, status, detail) VALUES ($1::uuid, now(), 'failed', $2)`, [row.id, JSON.stringify({ error: 'no handler' })]);
    return;
  }
  try {
    const detail = await handler(payload, { logger, jobId: row.id });
    await query(`UPDATE jobs SET status='completed', completed_at=now() WHERE id = $1::uuid`, [row.id]);
    await query(`INSERT INTO job_runs (job_id, run_at, status, detail) VALUES ($1::uuid, now(), 'completed', $2)`, [row.id, JSON.stringify(detail ?? null)]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'job failed';
    if (row.attempts >= row.max_attempts) {
      await query(`UPDATE jobs SET status='dlq', last_error=$2 WHERE id = $1::uuid`, [row.id, message]);
      await query(`INSERT INTO job_runs (job_id, run_at, status, detail) VALUES ($1::uuid, now(), 'failed', $2)`, [row.id, JSON.stringify({ error: message })]);
      logger.error(`job ${row.type} (${row.id}) failed permanently: ${message}`);
    } else {
      const backoff = BACKOFF_BASE_MS * 2 ** (row.attempts - 1);
      await query(
        `UPDATE jobs SET status='queued', last_error=$2, available_at = now() + make_interval(secs => $3)
          WHERE id = $1::uuid`,
        [row.id, message, backoff / 1000]
      );
      logger.warn(`job ${row.type} (${row.id}) will retry in ${backoff}ms: ${message}`);
    }
  }
}

async function runScheduledWork(logger: Logger): Promise<void> {
  try {
    await deliverOne();
  } catch (error) {
    logger.debug(`notification delivery skipped: ${(error as Error).message}`);
  }
}

export async function runWorkerLoop(logger: Logger): Promise<void> {
  logger.log('worker loop started (DB-backed jobs, 3s poll)');
  let lastPurge = 0;

  setInterval(() => {
    void (async () => {
      try {
        for (let i = 0; i < 10; i += 1) {
          const job = await claimNext();
          if (!job) break;
          await processJob(job, logger);
        }
        await runScheduledWork(logger);

        const now = Date.now();
        if (now - lastPurge > 60 * 60 * 1000) {
          lastPurge = now;
          const result = await HANDLERS['sessions.purge']({}, { logger, jobId: '' });
          logger.log(`purged expired sessions: ${JSON.stringify(result)}`);
        }
      } catch (error) {
        logger.error(`worker tick failed: ${(error as Error).message}`);
      }
    })();
  }, POLL_MS);
}
