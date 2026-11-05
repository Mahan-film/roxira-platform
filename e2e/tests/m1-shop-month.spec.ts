import { test, expect, fa, findSessionFile, loginAsTestTenant } from '../app/fixtures';
import { M1_EXPECTED_CLOSING, M1_MONTH_OPERATIONS, README_TOTALS } from './m1/expected-totals';
import { bankStatementRollForward, computeTotalsFromCsv, readCsv, readReadmeTotals, SAMPLE_COMPANY_FILES } from './m1/fixture-data';
import { apiGet, importFile, persianise, rials } from './m1/import-ui';

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
    const codes = rows.map((r) => r[header.indexOf('کد طرف حساب')]);
    expect(rows).toHaveLength(50);
    expect(new Set(codes).size).toBe(48); // the file: 30 customers + 20 suppliers, 2 rows repeated
    const counts = await importFile(page, SAMPLE_COMPANY_FILES.parties, 'crm-leads', {
      'کد طرف حساب': null, // GAP: the CRM lead has no party code
      'نقش': null, // GAP: the CRM lead has no customer/supplier role
      'نام و نام خانوادگی': 'fullName',
      'شرکت': 'company',
      'رایانامه': 'email',
      'تلفن': 'phone',
      'شناسه ملی / کد اقتصادی آزمایشی': null, // GAP: no national id on the lead
      'مرحله فروش': 'pipelineStage',
      'ارزش برآوردی (ریال)': 'estimatedValue',
      'توضیحات': 'notes',
    });
    expect(counts).toEqual({ inserted: 48, skippedDuplicates: 2, failed: 0 });

    const leads = await apiGet<{ total: number; data: Array<{ fullName: string; company: string | null }> }>(
      page,
      'crm/leads?limit=100',
    );
    expect(leads.total).toBe(48);
    const expectedNames = [...new Set(rows.map((r) => persianise(r[header.indexOf('نام و نام خانوادگی')])))];
    expect(leads.data.map((l) => l.fullName).sort()).toEqual(expectedNames.sort());
    for (const lead of leads.data) {
      expect(`${lead.fullName} ${lead.company ?? ''}`, 'Arabic ي/ك normalised').not.toMatch(/[يك]/);
    }
  });

  // Needs a product feature (issue: items import has no unit cost). See the gap list in docs/testing/M1_GATE.md.
  test.fixme('04 import items: 300 items with stock and unit cost [E5]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/import');
    void SAMPLE_COMPANY_FILES.items;
    // GAP: the `inventory-items` registry (modules/data_import/registry/inventory-items.registry.ts) maps sku,
    // barcode, name, quantity, minQuantity, batchNumber only. The file column «بهای واحد (ریال)» has no target and
    // erp_stock_items (modules/inventory/entities/stock-item.entity.ts) has no cost column, so «stock value equals
    // README_TOTALS.stockValue» (252,026,700,000) cannot hold after the import.
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

  // Needs a product feature (issue: invoice import is a stub). See the gap list in docs/testing/M1_GATE.md.
  test.fixme('06 import invoices: 240 invoices, duplicate rows counted once [E5]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/import');
    void SAMPLE_COMPANY_FILES.invoices;
    // GAP: `sales-invoices` registry + InvoicingService.importInvoices (modules/invoicing/services/invoicing.service.ts,
    // ~line 1202) turn each row into a one-line invoice priced `amount`, with buyer «طرف حساب <code>» and no date,
    // type, item, quantity or VAT. Rows with the same number are dropped as duplicates, so the 40 multi-line invoices
    // keep one line each; purchases (143 rows) are stored as sales invoices. Also: the file holds 238 distinct numbers
    // (360 rows, 2 repeated rows), while the README counts 240 including those 2 repeats.
    // Expected once built: 238 invoices (143 sales + 95 purchases), receivables/payables *ClosingUnique, not *ClosingRaw.
  });

  // ---- Post the month ----------------------------------------------------------------------------------

  test.fixme('07 post purchase invoices: stock in, payables up [E2]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/invoicing');
    // 2101 = README_TOTALS.payablesClosingUnique after posting.
  });

  test.fixme('08 post sales invoices: stock out, receivables up [E1]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/invoicing');
    // 1201 = README_TOTALS.receivablesClosingUnique after posting.
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
