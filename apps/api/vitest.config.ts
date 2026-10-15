import { defineConfig } from 'vitest/config';

/**
 * Tests run under Node: the app is exercised with `app.request()` (Hono) and talks to the local Supabase
 * stack over HTTP when it is reachable. Worker-only bindings (R2, KV, Cache API) are optional and stubbed.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
