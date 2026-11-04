import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Api,
  BASE,
  OUT_DIR,
  freshCredentials,
  gotoApp,
  installSession,
  isoDate,
  recordFailure,
  signUpThroughUi,
  uniqueSuffix,
  watchPage,
  type Findings,
  type TourSession,
} from './helpers/prod-tour';

/**
 * Production feature tour (issue #132). Opt-in: it signs up a brand-new "Roxira QA <date>" business with an
 * @example.invalid address on production and exercises every merged feature inside that tenant only.
 *
 *   PROD_TOUR=1 npx playwright test -c playwright.tour.config.ts
 *
 * Tests run in file order; a failing test does not stop the next one (each feature has its own assertions).
 * Shared state (session, created ids) is cached in tour-results/state.json so a worker restart after a
 * failure does not create a second tenant. Delete that folder to start a new tenant.
 */
const ENABLED = process.env.PROD_TOUR === '1';
test.skip(!ENABLED, 'opt-in: set PROD_TOUR=1 (writes to a throwaway tenant on production)');

const FIXTURES = path.resolve(__dirname, '../fixtures/sample-company');
const STATE_FILE = path.join(OUT_DIR, 'state.json');

interface State {
  session?: TourSession;
  [k: string]: any;
}
function loadState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveState(patch: State): State {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const next = { ...loadState(), ...patch };
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

const arr = (x: any): any[] => (Array.isArray(x) ? x : (x?.data ?? x?.items ?? x?.results ?? []));
const BASE_ITEMS = 'enterprise-hub/inventory';
// Persisted so a worker restart after a failing test keeps using the same names and ids.
// Only touches disk when the tour is enabled, so collecting the file in CI has no side effects.
const sfx: string = !ENABLED ? 'disabled' : (loadState().sfx ?? saveState({ sfx: uniqueSuffix() }).sfx);

/** Random 10-digit Iranian national id with a valid check digit. */
function nationalId(): string {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const sum = d.reduce((acc, v, i) => acc + v * (10 - i), 0) % 11;
  return [...d, sum < 2 ? sum : 11 - sum].join('');
}
let findings: Findings;

test.beforeEach(async ({ page }) => {
  findings = watchPage(page);
  const s = loadState().session;
  if (s) await installSession(page, s.raw);
});
test.afterEach(async ({ page }, info) => {
  await recordFailure(page, info, findings);
  // Passing tests can still hide errors (a 4xx/5xx the page swallowed, a console.error): keep them as warnings.
  if (info.status === info.expectedStatus && (findings.console.length || findings.network.length)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.appendFileSync(path.join(OUT_DIR, 'warnings.jsonl'), JSON.stringify({ test: info.title, ...findings }) + '\n');
  }
});

async function api(page: Page): Promise<Api> {
  const s = loadState().session;
  if (!s) throw new Error('no tenant yet: the "creating a business" test must pass first');
  return new Api(page.request, s.accessToken);
}

/** Creates (once) a warehouse, an item with a barcode and 100 units of stock. */
async function ensureStock(a: Api): Promise<{ warehouseId: number; itemId: number; sku: string; barcode: string }> {
  const st = loadState();
  if (st.stock) return st.stock;
  const wh = await a.ok('POST', `${BASE_ITEMS}/warehouses`, { name: `QA main ${sfx}`, locationCode: `QA-${sfx}` });
  const sku = `QA-SKU-${sfx}`;
  const barcode = `6260${Date.now().toString().slice(-9)}`;
  const item = await a.ok('POST', `${BASE_ITEMS}/items`, { sku, barcode, name: `کالای آزمایشی ${sfx}`, quantity: 0 });
  await a.ok('POST', `${BASE_ITEMS}/documents/receipts`, {
    toWarehouseId: wh.id,
    reference: `QA-RCPT-${sfx}`,
    lines: [{ sku, quantity: 100, unitCost: 100_000 }],
  });
  const stock = { warehouseId: wh.id, itemId: item.id, sku, barcode };
  saveState({ stock });
  return stock;
}

test.describe('prod feature tour', () => {
  test('01 creating a business through public signup', async ({ page }) => {
    const existing = loadState().session;
    if (existing) {
      await gotoApp(page, '/app');
      await expect(page.locator('body')).toContainText(existing.organization);
      return;
    }
    const session = await signUpThroughUi(page);
    saveState({ session });
    await expect(page.locator('body')).toContainText(session.organization, { timeout: 20_000 });
    await expect(page.locator('body')).toContainText(session.email);
    const a = new Api(page.request, session.accessToken);
    const me = await a.ok('GET', 'tenants/me');
    expect(JSON.stringify(me)).toContain('Roxira QA');
  });

  test('02 login without an organisation', async ({ page, browser }) => {
    // A user created without organisationName must still be able to sign in and reach the app shell.
    const creds = freshCredentials();
    const email = `qa-noorg-${Date.now()}@example.invalid`;
    const signup = await page.request.post(`${BASE}/api/backend/auth/signup`, {
      data: { email, password: creds.password },
    });
    expect(signup.status(), `signup without org: ${(await signup.text()).slice(0, 300)}`).toBeLessThan(300);

    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    const f = watchPage(p);
    await p.goto(`${BASE}/login`);
    await p.getByRole('tab', { name: 'رمز عبور' }).click();
    await p.locator('#pw-identifier').fill(email);
    await p.locator('#pw-password').fill(creds.password);
    await p.getByRole('button', { name: 'ورود', exact: true }).last().click();
    try {
      await p.waitForURL(/\/app/, { timeout: 30_000 });
    } catch (error) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      await p.screenshot({ path: path.join(OUT_DIR, '02-login-without-organisation-page.png'), fullPage: true });
      fs.appendFileSync(path.join(OUT_DIR, 'failures.jsonl'), JSON.stringify({ test: '02 login page state', screenshot: 'e2e/tour-results/02-login-without-organisation-page.png', error: String(error), console: f.console, network: f.network, body: (await p.locator('body').innerText()).slice(0, 600) }) + '\n');
      throw error;
    }
    await p.locator('main').first().waitFor({ timeout: 30_000 });
    const body = await p.locator('body').innerText();
    expect(body).not.toMatch(/خطا|Application error/);
    expect(f.console, f.console.join('\n')).toEqual([]);
    await ctx.close();
  });

  test('03 chart of accounts and its export', async ({ page }) => {
    const a = await api(page);
    const accounts = arr(await a.ok('GET', 'enterprise-hub/accounting/accounts'));
    expect(accounts.length).toBeGreaterThanOrEqual(11);
    expect(accounts.map((x: any) => x.code)).toEqual(expect.arrayContaining(['1010', '3010', '4020']));
    const xlsx = await a.call('GET', 'enterprise-hub/accounting/reports/export/trial-balance?format=xlsx');
    expect(xlsx.status, xlsx.text.slice(0, 200)).toBe(200);
    expect(xlsx.text.length).toBeGreaterThan(2_000);

    await gotoApp(page, '/app/accounting');
    await expect(page.getByText('سرفصل حساب‌ها').first()).toBeVisible();
    await expect(page.getByText('1010').first()).toBeVisible();
    await gotoApp(page, '/app/accounting/reports');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Excel' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test('04 manual voucher and journal search', async ({ page }) => {
    const a = await api(page);
    const entryNumber = `QA-${sfx}`;
    const description = `سند دستی آزمایشی ${sfx}`;
    const entry = await a.ok('POST', 'enterprise-hub/accounting/journal-entries', {
      entryNumber,
      date: new Date().toISOString(),
      description,
      status: 'POSTED',
      lines: [
        { accountCode: '1010', debit: 5_000_000, description: 'QA debit' },
        { accountCode: '3010', credit: 5_000_000, description: 'QA credit' },
      ],
    });
    expect(entry.id ?? entry.entryNumber).toBeTruthy();

    await gotoApp(page, '/app/accounting');
    const search = page.getByPlaceholder('جست‌وجوی شماره سند');
    await search.fill(entryNumber);
    await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(entryNumber) })).toBeVisible({ timeout: 20_000 });

    // The search box must also find a voucher by words of its description.
    await search.fill(sfx);
    await page.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
    await expect(page.getByText(description).first()).toBeVisible({ timeout: 20_000 });

    const tb = await a.ok('GET', 'enterprise-hub/accounting/reports/trial-balance');
    expect(JSON.stringify(tb)).toContain('1010');
  });

  test('05 sales invoice: VAT from the statutory store', async ({ page }) => {
    const a = await api(page);
    const stock = await ensureStock(a);
    const invoice = await a.ok('POST', 'enterprise-hub/invoicing', {
      direction: 'SALE',
      status: 'ISSUED',
      warehouseId: stock.warehouseId,
      sellerInfo: { name: 'Roxira QA' },
      buyerInfo: { name: 'مشتری آزمایشی' },
      items: [{ itemId: stock.itemId, quantity: 2, unitPrice: 500_000 }],
    });
    const line = invoice.items?.[0];
    expect(line, JSON.stringify(invoice).slice(0, 400)).toBeTruthy();
    // vatRate was left out on purpose: the server must fill it from the statutory VAT table by invoice date.
    const rate = Number(line.vatRate);
    expect(rate, 'vatRate filled from the statutory store').toBeGreaterThan(0);
    const expectedTax = Math.round(1_000_000 * (rate > 1 ? rate / 100 : rate));
    expect(Math.abs(Number(line.tax) - expectedTax)).toBeLessThanOrEqual(1);
    saveState({ invoiceId: invoice.id });
  });

  test('05b sales invoice form has the barcode scan box', async ({ page }) => {
    const a = await api(page);
    const stock = await ensureStock(a);
    // UI: scanning the barcode on the sales form fills the row.
    await gotoApp(page, '/app/invoicing');
    await page.getByRole('button', { name: 'فاکتور فروش' }).first().click();
    await expect(page.locator('#invoice-warehouse')).toBeVisible();
    const scan = page.locator('#invoice-scan, [id$="-scan"], input[placeholder*="بارکد"]').first();
    await expect(scan, 'barcode scan box on the sales invoice').toBeVisible();
    await scan.fill(stock.barcode);
    await scan.press('Enter');
    await expect(page.locator('main')).toContainText(`کالای آزمایشی ${sfx}`, { timeout: 15_000 });
  });

  test('06 anonymous POS sale', async ({ page }) => {
    const a = await api(page);
    const stock = await ensureStock(a);
    const key = `qa-pos-${sfx}`;
    const body = {
      idempotencyKey: key,
      warehouseId: stock.warehouseId,
      lines: [{ code: stock.barcode, quantity: 1, unitPrice: 200_000 }],
      payments: [{ method: 'CASH', amount: 0 }],
    };
    // The server computes the exact total; first call tells us what it expects if our guess is off.
    let res = await a.call('POST', 'enterprise-hub/invoicing/pos-sales', { ...body, payments: [{ method: 'CASH', amount: 220_000 }] });
    expect(res.status, res.text.slice(0, 400)).toBeLessThan(300);
    expect(res.body.customerLevel).toBe('anonymous');
    expect(res.body.replayed).toBe(false);
    const again = await a.ok('POST', 'enterprise-hub/invoicing/pos-sales', { ...body, payments: [{ method: 'CASH', amount: 220_000 }] });
    expect(again.replayed).toBe(true);
    expect(again.invoice.id).toBe(res.body.invoice.id);

    await gotoApp(page, '/app/invoicing');
    await page.getByRole('button', { name: 'فروش سریع' }).first().click();
    const scan = page.locator('#qs-scan');
    await expect(scan).toBeVisible();
    await scan.fill(stock.barcode);
    await scan.press('Enter');
    await expect(page.locator('main')).toContainText(`کالای آزمایشی ${sfx}`, { timeout: 15_000 });
  });

  test('07 stock documents and opening balance', async ({ page }) => {
    const a = await api(page);
    const stock = await ensureStock(a);
    const wh2 = await a.ok('POST', `${BASE_ITEMS}/warehouses`, { name: `QA opening ${sfx}`, locationCode: `QO-${sfx}` });
    const sku2 = `QA-OPEN-${sfx}`;
    await a.ok('POST', `${BASE_ITEMS}/items`, { sku: sku2, barcode: `6261${Date.now().toString().slice(-9)}`, name: `کالای افتتاحیه ${sfx}`, quantity: 0 });

    const opening = await a.ok('POST', `${BASE_ITEMS}/openings`, { toWarehouseId: wh2.id, docDate: isoDate(), note: 'QA opening' });
    await a.ok('PUT', `${BASE_ITEMS}/openings/${opening.documentId}/lines`, { lines: [{ sku: sku2, quantity: 10, unitCost: 250_000 }] });
    const review = await a.ok('POST', `${BASE_ITEMS}/openings/${opening.documentId}/review`);
    expect(JSON.stringify(review)).not.toMatch(/"severity":"error"/);
    await a.ok('POST', `${BASE_ITEMS}/openings/${opening.documentId}/post`, { lineCount: 1, totalValue: 2_500_000 });

    await a.ok('POST', `${BASE_ITEMS}/documents/transfers`, {
      fromWarehouseId: stock.warehouseId,
      toWarehouseId: wh2.id,
      lines: [{ sku: stock.sku, quantity: 5 }],
    });
    await a.ok('POST', `${BASE_ITEMS}/documents/deliveries`, {
      fromWarehouseId: wh2.id,
      lines: [{ sku: sku2, quantity: 1 }],
    });
    const docs = arr(await a.ok('GET', `${BASE_ITEMS}/documents`));
    expect(docs.length).toBeGreaterThanOrEqual(4);
    const valuation = await a.ok('GET', `${BASE_ITEMS}/valuation`);
    expect(JSON.stringify(valuation).length).toBeGreaterThan(10);

    await gotoApp(page, '/app/inventory');
    await expect(page.getByText('اسناد انبار').first()).toBeVisible();
    await expect(page.getByText(`QA main ${sfx}`).first()).toBeVisible({ timeout: 20_000 });
  });

  test('08 cheques lifecycle', async ({ page }) => {
    const a = await api(page);
    const cheque = await a.ok('POST', 'enterprise-hub/cheques', {
      direction: 'received',
      chequeNumber: `QA${Date.now().toString().slice(-8)}`,
      bankName: 'ملت',
      amount: 12_000_000,
      issueDate: isoDate(),
      dueDate: isoDate(10),
      partyName: 'مشتری آزمایشی',
    });
    expect(cheque.id).toBeTruthy();
    await a.ok('POST', `enterprise-hub/cheques/${cheque.id}/transition`, { status: 'deposited' });
    const cleared = await a.call('POST', `enterprise-hub/cheques/${cheque.id}/transition`, { status: 'cleared' });
    expect(cleared.status, cleared.text.slice(0, 400)).toBeLessThan(300);
    const detail = await a.ok('GET', `enterprise-hub/cheques/${cheque.id}`);
    expect(detail.status).toBe('cleared');

    await gotoApp(page, '/app/cheques');
    await expect(page.getByText('مشتری آزمایشی').first()).toBeVisible({ timeout: 20_000 });
  });

  test('09 bank accounts, statement import and reconciliation', async ({ page }) => {
    const a = await api(page);
    const accounts = arr(await a.ok('GET', 'enterprise-hub/accounting/accounts'));
    const cash = accounts.find((x: any) => x.code === '1010');
    const bank = await a.ok('POST', 'enterprise-hub/banking/accounts', {
      name: `QA bank ${sfx}`,
      bankCode: 'mellat',
      accountNumber: `1234-${Date.now().toString().slice(-6)}`,
      ledgerAccountId: cash.id,
    });
    saveState({ bankId: bank.id });

    await gotoApp(page, '/app/accounting/bank');
    await expect(page.locator('option', { hasText: `QA bank ${sfx}` }).first()).toBeAttached({ timeout: 20_000 });
    await page.getByRole('tab', { name: 'مغایرت‌گیری هوشمند' }).click().catch(() => undefined);

    const summary = await a.ok('GET', `enterprise-hub/banking/accounts/${bank.id}/summary`);
    expect(summary).toBeTruthy();
    const auto = await a.call('POST', `enterprise-hub/banking/accounts/${bank.id}/auto-match`, {});
    expect(auto.status, auto.text.slice(0, 300)).toBeLessThan(300);

    // Statement import goes through the universal import page.
    await gotoApp(page, '/app/import');
    await page.locator('#import-file').setInputFiles(path.join(FIXTURES, 'bank-statement.csv'));
    await expect(page.getByText(/بررسی|نگاشت|ردیف/).first()).toBeVisible({ timeout: 30_000 });
  });

  test('10 import: small slice and bulk package', async ({ page }) => {
    const a = await api(page);
    const csv = fs.readFileSync(path.join(FIXTURES, 'customers-suppliers.csv'), 'utf8').split(/\r?\n/);
    const slice = path.join(OUT_DIR, 'customers-slice.csv');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(slice, csv.slice(0, 9).join('\n') + '\n');

    await gotoApp(page, '/app/import');
    await page.locator('#import-file').setInputFiles(slice);
    await expect(page.getByText(/مشتری|تأمین‌کننده|ستون/).first()).toBeVisible({ timeout: 45_000 });

    const formats = await a.ok('GET', 'enterprise-hub/data-import/formats');
    expect(JSON.stringify(formats).length).toBeGreaterThan(5);
    const entities = await a.ok('GET', 'enterprise-hub/data-import/entities');
    expect(JSON.stringify(entities).length).toBeGreaterThan(5);

    // Bulk tab ("انتقال کامل دیتابیس") accepts the multi-sheet workbook.
    await gotoApp(page, '/app/import');
    await page.getByRole('tab', { name: 'انتقال کامل دیتابیس' }).click();
    await page.locator('#package-import-file').setInputFiles([path.join(FIXTURES, 'chart-of-accounts.csv'), path.join(FIXTURES, 'opening-balances.csv')]);
    await expect(page.getByText(/بسته|حساب|بررسی/).first()).toBeVisible({ timeout: 60_000 });
  });

  test('11 reports: trial balance, ledgers, ageing, statements', async ({ page }) => {
    const a = await api(page);
    const q = `from=${isoDate(-365)}&to=${isoDate(1)}`;
    for (const r of ['trial-balance', 'subsidiary', 'balance-sheet', 'income-statement', 'cash-flow', 'equity-changes', 'dashboard']) {
      const res = await a.call('GET', `enterprise-hub/accounting/reports/${r}?${q}`);
      expect(res.status, `${r}: ${res.text.slice(0, 300)}`).toBe(200);
    }
    const ledger = await a.call('GET', `enterprise-hub/accounting/reports/ledger?accountCode=1010&${q}`);
    expect(ledger.status, ledger.text.slice(0, 300)).toBe(200);
    expect(JSON.stringify(ledger.body)).toContain('5000000');
    for (const rep of ['ageing']) {
      const ex = await a.call('GET', `enterprise-hub/accounting/reports/export/${rep}?format=xlsx&side=receivable`);
      expect(ex.status, `${rep} export: ${ex.text.slice(0, 200)}`).toBe(200);
    }

    await gotoApp(page, '/app/accounting/reports');
    for (const tab of ['تراز آزمایشی', 'تراز تفصیلی', 'دفتر کل و معین', 'ترازنامه', 'سود و زیان', 'جریان نقد', 'تغییرات حقوق مالکانه', 'گزارش سنی']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page.waitForTimeout(600);
      await expect(page.locator('main').first(), `report tab ${tab}`).not.toContainText(/خطا در|Application error/);
    }
  });

  test('12 fixed assets and depreciation', async ({ page }) => {
    const a = await api(page);
    const code = `FA-${sfx}`;
    const accounts = arr(await a.ok('GET', 'enterprise-hub/accounting/accounts'));
    const codes = accounts.map((x: any) => x.code);
    for (const [c, n, t] of [
      ['1210', 'اموال و تجهیزات', 'ASSET'],
      ['1215', 'استهلاک انباشته', 'ASSET'],
      ['5040', 'هزینه استهلاک', 'EXPENSE'],
    ] as const) {
      if (!codes.includes(c)) await a.call('POST', 'enterprise-hub/accounting/accounts', { code: c, name: n, accountType: t });
    }
    const asset = await a.ok('POST', 'enterprise-hub/accounting/fixed-assets', {
      code,
      name: 'تجهیزات آزمایشی',
      category: 'equipment',
      acquisitionDate: isoDate(-40),
      cost: 120_000_000,
      salvageValue: 0,
      method: 'STRAIGHT_LINE',
      lifeMonths: 60,
      assetAccountCode: '1210',
      accumulatedAccountCode: '1215',
      expenseAccountCode: '5040',
    });
    expect(asset.id ?? asset.code).toBeTruthy();
    const run = await a.call('POST', 'enterprise-hub/accounting/fixed-assets/depreciation-runs', { year: 1405, month: 8 });
    expect(run.status, run.text.slice(0, 400)).toBeLessThan(300);
    const list = arr(await a.ok('GET', 'enterprise-hub/accounting/fixed-assets'));
    expect(list.map((x: any) => x.code)).toContain(code);
  });

  test('13 payroll and the sanavat settlement preview', async ({ page }) => {
    const a = await api(page);
    const emp = await a.ok('POST', 'enterprise-hub/hr/employees', {
      firstName: 'آزمون',
      lastName: `کیو‌ای ${sfx}`,
      nationalId: nationalId(),
      mobile: '09000000001',
      jobTitle: 'حسابدار',
      department: 'مالی',
      hireDate: '2024-03-20',
    });
    const contract = await a.ok('POST', 'enterprise-hub/hr/contracts', {
      employeeId: emp.id,
      startDate: '2024-03-20',
      baseSalary: 150_000_000,
      housingAllowance: 9_000_000,
      foodAllowance: 14_000_000,
      isInsuranceSubject: true,
    });
    expect(contract.id).toBeTruthy();
    const calc = await a.call('POST', 'enterprise-hub/hr/payroll/calculate', { employeeId: emp.id, periodYear: 1405, periodMonth: 8 });
    expect(calc.status, calc.text.slice(0, 300)).toBeLessThan(500);
    const run = await a.call('POST', 'enterprise-hub/hr/payroll-runs', { periodYear: 1405, periodMonth: 8 });
    expect(run.status, run.text.slice(0, 400)).toBeLessThan(300);
    const settle = await a.call('POST', `enterprise-hub/hr/employees/${emp.id}/settlement`, { endDate: isoDate(), unusedLeaveDays: 5 });
    expect(settle.status, settle.text.slice(0, 400)).toBeLessThan(300);
    expect(JSON.stringify(settle.body)).toMatch(/sanavat|سنوات|severance/i);

    await gotoApp(page, '/app/hr');
    await expect(page.getByText(/کل پرسنل/).first()).toBeVisible();
    await gotoApp(page, '/app/hr/payroll');
    await expect(page.getByText('محاسبه حقوق').first()).toBeVisible();
  });

  test('14 tax and seasonal pages', async ({ page }) => {
    const a = await api(page);
    const vat = await a.call('GET', 'enterprise-hub/tax-compliance/reports/vat-seasonal?year=1405&quarter=3');
    expect(vat.status, vat.text.slice(0, 300)).toBe(200);
    const csv = await a.call('GET', 'enterprise-hub/tax-compliance/reports/vat-seasonal.csv?year=1405&quarter=3');
    expect(csv.status, csv.text.slice(0, 300)).toBe(200);
    const trx = await a.call('GET', 'enterprise-hub/tax-compliance/reports/seasonal-transactions?year=1405&quarter=3');
    expect(trx.status, trx.text.slice(0, 300)).toBe(200);
    const status = await a.call('GET', 'enterprise-hub/tax-compliance/moadian/status');
    expect(status.status, status.text.slice(0, 300)).toBe(200);

    await gotoApp(page, '/app/tax');
    await expect(page.getByText('گزارش فصلی ارزش افزوده و معاملات').first()).toBeVisible();
    await page.getByRole('button', { name: 'CSV ارزش افزوده' }).click();
    await expect(page.locator('main').first()).not.toContainText(/Application error/);
  });

  test('15 browsing the app is not rate limited', async ({ page }) => {
    // A person clicking through the menu (one page every ~2 s) must never see a 429 from the proxy.
    const hits: string[] = [];
    page.on('response', (r) => {
      if (r.status() === 429) hits.push(`${r.request().method()} ${r.url().replace(BASE, '')}`);
    });
    for (const route of ['/app', '/app/accounting', '/app/invoicing', '/app/inventory', '/app/cheques', '/app/hr', '/app/tax', '/app/crm', '/app/accounting/reports', '/app/import']) {
      await gotoApp(page, route);
      await page.waitForTimeout(2000);
    }
    expect(hits, `429 responses while browsing: ${hits.join(', ')}`).toEqual([]);
  });
});
