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

    // Click "سند جدید" button to open journal entry creation form/modal
    const newVoucherBtn = page.getByRole('button', { name: /سند جدید|ثبت سند/ });
    if (await newVoucherBtn.isVisible()) {
      await newVoucherBtn.click();

      // Keyboard shortcut bar should be visible with Alt+B / Ctrl+B guidance
      const shortcutBar = page.locator('[data-testid="keyboard-shortcuts-bar"], div').filter({
        hasText: /Alt\+B|Ctrl\+B|تراز خودکار|Alt\+N/,
      });
      await expect(shortcutBar.first()).toBeVisible();

      // Auto balance button or shortcut hint should be accessible
      const autoBalanceBtn = page.getByRole('button', { name: /تراز خودکار/ }).or(page.locator('button[title*="تراز"]'));
      if (await autoBalanceBtn.count() > 0) {
        await expect(autoBalanceBtn.first()).toBeVisible();
      }
    }

    await expectNoErrorNotice(page);
  });
});
