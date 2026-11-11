# M1 "Shop-ready" acceptance gate

Issue #116, epic E0. M1 is done when `e2e/tests/m1-shop-month.spec.ts` is green in CI and in production smoke.
The spec runs one month of the fictional trading company in `e2e/fixtures/sample-company/` (synthetic data only).

## Files

| File | Role |
|---|---|
| `e2e/tests/m1-shop-month.spec.ts` | The gate: a fixture self-check plus one test per gate step |
| `e2e/tests/m1-accountant-day.spec.ts` | The accountant day go-live gate (T91): sign up, chart from template, opening balances, 5 keyboard vouchers, sales invoice, receipt, purchase invoice, cheque received and cleared, trial balance, P&L, balance sheet, period close, reopen refused |
| `e2e/tests/m1/expected-totals.ts` | `README_TOTALS` (mirrors `e2e/fixtures/sample-company/README.md` lines 10-19), the month's hand-entered documents, and `M1_EXPECTED_CLOSING` |
| `e2e/tests/m1/accountant-day-expected.ts` | Hand-computed ledger totals, trial balance, P&L and balance sheet constants for the accountant day gate |
| `e2e/app/fixtures.ts` | `sessionKind: 'm1'`, `findSessionFile`, `loginAsTestTenant` |

## Running it

```
cd e2e && npm ci
npx playwright test m1-shop-month --list   # no server
npx playwright test m1-shop-month          # self-check runs; gate steps skip without a sandbox
```

Against the Gate 3 sandbox (`scripts/infra/e2e/README.md`), with a fresh, empty tenant for the gate:

```
bash scripts/infra/e2e/sandbox_up.sh origin/main
bash scripts/infra/e2e/mkuser.sh m1                      # prints SESSION_FILE=...
set -a; source "${TMPDIR:-/tmp}/rxtest/out/app_e2e.env"; set +a
cd e2e && npx playwright install chromium
E2E_BASE_URL=$APP_E2E_BASE_URL APP_E2E_SESSION_FILE_M1=<SESSION_FILE> npx playwright test m1-shop-month
```

Without `APP_E2E_SESSION_FILE_M1`, the gate uses the import tenant of the browser project, then the seeded tenant.
The gate writes data. It skips unless the base URL is `127.0.0.1` or `localhost`, or `M1_E2E_ALLOW_REMOTE=1` is set.

## Expected month-end figures

The README totals come from the files. The gate adds three hand-entered documents
(`M1_MONTH_OPERATIONS`; amounts taken from fixture rows, fixture VAT rate 10%):

| Document | Effect |
|---|---|
| POS walk-in sale: 1 x ITM-1001, cash, 20,487,500 incl. VAT | stock -14,900,000; cash 1102 (not the bank) |
| Sales return: CUST-001, 1 unit of INV-S-1403-0001 | receivables -20,487,500; stock +14,900,000 |
| Cheque received: CUST-002 settles INV-S-1403-0002, held in hand (1110) | receivables -36,712,500 |

| Figure | Expected (IRR) | Basis |
|---|---:|---|
| Receivables 1201 | 9,396,312,500 | README "Closing Unique" + return + cheque |
| Payables 2101 | 5,420,780,000 | README "Closing Unique" |
| Stock value 1301 | 252,026,700,000 | README stock value (POS sale and return cancel out) |
| Bank 1101 | 2,485,000,000 | README bank closing = reconciled statement |
| Trial balance | debit = credit | |

Open question for E2 and E5: the README stock value is the item file's quantity x cost. The gate assumes that the
item file is the on-hand stock at the end of the month, and that the imported invoices post receivables and payables
but no stock movements. If the importer moves stock for historical invoices, change the expected stock value in
`expected-totals.ts`, not the README.

## Steps and the epic that turns each one green

| # | Step | Epic | State |
|---|---|---|---|
| - | Fixture self-check (4 tests: README constant, CSV totals, bank roll-forward, closing derivation) | E0 | green (no server) |
| 01 | Log in as the test tenant | E0 | real test; runs only against the sandbox |
| 02 | Import chart of accounts (18 accounts) | E5 | fixme |
| 03 | Import customers and suppliers (48 unique, 2 duplicates dropped) | E5 | fixme |
| 04 | Import items (300) | E5 | fixme |
| 05 | Import opening balances (balanced opening voucher) | E5 | fixme |
| 06 | Import invoices (240, duplicate rows counted once) | E5 | fixme |
| 07 | Post purchase invoices | E2 | fixme |
| 08 | Post sales invoices | E1 | fixme |
| 09 | POS walk-in sale | E1 (E1.4) | real test: POS sale through `invoicing/pos-sales`; cash to 1102, bank untouched |
| 10 | Sales return linked to the original invoice | E1 (E1.2) | real test: return through the plain RETURN invoice (subject 4, linked to the sale): the quick-sale return refuses imported invoices (no customerId, #548) |
| 11 | Cheque received and held | E1 (E1.4) | real test: cheque `received` registered, not deposited; the cheque template receivable role is pinned to 1201 (its default 1020 is not in this chart) |
| 12 | Bank reconciliation with `bank-statement.csv` | E3 | real test: statement unmatched by design; owner creates clearing account 1199, points recon category accounts at it, approves 100 drafts; 1199 net debit 15,000,000 |
| 13 | Receivables equal the expected closing | E4 | real test: 1201 = 9,396,312,500 |
| 14 | Payables equal the expected closing | E4 | real test: 2101 = 5,420,780,000 |
| 15 | Stock value equals the expected closing | E2 | real test: ledger 1301 = FIFO valuation = 249,383,200,000 |
| 16 | Bank balance equals the reconciled statement | E3 | real test: 1101 = 2,485,000,000 |
| 17 | Trial balance is balanced | E3 | real test: trial balance debit = credit and «تراز» on the accounting page |

To turn a step green, change `test.fixme(` to `test(`, write the body against the page named in it, and update the
State column here and the M1 gate row in `docs/strategy/REQUIREMENTS_STATUS.md`. The steps run serially, in order.
A CI job for the gate comes from the Mac (issue #116 section 5).

## Import steps 02-06 (T5, #466): status and product gaps

| Step | Status | Note |
|---|---|---|
| 02 chart of accounts | real test | `accounting-accounts` registry, explicit column mapping, 18 accounts via API and chart page |
| 03 parties | real test | imported into the party master (`parties`, table `erp_parties`): 48 inserted, 2 duplicates skipped; asserts code, role (29 customers, 19 suppliers), name, national id, phone and email per party from the CSV. Gap A is closed: a document can link to a party by code |
| 04 items | real test | gap B closed (#470): the `inventory-items` import takes unit cost; rows with quantity > 0 receive stock into a FIFO layer (`InventoryService.importStockItemWithOpeningStock`), no cost column on `erp_stock_items`. 300 items, valuation 252,026,700,000. It posts NO voucher: 1301 comes from step 05. Follow-up: a user with no opening voucher gets stock but no ledger value until a posting flow exists |
| 05 opening balances | real test | one voucher of 14 lines, debit = credit = 259,026,700,000; 1201 and 2101 from README |
| 06 invoices | `fixme` | gap C: invoice import is a one-line stub (no type, date, items, VAT, multi-line; placeholder buyer name). The file has 238 distinct invoice numbers; the README's 240 counts the 2 repeated rows |
