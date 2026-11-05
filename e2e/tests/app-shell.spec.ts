import { test, expect, type Page } from '@playwright/test';

/**
 * Gate 4 browser smoke (scripts/ops/autodeploy/autodeploy.sh): the public landing page and the
 * /app import page must load without uncaught page errors and without a stuck full-screen drop
 * overlay. Read-only, no login: /app/* may redirect to the login screen, which is fine here.
 * Runs in chromium and webkit (Safari regressions were the origin of the stuck-overlay bug).
 */
const BASE = process.env.GATE4_BASE_URL || '';

// Only the post-deploy gate sets GATE4_BASE_URL; CI smoke/preview runs skip this spec.
test.skip(!BASE, 'GATE4_BASE_URL not set (post-deploy gate only)');

async function collectPageErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

for (const path of ['/', '/app/import']) {
  test(`app shell smoke: ${path}`, async ({ page }) => {
    const errors = await collectPageErrors(page);

    // srv1 cannot reach the Iranian e-namad host (connection hangs), so the seal <img> would keep
    // the window `load` event pending for the whole test timeout. Fail that request fast; the
    // badge itself is not what this gate checks.
    await page.route(/^https:\/\/trustseal\.enamad\.ir\//, (route) => route.abort());

    const response = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    expect(response, `no response for ${path}`).not.toBeNull();
    expect(response!.status(), `status for ${path}`).toBeLessThan(400);

    // Let client-side effects (auth redirect, hydration) run.
    await page.waitForTimeout(3000);

    const bodyText = (await page.locator('body').innerText()).trim();
    expect(bodyText.length, `empty body at ${path}`).toBeGreaterThan(0);

    await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
    expect(errors, `uncaught page errors at ${path}`).toEqual([]);
  });
}
