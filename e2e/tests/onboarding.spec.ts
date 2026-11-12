import type { Page } from '@playwright/test';
import { test, expect, fa, findSessionFile, loginAsTestTenant, openApp, SESSION_STORAGE_KEY } from '../app/fixtures';
import { apiGet } from './m1/import-ui';

/**
 * T96 acceptance: the first-login setup wizard of a brand-new company, from the one-time redirect on the
 * dashboard to «all steps finished», through the real pages and API of a sandbox tenant.
 *
 * It needs a FRESH tenant (no accounts, onboarding never visited): the one-time redirect is part of what
 * is tested, so a tenant that already ran another gate fails test 01 on purpose. Mint one with:
 *   bash scripts/infra/e2e/mkuser.sh m1 ; E2E_BASE_URL=... APP_E2E_SESSION_FILE_M1=... npx playwright test onboarding
 * Like the other gates it writes data, so it only runs against a loopback sandbox (or M1_E2E_ALLOW_REMOTE=1).
 * It is not part of the CI workflow: it needs the sandbox stack.
 *
 *   npx playwright test onboarding --list    # no server needed
 */

interface OnboardingState {
  steps: Record<string, 'pending' | 'done' | 'skipped'>;
  completed: boolean;
  dismissed: boolean;
  firstVisit: boolean;
  companyName: string;
  economicCode: string | null;
  nationalId: string | null;
}

/** GET /tenants/me/onboarding with the session of the test tenant (not under /enterprise-hub, so no apiGet). */
async function onboardingState(page: Page): Promise<OnboardingState> {
  const token = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : undefined;
  }, SESSION_STORAGE_KEY);
  expect(token, 'the test session is in localStorage').toBeTruthy();
  const response = await page.request.get('/api/backend/tenants/me/onboarding', { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status(), 'GET /tenants/me/onboarding').toBe(200);
  return (await response.json()) as OnboardingState;
}

const tab = (page: Page, key: string) => page.getByTestId(`step-tab-${key}`);
const progress = (page: Page, finished: number) =>
  expect(page.getByTestId('onboarding-progress')).toContainText(`${fa(finished)} از ${fa(6)} مرحله`);

