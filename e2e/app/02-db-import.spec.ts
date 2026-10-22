import { test, expect, fixturePath, dragEventWithFile, fa, openApp, parseFa } from './fixtures';

/**
 * Whole-database import through the real UI: upload the erp_multicurrency_small.sqlite fixture on the
 * «انتقال کامل دیتابیس» tab, wait for the analysis, confirm «تأیید و انتقال» and check the result counts.
 *
 * Fixture contents (modules/data_import/__fixtures__/README.md): 31 accounts, 200 journal lines (100 balanced
 * vouchers), 307 parties, 150 items, 150 invoices, 150 CRM activities. Runs on a fresh, empty tenant per
 * browser project, so nothing is a duplicate. Accounts and journal lines are asserted exactly; the other
 * entities only need to be non-zero (their counts depend on duplicate detection in the importer).
 */
test.use({ sessionKind: 'import' });

test('imports the fixture database end to end and reports the inserted counts', async ({ page }) => {
  test.setTimeout(300_000);
  await openApp(page, '/app/import');
  await page.getByRole('tab', { name: 'انتقال کامل دیتابیس' }).click();
  await expect(page.getByRole('tab', { name: 'انتقال کامل دیتابیس' })).toHaveAttribute('aria-selected', 'true');

  // Upload by dropping the file on the package drop zone.
  const zone = page.locator('div.border-dashed').filter({ has: page.locator('#package-import-file') });
  await expect(zone).toBeVisible();
  await dragEventWithFile(page, zone, 'drop', fixturePath());

  // Analysis finished: the review step shows the detected tables, relationships and the health card.
  const confirm = page.getByRole('button', { name: /تأیید و انتقال/ });
  await expect(confirm).toBeVisible({ timeout: 120_000 });
  for (const table of ['tbl_Accounts_Coding', 'tbl_Sanad_Hesabdari_Riz', 'tbl_Moshtarian_Peymankaran', 'tbl_Kala_Anbar']) {
    await expect(page.getByText(table, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText('سلامت داده', { exact: true })).toBeVisible();
  await expect(page.getByText('انتقال دیتابیس انجام نشد')).toHaveCount(0);

  // Warnings (if the analysis raised any) need an explicit confirmation before the button enables.
  const warnConfirm = page.getByRole('checkbox', { name: /هشدارها را بررسی کردم/ });
  if (await warnConfirm.isVisible()) await warnConfirm.check();
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // Commit runs in the background and the page polls; wait for the success card.
  const done = page.locator('[data-slot="card"]').filter({ hasText: 'انتقال دیتابیس انجام شد' });
  await expect(done).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText('انتقال دیتابیس انجام نشد')).toHaveCount(0);

  const inserted = (label: string) => done.locator('div.rounded-lg').filter({ has: page.getByText(label, { exact: true }) });

  const accounts = inserted('حساب‌ها');
  await expect(accounts).toContainText(fa(31));
  const lines = inserted('ردیف اسناد حسابداری');
  await expect(lines).toContainText(fa(200));

  for (const label of ['سرنخ‌های CRM', 'کالاها', 'فاکتورهای فروش']) {
    const row = inserted(label);
    await expect(row, `${label} row`).toBeVisible();
    expect(parseFa((await row.innerText()).replace(label, '')), `${label} count`).toBeGreaterThan(0);
  }

  // The batch is recorded and listed under «ورودهای اخیر» so it can be undone.
  await expect(page.getByRole('cell', { name: 'erp_multicurrency_small.sqlite' }).first()).toBeVisible();
});
