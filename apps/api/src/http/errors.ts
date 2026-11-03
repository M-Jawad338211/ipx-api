import type { ApiError, ErrorCode } from '@ipx/shared';

/** An error that maps directly onto the API's error response shape. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function errorBody(code: ErrorCode, message: string): ApiError {
  return { success: false, error: { code, message } };
}
