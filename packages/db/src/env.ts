/**
 * Environment resolution for Supabase clients. Only server processes may hold the service-role key;
 * mobile/admin bundles receive URL + anon key only (CONVENTIONS §1).
 */
import { z } from 'zod';

export const SupabaseServerEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  /** Server only. Never bundle. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});
export type SupabaseServerEnv = z.infer<typeof SupabaseServerEnvSchema>;

export const SupabasePublicEnvSchema = SupabaseServerEnvSchema.pick({ SUPABASE_URL: true, SUPABASE_ANON_KEY: true });
export type SupabasePublicEnv = z.infer<typeof SupabasePublicEnvSchema>;

/** Default local-stack URL from `supabase start` (config.toml api.port = 54321). */
export const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';

/**
 * Reads server env from `process.env` (or an explicit source) and validates it.
 * Accepts the `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` aliases for URL + anon key so one helper works everywhere.
 */
export function readServerEnv(source: Record<string, string | undefined> = process.env): SupabaseServerEnv {
  return SupabaseServerEnvSchema.parse({
    SUPABASE_URL: source.SUPABASE_URL ?? source.EXPO_PUBLIC_SUPABASE_URL ?? source.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: source.SUPABASE_ANON_KEY ?? source.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
  });
}

/** Reads the public (URL + anon key) env; safe in client bundles. */
export function readPublicEnv(source: Record<string, string | undefined> = process.env): SupabasePublicEnv {
  return SupabasePublicEnvSchema.parse({
    SUPABASE_URL: source.SUPABASE_URL ?? source.EXPO_PUBLIC_SUPABASE_URL ?? source.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: source.SUPABASE_ANON_KEY ?? source.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
