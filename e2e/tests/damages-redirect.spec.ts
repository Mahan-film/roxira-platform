import { test, expect } from '@playwright/test';

// W19: /damages is a roxira.ir-only enterprise page; ghazihoushmand.ir's
// middleware previously redirected it to the roxira.ir *homepage*, silently
// dropping the path the user actually clicked (nav link "محاسبه‌گر قضایی و
// خسارت"). This asserts the redirect now preserves the path.
//
// NOTE: this exercises the middleware.ts fix from this PR. It will only
// pass once that change is deployed to the server the E2E_BASE_URL points
// at (read-only: we only follow a redirect, no writes).
test('/damages redirects to roxira.ir/damages, not the bare homepage', async ({ page, baseURL }) => {
  test.skip(!!baseURL && !baseURL.includes('ghazihoushmand'), 'only meaningful on the ghazi domain');

  const response = await page.goto('/damages');
  expect(response, 'no response received for /damages').not.toBeNull();

  const finalUrl = new URL(page.url());
  expect(finalUrl.hostname).toBe('roxira.ir');
  expect(finalUrl.pathname).toBe('/damages');
});
