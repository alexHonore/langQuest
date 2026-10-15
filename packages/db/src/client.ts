/**
 * Typed Supabase client factories (ADR-003).
 *
 * - `createServiceClient` — service role, bypasses RLS. Server processes only (API Worker, jobs, seeds).
 * - `createUserClient`    — anon key + the learner's JWT forwarded in `Authorization`, so RLS applies
 *                            exactly as if the learner called Supabase directly.
 * - `createAnonClient`    — anon key, no session: public catalog reads only.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import type { SupabasePublicEnv, SupabaseServerEnv } from './env';

export type DbClient = SupabaseClient<Database, 'public'>;

const baseOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

/** Service-role client. Never construct this in a browser or mobile bundle. */
export function createServiceClient(env: Pick<SupabaseServerEnv, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>): DbClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    ...baseOptions,
    global: { headers: { 'x-langquest-client': 'service' } },
  });
}

/**
 * Per-request client acting as the learner identified by `accessToken` (a Supabase JWT).
 * Every query runs under RLS with `auth.uid()` = the token subject.
 */
export function createUserClient(env: SupabasePublicEnv, accessToken: string): DbClient {
  if (!accessToken) throw new Error('createUserClient requires a non-empty access token');
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...baseOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}`, 'x-langquest-client': 'user' } },
  });
}

/** Unauthenticated client (public catalog). */
export function createAnonClient(env: SupabasePublicEnv): DbClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...baseOptions,
    global: { headers: { 'x-langquest-client': 'anon' } },
  });
}
