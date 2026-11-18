import { describe, expect, it } from 'vitest';
import { calculateTaskProgress } from './service';

describe('calculateTaskProgress (BR-015 automatic project progress)', () => {
  it('no applicable tasks → 0%, never NaN', () => {
    expect(calculateTaskProgress([]).progress).toBe(0);
    expect(calculateTaskProgress([{ status: 'cancelled', progress_percent: 40, estimated_hours: null }]).progress).toBe(0);
  });

  it('4 tasks with 1 done → 25% (equal weight)', () => {
    const tasks = [
      { status: 'done', progress_percent: 100, estimated_hours: null },
      { status: 'todo', progress_percent: 0, estimated_hours: null },
      { status: 'in_progress', progress_percent: 0, estimated_hours: null },
      { status: 'review', progress_percent: 0, estimated_hours: null },
    ];
    const result = calculateTaskProgress(tasks);
    expect(result.progress).toBe(25);
    expect(result.totalTasks).toBe(4);
    expect(result.completedTasks).toBe(1);
  });

  it('all 4 tasks done → 100%', () => {
    const tasks = Array.from({ length: 4 }, () => ({
      status: 'done', progress_percent: 100, estimated_hours: null,
    }));
    expect(calculateTaskProgress(tasks).progress).toBe(100);
  });

  it('reopening a done task lowers progress (done → todo at 0)', () => {
    const allDone = Array.from({ length: 4 }, () => ({
      status: 'done', progress_percent: 100, estimated_hours: null,
    }));
    const reopened = [
      { status: 'todo', progress_percent: 0, estimated_hours: null },
      ...allDone.slice(1),
    ];
    expect(calculateTaskProgress(allDone).progress).toBe(100);
    expect(calculateTaskProgress(reopened).progress).toBe(75);
  });

  it('cancelled tasks are excluded from the denominator', () => {
    const tasks = [
      { status: 'done', progress_percent: 100, estimated_hours: null },
      { status: 'done', progress_percent: 100, estimated_hours: null },
      { status: 'cancelled', progress_percent: 100, estimated_hours: null },
      { status: 'cancelled', progress_percent: 100, estimated_hours: null },
    ];
    const result = calculateTaskProgress(tasks);
    expect(result.progress).toBe(100);
    expect(result.totalTasks).toBe(2);
  });

  it('partial progress contributes its percentage', () => {
    const tasks = [
      { status: 'done', progress_percent: 100, estimated_hours: null },
      { status: 'in_progress', progress_percent: 50, estimated_hours: null },
    ];
    expect(calculateTaskProgress(tasks).progress).toBe(75);
  });

  it('weights by estimated_hours when present', () => {
    const tasks = [
      { status: 'done', progress_percent: 100, estimated_hours: 10 },
      { status: 'todo', progress_percent: 0, estimated_hours: 20 },
      { status: 'done', progress_percent: 100, estimated_hours: 10 },
    ];
    // earned 20 of 40 weight → 50%
    expect(calculateTaskProgress(tasks).progress).toBe(50);
  });

  it('weighted partial: 4h done + 6h at 50% → 70%', () => {
    const tasks = [
      { status: 'done', progress_percent: 100, estimated_hours: 4 },
      { status: 'in_progress', progress_percent: 50, estimated_hours: 6 },
    ];
    expect(calculateTaskProgress(tasks).progress).toBe(70);
  });

  it('zero/negative hours fall back to equal weight', () => {
    const tasks = [
      { status: 'done', progress_percent: 100, estimated_hours: 0 },
      { status: 'done', progress_percent: 100, estimated_hours: -2 },
      { status: 'todo', progress_percent: 0, estimated_hours: 0 },
    ];
    expect(calculateTaskProgress(tasks).progress).toBeCloseTo(66.67, 1);
  });

  it('done tasks always contribute 100 even if stored progress differs', () => {
    const tasks = [
      { status: 'done', progress_percent: 40, estimated_hours: null },
      { status: 'todo', progress_percent: 0, estimated_hours: null },
    ];
    expect(calculateTaskProgress(tasks).progress).toBe(50);
  });

  it('clamps out-of-range progress', () => {
    const tasks = [
      { status: 'in_progress', progress_percent: 150, estimated_hours: null },
      { status: 'in_progress', progress_percent: -20, estimated_hours: null },
    ];
    expect(calculateTaskProgress(tasks).progress).toBe(50);
  });
});