/**
 * Browser-safe environment for the admin app. Only `NEXT_PUBLIC_*` values live here;
 * server secrets (OPENROUTER_API_KEY, service-role keys, R2 keys) are read exclusively in
 * route handlers through `serverEnv()` and never reach a client bundle.
 */
import { z } from 'zod';

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://127.0.0.1:8787'),
});
export type PublicEnv = z.infer<typeof PublicEnvSchema>;

let cached: PublicEnv | null = null;

/** Parsed public env. Throws a readable error at first use when a value is missing. */
export function publicEnv(): PublicEnv {
  if (cached) return cached;
  // Next.js inlines NEXT_PUBLIC_* only when accessed as literal `process.env.NAME`.
  const parsed = PublicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  });
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Admin env is incomplete: ${missing}. Copy apps/admin/.env.example to apps/admin/.env.local.`);
  }
  cached = parsed.data;
  return cached;
}

/** True when the public env is configured (used by pages to render honest setup states). */
export function hasPublicEnv(): boolean {
  try {
    publicEnv();
    return true;
  } catch {
    return false;
  }
}

/** Server-only secrets; never import from a client component. */
export function serverEnv(): { OPENROUTER_API_KEY: string | null } {
  return { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY?.trim() || null };
}
