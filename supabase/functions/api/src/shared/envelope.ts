import { ErrorCode } from "./errors.ts";

export interface Meta {
  page: number;
  limit: number;
  total: number;
}

export interface SuccessResponse<T> {
  success: true;
  data: T;
  meta?: Meta;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode | string;
    message: string;
    statusCode: number;
    details: unknown[];
  };
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

export function ok<T>(data: T, meta?: Meta): SuccessResponse<T> {
  if (meta !== undefined) {
    return { success: true, data, meta };
  }
  return { success: true, data };
}

export function fail(
  code: ErrorCode | string,
  message: string,
  statusCode: number,
  details: unknown[] = [],
): ErrorResponse {
  return {
    success: false,
    error: { code, message, statusCode, details },
  };
}
