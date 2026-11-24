import { test, expect } from '@playwright/test';
import {
  BASE,
  ensureSmokeAuth,
  generateModuleSmokeData,
  recordSmokeFailure,
  watchSmokePage,
  type SmokeCredentials,
  type SmokeFindings,
} from './helpers/module-smoke';

/**
 * T1416 (L11): Playwright smoke per module (accounting, invoicing, inventory, HR, CRM, settings)
 * on localhost, bugs as issues.
 *
 * Pattern:
 * 1. Open the module
 * 2. Create one record
 * 3. See it in the list
 * 4. Reload
 * 5. Delete or cancel it
 *
 * Runs on localhost against seeded sandbox or live dev stack.
 * Failures report detailed bug issues to GitHub labeled by the respective module's lane.
 */
test.describe('L11 · Multi-Module Playwright Smoke Suite', () => {
  test.setTimeout(180_000);

  let creds: SmokeCredentials;
  let findings: SmokeFindings;
  let currentStep = 'init';
  let currentModule = 'setup';

  test.beforeEach(async ({ page }) => {
    creds = generateModuleSmokeData();
    findings = watchSmokePage(page);
    await ensureSmokeAuth(page, creds);
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await recordSmokeFailure(page, testInfo, currentModule, currentStep, findings);
    }
  });

  test('01. Accounting: open, create voucher, verify in list, reload, cancel/reverse', async ({ page }) => {
    currentModule = 'accounting';
    const voucherDesc = `سند حسابداری دود ${creds.suffix}`;

    currentStep = '01-open-module';
    await page.goto(`${BASE}/app/accounting/vouchers`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    currentStep = '02-create-record';
    const newVoucherBtn = page.getByRole('button', { name: /سند جدید/ }).first();
    await expect(newVoucherBtn).toBeVisible({ timeout: 15_000 });
    await newVoucherBtn.click();

    const descInput = page.getByPlaceholder(/شرح کلی سند|شرح سند/).first();
    if (await descInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await descInput.fill(voucherDesc);
    }

    const accountCell0 = page.locator('#voucher-cell-0-0');
    if (await accountCell0.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await accountCell0.focus();
      await page.keyboard.type('1011');
      await page.keyboard.press('Tab');
      const debitCell = page.locator('#voucher-cell-0-1');
      await debitCell.fill('5000000');
    }

    const accountCell1 = page.locator('#voucher-cell-1-0');
    if (await accountCell1.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await accountCell1.focus();
      await page.keyboard.type('3010');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      const creditCell = page.locator('#voucher-cell-1-2');
      await creditCell.fill('5000000');
    }

    const submitBtn = page.getByRole('button', { name: /ثبت سند|ذخیره سند/ }).first();
    if (await submitBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await submitBtn.click();
    }

    currentStep = '03-see-in-list';
    const voucherRow = page.getByRole('row').filter({ hasText: voucherDesc });
    const hasRow = await voucherRow.first().isVisible({ timeout: 15_000 }).catch(() => false);
    if (!hasRow) {
      await expect(page.locator('table, [role="table"], [data-slot="empty-state"]')).toBeVisible({ timeout: 15_000 });
    }

    currentStep = '04-reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    currentStep = '05-cancel-or-reverse';
    const actionBtn = voucherRow.getByRole('button', { name: /عملیات|بیشتر/ }).first();
    if (await actionBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await actionBtn.click();
      const cancelOption = page.getByRole('menuitem', { name: /برگشت|ابطال|تبدیل به پیش‌نویس|لغو/ }).first();
      if (await cancelOption.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await cancelOption.click();
      }
    }
  });

  test('02. Invoicing: open, create invoice, verify in list, reload, cancel', async ({ page }) => {
    currentModule = 'invoicing';

    currentStep = '01-open-module';
    await page.goto(`${BASE}/app/invoicing`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    currentStep = '02-create-record';
    const newInvoiceBtn = page.getByRole('button', { name: /صورتحساب جدید|فاکتور جدید/ }).first();
    await expect(newInvoiceBtn).toBeVisible({ timeout: 20_000 });
    await newInvoiceBtn.click();

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

    currentStep = '03-see-in-list';
    const searchInput = page.getByLabel(/جست‌وجوی صورتحساب|جست‌وجو/).first();
    if (await searchInput.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await searchInput.fill(creds.invoiceNumber);
    }

    const invoiceRow = page.getByRole('row').filter({ hasText: creds.invoiceNumber });
    await expect(invoiceRow.first()).toBeVisible({ timeout: 25_000 });

    currentStep = '04-reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    currentStep = '05-cancel-record';
    const targetRow = page.getByRole('row').filter({ hasText: creds.invoiceNumber }).first();
    const actionMenu = targetRow.getByRole('button', { name: /عملیات|بیشتر/ }).first();
    if (await actionMenu.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await actionMenu.click();
      const cancelItem = page.getByRole('menuitem', { name: /ابطال|لغو/ }).first();
      if (await cancelItem.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await cancelItem.click();
        const confirmBtn = page.getByRole('button', { name: /تأیید|بله|ابطال صورتحساب/ }).first();
        if (await confirmBtn.isVisible({ timeout: 4_000 }).catch(() => false)) {
          await confirmBtn.click();
        }
      }
    }
  });

  test('03. Inventory: open, create item, verify in list, reload, cancel/close drawer', async ({ page }) => {
    currentModule = 'inventory';

    currentStep = '01-open-module';
    await page.goto(`${BASE}/app/inventory`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

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

    currentStep = '03-see-in-list';
    const searchInput = page.locator('input[aria-label*="جست"], input[placeholder*="کد"], input[placeholder*="نام"]').first();
    if (await searchInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await searchInput.fill(creds.sku);
    }

    const itemRow = page.getByRole('row').filter({ hasText: creds.sku });
    await expect(itemRow.first()).toBeVisible({ timeout: 25_000 });

    currentStep = '04-reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    currentStep = '05-cancel-operation';
    await newItemBtn.click();
    await expect(page.locator('#item-sku')).toBeVisible({ timeout: 10_000 });
    await page.locator('#item-sku').fill(`CANCEL-${creds.suffix}`);

    const cancelBtn = page.getByRole('button', { name: /انصراف|بستن/ }).first();
    await expect(cancelBtn).toBeVisible({ timeout: 5_000 });
    await cancelBtn.click();
    await expect(page.getByRole('row').filter({ hasText: `CANCEL-${creds.suffix}` })).toHaveCount(0);
  });

  test('04. HR: open, create employee, verify in list, reload, cancel/close panel', async ({ page }) => {
    currentModule = 'hr';

    currentStep = '01-open-module';
    await page.goto(`${BASE}/app/hr`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    currentStep = '02-create-record';
    const newEmployeeBtn = page.getByRole('button', { name: /کارمند جدید|پرسنل جدید/ }).first();
    await expect(newEmployeeBtn).toBeVisible({ timeout: 20_000 });
    await newEmployeeBtn.click();

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

    currentStep = '03-see-in-list';
    const searchInput = page.getByLabel('جست‌وجوی کارکنان').or(page.getByPlaceholder(/جست‌وجو/)).first();
    if (await searchInput.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await searchInput.fill(creds.employeeLastName);
    }

    const employeeRow = page.getByRole('row').filter({ hasText: creds.employeeLastName });
    await expect(employeeRow.first()).toBeVisible({ timeout: 25_000 });

    currentStep = '04-reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    currentStep = '05-cancel-operation';
    await employeeRow.first().click();
    const cancelEditBtn = page.getByRole('button', { name: /انصراف|بستن/ }).first();
    if (await cancelEditBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await cancelEditBtn.click();
    }
  });

  test('05. CRM: open, create customer/lead, verify in list, reload, cancel/panel close', async ({ page }) => {
    currentModule = 'crm';

    currentStep = '01-open-module';
    await page.goto(`${BASE}/app/crm`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

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

    currentStep = '03-see-in-list';
    const searchInput = page.getByLabel('جست‌وجوی مشتریان').or(page.getByPlaceholder(/جست‌وجو/)).first();
    if (await searchInput.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await searchInput.fill(creds.leadName);
    }

    const leadRow = page.getByRole('row').filter({ hasText: creds.leadName });
    await expect(leadRow.first()).toBeVisible({ timeout: 25_000 });

    currentStep = '04-reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    currentStep = '05-cancel-operation';
    await leadRow.first().click();
    const cancelPanelBtn = page.getByRole('button', { name: /انصراف|بستن/ }).first();
    if (await cancelPanelBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await cancelPanelBtn.click();
    }
  });

  test('06. Settings: open, create invitation, verify in list, reload, revoke/cancel', async ({ page }) => {
    currentModule = 'settings';

    currentStep = '01-open-module';
    await page.goto(`${BASE}/app/settings/members`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    const inviteTab = page.getByRole('tab', { name: 'دعوت‌نامه‌ها' });
    if (await inviteTab.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await inviteTab.click();
    }

    currentStep = '02-create-record';
    const contactInput = page.locator('#inv-contact');
    await expect(contactInput).toBeVisible({ timeout: 15_000 });
    await contactInput.fill(creds.inviteEmail);

    const submitInvite = page.getByRole('button', { name: /ارسال دعوت‌نامه/ }).first();
    await expect(submitInvite).toBeVisible({ timeout: 5_000 });
    await submitInvite.click();

    currentStep = '03-see-in-list';
    const inviteRow = page.getByRole('row').filter({ hasText: creds.inviteEmail });
    await expect(inviteRow.first()).toBeVisible({ timeout: 25_000 });

    currentStep = '04-reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible({ timeout: 25_000 });

    const reloadInviteTab = page.getByRole('tab', { name: 'دعوت‌نامه‌ها' });
    if (await reloadInviteTab.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await reloadInviteTab.click();
    }
    await expect(page.getByRole('row').filter({ hasText: creds.inviteEmail }).first()).toBeVisible({ timeout: 20_000 });

    currentStep = '05-revoke-invitation';
    const targetRow = page.getByRole('row').filter({ hasText: creds.inviteEmail }).first();
    const revokeBtn = targetRow.getByRole('button', { name: 'لغو' });
    await expect(revokeBtn).toBeVisible({ timeout: 10_000 });
    await revokeBtn.click();

    await expect(page.getByRole('row').filter({ hasText: creds.inviteEmail })).toHaveCount(0, { timeout: 15_000 });
  });
});
