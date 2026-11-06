import { test, expect, fa, findSessionFile, loginAsTestTenant, SESSION_STORAGE_KEY } from '../app/fixtures';
import * as fs from 'node:fs';
import type { Page } from '@playwright/test';
import { M1_EXPECTED_CLOSING, M1_MONTH_OPERATIONS, README_TOTALS, sumDelta } from './m1/expected-totals';
import {
  bankStatementRollForward,
  computeTotalsFromCsv,
  fifoPurchaseAmountSum,
  fifoStockTrace,
  fixtureClosingStockValue,
  fixtureOpeningBalance,
  parseFixtureInvoices,
  readCsv,
  readReadmeTotals,
  SAMPLE_COMPANY_FILES,
  sortInvoices,
  toRial,
} from './m1/fixture-data';
import { apiGet, apiPost, apiPut, importFile, issueAndWait, payAndWait, persianise, rials } from './m1/import-ui';

/**
 * M1 "Shop-ready" acceptance gate (issue #116, epic E0): one month of the fictional trading company in
 * e2e/fixtures/sample-company/ (synthetic data only), from import to a balanced trial balance.
 *
 * Every gate step is its own test so the distance to M1 is visible in the report: an epic turns its steps
 * green by changing `test.fixme(` into `test(` and filling the body. Step list and owners:
 * docs/testing/M1_GATE.md.
 *
 *   npx playwright test m1-shop-month --list        # no server needed
 *   npx playwright test m1-shop-month               # self-check runs; gate steps skip without a sandbox
 *
 * Against the Gate 3 sandbox (scripts/infra/e2e/sandbox_up.sh), with a fresh tenant for the gate:
 *   bash scripts/infra/e2e/mkuser.sh m1             # prints SESSION_FILE=...
 *   set -a; source "${TMPDIR:-/tmp}/rxtest/out/app_e2e.env"; set +a
 *   E2E_BASE_URL=$APP_E2E_BASE_URL APP_E2E_SESSION_FILE_M1=<SESSION_FILE> npx playwright test m1-shop-month
 *
 * The gate writes data, so it only runs against a loopback sandbox unless M1_E2E_ALLOW_REMOTE=1.
 */

// Fixture self-check: pure file reads, no browser and no server. Keeps the expected totals honest.
test.describe('M1 gate · fixture self-check', () => {
  test('expected totals constant mirrors README.md lines 10-19', () => {
    expect(readReadmeTotals()).toEqual(README_TOTALS);
  });

  test('fixture CSV files reproduce every README total', () => {
    expect(computeTotalsFromCsv()).toEqual(README_TOTALS);
    expect(README_TOTALS.openingDebit).toBe(README_TOTALS.openingCredit);
  });

  test('bank statement rolls forward from the opening 1101 balance to its closing balance', () => {
    const roll = bankStatementRollForward();
    expect(roll.computedClosing).toBe(roll.statedClosing);
    expect(roll.statedClosing).toBe(README_TOTALS.bankClosingBalance);
  });

  test('expected month-end closing derives from README totals plus the hand-entered documents', () => {
    // The stock closing is an independent replay of the CSVs (fixtureClosingStockValue in
    // fixture-data.ts), not the README opening: opening stock + purchases («مبلغ», excl. VAT)
    // - COGS (FIFO cost of the sale lines). expected-totals may not import fixture-data back
    // (fixture-data imports it), so the assembly with the hand-entered stock operations happens here.
    const invoices = parseFixtureInvoices();
    const trace = fifoStockTrace(invoices);
    expect(trace.oversold, 'no sale may exceed the running stock at its date (shortage 0 units)').toHaveLength(0);
    expect(trace.totalOpeningValue).toBe(README_TOTALS.stockValue);
    const purchasesValue = fifoPurchaseAmountSum(invoices);
    const cogsValue = [...trace.consumedBySale.values()].reduce((acc, c) => acc + c, 0n);
    const stockOpsDelta = sumDelta('stockDelta'); // -14,900,000 (POS sale) + 14,900,000 (return): cancels out
    const replayClosing = fixtureClosingStockValue();
    // Architect-verified figures, asserted as literals.
    expect(purchasesValue).toBe(5_671_900_000n);
    expect(cogsValue).toBe(8_315_400_000n);
    expect(stockOpsDelta).toBe(0n);
    expect(replayClosing).toBe(249_383_200_000n); // 252,026,700,000 + 5,671,900,000 - 8,315,400,000
    expect(replayClosing + stockOpsDelta).toBe(M1_EXPECTED_CLOSING.stockValue);

    expect(M1_EXPECTED_CLOSING).toEqual({
      receivables: 9_396_312_500n,
      payables: 5_420_780_000n,
      stockValue: 249_383_200_000n,
      bankBalance: 2_485_000_000n,
    });
  });
});

