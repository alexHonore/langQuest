/**
 * Local Supabase stack discovery for the cross-cutting suites.
 *
 * Resolution: `@langquest/db` `detectLocalStack()` (env `SUPABASE_LOCAL_*` or `supabase status -o json`), plus the
 * stack's `JWT_SECRET` (needed to verify HS256 tokens in-process and to forge invalid ones in security tests).
 *
 * Policy (task brief): suites that need the stack SKIP with an explicit warning when it is absent and FAIL when
 * `LANGQUEST_REQUIRE_STACK=1` is set, so CI can insist on a provisioned stack while local runs stay green.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { detectLocalStack, type LocalStack } from '@langquest/db/local-stack';
import { describe } from 'vitest';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

export interface TestStack extends LocalStack {
  /** HS256 secret of the local GoTrue (`supabase status` → JWT_SECRET); null when it could not be read. */
  jwtSecret: string | null;
}

let cached: TestStack | null | undefined;

function readJwtSecret(): string | null {
  if (process.env.SUPABASE_LOCAL_JWT_SECRET) return process.env.SUPABASE_LOCAL_JWT_SECRET;
  const result = spawnSync('supabase', ['status', '-o', 'json'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 20_000 });
  if (result.error || result.status !== 0 || !result.stdout) return null;
  const start = result.stdout.indexOf('{');
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(result.stdout.slice(start)) as { JWT_SECRET?: string };
    return parsed.JWT_SECRET ?? null;
  } catch {
    return null;
  }
}

/** Detect the local stack once per process (never throws). */
export function getStack(): TestStack | null {
  if (cached !== undefined) return cached;
  const base = detectLocalStack({ cwd: REPO_ROOT });
  cached = base ? { ...base, jwtSecret: readJwtSecret() } : null;
  return cached;
}

export const STACK_HELP = 'Run `pnpm supabase start` (Docker) at the repo root, or set SUPABASE_LOCAL_URL + SUPABASE_LOCAL_ANON_KEY + SUPABASE_LOCAL_SERVICE_ROLE_KEY (+ SUPABASE_LOCAL_JWT_SECRET).';

/**
 * `describe` bound to stack availability. Returns `describe` when the stack is reachable, otherwise logs an
 * explicit warning and returns `describe.skip` — or throws when `LANGQUEST_REQUIRE_STACK=1`.
 */
export function describeWithStack(suite: string): typeof describe {
  const stack = getStack();
  if (stack) {
    if (!stack.jwtSecret) console.warn(`[${suite}] Local stack found but JWT_SECRET could not be read; the API will verify tokens through GoTrue (slower) and forged-token tests are limited.`);
    return describe;
  }
  const message = `[${suite}] Local Supabase stack not reachable. ${STACK_HELP}`;
  if (process.env.LANGQUEST_REQUIRE_STACK === '1' || process.env.LANGQUEST_REQUIRE_LOCAL_STACK === '1') throw new Error(message);
  console.warn(`${message} Skipping stack-bound tests.`);
  return describe.skip as unknown as typeof describe;
}

/** Same policy for optional binaries (ffmpeg) and other prerequisites: skip loudly, or fail when required. */
export function describeWithPrerequisite(suite: string, present: boolean, help: string): typeof describe {
  if (present) return describe;
  const message = `[${suite}] Prerequisite missing: ${help}`;
  if (process.env.LANGQUEST_REQUIRE_STACK === '1') throw new Error(message);
  console.warn(`${message} Skipping.`);
  return describe.skip as unknown as typeof describe;
}
