import { expect, test } from '@playwright/test';

/**
 * Uploads page renders for a staff account (drop zone, file + folder pickers, queue controls).
 * Requires ADMIN_E2E_STAFF_EMAIL / ADMIN_E2E_STAFF_PASSWORD for an account holding
 * `content_editor` (or higher) in `user_roles` on the local stack.
 */
const email = process.env.ADMIN_E2E_STAFF_EMAIL;
const password = process.env.ADMIN_E2E_STAFF_PASSWORD;

test.skip(!email || !password, 'needs ADMIN_E2E_STAFF_EMAIL / ADMIN_E2E_STAFF_PASSWORD');

test('staff can open the uploads page and queue a file without freezing', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email|courriel/i).fill(email!);
  await page.getByLabel(/password|mot de passe/i).fill(password!);
  await page.getByRole('button', { name: /sign in|se connecter/i }).click();
  await page.goto('/uploads');
  // Without media storage on the API (R2 not configured) the page IS the setup step: the exact next
  // step is shown and no drop zone exists (CONVENTIONS §8, nothing greyed out).
  const setupStep = page.getByText(/R2_ACCESS_KEY_ID/);
  if (await setupStep.isVisible().catch(() => false)) {
    await expect(page.getByRole('region', { name: /drop|déposez/i })).toHaveCount(0);
    await expect(page.locator('input[type=file]')).toHaveCount(0);
    return;
  }
  await expect(page.getByRole('region', { name: /drop|déposez/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /choose files|choisir des fichiers/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /choose folder|choisir un dossier/i })).toBeVisible();

  // Queue a tiny unsupported file: it must be listed as "Unsupported" (honest state), never uploaded.
  const input = page.locator('input[type=file]').first();
  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText(/unsupported|non pris en charge/i).first()).toBeVisible();
});
