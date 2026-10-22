import { test, expect, openApp, expectNoErrorNotice, parseFa } from './fixtures';

/**
 * /app/accounting on the seeded tenant (the data_import fixture was imported by sandbox_up.sh):
 * 31 chart-of-accounts rows, a balanced trial balance and no error notice.
 */
test('accounting page lists the 31 imported accounts with a balanced trial balance', async ({ page }) => {
  await openApp(page, '/app/accounting');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('حساب');

  const accountsCard = page.locator('[data-slot="card"]').filter({ has: page.getByText('سرفصل حساب‌ها', { exact: true }) });
  await expect(accountsCard).toBeVisible();
  await expect(accountsCard.locator('tbody tr')).toHaveCount(31);

  // «وضعیت تراز دفاتر» says «تراز» (balanced), not «ناتراز».
  const balance = page.locator('[data-slot="card"]').filter({ hasText: 'وضعیت تراز دفاتر' });
  await expect(balance).toBeVisible();
  await expect(balance).toContainText('تراز');
  await expect(balance).not.toContainText('ناتراز');

  // Debit and credit totals are both present and non-zero.
  for (const label of ['جمع بدهکار کل', 'جمع بستانکار کل']) {
    const card = page.locator('[data-slot="card"]').filter({ hasText: label });
    await expect(card).toBeVisible();
    expect(parseFa((await card.innerText()).replace(label, '')), `${label} is not zero`).toBeGreaterThan(0);
  }

  // The trial balance table is rendered too.
  await expect(page.getByRole('heading', { name: /تراز آزمایشی/ })).toBeVisible();

  await expectNoErrorNotice(page);
  await expect(page.getByText('خطا در دریافت اطلاعات دفتر کل')).toHaveCount(0);
});
