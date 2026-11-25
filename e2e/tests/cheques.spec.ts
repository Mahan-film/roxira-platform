import { test, expect, findSessionFile, loginAsTestTenant, expectNoErrorNotice } from '../app/fixtures';

/**
 * CHK-01 follow-up (issue #376): Playwright E2E spec for the cheques pages (`/app/cheques`).
 *
 * Drives the real ChequesView components (`cheques-view.tsx`, `cheque-form.tsx`, `cheques-list.tsx`,
 * `cheque-reports.tsx`, `cheque-recon.tsx`) against the local sandbox stack:
 *  1. Log in as the seeded test tenant and open `/app/cheques`.
 *  2. Create a received cheque (Jalali dates, 16-digit Sayad id, receiver national id) and verify it appears.
 *  3. Click «تأیید دستی صیاد» and verify the row records who verified it.
 *  4. Click «واگذاری به بانک», record a 30% «پرداخت بخشی» and verify «مانده», then clear via «وصول شد».
 *  5. Create an issued cheque, transition «تحویل به ذی‌نفع» -> «برگشت خورد», open «چک‌های برگشتی» and verify bucket «تا ۳۰ روز».
 *  6. Open «سررسیدها» and «تطبیق با بانک» with zero page/console errors or error notices.
 *
 * Usage:
 *   cd e2e && npx playwright test tests/cheques.spec.ts                 # offline self-check runs; browser steps skip without sandbox
 *   E2E_BASE_URL=http://127.0.0.1:3001 APP_E2E_SESSION_FILE=<file> npx playwright test tests/cheques.spec.ts
 */

const RECEIVED_SAYAD_ID = '1234567890123456';
const RECEIVER_NATIONAL_ID = '0499370899';
const RECEIVED_AMOUNT_RIAL = 10_000_000n;
const PARTIAL_PAYMENT_RIAL = (RECEIVED_AMOUNT_RIAL * 30n) / 100n; // 30% = 3,000,000
const EXPECTED_REMAINING_RIAL = RECEIVED_AMOUNT_RIAL - PARTIAL_PAYMENT_RIAL; // 7,000,000
const ISSUED_AMOUNT_RIAL = 5_000_000n;

const ISSUE_DATE_JALALI = '1405/08/10';
const DUE_DATE_JALALI = '1405/10/10';

function isValidSayad16(value: string): boolean {
  return /^\d{16}$/.test(value) && !/^(\d)\1{15}$/.test(value);
}

function isValidNationalCode10(value: string): boolean {
  if (!/^\d{10}$/.test(value) || /^(\d)\1{9}$/.test(value)) return false;
  const digits = value.split('').map(Number);
  const sum = digits.slice(0, 9).reduce((acc, d, idx) => acc + d * (10 - idx), 0);
  const rem = sum % 11;
  return (rem < 2 ? rem : 11 - rem) === digits[9];
}

// -----------------------------------------------------------------------------
// Offline self-check: no server, no browser.
// -----------------------------------------------------------------------------

test.describe('CHK-01 cheques · fixture self-check', () => {
  test('fixture Sayad id, national id, and 30% partial payment arithmetic are valid', () => {
    expect(isValidSayad16(RECEIVED_SAYAD_ID)).toBe(true);
    expect(isValidNationalCode10(RECEIVER_NATIONAL_ID)).toBe(true);
    expect(PARTIAL_PAYMENT_RIAL).toBe(3_000_000n);
    expect(EXPECTED_REMAINING_RIAL).toBe(7_000_000n);
    expect(PARTIAL_PAYMENT_RIAL + EXPECTED_REMAINING_RIAL).toBe(RECEIVED_AMOUNT_RIAL);
  });
});

// -----------------------------------------------------------------------------
// Live browser E2E against the local sandbox stack (writes data: loopback only).
// -----------------------------------------------------------------------------

