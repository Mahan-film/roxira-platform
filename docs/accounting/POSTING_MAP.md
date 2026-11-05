# Posting map (who creates vouchers today)

Status: 2026-11-04, from `origin/main` @ cf2a7791a. Part of pinned issue #230 (automatic accounting).
All paths are under `output_apps/enterprise_hub/modules/`. Every site ends in `AccountingService.createJournalEntry`
(`accounting/services/accounting.service.ts:577`) except the fiscal close (`postTypedEntry`, line 588).
Target: all of them build their lines through `posting_rules`.

Lane: **Mac** = posting_rules owner adopts it; **Laptop** = `mahansudo` lane, handled by `claude-win` issues.

| # | Document type (engine key) | Site | Accounts today (hardcoded) | Idempotency today | Lane |
|---|---|---|---|---|---|
| 1 | Sales invoice (`invoice.sale`) | `invoicing/services/invoice-posting.service.ts:141` (+ `buildLines` ~731-792) | receivable 1201, sales 4101, VAT payable 2301, cash 1010, POS clearing 1015, inventory 1301, COGS 5101 (`invoicing/constants/suite-events.constants.ts:41-113`) | entry number per invoice | Laptop |
| 2 | Purchase invoice (`invoice.purchase`) | same file, lines 230/301 | payable 2101, VAT receivable 1401, purchases 5201, inventory 1301 | entry number per invoice | Laptop |
| 3 | POS sale / POS close (`pos.sale`) | `invoicing/services/pos-sale.service.ts` via invoice-posting | clearing 1015, cash 1010 | entry number | Laptop |
| 4 | Stock documents (`stock.opening`, `stock.adjustment`) | `inventory/services/stock-documents.service.ts:352,420,455` | inventory 1301, opening equity 3030, adjustment 5301 (`inventory/constants/stock-accounts.ts`) | document id in number | Laptop |
| 5 | Fixed-asset depreciation (`asset.depreciation`) | `accounting/services/fixed-asset.service.ts:165` | per-asset `expenseAccountCode` / `accumulatedAccountCode` | run per asset+period | Laptop |
| 6 | Petty cash charge/expense/replenish (`pettycash.*`) | `accounting/services/petty-cash.service.ts:286,434` | fund account + user-chosen counter account | none (random id) | Laptop |
| 7 | Fiscal close | `accounting/services/fiscal-year.service.ts:268` (`postTypedEntry`) | 3050 income summary, 3040 retained earnings | one per year | Laptop (typed entry, outside the engine) |
| 8 | Captured vendor invoice (`capture.expense`) | `invoice_capture/services/capture.service.ts:412` | cash 1010, receivable 1020, payable 2010, VAT 2020, revenue 4010, default expense 5030 (`invoice_capture/constants/capture.constants.ts:38`) | capture id | Laptop |
| 9 | Data import journal lines | `data_import/registry/accounting-journal-lines.registry.ts:236` | codes come from the imported file | batch id | Laptop (stays raw) |
| 10 | **Cheque creation/transition** (`cheque.*`) | `cheques/services/cheques.service.ts:218`; rules in `cheques/lifecycle/cheque-lifecycle.ts` | bank 1010, receivable 1020, payable 2010, notes-in-hand 1110, notes-in-collection 1120, notes payable 2110 (`cheques/constants/cheque.constants.ts:117`) | random suffix, **not idempotent** | **Mac** |
| 11 | **Payroll run** (`payroll.run`) | `hr/services/payroll-run.service.ts:587` (`buildJournalLines` 498) | salary expense 5010, employer insurance expense 5040, insurance payable 2030, wage tax payable 2040, other deductions 2060, salaries payable 2050 (`hr/constants/hr.constants.ts:174`) | entry number `PR-YYYYMM` (adopts existing) | **Mac** |
| 12 | **Single payslip** (`payroll.payslip`) | `hr/services/hr.service.ts:881` | expense 5010, payable 2010, bank 1010 | entry number per payslip | **Mac** |
| 13 | **Corporate tax provision** (`tax.provision`) | `tax_compliance/services/corporate-tax.service.ts:97` (proposal only, `posted:false`) | accounts passed in by the caller (`expenseAccountCode`, `payableAccountCode`) | none | **Mac** |
| 14 | **Bank reconciliation draft** (`bank.receipt` / `bank.payment`) | `banking/recon/recon.service.ts:862` | bank account ledger code + counter account of the rule/category, passed as engine `overrides` (`bank` / `counter`) | engine source ledger `bank_recon_draft` = draft id (replay-safe) | **Mac** |
| 15 | **Manual bank entry** (`bank.receipt` / `bank.payment`) | `banking/services/banking.service.ts:396` | bank account ledger code + counter chosen by the caller, passed as engine `overrides` (`bank` / `counter`) | engine source ledger `bank_entry` = statement line id (replay-safe) | **Mac** |

## Findings that matter

1. **Two incompatible code sets.** Invoicing posts to 1201/4101/2301/2101/1401/5101/5201, while the default chart, the
   Iran chart template, capture and payroll use 1020/4010/4020/2020/2010/5110. A tenant on the Iran template has no
   account for invoice postings unless the invoicing code creates them. A per-tenant role map removes this: role
   `receivable` maps to whatever account the tenant's chart has.
2. **Cheque codes collide with the Iran chart template.** Cheques use 1110/1120/2110 for notes receivable / notes
   payable, but `iran-chart-template.ts` defines 1110 = land, 1120 = accumulated depreciation, 2110 = long-term loans.
   `ensureAccounts` creates the cheque accounts only when the code is missing, so on a template chart cheques post to
   land and accumulated depreciation. New roles `cheques_receivable`, `cheques_in_collection`, `cheques_payable`
   fix this. Behaviour-preserving adoption keeps the old codes as the default for existing tenants (see
   POSTING_RULES.md, "Defaults").
3. **Idempotency was missing on cheques, bank, petty cash.** Cheques and bank now post through the engine's source
   ledger (one voucher per source document, a second call replays the first). Only petty cash still relies on a random id.
4. **Account creation inside business services** (`ensureAccounts`, `ensurePayrollAccounts`, invoice-posting
   line 868, inventory 455) is replaced by an explicit "unmapped role" Persian error plus the settings page.
5. **Dates:** payroll uses the Jalali month end; cheques use the event date; the rest use `new Date()`. The engine
   takes the date from the source document and never from the clock.
