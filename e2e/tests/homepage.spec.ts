import { test, expect } from '@playwright/test';

// Basic Persian-letter range check; avoids depending on any specific copy.
const PERSIAN_TEXT_RE = /[؀-ۿ]/;

test('homepage loads and renders non-empty Persian text', async ({ page }) => {
  const response = await page.goto('/');

  expect(response, 'no response received for /').not.toBeNull();
  expect(response!.status()).toBeLessThan(400);

  const bodyText = (await page.locator('body').innerText()).trim();
  expect(bodyText.length).toBeGreaterThan(0);
  expect(bodyText).toMatch(PERSIAN_TEXT_RE);
});
