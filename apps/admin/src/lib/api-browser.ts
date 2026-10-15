'use client';
import { createApiClient, type ApiClient } from './api';
import { publicEnv } from './env';
import { browserAccessToken } from './supabase/client';

let client: ApiClient | null = null;

/** Browser-side API client (bearer = Supabase session token). */
export function browserApi(): ApiClient {
  if (client) return client;
  client = createApiClient({ baseUrl: publicEnv().NEXT_PUBLIC_API_BASE_URL, getToken: browserAccessToken });
  return client;
}