test.describe('M1 gate · one month of «سپهر البرز نمونه»', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ sessionKind: 'm1' });

  // Runs before the test's own fixtures, so a missing session skips instead of failing in `context`.
  test.beforeEach(({ baseURL }, testInfo) => {
    testInfo.skip(
      !findSessionFile('m1', testInfo.project.name),
      'no sandbox session: set APP_E2E_SESSION_FILE_M1 (scripts/infra/e2e/mkuser.sh m1)',
    );
    const host = baseURL ? new URL(baseURL).hostname : '';
    testInfo.skip(
      !['127.0.0.1', 'localhost'].includes(host) && process.env.M1_E2E_ALLOW_REMOTE !== '1',
      `the gate writes data; refusing ${baseURL ?? 'no baseURL'} (set E2E_BASE_URL to the sandbox)`,
    );
  });

  test('01 log in as the seeded test tenant [E0]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/import');
  });

  // ---- Import the fixture files (/app/import) ----------------------------------------------------------

  test('02 import chart of accounts: 18 accounts [E5]', async ({ page }) => {
    const { header, rows } = readCsv(SAMPLE_COMPANY_FILES.chartOfAccounts);
    expect(rows).toHaveLength(18);
    const counts = await importFile(page, SAMPLE_COMPANY_FILES.chartOfAccounts, 'accounting-accounts', {
      'کد حساب': 'code',
      'نام حساب': 'name',
      'ماهیت حساب': 'accountType',
      'واحد پول': 'currency',
    });
    expect(counts).toEqual({ inserted: 18, skippedDuplicates: 0, failed: 0 });

    const types: Record<string, string> = {
      دارایی: 'ASSET',
      بدهی: 'LIABILITY',
      سرمایه: 'EQUITY',
      درآمد: 'REVENUE',
      هزینه: 'EXPENSE',
    };
    const accounts = await apiGet<Array<{ code: string; name: string; accountType: string; currency: string }>>(
      page,
      'accounting/accounts',
    );
    expect(accounts, 'exactly the 18 file accounts, no seeded default chart mixed in').toHaveLength(18);
    for (const row of rows) {
      const code = row[header.indexOf('کد حساب')];
      const account = accounts.find((a) => a.code === code);
      expect(account, `account ${code}`).toBeDefined();
      expect(account!.name).toBe(row[header.indexOf('نام حساب')]);
      expect(account!.accountType).toBe(types[row[header.indexOf('ماهیت حساب')]]);
      expect(account!.currency).toBe('IRR');
    }
    for (const code of ['1101', '1201', '1301', '2101']) expect(accounts.map((a) => a.code)).toContain(code);

    // The chart page lists the same 18 accounts.
    await loginAsTestTenant(page, '/app/accounting');
    const tree = page.locator('[data-slot="card"]').filter({ hasText: 'سرفصل حساب‌ها' });
    await expect(tree.locator('tbody tr')).toHaveCount(18);
  });

  test('03 import customers and suppliers: 48 unique parties, 2 duplicates dropped [E5]', async ({ page }) => {
    const { header, rows } = readCsv(SAMPLE_COMPANY_FILES.parties);
    const cell = (row: string[], column: string) => row[header.indexOf(column)];
    const codes = rows.map((r) => cell(r, 'کد طرف حساب'));
    expect(rows).toHaveLength(50);
    expect(new Set(codes).size).toBe(48); // the file: 30 customers + 20 suppliers, 2 rows repeated

    // The distinct parties by code (first row wins) and their roles, computed from the file.
    const distinct = new Map<string, string[]>();
    for (const row of rows) if (!distinct.has(cell(row, 'کد طرف حساب'))) distinct.set(cell(row, 'کد طرف حساب'), row);
    const roleOf = (row: string[]) => {
      const text = cell(row, 'نقش').replace(/\u200c/g, ' ');
      if (text === 'مشتری') return 'customer';
      if (text === 'تأمین کننده') return 'supplier';
      throw new Error(`unexpected role «${text}» in the fixture`);
    };
    const expectedRoles = { customer: 0, supplier: 0 };
    for (const row of distinct.values()) expectedRoles[roleOf(row) as 'customer' | 'supplier'] += 1;
    expect(expectedRoles).toEqual({ customer: 29, supplier: 19 }); // 30 + 20 minus the two repeated rows

    const counts = await importFile(page, SAMPLE_COMPANY_FILES.parties, 'parties', {
      'کد طرف حساب': 'code',
      'نقش': 'role',
      'نام و نام خانوادگی': 'name',
      'شرکت': null, // the party master has no company column (follow-up)
      'رایانامه': 'email',
      'تلفن': 'phone',
      'شناسه ملی / کد اقتصادی آزمایشی': 'nationalId',
      'مرحله فروش': null, // a CRM pipeline field, not a party field
      'ارزش برآوردی (ریال)': null, // a CRM pipeline field
      'توضیحات': null,
    });
    expect(counts).toEqual({ inserted: 48, skippedDuplicates: 2, failed: 0 });

    const parties = await apiGet<{
      total: number;
      data: Array<{ code: string; name: string; role: string; nationalId: string | null; phone: string | null; email: string | null; active: boolean }>;
    }>(page, 'parties?limit=200');
    expect(parties.total).toBe(48);
    expect(parties.data.map((p) => p.code).sort()).toEqual([...distinct.keys()].sort());
    // The file mixes Persian (۰-۹) and Arabic-Indic (٠-٩) digits; the importer stores ASCII digits.
    const ascii = (text: string) =>
      text.replace(/[۰-۹٠-٩]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(d) % 10));
    for (const [code, row] of distinct) {
      const party = parties.data.find((p) => p.code === code);
      expect(party, `party ${code}`).toBeDefined();
      expect(party!.role, `role of ${code}`).toBe(roleOf(row));
      expect(party!.nationalId, `national id of ${code}`).toBe(ascii(cell(row, 'شناسه ملی / کد اقتصادی آزمایشی')));
      expect(party!.name, `name of ${code}`).toBe(persianise(cell(row, 'نام و نام خانوادگی')));
      expect(party!.phone, `phone of ${code}`).toBe(ascii(cell(row, 'تلفن')));
      expect(party!.email, `email of ${code}`).toBe(cell(row, 'رایانامه'));
      expect(party!.active).toBe(true);
      expect(`${party!.name}`, 'Arabic ي/ك normalised').not.toMatch(/[يك]/);
    }
    expect(parties.data.filter((p) => p.role === 'customer')).toHaveLength(expectedRoles.customer);
    expect(parties.data.filter((p) => p.role === 'supplier')).toHaveLength(expectedRoles.supplier);
    expect(parties.data.filter((p) => p.code.startsWith('CUST-'))).toHaveLength(29);
    expect(parties.data.filter((p) => p.code.startsWith('SUPP-'))).toHaveLength(19);
  });

  // Items carry unit cost into FIFO layers (#470); the import posts no voucher, 1301 comes from step 05.
  test('04 import items: 300 items with stock and unit cost [E5]', async ({ page }) => {
    const { header, rows } = readCsv(SAMPLE_COMPANY_FILES.items);
    expect(rows).toHaveLength(300);

    // Compute expectedValue = sum over rows of BigInt(quantity) * BigInt(unit cost)
    const expectedValue = rows.reduce((acc, row) => {
      const quantity = toRial(row[header.indexOf('موجودی')]); // cells may hold Persian digits
      const unitCost = toRial(row[header.indexOf('بهای واحد (ریال)')]);
      return acc + (quantity * unitCost);
    }, 0n);
    expect(expectedValue).toBe(README_TOTALS.stockValue);

    // Import the items file
    const counts = await importFile(page, SAMPLE_COMPANY_FILES.items, 'inventory-items', {
      'کد کالا': 'sku',
      'بارکد': 'barcode',
      'نام کالا': 'name',
      'موجودی': 'quantity',
      'حداقل موجودی': 'minQuantity',
      'بهای واحد (ریال)': 'unitCost',
      'ارزش موجودی (ریال)': null, // Derived from quantity x cost, so ignored
      'شماره دسته': 'batchNumber'
    });
    expect(counts).toEqual({ inserted: 300, skippedDuplicates: 0, failed: 0 });

    // API checks
    const valuation = await apiGet<{ itemCount: number; totalInventoryValue: number | string; totalOpenBatches: number; rows: unknown[] }>(page, 'inventory/valuation');
    expect(valuation.itemCount).toBe(300);
    expect(rials(valuation.totalInventoryValue)).toBe(README_TOTALS.stockValue);
    expect(valuation.totalOpenBatches).toBe(300);

    // Check inventory items
    const firstSku = rows[0][header.indexOf('کد کالا')];
    const itemsPage1 = await apiGet<{ total: number; data: Array<{ sku: string; quantity: number }> }>(page, 'inventory/items?limit=100&page=1');
    const itemsPage2 = await apiGet<{ total: number; data: Array<{ sku: string; quantity: number }> }>(page, 'inventory/items?limit=100&page=2');
    const itemsPage3 = await apiGet<{ total: number; data: Array<{ sku: string; quantity: number }> }>(page, 'inventory/items?limit=100&page=3');

    const allItems = [...itemsPage1.data, ...itemsPage2.data, ...itemsPage3.data];
    expect(allItems.length).toBe(300);
    expect(itemsPage1.total).toBe(300);

    // Verify each item's quantity matches the CSV
    for (const row of rows) {
      const sku = row[header.indexOf('کد کالا')];
      const csvQuantity = Number(toRial(row[header.indexOf('موجودی')]));
      const item = allItems.find((i) => i.sku === sku);
      expect(item, `Item ${sku} should exist`).toBeDefined();
      expect(item!.quantity, `Quantity for ${sku} should match`).toBe(csvQuantity);
    }

    // No journal entry was posted by the item import
    const journalEntries = await apiGet<{ total: number }>(page, 'accounting/journal-entries?limit=10');
    expect(journalEntries.total).toBe(0);

    // UI checks
    await loginAsTestTenant(page, '/app/inventory');
    await expect(page.getByText(`${fa(300)} کالا`).first()).toBeVisible();
    await expect(page.getByText(`${fa(Number(README_TOTALS.stockValue))} ریال`).first()).toBeVisible();
    // The list is paged (50 per page, ordered by name), so find the first CSV item through the search box.
    await page.getByLabel('جست‌وجوی کالا').fill(firstSku);
    await expect(page.getByRole('cell', { name: firstSku, exact: true })).toBeVisible();
  });

  test('05 import opening balances: one balanced opening voucher [E5]', async ({ page }) => {
    const { rows } = readCsv(SAMPLE_COMPANY_FILES.openingBalances);
    expect(rows).toHaveLength(14);
    const counts = await importFile(page, SAMPLE_COMPANY_FILES.openingBalances, 'accounting-opening-balances', {
      'کد حساب': 'accountCode',
      'بدهکار (ریال)': 'debit',
      'بستانکار (ریال)': 'credit',
      'تاریخ': 'date',
      'شرح': 'description',
    });
    expect(counts).toEqual({ inserted: 14, skippedDuplicates: 0, failed: 0 });

    const entries = await apiGet<{
      total: number;
      data: Array<{ totalDebit: number | string; totalCredit: number | string; lines: unknown[] }>;
    }>(page, 'accounting/journal-entries?limit=10');
    expect(entries.total, 'one opening voucher').toBe(1);
    const [voucher] = entries.data;
    expect(voucher.lines).toHaveLength(14);
    expect(rials(voucher.totalDebit)).toBe(README_TOTALS.openingDebit);
    expect(rials(voucher.totalCredit)).toBe(README_TOTALS.openingCredit);

    const accounts = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    const balanceOf = (code: string) => rials(accounts.find((a) => a.code === code)!.balance);
    expect(balanceOf('1201')).toBe(README_TOTALS.receivablesOpening);
    expect(balanceOf('2101')).toBe(-README_TOTALS.payablesOpening); // debit-positive: a payable is a credit

    await loginAsTestTenant(page, '/app/accounting');
    const row = page.locator('tr').filter({ hasText: 'مانده‌های افتتاحیه' }).first();
    await expect(row).toContainText(fa(Number(README_TOTALS.openingDebit)));
  });

  test('06 import invoices: 238 distinct invoices (143 sales + 95 purchases), repeated rows counted once [E5]', async ({ page }) => {
    const { header, rows } = readCsv(SAMPLE_COMPANY_FILES.invoices);
    const west = (t: string) =>
      t.replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
    const cell = (row: string[], column: string) => west(row[header.indexOf(column)].trim());
    const numbers = rows.map((r) => cell(r, 'شماره صورتحساب'));
    expect(rows).toHaveLength(360);
    expect(new Set(numbers).size).toBe(238); // README: 360 rows, 2 exact repeats of INV-S-1403-0001 / INV-P-1403-0001
    expect(rows.filter((r) => cell(r, 'کد طرف حساب') === '')).toHaveLength(6); // walk-in rows

    const counts = await importFile(page, SAMPLE_COMPANY_FILES.invoices, 'sales-invoices', {
      'شماره صورتحساب': 'number',
      'نوع صورتحساب': 'type',
      'تاریخ': 'date',
      'کد طرف حساب': 'partyCode',
      'نام طرف حساب': null, // the party comes from the master by code
      'کد کالا': 'itemCode',
      'تعداد': 'quantity',
      'بهای واحد (ریال)': 'unitPrice',
      'مبلغ': 'amount',
      'مالیات ارزش افزوده': 'vat',
      'جمع نهایی (ریال)': 'totalRial',
      'ارز': 'currency',
      'نرخ تسعیر': 'fxRate',
      'وضعیت تسویه': null, // import creates drafts; posting and settlement come in later steps
    });
    expect(counts).toMatchObject({ skippedDuplicates: 2, failed: 0 }); // 358 line rows become 238 invoices

    type Invoice = {
      taxInvoiceNumber: string;
      direction: string;
      status: string;
      items: unknown[];
      buyerInfo?: { name?: string };
    };
    const all: Invoice[] = [];
    for (let page_ = 1; page_ <= 3; page_ += 1) {
      all.push(...(await apiGet<{ data: Invoice[] }>(page, `invoicing?limit=100&page=${page_}`)).data);
    }
    expect(all).toHaveLength(238);
    expect(all.filter((i) => i.direction === 'SALE')).toHaveLength(143);
    expect(all.filter((i) => i.direction === 'PURCHASE')).toHaveLength(95);
    expect(new Set(all.map((i) => i.status))).toEqual(new Set(['DRAFT'])); // not posted: steps 07 and 08 post them

    // A multi-line invoice keeps every distinct line; the repeated row is not a second line.
    const linesOf = (n: string) => new Set(rows.filter((r) => cell(r, 'شماره صورتحساب') === n).map((r) => r.join('|'))).size;
    const multi = [...new Set(numbers)].find((n) => linesOf(n) > 1)!;
    expect(all.find((i) => i.taxInvoiceNumber === multi)!.items).toHaveLength(linesOf(multi));
    expect(all.find((i) => i.taxInvoiceNumber === 'INV-S-1403-0001')!.items).toHaveLength(1);

    // Blank-party rows are walk-in sales, not a placeholder party.
    const walkIns = new Set(rows.filter((r) => cell(r, 'کد طرف حساب') === '').map((r) => cell(r, 'شماره صورتحساب')));
    for (const n of walkIns) expect(all.find((i) => i.taxInvoiceNumber === n)!.buyerInfo?.name).toBe('مشتری گذری');
    expect(all.some((i) => i.buyerInfo?.name?.startsWith('طرف حساب'))).toBe(false);
    // Receivable/payable closing totals are proved at steps 13 and 14, after posting.
  });

  // ---- Post the month ----------------------------------------------------------------------------------

  // The invoice fields steps 07 and 08 need from the list and by-id endpoints.
  type ListedInvoice = {
    id: string;
    taxInvoiceNumber: string;
    direction: string;
    status: string;
    journalEntryId: number | null;
    postingError: string | null;
    finalPayable: number;
  };
  const listInvoices = async (page: Page): Promise<ListedInvoice[]> => {
    const all: ListedInvoice[] = [];
    for (let page_ = 1; page_ <= 3; page_ += 1) {
      all.push(...(await apiGet<{ data: ListedInvoice[] }>(page, `invoicing?limit=100&page=${page_}`)).data);
    }
    expect(all, 'every imported invoice is listed').toHaveLength(238);
    return all;
  };
  /** One account's balance from `accounting/accounts` (debit-positive). */
  const balanceOf = (accounts: Array<{ code: string; balance: number | string }>, code: string): bigint =>
    rials(accounts.find((a) => a.code === code)!.balance);

  // The invoice fields the POS-sale and return steps read back by id (a subset of InvoiceResponseDto).
  type PostedInvoice = {
    id: string;
    taxInvoiceNumber: string;
    direction: string;
    subject: number;
    status: string;
    relatedInvoiceId: string | null;
    finalPayable: number;
    journalEntryId: number | null;
    paidJournalEntryId: number | null;
    postingError: string | null;
  };
  /** Polls GET invoicing/:id until the asynchronous posting finishes (issue voucher, plus settlement when asked). */
  const waitForInvoice = async (
    page: Page,
    invoiceId: string,
    options: { paid?: boolean } = {},
  ): Promise<PostedInvoice> => {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const invoice = await apiGet<PostedInvoice>(page, `invoicing/${invoiceId}`);
      if (invoice.postingError !== null) {
        throw new Error(`invoice ${invoiceId}: posting failed: ${invoice.postingError}`);
      }
      if (invoice.journalEntryId !== null && (!options.paid || invoice.paidJournalEntryId !== null)) {
        return invoice;
      }
      if (Date.now() > deadline) {
        throw new Error(`invoice ${invoiceId}: no voucher and no error 30 s after the request`);
      }
      await page.waitForTimeout(500);
    }
  };
  /** The id of the first invoice with this number; the list grows through the gate, so no total is asserted. */
  const findInvoiceIdByNumber = async (page: Page, number: string): Promise<string> => {
    for (let page_ = 1; page_ <= 5; page_ += 1) {
      const listed = await apiGet<{ data: Array<{ id: string; taxInvoiceNumber: string }> }>(
        page,
        `invoicing?limit=100&page=${page_}`,
      );
      const found = listed.data.find((i) => i.taxInvoiceNumber === number);
      if (found) return found.id;
      if (listed.data.length < 100) break;
    }
    throw new Error(`invoice ${number} is not in the list`);
  };
  type VoucherLine = { accountCode: string; description?: string; debit: number | string; credit: number | string };
  /** One voucher by id; fails unless it is balanced, and returns it with every line. */
  const journalVoucher = async (
    page: Page,
    entryId: number,
  ): Promise<{ lines: VoucherLine[]; totalDebit: number | string; totalCredit: number | string }> => {
    const voucher = await apiGet<{
      lines: VoucherLine[];
      totalDebit: number | string;
      totalCredit: number | string;
    }>(page, `accounting/journal-entries/${entryId}`);
    expect(rials(voucher.totalDebit), `voucher ${entryId} is balanced`).toBe(rials(voucher.totalCredit));
    return voucher;
  };
  const voucherLineText = (voucher: { lines: VoucherLine[] }): string =>
    voucher.lines.map((l) => `${l.accountCode} debit ${l.debit} credit ${l.credit}`).join('; ');
  const debitOf = (lines: VoucherLine[], code: string): bigint =>
    lines.filter((l) => l.accountCode === code).reduce((acc, l) => acc + rials(l.debit), 0n);
  const creditOf = (lines: VoucherLine[], code: string): bigint =>
    lines.filter((l) => l.accountCode === code).reduce((acc, l) => acc + rials(l.credit), 0n);

  test('07 post purchase invoices: stock in, payables up [E2]', async ({ page }) => {
    test.setTimeout(1_800_000); // the API allows 100 requests/min per IP: ~600 calls take minutes
    await loginAsTestTenant(page, '/app/invoicing');

    // The fixture treats cash as petty cash 1102; the bank 1101 only moves through the statement
    // (step 12). Name matching alone picks the bank («بانک») for the 'cash' role, so pin the tenant
    // mapping — it wins over name matching (mergeRoleAccounts in invoicing/services/invoice-voucher.ts).
    const cashDocTypes = [
      'invoice.purchase.settle',
      'invoice.purchase.settle_card_first',
      'invoice.sale.settle',
      'invoice.sale.settle_card_first',
    ] as const;
    for (const docType of cashDocTypes) {
      const status = await apiPut(page, `posting-rules/${docType}/roles/cash`, { accountCode: '1102' });
      expect(status, `PUT posting-rules ${docType} cash -> 1102`).toBe(204);
    }
    const postingTemplates = await apiGet<
      Array<{ docType: string; roles: Array<{ role: string; accountCode: string | null; source: string }> }>
    >(page, 'posting-rules');
    for (const docType of cashDocTypes) {
      const cash = postingTemplates.find((t) => t.docType === docType)?.roles.find((r) => r.role === 'cash');
      expect(cash, `${docType} lists a cash role`).toBeDefined();
      expect(cash!.accountCode, `${docType} cash account`).toBe('1102');
      expect(cash!.source, `${docType} cash mapping must win over the default`).not.toBe('default');
    }
    test.info().annotations.push({
      type: 'posting-rules',
      description: `cash -> 1102 pinned (source != default) for ${cashDocTypes.join(', ')}`,
    });

    // No receivable mapping: the resolver must pick trade receivables 1201 by itself, not notes 1110 (#504).

    // Fixture-derived expectations (independent of any product output).
    const invoices = parseFixtureInvoices();
    const purchases = sortInvoices(invoices.filter((i) => i.direction === 'PURCHASE'));
    expect(purchases).toHaveLength(95);
    const unpaidPurchases = purchases.filter((i) => !i.settled).reduce((acc, i) => acc + i.totalInclVat, 0n);
    const settled = purchases.filter((i) => i.settled);
    const settledPurchases = settled.reduce((acc, i) => acc + i.totalInclVat, 0n);
    const allPurchases = purchases.reduce((acc, i) => acc + i.totalInclVat, 0n);
    // Hand-computed from the fixture, asserted as literals as a cross-check of the parsing above.
    expect(unpaidPurchases).toBe(4_300_780_000n);
    expect(settledPurchases).toBe(1_938_310_000n);
    expect(allPurchases).toBe(6_239_090_000n);
    // README tie-out: the README closing payables counts UNPAID purchases only. The settled remainder
    // (1,938,310,000) is paid at the END of this step — 07 posts every imported invoice, then settles
    // the «تسویه‌شده» ones, so 2101 lands exactly on the README closing. Leaving the settled ones as
    // drafts would hide documents from the ledger and the stock register.
    expect(README_TOTALS.payablesOpening + unpaidPurchases).toBe(README_TOTALS.payablesClosingUnique);
    // Stock in: every purchase line excl. VAT («مبلغ»).
    const purchaseAmountSum = purchases.reduce((acc, i) => acc + i.lines.reduce((a, l) => a + l.amount, 0n), 0n);
    // Input VAT per invoice = total incl. VAT - its lines excl. VAT, summed over the 95.
    const purchaseVatSum = purchases.reduce(
      (acc, i) => acc + i.totalInclVat - i.lines.reduce((a, l) => a + l.amount, 0n),
      0n,
    );

    // The drafts this step is about to post: exactly 95, all DRAFT.
    const before = await listInvoices(page);
    const draftPurchases = before.filter((i) => i.direction === 'PURCHASE');
    expect(draftPurchases).toHaveLength(95);
    expect(draftPurchases.filter((i) => i.status === 'DRAFT')).toHaveLength(95);

    // Posting must use the chart imported in step 02 and never create accounts: the code set is exactly
    // the 18 codes of chart-of-accounts.csv.
    const chart = readCsv(SAMPLE_COMPANY_FILES.chartOfAccounts);
    const fileCodes = chart.rows.map((r) => r[chart.header.indexOf('کد حساب')]);
    const accountsBefore = await apiGet<Array<{ code: string; name?: string; balance: number | string }>>(page, 'accounting/accounts');
    expect(
      new Set(accountsBefore.map((a) => a.code)),
      'accounts before posting are exactly the 18 imported in step 02',
    ).toEqual(new Set(fileCodes));
    const vouchersBefore = (await apiGet<{ total: number }>(page, 'accounting/journal-entries?limit=10')).total;

    // Issue strictly one at a time (date ascending, ties by number) so FIFO order holds.
    const idByNumber = new Map(before.map((i) => [i.taxInvoiceNumber, i.id]));
    let firstPosted: { invoice: (typeof purchases)[number]; entryId: number; finalPayable: bigint } | null = null;
    for (const invoice of purchases) {
      const issued = await issueAndWait(page, idByNumber.get(invoice.number)!, invoice.number);
      if (!firstPosted && issued.journalEntryId !== null) {
        firstPosted = { invoice, entryId: issued.journalEntryId, finalPayable: rials(issued.finalPayable) };
      }
    }

    // After: every purchase is ISSUED with a voucher and no error; no purchase draft remains.
    const after = await listInvoices(page);
    const issuedPurchases = after.filter((i) => i.direction === 'PURCHASE');
    expect(issuedPurchases).toHaveLength(95);
    for (const invoice of purchases) {
      const posted = issuedPurchases.find((i) => i.taxInvoiceNumber === invoice.number)!;
      expect(posted.status, invoice.number).toBe('ISSUED');
      expect(posted.postingError, invoice.number).toBeNull();
      expect(posted.journalEntryId, invoice.number).not.toBeNull();
    }

    // One issue voucher per invoice, computed from the CSV (95 issues + the settlements paid below):
    // stock, purchases and input VAT post on the same issue voucher, so no extra voucher is expected.
    // A different real delta fails here with the numbers in the message.
    const vouchersAfterIssue = (await apiGet<{ total: number }>(page, 'accounting/journal-entries?limit=10')).total;
    test.info().annotations.push({
      type: 'vouchers',
      description: `issuing ${purchases.length} purchase invoices moved the voucher count from ${vouchersBefore} to ${vouchersAfterIssue} (delta ${vouchersAfterIssue - vouchersBefore})`,
    });
    expect(
      vouchersAfterIssue - vouchersBefore,
      `one issue voucher per purchase invoice: ${purchases.length} invoices issued, real delta ${vouchersAfterIssue - vouchersBefore}`,
    ).toBe(purchases.length);

    // 2101 (credit-positive, hence -balance as step 05 does) measured right after issuing, before any
    // settlement: payables opening + every unique purchase incl. VAT = 7,359,090,000. The settled
    // 1,938,310,000 comes back off below, landing 2101 on the README closing at the end of this step.
    const accountsAfterIssue = await apiGet<Array<{ code: string; name?: string; balance: number | string }>>(page, 'accounting/accounts');
    // Every purchase line is stock (stock == net, the purchases row is zero), so no purchases account 5201
    // is created (#497 a). 1401 exists in the chart as «پیش‌پرداخت خرید و اجاره», so input VAT gets its own
    // new account under the next free code, 1402 (#504). Assert the EXACT real set, code and name.
    const createdAfterIssue = accountsAfterIssue
      .filter((a) => !fileCodes.includes(a.code))
      .map((a) => ({ code: a.code, name: a.name ?? '' }))
      .sort((a, b) => a.code.localeCompare(b.code));
    expect(createdAfterIssue, 'the issue phase creates only the input-VAT account 1402').toEqual([
      { code: '1402', name: 'مالیات بر ارزش افزوده خرید (اعتبار مالیاتی)' },
    ]);
    const balanceAfterIssue = (code: string) => balanceOf(accountsAfterIssue, code);
    const balanceBeforeIssue = (code: string) => balanceOf(accountsBefore, code);
    const payableAfterIssue = -balanceAfterIssue('2101');
    expect(payableAfterIssue).toBe(7_359_090_000n);
    expect(payableAfterIssue).toBe(README_TOTALS.payablesOpening + allPurchases);
    // Hand-computed deltas after the issue phase (balances are debit-positive).
    expect(balanceAfterIssue('1301') - balanceBeforeIssue('1301'), 'stock in = purchase lines excl. VAT').toBe(
      purchaseAmountSum,
    );
    expect(
      -(balanceAfterIssue('2101') - balanceBeforeIssue('2101')),
      'payables up by every purchase incl. VAT (credit)',
    ).toBe(allPurchases);
    expect(accountsAfterIssue.some((a) => a.code === '5201'), 'no purchases account: no line uses it').toBe(false);
    test.info().annotations.push({
      type: 'account-created',
      description: '1402 مالیات بر ارزش افزوده خرید (اعتبار مالیاتی) created for input VAT; 5201 not created',
    });

    // Stock in: 1301 value = opening stock (README) + every purchase line excl. VAT.
    const valuation = await apiGet<{ totalInventoryValue: number | string; rows: Array<{ sku: string; quantity: number; fifoValue: number | string }> }>(
      page,
      'inventory/valuation',
    );
    expect(rials(valuation.totalInventoryValue)).toBe(README_TOTALS.stockValue + purchaseAmountSum);

    // Sampled items: ITM-1001 and one item of a multi-line purchase — quantity and FIFO value.
    const itemsCsv = readCsv(SAMPLE_COMPANY_FILES.items);
    const iSku = itemsCsv.header.indexOf('کد کالا');
    const iQty = itemsCsv.header.indexOf('موجودی');
    const iCost = itemsCsv.header.indexOf('بهای واحد (ریال)');
    const openingOf = (sku: string) => {
      const row = itemsCsv.rows.find((r) => r[iSku] === sku)!;
      return { quantity: toRial(row[iQty]), unitCost: toRial(row[iCost]) };
    };
    const itemQuantity = async (sku: string) => {
      const items: Array<{ sku: string; quantity: number }> = [];
      for (let page_ = 1; page_ <= 3; page_ += 1) {
        items.push(...(await apiGet<{ data: Array<{ sku: string; quantity: number }> }>(page, `inventory/items?limit=100&page=${page_}`)).data);
      }
      const item = items.find((i) => i.sku === sku);
      expect(item, `item ${sku} is listed`).toBeDefined();
      return item!.quantity;
    };
    const multi = purchases.find((i) => i.lines.length > 1)!;
    const samples = ['ITM-1001', multi.lines[0].itemCode];
    for (const sku of samples) {
      const opening = openingOf(sku);
      const lines = purchases.flatMap((i) => i.lines).filter((l) => l.itemCode === sku);
      const expectedQuantity = opening.quantity + lines.reduce((acc, l) => acc + BigInt(l.quantity), 0n);
      const expectedValue = opening.quantity * opening.unitCost + lines.reduce((acc, l) => acc + l.amount, 0n);
      expect(BigInt(await itemQuantity(sku)), `quantity of ${sku} after the purchases`).toBe(expectedQuantity);
      // The valuation endpoint reports a per-item fifoValue row, so the value is asserted too.
      const row = valuation.rows.find((r) => r.sku === sku)!;
      expect(rials(row.fifoValue), `FIFO value of ${sku} after the purchases`).toBe(expectedValue);
    }

    // The first posted voucher: purchases credit 2101 (payables) with the invoice's final payable,
    // and the voucher is balanced. Every line's account code is attached as evidence.
    expect(firstPosted, 'at least one purchase posted').not.toBeNull();
    const voucher = await apiGet<{
      lines: Array<{ accountCode: string; description?: string; debit: number | string; credit: number | string }>;
      totalDebit: number | string;
      totalCredit: number | string;
    }>(page, `accounting/journal-entries/${firstPosted!.entryId}`);
    test.info().annotations.push({
      type: 'voucher',
      description: `${firstPosted!.invoice.number}: ${voucher.lines
        .map((l) => `${l.accountCode} debit ${l.debit} credit ${l.credit}`)
        .join('; ')}`,
    });
    expect(rials(voucher.totalDebit), 'the purchase voucher is balanced').toBe(rials(voucher.totalCredit));
    const payableLine = voucher.lines.find((l) => l.accountCode === '2101');
    expect(payableLine, 'the purchase voucher credits 2101').toBeDefined();
    expect(rials(payableLine!.credit), `credit of 2101 in ${firstPosted!.invoice.number}`).toBe(firstPosted!.finalPayable);

    // Input VAT: the account the product actually uses on the «مالیات بر ارزش افزوده خرید» line,
    // read from the voucher rather than assumed; its whole-step delta is the fixture purchase VAT.
    const inputVatLine = voucher.lines.find((l) => l.description === 'مالیات بر ارزش افزوده خرید');
    expect(inputVatLine, 'the purchase voucher has the input-VAT line').toBeDefined();
    const inputVatCode = inputVatLine!.accountCode;
    const inputVatName = accountsAfterIssue.find((a) => a.code === inputVatCode)?.name ?? '';
    test.info().annotations.push({
      type: 'input-vat',
      description: `input VAT account ${inputVatCode} ${inputVatName}`,
    });
    expect(inputVatCode, 'input VAT lands on the new account 1402, not on prepayments 1401').toBe('1402');
    expect(
      // 1402 did not exist before the issue phase: it starts at 0.
      balanceAfterIssue(inputVatCode) - (accountsBefore.some((b) => b.code === inputVatCode) ? balanceBeforeIssue(inputVatCode) : 0n),
      `input VAT ${inputVatCode} up by the purchase VAT`,
    ).toBe(purchaseVatSum);
    // Hand-computed from invoices.csv (sum of total incl. VAT minus lines for the 95 purchases): 567,190,000.
    expect(purchaseVatSum).toBe(567_190_000n);
    expect(balanceAfterIssue('1401'), '1401 prepayments stays at its opening').toBe(balanceBeforeIssue('1401'));

    // ---- Settle the «تسویه‌شده» purchases through the user's status path -----------------------------
    // payAndWait mirrors the invoicing page's pay button (PATCH invoicing/:id/pay), one invoice at a
    // time, in the same date order as the issues.
    expect(settled, 'the fixture marks settled purchases to pay').not.toHaveLength(0);
    const paidEntryByNumber = new Map<string, number>();
    for (const invoice of settled) {
      const paid = await payAndWait(page, idByNumber.get(invoice.number)!, invoice.number);
      paidEntryByNumber.set(invoice.number, paid.paidJournalEntryId!);
    }
    const afterPaying = await listInvoices(page);
    for (const invoice of settled) {
      expect(afterPaying.find((i) => i.taxInvoiceNumber === invoice.number)!.status, invoice.number).toBe('PAID');
    }

    // Voucher delta after settling, computed from the CSV: one issue voucher per invoice + one
    // settlement voucher per settled invoice (95 + 72 here). A different real delta fails with the
    // real numbers in the message.
    const vouchersAtEnd = (await apiGet<{ total: number }>(page, 'accounting/journal-entries?limit=10')).total;
    test.info().annotations.push({
      type: 'vouchers',
      description: `paying ${settled.length} settled purchases moved the voucher count to ${vouchersAtEnd} (total delta ${vouchersAtEnd - vouchersBefore} = ${purchases.length} issues + ${settled.length} settlements)`,
    });
    expect(
      vouchersAtEnd - vouchersBefore,
      `one issue voucher per purchase invoice plus one settlement voucher per settled purchase: ${purchases.length} + ${settled.length} expected, real delta ${vouchersAtEnd - vouchersBefore}`,
    ).toBe(purchases.length + settled.length);

    // Fetch EVERY settlement voucher: balanced, and never touching the bank 1101 — the README bank
    // closing is the reconciled statement balance, moved only by the statement itself (step 12), so
    // the counter side must be the pinned petty cash 1102, not 1101.
    const settlementVouchers: Array<{
      number: string;
      lines: Array<{ accountCode: string; debit: number | string; credit: number | string }>;
    }> = [];
    for (const invoice of settled) {
      const settleVoucher = await apiGet<{
        lines: Array<{ accountCode: string; debit: number | string; credit: number | string }>;
        totalDebit: number | string;
        totalCredit: number | string;
      }>(page, `accounting/journal-entries/${paidEntryByNumber.get(invoice.number)!}`);
      settlementVouchers.push({ number: invoice.number, lines: settleVoucher.lines });
      expect(rials(settleVoucher.totalDebit), `settlement voucher of ${invoice.number} is balanced`).toBe(
        rials(settleVoucher.totalCredit),
      );
      expect(
        settleVoucher.lines.filter((l) => l.accountCode === '1101'),
        `settlement of ${invoice.number} must not touch the bank 1101`,
      ).toHaveLength(0);
      // The counter side is the pinned petty-cash account 1102, credited with exactly the settled amount.
      const cashLine = settleVoucher.lines.find((l) => l.accountCode === '1102');
      expect(cashLine, `settlement of ${invoice.number} has a 1102 line`).toBeDefined();
      expect(rials(cashLine!.credit), `1102 credited by ${invoice.number}`).toBe(invoice.totalInclVat);
      expect(rials(cashLine!.debit), `1102 not debited by ${invoice.number}`).toBe(0n);
    }

    // Evidence for the first settled invoice (date order): its settlement voucher, every line
    // annotated, clearing 2101 with exactly the invoice amount.
    const firstSettled = settled[0];
    const firstSettlement = settlementVouchers[0]!;
    test.info().annotations.push({
      type: 'voucher',
      description: `settlement of ${firstSettled.number}: ${firstSettlement.lines
        .map((l) => `${l.accountCode} debit ${l.debit} credit ${l.credit}`)
        .join('; ')}`,
    });
    const cleared = firstSettlement.lines.find((l) => l.accountCode === '2101');
    expect(cleared, `the settlement voucher of ${firstSettled.number} debits 2101`).toBeDefined();
    expect(rials(cleared!.debit), `2101 cleared by ${firstSettled.number}`).toBe(firstSettled.totalInclVat);
    // Which account is the counter side? The pinned petty cash 1102 (never the bank 1101).
    const counterAccounts = new Set(
      settlementVouchers.flatMap((v) => v.lines.map((l) => l.accountCode).filter((code) => code !== '2101')),
    );
    const cashName = accountsAfterIssue.find((a) => a.code === '1102')?.name ?? '';
    test.info().annotations.push({
      type: 'voucher',
      description: `${settlementVouchers.length} settlement vouchers clear 2101 and credit the counter account 1102 ${cashName}; counter-side codes: ${[...counterAccounts].join(', ')}`,
    });

    // End of step 07: 2101 = the README closing payables, exactly — 7,359,090,000 issued minus the
    // settled 1,938,310,000 paid.
    const accountsAtEnd = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    const payableAtEnd = -rials(accountsAtEnd.find((a) => a.code === '2101')!.balance);
    expect(payableAtEnd).toBe(README_TOTALS.payablesClosingUnique);
    expect(payableAtEnd).toBe(5_420_780_000n);
    expect(payableAtEnd).toBe(payableAfterIssue - settledPurchases);
  });

  test('08 post sales invoices: stock out, receivables up [E1]', async ({ page }) => {
    test.setTimeout(1_800_000); // the API allows 100 requests/min per IP: ~600 calls take minutes
    await loginAsTestTenant(page, '/app/invoicing');

    // Fixture-derived expectations, including an independent FIFO replay over opening stock,
    // purchases and sales (a sale beyond the running stock moves no stock — its posting fails whole).
    const invoices = parseFixtureInvoices();
    const sales = sortInvoices(invoices.filter((i) => i.direction === 'SALE'));
    expect(sales).toHaveLength(143);
    const unpaidSales = sales.filter((i) => !i.settled).reduce((acc, i) => acc + i.totalInclVat, 0n);
    const settled = sales.filter((i) => i.settled);
    const settledSales = settled.reduce((acc, i) => acc + i.totalInclVat, 0n);
    const allSales = sales.reduce((acc, i) => acc + i.totalInclVat, 0n);
    // Revenue excl. VAT (sum of the sale lines' «مبلغ») and output VAT per invoice (total - lines).
    const saleLineSum = sales.reduce((acc, i) => acc + i.lines.reduce((a, l) => a + l.amount, 0n), 0n);
    const saleVatSum = sales.reduce(
      (acc, i) => acc + i.totalInclVat - i.lines.reduce((a, l) => a + l.amount, 0n),
      0n,
    );
    const purchaseVatSum = invoices
      .filter((i) => i.direction === 'PURCHASE')
      .reduce((acc, i) => acc + i.totalInclVat - i.lines.reduce((a, l) => a + l.amount, 0n), 0n);
    const settledPurchases = invoices
      .filter((i) => i.direction === 'PURCHASE' && i.settled)
      .reduce((acc, i) => acc + i.totalInclVat, 0n);
    // Hand-computed from the fixture, asserted as literals as a cross-check of the parsing above.
    expect(unpaidSales).toBe(7_613_512_500n);
    expect(settledSales).toBe(3_820_162_500n);
    expect(allSales).toBe(11_433_675_000n);
    // README tie-out: the README closing receivables counts UNPAID sales only. The settled remainder
    // (3,820,162,500) is paid at the END of this step — 08 posts every imported sale invoice, then
    // settles the «تسویه‌شده» ones, so 1201 lands exactly on the README closing.
    expect(README_TOTALS.receivablesOpening + unpaidSales).toBe(README_TOTALS.receivablesClosingUnique);

    const trace = fifoStockTrace(invoices);
    expect(trace.totalOpeningValue).toBe(README_TOTALS.stockValue);
    test.info().annotations.push({
      type: 'oversold',
      description: `${trace.oversold.length} sale line(s) exceed the running stock at their date: ${
        trace.oversold.join('; ') || 'none'
      }`,
    });

    // The drafts this step is about to post: exactly 143, all DRAFT (the 95 purchases are ISSUED).
    const before = await listInvoices(page);
    const draftSales = before.filter((i) => i.direction === 'SALE');
    expect(draftSales).toHaveLength(143);
    expect(draftSales.filter((i) => i.status === 'DRAFT')).toHaveLength(143);

    // The chart the posts must use; step 07 already added the input-VAT account 1402 on top of it.
    const chart = readCsv(SAMPLE_COMPANY_FILES.chartOfAccounts);
    const fileCodes = chart.rows.map((r) => r[chart.header.indexOf('کد حساب')]);
    const accountsBefore = await apiGet<Array<{ code: string; name?: string; balance: number | string }>>(page, 'accounting/accounts');
    const vouchersBefore = (await apiGet<{ total: number }>(page, 'accounting/journal-entries?limit=10')).total;

    // Issue strictly one at a time (date ascending, ties by number) so FIFO order holds.
    const idByNumber = new Map(before.map((i) => [i.taxInvoiceNumber, i.id]));
    let firstPosted: { invoice: (typeof sales)[number]; entryId: number; finalPayable: bigint } | null = null;
    for (const invoice of sales) {
      const issued = await issueAndWait(page, idByNumber.get(invoice.number)!, invoice.number);
      if (!firstPosted && issued.journalEntryId !== null) {
        firstPosted = { invoice, entryId: issued.journalEntryId, finalPayable: rials(issued.finalPayable) };
      }
    }

    // After: every sale is ISSUED with a voucher and no error; no sale draft remains.
    const after = await listInvoices(page);
    const issuedSales = after.filter((i) => i.direction === 'SALE');
    expect(issuedSales).toHaveLength(143);
    for (const invoice of sales) {
      const posted = issuedSales.find((i) => i.taxInvoiceNumber === invoice.number)!;
      expect(posted.status, invoice.number).toBe('ISSUED');
      expect(posted.postingError, invoice.number).toBeNull();
      expect(posted.journalEntryId, invoice.number).not.toBeNull();
    }

    // One issue voucher per invoice over step 07, computed from the CSV (143 issues + the settlements
    // paid below): the engine books COGS and stock inside the same issue voucher, so no extra voucher
    // is expected. A different real delta fails here with the numbers in the message.
    const vouchersAfterIssue = (await apiGet<{ total: number }>(page, 'accounting/journal-entries?limit=10')).total;
    test.info().annotations.push({
      type: 'vouchers',
      description: `issuing ${sales.length} sale invoices moved the voucher count from ${vouchersBefore} to ${vouchersAfterIssue} (delta ${vouchersAfterIssue - vouchersBefore})`,
    });
    expect(
      vouchersAfterIssue - vouchersBefore,
      `one issue voucher per sale invoice: ${sales.length} invoices issued, real delta ${vouchersAfterIssue - vouchersBefore}`,
    ).toBe(sales.length);

    // 1201 (debit-positive) measured right after issuing, before any settlement: receivables opening
    // + every unique sale incl. VAT = 13,273,675,000. The settled 3,820,162,500 comes back off below,
    // landing 1201 on the README closing at the end of this step.
    const accountsAfterIssue = await apiGet<Array<{ code: string; name?: string; balance: number | string }>>(page, 'accounting/accounts');
    // Nothing further may be created: the exact same single input-VAT account step 07 added.
    const createdAfterIssue = accountsAfterIssue
      .filter((a) => !fileCodes.includes(a.code))
      .map((a) => ({ code: a.code, name: a.name ?? '' }))
      .sort((a, b) => a.code.localeCompare(b.code));
    expect(createdAfterIssue, 'the sale issue phase creates nothing beyond 1402').toEqual([
      { code: '1402', name: 'مالیات بر ارزش افزوده خرید (اعتبار مالیاتی)' },
    ]);
    const balanceAfterIssue = (code: string) => balanceOf(accountsAfterIssue, code);
    const balanceBeforeIssue = (code: string) => balanceOf(accountsBefore, code);
    const receivableAfterIssue = balanceAfterIssue('1201');
    // Evidence for a mismatch: every account the sale issue phase moved (code name delta, debit-positive).
    const movedBySales = accountsAfterIssue
      .map((a) => ({ a, delta: balanceOf(accountsAfterIssue, a.code) - balanceOf(accountsBefore, a.code) }))
      .filter((m) => accountsBefore.some((b) => b.code === m.a.code) && m.delta !== 0n)
      .map((m) => `${m.a.code} ${m.a.name ?? ''} ${m.delta}`);
    test.info().annotations.push({ type: 'moved-by-sales', description: movedBySales.join('; ') });
    expect(receivableAfterIssue, `1201 after issuing; accounts the sales moved: ${movedBySales.join('; ')}`).toBe(13_273_675_000n);
    expect(receivableAfterIssue).toBe(README_TOTALS.receivablesOpening + allSales);
    // Hand-computed deltas after the issue phase (balances are debit-positive, credits are negative).
    expect(
      balanceAfterIssue('2201') - balanceBeforeIssue('2201'),
      'output VAT (2201) up by the sale VAT (credit)',
    ).toBe(-saleVatSum);
    expect(balanceAfterIssue('2301') - balanceBeforeIssue('2301'), '2301 does not move').toBe(0n);
    expect(
      balanceAfterIssue('4101') - balanceBeforeIssue('4101'),
      'revenue credits the sale lines excl. VAT',
    ).toBe(-saleLineSum);

    // Stock out: 1301 after 08 must equal the DERIVED closing stock (opening + purchases - COGS =
    // 249,383,200,000) — the hand-entered POS/return ops still ahead move it by a net of 0, so this
    // stays the month-end value checked at step 15. The FIFO layers must agree with the same replay.
    const valuation = await apiGet<{ totalInventoryValue: number | string; rows: Array<{ sku: string; quantity: number; fifoValue: number | string }> }>(
      page,
      'inventory/valuation',
    );
    const consumed = [...trace.consumedBySale.values()].reduce((acc, c) => acc + c, 0n);
    const closingFifoValue = [...trace.closingValueBySku.values()].reduce((acc, v) => acc + v, 0n);
    expect(rials(valuation.totalInventoryValue), '1301 after the sales = the derived closing stock').toBe(
      fixtureClosingStockValue(),
    );
    expect(rials(valuation.totalInventoryValue)).toBe(closingFifoValue);
    expect(closingFifoValue + consumed).toBe(README_TOTALS.stockValue + fifoPurchaseAmountSum(invoices));

    // Sampled items: ITM-1001 and one item of a multi-line purchase — quantity and FIFO value.
    const itemQuantity = async (sku: string) => {
      const items: Array<{ sku: string; quantity: number }> = [];
      for (let page_ = 1; page_ <= 3; page_ += 1) {
        items.push(...(await apiGet<{ data: Array<{ sku: string; quantity: number }> }>(page, `inventory/items?limit=100&page=${page_}`)).data);
      }
      const item = items.find((i) => i.sku === sku);
      expect(item, `item ${sku} is listed`).toBeDefined();
      return item!.quantity;
    };
    const multiPurchase = invoices.filter((i) => i.direction === 'PURCHASE' && i.lines.length > 1)[0];
    const samples = ['ITM-1001', multiPurchase.lines[0].itemCode];
    for (const sku of samples) {
      expect(BigInt(await itemQuantity(sku)), `quantity of ${sku} after the sales`).toBe(
        trace.closingQuantityBySku.get(sku)!,
      );
      // The valuation endpoint reports a per-item fifoValue row, so the value is asserted too.
      const row = valuation.rows.find((r) => r.sku === sku)!;
      expect(rials(row.fifoValue), `FIFO value of ${sku} after the sales`).toBe(trace.closingValueBySku.get(sku)!);
    }

    // The first posted voucher: sales debit 1201 (receivables) with the invoice's final payable,
    // and the voucher is balanced. Every line's account code is attached as evidence.
    expect(firstPosted, 'at least one sale posted').not.toBeNull();
    const voucher = await apiGet<{
      lines: Array<{ accountCode: string; description?: string; debit: number | string; credit: number | string }>;
      totalDebit: number | string;
      totalCredit: number | string;
    }>(page, `accounting/journal-entries/${firstPosted!.entryId}`);
    test.info().annotations.push({
      type: 'voucher',
      description: `${firstPosted!.invoice.number}: ${voucher.lines
        .map((l) => `${l.accountCode} debit ${l.debit} credit ${l.credit}`)
        .join('; ')}`,
    });
    expect(rials(voucher.totalDebit), 'the sale voucher is balanced').toBe(rials(voucher.totalCredit));
    const receivableLine = voucher.lines.find((l) => l.accountCode === '1201');
    expect(receivableLine, 'the sale voucher debits 1201').toBeDefined();
    expect(rials(receivableLine!.debit), `debit of 1201 in ${firstPosted!.invoice.number}`).toBe(firstPosted!.finalPayable);

    // COGS: is stock out and COGS on the same issue voucher? (The voucher count below assumes they are.)
    const hasStockOut = voucher.lines.some((l) => l.accountCode === '1301');
    const hasCogs = voucher.lines.some((l) => l.accountCode === '5101');
    test.info().annotations.push({
      type: 'cogs',
      description: `sale issue voucher ${firstPosted!.invoice.number}: 1301 ${hasStockOut ? 'present' : 'absent'}, 5101 ${hasCogs ? 'present' : 'absent'} -> COGS ${
        hasStockOut && hasCogs ? 'on the issue voucher' : 'not on the same voucher'
      }`,
    });
    // Output VAT: the product matches the account by name; the fixture's «مالیات بر ارزش افزوده
    // پرداختنی» 2201 must win over the engine default 2301 (both names contain «مالیات»).
    const outputVatLine = voucher.lines.find(
      (l) =>
        l.description === 'مالیات بر ارزش افزوده فروش' || l.description === 'مالیات بر ارزش افزوده پرداختنی',
    );
    expect(outputVatLine, 'the sale voucher has the output-VAT line').toBeDefined();
    expect(outputVatLine!.accountCode, 'output VAT uses the fixture 2201, not the default 2301').toBe('2201');

    // ---- Settle the «تسویه‌شده» sales through the user's status path ---------------------------------
    // payAndWait mirrors the invoicing page's pay button (PATCH invoicing/:id/pay), one invoice at a
    // time, in the same date order as the issues.
    expect(settled, 'the fixture marks settled sales to collect').not.toHaveLength(0);
    const paidEntryByNumber = new Map<string, number>();
    for (const invoice of settled) {
      const paid = await payAndWait(page, idByNumber.get(invoice.number)!, invoice.number);
      paidEntryByNumber.set(invoice.number, paid.paidJournalEntryId!);
    }
    const afterPaying = await listInvoices(page);
    for (const invoice of settled) {
      expect(afterPaying.find((i) => i.taxInvoiceNumber === invoice.number)!.status, invoice.number).toBe('PAID');
    }

    // Voucher delta after settling, computed from the CSV: one issue voucher per invoice + one
    // settlement voucher per settled invoice (143 + 46 here). A different real delta fails with the
    // real numbers in the message.
    const vouchersAtEnd = (await apiGet<{ total: number }>(page, 'accounting/journal-entries?limit=10')).total;
    test.info().annotations.push({
      type: 'vouchers',
      description: `paying ${settled.length} settled sales moved the voucher count to ${vouchersAtEnd} (total delta ${vouchersAtEnd - vouchersBefore} = ${sales.length} issues + ${settled.length} settlements)`,
    });
    expect(
      vouchersAtEnd - vouchersBefore,
      `one issue voucher per sale invoice plus one settlement voucher per settled sale: ${sales.length} + ${settled.length} expected, real delta ${vouchersAtEnd - vouchersBefore}`,
    ).toBe(sales.length + settled.length);

    // Fetch EVERY settlement voucher: balanced, and never touching the bank 1101 — collections settle
    // through the pinned petty cash 1102; the bank only moves per the statement (step 12).
    const settlementVouchers: Array<{
      number: string;
      lines: Array<{ accountCode: string; debit: number | string; credit: number | string }>;
    }> = [];
    for (const invoice of settled) {
      const settleVoucher = await apiGet<{
        lines: Array<{ accountCode: string; debit: number | string; credit: number | string }>;
        totalDebit: number | string;
        totalCredit: number | string;
      }>(page, `accounting/journal-entries/${paidEntryByNumber.get(invoice.number)!}`);
      settlementVouchers.push({ number: invoice.number, lines: settleVoucher.lines });
      expect(rials(settleVoucher.totalDebit), `settlement voucher of ${invoice.number} is balanced`).toBe(
        rials(settleVoucher.totalCredit),
      );
      expect(
        settleVoucher.lines.filter((l) => l.accountCode === '1101'),
        `settlement of ${invoice.number} must not touch the bank 1101`,
      ).toHaveLength(0);
      // The counter side is the pinned petty-cash account 1102, debited with exactly the collected amount.
      const cashLine = settleVoucher.lines.find((l) => l.accountCode === '1102');
      expect(cashLine, `settlement of ${invoice.number} has a 1102 line`).toBeDefined();
      expect(rials(cashLine!.debit), `1102 debited by ${invoice.number}`).toBe(invoice.totalInclVat);
      expect(rials(cashLine!.credit), `1102 not credited by ${invoice.number}`).toBe(0n);
    }

    // Evidence for the first settled invoice (date order): its settlement voucher, every line
    // annotated, clearing 1201 with exactly the invoice amount.
    const firstSettled = settled[0];
    const firstSettlement = settlementVouchers[0]!;
    test.info().annotations.push({
      type: 'voucher',
      description: `settlement of ${firstSettled.number}: ${firstSettlement.lines
        .map((l) => `${l.accountCode} debit ${l.debit} credit ${l.credit}`)
        .join('; ')}`,
    });
    const cleared = firstSettlement.lines.find((l) => l.accountCode === '1201');
    expect(cleared, `the settlement voucher of ${firstSettled.number} credits 1201`).toBeDefined();
    expect(rials(cleared!.credit), `1201 cleared by ${firstSettled.number}`).toBe(firstSettled.totalInclVat);
    // Which account is the counter side? The pinned petty cash 1102 (never the bank 1101).
    const counterAccounts = new Set(
      settlementVouchers.flatMap((v) => v.lines.map((l) => l.accountCode).filter((code) => code !== '1201')),
    );
    const cashName = accountsAfterIssue.find((a) => a.code === '1102')?.name ?? '';
    test.info().annotations.push({
      type: 'voucher',
      description: `${settlementVouchers.length} settlement vouchers clear 1201 and debit the counter account 1102 ${cashName}; counter-side codes: ${[...counterAccounts].join(', ')}`,
    });

    // End of step 08: 1201 = the README closing receivables, exactly — 13,273,675,000 issued minus
    // the settled 3,820,162,500 collected; 2101 is the README closing payables from step 07.
    const accountsAtEnd = await apiGet<Array<{ code: string; name?: string; balance: number | string }>>(page, 'accounting/accounts');
    const receivableAtEnd = balanceOf(accountsAtEnd, '1201');
    expect(receivableAtEnd).toBe(README_TOTALS.receivablesClosingUnique);
    expect(receivableAtEnd).toBe(9_453_512_500n);
    expect(receivableAtEnd).toBe(receivableAfterIssue - settledSales);
    const payableAtEnd = -balanceOf(accountsAtEnd, '2101');
    expect(payableAtEnd).toBe(5_420_780_000n);

    // Input VAT was posted in step 07; read its account from a purchase voucher and check the final
    // balance against the fixture opening: it must grow by exactly the purchase VAT.
    const firstPurchaseEntry = before.find((i) => i.direction === 'PURCHASE' && i.journalEntryId !== null)!;
    const purchaseVoucher = await apiGet<{
      lines: Array<{ accountCode: string; description?: string; debit: number | string; credit: number | string }>;
    }>(page, `accounting/journal-entries/${firstPurchaseEntry.journalEntryId}`);
    const inputVatLine = purchaseVoucher.lines.find((l) => l.description === 'مالیات بر ارزش افزوده خرید');
    expect(inputVatLine, 'a purchase voucher has the input-VAT line').toBeDefined();
    const inputVatCode = inputVatLine!.accountCode;
    expect(inputVatCode, 'input VAT is booked on 1402').toBe('1402');
    expect(balanceOf(accountsAtEnd, '1401'), '1401 stays at its opening 260,000,000').toBe(fixtureOpeningBalance('1401', 'debit'));
    expect(fixtureOpeningBalance('1401', 'debit')).toBe(260_000_000n);
    const inputVatBalance = balanceOf(accountsAtEnd, inputVatCode);
    expect(
      inputVatBalance - fixtureOpeningBalance(inputVatCode, 'debit'),
      `input VAT ${inputVatCode} grew by exactly the purchase VAT`,
    ).toBe(purchaseVatSum);

    // 1102 final = opening petty cash + settled sales - settled purchases (all from the fixture).
    const pettyCashAtEnd = balanceOf(accountsAtEnd, '1102');
    expect(pettyCashAtEnd).toBe(fixtureOpeningBalance('1102', 'debit') + settledSales - settledPurchases);
    // Output VAT 2201 and reserve 2301 deltas from their (credit) fixture openings: only 2201 moves.
    const outputVatAtEnd = balanceOf(accountsAtEnd, '2201');
    expect(outputVatAtEnd + fixtureOpeningBalance('2201', 'credit'), '2201 output VAT credit delta').toBe(
      -saleVatSum,
    );
    expect(balanceOf(accountsAtEnd, '2301') + fixtureOpeningBalance('2301', 'credit'), '2301 does not move').toBe(0n);
    expect(balanceOf(accountsAtEnd, '4101') - fixtureOpeningBalance('4101', 'debit')).toBe(-saleLineSum);
    expect(rials(valuation.totalInventoryValue)).toBe(fixtureClosingStockValue());

    test.info().annotations.push({
      type: 'end-of-08',
      description: `1201 ${receivableAtEnd}; 2101 ${payableAtEnd}; stock ${rials(valuation.totalInventoryValue)}; 1102 ${pettyCashAtEnd}; 2201 ${outputVatAtEnd}; input VAT ${inputVatCode} ${inputVatBalance}`,
    });
  });

  test('09 POS walk-in sale: 1 x ITM-1001 paid in cash [E1]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/invoicing');
    const sale = M1_MONTH_OPERATIONS.posWalkInSale; // 1 x ITM-1001, 20,487,500 incl. VAT; no customer

    const accountsBefore = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    const valuationBefore = await apiGet<{ totalInventoryValue: number | string }>(page, 'inventory/valuation');

    const created = await apiPost<{ invoice: { id: string }; replayed: boolean }>(page, 'invoicing/pos-sales', {
      idempotencyKey: 'm1-pos-1',
      lines: [{ code: sale.itemCode, quantity: Number(sale.quantity), unitPrice: Number(sale.unitPrice) }],
      payments: [{ method: 'CASH', amount: Number(sale.total) }],
    });
    expect(created.replayed, 'the first call is not a replay').toBe(false);

    // Posting is asynchronous (a suite-events job): wait for both the issue and the settlement voucher.
    const invoice = await waitForInvoice(page, created.invoice.id);
    expect(invoice.status, 'a cash POS sale is PAID at once').toBe('PAID');
    expect(rials(invoice.finalPayable), 'the walk-in sale total').toBe(sale.total);

    // The issue voucher carries revenue, output VAT, COGS and stock; the settlement clears 1201 to 1102.
    const issue = await journalVoucher(page, invoice.journalEntryId!);
    test.info().annotations.push({ type: 'voucher', description: `POS sale issue: ${voucherLineText(issue)}` });
    expect(creditOf(issue.lines, '4101'), 'revenue credit excl. VAT').toBe(sale.unitPrice);
    expect(creditOf(issue.lines, '2201'), 'output VAT credit').toBe(sale.vat);
    expect(debitOf(issue.lines, '5101'), 'COGS debit at FIFO cost').toBe(-sale.stockDelta);
    expect(creditOf(issue.lines, '1301'), 'stock credit at FIFO cost').toBe(-sale.stockDelta);

    const accountsAfter = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    const valuationAfter = await apiGet<{ totalInventoryValue: number | string }>(page, 'inventory/valuation');
    expect(
      balanceOf(accountsAfter, '1102') - balanceOf(accountsBefore, '1102'),
      'petty cash up by the cash sale',
    ).toBe(sale.total);
    expect(balanceOf(accountsAfter, '1101') - balanceOf(accountsBefore, '1101'), 'the bank 1101 does not move').toBe(0n);
    expect(
      balanceOf(accountsAfter, '1201') - balanceOf(accountsBefore, '1201'),
      'receivable issued then settled: net zero',
    ).toBe(sale.receivablesDelta);
    expect(
      rials(valuationAfter.totalInventoryValue) - rials(valuationBefore.totalInventoryValue),
      'stock valuation out at the sale cost',
    ).toBe(sale.stockDelta);
  });

  test('10 sales return: CUST-001 returns 1 unit of INV-S-1403-0001 [E1]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/invoicing');
    const salesReturn = M1_MONTH_OPERATIONS.salesReturn; // credit note linked to the original invoice

    const originalId = await findInvoiceIdByNumber(page, salesReturn.invoiceNumber);
    const accountsBefore = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    const valuationBefore = await apiGet<{ totalInventoryValue: number | string }>(page, 'inventory/valuation');

    // The imported sale carries CUST-001 only as buyerInfo (no customerId), and it is unpaid, so the quick-sale
    // return (pos-sales returnOf: CREDIT needs a known customer, ORIGINAL needs a PAID sale) refuses it with 400.
    // The product path left is the plain invoice form: a RETURN-subject invoice linked to the sale.
    const original = await apiGet<{
      sellerInfo: unknown;
      buyerInfo: unknown;
      currency: string;
      fxRate: number | string;
      jurisdiction?: string;
      warehouseId?: number | null;
      einvoiceType?: unknown;
      items: Array<{ itemId?: string; sku?: string; description: string; unitPrice: number; vatRate?: number; quantity: number }>;
    }>(page, `invoicing/${originalId}`);
    expect(original.items[0].quantity, 'the original sold 2 units').toBe(2);
    const line = original.items[0];
    const returnBody = (quantity: number) => ({
      subject: 4,
      relatedInvoiceId: originalId,
      direction: 'SALE',
      sellerInfo: original.sellerInfo,
      buyerInfo: original.buyerInfo,
      currency: original.currency,
      ...(original.jurisdiction ? { jurisdiction: original.jurisdiction } : {}),
      ...(original.warehouseId ? { warehouseId: original.warehouseId } : {}),
      items: [
        {
          ...(line.itemId ? { itemId: line.itemId } : {}),
          ...(line.sku ? { sku: line.sku } : {}),
          description: line.description,
          quantity,
          unitPrice: line.unitPrice,
          ...(line.vatRate !== undefined ? { vatRate: line.vatRate } : {}),
          originalLine: 0,
        },
      ],
      status: 'ISSUED',
    });
    const created = await apiPost<{ id: string }>(page, 'invoicing', returnBody(1));

    const returned = await waitForInvoice(page, created.id);
    expect(returned.subject, 'the return invoice has subject RETURN (4)').toBe(4);
    expect(returned.relatedInvoiceId, 'the return is linked to the original sale').toBe(originalId);
    expect(rials(returned.finalPayable), 'one unit returned at the original price').toBe(salesReturn.total);

    // The return voucher mirrors revenue and VAT and takes the goods back at the sale's recorded cost.
    const voucher = await journalVoucher(page, returned.journalEntryId!);
    test.info().annotations.push({
      type: 'voucher',
      description: `return of ${salesReturn.invoiceNumber}: ${voucherLineText(voucher)}`,
    });
    expect(creditOf(voucher.lines, '1201'), 'the credit note credits the receivable').toBe(salesReturn.total);
    expect(debitOf(voucher.lines, '1301'), 'the goods come back into stock').toBe(salesReturn.stockDelta);

    const accountsAfter = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    const valuationAfter = await apiGet<{ totalInventoryValue: number | string }>(page, 'inventory/valuation');
    expect(
      balanceOf(accountsAfter, '1201') - balanceOf(accountsBefore, '1201'),
      '1201 down by the credit note',
    ).toBe(salesReturn.receivablesDelta);
    expect(
      balanceOf(accountsAfter, '1301') - balanceOf(accountsBefore, '1301'),
      'ledger 1301 back by the sale cost',
    ).toBe(salesReturn.stockDelta);
    expect(
      rials(valuationAfter.totalInventoryValue) - rials(valuationBefore.totalInventoryValue),
      'FIFO valuation back by the sale cost',
    ).toBe(salesReturn.stockDelta);
    expect(balanceOf(accountsAfter, '1101') - balanceOf(accountsBefore, '1101'), 'the bank 1101 does not move').toBe(0n);

    // Only one of the two sold units is left after the first return: a second return of 2 units must fail.
    const token = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : undefined;
    }, SESSION_STORAGE_KEY);
    expect(token, 'the test session is in localStorage').toBeTruthy();
    const refused = await page.request.post('/api/backend/enterprise-hub/invoicing', {
      headers: { Authorization: `Bearer ${token}` },
      data: returnBody(2),
    });
    expect(refused.status(), 'a return beyond the quantity left is refused with 400').toBe(400);
  });

  test('11 cheque received: CUST-002 settles INV-S-1403-0002, held in hand [E1]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/cheques');
    const cheque = M1_MONTH_OPERATIONS.chequeReceived; // 36,712,500 to 1110, not deposited

    // Tenant setup, as step 07 does for cash: the cheque template's receivable role defaults to the legacy
    // code 1020, which this chart does not have (the first run failed with UNKNOWN_ACCOUNT 1020). Pin it to 1201.
    const pinned = await apiPut(page, 'posting-rules/cheque.received.create/roles/receivable', { accountCode: '1201' });
    expect(pinned, 'PUT posting-rules cheque.received.create receivable -> 1201').toBe(204);
    const accountsBefore = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    // ChequeDirection is lowercase 'received'; amount may be a number or a decimal string.
    const created = await apiPost<{ id: number; status: string }>(page, 'cheques', {
      direction: 'received',
      chequeNumber: 'M1-CHQ-0001',
      amount: Number(cheque.amount),
      issueDate: '2024-05-02',
      dueDate: '2024-06-01',
      partyName: 'بهرام آذرخش نمونه',
      partyCode: cheque.partyCode,
      bankName: 'بانک ملت نمونه',
    });
    expect(created.status, 'a new cheque stays registered (not deposited)').toBe('registered');

    const detail = await apiGet<{ status: string; events: Array<{ toStatus: string; journalEntryId: number | null }> }>(
      page,
      `cheques/${created.id}`,
    );
    expect(detail.status, 'the cheque is not transitioned').toBe('registered');
    const creation = detail.events.find((event) => event.journalEntryId !== null);
    expect(creation, 'the creation posted a voucher').toBeDefined();
    const voucher = await journalVoucher(page, creation!.journalEntryId!);
    test.info().annotations.push({
      type: 'voucher',
      description: `cheque ${cheque.invoiceNumber} creation: ${voucherLineText(voucher)}`,
    });

    const accountsAfter = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    expect(
      balanceOf(accountsAfter, '1110') - balanceOf(accountsBefore, '1110'),
      'notes receivable in hand up by the cheque',
    ).toBe(cheque.amount);
    // The creation voucher must credit the receivable role; if the product credits another account this fails
    // with the actual voucher lines in the annotation above (do not adapt the assertion).
    expect(
      balanceOf(accountsAfter, '1201') - balanceOf(accountsBefore, '1201'),
      'the creation voucher credits the receivable 1201',
    ).toBe(cheque.receivablesDelta);
    expect(balanceOf(accountsAfter, '1101') - balanceOf(accountsBefore, '1101'), 'the bank 1101 does not move').toBe(0n);
  });

  test('12 bank reconciliation with bank-statement.csv: 100 lines matched [E3]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/accounting/bank/reconcile');
    // The statement is unmatched by design in this fixture: its 100 lines are not the invoices settled in
    // steps 07-11 (the book has no 1101 movement in the period), and their text says «تسویه فاکتور فروش» /
    // «پرداخت به تأمین‌کننده». Posting them to 1201 / 2101 would break the README closings (steps 13, 14),
    // so, as a real user must, the owner picks the counter account: a clearing account 1199 created through
    // the real chart API, and the tenant's recon category-to-account settings point the two categories at it.
    const deposits = 1_270_000_000n;
    const withdrawals = 1_285_000_000n;
    const lines = readCsv(SAMPLE_COMPANY_FILES.bankStatement);
    expect(lines.rows).toHaveLength(100);

    const accountsBefore = await apiGet<Array<{ id: number; code: string; balance: number | string }>>(page, 'accounting/accounts');
    const bankLedger = accountsBefore.find((a) => a.code === '1101');
    expect(bankLedger, 'ledger account 1101 exists').toBeDefined();
    expect(balanceOf(accountsBefore, '1101'), '1101 opens at the fixture opening').toBe(fixtureOpeningBalance('1101', 'debit'));

    await apiPost(page, 'accounting/accounts', { code: '1199', name: 'حساب واسط تطبیق بانکی', accountType: 'ASSET' });
    const bankAccount = await apiPost<{ id: number }>(page, 'banking/accounts', {
      name: 'بانک ملت - جاری ریالی نمونه',
      bankCode: 'mellat',
      accountNumber: '1000000000001',
      ledgerAccountId: bankLedger!.id,
      openingBalance: Number(fixtureOpeningBalance('1101', 'debit')),
    });
    const settingsStatus = await apiPut(page, 'banking/recon/settings', { categoryAccounts: { sale: '1199', purchase: '1199' } });
    expect(settingsStatus, 'PUT banking/recon/settings').toBe(200);

    // Upload the file through the real route, then answer whatever the prerequisite checks ask.
    const token = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : undefined;
    }, SESSION_STORAGE_KEY);
    const headers = { Authorization: `Bearer ${token}` };
    const uploaded = await page.request.post(`/api/backend/enterprise-hub/banking/recon/sessions?bankAccountId=${bankAccount.id}`, {
      headers,
      multipart: {
        file: { name: 'bank-statement.csv', mimeType: 'text/csv', buffer: fs.readFileSync(SAMPLE_COMPANY_FILES.bankStatement) },
      },
    });
    expect(uploaded.status(), `upload: ${(await uploaded.text()).slice(0, 500)}`).toBe(201);
    type Check = { code: string; severity: string; message: string; choices: Array<{ id: string; label: string }> };
    type Session = { id: number; status: string; checks: Check[] };
    let session = (await uploaded.json()) as Session;
    test.info().annotations.push({
      type: 'recon-checks',
      description: `status ${session.status}; checks: ${session.checks.map((c) => `${c.code}/${c.severity}[${c.choices.map((x) => x.id).join('|')}]`).join('; ') || 'none'}`,
    });
    // The statement's Persian header row is not a known bank profile, so the file asks for a column mapping;
    // the person maps the columns once (0-based, as in the file: date, time, description, withdrawal, deposit,
    // balance, reference).
    if (session.status === 'needs_mapping') {
      session = await apiPost<Session>(
        page,
        `banking/recon/sessions/${session.id}/mapping`,
        { columnMap: { date: 0, time: 1, description: 2, withdrawal: 3, deposit: 4, balance: 5, reference: 6 } },
        200,
      );
      test.info().annotations.push({
        type: 'recon-checks-after-mapping',
        description: `status ${session.status}; checks: ${session.checks.map((c) => `${c.code}/${c.severity}[${c.choices.map((x) => x.id).join('|')}]`).join('; ') || 'none'}`,
      });
    }
    // Only the account confirmation is answered here (the file carries no account number); any other open
    // question fails the step with its text rather than being answered blindly.
    for (const check of session.checks.filter((c) => c.code === 'account_match')) {
      const choice = check.choices.find((c) => c.id === `account:${bankAccount.id}`);
      if (choice) {
        session = await apiPost<Session>(page, `banking/recon/sessions/${session.id}/answers`, { code: 'account_match', choice: choice.id }, 200);
      }
    }
    expect(session.status, `prerequisites: ${session.checks.map((c) => `${c.code}: ${c.message}`).join(' | ')}`).toBe('ready');

    type Review = {
      counts: { matched: number; suggested: number; unmatched: number; drafts: number };
      drafts: Array<{ id: number; status: string; counterAccountCode: string | null }>;
      unmatched: Array<{ id: number; depositRial: string; draft: { id: number } | null }>;
    };
    const committed = await apiPost<Review>(page, `banking/recon/sessions/${session.id}/commit`, {}, 200);
    test.info().annotations.push({ type: 'recon-commit', description: JSON.stringify(committed.counts) });
    expect(committed.counts.matched + committed.counts.suggested, 'nothing in the book matches this statement').toBe(0);
    // The classifier recognises the receipts («تسویه فاکتور فروش») but not every payment text; the lines it cannot
    // classify are answered one by one by the person (category + counter account), as in the review screen.
    const drafts = [...committed.drafts];
    const unclassified = committed.unmatched.filter((row) => row.draft === null);
    test.info().annotations.push({
      type: 'recon-unclassified',
      description: `${unclassified.length} of 100 lines without a draft after commit (deposits among them: ${unclassified.filter((r) => BigInt(r.depositRial) > 0n).length})`,
    });
    for (const row of unclassified) {
      const answered = await apiPost<{ draft: { id: number; counterAccountCode: string | null } | null }>(
        page,
        `banking/recon/items/${row.id}/answer`,
        { choiceId: BigInt(row.depositRial) > 0n ? 'sale' : 'purchase', counterAccountCode: '1199', remember: false },
        200,
      );
      expect(answered.draft, `a draft for statement item ${row.id}`).not.toBeNull();
      drafts.push({ id: answered.draft!.id, status: 'draft', counterAccountCode: answered.draft!.counterAccountCode });
    }
    expect(drafts, 'one draft per statement line').toHaveLength(100);
    expect(new Set(drafts.map((d) => d.counterAccountCode)), 'every draft uses the clearing account').toEqual(new Set(['1199']));

    const approved = await apiPost<Array<{ id: number; status: string; reason?: string }>>(
      page,
      'banking/recon/drafts/approve',
      { draftIds: drafts.map((d) => d.id) },
      200,
    );
    const notPosted = approved.filter((r) => r.status !== 'posted');
    expect(notPosted, `drafts not posted: ${JSON.stringify(notPosted.slice(0, 3))}`).toHaveLength(0);
    expect(approved).toHaveLength(100);

    const review = await apiGet<Review>(page, `banking/recon/sessions/${session.id}/review`);
    test.info().annotations.push({ type: 'recon-review', description: JSON.stringify(review.counts) });
    expect(review.counts.unmatched, 'no statement line left unreconciled').toBe(0);
    expect(review.counts.suggested, 'no suggested match left open').toBe(0);

    const accountsAfter = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    expect(balanceOf(accountsAfter, '1199'), '1199 net debit = withdrawals - deposits').toBe(withdrawals - deposits);
    expect(balanceOf(accountsAfter, '1199')).toBe(15_000_000n);
    expect(balanceOf(accountsAfter, '1101'), '1101 = the statement closing').toBe(M1_EXPECTED_CLOSING.bankBalance);
    expect(balanceOf(accountsAfter, '1201'), '1201 unchanged by the clearing postings').toBe(balanceOf(accountsBefore, '1201'));
    expect(-balanceOf(accountsAfter, '2101'), '2101 unchanged by the clearing postings').toBe(-balanceOf(accountsBefore, '2101'));
    expect(balanceOf(accountsAfter, '1201')).toBe(M1_EXPECTED_CLOSING.receivables);
    expect(-balanceOf(accountsAfter, '2101')).toBe(M1_EXPECTED_CLOSING.payables);
  });

  // ---- Month-end assertions against the README totals --------------------------------------------------

  test('13 receivables 1201 equal the expected closing [E4]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/accounting/reports');
    const accounts = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    expect(balanceOf(accounts, '1201'), '1201 closing receivables').toBe(M1_EXPECTED_CLOSING.receivables);
  });

  test('14 payables 2101 equal the expected closing [E4]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/accounting/reports');
    const accounts = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    expect(-balanceOf(accounts, '2101'), '2101 closing payables (credit-positive)').toBe(M1_EXPECTED_CLOSING.payables);
  });

  test('15 stock value 1301 equals the expected closing [E2]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/inventory');
    const accounts = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    const ledger = balanceOf(accounts, '1301');
    const valuation = await apiGet<{ totalInventoryValue: number | string }>(page, 'inventory/valuation');
    const fifo = rials(valuation.totalInventoryValue);
    // Two separate equalities so a ledger-vs-FIFO difference is visible with both numbers in the message.
    expect(ledger, `ledger 1301 ${ledger} vs expected closing`).toBe(M1_EXPECTED_CLOSING.stockValue);
    expect(fifo, `inventory/valuation ${fifo} vs expected closing`).toBe(M1_EXPECTED_CLOSING.stockValue);
    expect(ledger, `ledger 1301 ${ledger} vs FIFO valuation ${fifo}`).toBe(fifo);
  });

  test('16 bank 1101 equals the reconciled statement balance [E3]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/accounting/bank');
    const accounts = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    expect(balanceOf(accounts, '1101'), '1101 closing = statement closing').toBe(M1_EXPECTED_CLOSING.bankBalance);
    expect(M1_EXPECTED_CLOSING.bankBalance).toBe(2_485_000_000n);
  });

  test('17 trial balance is balanced: total debit = total credit [E3]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/accounting');
    const trial = await apiGet<{ totalDebit: number | string; totalCredit: number | string }>(
      page,
      'accounting/trial-balance',
    );
    expect(rials(trial.totalDebit), 'trial balance total debit').toBe(rials(trial.totalCredit));

    // «وضعیت تراز دفاتر» shows «تراز», not «ناتراز» (see e2e/app/03-accounting.spec.ts).
    const balance = page.locator('[data-slot="card"]').filter({ hasText: 'وضعیت تراز دفاتر' });
    await expect(balance).toBeVisible();
    await expect(balance).toContainText('تراز');
    await expect(balance).not.toContainText('ناتراز');
  });
});
