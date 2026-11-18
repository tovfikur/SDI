import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';

describe('AppModule integration (HTTP)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns the Phase 6 health shape', async () => {
    const res = await request(httpServer).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('api');
    expect(res.body.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('GET /health echoes a valid X-Request-Id header', async () => {
    const res = await request(httpServer)
      .get('/health')
      .set('X-Request-Id', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
      .expect(200);
    expect(res.body.requestId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('GET /health ignores an invalid X-Request-Id header', async () => {
    const res = await request(httpServer)
      .get('/health')
      .set('X-Request-Id', 'nonsense')
      .expect(200);
    expect(res.body.requestId).not.toBe('nonsense');
  });

  it('unknown routes return 404', async () => {
    await request(httpServer).get('/does-not-exist').expect(404);
  });
});