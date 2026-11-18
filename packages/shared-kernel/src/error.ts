/**
 * API error contract (Spec Phase 6).
 *
 * Error format (Phase 6): `{ "error": { "code": "...", "message": "...", "fields": { "field": "message" } }, "requestId": "..." }`
 * Supports both the consolidated alert and inline field errors observed in the Employee wizard (FR-032).
 */

export const ERROR_CODES = {
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTEGRATION: 'INTEGRATION_ERROR',
  INTERNAL: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
  requestId: string;
}

/**
 * Builds a fully-formed API error response with the Phase 6 shape.
 * `fields` maps field names to human messages for inline field errors (FR-032).
 */
export function toApiError(
  code: ErrorCode,
  message: string,
  requestId: string,
  fields?: Record<string, string>
): ApiErrorResponse {
  const error: ApiErrorBody = fields ? { code, message, fields } : { code, message };
  return { error, requestId };
}
