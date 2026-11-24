import { test, expect } from '@playwright/test';
import {
  BASE,
  ensureSmokeAuth,
  generateModuleSmokeData,
  recordSmokeFailure,
  watchSmokePage,
  type SmokeCredentials,
  type SmokeFindings,
} from '../helpers/module-smoke';

test.describe('Module Smoke · Settings (تنظیمات و اعضا)', () => {
  test.setTimeout(120_000);

  let creds: SmokeCredentials;
  let findings: SmokeFindings;
  let currentStep = 'init';

  test.beforeEach(async ({ page }) => {
    creds = generateModuleSmokeData();
    findings = watchSmokePage(page);
    await ensureSmokeAuth(page, creds);
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await recordSmokeFailure(page, testInfo, 'settings', currentStep, findings);
    }
  });

  test('settings: open module, create invitation, verify in list, reload, revoke/cancel', async ({ page }) => {
    // 1. Open the module
    currentStep = '01-open-module';
    await page.goto(`${BASE}/app/settings/members`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/اعضا و نقش‌ها|تنظیمات/);

    // Switch to invitations tab
    const inviteTab = page.getByRole('tab', { name: 'دعوت‌نامه‌ها' });
    if (await inviteTab.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await inviteTab.click();
    }

    // 2. Create one record
    currentStep = '02-create-record';
    const contactInput = page.locator('#inv-contact');
    await expect(contactInput).toBeVisible({ timeout: 15_000 });
    await contactInput.fill(creds.inviteEmail);

    const submitInvite = page.getByRole('button', { name: /ارسال دعوت‌نامه/ }).first();
    await expect(submitInvite).toBeVisible({ timeout: 5_000 });
    await submitInvite.click();

    // 3. See it in the list
    currentStep = '03-see-in-list';
    const inviteRow = page.getByRole('row').filter({ hasText: creds.inviteEmail });
    await expect(inviteRow.first()).toBeVisible({ timeout: 25_000 });

    // 4. Reload
    currentStep = '04-reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    const reloadInviteTab = page.getByRole('tab', { name: 'دعوت‌نامه‌ها' });
    if (await reloadInviteTab.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await reloadInviteTab.click();
    }
    await expect(page.getByRole('row').filter({ hasText: creds.inviteEmail }).first()).toBeVisible({ timeout: 20_000 });

    // 5. Delete or cancel / revoke
    currentStep = '05-revoke-invitation';
    const targetRow = page.getByRole('row').filter({ hasText: creds.inviteEmail }).first();
    const revokeBtn = targetRow.getByRole('button', { name: 'لغو' });
    await expect(revokeBtn).toBeVisible({ timeout: 10_000 });
    await revokeBtn.click();

    // Verify invitation is removed/revoked
    await expect(page.getByRole('row').filter({ hasText: creds.inviteEmail })).toHaveCount(0, { timeout: 15_000 });
  });
});