test.describe('CHK-01 cheques · end-to-end UI flow (/app/cheques)', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ sessionKind: 'seeded' });

  const runSuffix = String(Date.now()).slice(-6);
  const receivedChequeNumber = `CHK-RCV-${runSuffix}`;
  const issuedChequeNumber = `CHK-ISS-${runSuffix}`;

  test.beforeEach(({ baseURL }, testInfo) => {
    testInfo.skip(
      !findSessionFile('seeded', testInfo.project.name),
      'no sandbox session: set APP_E2E_SESSION_FILE (scripts/infra/e2e/sandbox_up.sh)',
    );
    const host = baseURL ? new URL(baseURL).hostname : '';
    testInfo.skip(
      !['127.0.0.1', 'localhost'].includes(host) && process.env.M1_E2E_ALLOW_REMOTE !== '1',
      `cheques E2E writes data; refusing ${baseURL ?? 'no baseURL'} (set E2E_BASE_URL to localhost)`,
    );
  });

  test('01 open /app/cheques as seeded tenant with tabs and no errors', async ({ page }) => {
    await loginAsTestTenant(page, '/app/cheques');
    await expect(page.getByRole('heading', { name: 'چک‌ها' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'دریافتی' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'پرداختنی' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'فهرست چک‌ها' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'سررسیدها' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'چک‌های برگشتی' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'تطبیق با بانک' })).toBeVisible();
    await expectNoErrorNotice(page);
  });

  test('02 create received cheque, verify Sayad manually, deposit, 30% partial pay, and clear', async ({ page }) => {
    await loginAsTestTenant(page, '/app/cheques');

    // Open form and create a received cheque
    await page.getByRole('button', { name: 'ثبت چک' }).click();
    await expect(page.getByText('چک جدید')).toBeVisible();

    await page.getByLabel('نوع چک').selectOption('received');
    await page.getByLabel('صادرکننده (مشتری)').fill('مشتری آزمایشی چک');
    await page.getByLabel('شناسه صیاد (۱۶ رقم، اختیاری)').fill(RECEIVED_SAYAD_ID);
    await page.getByLabel('کد ملی / شناسه ملی دریافت‌کننده (اختیاری)').fill(RECEIVER_NATIONAL_ID);
    await page.getByLabel('شماره سری چک').fill(receivedChequeNumber);
    await page.getByLabel('بانک').fill('بانک ملت');
    await page.getByLabel('مبلغ (ریال)').fill(RECEIVED_AMOUNT_RIAL.toString());
    await page.getByLabel('تاریخ صدور (شمسی)').fill(ISSUE_DATE_JALALI);
    await page.getByLabel('تاریخ سررسید (شمسی)').fill(DUE_DATE_JALALI);

    await page.getByRole('button', { name: 'ثبت چک و سند حسابداری' }).click();
    await expect(page.getByText('چک ثبت و سند حسابداری آن صادر شد.')).toBeVisible();

    const row = page.locator('tbody tr', { hasText: receivedChequeNumber });
    await expect(row).toBeVisible();
    await expect(row).toContainText(RECEIVED_SAYAD_ID);
    await expect(row).toContainText('نزد صندوق');

    // Manual Sayad verification
    await row.getByRole('button', { name: 'تأیید دستی صیاد' }).click();
    await expect(row).toContainText('تأییدشده دستی توسط');

    // Deposit to bank
    await row.getByRole('button', { name: 'واگذاری به بانک' }).click();
    await expect(row).toContainText('در جریان وصول');

    // 30% partial payment
    await row.getByRole('button', { name: 'پرداخت بخشی' }).click();
    await row.getByLabel('مبلغ پرداخت بخشی').fill(PARTIAL_PAYMENT_RIAL.toString());
    await row.getByRole('button', { name: 'ثبت پرداخت بخشی' }).click();
    await expect(row).toContainText('مانده');

    // Clear remaining amount
    await row.getByRole('button', { name: 'وصول شد' }).click();
    await row.getByRole('button', { name: 'ثبت وصول شد' }).click();
    await expect(row).toContainText('وصول‌شده');

    await expectNoErrorNotice(page);
  });

  test('03 create issued cheque, deliver, bounce, and verify in bounced bucket «تا ۳۰ روز»', async ({ page }) => {
    await loginAsTestTenant(page, '/app/cheques');

    // Switch to issued direction tab and create issued cheque
    await page.getByRole('tab', { name: 'پرداختنی' }).click();
    await page.getByRole('button', { name: 'ثبت چک' }).click();
    await expect(page.getByText('چک جدید')).toBeVisible();

    await page.getByLabel('نوع چک').selectOption('issued');
    await page.getByLabel('ذی‌نفع').fill('تأمین‌کننده آزمایشی چک');
    await page.getByLabel('شماره سری چک').fill(issuedChequeNumber);
    await page.getByLabel('بانک').fill('بانک ملی');
    await page.getByLabel('مبلغ (ریال)').fill(ISSUED_AMOUNT_RIAL.toString());
    await page.getByLabel('تاریخ صدور (شمسی)').fill(ISSUE_DATE_JALALI);
    await page.getByLabel('تاریخ سررسید (شمسی)').fill(DUE_DATE_JALALI);

    await page.getByRole('button', { name: 'ثبت چک و سند حسابداری' }).click();
    await expect(page.getByText('چک ثبت و سند حسابداری آن صادر شد.')).toBeVisible();

    const row = page.locator('tbody tr', { hasText: issuedChequeNumber });
    await expect(row).toBeVisible();

    // Deliver to payee -> bounce
    await row.getByRole('button', { name: 'تحویل به ذی‌نفع' }).click();
    await expect(row).toContainText('تحویل‌شده به ذی‌نفع');

    await row.getByRole('button', { name: 'برگشت خورد' }).click();
    await expect(row).toContainText('برگشتی');

    // Open bounced tab and assert bucket «تا ۳۰ روز» and the bounced cheque
    await page.getByRole('tab', { name: 'چک‌های برگشتی' }).click();
    await expect(page.getByText('تا ۳۰ روز')).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: issuedChequeNumber })).toBeVisible();

    await expectNoErrorNotice(page);
  });

  test('04 open «سررسیدها» and «تطبیق با بانک» tabs with no page errors', async ({ page }) => {
    await loginAsTestTenant(page, '/app/cheques');

    await page.getByRole('tab', { name: 'سررسیدها' }).click();
    await expect(page.getByText('چک‌های سررسیدشونده')).toBeVisible();
    await expectNoErrorNotice(page);

    await page.getByRole('tab', { name: 'تطبیق با بانک' }).click();
    await expect(page.getByRole('button', { name: 'تطبیق همه موارد بی‌ابهام' })).toBeVisible();
    await expectNoErrorNotice(page);
  });
});
