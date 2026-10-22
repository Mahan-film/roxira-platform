import { test, expect, openApp, expectNoErrorNotice } from './fixtures';

/** /app/invoicing on the seeded tenant: the list loads, and an invoice can be created through the form. */
test.describe('invoices', () => {
  test('list page loads without an error notice', async ({ page }) => {
    await openApp(page, '/app/invoicing');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('صورتحساب');

    // Loaded state: the table with its columns (imported invoices exist) or the empty-tenant prompt.
    const table = page.getByRole('columnheader', { name: 'قابل پرداخت' });
    const emptyState = page.getByText('فایل اکسل فاکتورهای قبلی‌تان را اینجا رها کنید');
    await expect(table.or(emptyState)).toBeVisible();
    await expect(page.getByText('در حال بارگذاری...')).toHaveCount(0);

    await expect(page.getByText('خطا در عملیات صورتحساب')).toHaveCount(0);
    await expectNoErrorNotice(page);
  });

  test('creates a draft invoice through the form and finds it in the list', async ({ page }) => {
    const number = `TI-E2E-${Date.now()}`;
    await openApp(page, '/app/invoicing');
    await page.getByRole('button', { name: 'صورتحساب جدید' }).click();

    const editor = page.locator('[data-slot="card"]').filter({ hasText: 'صدور صورتحساب جدید' });
    await expect(editor).toBeVisible();

    await editor.locator('#invoice-number').fill(number);
    await editor.getByPlaceholder('نام فروشنده').fill('شرکت آزمون روکسیرا');
    await editor.getByPlaceholder('نام خریدار').fill('خریدار آزمایشی');

    const line = editor.locator('tbody tr').first();
    await line.getByPlaceholder('شرح کالا یا خدمت').fill('خدمات آزمایشی');
    // Numeric inputs in a line: quantity, unit price, discount, VAT %.
    await line.locator('input[inputmode="decimal"]').nth(1).fill('1000000');

    // The totals box recomputes live (10% VAT on 1,000,000 rial = 1,100,000 payable).
    await expect(editor.getByText('قابل پرداخت').last()).toBeVisible();

    await editor.getByRole('button', { name: 'صدور صورتحساب', exact: true }).click();

    // The editor closes on success, with no error alert from the API.
    await expect(editor).toBeHidden();
    await expect(page.getByText('خطا در ثبت صورتحساب')).toHaveCount(0);

    await page.getByLabel('جست‌وجوی صورتحساب').fill(number);
    const row = page.getByRole('row').filter({ hasText: number });
    await expect(row).toBeVisible();
    await expect(row).toContainText('خریدار آزمایشی');
    await expectNoErrorNotice(page);
  });
});
