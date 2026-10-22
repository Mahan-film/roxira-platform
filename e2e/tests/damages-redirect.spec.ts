import { test, expect } from '@playwright/test';

// W19: /damages is a roxira.ir-only enterprise page; ghazihoushmand.ir's
// middleware previously redirected it to the roxira.ir *homepage*, silently
// dropping the path the user actually clicked (nav link "محاسبه‌گر قضایی و
// خسارت"). This asserts the redirect now preserves the path.
//
// The redirect is NOT followed (issue #375): loading roxira.ir from the CI
// runner timed out, and only the Location header matters here. Read-only.
test('/damages redirects to roxira.ir/damages, not the bare homepage', async ({ request, baseURL }) => {
  test.skip(!!baseURL && !baseURL.includes('ghazihoushmand'), 'only meaningful on the ghazi domain');

  const response = await request.get('/damages', { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()['location']).toBe('https://roxira.ir/damages');
});
