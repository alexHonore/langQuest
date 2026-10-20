import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests cover the pure modules of the learner app (stores, outbox sync,
 * lesson/conversation machines, API client). Nothing here imports React Native.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'plugins/**/*.test.ts'],
    passWithNoTests: true,
  },
});
