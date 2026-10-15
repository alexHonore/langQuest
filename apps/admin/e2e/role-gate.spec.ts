import { expect, test } from '@playwright/test';

/**
 * Role gate: a signed-in account WITHOUT a `user_roles` row is signed out and told why.
 * Requires a local Supabase stack and a learner test account:
 *   ADMIN_E2E_LEARNER_EMAIL / ADMIN_E2E_LEARNER_PASSWORD (created with the catalog seed or
 *   `supabase auth` admin API). Skipped when those env vars are absent.
 */
const email = process.env.ADMIN_E2E_LEARNER_EMAIL;
const password = process.env.ADMIN_E2E_LEARNER_PASSWORD;

test.skip(!email || !password, 'needs ADMIN_E2E_LEARNER_EMAIL / ADMIN_E2E_LEARNER_PASSWORD');

test('a learner without a staff role is bounced back to /login?reason=norole', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email|courriel/i).fill(email!);
  await page.getByLabel(/password|mot de passe/i).fill(password!);
  await page.getByRole('button', { name: /sign in|se connecter/i }).click();
  await expect(page).toHaveURL(/\/login\?reason=norole/);
  await expect(page.getByText(/no staff role|aucun rôle/i)).toBeVisible();
});

test('API routes refuse anonymous callers with the contract envelope', async ({ request }) => {
  const res = await request.post('/api/admin/speakers', { data: { displayName: 'x' } });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.ok).toBe(false);
  expect(body.error.code).toBe('unauthorized');
});
