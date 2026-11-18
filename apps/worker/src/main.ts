import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { initDb, parseEnv } from '@jsk/shared-kernel';
import type { EnvConfig } from '@jsk/shared-kernel';
import { configureStorage } from '@jsk/domain-files';
import { configureMail } from '@jsk/domain-notifications';
import { runWorkerLoop } from './worker';

/**
 * Worker entrypoint (Spec §26 / Phase 9): DB-backed jobs queue (`jobs` table).
 * The loop claims due jobs, dispatches by type to the domain handlers, and
 * retries failed jobs up to max_attempts before sending them to the DLQ.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('WorkerBootstrap');

  let env: EnvConfig;
  try {
    env = parseEnv(process.env);
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(1);
  }

  initDb({ connectionString: env.DATABASE_URL });

  configureStorage({
    endpoint: new URL(env.S3_ENDPOINT).hostname,
    port: Number(new URL(env.S3_ENDPOINT).port || 9000),
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    bucket: env.S3_BUCKET,
    useSSL: env.S3_ENDPOINT.startsWith('https://'),
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });

  configureMail({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASS || undefined,
    from: env.SMTP_FROM,
    ssl: env.EMAIL_SSL,
  });

  await runWorkerLoop(logger);

  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

void bootstrap();
