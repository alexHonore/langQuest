/**
 * Local Supabase stack discovery for integration tests and scripts.
 * Resolution order: explicit env (`SUPABASE_LOCAL_URL`, `SUPABASE_LOCAL_ANON_KEY`,
 * `SUPABASE_LOCAL_SERVICE_ROLE_KEY`) → `supabase status -o json` → unreachable.
 */
import { spawnSync } from 'node:child_process';

export interface LocalStack {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string | null;
}

const DEFAULT_TIMEOUT_MS = 20000;

function fromEnv(env: Record<string, string | undefined>): LocalStack | null {
  if (env.SUPABASE_LOCAL_URL && env.SUPABASE_LOCAL_ANON_KEY && env.SUPABASE_LOCAL_SERVICE_ROLE_KEY) {
    return { url: env.SUPABASE_LOCAL_URL, anonKey: env.SUPABASE_LOCAL_ANON_KEY, serviceRoleKey: env.SUPABASE_LOCAL_SERVICE_ROLE_KEY, dbUrl: env.SUPABASE_LOCAL_DB_URL ?? null };
  }
  return null;
}

/** Parses the JSON printed by `supabase status -o json` (keys as of CLI 2.x). */
export function parseSupabaseStatus(json: string): LocalStack | null {
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    const url = (data.API_URL as string | undefined) ?? null;
    const anonKey = (data.ANON_KEY as string | undefined) ?? (data.PUBLISHABLE_KEY as string | undefined) ?? null;
    const serviceRoleKey = (data.SERVICE_ROLE_KEY as string | undefined) ?? (data.SECRET_KEY as string | undefined) ?? null;
    if (!url || !anonKey || !serviceRoleKey) return null;
    return { url, anonKey, serviceRoleKey, dbUrl: (data.DB_URL as string | undefined) ?? null };
  } catch {
    return null;
  }
}

/** Synchronously detects a running local stack. Returns null (never throws) when it is down. */
export function detectLocalStack(opts: { cwd?: string; env?: Record<string, string | undefined>; timeoutMs?: number } = {}): LocalStack | null {
  const env = opts.env ?? process.env;
  const explicit = fromEnv(env);
  if (explicit) return explicit;
  if (env.LANGQUEST_SKIP_LOCAL_STACK === '1') return null;
  const cwd = opts.cwd ?? process.cwd();
  const result = spawnSync('supabase', ['status', '-o', 'json'], { cwd, encoding: 'utf8', timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, env: { ...process.env, ...env } as NodeJS.ProcessEnv });
  if (result.error || result.status !== 0 || !result.stdout) return null;
  // The CLI prints warnings before the JSON object; take the last `{...}` block.
  const start = result.stdout.indexOf('{');
  return start >= 0 ? parseSupabaseStatus(result.stdout.slice(start)) : null;
}
