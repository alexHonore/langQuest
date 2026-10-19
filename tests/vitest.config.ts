import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Cross-cutting suites (spec §14.3). Each project is runnable alone (`vitest run --project security`).
 *
 * - integration / security: drive the Hono API in-process (`apps/api/src/app.ts`) against the LOCAL Supabase
 *   stack (Docker). They skip with an explicit warning when the stack is down, and fail when
 *   `LANGQUEST_REQUIRE_STACK=1`.
 * - locales / audio: pure package tests (audio additionally needs `ffmpeg`/`ffprobe` on PATH).
 * - load: only the smoke test of the load script's helpers; the load run itself is `pnpm --filter @langquest/tests load`
 *   against `wrangler dev` and is documented in `load/README.md` (never run in CI).
 *
 * Stack-bound files run serially (shared Docker Postgres) to keep per-test cleanup deterministic.
 */
const REPO_ROOT = resolve(import.meta.dirname, '..');

const project = (name: string, include: string[], extra: Record<string, unknown> = {}) => ({
  extends: true as const,
  test: { name, include, ...extra },
});

export default defineConfig({
  server: { fs: { allow: [REPO_ROOT] } },
  test: {
    environment: 'node',
    testTimeout: 90_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    passWithNoTests: true,
    projects: [
      project('integration', ['integration/**/*.test.ts']),
      project('security', ['security/**/*.test.ts']),
      project('locales', ['locales/**/*.test.ts']),
      project('audio', ['audio/**/*.test.ts']),
      project('load', ['load/**/*.test.ts']),
    ],
  },
});
