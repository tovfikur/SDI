/**
 * Minimal PostgreSQL access layer (Spec Phase 5: single relational DB, versioned
 * forward-only migrations). A thin typed wrapper around `pg` so domain packages
 * share one connection/transaction idiom without coupling to the HTTP layer.
 *
 * - `getDb()` returns a lazily-created singleton `Pool`.
 * - `withTransaction(fn)` runs `fn` inside a single ACID transaction, exposing a
 *   `Client` for raw queries; any throw rolls back.
 */

import { Pool } from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { types } from 'pg';

export interface DbConfig {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database not initialised — call initDb() before use');
  }
  return pool;
}

export function initDb(config: DbConfig): Pool {
  pool = new Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 10_000,
  });
pool.on('error', (err) => {
    console.error('[db] idle client error', err.message);
});
types.setTypeParser(1082, (value: string) => value);
  return pool;
}

export function closeDb(): Promise<void> {
  if (!pool) {
    return Promise.resolve();
  }
  const p = pool;
  pool = null;
  return p.end();
}

export type Queryable = Pool | PoolClient;

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  q: Queryable = getPool()
): Promise<QueryResult<T>> {
  return q.query<T>(sql, params);
}

/**
 * Runs `work(client)` inside a transaction. Returns the value `work` returns;
 * rolls back (and rethrows) on any error.
 */
export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const poolClient = await getPool().connect();
  try {
    await poolClient.query('BEGIN');
    const result = await work(poolClient);
    await poolClient.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await poolClient.query('ROLLBACK');
    } catch {
      // rollback failure means the connection is broken; swallow it
    }
    throw error;
  } finally {
    poolClient.release();
  }
}
