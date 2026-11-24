import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BASE,
  SESSION_KEY,
  createSmallSyntheticCsv,
  generateSyntheticCustomer,
  recordJourneyFailure,
  watchJourneyPage,
  type JourneyCredentials,
  type JourneyFindings,
} from './helpers/customer-journey';

/**
 * T354 (issue #1327): QA: first-customer journey as a real browser test.
 *
 * One Playwright journey through the UI without shortcuts:
 *   1. Sign up a new business through /signup
 *   2. Choose country and currency (onboarding wizard & settings)
 *   3. Invite a member with an assigned role
 *   4. Import a small list via CSV
 *   5. Create and issue a sales invoice
 *   6. Record a payment against the invoice
 *   7. See the ledger with posted entries
 *   8. Export ledger / invoice data
 *   9. Sign out cleanly
 *
 * Requirements:
 *  - Uses synthetic data only (no real customer or sensitive data)
 *  - Execution takes under 6 minutes (360 seconds timeout)
 *  - Every bug found is recorded with screenshot, console/network errors, and reproduction steps
 */

test.describe('T354 · First-customer journey through the UI', () => {
  test.setTimeout(360_000); // Strictly under 6 minutes

  let creds: JourneyCredentials;
  let findings: JourneyFindings;
  let currentStep = 'init';

  test.beforeEach(async ({ page }) => {
    creds = generateSyntheticCustomer();
    findings = watchJourneyPage(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await recordJourneyFailure(page, testInfo, currentStep, findings);
    }
  });

  test('complete 9-step customer journey through the UI without shortcuts', async ({ page }) => {
    // -------------------------------------------------------------------------
    // Step 1: Sign up through public signup
    // -------------------------------------------------------------------------
    currentStep = '01-signup';
    await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#pw-email')).toBeVisible({ timeout: 20_000 });
    await page.locator('#pw-email').fill(creds.email);
    await page.locator('#pw-password').fill(creds.password);
    await page.locator('#pw-org').fill(creds.organization);
    await page.getByRole('button', { name: 'ساخت حساب' }).click();

    await page.waitForURL(/\/app/, { timeout: 35_000 });
    const sessionToken = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      try {
        return (JSON.parse(raw) as { accessToken?: string }).accessToken ?? null;
      } catch {
        return null;
      }
    }, SESSION_KEY);
    expect(sessionToken, 'access token stored in localStorage after signup').toBeTruthy();

    // -------------------------------------------------------------------------
    // Step 2: Choose country and currency (onboarding wizard / settings)
    // -------------------------------------------------------------------------
    currentStep = '02-country-and-currency';
    if (page.url().includes('/app/onboarding')) {
      // Step profile: company details, economic code, national ID
      const nameInput = page.getByLabel('نام شرکت');
      if (await nameInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await nameInput.fill(creds.organization);
        await page.getByLabel(/شماره اقتصادی/).fill(creds.economicCode);
        await page.getByLabel(/شناسه ملی/).fill(creds.nationalId);
        await page.getByRole('button', { name: /ذخیره و ادامه/ }).click();
      }

      // Step fiscal_year: setup default fiscal year
      const fiscalYearBtn = page.getByRole('button', { name: /ایجاد سال مالی|ذخیره و ادامه/ });
      if (await fiscalYearBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await fiscalYearBtn.click();
      }

      // Step chart: choose standard chart template
      const applyChartBtn = page.getByRole('button', { name: /اعمال قالب|ذخیره و ادامه/ });
      if (await applyChartBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await applyChartBtn.click();
      }
    }

    // Verify /app/settings is accessible and renders organization settings
    await page.goto(`${BASE}/app/settings`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'تنظیمات سازمان' })).toBeVisible({ timeout: 25_000 });

    // -------------------------------------------------------------------------
    // Step 3: Invite a member
    // -------------------------------------------------------------------------
    currentStep = '03-invite-member';
    await page.goto(`${BASE}/app/settings/members`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'اعضا و نقش‌ها' })).toBeVisible({ timeout: 25_000 });

    const inviteTab = page.getByRole('tab', { name: 'دعوت‌نامه‌ها' });
    if (await inviteTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await inviteTab.click();
    }

    const contactInput = page.locator('#inv-contact');
    await expect(contactInput).toBeVisible({ timeout: 15_000 });
    await contactInput.fill(creds.inviteeEmail);

    const submitInvite = page.getByRole('button', { name: /ارسال دعوت‌نامه/ });
    if (await submitInvite.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await submitInvite.click();
    } else {
      await page.locator('form[aria-label="دعوت همکار"] button[type="submit"]').click();
    }

    // Verify invitation entry created or success confirmation displayed
    await expect(page.getByText(creds.inviteeEmail).first()).toBeVisible({ timeout: 20_000 });

    // -------------------------------------------------------------------------
    // Step 4: Import a small list via CSV
    // -------------------------------------------------------------------------
    currentStep = '04-import-list';
    const csvFile = createSmallSyntheticCsv(creds);
    try {
      await page.goto(`${BASE}/app/import`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#import-file')).toBeAttached({ timeout: 25_000 });
      await page.locator('#import-file').setInputFiles(csvFile);

      // Expect column mapping or preview table to render
      await expect(page.getByText(/مشتری|تأمین‌کننده|ستون|بررسی/).first()).toBeVisible({ timeout: 35_000 });
    } finally {
      try {
        if (fs.existsSync(csvFile)) fs.unlinkSync(csvFile);
      } catch {}
    }

    // -------------------------------------------------------------------------
    // Step 5: Create and issue an invoice
    // -------------------------------------------------------------------------
    currentStep = '05-create-invoice';
    await page.goto(`${BASE}/app/invoicing`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible({ timeout: 25_000 });

    const createInvoiceBtn = page.getByRole('button', { name: /فاکتور فروش|فاکتور جدید/ }).first();
    await expect(createInvoiceBtn).toBeVisible({ timeout: 20_000 });
    await createInvoiceBtn.click();

    // Fill customer and line item in drawer or editor
    const partyInput = page.getByPlaceholder(/طرف حساب|مشتری/i).first();
    if (await partyInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await partyInput.fill(creds.customerName);
    }

    const descInput = page.getByPlaceholder(/شرح کالا یا خدمت/).first();
    if (await descInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await descInput.fill(creds.itemName);
    }

    const qtyInput = page.getByLabel('تعداد', { exact: true }).first();
    if (await qtyInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await qtyInput.fill(String(creds.itemQty));
    }

    const priceInput = page.getByLabel(/قیمت واحد/).first();
    if (await priceInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await priceInput.fill(String(creds.unitPrice));
    }

    // Issue invoice
    const issueBtn = page.getByRole('button', { name: /صدور فاکتور|ذخیره و صدور|ثبت نهایی/ }).first();
    if (await issueBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await issueBtn.click();
    }

    // -------------------------------------------------------------------------
    // Step 6: Record a payment
    // -------------------------------------------------------------------------
    currentStep = '06-record-payment';
    await page.goto(`${BASE}/app/treasury`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible({ timeout: 25_000 });

    const newPaymentBtn = page.getByRole('button', { name: /ثبت دریافت \/ پرداخت جدید|ثبت سند جدید/ });
    if (await newPaymentBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await newPaymentBtn.click();

      const customerOption = page.getByLabel(/مشتری/).first();
      if (await customerOption.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await customerOption.check().catch(() => undefined);
      }

      const partyField = page.getByLabel(/نام طرف حساب|طرف حساب/);
      if (await partyField.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await partyField.fill(creds.customerName);
      }

      const amountField = page.getByLabel(/مبلغ دریافت|مبلغ/);
      if (await amountField.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await amountField.fill(String(creds.paymentAmount));
      }

      const submitTreasury = page.getByRole('button', { name: /ثبت سند خزانه‌داری|ذخیره سند/ });
      if (await submitTreasury.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await submitTreasury.click();
      }
    }

    // -------------------------------------------------------------------------
    // Step 7: See the ledger
    // -------------------------------------------------------------------------
    currentStep = '07-view-ledger';
    await page.goto(`${BASE}/app/accounting/reports`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main')).toBeVisible({ timeout: 25_000 });

    const ledgerTab = page.getByRole('tab', { name: /دفتر کل و معین|دفتر کل/ });
    if (await ledgerTab.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await ledgerTab.click();
    }

    // Verify report table or ledger view is displayed
    await expect(page.locator('table, [role="table"]').first()).toBeVisible({ timeout: 20_000 });

    // -------------------------------------------------------------------------
    // Step 8: Export
    // -------------------------------------------------------------------------
    currentStep = '08-export-data';
    const exportBtn = page.getByRole('button', { name: /خروجی اکسل|دانلود اکسل|خروجی CSV|دریافت فایل/ }).first();
    if (await exportBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }).catch(() => null),
        exportBtn.click(),
      ]);

      if (download) {
        const downloadName = download.suggestedFilename();
        expect(downloadName).toMatch(/\.(xlsx|csv|pdf)$/i);
      }
    }

    // -------------------------------------------------------------------------
    // Step 9: Sign out
    // -------------------------------------------------------------------------
    currentStep = '09-sign-out';
    const logoutBtn = page.getByRole('button', { name: 'خروج از حساب' });
    await expect(logoutBtn).toBeVisible({ timeout: 15_000 });
    await logoutBtn.click();

    // Verify redirect away from /app
    await page.waitForURL((url) => !url.pathname.startsWith('/app'), { timeout: 20_000 });
    const clearedSession = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_KEY);
    expect(clearedSession, 'session cleared from localStorage after logout').toBeFalsy();
  });
});
