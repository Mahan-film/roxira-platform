import { test, expect, expectNoErrorNotice, findSessionFile, loginAsTestTenant } from '../app/fixtures';
import type { Locator, Page } from '@playwright/test';

/**
 * CHK-01 follow-up (issue #376): click through the real cheques pages at /app/cheques.
 *
 * The pages themselves were covered by unit tests only (`src/lib/cheques-ui.test.ts`); this spec drives
 * them in a browser against the local stack the M1 gate uses (`scripts/infra/e2e/sandbox_up.sh`), in the
 * same style as `m1-shop-month.spec.ts`: the seeded test tenant, the shared login helper and the
 * page-error / console-error guard from `../app/fixtures`.
 *
 *   cd e2e
 *   set -a; source "${TMPDIR:-/tmp}/rxtest/out/app_e2e.env"; set +a
 *   npx playwright test tests/cheques.spec.ts
 *
 * The spec writes data, so it only runs against a loopback sandbox unless M1_E2E_ALLOW_REMOTE=1. In CI it
 * runs report-only inside the `m1-gate` job (continue-on-error), like the M1 gate itself.
 */

/** 16-digit Sayad id (not a repeated digit) used by the unit test for the same check. */
const RECEIVED_SAYAD = '1234567890123456';
/** Valid Iranian national id (`isValidNationalId("0499370899") === true`). */
const RECEIVER_NATIONAL_ID = '0499370899';
const RECEIVED_AMOUNT = '1000000';
/** 30% of RECEIVED_AMOUNT. */
const PARTIAL_AMOUNT = '300000';

/** The list/report row that carries this cheque number. */
function rowFor(page: Page, chequeNumber: string): Locator {
  return page.getByRole('row').filter({ hasText: chequeNumber });
}

interface NewCheque {
  direction: 'received' | 'issued';
  party: string;
  chequeNumber: string;
  amount: string;
  sayad?: string;
  receiverNationalId?: string;
}

/** Open «چک جدید», fill the form and wait until the new cheque shows up in the list. */
async function createCheque(page: Page, values: NewCheque): Promise<void> {
  await page.getByRole('button', { name: 'چک جدید' }).click();
  // The page has a single form; scope by its submit button so the locator stays unique.
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'ثبت چک و سند حسابداری' }) });
  await expect(form).toBeVisible();

  if (values.direction === 'issued') {
    await form.getByLabel('نوع چک').selectOption('issued');
  }
  // The party label depends on the direction: «صادرکننده (مشتری)» vs «ذی‌نفع».
  await form.getByLabel(/مشتری|ذی.?نفع/).fill(values.party);
  if (values.sayad) {
    await form.getByLabel(/شناسه صیاد/).fill(values.sayad);
  }
  if (values.receiverNationalId) {
    await form.getByLabel(/کد ملی/).fill(values.receiverNationalId);
  }
  await form.getByLabel(/شماره سری چک/).fill(values.chequeNumber);
  await form.getByLabel(/مبلغ \(ریال\)/).fill(values.amount);
  // «تاریخ صدور» is pre-filled with today (Jalali); reuse it so «تاریخ سررسید» is always valid (>= issue).
  const issue = await form.getByLabel(/تاریخ صدور/).inputValue();
  await form.getByLabel(/تاریخ سررسید/).fill(issue);

  await form.getByRole('button', { name: 'ثبت چک و سند حسابداری' }).click();
  await expect(rowFor(page, values.chequeNumber)).toBeVisible();
}

