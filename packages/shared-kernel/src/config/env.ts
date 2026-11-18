/**
 * Environment configuration schema + fail-fast parser (Spec Phase 20; FOUND-006).
 *
 * Both api and worker validate `process.env` at boot against this schema and exit with a
 * clear message on the first missing/invalid variable. Env vars are the single source of
 * configuration (Phase 19: config via env vars + secrets manager).
 *
 * Security: values are never logged; only variable names and expected formats appear in
 * the failure message.
 */

import { z } from 'zod';

const ENV_BOOLEAN = z.preprocess((value) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
}, z.boolean());

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z
      .string()
      .min(1, 'required — expected postgres:// or postgresql:// URL')
      .refine(
        (value) => /^postgres(ql)?:\/\//.test(value),
        'must start with postgres:// or postgresql://'
      ),

    REDIS_URL: z
      .string()
      .min(1, 'required — expected redis:// or rediss:// URL')
      .refine((value) => /^redis(s)?:\/\//.test(value), 'must start with redis:// or rediss://'),

    SESSION_SECRET: z
      .string()
      .min(32, 'required — at least 32 characters')
      .refine((value) => !value.startsWith('change-me'), 'must not use the placeholder value'),

    COOKIE_SECURE: ENV_BOOLEAN.default(false),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    S3_ENDPOINT: z.string().url('must be a valid URL'),
    S3_ACCESS_KEY: z.string().min(1, 'required'),
    S3_SECRET_KEY: z.string().min(1, 'required'),
    S3_BUCKET: z.string().min(1, 'required'),
    S3_FORCE_PATH_STYLE: ENV_BOOLEAN.default(true),

    SMTP_HOST: z.string().min(1, 'required'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().default(''),
    SMTP_PASS: z.string().default(''),
    SMTP_FROM: z.string().email('must be a valid email address'),
    EMAIL_SSL: ENV_BOOLEAN.default(false),

    PUBLIC_WEB_ORIGIN: z.string().url('must be a valid URL'),

    FEATURE_FLAG_DOCS: ENV_BOOLEAN.default(false),
    FEATURE_FLAG_RECURRENCE: ENV_BOOLEAN.default(false),
    FEATURE_FLAG_INTERNAL_CHAT: ENV_BOOLEAN.default(false),
  })
  .passthrough();

export type EnvConfig = z.infer<typeof EnvSchema>;

/**
 * Validates process env and returns the typed config. Throws a single clear message listing
 * every offending variable (name + expected format only — never values). Fails fast so the
 * process refuses to boot with a wrong configuration.
 */
export function parseEnv(env: Record<string, string | undefined>): EnvConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration — fix these variables and restart:\n${details}`
    );
  }
  return result.data;
}
