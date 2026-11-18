import { describe, expect, it } from 'vitest';
import { parseEnv } from './config/env';

const validEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://jsk:jsk@localhost:5432/jsk',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'a'.repeat(40),
  COOKIE_SECURE: 'false',
  COOKIE_SAME_SITE: 'lax',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  S3_BUCKET: 'jsk-files',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_USER: '',
  SMTP_PASS: '',
  SMTP_FROM: 'test@example.com',
  EMAIL_SSL: 'false',
  PUBLIC_WEB_ORIGIN: 'http://localhost:5173',
};

describe('parseEnv (FOUND-006 fail-fast)', () => {
  it('returns the typed config for a valid environment', () => {
    const env = parseEnv({ ...validEnv });
    expect(env.NODE_ENV).toBe('development');
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it('ignores unrelated process vars (passthrough)', () => {
    const env = parseEnv({ ...validEnv, PATH: '/usr/bin', FOO_BAR: '1' });
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
  });

  it('applies defaults for optional vars', () => {
    const env = parseEnv({ ...validEnv });
    expect(env.NODE_ENV).toBe('development');
    expect(env.COOKIE_SAME_SITE).toBe('lax');
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.EMAIL_SSL).toBe(false);
    expect(env.FEATURE_FLAG_DOCS).toBe(false);
  });

  it('throws listing every missing variable (names only)', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({})).toThrow(/SESSION_SECRET/);
    expect(() => parseEnv({})).toThrow(/PUBLIC_WEB_ORIGIN/);
  });

  it('rejects invalid values with a clear message', () => {
    expect(() => parseEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: 'not-a-url' })).toThrow(/postgres/);
    expect(() => parseEnv({ ...validEnv, REDIS_URL: 'mongodb://x' })).toThrow(/redis/);
    expect(() => parseEnv({ ...validEnv, SESSION_SECRET: 'short' })).toThrow(/32 characters/);
    expect(() => parseEnv({ ...validEnv, SESSION_SECRET: 'change-me-something-long' })).toThrow(/placeholder/);
    expect(() => parseEnv({ ...validEnv, COOKIE_SECURE: 'banana' })).toThrow(/COOKIE_SECURE/);
    expect(() => parseEnv({ ...validEnv, SMTP_PORT: 'abc' })).toThrow(/SMTP_PORT/);
    expect(() => parseEnv({ ...validEnv, SMTP_FROM: 'not-an-email' })).toThrow(/SMTP_FROM/);
    expect(() => parseEnv({ ...validEnv, PUBLIC_WEB_ORIGIN: 'nope' })).toThrow(/PUBLIC_WEB_ORIGIN/);
  });

  it('coerces boolean env vars strictly (true/false only)', () => {
    expect(parseEnv({ ...validEnv, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
    expect(parseEnv({ ...validEnv, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
    expect(parseEnv({ ...validEnv, FEATURE_FLAG_INTERNAL_CHAT: 'true' }).FEATURE_FLAG_INTERNAL_CHAT).toBe(true);
    expect(parseEnv({ ...validEnv, FEATURE_FLAG_RECURRENCE: 'false' }).FEATURE_FLAG_RECURRENCE).toBe(false);
  });
});