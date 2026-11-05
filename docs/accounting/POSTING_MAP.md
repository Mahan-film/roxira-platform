# Posting map (who creates vouchers today)

Status: 2026-11-04, from `origin/main` @ cf2a7791a. Part of pinned issue #230 (automatic accounting).
All paths are under `output_apps/enterprise_hub/modules/`. Every site ends in `AccountingService.createJournalEntry`
(`accounting/services/accounting.service.ts:577`) except the fiscal close (`postTypedEntry`, line 588).
Target: all of them build their lines through `posting_rules`.

Lane: **Mac** = posting_rules owner adopts it; **Laptop** = `mahansudo` lane, handled by `claude-win` issues.

| # | Document type (engine key) | Site | Accounts today (hardcoded) | Idempotency today | Lane |
|---|---|---|---|---|---|
| 1 | Sales invoice (`invoice.sale.issue`, `.cancel`, `.settle`, `.settle_card_first`) | `invoicing/services/invoice-posting.service.ts` via `PostingRulesService.post` (source `invoice`/invoice id; amounts in `invoicing/services/invoice-voucher.ts`) | template defaults = the legacy codes: receivable 1201, sales 4101, VAT payable 2301, cash 1010, POS clearing 1015, inventory 1301, COGS 5101. The service still resolves accounts the old way (name match, else create) and passes them as overrides, except roles the tenant mapped in the settings page | entry number per invoice (`INV-<id>-ISSUED/PAID/CANCEL`) + engine source idempotency per document type | Laptop (done, #378) |
| 2 | Purchase invoice (`invoice.purchase.issue`, `.cancel`, `.settle`, `.settle_card_first`) | same service | payable 2101, VAT receivable 1401, purchases 5201, inventory 1301 (template defaults) | same as row 1 | Laptop (done, #378) |
| 3 | POS sale / POS close | `invoicing/services/pos-sale.service.ts` creates a PAID invoice; posting is row 1 (issue voucher AR/sales/VAT, then `invoice.sale.settle` Dr clearing 1015 or cash 1010 / Cr AR). The `pos.sale` shape in #378 (revenue straight to cash) would change the vouchers, so it was not added | clearing 1015, cash 1010 | as row 1 | Laptop (done, #378) |
| 4 | **Stock documents** (`stock.opening`, `stock.adjustment_gain`, `stock.adjustment_loss`) | `inventory/services/stock-documents.service.ts` (`postValueEntry`, via `PostingRulesService.post`) | **adopted by #380**: the codes are passed as `overrides` resolved by the legacy name match (`StockDocumentsService.resolveAccounts`, `inventory/constants/stock-accounts.ts`); the templates carry no `defaults` yet, so inventory 1301 / opening equity 3030 / stock adjustment 5301 must still be supplied by the caller (NEEDS MAC) | sourceType `stock_document`, id = document id, entry number `STK-<docNumber>` | Laptop |
| 5 | Fixed-asset depreciation (`asset.depreciation`) | `accounting/services/fixed-asset.service.ts` `runMonth` (`PostingRulesService.post`) | per-asset `expenseAccountCode` / `accumulatedAccountCode` passed as `overrides` (`depreciation_expense`, `accumulated_depreciation`) | one voucher per asset+period: sourceType `asset_depreciation`, sourceId `<assetId>:<YYYYMM>`, number `DEP-YYYYMM-<n>`; the engine is looked up through `ModuleRef` (PostingRulesModule imports AccountingModule) | Laptop |
| 6 | Petty cash charge/expense/replenish (`pettycash.*`) | `accounting/services/petty-cash.service.ts:290` (`PostingRulesService.post`), `:445` (settle stays raw) | **adopted by #386** for charge/return/replenish (`pettycash.fund_charge` / `pettycash.fund_return`), sourceType `petty_cash_tx`, sourceId = transaction row id, number `PC-<id>`, overrides `{petty_cash, counter}`; `settle()` (`PCS-`) stays raw because a template cannot repeat lines (NEEDS MAC: variable-line templates) | engine source idempotency (replayed:true) | Laptop |
| 7 | Fiscal close | `accounting/services/fiscal-year.service.ts:268` (`postTypedEntry`) | 3050 income summary, 3040 retained earnings | one per year | Laptop (typed entry, outside the engine) |
| 8 | Captured vendor invoice (`capture.expense`) | `invoice_capture/services/capture.service.ts:412` | cash 1010, receivable 1020, payable 2010, VAT 2020, revenue 4010, default expense 5030 (`invoice_capture/constants/capture.constants.ts:38`) | capture id | Laptop |
| 9 | Data import journal lines | `data_import/registry/accounting-journal-lines.registry.ts:236` | codes come from the imported file | batch id | Laptop (stays raw) |
| 10 | **Cheque creation/transition** (`cheque.*`) | `cheques/services/cheques.service.ts:218`; rules in `cheques/lifecycle/cheque-lifecycle.ts` | bank 1010, receivable 1020, payable 2010, notes-in-hand 1110, notes-in-collection 1120, notes payable 2110 (`cheques/constants/cheque.constants.ts:117`) | random suffix, **not idempotent** | **Mac** |
| 11 | **Payroll run** (`payroll.run`) | `hr/services/payroll-run.service.ts:610` (`PostingRulesService.post`) | engine template `payroll.run`; defaults salary expense 5010, employer insurance expense 5040, insurance payable 2030, wage tax payable 2040, other deductions 2060, salaries payable 2050 (`hr/constants/hr.constants.ts:174`) | entry number `PR-YYYYMM` (adopts existing) + engine source idempotency | **Mac** |
| 12 | **Single payslip** (`payroll.payslip`) | `hr/services/hr.service.ts:860` (`PostingRulesService.post`) | engine template `payroll.payslip`; defaults expense 5010, payable 2010, bank 1010 | entry number per payslip + engine source idempotency | **Mac** |
| 13 | **Corporate tax provision** (`tax.provision`) | `tax_compliance/services/corporate-tax.service.ts:97` (proposal only, `posted:false`) | accounts passed in by the caller (`expenseAccountCode`, `payableAccountCode`) | none | **Mac** |
| 14 | **Bank reconciliation draft** (`bank.recon`) | `banking/recon/recon.service.ts:858` | ledger account of the bank account + counter account of the rule/category | draft id | **Mac** |
| 15 | **Manual bank entry** (`bank.entry`) | `banking/services/banking.service.ts:390` | ledger code of the bank account + counter chosen by the caller | none | **Mac** |

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
3. **No idempotency on cheques, bank, petty cash.** Only payroll and invoices adopt an existing entry by number.
4. **Account creation inside business services** (`ensureAccounts`, `ensurePayrollAccounts`, invoice-posting
   line 868, inventory 455) is replaced by an explicit "unmapped role" Persian error plus the settings page.
5. **Dates:** payroll uses the Jalali month end; cheques use the event date; the rest use `new Date()`. The engine
   takes the date from the source document and never from the clock.
