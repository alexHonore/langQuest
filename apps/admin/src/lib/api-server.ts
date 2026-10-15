import 'server-only';
import { createApiClient, type ApiClient } from './api';
import { publicEnv } from './env';
import type { StaffSession } from './auth/session';

/** Server-side API client bound to the signed-in staff member's token. */
export function serverApi(session: StaffSession): ApiClient {
  return createApiClient({ baseUrl: publicEnv().NEXT_PUBLIC_API_BASE_URL, getToken: async () => session.accessToken, timeoutMs: 15_000 });
}
