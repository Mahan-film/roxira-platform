import { test, expect, findSessionFile, SESSION_STORAGE_KEY } from '../app/fixtures';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import {
  balancesFromVouchers,
  BALANCE_SHEET,
  CHEQUE,
  CUSTOMER,
  EXPECTED_BALANCES,
  FISCAL_YEAR_1405,
  FISCAL_YEAR_1406,
  INCOME_STATEMENT,
  KEYBOARD_VOUCHER_DATE,
  KEYBOARD_VOUCHER_JALALI,
  KEYBOARD_VOUCHER_JALALI_SHOWN,
  KEYBOARD_VOUCHERS,
  OPENING_VOUCHER,
  PURCHASE_VOUCHER,
  RECEIPT_VOUCHER,
  SALES_VOUCHER,
  SUPPLIER,
  TRIAL_BALANCE,
  trialBalanceTotals,
  type Voucher,
} from './m1/accountant-day-expected';
import { rials } from './m1/import-ui';

/**
 * Accountant Day go-live gate (T91, issue #784): sign up a fresh tenant, apply the Iran chart template, enter
 * opening balances, enter five vouchers through the voucher grid with the keyboard, post a sale, a receipt, a
 * purchase and a received cheque, check the trial balance and statements against hand-computed figures, close the
 * fiscal year and prove that reopening is refused.
 *
 * Needs the local stack of the M1 gate (see docs/testing/M1_GATE.md). The steps share one tenant and run in order.
 */

// -----------------------------------------------------------------------------
// Offline self-check: no server, no browser.
// -----------------------------------------------------------------------------

test.describe('Accountant day · figures self-check', () => {
  test('every voucher is balanced', () => {
    const vouchers: Voucher[] = [OPENING_VOUCHER, SALES_VOUCHER, RECEIPT_VOUCHER, PURCHASE_VOUCHER];
    for (const v of vouchers) {
      const debit = v.lines.reduce((sum, l) => sum + l.debit, 0n);
      const credit = v.lines.reduce((sum, l) => sum + l.credit, 0n);
      expect(debit, v.entryNumber).toBe(credit);
    }
    for (const v of KEYBOARD_VOUCHERS) expect(v.debitCode).not.toBe(v.creditCode);
    expect(KEYBOARD_VOUCHERS).toHaveLength(5);
  });

  test('hand-written balances equal the sum of the voucher lines', () => {
    const derived = balancesFromVouchers();
    const nonZero = (record: Record<string, bigint>) =>
      Object.fromEntries(Object.entries(record).filter(([, value]) => value !== 0n));
    expect(nonZero(derived)).toEqual(nonZero({ ...EXPECTED_BALANCES }));
    expect(Object.keys(derived).sort()).toEqual(Object.keys(EXPECTED_BALANCES).sort());
  });

  test('hand-written trial balance, statements and balance sheet agree with the balances', () => {
    const { debit, credit } = trialBalanceTotals(EXPECTED_BALANCES);
    expect(debit).toBe(TRIAL_BALANCE.totalDebit);
    expect(credit).toBe(TRIAL_BALANCE.totalCredit);
    expect(debit).toBe(credit);

    expect(INCOME_STATEMENT.revenue - INCOME_STATEMENT.costOfSales).toBe(INCOME_STATEMENT.grossProfit);
    expect(INCOME_STATEMENT.grossProfit - INCOME_STATEMENT.operatingExpenses).toBe(INCOME_STATEMENT.netProfit);
    expect(-EXPECTED_BALANCES['4020']).toBe(INCOME_STATEMENT.revenue);
    expect(EXPECTED_BALANCES['5110']).toBe(INCOME_STATEMENT.costOfSales);
    expect(EXPECTED_BALANCES['5020'] + EXPECTED_BALANCES['5030'] + EXPECTED_BALANCES['5050']).toBe(
      INCOME_STATEMENT.operatingExpenses,
    );

    const assets = ['1010', '1011', '1012', '1020', '1030', '1045', '1110'].reduce(
      (sum, code) => sum + EXPECTED_BALANCES[code],
      0n,
    );
    expect(assets).toBe(BALANCE_SHEET.totalAssets);
    expect(-(EXPECTED_BALANCES['2010'] + EXPECTED_BALANCES['2020'])).toBe(BALANCE_SHEET.totalLiabilities);
    expect(-EXPECTED_BALANCES['3010'] + INCOME_STATEMENT.netProfit).toBe(BALANCE_SHEET.totalEquity);
    expect(BALANCE_SHEET.totalAssets).toBe(BALANCE_SHEET.totalLiabilities + BALANCE_SHEET.totalEquity);
  });
});

