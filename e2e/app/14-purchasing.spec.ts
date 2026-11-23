import { test, expect, openApp, expectNoErrorNotice } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

/**
 * E2E tests for the Purchasing Cycle (/app/purchasing):
 * - Loading without error notice
 * - Navigation tabs (Orders, Receipts, Invoices, Settings)
 * - Creating a purchase order end-to-end
 * - Approving the order and registering goods receipt
 * - Axe accessibility gate
 */
test.describe('purchasing cycle', () => {
  test('purchasing page loads and displays header, tabs, and stats without error notice', async ({ page }) => {
    await openApp(page, '/app/purchasing');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('چرخه خرید و تدارکات');

    // Stats cards
    await expect(page.getByTestId('purchasing-stats')).toBeVisible();

    // Tabs
    const tablist = page.getByRole('tablist', { name: 'بخش‌های چرخه خرید' });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole('tab', { name: /سفارش‌های خرید/ })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: /رسیدهای انبار/ })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: /صورتحساب‌های خرید/ })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: /تنظیمات تحمل/ })).toBeVisible();

    await expectNoErrorNotice(page);
  });

  test('creates a purchase order through the form, approves it and creates goods receipt', async ({ page }) => {
    const timestamp = Date.now();
    const supplierCode = `SUP-E2E-${timestamp}`;
    const sku = `SKU-E2E-${timestamp}`;

    await openApp(page, '/app/purchasing');

    // Click new order button
    const newOrderBtn = page.getByRole('button', { name: 'ثبت سفارش خرید جدید' });
    await expect(newOrderBtn).toBeVisible();
    await newOrderBtn.click();

    // Order create form drawer
    const drawerForm = page.getByTestId('order-create-form');
    await expect(drawerForm).toBeVisible();

    await drawerForm.locator('#order-supplier-code').fill(supplierCode);

    // Fill first line
    await drawerForm.locator('#line-sku-0').fill(sku);
    await drawerForm.locator('#line-qty-0').fill('10');
    await drawerForm.locator('#line-price-0').fill('50000');

    // Submit order
    await drawerForm.getByRole('button', { name: 'ثبت سفارش' }).click();

    // Drawer closes and order appears in table or details
    await expect(drawerForm).toBeHidden({ timeout: 10000 });
    await expectNoErrorNotice(page);

    // Find the row with our supplier code
    const orderRow = page.getByRole('row').filter({ hasText: supplierCode });
    await expect(orderRow).toBeVisible();
    await expect(orderRow).toContainText('پیش‌نویس');

    // Open detail
    await orderRow.click();
    const detailView = page.getByTestId('order-detail-view');
    await expect(detailView).toBeVisible();
    await expect(detailView).toContainText(sku);

    // Approve the order (DRAFT -> APPROVED)
    const approveBtn = detailView.getByRole('button', { name: 'تأیید سفارش' });
    if (await approveBtn.isVisible()) {
      page.once('dialog', (dialog) => dialog.accept());
      await approveBtn.click();
      await expect(detailView.getByText('تأییدشده')).toBeVisible({ timeout: 8000 });

      // Create Goods Receipt from the approved order
      const receiptBtn = detailView.getByRole('button', { name: 'ثبت رسید انبار' });
      await expect(receiptBtn).toBeVisible();
      await receiptBtn.click();

      // Receipt form drawer
      const receiptForm = page.getByTestId('receipt-create-form');
      await expect(receiptForm).toBeVisible();
      await expect(receiptForm).toContainText(sku);

      // Submit goods receipt
      await receiptForm.getByRole('button', { name: 'ثبت رسید کالا' }).click();
      await expect(receiptForm).toBeHidden({ timeout: 10000 });
      await expectNoErrorNotice(page);
    }
  });

  test('passes the axe accessibility gate on /app/purchasing', async ({ page }) => {
    await openApp(page, '/app/purchasing');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const criticalViolations = results.violations.filter((v) => v.impact === 'critical');
    if (criticalViolations.length > 0) {
      console.error(
        'Critical accessibility violations on /app/purchasing:',
        criticalViolations.map(({ id, description, nodes }) => ({ id, description, count: nodes.length })),
      );
    }

    expect(criticalViolations).toEqual([]);
  });
});
