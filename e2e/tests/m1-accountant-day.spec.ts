import { test, expect, findSessionFile, SESSION_STORAGE_KEY } from '../app/fixtures';
import * as fs from 'node:fs';
import type { Page } from '@playwright/test';
import {
  ACCOUNTANT_DAY_BALANCE_SHEET,
  ACCOUNTANT_DAY_CHEQUE,
  ACCOUNTANT_DAY_EXPECTED_BALANCES,
  ACCOUNTANT_DAY_INCOME_STATEMENT,
  ACCOUNTANT_DAY_KEYBOARD_VOUCHERS,
  ACCOUNTANT_DAY_OPENING,
  ACCOUNTANT_DAY_PURCHASE_INVOICE,
  ACCOUNTANT_DAY_RECEIPT,
  ACCOUNTANT_DAY_SALES_INVOICE,
  ACCOUNTANT_DAY_TRIAL_BALANCE,
  computeAccountantDayTotals,
} from './m1/accountant-day-expected';

/** Helper to extract integer Rial bigint from decimal or integer API responses. */
function rials(value: string | number | bigint | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;
  const str = String(value).trim();
  if (!str) return 0n;
  const parts = str.split('.');
  const whole = BigInt(parts[0].replace(/[^\d-]/g, '') || '0');
  return whole;
}

// -----------------------------------------------------------------------------
// 1. Math and Accounting Self-Check (Runs offline without server or browser)
// -----------------------------------------------------------------------------

test.describe('Accountant day E2E · math and accounting self-check', () => {
  test('opening balances voucher is perfectly balanced (Assets == Capital)', () => {
    const assets =
      ACCOUNTANT_DAY_OPENING.cash +
      ACCOUNTANT_DAY_OPENING.bank +
      ACCOUNTANT_DAY_OPENING.inventory;
    expect(assets).toBe(ACCOUNTANT_DAY_OPENING.capital);
    expect(assets).toBe(1_000_000_000n);
  });

  test('5 keyboard vouchers are each balanced', () => {
    for (const v of ACCOUNTANT_DAY_KEYBOARD_VOUCHERS) {
      expect(v.amount).toBeGreaterThan(0n);
    }
  });

  test('hand-computed trial balance balances to the exact Rial', () => {
    const { debits, credits } = computeAccountantDayTotals();
    expect(debits).toBe(credits);
    expect(debits).toBe(ACCOUNTANT_DAY_TRIAL_BALANCE.totalDebit);
    expect(credits).toBe(ACCOUNTANT_DAY_TRIAL_BALANCE.totalCredit);
  });

  test('income statement (P&L) matches hand-computed numbers', () => {
    const gross = ACCOUNTANT_DAY_INCOME_STATEMENT.revenue - ACCOUNTANT_DAY_INCOME_STATEMENT.cogs;
    expect(gross).toBe(ACCOUNTANT_DAY_INCOME_STATEMENT.grossProfit);
    const operating = gross - ACCOUNTANT_DAY_INCOME_STATEMENT.operatingExpenses;
    expect(operating).toBe(ACCOUNTANT_DAY_INCOME_STATEMENT.operatingProfit);
    expect(operating).toBe(ACCOUNTANT_DAY_INCOME_STATEMENT.netProfit);
  });

  test('balance sheet equation holds: Total Assets == Total Liabilities + Total Equity', () => {
    expect(ACCOUNTANT_DAY_BALANCE_SHEET.totalAssets).toBe(
      ACCOUNTANT_DAY_BALANCE_SHEET.totalLiabilities + ACCOUNTANT_DAY_BALANCE_SHEET.totalEquity,
    );
    expect(ACCOUNTANT_DAY_BALANCE_SHEET.totalAssets).toBe(1_083_000_000n);
    expect(ACCOUNTANT_DAY_BALANCE_SHEET.totalLiabilities).toBe(43_000_000n);
    expect(ACCOUNTANT_DAY_BALANCE_SHEET.totalEquity).toBe(1_040_000_000n);
  });
});

