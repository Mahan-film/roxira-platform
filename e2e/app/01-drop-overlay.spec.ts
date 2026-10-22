import { test, expect, fixturePath, makeDataTransfer, dragEventWithFile, openApp } from './fixtures';

/**
 * The «فایل را رها کنید» overlay (components/app/drop-overlay.tsx). Regression guard for the Safari bug where
 * the overlay never went away: Safari does not send matching dragenter/dragleave pairs, so the overlay must
 * hide by itself once dragover stops arriving. Runs in Chromium and WebKit.
 *
 * Uses the 'import' tenant: dropping a database file starts an upload (never a commit) for that tenant.
 */
test.use({ sessionKind: 'import' });

const DB_TAB = 'انتقال کامل دیتابیس';

test.describe('drop overlay', () => {
  test('shows on a file drag over /app/accounting and hides without dragleave or drop (Safari case)', async ({ page }) => {
    await openApp(page, '/app/accounting');
    const overlay = page.getByText('فایل را رها کنید', { exact: true });
    await expect(overlay).toHaveCount(0);

    const dataTransfer = await makeDataTransfer(page, fixturePath());
    await page.dispatchEvent('body', 'dragenter', { dataTransfer });
    await page.dispatchEvent('body', 'dragover', { dataTransfer });
    await expect(overlay).toBeVisible();

    // While dragover keeps arriving (every ~100 ms, like a real drag) the overlay stays.
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(100);
      await page.dispatchEvent('body', 'dragover', { dataTransfer });
    }
    await expect(overlay).toBeVisible();

    // The drag now "ends" with NO dragleave, NO drop, NO dragend event at all: the overlay must disappear alone.
    await expect(overlay).toBeHidden({ timeout: 3_000 });
    await dataTransfer.dispose();
  });

  test('never appears on /app/import, but still works on other pages afterwards', async ({ page }) => {
    await openApp(page, '/app/import');
    const overlay = page.getByText('فایل را رها کنید', { exact: true });

    const dataTransfer = await makeDataTransfer(page, fixturePath());
    for (let i = 0; i < 8; i++) {
      await page.dispatchEvent('body', 'dragenter', { dataTransfer });
      await page.dispatchEvent('body', 'dragover', { dataTransfer });
      await page.waitForTimeout(100);
      await expect(overlay).toHaveCount(0);
    }
    // The import page's own drop zone is on screen instead.
    await expect(page.getByText('فایل خود را اینجا رها کنید')).toBeVisible();

    // Proves the listener is alive (so the absence above is real): the same drag over another page shows it.
    await page
      .getByRole('navigation', { name: /منوی نرم.?افزار/ })
      .locator('a[href="/app/accounting"]')
      .click();
    await expect(page).toHaveURL(/\/app\/accounting/);
    await page.dispatchEvent('body', 'dragover', { dataTransfer });
    await expect(overlay).toBeVisible();
    await expect(overlay).toBeHidden({ timeout: 3_000 });
    await dataTransfer.dispose();
  });

  test('dropping a .sqlite on the import zone switches to the whole-database tab', async ({ page }) => {
    await openApp(page, '/app/import');
    const fileTab = page.getByRole('tab', { name: /ورود فایل/ });
    const dbTab = page.getByRole('tab', { name: DB_TAB });
    await expect(fileTab).toHaveAttribute('aria-selected', 'true');

    const zone = page.locator('div.border-dashed').filter({ hasText: 'فایل خود را اینجا رها کنید' });
    await dragEventWithFile(page, zone, 'drop', fixturePath());

    await expect(dbTab).toHaveAttribute('aria-selected', 'true');
    await expect(fileTab).toHaveAttribute('aria-selected', 'false');
    // The database wizard took over and started on the file (upload or analysis phase).
    await expect(page.getByRole('list', { name: /مراحل انتقال دیتابیس/ })).toBeVisible();
    await expect(page.getByText('فایل را رها کنید', { exact: true })).toHaveCount(0);
  });

  test('dropping a .sqlite anywhere in /app opens the import page on the whole-database tab', async ({ page }) => {
    await openApp(page, '/app/accounting');
    const dataTransfer = await makeDataTransfer(page, fixturePath());
    await page.dispatchEvent('body', 'dragover', { dataTransfer });
    await expect(page.getByText('فایل را رها کنید', { exact: true })).toBeVisible();
    await page.dispatchEvent('body', 'drop', { dataTransfer });
    await dataTransfer.dispose();

    await expect(page).toHaveURL(/\/app\/import/);
    await expect(page.getByRole('tab', { name: DB_TAB })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('فایل را رها کنید', { exact: true })).toHaveCount(0);
  });
});
