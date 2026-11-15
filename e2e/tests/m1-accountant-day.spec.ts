import { test, expect, findSessionFile, SESSION_STORAGE_KEY } from '../app/fixtures';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import {
  allDayLines,
  balancesFromVouchers,
  BALANCE_SHEET,
  CHEQUE,
  CUSTOMER,
  DAY_ITEM,
  EXPECTED_BALANCES,
  EXPECTED_PARTY_SUBLEDGER,
  FISCAL_YEAR_1405,
  FISCAL_YEAR_1406,
  INCOME_STATEMENT,
  KEYBOARD_VOUCHER_DATE,
  KEYBOARD_VOUCHER_JALALI,
  KEYBOARD_VOUCHER_JALALI_SHOWN,
  KEYBOARD_VOUCHERS,
  OPENING_VOUCHER,
  PURCHASE_INVOICE,
  PURCHASE_VOUCHER,
  RECEIPT_VOUCHER,
  SALES_INVOICE,
  SALES_VOUCHER,
  SUPPLIER,
  TRIAL_BALANCE,
  trialBalanceTotals,
  type Voucher,
  type VoucherLine,
} from './m1/accountant-day-expected';
import { rials } from './m1/import-ui';

/**
 * Accountant Day go-live gate (T91 + T99, issues #784, #793): sign up a fresh tenant, apply the Iran chart
 * template, enter opening balances, enter five vouchers through the voucher grid with the keyboard, create
 * and issue a sales invoice and record a purchase invoice through the invoicing module alongside a receipt and
 * a received cheque, verify party sub-ledgers and the trial balance + statements against hand-computed figures,
 * close the fiscal year and prove that reopening is refused.
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

  test('invoicing figures and party sub-ledgers agree with the expected vouchers [T99]', () => {
    const openingInventory = OPENING_VOUCHER.lines.find((l) => l.code === '1030')!.debit;
    expect(DAY_ITEM.openingCost * BigInt(DAY_ITEM.openingQty)).toBe(openingInventory);

    expect(SALES_VOUCHER.lines.find((l) => l.code === '1020')!.debit).toBe(SALES_INVOICE.payable);
    expect(SALES_VOUCHER.lines.find((l) => l.code === '4020')!.credit).toBe(SALES_INVOICE.net);
    expect(SALES_VOUCHER.lines.find((l) => l.code === '2020')!.credit).toBe(SALES_INVOICE.vat);
    expect(SALES_VOUCHER.lines.find((l) => l.code === '5110')!.debit).toBe(SALES_INVOICE.cogs);
    expect(SALES_INVOICE.net + SALES_INVOICE.vat).toBe(SALES_INVOICE.payable);

    expect(PURCHASE_VOUCHER.lines.find((l) => l.code === '1030')!.debit).toBe(PURCHASE_INVOICE.net);
    expect(PURCHASE_VOUCHER.lines.find((l) => l.code === '1045')!.debit).toBe(PURCHASE_INVOICE.vat);
    expect(PURCHASE_VOUCHER.lines.find((l) => l.code === '2010')!.credit).toBe(PURCHASE_INVOICE.payable);
    expect(PURCHASE_INVOICE.net + PURCHASE_INVOICE.vat).toBe(PURCHASE_INVOICE.payable);

    const byParty = (accountCode: string, partyCode: string) =>
      allDayLines()
        .filter((l) => l.code === accountCode && l.partyCode === partyCode)
        .reduce(
          (acc, l) => ({ debit: acc.debit + l.debit, credit: acc.credit + l.credit }),
          { debit: 0n, credit: 0n },
        );

    const cust = byParty(EXPECTED_PARTY_SUBLEDGER.customer.accountCode, EXPECTED_PARTY_SUBLEDGER.customer.partyCode);
    expect(cust.debit).toBe(EXPECTED_PARTY_SUBLEDGER.customer.debit);
    expect(cust.credit).toBe(EXPECTED_PARTY_SUBLEDGER.customer.credit);
    expect(cust.debit - cust.credit).toBe(EXPECTED_PARTY_SUBLEDGER.customer.closing);

    const supp = byParty(EXPECTED_PARTY_SUBLEDGER.supplier.accountCode, EXPECTED_PARTY_SUBLEDGER.supplier.partyCode);
    expect(supp.debit).toBe(EXPECTED_PARTY_SUBLEDGER.supplier.debit);
    expect(supp.credit).toBe(EXPECTED_PARTY_SUBLEDGER.supplier.credit);
    expect(supp.debit - supp.credit).toBe(EXPECTED_PARTY_SUBLEDGER.supplier.closing);
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
    orgName: '',
    session: null as StoredSession | null,
    fiscalYearId: 0,
    stockItemId: 0,
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

  async function putApi(page: Page, route: string, body: unknown, expectedStatus: number): Promise<void> {
    const res = await page.request.put(`/api/backend/enterprise-hub/${route}`, { headers: headers(), data: body });
    const text = await res.text();
    expect(res.status(), `PUT ${route}: ${text}`).toBe(expectedStatus);
  }

  async function patchApi<T>(page: Page, route: string, body: unknown, expectedStatus: number): Promise<T> {
    const res = await page.request.patch(`/api/backend/enterprise-hub/${route}`, { headers: headers(), data: body });
    const text = await res.text();
    expect(res.status(), `PATCH ${route}: ${text}`).toBe(expectedStatus);
    return JSON.parse(text) as T;
  }

  interface InvoiceRecord {
    id: string;
    status: string;
    totalAmount: Money;
    totalTax: Money;
    finalPayable: Money;
    journalEntryId: number | null;
    postingError: string | null;
  }

  async function waitForPostedInvoice(page: Page, invoiceId: string): Promise<InvoiceRecord> {
    let latest!: InvoiceRecord;
    await expect
      .poll(
        async () => {
          latest = await getApi<InvoiceRecord>(page, `invoicing/${invoiceId}`);
          expect(latest.postingError, `invoice ${invoiceId} posting error`).toBeNull();
          return latest.journalEntryId;
        },
        { message: `wait for BullMQ worker to post invoice ${invoiceId}`, timeout: 20_000, intervals: [250, 500, 1_000] },
      )
      .not.toBeNull();
    return latest;
  }

  async function expectVoucherLines(page: Page, journalEntryId: number, expectedLines: readonly VoucherLine[]) {
    const entry = await getApi<{
      status: string;
      lines: Array<{ accountCode: string; debit: Money; credit: Money; partyCode?: string | null }>;
    }>(page, `accounting/journal-entries/${journalEntryId}`);
    expect(entry.status).toBe('POSTED');
    const norm = (line: { code: string; debit: bigint; credit: bigint; partyCode?: string | null }) =>
      `${line.code}|${line.debit}|${line.credit}|${line.partyCode ?? ''}`;
    const actual = entry.lines
      .map((l) => norm({ code: l.accountCode, debit: rials(l.debit), credit: rials(l.credit), partyCode: l.partyCode }))
      .sort();
    const expected = expectedLines.map((l) => norm(l)).sort();
    expect(actual, `journal entry ${journalEntryId} lines`).toEqual(expected);
  }

  interface PartyLedgerReport {
    accountCode: string;
    partyCode: string | null;
    opening: Money;
    totalDebit: Money;
    totalCredit: Money;
    closing: Money;
  }

  const partyLedger = (page: Page, accountCode: string, partyCode: string) =>
    getApi<PartyLedgerReport>(
      page,
      `accounting/reports/ledger?accountCode=${encodeURIComponent(accountCode)}&partyCode=${encodeURIComponent(partyCode)}&fiscalYearId=${state.fiscalYearId}`,
    );

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
    const orgName = `شرکت روز حسابدار ${suffix}`;
    const password = `${crypto.randomBytes(12).toString('base64url')}-Aa1`;
    const res = await page.request.post('/api/backend/auth/signup', {
      data: {
        email: `accountant_${suffix}@example.com`,
        username: `acc_${suffix}`,
        password,
        displayName: 'Accountant Day',
        organizationName: orgName,
      },
    });
    state.orgName = orgName;
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
      // The balance badge is in the card header, outside the form element.
      await expect(page.getByText('سند تراز است', { exact: true })).toBeVisible();

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

  test('05 sales invoice: customer, stock setup, draft and issue invoice via invoicing module [T99]', async ({ page }) => {
    // Goods sales go to 4020 in `iran-trading` instead of service revenue 4010.
    await putApi(page, 'posting-rules/invoice.sale.issue/roles/revenue', { accountCode: '4020' }, 204);

    // Seed the FIFO layer matching opening inventory (60 x 5M = 300M); inventory inbound does not post GL entries.
    const item = await postApi<{ id: number }>(
      page,
      'inventory/items',
      { sku: DAY_ITEM.sku, barcode: DAY_ITEM.barcode, name: DAY_ITEM.name },
      201,
    );
    state.stockItemId = item.id;
    await postApi(
      page,
      'inventory/movements/inbound',
      {
        sku: DAY_ITEM.sku,
        quantity: DAY_ITEM.openingQty,
        unitPurchaseCost: Number(DAY_ITEM.openingCost),
        reference: 'موجودی اول دوره روز حسابدار',
      },
      201,
    );

    await postApi(page, 'parties', { code: CUSTOMER.code, name: CUSTOMER.name, role: 'customer' }, 201);

    const draft = await postApi<InvoiceRecord>(
      page,
      'invoicing',
      {
        direction: 'SALE',
        einvoiceType: 1,
        sellerInfo: { name: state.orgName },
        buyerInfo: { name: CUSTOMER.name, nationalId: CUSTOMER.nationalId, partyCode: CUSTOMER.code },
        items: [
          {
            itemId: state.stockItemId,
            sku: DAY_ITEM.sku,
            quantity: DAY_ITEM.saleQty,
            unitPrice: Number(DAY_ITEM.saleUnitPrice),
            vatRate: DAY_ITEM.vatRate,
          },
        ],
        status: 'DRAFT',
      },
      201,
    );
    expect(draft.status).toBe('DRAFT');
    expect(draft.journalEntryId).toBeNull();
    expect(rials(draft.totalAmount)).toBe(SALES_INVOICE.net);
    expect(rials(draft.totalTax)).toBe(SALES_INVOICE.vat);
    expect(rials(draft.finalPayable)).toBe(SALES_INVOICE.payable);

    const patched = await patchApi<InvoiceRecord>(page, `invoicing/${draft.id}`, { status: 'ISSUED' }, 200);
    expect(patched.status).toBe('ISSUED');

    const posted = await waitForPostedInvoice(page, draft.id);
    await expectVoucherLines(page, posted.journalEntryId!, SALES_VOUCHER.lines);

    const custLedger = await partyLedger(page, '1020', CUSTOMER.code);
    expect(rials(custLedger.totalDebit)).toBe(SALES_INVOICE.payable);
    expect(rials(custLedger.totalCredit)).toBe(0n);
    expect(rials(custLedger.closing)).toBe(SALES_INVOICE.payable);
  });

  test('06 receipt: partial bank settlement of the receivable and party sub-ledger update [T91+T99]', async ({ page }) => {
    await postVoucher(page, RECEIPT_VOUCHER);
    const custLedger = await partyLedger(page, '1020', CUSTOMER.code);
    expect(rials(custLedger.totalDebit)).toBe(SALES_INVOICE.payable);
    expect(rials(custLedger.totalCredit)).toBe(60_000_000n);
    expect(rials(custLedger.closing)).toBe(50_000_000n);
  });

  test('07 purchase invoice: supplier, issued via invoicing module and supplier sub-ledger [T99]', async ({ page }) => {
    expect(state.stockItemId, 'step 05 created the stock item').toBeGreaterThan(0);
    await postApi(page, 'parties', { code: SUPPLIER.code, name: SUPPLIER.name, role: 'supplier' }, 201);

    const purchase = await postApi<InvoiceRecord>(
      page,
      'invoicing',
      {
        direction: 'PURCHASE',
        sellerInfo: { name: SUPPLIER.name, nationalId: SUPPLIER.nationalId, partyCode: SUPPLIER.code },
        buyerInfo: { name: state.orgName },
        items: [
          {
            itemId: state.stockItemId,
            sku: DAY_ITEM.sku,
            quantity: DAY_ITEM.purchaseQty,
            unitPrice: Number(DAY_ITEM.purchaseUnitCost),
            vatRate: DAY_ITEM.vatRate,
          },
        ],
        status: 'ISSUED',
      },
      201,
    );
    expect(purchase.status).toBe('ISSUED');
    expect(rials(purchase.totalAmount)).toBe(PURCHASE_INVOICE.net);
    expect(rials(purchase.totalTax)).toBe(PURCHASE_INVOICE.vat);
    expect(rials(purchase.finalPayable)).toBe(PURCHASE_INVOICE.payable);

    const posted = await waitForPostedInvoice(page, purchase.id);
    await expectVoucherLines(page, posted.journalEntryId!, PURCHASE_VOUCHER.lines);

    const suppLedger = await partyLedger(page, '2010', SUPPLIER.code);
    expect(rials(suppLedger.totalDebit)).toBe(EXPECTED_PARTY_SUBLEDGER.supplier.debit);
    expect(rials(suppLedger.totalCredit)).toBe(EXPECTED_PARTY_SUBLEDGER.supplier.credit);
    expect(rials(suppLedger.closing)).toBe(EXPECTED_PARTY_SUBLEDGER.supplier.closing);
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

    const custLedger = await partyLedger(page, '1020', CUSTOMER.code);
    expect(rials(custLedger.totalDebit)).toBe(EXPECTED_PARTY_SUBLEDGER.customer.debit);
    expect(rials(custLedger.totalCredit)).toBe(EXPECTED_PARTY_SUBLEDGER.customer.credit);
    expect(rials(custLedger.closing)).toBe(EXPECTED_PARTY_SUBLEDGER.customer.closing);
  });

  test('09 trial balance and party sub-ledgers match hand-computed figures [T91+T99]', async ({ page }) => {
    const tb = await trialBalance(page);
    expect(tb.balanced, 'the trial balance reports balanced').toBe(true);
    expect(rials(tb.totals.endingDebit)).toBe(TRIAL_BALANCE.totalDebit);
    expect(rials(tb.totals.endingCredit)).toBe(TRIAL_BALANCE.totalCredit);

    const byCode = new Map(tb.rows.map((r) => [r.code, rials(r.endingDebit) - rials(r.endingCredit)]));
    for (const [code, expected] of Object.entries(EXPECTED_BALANCES)) {
      expect(byCode.has(code), `account ${code} is in the trial balance`).toBe(true);
      expect(byCode.get(code), `balance of account ${code} (debit positive)`).toBe(expected);
    }

    const subsidiary = await getApi<{
      rows: Array<{ code: string; periodDebit: Money; periodCredit: Money; endingDebit: Money; endingCredit: Money }>;
    }>(page, `accounting/reports/subsidiary?fiscalYearId=${state.fiscalYearId}`);
    const custSub = subsidiary.rows.find((r) => r.code === `1020/${CUSTOMER.code}`);
    expect(custSub, `subsidiary row 1020/${CUSTOMER.code}`).toBeDefined();
    expect(rials(custSub!.periodDebit)).toBe(EXPECTED_PARTY_SUBLEDGER.customer.debit);
    expect(rials(custSub!.periodCredit)).toBe(EXPECTED_PARTY_SUBLEDGER.customer.credit);
    expect(rials(custSub!.endingDebit) - rials(custSub!.endingCredit)).toBe(EXPECTED_PARTY_SUBLEDGER.customer.closing);

    const suppSub = subsidiary.rows.find((r) => r.code === `2010/${SUPPLIER.code}`);
    expect(suppSub, `subsidiary row 2010/${SUPPLIER.code}`).toBeDefined();
    expect(rials(suppSub!.periodDebit)).toBe(EXPECTED_PARTY_SUBLEDGER.supplier.debit);
    expect(rials(suppSub!.periodCredit)).toBe(EXPECTED_PARTY_SUBLEDGER.supplier.credit);
    expect(rials(suppSub!.endingDebit) - rials(suppSub!.endingCredit)).toBe(EXPECTED_PARTY_SUBLEDGER.supplier.closing);
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
