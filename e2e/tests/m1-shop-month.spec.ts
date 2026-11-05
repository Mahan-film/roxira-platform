import { test, expect, fa, findSessionFile, loginAsTestTenant } from '../app/fixtures';
import type { Page } from '@playwright/test';
import { M1_EXPECTED_CLOSING, M1_MONTH_OPERATIONS, README_TOTALS } from './m1/expected-totals';
import {
  bankStatementRollForward,
  computeTotalsFromCsv,
  fifoPurchaseAmountSum,
  fifoStockTrace,
  parseFixtureInvoices,
  readCsv,
  readReadmeTotals,
  SAMPLE_COMPANY_FILES,
  sortInvoices,
  toRial,
} from './m1/fixture-data';
import { apiGet, importFile, issueAndWait, persianise, rials } from './m1/import-ui';

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
    expect(M1_EXPECTED_CLOSING).toEqual({
      receivables: 9_396_312_500n,
      payables: 5_420_780_000n,
      stockValue: 252_026_700_000n,
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

  test('07 post purchase invoices: stock in, payables up [E2]', async ({ page }) => {
    test.setTimeout(900_000);
    await loginAsTestTenant(page, '/app/invoicing');

    // Fixture-derived expectations (independent of any product output).
    const invoices = parseFixtureInvoices();
    const purchases = sortInvoices(invoices.filter((i) => i.direction === 'PURCHASE'));
    expect(purchases).toHaveLength(95);
    const unpaidPurchases = purchases.filter((i) => !i.settled).reduce((acc, i) => acc + i.totalInclVat, 0n);
    const settledPurchases = purchases.filter((i) => i.settled).reduce((acc, i) => acc + i.totalInclVat, 0n);
    const allPurchases = purchases.reduce((acc, i) => acc + i.totalInclVat, 0n);
    // Hand-computed from the fixture, asserted as literals as a cross-check of the parsing above.
    expect(unpaidPurchases).toBe(4_300_780_000n);
    expect(settledPurchases).toBe(1_938_310_000n);
    expect(allPurchases).toBe(6_239_090_000n);
    // README tie-out: the README closing payables counts UNPAID purchases only. The settled remainder
    // (1,938,310,000) is settled by the step 12 payments, so steps 07/08 post every imported invoice —
    // leaving the settled ones as drafts would hide documents from the ledger and the stock register.
    expect(README_TOTALS.payablesOpening + unpaidPurchases).toBe(README_TOTALS.payablesClosingUnique);
    // Stock in: every purchase line excl. VAT («مبلغ»).
    const purchaseAmountSum = purchases.reduce((acc, i) => acc + i.lines.reduce((a, l) => a + l.amount, 0n), 0n);

    // The drafts this step is about to post: exactly 95, all DRAFT.
    const before = await listInvoices(page);
    const draftPurchases = before.filter((i) => i.direction === 'PURCHASE');
    expect(draftPurchases).toHaveLength(95);
    expect(draftPurchases.filter((i) => i.status === 'DRAFT')).toHaveLength(95);

    // Posting must use the chart imported in step 02 and never create accounts: the code set is exactly
    // the 18 codes of chart-of-accounts.csv.
    const chart = readCsv(SAMPLE_COMPANY_FILES.chartOfAccounts);
    const fileCodes = chart.rows.map((r) => r[chart.header.indexOf('کد حساب')]);
    const accountsBefore = await apiGet<Array<{ code: string }>>(page, 'accounting/accounts');
    expect(new Set(accountsBefore.map((a) => a.code))).toEqual(new Set(fileCodes));
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

    // One voucher per invoice: the total rises by exactly 95 over the opening + step 05 voucher.
    // (If the engine books COGS/stock as a second voucher the real delta is in the annotation.)
    const vouchersAfter = (await apiGet<{ total: number }>(page, 'accounting/journal-entries?limit=10')).total;
    test.info().annotations.push({
      type: 'vouchers',
      description: `purchase posting moved the voucher count from ${vouchersBefore} to ${vouchersAfter}`,
    });
    expect(vouchersAfter - vouchersBefore, 'exactly one voucher per purchase invoice').toBe(95);

    // 2101 (credit-positive, hence -balance as step 05 does) = payables opening + every unique purchase
    // incl. VAT, hand-computed literal; the settled 1,938,310,000 stays until step 12 settles it.
    const accountsAfter = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    expect(new Set(accountsAfter.map((a) => a.code)), 'posting created no account').toEqual(new Set(fileCodes));
    const payable = -rials(accountsAfter.find((a) => a.code === '2101')!.balance);
    expect(payable).toBe(7_359_090_000n);
    expect(payable).toBe(README_TOTALS.payablesOpening + allPurchases);

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
      lines: Array<{ accountCode: string; debit: number | string; credit: number | string }>;
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
  });

  test('08 post sales invoices: stock out, receivables up [E1]', async ({ page }) => {
    test.setTimeout(900_000);
    await loginAsTestTenant(page, '/app/invoicing');

    // Fixture-derived expectations, including an independent FIFO replay over opening stock,
    // purchases and sales (a sale beyond the running stock moves no stock — its posting fails whole).
    const invoices = parseFixtureInvoices();
    const sales = sortInvoices(invoices.filter((i) => i.direction === 'SALE'));
    expect(sales).toHaveLength(143);
    const unpaidSales = sales.filter((i) => !i.settled).reduce((acc, i) => acc + i.totalInclVat, 0n);
    const settledSales = sales.filter((i) => i.settled).reduce((acc, i) => acc + i.totalInclVat, 0n);
    const allSales = sales.reduce((acc, i) => acc + i.totalInclVat, 0n);
    // Hand-computed from the fixture, asserted as literals as a cross-check of the parsing above.
    expect(unpaidSales).toBe(7_613_512_500n);
    expect(settledSales).toBe(3_820_162_500n);
    expect(allSales).toBe(11_433_675_000n);
    // README tie-out: the README closing receivables counts UNPAID sales only; the settled remainder
    // (3,820,162,500) is settled by the step 11/12 receipts, so 08 posts every imported sale invoice.
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

    // Posting must not grow the chart imported in step 02.
    const chart = readCsv(SAMPLE_COMPANY_FILES.chartOfAccounts);
    const fileCodes = chart.rows.map((r) => r[chart.header.indexOf('کد حساب')]);
    const accountsBefore = await apiGet<Array<{ code: string }>>(page, 'accounting/accounts');
    expect(new Set(accountsBefore.map((a) => a.code))).toEqual(new Set(fileCodes));
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

    // One voucher per invoice over step 07: exactly 143 more. (A second COGS voucher per sale, if any,
    // shows up in the annotation; the assertion stays at one per invoice.)
    const vouchersAfter = (await apiGet<{ total: number }>(page, 'accounting/journal-entries?limit=10')).total;
    test.info().annotations.push({
      type: 'vouchers',
      description: `sale posting moved the voucher count from ${vouchersBefore} to ${vouchersAfter}`,
    });
    expect(vouchersAfter - vouchersBefore, 'exactly one voucher per sale invoice').toBe(143);

    // 1201 (debit-positive) = receivables opening + every unique sale incl. VAT, hand-computed literal;
    // the settled 3,820,162,500 stays until steps 11/12 collect it.
    const accountsAfter = await apiGet<Array<{ code: string; balance: number | string }>>(page, 'accounting/accounts');
    expect(new Set(accountsAfter.map((a) => a.code)), 'posting created no account').toEqual(new Set(fileCodes));
    const receivable = rials(accountsAfter.find((a) => a.code === '1201')!.balance);
    expect(receivable).toBe(13_273_675_000n);
    expect(receivable).toBe(README_TOTALS.receivablesOpening + allSales);

    // Stock out: 1301 value after 07 minus the FIFO cost of the issued quantities (independent replay).
    const valuation = await apiGet<{ totalInventoryValue: number | string; rows: Array<{ sku: string; quantity: number; fifoValue: number | string }> }>(
      page,
      'inventory/valuation',
    );
    const consumed = [...trace.consumedBySale.values()].reduce((acc, c) => acc + c, 0n);
    const closingFifoValue = [...trace.closingValueBySku.values()].reduce((acc, v) => acc + v, 0n);
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
      lines: Array<{ accountCode: string; debit: number | string; credit: number | string }>;
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
  });

  test.fixme('09 POS walk-in sale: 1 x ITM-1001 paid in cash [E1]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/invoicing');
    void M1_MONTH_OPERATIONS.posWalkInSale; // total 20,487,500 incl. VAT; no customer
  });

  test.fixme('10 sales return: CUST-001 returns 1 unit of INV-S-1403-0001 [E1]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/invoicing');
    void M1_MONTH_OPERATIONS.salesReturn; // credit note linked to the original invoice
  });

  test.fixme('11 cheque received: CUST-002 settles INV-S-1403-0002, held in hand [E1]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/cheques');
    void M1_MONTH_OPERATIONS.chequeReceived; // 36,712,500 to 1110, not deposited
  });

  test.fixme('12 bank reconciliation with bank-statement.csv: 100 lines matched [E3]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/accounting/bank/reconcile');
    void SAMPLE_COMPANY_FILES.bankStatement;
    // Every statement line matched or posted; no unreconciled lines left.
  });

  // ---- Month-end assertions against the README totals --------------------------------------------------

  test.fixme('13 receivables 1201 equal the expected closing [E4]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/accounting/reports');
    void M1_EXPECTED_CLOSING.receivables; // 9,396,312,500
  });

  test.fixme('14 payables 2101 equal the expected closing [E4]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/accounting/reports');
    void M1_EXPECTED_CLOSING.payables; // 5,420,780,000
  });

  test.fixme('15 stock value 1301 equals the expected closing [E2]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/inventory');
    void M1_EXPECTED_CLOSING.stockValue; // 252,026,700,000
  });

  test.fixme('16 bank 1101 equals the reconciled statement balance [E3]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/accounting/bank');
    void M1_EXPECTED_CLOSING.bankBalance; // 2,485,000,000
  });

  test.fixme('17 trial balance is balanced: total debit = total credit [E3]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/accounting');
    // «وضعیت تراز دفاتر» shows «تراز», not «ناتراز» (see e2e/app/03-accounting.spec.ts).
  });
});
