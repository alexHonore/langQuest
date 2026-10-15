/**
 * Response envelope helpers (CONVENTIONS §3): `{ ok: true, data }` / `{ ok: false, error }` with the HTTP
 * status derived from `API_ERROR_HTTP_STATUS`. Every thrown error is normalised here so provider secrets,
 * raw prompts and Postgres internals never reach a client.
 */
import { API_ERROR_HTTP_STATUS, ApiProblem, err, ok, type ApiErrorCode, type JsonValue } from '@langquest/contracts';
import { DbError } from '@langquest/db/errors';
import type { Context } from 'hono';
import { ZodError } from 'zod';
import type { AppEnv } from '../types';

export { ApiProblem };

/** Shorthand constructors so route code reads naturally. */
export const problem = {
  unauthorized: (message = 'Authentication required') => new ApiProblem('unauthorized', message),
  forbidden: (message = 'You do not have access to this resource') => new ApiProblem('forbidden', message),
  notFound: (what = 'Resource') => new ApiProblem('not_found', `${what} not found`),
  validation: (message: string, details?: JsonValue) => new ApiProblem('validation_failed', message, details),
  conflict: (message: string, details?: JsonValue) => new ApiProblem('conflict', message, details),
  precondition: (message: string, details?: JsonValue) => new ApiProblem('precondition_failed', message, details),
  rights: (message: string, details?: JsonValue) => new ApiProblem('rights_blocked', message, details),
  unsupported: (message: string, details?: JsonValue) => new ApiProblem('capability_unsupported', message, details),
  provider: (message = 'A provider is temporarily unavailable. Please try again in a moment.') => new ApiProblem('provider_unavailable', message),
  tooLarge: (message = 'Request body is too large') => new ApiProblem('payload_too_large', message),
  mediaType: (message = 'Unsupported media type') => new ApiProblem('unsupported_media_type', message),
  rateLimited: (message: string) => new ApiProblem('rate_limited', message),
  internal: (message = 'Something went wrong on our side') => new ApiProblem('internal', message),
};

/** Successful JSON response in the envelope. */
export function respondOk<T>(c: Context<AppEnv>, data: T, status: 200 | 201 | 202 = 200, headers?: Record<string, string>): Response {
  const res = c.json(ok(data), status);
  if (headers) for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

/** Failure JSON response in the envelope. */
export function respondErr(c: Context<AppEnv>, code: ApiErrorCode, message: string, details?: JsonValue): Response {
  const traceId = c.get('requestId');
  return c.json(err(code, message, details, traceId), API_ERROR_HTTP_STATUS[code] as 400);
}

/** Map a Zod error into a compact, client-safe `details` list. */
export function zodIssues(error: ZodError): JsonValue {
  return error.issues.slice(0, 25).map((i) => ({ path: i.path.map(String).join('.'), message: i.message, code: i.code }));
}

/**
 * Normalise any thrown value into an `ApiProblem`. Known shapes: `ApiProblem`, Zod errors (validation),
 * `DbError` (RLS/ownership → forbidden/not_found/conflict), AI capability/provider errors and
 * request timeouts. Everything else is `internal` with the message hidden.
 */
export function toProblem(error: unknown): ApiProblem {
  if (error instanceof ApiProblem) return error;
  if (error instanceof ZodError) return new ApiProblem('validation_failed', 'Request failed validation', zodIssues(error));
  if (error instanceof DbError) {
    if (error.isForbidden) return new ApiProblem('forbidden', 'You do not have access to this resource');
    if (error.isNotFound) return new ApiProblem('not_found', 'Resource not found');
    if (error.isUniqueViolation) return new ApiProblem('conflict', 'A conflicting record already exists');
    if (error.code === '23503') return new ApiProblem('validation_failed', 'A referenced record does not exist or is not yours');
    if (error.code === '22023' || error.code === '23514' || error.code === '22P02') return new ApiProblem('validation_failed', sanitizeDbMessage(error.message));
    if (error.code === 'P0002') return new ApiProblem('not_found', 'Resource not found');
    return new ApiProblem('internal', 'Database request failed');
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'capability_unsupported') return new ApiProblem('capability_unsupported', (error as Error).message);
  if (code === 'provider_unavailable') return new ApiProblem('provider_unavailable', 'A provider is temporarily unavailable. Please try again in a moment.');
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError' || name === 'RequestTimeoutError') return new ApiProblem('provider_unavailable', 'The request took too long and was cancelled. Please retry.');
  if (name === 'StructuredOutputError' || name === 'OpenRouterError') return new ApiProblem('provider_unavailable', 'The AI provider returned an unusable answer. Please retry.');
  return new ApiProblem('internal', 'Something went wrong on our side');
}

/** Strip Postgres prefixes/user ids from constraint messages before showing them. */
function sanitizeDbMessage(message: string): string {
  return message.replace(/^[a-z.]+:\s*/i, '').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>').slice(0, 300);
}

export class RequestTimeoutError extends Error {
  constructor(ms: number) {
    super(`Request exceeded ${ms}ms`);
    this.name = 'RequestTimeoutError';
  }
}