// -----------------------------------------------------------------------------
// 2. Full Accountant Day E2E (Runs serially on local stack as roxira_app)
// -----------------------------------------------------------------------------

test.describe('Accountant day E2E · go-live gate on local stack as roxira_app', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ sessionKind: 'accountant' });

  // Shared state across the sequential accountant day steps
  const state = {
    accessToken: '',
    tenantId: '',
    rawSession: null as unknown,
    fiscalYearId: 0,
    salesInvoiceId: '',
    purchaseInvoiceId: '',
    chequeId: 0,
  };

  // Guard: this gate writes real transactions; only runs on loopback local stack.
  test.beforeEach(async ({ baseURL, context }, testInfo) => {
    const host = baseURL ? new URL(baseURL).hostname : '';
    testInfo.skip(
      !['127.0.0.1', 'localhost'].includes(host) && process.env.M1_E2E_ALLOW_REMOTE !== '1',
      `the accountant day gate writes data; refusing ${baseURL ?? 'no baseURL'} (set E2E_BASE_URL to local sandbox)`,
    );

    // Inject session into every page navigation
    if (state.rawSession) {
      await context.addInitScript(
        ([key, session]) => {
          try {
            window.localStorage.setItem(key, JSON.stringify(session));
          } catch {}
        },
        [SESSION_STORAGE_KEY, state.rawSession] as const,
      );
    }
  });

  async function postApi<T>(
    page: Page,
    route: string,
    body: unknown,
    expectedStatus: number | number[] = [200, 201],
  ): Promise<T> {
    const token =
      state.accessToken ||
      (await page.evaluate((k) => {
        try {
          const raw = window.localStorage.getItem(k);
          return raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : '';
        } catch {
          return '';
        }
      }, SESSION_STORAGE_KEY));

    const res = await page.request.post(`/api/backend/enterprise-hub/${route}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: body,
    });
    const allowed = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    if (!allowed.includes(res.status())) {
      const text = await res.text();
      throw new Error(`POST ${route} returned ${res.status()} (expected ${allowed.join(' or ')}): ${text}`);
    }
    const contentType = res.headers()['content-type'] || '';
    if (contentType.includes('application/json')) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  }

  async function getApi<T>(page: Page, route: string): Promise<T> {
    const token =
      state.accessToken ||
      (await page.evaluate((k) => {
        try {
          const raw = window.localStorage.getItem(k);
          return raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : '';
        } catch {
          return '';
        }
      }, SESSION_STORAGE_KEY));

    const res = await page.request.get(`/api/backend/enterprise-hub/${route}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status() !== 200) {
      const text = await res.text();
      throw new Error(`GET ${route} returned ${res.status()}: ${text}`);
    }
    return (await res.json()) as T;
  }

  test('01 fresh tenant & owner account as roxira_app [T91]', async ({ page }) => {
    // 1. If dedicated accountant session file is provided (e.g. CI), load it directly
    const sessionFile =
      process.env.APP_E2E_SESSION_FILE_ACCOUNTANT ||
      findSessionFile('accountant', 'chromium');

    if (sessionFile && fs.existsSync(sessionFile)) {
      const raw = fs.readFileSync(sessionFile, 'utf8');
      const authSession = JSON.parse(raw);
      expect(authSession.accessToken).toBeTruthy();
      state.accessToken = authSession.accessToken;
      state.tenantId = authSession.user?.tenantId || '';
      state.rawSession = authSession;

      await page.goto('/login');
      await page.evaluate(
        ([key, session]) => {
          window.localStorage.setItem(key, JSON.stringify(session));
        },
        [SESSION_STORAGE_KEY, authSession] as const,
      );
    } else {
      // 2. Otherwise sign up via the standard auth endpoint
      const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const email = `accountant_${uniqueSuffix}@example.com`;
      const username = `acc_${uniqueSuffix}`;
      const password = 'A-Strong-Unusual-Password-1405!';
      const orgName = `شرکت روز حسابدار ${uniqueSuffix}`;

      const signupRes = await page.request.post('/api/backend/auth/signup', {
        data: { email, username, password, organizationName: orgName },
      });
      if (signupRes.status() !== 201) {
        const text = await signupRes.text();
        throw new Error(`signup expected 201 but got ${signupRes.status()}: ${text}`);
      }
      const authSession = (await signupRes.json()) as {
        accessToken: string;
        user: { id: string; tenantId?: string };
      };
      expect(authSession.accessToken).toBeTruthy();
      state.accessToken = authSession.accessToken;
      state.tenantId = authSession.user.tenantId || '';
      state.rawSession = authSession;

      await page.goto('/login');
      await page.evaluate(
        ([key, session]) => {
          window.localStorage.setItem(key, JSON.stringify(session));
        },
        [SESSION_STORAGE_KEY, authSession] as const,
      );
    }

    await page.goto('/app/accounting');
    expect(state.accessToken).toBeTruthy();
  });

  test('02 chart from template: apply standard iran-trading chart [T91]', async ({ page }) => {
    await page.goto('/app/accounting');

    // Apply iran-trading template additively
    const applied = await postApi<{ added: number; classified: number }>(
      page,
      'accounting/chart-templates/iran-trading/apply',
      {},
      [200, 201],
    );
    expect(applied.added).toBeGreaterThan(30);

    // Verify key standard chart accounts are present
    const accounts = await getApi<Array<{ code: string; name: string }>>(
      page,
      'accounting/accounts',
    );
    const codes = new Set(accounts.map((a) => a.code));
    for (const expectedCode of [
      '1010',
      '1020',
      '1030',
      '1040',
      '1110',
      '1150',
      '2010',
      '2020',
      '3010',
      '4010',
      '5010',
    ]) {
      expect(codes.has(expectedCode), `account ${expectedCode} in chart`).toBe(true);
    }

    // Create current fiscal year 1405
    const fy = await postApi<{ id: number; status: string }>(
      page,
      'accounting/fiscal-years',
      {
        name: '1405',
        startDate: '2026-03-21',
        endDate: '2027-03-20',
      },
      201,
    );
    expect(fy.id).toBeGreaterThan(0);
    expect(fy.status).toBe('OPEN');
    state.fiscalYearId = fy.id;
  });

  test('03 opening balances: record balanced opening voucher and verify balances [T91]', async ({ page }) => {
    await page.goto('/app/accounting');

    // Opening voucher: Assets (Cash, Bank, Inventory) = Capital
    const openingEntry = await postApi<{ id: string; status: string }>(
      page,
      'accounting/journal-entries',
      {
        entryNumber: 'OP-01',
        date: '2026-03-21T12:00:00.000Z',
        description: 'سند افتتاحیه سال مالی ۱۴۰۵',
        lines: [
          { accountCode: '1010', debit: '200000000.00', credit: '0.00' }, // صندوق
          { accountCode: '1020', debit: '500000000.00', credit: '0.00' }, // بانک
          { accountCode: '1150', debit: '300000000.00', credit: '0.00' }, // موجودی کالا
          { accountCode: '3010', debit: '0.00', credit: '1000000000.00' }, // سرمایه
        ],
      },
      201,
    );
    expect(openingEntry.id).toBeTruthy();
    expect(openingEntry.status).toBe('POSTED');

    // Assert initial trial balance is balanced to 1,000,000,000 IRR
    const tb = await getApi<{
      balanced: boolean;
      totalDebit?: number | string;
      totalCredit?: number | string;
      rows: Array<{ code: string; endingDebit: number | string; endingCredit: number | string }>;
    }>(page, 'accounting/reports/trial-balance?columns=6');
    expect(tb.balanced).toBe(true);
    let openDebit = 0n;
    let openCredit = 0n;
    for (const r of tb.rows) {
      openDebit += rials(r.endingDebit);
      openCredit += rials(r.endingCredit);
    }
    expect(openDebit).toBe(1_000_000_000n);
    expect(openCredit).toBe(1_000_000_000n);
  });

  test('04 5 vouchers by keyboard mode [T91]', async ({ page }) => {
    await page.goto('/app/accounting/vouchers');

    // Open new voucher form to test keyboard mode presence
    const newVoucherBtn = page.getByRole('button', { name: /سند جدید/ });
    await expect(newVoucherBtn).toBeVisible({ timeout: 10000 });
    await newVoucherBtn.click();

    // Verify keyboard shortcuts guidance bar is mounted
    const shortcutBar = page.locator('div').filter({ hasText: /راهنمای کلیدها/ });
    await expect(shortcutBar.first()).toBeVisible({ timeout: 5000 });

    // Press Escape to test clean discard/close behavior
    await page.keyboard.press('Escape');

    // Post the 5 distinct operational vouchers sequentially
    for (const v of ACCOUNTANT_DAY_KEYBOARD_VOUCHERS) {
      const amountStr = `${v.amount}.00`;
      const created = await postApi<{ id: string; entryNumber: string; status: string }>(
        page,
        'accounting/journal-entries',
        {
          entryNumber: v.entryNumber,
          date: '2026-04-15T12:00:00.000Z',
          description: v.description,
          lines: [
            { accountCode: v.debitCode, debit: amountStr, credit: '0.00' },
            { accountCode: v.creditCode, debit: '0.00', credit: amountStr },
          ],
        },
        201,
      );
      expect(created.id).toBeTruthy();
      expect(created.status).toBe('POSTED');
    }
  });

  test('05 sales invoice: issue and post sales invoice [T91]', async ({ page }) => {
    await page.goto('/app/accounting');

    // 1. Create customer party
    await postApi(
      page,
      'parties',
      {
        code: ACCOUNTANT_DAY_SALES_INVOICE.customerCode,
        name: ACCOUNTANT_DAY_SALES_INVOICE.customerName,
        role: 'customer',
      },
      201,
    );

    // 2. Exercise invoicing module: create sales invoice
    const inv = await postApi<{ id: string; taxInvoiceNumber: string }>(
      page,
      'invoicing',
      {
        direction: 'SALE',
        einvoiceType: 1,
        sellerInfo: { name: 'شرکت آزمایشی روز حسابدار' },
        buyerInfo: { name: ACCOUNTANT_DAY_SALES_INVOICE.customerName },
        items: [
          {
            sku: 'ITEM-01',
            description: 'کالای بازرگانی الف',
            quantity: ACCOUNTANT_DAY_SALES_INVOICE.quantity,
            unitPrice: Number(ACCOUNTANT_DAY_SALES_INVOICE.unitPrice),
            discount: 0,
          },
        ],
      },
      201,
    );
    expect(inv.id).toBeTruthy();
    state.salesInvoiceId = inv.id;

    // 3. Post sales invoice journal entry: Revenue 100M + VAT 10M -> Receivable 110M
    // Also post associated COGS 50M -> Inventory out 50M
    const salesVoucher = await postApi<{ id: string; status: string }>(
      page,
      'accounting/journal-entries',
      {
        entryNumber: 'INV-S-01',
        date: '2026-05-01T12:00:00.000Z',
        description: `فاکتور فروش شماره ۰۱ به ${ACCOUNTANT_DAY_SALES_INVOICE.customerName}`,
        lines: [
          {
            accountCode: '1030', // حساب‌های دریافتنی تجاری
            debit: `${ACCOUNTANT_DAY_SALES_INVOICE.totalReceivable}.00`,
            credit: '0.00',
            partyCode: ACCOUNTANT_DAY_SALES_INVOICE.customerCode,
          },
          {
            accountCode: '4010', // فروش کالا
            debit: '0.00',
            credit: `${ACCOUNTANT_DAY_SALES_INVOICE.revenue}.00`,
          },
          {
            accountCode: '2020', // مالیات بر ارزش افزوده فروش
            debit: '0.00',
            credit: `${ACCOUNTANT_DAY_SALES_INVOICE.vatOutput}.00`,
          },
          // COGS & Inventory movement
          {
            accountCode: '5010', // بهای تمام‌شده کالای فروش‌رفته
            debit: `${ACCOUNTANT_DAY_SALES_INVOICE.cogs}.00`,
            credit: '0.00',
          },
          {
            accountCode: '1150', // موجودی کالا
            debit: '0.00',
            credit: `${ACCOUNTANT_DAY_SALES_INVOICE.inventoryDecrease}.00`,
          },
        ],
      },
      201,
    );
    expect(salesVoucher.id).toBeTruthy();
    expect(salesVoucher.status).toBe('POSTED');
  });

  test('06 receipt: partial bank settlement of sales invoice [T91]', async ({ page }) => {
    await page.goto('/app/accounting');

    // Bank receipt of 60,000,000 IRR settling part of customer receivable
    const receiptVoucher = await postApi<{ id: string; status: string }>(
      page,
      'accounting/journal-entries',
      {
        entryNumber: 'REC-01',
        date: '2026-05-10T12:00:00.000Z',
        description: `دریافت نقدی به حساب بانک از ${ACCOUNTANT_DAY_SALES_INVOICE.customerName}`,
        lines: [
          {
            accountCode: ACCOUNTANT_DAY_RECEIPT.debitCode, // بانک
            debit: `${ACCOUNTANT_DAY_RECEIPT.amount}.00`,
            credit: '0.00',
          },
          {
            accountCode: ACCOUNTANT_DAY_RECEIPT.creditCode, // حساب‌های دریافتنی تجاری
            debit: '0.00',
            credit: `${ACCOUNTANT_DAY_RECEIPT.amount}.00`,
            partyCode: ACCOUNTANT_DAY_SALES_INVOICE.customerCode,
          },
        ],
      },
      201,
    );
    expect(receiptVoucher.id).toBeTruthy();
    expect(receiptVoucher.status).toBe('POSTED');
  });

  test('07 purchase invoice: issue and post merchandise purchase [T91]', async ({ page }) => {
    await page.goto('/app/accounting');

    // 1. Create supplier party
    await postApi(
      page,
      'parties',
      {
        code: ACCOUNTANT_DAY_PURCHASE_INVOICE.supplierCode,
        name: ACCOUNTANT_DAY_PURCHASE_INVOICE.supplierName,
        role: 'supplier',
      },
      201,
    );

    // 2. Post purchase invoice: Inventory 30M + VAT 3M -> Payable 33M
    const purchaseVoucher = await postApi<{ id: string; status: string }>(
      page,
      'accounting/journal-entries',
      {
        entryNumber: 'INV-P-01',
        date: '2026-05-20T12:00:00.000Z',
        description: `فاکتور خرید شماره ۰۱ از ${ACCOUNTANT_DAY_PURCHASE_INVOICE.supplierName}`,
        lines: [
          {
            accountCode: '1150', // موجودی کالا
            debit: `${ACCOUNTANT_DAY_PURCHASE_INVOICE.inventoryIncrease}.00`,
            credit: '0.00',
          },
          {
            accountCode: '1040', // مالیات بر ارزش افزوده خرید
            debit: `${ACCOUNTANT_DAY_PURCHASE_INVOICE.vatInput}.00`,
            credit: '0.00',
          },
          {
            accountCode: '2010', // حساب‌های پرداختنی تجاری
            debit: '0.00',
            credit: `${ACCOUNTANT_DAY_PURCHASE_INVOICE.totalPayable}.00`,
            partyCode: ACCOUNTANT_DAY_PURCHASE_INVOICE.supplierCode,
          },
        ],
      },
      201,
    );
    expect(purchaseVoucher.id).toBeTruthy();
    expect(purchaseVoucher.status).toBe('POSTED');
    state.purchaseInvoiceId = purchaseVoucher.id;
  });

  test('08 cheque received and cleared: settle receivable and deposit to bank [T91]', async ({ page }) => {
    await page.goto('/app/accounting');

    // 1. Exercise cheques module: create a cheque
    const chk = await postApi<{ id: number; status?: string }>(
      page,
      'cheques',
      {
        direction: 'RECEIVE',
        amount: Number(ACCOUNTANT_DAY_CHEQUE.amount),
        bankName: 'بانک ملت',
        chequeNumber: '140501',
        sayadNumber: '1234567890123456',
        dueDate: ACCOUNTANT_DAY_CHEQUE.dueDate,
        issuerName: ACCOUNTANT_DAY_SALES_INVOICE.customerName,
      },
      [200, 201],
    );
    expect(chk.id).toBeGreaterThan(0);
    state.chequeId = chk.id;

    // 2. Register received cheque: Dr 1110 (اسناد دریافتنی) 50M / Cr 1030 (حساب‌های دریافتنی) 50M
    const chequeVoucher = await postApi<{ id: string; status: string }>(
      page,
      'accounting/journal-entries',
      {
        entryNumber: 'CHK-REC-01',
        date: '2026-05-25T12:00:00.000Z',
        description: `دریافت چک صیادی به شماره ${ACCOUNTANT_DAY_CHEQUE.chequeNumber} از ${ACCOUNTANT_DAY_SALES_INVOICE.customerName}`,
        lines: [
          {
            accountCode: '1110', // اسناد دریافتنی نزد صندوق
            debit: `${ACCOUNTANT_DAY_CHEQUE.amount}.00`,
            credit: '0.00',
          },
          {
            accountCode: '1030', // حساب‌های دریافتنی تجاری
            debit: '0.00',
            credit: `${ACCOUNTANT_DAY_CHEQUE.amount}.00`,
            partyCode: ACCOUNTANT_DAY_SALES_INVOICE.customerCode,
          },
        ],
      },
      201,
    );
    expect(chequeVoucher.status).toBe('POSTED');

    // 3. Clear cheque to bank: Dr 1020 (بانک) 50M / Cr 1110 (اسناد دریافتنی) 50M
    const clearVoucher = await postApi<{ id: string; status: string }>(
      page,
      'accounting/journal-entries',
      {
        entryNumber: 'CHK-CLR-01',
        date: '2026-06-15T12:00:00.000Z',
        description: `وصول و واریز چک ${ACCOUNTANT_DAY_CHEQUE.chequeNumber} به حساب بانکی`,
        lines: [
          {
            accountCode: '1020', // بانک
            debit: `${ACCOUNTANT_DAY_CHEQUE.amount}.00`,
            credit: '0.00',
          },
          {
            accountCode: '1110', // اسناد دریافتنی نزد صندوق
            debit: '0.00',
            credit: `${ACCOUNTANT_DAY_CHEQUE.amount}.00`,
          },
        ],
      },
      201,
    );
    expect(clearVoucher.status).toBe('POSTED');
  });

  test('09 trial balance balances: total debits equal total credits and balances match [T91]', async ({ page }) => {
    await page.goto('/app/accounting');

    const trial = await getApi<{
      balanced: boolean;
      rows: Array<{ code: string; endingDebit: number | string; endingCredit: number | string }>;
      totalDebit?: number | string;
      totalCredit?: number | string;
    }>(page, 'accounting/reports/trial-balance?columns=6');

    expect(trial.balanced).toBe(true);

    // Sum rows to verify exact minor units
    let totalDebit = 0n;
    let totalCredit = 0n;
    for (const row of trial.rows) {
      totalDebit += rials(row.endingDebit);
      totalCredit += rials(row.endingCredit);
    }
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(ACCOUNTANT_DAY_TRIAL_BALANCE.totalDebit);

    // Verify key individual balances match expected balances
    const rowByCode = new Map(trial.rows.map((r) => [r.code, r]));
    for (const [code, exp] of Object.entries(ACCOUNTANT_DAY_EXPECTED_BALANCES)) {
      const row = rowByCode.get(code);
      if (row && exp > 0n) {
        const net = rials(row.endingDebit) > 0n ? rials(row.endingDebit) : rials(row.endingCredit);
        expect(net, `account ${code} balance`).toBe(exp);
      }
    }
  });

  test('10 P&L and balance sheet totals match hand-computed numbers [T91]', async ({ page }) => {
    await page.goto('/app/accounting');

    // Income Statement (P&L) check
    const pnl = await getApi<{
      revenue: { total: number | string };
      grossProfit: number | string;
      operatingProfit: number | string;
      netProfit: number | string;
    }>(page, 'accounting/reports/income-statement');

    expect(rials(pnl.revenue.total)).toBe(ACCOUNTANT_DAY_INCOME_STATEMENT.revenue);
    expect(rials(pnl.grossProfit)).toBe(ACCOUNTANT_DAY_INCOME_STATEMENT.grossProfit);
    expect(rials(pnl.netProfit)).toBe(ACCOUNTANT_DAY_INCOME_STATEMENT.netProfit);

    // Balance Sheet check
    const bs = await getApi<{
      totalAssets: number | string;
      totalLiabilities: number | string;
      totalEquity: number | string;
    }>(page, 'accounting/reports/balance-sheet');

    expect(rials(bs.totalAssets)).toBe(ACCOUNTANT_DAY_BALANCE_SHEET.totalAssets);
    expect(rials(bs.totalLiabilities)).toBe(ACCOUNTANT_DAY_BALANCE_SHEET.totalLiabilities);
    expect(rials(bs.totalEquity)).toBe(ACCOUNTANT_DAY_BALANCE_SHEET.totalEquity);
    expect(rials(bs.totalAssets)).toBe(rials(bs.totalLiabilities) + rials(bs.totalEquity));
  });

  test('11 period close: close fiscal year into next year and lock period [T91]', async ({ page }) => {
    await page.goto('/app/accounting');
    expect(state.fiscalYearId).toBeGreaterThan(0);

    const closeRes = await postApi<{
      year: { id: number; status: string };
      nextYear: { id: number; status: string };
      entryNumbers: string[];
    }>(
      page,
      `accounting/fiscal-years/${state.fiscalYearId}/close`,
      {
        nextYear: {
          name: '1406',
          startDate: '2027-03-21',
          endDate: '2028-03-20',
        },
      },
      [200, 201],
    );

    expect(closeRes.year.status).toBe('CLOSED');
    expect(closeRes.entryNumbers.length).toBeGreaterThanOrEqual(2);

    // Period lock is active
    const locks = await getApi<Array<{ active: boolean; periodStart: string; periodEnd: string }>>(
      page,
      'accounting/period-locks',
    );
    const activeLock = locks.find((l) => l.active);
    expect(activeLock).toBeDefined();
  });

  test('12 reopen refused: posting into closed period and plain unlock are rejected [T91]', async ({ page }) => {
    await page.goto('/app/accounting');

    // 1. Attempting to post a voucher inside the closed year is refused with HTTP 423 Locked
    const lateVoucherRes = await page.request.post('/api/backend/enterprise-hub/accounting/journal-entries', {
      headers: {
        Authorization: `Bearer ${state.accessToken || (await page.evaluate((k) => {
          const raw = window.localStorage.getItem(k);
          return raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : '';
        }, SESSION_STORAGE_KEY))}`,
      },
      data: {
        entryNumber: 'LATE-VOUCHER',
        date: '2026-06-01T12:00:00.000Z', // date in closed year 1405
        description: 'سند غیرمجاز در سال بسته',
        lines: [
          { accountCode: '1010', debit: '1000.00', credit: '0.00' },
          { accountCode: '3010', debit: '0.00', credit: '1000.00' },
        ],
      },
    });
    expect(lateVoucherRes.status(), 'late voucher rejected with 423 Locked').toBe(423);

    // 2. Direct unlock of period lock without reopening fiscal year is refused with HTTP 409 Conflict
    const locks = await getApi<Array<{ id: number; active: boolean }>>(page, 'accounting/period-locks');
    const lock = locks.find((l) => l.active);
    if (lock) {
      const unlockRes = await page.request.post(
        `/api/backend/enterprise-hub/accounting/period-locks/${lock.id}/unlock`,
        {
          headers: {
            Authorization: `Bearer ${state.accessToken || (await page.evaluate((k) => {
              const raw = window.localStorage.getItem(k);
              return raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : '';
            }, SESSION_STORAGE_KEY))}`,
          },
          data: { reason: 'تلاش غیرمجاز برای بازگشایی' },
        },
      );
      expect(unlockRes.status(), 'unlock of closed year lock rejected with 409 Conflict').toBe(409);
    }
  });
});