test.describe('cheques pages (CHK-01 follow-up, issue #376)', () => {
  // Runs before the test's own fixtures, so a missing session skips instead of failing in `context`.
  test.beforeEach(({ baseURL }, testInfo) => {
    testInfo.skip(
      !findSessionFile('seeded', testInfo.project.name),
      'no sandbox session: set APP_E2E_SESSION_FILE (scripts/infra/e2e/sandbox_up.sh)',
    );
    const host = baseURL ? new URL(baseURL).hostname : '';
    testInfo.skip(
      !['127.0.0.1', 'localhost'].includes(host) && process.env.M1_E2E_ALLOW_REMOTE !== '1',
      `the cheques spec writes data; refusing ${baseURL ?? 'no baseURL'} (set E2E_BASE_URL to the sandbox)`,
    );
  });

  test('received and issued cheque lifecycle, reports and tabs', async ({ page }) => {
    const stamp = Date.now().toString();
    const receivedChequeNumber = `CHK-R-${stamp}`;
    const issuedChequeNumber = `CHK-I-${stamp}`;

    await test.step('01 log in as the seeded test tenant and open /app/cheques', async () => {
      await loginAsTestTenant(page, '/app/cheques');
      await expect(page.getByRole('tab', { name: /چک.?های برگشتی/ })).toBeVisible();
    });

    await test.step('02 create a received cheque and expect it in the list', async () => {
      await createCheque(page, {
        direction: 'received',
        party: 'مشتری نمونه ۳۷۶',
        chequeNumber: receivedChequeNumber,
        amount: RECEIVED_AMOUNT,
        sayad: RECEIVED_SAYAD,
        receiverNationalId: RECEIVER_NATIONAL_ID,
      });
      const row = rowFor(page, receivedChequeNumber);
      await expect(row).toContainText(RECEIVED_SAYAD);
      await expect(row).toContainText(RECEIVER_NATIONAL_ID);
    });

    await test.step('03 verify the Sayad id manually and see who verified it', async () => {
      const row = rowFor(page, receivedChequeNumber);
      await row.getByRole('button', { name: 'تأیید دستی صیاد' }).click();
      // The row records the verifying user («تأییدشده دستی توسط <کاربر>»).
      await expect(row).toContainText(/تأییدشده دستی توسط/);
    });

    await test.step('04 deposit, pay 30% in part, then clear the received cheque', async () => {
      const row = rowFor(page, receivedChequeNumber);

      await row.getByRole('button', { name: 'واگذاری به بانک' }).click();
      await expect(row).toContainText('در جریان وصول');

      await row.getByRole('button', { name: 'پرداخت بخشی' }).click();
      await row.getByLabel('مبلغ پرداخت بخشی').fill(PARTIAL_AMOUNT);
      await row.getByRole('button', { name: 'ثبت پرداخت بخشی' }).click();
      await expect(row).toContainText('مانده');

      await row.getByRole('button', { name: 'وصول شد' }).click();
      await expect(row).toContainText(/وصول.?شده/);
    });

    await test.step('05 issued cheque: deliver, bounce, then find it in the «تا ۳۰ روز» bucket', async () => {
      await createCheque(page, {
        direction: 'issued',
        party: 'تأمین‌کننده نمونه ۳۷۶',
        chequeNumber: issuedChequeNumber,
        amount: RECEIVED_AMOUNT,
      });
      const row = rowFor(page, issuedChequeNumber);

      await row.getByRole('button', { name: /تحویل به ذی.?نفع/ }).click();
      await expect(row).toContainText(/تحویل.?شده به ذی.?نفع/);

      await row.getByRole('button', { name: 'برگشت خورد' }).click();
      await expect(row).toContainText('برگشتی');

      await page.getByRole('tab', { name: /چک.?های برگشتی/ }).click();
      await expect(page.getByText('تا ۳۰ روز', { exact: true }).first()).toBeVisible();
      await expect(rowFor(page, issuedChequeNumber)).toBeVisible();
    });

    await test.step('06 open «سررسیدها» and «تطبیق با بانک» with no page error', async () => {
      await page.getByRole('tab', { name: 'سررسیدها' }).click();
      await expect(page.getByText(/چک.?های سررسید.?شونده/).first()).toBeVisible();

      await page.getByRole('tab', { name: 'تطبیق با بانک' }).click();
      await expect(page.getByText(/وصول چک.?ها/).first()).toBeVisible();
      await expect(page.getByLabel('حساب بانکی')).toBeVisible();

      await expectNoErrorNotice(page);
    });
  });
});
