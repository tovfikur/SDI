import { describe, expect, it } from 'vitest';
import {
  WORK_LOG_STATUSES,
  WORK_LOG_EMPLOYEE_EDITABLE,
  WORK_LOG_APPROVAL_ELIGIBLE,
  canEmployeeEditLog,
  canEmployeeDeleteLog,
  canManagerActOnLog,
  applyWorkLogTransition,
} from './service';

describe('work log status constants', () => {
  it('defines the four workflow states in order', () => {
    expect(WORK_LOG_STATUSES).toEqual(['draft', 'submitted', 'approved', 'rejected']);
  });

  it('employees can edit/delete only draft and rejected', () => {
    expect(WORK_LOG_EMPLOYEE_EDITABLE).toEqual(['draft', 'rejected']);
  });

  it('managers can act on draft and submitted', () => {
    expect(WORK_LOG_APPROVAL_ELIGIBLE).toEqual(['draft', 'submitted']);
  });
});

describe('work log scope helpers', () => {
  it('canEmployeeEditLog accepts draft/rejected only', () => {
    expect(canEmployeeEditLog('draft')).toBe(true);
    expect(canEmployeeEditLog('rejected')).toBe(true);
    expect(canEmployeeEditLog('submitted')).toBe(false);
    expect(canEmployeeEditLog('approved')).toBe(false);
    expect(canEmployeeEditLog(null)).toBe(false);
    expect(canEmployeeEditLog(undefined)).toBe(false);
  });

  it('canEmployeeDeleteLog matches the editable set', () => {
    expect(canEmployeeDeleteLog('draft')).toBe(true);
    expect(canEmployeeDeleteLog('rejected')).toBe(true);
    expect(canEmployeeDeleteLog('submitted')).toBe(false);
    expect(canEmployeeDeleteLog('approved')).toBe(false);
  });

  it('canManagerActOnLog accepts draft/submitted only', () => {
    expect(canManagerActOnLog('draft')).toBe(true);
    expect(canManagerActOnLog('submitted')).toBe(true);
    expect(canManagerActOnLog('approved')).toBe(false);
    expect(canManagerActOnLog('rejected')).toBe(false);
    expect(canManagerActOnLog('')).toBe(false);
  });
});

describe('applyWorkLogTransition (Draft → Submitted → Approved / Rejected)', () => {
  it('submit works from draft and rejected only', () => {
    expect(applyWorkLogTransition('draft', 'submit')).toBe('submitted');
    expect(applyWorkLogTransition('rejected', 'submit')).toBe('submitted');
    expect(applyWorkLogTransition('submitted', 'submit')).toBeNull();
    expect(applyWorkLogTransition('approved', 'submit')).toBeNull();
  });

  it('approve works from draft and submitted only', () => {
    expect(applyWorkLogTransition('draft', 'approve')).toBe('approved');
    expect(applyWorkLogTransition('submitted', 'approve')).toBe('approved');
    expect(applyWorkLogTransition('rejected', 'approve')).toBeNull();
    expect(applyWorkLogTransition('approved', 'approve')).toBeNull();
  });

  it('reject works from draft and submitted only', () => {
    expect(applyWorkLogTransition('draft', 'reject')).toBe('rejected');
    expect(applyWorkLogTransition('submitted', 'reject')).toBe('rejected');
    expect(applyWorkLogTransition('approved', 'reject')).toBeNull();
    expect(applyWorkLogTransition('rejected', 'reject')).toBeNull();
  });

  it('approved logs are terminal; rejected logs can resubmit', () => {
    const resubmitted = applyWorkLogTransition(applyWorkLogTransition('submitted', 'reject'), 'submit');
    expect(resubmitted).toBe('submitted');
    expect(applyWorkLogTransition('approved', 'approve')).toBeNull();
  });

  it('handles missing status gracefully', () => {
    expect(applyWorkLogTransition(null, 'submit')).toBeNull();
    expect(applyWorkLogTransition(undefined, 'approve')).toBeNull();
    expect(applyWorkLogTransition('', 'reject')).toBeNull();
  });
});