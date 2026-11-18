/**
 * Forward-only SQL migration runner (Spec Phase 5: versioned, forward-only,
 * "no manual database editing"). Applies `db/migrations/*.sql` in filename order,
 * each inside its own transaction, tracked in `schema_migrations`.
 *
 * Usage: DATABASE_URL=postgres://... node db/migrate.js   (or rely on infra/.env)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadEnv() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, '..', 'infra', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set (set env or create infra/.env)');
  }
  return process.env.DATABASE_URL;
}

async function main() {
  const connectionString = loadEnv();
  const pool = new Pool({ connectionString });
  const migrationsDir = path.join(__dirname, 'migrations');

  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = await pool.query('SELECT id FROM schema_migrations');
  const appliedSet = new Set(applied.rows.map((r) => r.id));

  let count = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`FAILED ${file}:`, err.message);
      process.exitCode = 1;
    } finally {
      client.release();
    }
    count += 1;
  }
  console.log(count === 0 ? 'no pending migrations' : `applied ${count} migration(s)`);
  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
