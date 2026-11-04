# Must-have reports for Iranian SMB customers (research, 2026-11-04)

Goal: the report list a trading company (شرکت بازرگانی/فروشگاه) and a service company (شرکت خدماتی)
expect, compared with what Roxira has today. Pinned parent: #230. Research issue: #239.

## How this was built, and its limits

- **Competitor evidence (verified (web))**: the Sepidar product page lists four-, six- and eight-column
  trial balance, ledgers at all levels, income statement and financial position, account turnover and
  balance reports, account review (مرور حساب), profit and loss by item or service, and stock cardex per
  warehouse ([sepidarsystem.com](https://www.sepidarsystem.com/products/sepidar/accounting-system/)).
  It also names separate modules for sales, distribution, warehouse, treasury (receipts and payments),
  payroll and the Moadian link.
- **Not verified**: Hamkaran, Mahak, Holoo, Parsian, Kasbkar feature lists could not be fetched with
  the available search stack (results were vendor home pages with no report lists). The remaining rows
  are `convention`: what accountants and Iranian software normally provide, and what tax duties imply
  (Direct Taxes Act art. 169 seasonal transactions, VAT seasonal return, payroll insurance list and
  wage-tax files; these duties are covered in `docs/strategy/REQUIREMENTS_STATUS.md`).
- Status was read from code (`modules/*/controllers`, `accounting/reports`, `REQUIREMENTS_STATUS.md`),
  not from running the product. `exists` = an endpoint or export is in the code. `partial` = data or part
  of the report exists. `missing` = nothing found by grep.
- Who needs it: **T** trading company, **S** service company, **B** both.

## Table

| # | Report | Who | Status | What exists (evidence) | Gap | Lane | Issue |
|---|---|---|---|---|---|---|---|
| R-01 | Trial balance 2/4/6/8/10 columns | B | exists | `GET accounting/reports/trial-balance`, export `trial-balance` | none | accounting | - |
| R-02 | General ledger and subsidiary ledger per account, detail levels | B | exists | `reports/ledger`, `reports/subsidiary`, `accounts/:code/ledger`; UI `account-ledger-panel.tsx` | account review (مرور حساب) with drill from total to detail is partial in UI | accounting | - |
| R-03 | Income statement, balance sheet, cash flow, equity changes | B | exists | `reports/statements.ts`, four endpoints, exports | none | accounting | - |
| R-04 | Party statement (صورت‌حساب طرف حساب) with running balance, printable | B | partial | ageing per party (`reports/ageing`), subsidiary by detail | no per-party statement with running balance to send a customer | accounting | #242 |
| R-05 | Receivable and payable ageing | B | exists | `reports/ageing`, export `ageing` (FIFO; #237 moves it to real allocations) | allocation accuracy tracked in #237 | accounting | #237 |
| R-06 | Chart of accounts export | B | exists | export `chart-of-accounts` | none | accounting | - |
| R-07 | Journal search and voucher list | B | exists | `GET accounting/journal-entries` filters, `journal-search.pg.spec.ts` | none | accounting | - |
| R-08 | Sales by item, customer, salesperson | T (S by service/customer) | missing | invoice list `GET invoicing` only | no grouped sales report | invoicing | #243 |
| R-09 | Purchases by item and supplier | T | missing | purchase invoices stored (direction PURCHASE); seasonal purchases CSV for tax | no management report | invoicing | #244 |
| R-10 | Stock cardex (کاردکس کالا) per item and warehouse | T | missing | `GET inventory/warehouses/:id/stock`, `valuation`, stock documents list | no per-item chronological ledger with running quantity and value | inventory | #245 |
| R-11 | Stock balance as of a date, reorder alerts | T | partial | current stock and FIFO valuation (`GET inventory/valuation`) | no as-of date, no reorder point (REQUIREMENTS I-02) | inventory | #246 |
| R-12 | Profit per invoice, item, customer | T (S per customer) | missing | COGS stored in `invoices.posting_meta` (see `docs/accounting/INVOICE_KINDS.md`) | no report | invoicing | #247 |
| R-13 | POS day-end close, daily sales | T retail | missing | `pos-sales` flow, payments by method stored | no close report, no cash count | invoicing | #248 |
| R-14 | Cash book and bank book (گردش صندوق / بانک) | B | partial | bank `accounts/:id/book-lines`, `summary`; petty cash `funds`; ledger of cash account | no unified cash/bank book print with opening and closing | treasury | covered by #254 scope note below |
| R-15 | Legal books: journal (دفتر روزنامه) and general ledger (دفتر کل) as paginated print | B | partial | `journal.csv`, `ledger.csv` (LDG-01) | no print-ready paginated book | accounting | #249 |
| R-16 | Cost-centre and project reports | B | partial | `GET dimensions/:kind/balances` | no statements per centre (REQUIREMENTS: cost centres missing) | accounting | covered by REQUIREMENTS E-02 |
| R-17 | Management dashboard (revenue, expenses, cash, receivables, top customers) | B | partial | `GET accounting/reports/dashboard`; assistant metrics (27 certified read-only); CRM `stats`, `pipeline` | no sales or stock tiles, no top-customer/overdue tiles | accounting | covered by R-08/R-12 feeding tiles |
| R-18 | Fixed-asset register and depreciation schedule | B | partial | `GET fixed-assets` list, depreciation posting (`fixed-assets.pg.spec.ts`) | no register/schedule report | accounting | #250 |
| R-19 | Cheque due list | B | exists | `GET cheques/due` | see R-25 for registers | cheques | - |
| R-20 | Bank reconciliation report | B | partial | `modules/banking/recon` matching, statement parser | no printable reconciliation statement; owned by bank-reconcile work (PR #916) | treasury | - |
| R-21 | VAT seasonal return per Jalali season | B | exists | `GET vat-return`, `vat-return/export`, `vat-seasonal` (RET-01) | returns/correctives not netted in seasonal report (see INVOICE_KINDS limits) | tax | - |
| R-22 | Monthly VAT summary for the books | B | missing | none (E-03 gap in REQUIREMENTS_STATUS) | output vs input VAT per month reconciled to ledger | tax | #251 |
| R-23 | Seasonal transactions report (Art. 169), sales and purchases | B | exists | `seasonal-transactions(.csv)`, `seasonal-purchases.csv` (QTR-01 partial) | threshold rule partial | tax | - |
| R-24 | Corporate tax draft | B | partial | `corporate-tax.controller.ts` | only a draft; annual return forms missing | tax | - |
| R-25 | Cheque registers: portfolio, by bank/status, bounced | B | partial | `GET cheques`, `due`, lifecycle states | no registers, no bounced report, no portfolio total | cheques | #252 |
| R-26 | Payslips, insurance list, wage-tax files, payroll reconciliation | B | exists | `payslips-pdf`, `insurance-list`, `wage-tax-files`, `reconciliation` (PAY-02, INS-01, PAY-01) | formats flagged unverified in REQUIREMENTS | hr | - |
| R-27 | Payroll register (monthly) and annual employee earnings | B | missing | `GET payroll-runs/:id` returns the run | no register print, no annual per-employee summary | hr | #253 |
| R-28 | Employee/leave and end-of-service reports | B | partial | `end-of-service`, `settlement`, seniority calculators in code | no listing reports | hr | covered by #253 scope note below |
| R-29 | Customer 360 and CRM funnel | B | exists | CRM `stats`, `pipeline`, clickable drill-down | none | crm | - |
| R-30 | Cash-flow forecast (receipts vs payments next 30/60/90 days) | B | missing | ageing and cheques due exist separately | no forecast | treasury | #254 |

Scope notes: R-14 (cash and bank book) is included in the treasury forecast issue #254 as a prerequisite
view and should be split by the Mac lane if it grows. R-28 is covered by the payroll register issue #253
as a second tab. R-16 and R-17 depend on rows that already have their own issue.

## Summary by lane

- Laptop (`claude-win`): R-04, R-08, R-09, R-10, R-11, R-12, R-13, R-15, R-18 (issues #242-#250).
- Mac (`mac`): R-22, R-25, R-27, R-30 (issues #251-#254).
- Print wiring, one `claude-win` issue per form: #255-#262 (see `PRINT_FORMS.md` §8).

## Report sets by company type

- **Trading company (T)**: R-01 to R-07, R-08 to R-13, R-14, R-15, R-17, R-19 to R-27, R-29, R-30.
- **Service company (S)**: R-01 to R-07, R-08 (by service/customer), R-12 (per customer), R-14 to R-17, R-19 to R-27, R-29, R-30; no stock reports (R-10, R-11).

## Open questions (unverified)

1. Which of the competitor reports are used weekly versus once a year? Only interviews with accountants answer this.
2. Exact required columns of the printed legal journal and ledger under the Iranian commercial code: not read.
3. Whether the tax office expects the monthly VAT summary at all (E-03 says "monthly summary for books"); it may be an internal report only.
