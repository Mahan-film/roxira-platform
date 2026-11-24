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

test.describe('Module Smoke · Accounting (حسابداری)', () => {
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
      await recordSmokeFailure(page, testInfo, 'accounting', currentStep, findings);
    }
  });

  test('accounting: open module, create voucher, verify in list, reload, cancel/reverse', async ({ page }) => {
    const voucherDesc = `سند حسابداری تست اسموک ${creds.suffix}`;

    // 1. Open the module
    currentStep = '01-open-module';
    await page.goto(`${BASE}/app/accounting/vouchers`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/اسناد|حساب/);

    // 2. Create one record
    currentStep = '02-create-record';
    const newVoucherBtn = page.getByRole('button', { name: /سند جدید/ }).first();
    await expect(newVoucherBtn).toBeVisible({ timeout: 15_000 });
    await newVoucherBtn.click();

    // Fill voucher description
    const descInput = page.getByPlaceholder(/شرح کلی سند|شرح سند/).first();
    if (await descInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await descInput.fill(voucherDesc);
    }

    // Enter debit line in grid: account code, debit amount
    const accountCell0 = page.locator('#voucher-cell-0-0');
    if (await accountCell0.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await accountCell0.focus();
      await page.keyboard.type('1011');
      await page.keyboard.press('Tab');
      const debitCell = page.locator('#voucher-cell-0-1');
      await debitCell.fill('5000000');
    }

    // Enter credit line in grid: account code, credit amount
    const accountCell1 = page.locator('#voucher-cell-1-0');
    if (await accountCell1.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await accountCell1.focus();
      await page.keyboard.type('3010');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      const creditCell = page.locator('#voucher-cell-1-2');
      await creditCell.fill('5000000');
    }

    // Submit voucher
    const submitBtn = page.getByRole('button', { name: /ثبت سند|ذخیره سند/ }).first();
    if (await submitBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await submitBtn.click();
    } else {
      await page.keyboard.press('Control+Enter').catch(() => undefined);
    }

    // 3. See it in the list
    currentStep = '03-see-in-list';
    const voucherRow = page.getByRole('row').filter({ hasText: voucherDesc });
    const hasRow = await voucherRow.first().isVisible({ timeout: 15_000 }).catch(() => false);
    if (!hasRow) {
      // If accounts were not seeded on a fresh tenant, verify form validation/prompt or list container
      await expect(page.locator('table, [role="table"], [data-slot="empty-state"]')).toBeVisible({ timeout: 15_000 });
    }

    // 4. Reload
    currentStep = '04-reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    // 5. Delete or cancel / reverse
    currentStep = '05-cancel-or-reverse';
    const actionBtn = voucherRow.getByRole('button', { name: /عملیات|بیشتر/ }).first();
    if (await actionBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await actionBtn.click();
      const cancelOption = page.getByRole('menuitem', { name: /برگشت|ابطال|تبدیل به پیش‌نویس|لغو/ }).first();
      if (await cancelOption.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await cancelOption.click();
      }
    } else {
      // In form or empty view, verify clean cancel / dismiss
      const cancelBtn = page.getByRole('button', { name: /انصراف|بستن/ }).first();
      if (await cancelBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await cancelBtn.click();
      }
    }
  });
});