// -----------------------------------------------------------------------------
// The day itself: serial, one fresh tenant, real API and UI.
// -----------------------------------------------------------------------------

type Money = number | string;

interface StoredSession {
  accessToken: string;
  tokenType: string;
  user: unknown;
  expiresAt: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
}

/** tenantId claim of a JWT access token (no signature check; the server did that). */
function tenantIdOfToken(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as {
    tenantId?: string;
  };
  return payload.tenantId ?? '';
}

test.describe('Accountant day · go-live gate on the local stack', () => {
  test.describe.configure({ mode: 'serial' });
  // The session file only boots the browser context; test 01 replaces it with the signed-up tenant.
  test.use({ sessionKind: 'accountant' });

  const state = {
    accessToken: '',
    tenantId: '',
    session: null as StoredSession | null,
    fiscalYearId: 0,
    lockId: 0,
    chequeId: 0,
  };

  test.beforeEach(async ({ baseURL, context }, testInfo) => {
    const host = baseURL ? new URL(baseURL).hostname : '';
    testInfo.skip(
      !['127.0.0.1', 'localhost'].includes(host) && process.env.M1_E2E_ALLOW_REMOTE !== '1',
      `the accountant day gate writes data; refusing ${baseURL ?? 'no baseURL'} (set E2E_BASE_URL to the local sandbox)`,
    );
    // Runs after the fixture's own init script, so the signed-up tenant wins in every later test.
    if (state.session) {
      await context.addInitScript(
        ([key, value]) => {
          try {
            window.localStorage.setItem(key, value);
          } catch {
            /* storage unavailable on about:blank */
          }
        },
        [SESSION_STORAGE_KEY, JSON.stringify(state.session)] as const,
      );
    }
  });

  const headers = () => {
    expect(state.accessToken, 'test 01 signed up and stored the access token').toBeTruthy();
    return { Authorization: `Bearer ${state.accessToken}` };
  };

  async function postApi<T>(page: Page, route: string, body: unknown, expectedStatus: number): Promise<T> {
    const res = await page.request.post(`/api/backend/enterprise-hub/${route}`, { headers: headers(), data: body });
    const text = await res.text();
    expect(res.status(), `POST ${route}: ${text}`).toBe(expectedStatus);
    return JSON.parse(text) as T;
  }

  async function getApi<T>(page: Page, route: string): Promise<T> {
    const res = await page.request.get(`/api/backend/enterprise-hub/${route}`, { headers: headers() });
    const text = await res.text();
    expect(res.status(), `GET ${route}: ${text}`).toBe(200);
    return JSON.parse(text) as T;
  }

  const dec = (value: bigint) => `${value}.00`;

  async function postVoucher(page: Page, v: Voucher) {
    const created = await postApi<{ id: number; status: string; entryNumber: string }>(
      page,
      'accounting/journal-entries',
      {
        entryNumber: v.entryNumber,
        date: `${v.date}T12:00:00.000Z`,
        description: v.description,
        lines: v.lines.map((l) => ({
          accountCode: l.code,
          debit: dec(l.debit),
          credit: dec(l.credit),
          ...(l.partyCode ? { partyCode: l.partyCode } : {}),
        })),
      },
      201,
    );
    expect(created.id).toBeTruthy();
    expect(created.entryNumber).toBe(v.entryNumber);
    expect(created.status).toBe('POSTED');
    return created;
  }

  interface TrialBalance {
    balanced: boolean | null;
    rows: Array<{ code: string; endingDebit: Money; endingCredit: Money }>;
    totals: { endingDebit: Money; endingCredit: Money };
  }
  const trialBalance = (page: Page) =>
    getApi<TrialBalance>(page, `accounting/reports/trial-balance?columns=6&fiscalYearId=${state.fiscalYearId}`);

  test('01 sign up a fresh tenant: the access token comes from the sign-up [T91]', async ({ page, context }, testInfo) => {
    const bootFile = findSessionFile('accountant', testInfo.project.name);
    expect(bootFile, 'a boot session file for the browser context').toBeTruthy();
    const bootSession = JSON.parse(fs.readFileSync(bootFile!, 'utf8')) as { accessToken: string };

    const suffix = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    const password = `${crypto.randomBytes(12).toString('base64url')}-Aa1`;
    const res = await page.request.post('/api/backend/auth/signup', {
      data: {
        email: `accountant_${suffix}@example.com`,
        username: `acc_${suffix}`,
        password,
        displayName: 'Accountant Day',
        organizationName: `شرکت روز حسابدار ${suffix}`,
      },
    });
    const text = await res.text();
    expect(res.status(), `POST auth/signup must return 201: ${text.replace(password, '***')}`).toBe(201);
    const body = JSON.parse(text) as {
      mfaRequired?: boolean;
      accessToken?: string;
      tokenType?: string;
      expiresIn?: number;
      refreshToken?: string;
      refreshExpiresIn?: number;
      user?: unknown;
    };
    expect(body.mfaRequired, 'a new account has no MFA challenge').toBeUndefined();
    expect(body.accessToken, 'sign-up returned an access token').toBeTruthy();

    state.accessToken = body.accessToken!;
    state.tenantId = tenantIdOfToken(state.accessToken);
    expect(state.tenantId, 'the sign-up created an organisation (tenantId claim)').toBeTruthy();
    expect(state.tenantId, 'a tenant of its own, not the boot session tenant').not.toBe(
      tenantIdOfToken(bootSession.accessToken),
    );

    const now = Date.now();
    state.session = {
      accessToken: state.accessToken,
      tokenType: body.tokenType ?? 'Bearer',
      user: body.user,
      expiresAt: now + (body.expiresIn ?? 900) * 1000,
      ...(body.refreshToken
        ? { refreshToken: body.refreshToken, refreshExpiresAt: now + (body.refreshExpiresIn ?? 0) * 1000 }
        : {}),
    };
    await context.addInitScript(
      ([key, value]) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          /* storage unavailable on about:blank */
        }
      },
      [SESSION_STORAGE_KEY, JSON.stringify(state.session)] as const,
    );

    await page.goto('/app/accounting');
    await expect(page.getByRole('navigation', { name: /منوی نرم.?افزار/ })).toBeVisible();
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), SESSION_STORAGE_KEY);
    expect((JSON.parse(stored!) as { accessToken: string }).accessToken, 'the browser runs as the new tenant').toBe(
      state.accessToken,
    );
  });

  test('02 chart from template: apply the iran-trading chart and open fiscal year 1405 [T91]', async ({ page }) => {
    // POST accounting/chart-templates/:key/apply answers 200 (not 201) and is additive.
    const applied = await postApi<{ added: number; classified: number }>(
      page,
      'accounting/chart-templates/iran-trading/apply',
      {},
      200,
    );
    expect(applied.added, 'accounts added by the template').toBeGreaterThan(30);

    const accounts = await getApi<Array<{ code: string; name: string }>>(page, 'accounting/accounts');
    const codes = new Set(accounts.map((a) => a.code));
    for (const code of Object.keys(EXPECTED_BALANCES)) {
      expect(codes.has(code), `account ${code} is in the chart`).toBe(true);
    }

    const fy = await postApi<{ id: number; status: string }>(page, 'accounting/fiscal-years', { ...FISCAL_YEAR_1405 }, 201);
    expect(fy.id).toBeGreaterThan(0);
    expect(fy.status).toBe('OPEN');
    state.fiscalYearId = fy.id;
  });

  test('03 opening balances: post the opening voucher and verify the ledger [T91]', async ({ page }) => {
    await postVoucher(page, OPENING_VOUCHER);

    const tb = await trialBalance(page);
    expect(tb.balanced).toBe(true);
    const byCode = new Map(tb.rows.map((r) => [r.code, rials(r.endingDebit) - rials(r.endingCredit)]));
    expect(byCode.get('1011')).toBe(200_000_000n);
    expect(byCode.get('1012')).toBe(500_000_000n);
    expect(byCode.get('1030')).toBe(300_000_000n);
    expect(byCode.get('3010')).toBe(-1_000_000_000n);
    expect(rials(tb.totals.endingDebit)).toBe(1_000_000_000n);
    expect(rials(tb.totals.endingCredit)).toBe(1_000_000_000n);
  });

  test('04 five vouchers entered by keyboard in the voucher grid [T91]', async ({ page }) => {
    await page.goto('/app/accounting/vouchers');

    const newVoucher = page.getByRole('button', { name: /سند جدید/ }).first();
    const form: Locator = page.locator('form').filter({ has: page.getByPlaceholder('JV-1405-000001') });
    const searchModal = page
      .locator('div.fixed.inset-0')
      .filter({ has: page.getByRole('heading', { name: /جستجوی حساب/ }) });

    /** Focus the account cell of a row, press F2, type the code, move to its exact row with the arrows, Enter. */
    async function pickAccountByKeyboard(row: number, code: string) {
      const accountCell = page.locator(`#voucher-cell-${row}-0`);
      await expect(accountCell).toBeVisible();
      await accountCell.focus();
      await expect(accountCell).toBeFocused();
      await page.keyboard.press('F2');
      await expect(searchModal).toBeVisible();
      const searchInput = searchModal.getByPlaceholder(/کد یا نام حساب/);
      await expect(searchInput).toBeFocused();
      await page.keyboard.type(code);
      const items = searchModal.locator('li');
      await expect
        .poll(async () => (await items.evaluateAll((els) => els.map((e) => e.querySelector('span')?.textContent?.trim() ?? ''))).includes(code), {
          message: `account ${code} is offered by the F2 search`,
        })
        .toBe(true);
      const codes = await items.evaluateAll((els) => els.map((e) => e.querySelector('span')?.textContent?.trim() ?? ''));
      const index = codes.indexOf(code);
      for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(searchModal).toBeHidden();
      // The form moves the focus to the debit cell of the same row.
      await expect(page.locator(`#voucher-cell-${row}-1`)).toBeFocused();
    }

    for (const v of KEYBOARD_VOUCHERS) {
      await expect(newVoucher).toBeVisible();
      await newVoucher.click();
      await expect(form).toBeVisible();
      await expect(form.getByText('کلیدهای حسابدار')).toBeVisible();

      await form.getByPlaceholder('JV-1405-000001').fill(v.entryNumber);
      const dateInput = form.getByPlaceholder('۱۴۰۵/۰۸/۱۴');
      await dateInput.fill(KEYBOARD_VOUCHER_JALALI);
      await expect(dateInput).toHaveValue(KEYBOARD_VOUCHER_JALALI_SHOWN);
      await form.getByPlaceholder('فروش نقدی خدمات مشاوره').fill(v.description);

      // Row 0: debit side. F2 account search, Enter to the amount, type it, Enter skips the credit cell.
      await pickAccountByKeyboard(0, v.debitCode);
      await page.keyboard.type(String(v.amount));
      await page.keyboard.press('Enter');
      await expect(page.locator('#voucher-cell-0-3')).toBeFocused();
      // Enter on the line description moves to the account cell of the next row.
      await page.keyboard.press('Enter');
      await expect(page.locator('#voucher-cell-1-0')).toBeFocused();

      // Row 1: credit side. Enter on the empty debit cell goes to the credit cell.
      await pickAccountByKeyboard(1, v.creditCode);
      await page.keyboard.press('Enter');
      await expect(page.locator('#voucher-cell-1-2')).toBeFocused();
      await page.keyboard.type(String(v.amount));
      await page.keyboard.press('Enter');
      await expect(page.locator('#voucher-cell-1-3')).toBeFocused();

      // Insert opens a new (empty, ignored on save) line and focuses its account cell.
      await page.keyboard.press('Insert');
      await expect(page.locator('#voucher-cell-2-0')).toBeVisible();
      await expect(page.locator('#voucher-cell-2-0')).toBeFocused();
      await expect(form.getByText('سند تراز است')).toBeVisible();

      // Ctrl+S saves; the form closes on success and stays (with an error alert) on a refusal.
      await page.keyboard.press('Control+s');
      await expect(form, `voucher ${v.entryNumber} saved and the form closed`).toBeHidden();
    }

    // The five vouchers are in the ledger exactly as typed.
    for (const v of KEYBOARD_VOUCHERS) {
      const list = await getApi<{
        data: Array<{
          entryNumber: string;
          status: string;
          date: string;
          lines: Array<{ accountCode: string; debit: Money; credit: Money }>;
        }>;
      }>(page, `accounting/journal-entries?entryNumber=${v.entryNumber}`);
      const saved = list.data.find((e) => e.entryNumber === v.entryNumber);
      expect(saved, `voucher ${v.entryNumber} exists`).toBeDefined();
      expect(saved!.status).toBe('POSTED');
      expect(saved!.date.slice(0, 10)).toBe(KEYBOARD_VOUCHER_DATE);
      const lines = saved!.lines.map((l) => ({ code: l.accountCode, debit: rials(l.debit), credit: rials(l.credit) }));
      expect(lines).toHaveLength(2);
      expect(lines).toContainEqual({ code: v.debitCode, debit: v.amount, credit: 0n });
      expect(lines).toContainEqual({ code: v.creditCode, debit: 0n, credit: v.amount });
    }
  });

  test('05 sales invoice: customer, sales voucher with VAT and cost of goods [T91]', async ({ page }) => {
    await postApi(page, 'parties', { code: CUSTOMER.code, name: CUSTOMER.name, role: 'customer' }, 201);
    await postVoucher(page, SALES_VOUCHER);
  });

  test('06 receipt: partial bank settlement of the receivable [T91]', async ({ page }) => {
    await postVoucher(page, RECEIPT_VOUCHER);
  });

  test('07 purchase invoice: supplier and purchase voucher with VAT input [T91]', async ({ page }) => {
    await postApi(page, 'parties', { code: SUPPLIER.code, name: SUPPLIER.name, role: 'supplier' }, 201);
    await postVoucher(page, PURCHASE_VOUCHER);
  });

  test('08 cheque received and cleared through the cheques module [T91]', async ({ page }) => {
    const created = await postApi<{ id: number; status: string }>(
      page,
      'cheques',
      {
        direction: 'received',
        chequeNumber: CHEQUE.chequeNumber,
        bankName: CHEQUE.bankName,
        amount: dec(CHEQUE.amount),
        issueDate: CHEQUE.issueDate,
        dueDate: CHEQUE.dueDate,
        partyName: CUSTOMER.name,
        partyCode: CUSTOMER.code,
      },
      201,
    );
    expect(created.id).toBeGreaterThan(0);
    expect(created.status).toBe('registered');
    state.chequeId = created.id;

    // The cheque module posts its own vouchers (create: Dr 1110 / Cr 1020; clear: Dr 1010 / Cr 1110).
    const cleared = await postApi<{ status: string }>(
      page,
      `cheques/${state.chequeId}/transition`,
      { status: 'cleared', eventDate: CHEQUE.clearDate },
      200,
    );
    expect(cleared.status).toBe('cleared');
  });

  test('09 trial balance balances and every account matches the hand-computed figure [T91]', async ({ page }) => {
    const tb = await trialBalance(page);
    expect(tb.balanced, 'the trial balance reports balanced').toBe(true);
    expect(rials(tb.totals.endingDebit)).toBe(TRIAL_BALANCE.totalDebit);
    expect(rials(tb.totals.endingCredit)).toBe(TRIAL_BALANCE.totalCredit);

    const byCode = new Map(tb.rows.map((r) => [r.code, rials(r.endingDebit) - rials(r.endingCredit)]));
    for (const [code, expected] of Object.entries(EXPECTED_BALANCES)) {
      expect(byCode.has(code), `account ${code} is in the trial balance`).toBe(true);
      expect(byCode.get(code), `balance of account ${code} (debit positive)`).toBe(expected);
    }
  });

  test('10 income statement and balance sheet match the hand-computed figures [T91]', async ({ page }) => {
    const pnl = await getApi<{
      revenue: { total: Money };
      costOfSales: { total: Money };
      grossProfit: Money;
      operatingExpenses: { total: Money };
      netProfit: Money;
    }>(page, `accounting/reports/income-statement?fiscalYearId=${state.fiscalYearId}`);
    expect(rials(pnl.revenue.total), 'revenue').toBe(INCOME_STATEMENT.revenue);
    expect(rials(pnl.costOfSales.total), 'cost of sales').toBe(INCOME_STATEMENT.costOfSales);
    expect(rials(pnl.grossProfit), 'gross profit').toBe(INCOME_STATEMENT.grossProfit);
    expect(rials(pnl.operatingExpenses.total), 'operating expenses').toBe(INCOME_STATEMENT.operatingExpenses);
    expect(rials(pnl.netProfit), 'net profit').toBe(INCOME_STATEMENT.netProfit);

    const bs = await getApi<{
      totalAssets: Money;
      totalLiabilities: Money;
      totalEquity: Money;
      checks: Array<{ key: string; ok: boolean }>;
    }>(page, `accounting/reports/balance-sheet?fiscalYearId=${state.fiscalYearId}`);
    expect(rials(bs.totalAssets), 'total assets').toBe(BALANCE_SHEET.totalAssets);
    expect(rials(bs.totalLiabilities), 'total liabilities').toBe(BALANCE_SHEET.totalLiabilities);
    expect(rials(bs.totalEquity), 'total equity').toBe(BALANCE_SHEET.totalEquity);
    expect(rials(bs.totalAssets)).toBe(rials(bs.totalLiabilities) + rials(bs.totalEquity));
    for (const check of bs.checks) expect(check.ok, `balance sheet check ${check.key}`).toBe(true);
  });

  test('11 period close: close fiscal year 1405 into 1406 and lock the period [T91]', async ({ page }) => {
    expect(state.fiscalYearId).toBeGreaterThan(0);

    const closed = await postApi<{
      year: { id: number; status: string };
      nextYear: { id: number; status: string };
      entryNumbers: string[];
    }>(page, `accounting/fiscal-years/${state.fiscalYearId}/close`, { nextYear: { ...FISCAL_YEAR_1406 } }, 200);
    expect(closed.year.status).toBe('CLOSED');
    expect(closed.nextYear.status).toBe('OPEN');
    expect(closed.entryNumbers.length).toBeGreaterThanOrEqual(2);

    const locks = await getApi<Array<{ id: number; active: boolean }>>(page, 'accounting/period-locks');
    const activeLock = locks.find((l) => l.active);
    expect(activeLock, 'closing the year left an active period lock').toBeDefined();
    state.lockId = activeLock!.id;
  });

  test('12 reopen refused: posting into the closed year and a plain unlock are rejected [T91]', async ({ page }) => {
    expect(state.lockId, 'step 11 recorded the period lock').toBeGreaterThan(0);

    const late = await page.request.post('/api/backend/enterprise-hub/accounting/journal-entries', {
      headers: headers(),
      data: {
        entryNumber: 'LATE-01',
        date: '2026-06-01T12:00:00.000Z',
        description: 'سند غیرمجاز در سال بسته',
        lines: [
          { accountCode: '1011', debit: '1000.00', credit: '0.00' },
          { accountCode: '3010', debit: '0.00', credit: '1000.00' },
        ],
      },
    });
    const lateText = await late.text();
    expect(late.status(), `late voucher is refused with 423 Locked: ${lateText}`).toBe(423);

    const unlock = await page.request.post(
      `/api/backend/enterprise-hub/accounting/period-locks/${state.lockId}/unlock`,
      { headers: headers(), data: { reason: 'تلاش غیرمجاز برای بازگشایی' } },
    );
    const unlockText = await unlock.text();
    expect(unlock.status(), `unlock of a closed-year lock is refused with 409: ${unlockText}`).toBe(409);
    expect(unlockText).toContain('سال مالی بسته');
  });
});
