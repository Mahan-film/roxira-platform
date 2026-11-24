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

test.describe('Module Smoke · Invoicing (صورتحساب‌ها)', () => {
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
      await recordSmokeFailure(page, testInfo, 'invoicing', currentStep, findings);
    }
  });

  test('invoicing: open module, create invoice, verify in list, reload, cancel', async ({ page }) => {
    // 1. Open the module
    currentStep = '01-open-module';
    await page.goto(`${BASE}/app/invoicing`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/صورتحساب/);

    // 2. Create one record
    currentStep = '02-create-record';
    const newInvoiceBtn = page.getByRole('button', { name: /صورتحساب جدید|فاکتور جدید/ }).first();
    await expect(newInvoiceBtn).toBeVisible({ timeout: 20_000 });
    await newInvoiceBtn.click();

    const editorCard = page.locator('[data-slot="card"]').filter({ hasText: /صدور صورتحساب|فاکتور جدید/ }).first();
    await expect(editorCard.or(page.locator('form'))).toBeVisible({ timeout: 15_000 });

    const numberInput = page.locator('#invoice-number, input[name="number"]');
    if (await numberInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await numberInput.fill(creds.invoiceNumber);
    }

    const sellerInput = page.getByPlaceholder(/نام فروشنده/).first();
    if (await sellerInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await sellerInput.fill(creds.organization);
    }

    const buyerInput = page.getByPlaceholder(/نام خریدار|طرف حساب|مشتری/).first();
    if (await buyerInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await buyerInput.fill(creds.customerName);
    }

    const lineDescInput = page.getByPlaceholder(/شرح کالا یا خدمت/).first();
    if (await lineDescInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await lineDescInput.fill(creds.itemName);
    }

    const priceInput = page.locator('input[inputmode="decimal"], input[name*="price"]').first();
    if (await priceInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await priceInput.fill('1000000');
    }

    const submitBtn = page.getByRole('button', { name: /صدور صورتحساب|ثبت نهایی|ذخیره/ }).first();
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    await submitBtn.click();

    // 3. See it in the list
    currentStep = '03-see-in-list';
    const searchInput = page.getByLabel(/جست‌وجوی صورتحساب|جست‌وجو/).first();
    if (await searchInput.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await searchInput.fill(creds.invoiceNumber);
    }

    const invoiceRow = page.getByRole('row').filter({ hasText: creds.invoiceNumber });
    await expect(invoiceRow.first()).toBeVisible({ timeout: 25_000 });
    await expect(invoiceRow.first()).toContainText(creds.customerName);

    // 4. Reload
    currentStep = '04-reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    const searchAfterReload = page.getByLabel(/جست‌وجوی صورتحساب|جست‌وجو/).first();
    if (await searchAfterReload.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await searchAfterReload.fill(creds.invoiceNumber);
    }
    await expect(page.getByRole('row').filter({ hasText: creds.invoiceNumber }).first()).toBeVisible({ timeout: 20_000 });

    // 5. Delete or cancel it
    currentStep = '05-cancel-record';
    const targetRow = page.getByRole('row').filter({ hasText: creds.invoiceNumber }).first();
    const actionMenu = targetRow.getByRole('button', { name: /عملیات|بیشتر/ }).first();
    if (await actionMenu.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await actionMenu.click();
      const cancelItem = page.getByRole('menuitem', { name: /ابطال|لغو/ }).first();
      if (await cancelItem.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await cancelItem.click();
        // If confirmation dialog appears, confirm
        const confirmBtn = page.getByRole('button', { name: /تأیید|بله|ابطال صورتحساب/ }).first();
        if (await confirmBtn.isVisible({ timeout: 4_000 }).catch(() => false)) {
          await confirmBtn.click();
        }
      }
    }
  });
});
