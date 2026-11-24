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

test.describe('Module Smoke · CRM (مشتریان و سرنخ‌ها)', () => {
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
      await recordSmokeFailure(page, testInfo, 'crm', currentStep, findings);
    }
  });

  test('crm: open module, create customer/lead, verify in list, reload, cancel/panel close', async ({ page }) => {
    // 1. Open the module
    currentStep = '01-open-module';
    await page.goto(`${BASE}/app/crm`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/مشتریان|CRM/);

    // 2. Create one record
    currentStep = '02-create-record';
    const newLeadBtn = page.getByRole('button', { name: /مشتری جدید|سرنخ جدید/ }).first();
    await expect(newLeadBtn).toBeVisible({ timeout: 20_000 });
    await newLeadBtn.click();

    const nameInput = page.getByLabel(/نام کامل|نام/).or(page.locator('input[name="fullName"]')).first();
    if (await nameInput.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await nameInput.fill(creds.leadName);
    }

    const companyInput = page.getByLabel(/شرکت/).or(page.locator('input[name="company"]')).first();
    if (await companyInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await companyInput.fill(creds.leadCompany);
    }

    const emailInput = page.getByLabel(/ایمیل/).or(page.locator('input[name="email"]')).first();
    if (await emailInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await emailInput.fill(`lead-${creds.suffix}@example.invalid`);
    }

    const phoneInput = page.getByLabel(/تلفن|موبایل/).or(page.locator('input[name="phone"]')).first();
    if (await phoneInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await phoneInput.fill(creds.mobile);
    }

    const submitBtn = page.getByRole('button', { name: /ثبت سرنخ|ثبت مشتری|ذخیره/ }).first();
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    await submitBtn.click();

    // 3. See it in the list
    currentStep = '03-see-in-list';
    const searchInput = page.getByLabel('جست‌وجوی مشتریان').or(page.getByPlaceholder(/جست‌وجو/)).first();
    if (await searchInput.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await searchInput.fill(creds.leadName);
    }

    const leadRow = page.getByRole('row').filter({ hasText: creds.leadName });
    await expect(leadRow.first()).toBeVisible({ timeout: 25_000 });
    await expect(leadRow.first()).toContainText(creds.leadCompany);

    // 4. Reload
    currentStep = '04-reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    const searchAfterReload = page.getByLabel('جست‌وجوی مشتریان').or(page.getByPlaceholder(/جست‌وجو/)).first();
    if (await searchAfterReload.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await searchAfterReload.fill(creds.leadName);
    }
    await expect(page.getByRole('row').filter({ hasText: creds.leadName }).first()).toBeVisible({ timeout: 20_000 });

    // 5. Delete or cancel / panel dismissal
    currentStep = '05-cancel-operation';
    await leadRow.first().click();
    const cancelPanelBtn = page.getByRole('button', { name: /انصراف|بستن/ }).first();
    if (await cancelPanelBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await cancelPanelBtn.click();
    }
  });
});
