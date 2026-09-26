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
