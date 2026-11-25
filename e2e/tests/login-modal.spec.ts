import { test, expect } from '@playwright/test';

// W19: item 4 — login/signup must either work end to end or be clearly
// disabled. This only opens the modal and checks the phone-entry form
// renders; it deliberately never submits a phone number, since that would
// trigger a real SMS/OTP send.
test('login modal opens from the header and shows the phone step', async ({ page }) => {
  await page.goto('/chat');

  await page.getByRole('button', { name: 'ورود / ثبت‌نام' }).click();

  const dialog = page.getByRole('dialog', { name: /ورود به سامانه/ });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('شماره همراه')).toBeVisible();
  await expect(page.getByRole('button', { name: 'دریافت کد تأیید' })).toBeVisible();
});

test('signup page requires accepting terms and privacy policy (UI + API)', async ({ page }) => {
  await page.goto('/signup');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.locator('#pw-email').fill('terms-check@example.com');
  await dialog.locator('#pw-password').fill('ValidPassword#1234');
  await dialog.locator('#pw-org').fill('Test Org');

  const checkbox = dialog.locator('#pw-accept-terms');
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();

  await dialog.getByRole('button', { name: 'ساخت حساب' }).click();
  await expect(dialog.getByRole('alert')).toContainText('قوانین و سیاست حفظ حریم خصوصی');

  const apiRes = await page.request.post('/api/backend/auth/signup', {
    data: {
      email: `terms-api-${Date.now()}@example.com`,
      password: 'ValidPassword#1234',
      acceptTerms: false,
    },
  });
  expect(apiRes.status()).toBe(400);
});
