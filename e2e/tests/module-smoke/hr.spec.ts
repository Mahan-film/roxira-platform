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

test.describe('Module Smoke · HR (منابع انسانی و پرسنل)', () => {
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
      await recordSmokeFailure(page, testInfo, 'hr', currentStep, findings);
    }
  });

  test('hr: open module, create employee, verify in list, reload, cancel/close panel', async ({ page }) => {
    // 1. Open the module
    currentStep = '01-open-module';
    await page.goto(`${BASE}/app/hr`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/کارکنان|منابع انسانی/);

    // 2. Create one record
    currentStep = '02-create-record';
    const newEmployeeBtn = page.getByRole('button', { name: /کارمند جدید|پرسنل جدید/ }).first();
    await expect(newEmployeeBtn).toBeVisible({ timeout: 20_000 });
    await newEmployeeBtn.click();

    // Fill EmployeeForm
    const firstNameInput = page.getByLabel(/نام/, { exact: true }).or(page.locator('input[name="firstName"]')).first();
    if (await firstNameInput.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await firstNameInput.fill(creds.employeeFirstName);
    }

    const lastNameInput = page.getByLabel(/نام خانوادگی/).or(page.locator('input[name="lastName"]')).first();
    if (await lastNameInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await lastNameInput.fill(creds.employeeLastName);
    }

    const nationalIdInput = page.getByLabel(/کد ملی/).or(page.locator('input[name="nationalId"]')).first();
    if (await nationalIdInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await nationalIdInput.fill(creds.nationalId);
    }

    const mobileInput = page.getByLabel(/موبایل|همراه/).or(page.locator('input[name="mobile"]')).first();
    if (await mobileInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await mobileInput.fill(creds.mobile);
    }

    const jobTitleInput = page.getByLabel(/سمت|عنوان شغلی/).or(page.locator('input[name="jobTitle"]')).first();
    if (await jobTitleInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await jobTitleInput.fill('کارشناس کنترل کیفیت');
    }

    const submitBtn = page.getByRole('button', { name: /ثبت پرسنل|ذخیره/ }).first();
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    await submitBtn.click();

    // 3. See it in the list
    currentStep = '03-see-in-list';
    const searchInput = page.getByLabel('جست‌وجوی کارکنان').or(page.getByPlaceholder(/جست‌وجو/)).first();
    if (await searchInput.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await searchInput.fill(creds.employeeLastName);
    }

    const employeeRow = page.getByRole('row').filter({ hasText: creds.employeeLastName });
    await expect(employeeRow.first()).toBeVisible({ timeout: 25_000 });
    await expect(employeeRow.first()).toContainText(creds.employeeFirstName);

    // 4. Reload
    currentStep = '04-reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    const searchAfterReload = page.getByLabel('جست‌وجوی کارکنان').or(page.getByPlaceholder(/جست‌وجو/)).first();
    if (await searchAfterReload.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await searchAfterReload.fill(creds.employeeLastName);
    }
    await expect(page.getByRole('row').filter({ hasText: creds.employeeLastName }).first()).toBeVisible({ timeout: 20_000 });

    // 5. Delete or cancel / edit panel cancellation
    currentStep = '05-cancel-operation';
    await employeeRow.first().click();
    const cancelEditBtn = page.getByRole('button', { name: /انصراف|بستن/ }).first();
    if (await cancelEditBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await cancelEditBtn.click();
    }
  });
});
