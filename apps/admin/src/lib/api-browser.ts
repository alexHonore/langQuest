'use client';
import { createApiClient, type ApiClient } from './api';
import { publicEnv } from './env';
import { browserAccessToken } from './supabase/client';

let client: ApiClient | null = null;
let longClient: ApiClient | null = null;

/** Browser-side API client (bearer = Supabase session token). */
export function browserApi(): ApiClient {
  if (client) return client;
  client = createApiClient({ baseUrl: publicEnv().NEXT_PUBLIC_API_BASE_URL, getToken: browserAccessToken });
  return client;
}

/** Client timeout for calls the API itself bounds above the default 30 s; must stay above every such server deadline. */
export const LONG_CALL_TIMEOUT_MS = 75_000;

/**
 * Same client with a longer timeout for the calls the API allows to run past 30 s: AI probes (test harness, bounded at
 * 60 s) and transcript saves (`adminTranscriptSave`, bounded at 55 s for large transcripts). With the default 30 s the
 * Studio would report "API unreachable" while the API still finishes the call — for a transcript, a retry would then
 * write a second revision.
 */
export function browserLongApi(): ApiClient {
  if (longClient) return longClient;
  longClient = createApiClient({ baseUrl: publicEnv().NEXT_PUBLIC_API_BASE_URL, getToken: browserAccessToken, timeoutMs: LONG_CALL_TIMEOUT_MS });
  return longClient;
}
