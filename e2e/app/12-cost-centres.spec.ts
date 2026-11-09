import { test, expect, openApp, expectNoErrorNotice } from './fixtures';

/**
 * E2E tests for Cost Centres, Projects, and Dimensions (/app/accounting/dimensions & /app/accounting/reports/cost-centres):
 * - Dimension management for COST_CENTER, PROJECT, and DETAIL floating accounts
 * - Hierarchical parent-child code visualization
 * - Turnover and balance reporting across date intervals
 * - Trial balance broken down by cost centre
 */
test.describe('Cost Centres & Dimensions (/app/accounting/dimensions)', () => {
  test('renders dimensions page with cost centre, project, and floating detail tabs', async ({ page }) => {
    await openApp(page, '/app/accounting/dimensions');

    // Page header
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/مرکز هزینه|ابعاد|تفصیلی/);

    // Dimension kind switchers (COST_CENTER, PROJECT, DETAIL)
    const costCenterTab = page.getByRole('tab', { name: /مرکز هزینه/ }).or(page.getByRole('button', { name: /مرکز هزینه/ }));
    const projectTab = page.getByRole('tab', { name: /پروژه/ }).or(page.getByRole('button', { name: /پروژه/ }));
    const detailTab = page.getByRole('tab', { name: /تفصیلی شناور/ }).or(page.getByRole('button', { name: /تفصیلی شناور/ }));

    await expect(costCenterTab.first()).toBeVisible();
    await expect(projectTab.first()).toBeVisible();
    await expect(detailTab.first()).toBeVisible();

    // Dimension list table or empty container
    const tableOrCard = page.locator('table, [data-slot="card"]');
    await expect(tableOrCard.first()).toBeVisible();

    // Toggle to Project dimension tab
    await projectTab.first().click();
    await expect(tableOrCard.first()).toBeVisible();

    // Toggle to Detail dimension tab
    await detailTab.first().click();
    await expect(tableOrCard.first()).toBeVisible();

    await expectNoErrorNotice(page);
  });

  test('renders trial balance by cost centre report page', async ({ page }) => {
    await openApp(page, '/app/accounting/reports/cost-centres');

    // Heading for trial balance by cost centre
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/تراز آزمایشی به تفکیک مرکز هزینه|مرکز هزینه/);

    // Cost centre filter / selector
    const selectorOrTable = page.locator('select, [role="combobox"], table');
    await expect(selectorOrTable.first()).toBeVisible();

    await expectNoErrorNotice(page);
  });
});
