import 'server-only';
/**
 * Error translation for local adapter routes that forward an operation to the LangQuest API with
 * the staff token (`serverApi`). Contract failures keep their code and message; an unreachable API
 * becomes `provider_unavailable` (503) so the screen shows its honest "API unreachable" state.
 */
import type { JsonValue } from '@langquest/contracts';
import { ApiClientError, ApiUnreachableError } from '../api';
import { LocalApiError } from './handler';

/** Best-effort JSON projection of arbitrary error details (drops anything not serialisable). */
export function jsonDetails(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return undefined;
  }
}

/** Rethrow an API client failure as a `LocalApiError`; anything else is rethrown untouched. */
export function forwardApiError(err: unknown, what: string): never {
  if (err instanceof ApiClientError) throw new LocalApiError(err.code, err.message, jsonDetails(err.details));
  if (err instanceof ApiUnreachableError) throw new LocalApiError('provider_unavailable', `${err.message}; ${what} go through the API`);
  throw err;
}
