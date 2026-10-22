import { test, expect, openApp } from './fixtures';

/** The command bar (components/app/command-palette.tsx): Cmd/Ctrl+K opens it, Escape closes it. */
test('Cmd/Ctrl+K opens the command palette and a command navigates', async ({ page }) => {
  await openApp(page, '/app');

  const dialog = page.getByRole('dialog', { name: /پالت فرمان/ });
  await expect(dialog).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+k');
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('combobox');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await expect(dialog.getByRole('option').first()).toBeVisible();

  // Typing filters the commands; choosing one navigates and closes the bar.
  await input.fill('انتقال کامل');
  const option = dialog.getByRole('option').filter({ hasText: 'انتقال کامل دیتابیس' });
  await expect(option).toBeVisible();
  await option.click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/import/);
  await expect(page.getByRole('tab', { name: 'انتقال کامل دیتابیس' })).toHaveAttribute('aria-selected', 'true');

  // Escape closes it again.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox')).toBeFocused(); // Escape is handled by the input
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
