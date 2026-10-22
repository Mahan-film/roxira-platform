import { test, expect, openApp, expectNoErrorNotice } from './fixtures';

/**
 * /app/hr loads employees, contracts and stats in one Promise.all; a 400 from the contracts endpoint (a past
 * regression) turns the whole page into the «خطا در دریافت اطلاعات منابع انسانی» notice.
 */
test('hr page loads the contracts list without an error notice', async ({ page }) => {
  const contractsResponse = page.waitForResponse(
    (response) => /\/hr\/contracts(\?|$)/.test(response.url()) && response.request().method() === 'GET',
  );
  await openApp(page, '/app/hr');
  const response = await contractsResponse;
  expect(response.status(), 'GET /hr/contracts').toBe(200);

  await expect(page.getByRole('heading', { level: 1 })).toContainText('کارکنان');

  // Loaded state: either the empty-tenant prompt or, when employees exist, the contracts card.
  const emptyState = page.getByText('فهرست پرسنل قبلی‌تان را اینجا رها کنید');
  const contractsCard = page.getByText('قراردادها و احکام حقوقی', { exact: true });
  await expect(emptyState.or(contractsCard)).toBeVisible();

  await expect(page.getByText('خطا در دریافت اطلاعات منابع انسانی')).toHaveCount(0);
  await expectNoErrorNotice(page);
});
