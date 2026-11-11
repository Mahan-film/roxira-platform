import { test, expect, openApp, expectNoErrorNotice } from './fixtures';

/**
 * E2E tests for the Access Settings and Permission Matrix page (/app/settings/access):
 * - Permission Matrix: compares system and custom roles across all modules and 6 standard actions
 * - Preview as User: displays computed effective permissions, branch scopes, and sensitive field visibility
 * - Explain Denial: interactive simulator explaining access denials with structured Persian diagnostics
 */
test.describe('Access Settings & Permission Matrix (/app/settings/access)', () => {
  test('navigates through Matrix, Preview, and Explain Denial tabs without errors', async ({ page }) => {
    await openApp(page, '/app/settings/access');

    // Page title and description
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ماتریس و کنترل دسترسی‌ها');

    // Tab navigation buttons
    const matrixTab = page.getByRole('tab', { name: /ماتریس دسترسی‌ها/ });
    const previewTab = page.getByRole('tab', { name: /پیش‌نمایش دیدگاه کاربر/ });
    const explainTab = page.getByRole('tab', { name: /تحلیل رد دسترسی/ });

    await expect(matrixTab).toBeVisible();
    await expect(previewTab).toBeVisible();
    await expect(explainTab).toBeVisible();

    // 1. Matrix Tab: should render permissions table by default
    await expect(matrixTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="permission-matrix-view"]')).toBeVisible();
    await expect(page.getByText('حسابداری').first()).toBeVisible();
    await expect(page.getByText('صورتحساب').first()).toBeVisible();

    // 2. Preview as User Tab
    await previewTab.click();
    await expect(previewTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="preview-as-user-panel"]')).toBeVisible();
    await expect(page.getByText('پیش‌نمایش اختیارات کاربر (دیدگاه کاربر)')).toBeVisible();

    // 3. Explain Denial Tab
    await explainTab.click();
    await expect(explainTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="explain-denial-panel"]')).toBeVisible();
    await expect(page.getByText(/تحلیل و توضیح علل رد یا قبول دسترسی/)).toBeVisible();

    // Switch back to Matrix tab
    await matrixTab.click();
    await expect(matrixTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="permission-matrix-view"]')).toBeVisible();

    await expectNoErrorNotice(page);
  });
});
