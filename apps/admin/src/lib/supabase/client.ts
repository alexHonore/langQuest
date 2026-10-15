'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@langquest/db/database.types';
import { publicEnv } from '@/src/lib/env';

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

/** Singleton browser Supabase client (anon key + cookie session). */
export function supabaseBrowser() {
  if (browserClient) return browserClient;
  const env = publicEnv();
  browserClient = createBrowserClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return browserClient;
}

/** Current access token for bearer calls to the LangQuest API, or null when signed out. */
export async function browserAccessToken(): Promise<string | null> {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token ?? null;
}
