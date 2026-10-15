import { expect, test } from '@playwright/test';

/**
 * Anonymous visitors never see studio screens: the proxy sends them to /login with the
 * original path preserved (`next`). Works without Supabase being reachable because the
 * decision happens before any network call when there is no session cookie.
 */
test('anonymous visit to a studio route redirects to /login', async ({ page }) => {
  const response = await page.goto('/library?status=published');
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/login\?reason=signin&next=%2Flibrary/);
  await expect(page.getByRole('heading', { name: /LangQuest Studio/i })).toBeVisible();
});

test('login page shows the honest setup state or the sign-in form', async ({ page }) => {
  await page.goto('/login');
  const form = page.getByLabel(/email|courriel/i);
  const setup = page.getByText(/Environment not configured|Environnement non configuré/);
  await expect(form.or(setup)).toBeVisible();
});
