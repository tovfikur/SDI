import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  it('compiles a Nest DI context without processing anything (FOUND-003 / JOB-001 deferred)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    expect(moduleRef.get(WorkerModule)).toBeDefined();
  });
});