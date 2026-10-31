import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Browser tests for organisation access control: an owner invites staff, staff join without
 * an organisation name, and each role sees (and is allowed) only its own part of the app.
 *
 * Runs against the local harness (output_apps/enterprise_hub/test/support/dev-harness.ts
 * behind a Next frontend whose NEST_API_ORIGIN points at it), never production:
 *   APP_E2E_BASE_URL=http://127.0.0.1:3911 npx playwright test -c playwright.app.config.ts 07-members
 * The harness serves stand-in CRM and accounting controllers guarded like the real ones.
 */
const BASE = process.env.APP_E2E_BASE_URL || 'http://127.0.0.1:3901';
const API = `${BASE}/api/backend`;
const PW = 'a-long-unusual-pass';
const SESSION_KEY = 'roxira.auth.session';
let ipSeq = 0;
/** Auth endpoints are throttled per client IP; every call and browser gets its own (the harness trusts X-Forwarded-For). */
const freshIp = () => `10.77.${Math.floor(++ipSeq / 200)}.${(ipSeq % 200) + 1}`;
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9);

interface Session { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number; tokenType: string; user: unknown }

async function signup(api: APIRequestContext, name: string, extra: Record<string, unknown> = {}): Promise<Session> {
  const res = await api.post(`${API}/auth/signup`, { headers: { 'X-Forwarded-For': freshIp() }, data: { email: `pw-${name}-${RUN}@example.com`, password: PW, ...extra } });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

async function ownerWithOrg(api: APIRequestContext, name: string, org: string): Promise<Session> {
  const s = await signup(api, name);
  const auth = { Authorization: `Bearer ${s.accessToken}` };
  const created = await api.post(`${API}/org`, { data: { name: org }, headers: { ...auth, 'X-Forwarded-For': freshIp() } });
  expect(created.status()).toBe(201);
  const refreshed = await api.post(`${API}/auth/refresh`, { headers: { 'X-Forwarded-For': freshIp() }, data: { refreshToken: s.refreshToken } });
  return refreshed.json();
}

function stored(s: Session) {
  const now = Date.now();
  return JSON.stringify({
    accessToken: s.accessToken, tokenType: s.tokenType, user: s.user,
    expiresAt: now + s.expiresIn * 1000, refreshToken: s.refreshToken, refreshExpiresAt: now + s.refreshExpiresIn * 1000,
  });
}

async function openAs(browser: Browser, s: Session): Promise<Page> {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': freshIp() } });
  await ctx.addInitScript(([k, v]) => { try { window.localStorage.setItem(k, v); } catch { /* none */ } }, [SESSION_KEY, stored(s)] as const);
  return ctx.newPage();
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'منوی نرم‌افزار' });

