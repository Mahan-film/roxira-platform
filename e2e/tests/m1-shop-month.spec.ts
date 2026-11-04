import { test, expect, findSessionFile, loginAsTestTenant } from '../app/fixtures';
import { M1_EXPECTED_CLOSING, M1_MONTH_OPERATIONS, README_TOTALS } from './m1/expected-totals';
import { bankStatementRollForward, computeTotalsFromCsv, readReadmeTotals, SAMPLE_COMPANY_FILES } from './m1/fixture-data';

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

  test.fixme('02 import chart of accounts: 18 accounts [E5]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/import');
    void SAMPLE_COMPANY_FILES.chartOfAccounts;
    // Upload, map, commit; /app/accounting lists 18 accounts incl. 1101, 1201, 1301, 2101.
  });

  test.fixme('03 import customers and suppliers: 48 unique parties, 2 duplicates dropped [E5]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/import');
    void SAMPLE_COMPANY_FILES.parties;
    // 30 customers + 20 suppliers in the file, rows 30 and 50 are duplicates; Arabic ي/ك normalised.
  });

  test.fixme('04 import items: 300 items with stock and unit cost [E5]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/import');
    void SAMPLE_COMPANY_FILES.items;
    // /app/inventory shows 300 items; stock value equals README_TOTALS.stockValue.
  });

  test.fixme('05 import opening balances: one balanced opening voucher [E5]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/import');
    void SAMPLE_COMPANY_FILES.openingBalances;
    // Debit = credit = README_TOTALS.openingDebit; 1201 = receivablesOpening, 2101 = payablesOpening.
  });

  test.fixme('06 import invoices: 240 invoices, duplicate rows counted once [E5]', async ({ page }) => {
    await loginAsTestTenant(page, '/app/import');
    void SAMPLE_COMPANY_FILES.invoices;
    // 144 sales + 96 purchases; 6 blank-customer walk-in rows; must NOT reach the *ClosingRaw totals.
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
