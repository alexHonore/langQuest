'use client';
/**
 * Browser helper for the local adapter routes: same envelope and error classes as the
 * contracts client so screens handle both uniformly.
 */
import { ApiFailureSchema } from '@langquest/contracts';
import { ApiClientError, ApiUnreachableError } from '../api';

export async function localCall<T = unknown>(path: string, init: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { Accept: 'application/json', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
    });
  } catch (error) {
    throw new ApiUnreachableError(path, error);
  }
  const json: unknown = await res.json().catch(() => null);
  const failure = ApiFailureSchema.safeParse(json);
  if (failure.success) throw new ApiClientError(failure.data.error.code, failure.data.error.message, res.status, failure.data.error.details);
  if (!res.ok || !json || typeof json !== 'object' || !('data' in json)) throw new ApiClientError('internal', `HTTP ${res.status} from ${path}`, res.status, json);
  return (json as { data: T }).data;
}