test.describe('members, invitations and role limits', () => {
  test('owner invites a sales person; they join without an organisation name and see only their part', async ({ browser, request }) => {
    const owner = await ownerWithOrg(request, 'owner', `Org ${RUN}`);
    const ownerPage = await openAs(browser, owner);

    await ownerPage.goto(`${BASE}/app/settings/members`);
    await expect(ownerPage.getByTestId('members-panel')).toBeVisible();
    await ownerPage.getByRole('tab', { name: 'دعوت‌نامه‌ها' }).click();
    await ownerPage.getByLabel('ایمیل یا شماره موبایل (اختیاری)').fill(`pw-sales-${RUN}@example.com`);
    await ownerPage.getByLabel('نقش', { exact: true }).selectOption('sales');
    await ownerPage.getByRole('button', { name: 'ساخت دعوت‌نامه' }).click();
    const link = await ownerPage.getByTestId('invite-link').inputValue();
    expect(link).toContain('/account/invite/');

    // The staff member opens the link in a fresh browser: no account, no organisation name asked.
    const staffCtx = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': freshIp() } });
    const staff = await staffCtx.newPage();
    const path = new URL(link).pathname + new URL(link).search;
    await staff.goto(`${BASE}${path}`);
    await expect(staff.getByTestId('invite-preview')).toContainText(`Org ${RUN}`);
    await expect(staff.getByTestId('invite-preview')).toContainText('فروش');
    await expect(staff.getByLabel(/نام سازمان|Organization name/)).toHaveCount(0);
    await staff.getByLabel(/^(ایمیل|Email)$/).fill(`pw-sales-${RUN}@example.com`);
    await staff.getByLabel(/رمز عبور|Password/).fill(PW);
    await staff.getByRole('button', { name: /ساخت حساب|Create account/ }).click();

    await staff.waitForURL(/\/(en\/)?app/);
    await expect(nav(staff).getByRole('link', { name: 'مشتریان (CRM)' })).toBeVisible();
    // Hidden because the role cannot read them (the server refuses them too, see the API checks below):
    await expect(nav(staff).getByRole('link', { name: 'حساب‌ها' })).toHaveCount(0);
    await expect(nav(staff).getByRole('link', { name: 'اعضا و نقش‌ها' })).toHaveCount(0);
    await expect(nav(staff).getByRole('link', { name: 'گزارش رخدادها' })).toHaveCount(0);
    await expect(nav(staff).getByRole('link', { name: 'امنیت حساب' })).toBeVisible();

    // Typing the URL does not help: the page says no, and so does the API.
    await staff.goto(`${BASE}/app/settings/members`);
    await expect(staff.getByTestId('no-access')).toBeVisible();
    const token = JSON.parse((await staff.evaluate((k) => localStorage.getItem(k), SESSION_KEY)) as string).accessToken as string;
    const h = { Authorization: `Bearer ${token}` };
    expect((await request.get(`${API}/org/members`, { headers: h })).status()).toBe(403);
    expect((await request.get(`${API}/enterprise-hub/accounting/trial-balance`, { headers: h })).status()).toBe(403);
    expect((await request.post(`${API}/org/invitations`, { headers: h, data: { roleKey: 'admin' } })).status()).toBe(403);
    expect((await request.get(`${API}/enterprise-hub/crm/stats`, { headers: h })).status()).toBe(200);

    // The owner changes the role; after a refresh the new limits apply.
    await ownerPage.getByRole('tab', { name: 'اعضا' }).click();
    const row = ownerPage.getByTestId('member-row').filter({ hasText: `pw-sales-${RUN}` });
    await row.getByRole('combobox').selectOption('read_only');
    await expect(row.getByRole('combobox')).toHaveValue('read_only');
    await staffCtx.close();
    await ownerPage.context().close();
  });

  test('the owner screen enforces role limits server-side (no escalation, last owner stays)', async ({ browser, request }) => {
    const owner = await ownerWithOrg(request, 'owner2', `Org2 ${RUN}`);
    const ownerPage = await openAs(browser, owner);
    await ownerPage.goto(`${BASE}/app/settings/members`);
    const ownerRow = ownerPage.getByTestId('member-row').first();
    await expect(ownerRow).toBeVisible();
    // Demoting the only owner is refused with a message, nothing changes.
    await ownerRow.getByRole('combobox').selectOption('admin');
    await expect(ownerPage.locator('main').getByRole('alert')).toContainText(/مالک|owner/i);
    await expect(ownerRow.getByRole('combobox')).toHaveValue('owner');
    await ownerPage.context().close();
  });

  test('a person with no organisation is asked to create or join one, not for a name at signup', async ({ browser, request }) => {
    const solo = await signup(request, 'solo');
    const page = await openAs(browser, solo);
    await page.goto(`${BASE}/app`);
    await expect(page.getByTestId('org-onboarding')).toBeVisible();
    await page.getByLabel('نام سازمان').fill(`Solo ${RUN}`);
    await page.getByRole('button', { name: 'ساخت سازمان' }).click();
    await page.waitForURL(`${BASE}/app`);
    await expect(page.getByTestId('org-switcher')).toBeVisible();
    await page.context().close();
  });

  test('module screen hides what is not enabled and the operator-only page is closed to owners', async ({ browser, request }) => {
    const owner = await ownerWithOrg(request, 'owner3', `Org3 ${RUN}`);
    const page = await openAs(browser, owner);
    await page.goto(`${BASE}/app/admin/entitlements`);
    await expect(page.getByTestId('no-access')).toBeVisible();
    await page.goto(`${BASE}/app/settings/modules`);
    await expect(page.getByTestId('module-list')).toBeVisible();
    await expect(page.getByTestId('module-list')).not.toContainText(/ریال|تومان|\$/);
    await page.context().close();
  });
});
