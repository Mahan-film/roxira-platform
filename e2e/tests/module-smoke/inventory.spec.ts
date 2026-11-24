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

test.describe('Module Smoke · Inventory (کالاها و انبار)', () => {
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
      await recordSmokeFailure(page, testInfo, 'inventory', currentStep, findings);
    }
  });

  test('inventory: open module, create stock item, verify in list, reload, cancel/close drawer', async ({ page }) => {
    // 1. Open the module
    currentStep = '01-open-module';
    await page.goto(`${BASE}/app/inventory`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/کالا|انبار/);

    // 2. Create one record
    currentStep = '02-create-record';
    const newItemBtn = page.getByRole('button', { name: /کالای جدید/ }).first();
    await expect(newItemBtn).toBeVisible({ timeout: 20_000 });
    await newItemBtn.click();

    await expect(page.locator('#item-sku')).toBeVisible({ timeout: 15_000 });
    await page.locator('#item-sku').fill(creds.sku);
    await page.locator('#item-barcode').fill(creds.barcode);
    await page.locator('#item-name').fill(creds.itemName);

    const minQty = page.locator('#item-min');
    if (await minQty.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await minQty.fill('5');
    }

    const submitBtn = page.getByRole('button', { name: /افزودن کالا|ذخیره/ }).first();
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    await submitBtn.click();

    // 3. See it in the list
    currentStep = '03-see-in-list';
    const searchInput = page.locator('input[aria-label*="جست"], input[placeholder*="کد"], input[placeholder*="نام"]').first();
    if (await searchInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await searchInput.fill(creds.sku);
    }

    const itemRow = page.getByRole('row').filter({ hasText: creds.sku });
    await expect(itemRow.first()).toBeVisible({ timeout: 25_000 });
    await expect(itemRow.first()).toContainText(creds.itemName);

    // 4. Reload
    currentStep = '04-reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    const searchAfterReload = page.locator('input[aria-label*="جست"], input[placeholder*="کد"], input[placeholder*="نام"]').first();
    if (await searchAfterReload.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await searchAfterReload.fill(creds.sku);
    }
    await expect(page.getByRole('row').filter({ hasText: creds.sku }).first()).toBeVisible({ timeout: 20_000 });

    // 5. Delete or cancel / drawer cancellation
    currentStep = '05-cancel-operation';
    // Open drawer and verify clean cancel
    await newItemBtn.click();
    await expect(page.locator('#item-sku')).toBeVisible({ timeout: 10_000 });
    await page.locator('#item-sku').fill(`CANCEL-${creds.suffix}`);

    const cancelBtn = page.getByRole('button', { name: /انصراف|بستن/ }).first();
    await expect(cancelBtn).toBeVisible({ timeout: 5_000 });
    await cancelBtn.click();

    // Verify cancelled item was NOT created
    await expect(page.getByRole('row').filter({ hasText: `CANCEL-${creds.suffix}` })).toHaveCount(0);
  });
});
