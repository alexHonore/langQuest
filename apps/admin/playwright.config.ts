import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke suite for the admin CMS. Runs against `next dev` on :3100 by default;
 * set `ADMIN_E2E_BASE_URL` to target a deployed instance. Specs only exercise flows that
 * work without a provisioned API (login redirect, role gate, uploads page render).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.ADMIN_E2E_BASE_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.ADMIN_E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev --port 3100',
        url: 'http://localhost:3100/login',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