test.describe('T96 · new company onboarding wizard', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ sessionKind: 'm1' });

  test.beforeEach(({ baseURL }, testInfo) => {
    testInfo.skip(!findSessionFile('m1', testInfo.project.name), 'no sandbox session: set APP_E2E_SESSION_FILE_M1 (scripts/infra/e2e/mkuser.sh m1)');
    const host = baseURL ? new URL(baseURL).hostname : '';
    testInfo.skip(!['127.0.0.1', 'localhost'].includes(host) && process.env.M1_E2E_ALLOW_REMOTE !== '1', `the gate writes data; refusing ${baseURL ?? 'no baseURL'}`);
  });

  test('01 a new company is sent to the wizard once, on its first visit to the dashboard', async ({ page }) => {
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/app\/onboarding$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'راه‌اندازی شرکت' })).toBeVisible();
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible();
    await progress(page, 0);
    await expect(tab(page, 'profile')).toHaveAttribute('aria-current', 'step');

    const state = await onboardingState(page);
    expect(state.firstVisit, 'the redirect was recorded on the server').toBe(false);
    expect(Object.values(state.steps).every((status) => status === 'pending')).toBe(true);

    // The second visit to the dashboard stays on the dashboard and shows the banner instead.
    await openApp(page, '/app');
    await expect(page.getByTestId('onboarding-banner')).toBeVisible();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('02 step 1: company name, economic code and national id are saved', async ({ page }) => {
    await loginAsTestTenant(page, '/app/onboarding');
    await page.getByLabel('نام شرکت').fill('شرکت آزمایشی راه‌اندازی');
    await page.getByLabel(/شماره اقتصادی/).fill('411234567890');
    await page.getByLabel(/شناسه ملی/).fill('10101234567');
    await page.getByRole('button', { name: 'ذخیره و ادامه' }).click();
    await expect(tab(page, 'profile')).toContainText('انجام شد');
    await expect(tab(page, 'fiscal_year')).toHaveAttribute('aria-current', 'step');
    await progress(page, 1);

    const state = await onboardingState(page);
    expect(state).toMatchObject({ companyName: 'شرکت آزمایشی راه‌اندازی', economicCode: '411234567890', nationalId: '10101234567' });
    expect(state.steps.profile).toBe('done');
  });

  test('03 step 1 refuses a malformed economic code and saves nothing', async ({ page }) => {
    await loginAsTestTenant(page, '/app/onboarding');
    await tab(page, 'profile').click();
    await page.getByLabel(/شماره اقتصادی/).fill('123');
    await page.getByRole('button', { name: 'ذخیره و ادامه' }).click();
    await expect(page.getByText('شماره اقتصادی باید ۱۱ تا ۱۴ رقم باشد.')).toBeVisible();
    expect((await onboardingState(page)).economicCode).toBe('411234567890');
  });

  test('04 step 2: the fiscal year is defined with the Jalali-year defaults', async ({ page }) => {
    await loginAsTestTenant(page, '/app/onboarding');
    // Resume: the wizard opens at the first step still waiting.
    await expect(tab(page, 'fiscal_year')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByLabel('نام سال')).not.toHaveValue('');
    await page.getByRole('button', { name: 'تعریف سال مالی' }).click();
    await expect(tab(page, 'fiscal_year')).toContainText('انجام شد');
    await expect(tab(page, 'chart')).toHaveAttribute('aria-current', 'step');

    const years = await apiGet<Array<{ name: string; status: string }>>(page, 'accounting/fiscal-years');
    expect(years).toHaveLength(1);
    expect(years[0].status).toBe('OPEN');
  });

  test('05 step 3: a chart template adds the standard accounts', async ({ page }) => {
    await loginAsTestTenant(page, '/app/onboarding');
    await expect(tab(page, 'chart')).toHaveAttribute('aria-current', 'step');
    const before = await apiGet<unknown[]>(page, 'accounting/accounts');
    expect(before).toHaveLength(0);
    await page.getByRole('button', { name: /^اعمال قالب/ }).first().click();
    await expect(page.getByTestId('chart-applied')).toBeVisible();
    await expect(tab(page, 'chart')).toContainText('انجام شد');
    const after = await apiGet<unknown[]>(page, 'accounting/accounts');
    expect(after.length).toBeGreaterThan(0);
  });

  test('06 step 4: opening balances link into the import flow and can be skipped', async ({ page }) => {
    await loginAsTestTenant(page, '/app/onboarding');
    await expect(tab(page, 'opening_balances')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('link-opening_balances')).toHaveAttribute('href', '/app/import');
    await page.getByRole('button', { name: 'رد کردن این مرحله' }).click();
    await expect(tab(page, 'opening_balances')).toContainText('رد شد');
    expect((await onboardingState(page)).steps.opening_balances).toBe('skipped');
  });

  test('07 step 5: a colleague is invited with a role from the embedded invitation form', async ({ page }) => {
    await loginAsTestTenant(page, '/app/onboarding');
    await expect(tab(page, 'users')).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('#inv-role option').first()).toBeAttached();
    await page.locator('#inv-role').selectOption('accountant');
    await page.getByRole('button', { name: 'ساخت دعوت‌نامه' }).click();
    await expect(page.getByTestId('invite-created')).toBeVisible();
    await expect(page.getByTestId('invitation-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'دعوت‌ها انجام شد' }).click();
    await expect(tab(page, 'users')).toContainText('انجام شد');
  });

  test('08 step 6: Moadian links to the tax page; skipping it finishes the wizard', async ({ page }) => {
    await loginAsTestTenant(page, '/app/onboarding');
    await expect(tab(page, 'moadian')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('link-moadian')).toHaveAttribute('href', '/app/tax');
    await page.getByRole('button', { name: 'رد کردن این مرحله' }).click();
    await expect(page.getByTestId('onboarding-complete')).toBeVisible();
    await progress(page, 6);
  });

  test('09 the finished state survives a reload and the dashboard banner is gone', async ({ page }) => {
    await loginAsTestTenant(page, '/app/onboarding');
    await progress(page, 6);
    const state = await onboardingState(page);
    expect(state.completed).toBe(true);
    expect(state.steps).toEqual({
      profile: 'done',
      fiscal_year: 'done',
      chart: 'done',
      opening_balances: 'skipped',
      users: 'done',
      moadian: 'skipped',
    });
    await openApp(page, '/app');
    await expect(page.getByTestId('onboarding-banner')).toHaveCount(0);
  });
});
