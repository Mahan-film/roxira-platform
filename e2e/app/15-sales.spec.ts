import { test, expect, openApp, expectNoErrorNotice } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

/**
 * E2E tests for the Sales Cycle (/app/sales):
 * - Loading without error notice
 * - Navigation tabs (Orders, Quotations, Deliveries, Price Tiers)
 * - Creating a sales order end-to-end
 * - Axe accessibility gate
 */
test.describe('sales cycle', () => {
  test('sales page loads and displays header, tabs, and stats without error notice', async ({ page }) => {
    await openApp(page, '/app/sales');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('چرخه فروش');

    // Stats cards
    await expect(page.getByTestId('sales-stats')).toBeVisible();

    // Tabs
    await expect(page.getByTestId('tab-orders')).toBeVisible();
    await expect(page.getByTestId('tab-quotations')).toBeVisible();
    await expect(page.getByTestId('tab-deliveries')).toBeVisible();
    await expect(page.getByTestId('tab-price-tiers')).toBeVisible();

    await expectNoErrorNotice(page);
  });

  test('creates a sales order through the form and opens detail view', async ({ page }) => {
    const timestamp = Date.now();
    const partyCode = `CUST-${timestamp}`;

    await openApp(page, '/app/sales');

    // Click new sales order button
    const newOrderBtn = page.getByTestId('create-sales-order-btn');
    await expect(newOrderBtn).toBeVisible();
    await newOrderBtn.click();

    // Order create form drawer
    const drawerForm = page.getByTestId('sales-order-create-form');
    await expect(drawerForm).toBeVisible();

    await drawerForm.locator('#so-party-code').fill(partyCode);
    await drawerForm.locator('#so-item-0').fill('1');
    await drawerForm.locator('#so-qty-0').fill('5');
    await drawerForm.locator('#so-price-0').fill('750000');

    // Submit order
    await drawerForm.getByRole('button', { name: 'ثبت سفارش فروش' }).click();

    // Drawer closes and order appears
    await expect(drawerForm).toBeHidden({ timeout: 10000 });
    await expectNoErrorNotice(page);

    // Find the row with our partyCode
    const orderRow = page.getByRole('row').filter({ hasText: partyCode });
    await expect(orderRow).toBeVisible();
    await expect(orderRow).toContainText('پیش‌نویس');

    // Open detail
    await orderRow.click();
    const detailView = page.getByTestId('sales-order-detail-view');
    await expect(detailView).toBeVisible();
    await expect(detailView).toContainText(partyCode);
  });

  test('passes the axe accessibility gate on /app/sales', async ({ page }) => {
    await openApp(page, '/app/sales');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['color-contrast'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
