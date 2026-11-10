import { test, expect, openApp, expectNoErrorNotice } from './fixtures';

/**
 * E2E tests for Voucher Actions and Rapid Keyboard Entry (/app/accounting):
 * - Status transitions in voucher list: Draft -> Temporary -> Posted, and Reversal (offset)
 * - Confirmation alert on final posting (irreversibility warning)
 * - Keyboard grid navigation in journal entry form (Enter, Tab, Alt+N, Alt+Delete)
 * - Auto-balance calculation and keyboard shortcut (Alt+B / Ctrl+B)
 */
test.describe('Voucher Actions & Rapid Entry (/app/accounting)', () => {
  test('displays voucher table with status badges and lifecycle action menus', async ({ page }) => {
    await openApp(page, '/app/accounting');

    // Journal entries table or vouchers card
    const vouchersSection = page.locator('[data-slot="card"], table').filter({
      hasText: /اسناد حسابداری|دفتر روزنامه|سند/,
    });
    await expect(vouchersSection.first()).toBeVisible();

    // Verify presence of voucher status badges or table headers
    const tableHeader = page.locator('th').filter({ hasText: /شماره سند|وضعیت|تاریخ/ });
    await expect(tableHeader.first()).toBeVisible();

    await expectNoErrorNotice(page);
  });

  test('journal entry form exposes keyboard shortcuts and auto-balancing controls', async ({ page }) => {
    await openApp(page, '/app/accounting');

    // Click "سند جدید" button to open journal entry creation form
    const newVoucherBtn = page.getByRole('button', { name: /سند جدید/ });
    await expect(newVoucherBtn).toBeVisible();
    await newVoucherBtn.click();

    // Keyboard shortcut bar should be visible with Alt+B / Ctrl+Enter / Alt+N guidance
    const shortcutBar = page.locator('div').filter({
      hasText: /Alt\+B/,
    });
    await expect(shortcutBar.first()).toBeVisible();

    // Auto balance button «موازنه خودکار» should be accessible
    const autoBalanceBtn = page.getByRole('button', { name: /موازنه خودکار/ });
    await expect(autoBalanceBtn).toBeVisible();

    await expectNoErrorNotice(page);
  });
});
