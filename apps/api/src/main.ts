import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { initDb, parseEnv } from '@jsk/shared-kernel';
import type { EnvConfig } from '@jsk/shared-kernel';
import { configureStorage, ensureBucket } from '@jsk/domain-files';
import { configureMail } from '@jsk/domain-notifications';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

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
  try {
    await ensureBucket();
  } catch (error) {
    logger.warn(`MinIO bucket not reachable yet: ${(error as Error).message}`);
  }

  configureMail({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASS || undefined,
    from: env.SMTP_FROM,
    ssl: env.EMAIL_SSL,
  });

  const app = await NestFactory.create(AppModule);

  const configuredOrigins = (env.PUBLIC_WEB_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const isLanOrigin = (origin: string | undefined): boolean => {
    if (!origin) return false;
    try {
      const url = new URL(origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      const parts = url.hostname.split('.').map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
      const [a, b] = parts;
      return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
    } catch {
      return false;
    }
  };

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || configuredOrigins.includes(origin) || isLanOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  });

  const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on http://0.0.0.0:${port} (${env.NODE_ENV})`);
}

void bootstrap();
