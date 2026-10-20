import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      '@art': fileURLToPath(new URL('../../packages/ui/src/art', import.meta.url)),
    },
  },
  test: {
    // Pure helpers that live next to their Studio screen (e.g. app/(studio)/library/batch-results.ts) keep their tests there.
    include: ['src/**/*.test.ts', 'app/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
