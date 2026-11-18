import { describe, expect, it } from 'vitest';
import { ERROR_CODES, toApiError } from './error';

describe('toApiError', () => {
  it('builds the Phase 6 error body shape', () => {
    const error = toApiError(ERROR_CODES.VALIDATION, 'Bad payload', 'req-1');
    expect(error).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Bad payload' },
      requestId: 'req-1',
    });
  });

  it('includes field-level errors when provided', () => {
    const error = toApiError(ERROR_CODES.VALIDATION, 'Bad payload', 'req-1', {
      email: 'must be a valid email',
    });
    expect(error.error.fields).toEqual({ email: 'must be a valid email' });
  });

  it('omits the fields key when no field errors are given', () => {
    const error = toApiError(ERROR_CODES.NOT_FOUND, 'missing', 'req-1');
    expect('fields' in error.error).toBe(false);
  });

  it('exposes the stable error code set', () => {
    expect(ERROR_CODES.UNAUTHENTICATED).toBe('UNAUTHENTICATED');
    expect(ERROR_CODES.FORBIDDEN).toBe('FORBIDDEN');
    expect(ERROR_CODES.INTERNAL).toBe('INTERNAL_ERROR');
    expect(ERROR_CODES.VALIDATION).toBe('VALIDATION_ERROR');
  });
});