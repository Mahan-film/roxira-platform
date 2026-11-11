import { test, expect, openApp, expectNoErrorNotice } from './fixtures';

/**
 * E2E tests for the Report Builder and Combined Reports page (/app/accounting/report-builder):
 * - Renders the page with available datasets: accounting_ledger, invoices_sales, and combined_sales_accounting
 * - Allows dataset selection, column selection, dynamic filtering, and query execution
 * - Exposes Excel and PDF export capabilities with CSV/formula-injection protection
 */
test.describe('Report Builder (/app/accounting/report-builder)', () => {
  test('renders dataset selector, columns, and filter builder without error notices', async ({ page }) => {
    await openApp(page, '/app/accounting/report-builder');

    // Page header and title
    await expect(page.getByRole('heading', { level: 1 })).toContainText('گزارش‌ساز سفارشی و گزارش‌های تلفیقی');

    // Available dataset buttons
    const ledgerBtn = page.getByRole('button', { name: /دفتر کل و اسناد حسابداری/ });
    const invoicesBtn = page.getByRole('button', { name: /فاکتورهای فروش/ });
    const combinedBtn = page.getByRole('button', { name: /گزارش تلفیقی فروش و حسابداری/ });

    await expect(ledgerBtn).toBeVisible();
    await expect(invoicesBtn).toBeVisible();
    await expect(combinedBtn).toBeVisible();

    // Default dataset is accounting_ledger: column labels should be rendered
    await expect(page.getByText('تاریخ سند')).toBeVisible();
    await expect(page.getByText('شماره سند')).toBeVisible();
    await expect(page.getByText('کد حساب').first()).toBeVisible();

    // Filter controls
    const addFilterBtn = page.getByRole('button', { name: /افزودن فیلتر/ });
    await expect(addFilterBtn).toBeVisible();
    await addFilterBtn.click();

    // A filter row should appear with column selector and operator
    const filterSelect = page.locator('select').first();
    await expect(filterSelect).toBeVisible();

    // Query run button
    const runBtn = page.getByRole('button', { name: /اجرای گزارش/ });
    await expect(runBtn).toBeVisible();

    // Export buttons
    await expect(page.getByRole('button', { name: /خروجی اکسل/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /خروجی PDF/ })).toBeVisible();

    // Switching to combined sales-accounting dataset
    await combinedBtn.click();
    await expect(page.getByText('اتصال مستقیم فاکتورهای فروش به اسناد حسابداری')).toBeVisible();
    await expect(page.getByText('شماره فاکتور')).toBeVisible();
    await expect(page.getByText('شماره سند حسابداری')).toBeVisible();

    await expectNoErrorNotice(page);
  });

  test('executes a report query and displays the results table', async ({ page }) => {
    await openApp(page, '/app/accounting/report-builder');

    const runBtn = page.getByRole('button', { name: /اجرای گزارش/ });
    await expect(runBtn).toBeVisible();
    await runBtn.click();

    // The results table or empty results card should be rendered
    const tableOrNotice = page.locator('div').filter({ hasText: /نتایج گزارش/ }).or(page.locator('table'));
    await expect(tableOrNotice.first()).toBeVisible({ timeout: 10000 });

    await expectNoErrorNotice(page);
  });
});
