# Audit of issue #230 against origin/main (aa571078, 2026-11-05)

Read-only audit. Paths are relative to `output_apps/enterprise_hub/` unless they start with `docs/`.
Status words: **present** = code located and read by grep or listing; **partial** = part of the capability exists; **missing** = nothing found.
A sub-capability is "present" on code alone. The item-level standard (page, Persian help, REQUIREMENTS row done) is judged separately in the "Item standard" line.
Rule used for TICK: all sub-capabilities present AND page AND Persian help AND REQUIREMENTS row done. No item meets it.

Corrections to the handoff and the issue text found on the way:
- PR #157 (fixed-assets zero-rounding fix, issue #129) is OPEN. The handoff lists it as merged.
- PR #441 (posting rules for tax provision) is CLOSED, not merged. The handoff lists it as adopted. `modules/tax_compliance/posting/tax-provision-proposal.ts` (#409) is a pure mapper, unwired.
- PR #164 (cost centres, trial balance by cost centre) is OPEN. A first cost-centre layer is on main through commit 89de2dbe (#970, 2026-11-01).
- PR #234 treasury is merged, but it has no page and treasury still posts through `TreasuryLedgerPostingAdapter`. The posting-rules adapter exists but is not wired in `modules/treasury/treasury.module.ts`.
- `docs/strategy/REQUIREMENTS_STATUS.md` is stale for fixed assets (I-04 still says "no asset register") and E-02 (says "no cost centres"). Only these rows are `done`: E-05, PAY-02 (API), four-level chart, fiscal years and year close, 2 to 10 column trial balance, balance sheet/P&L/cash flow, hash-chained audit.
- Persian help on main: `docs/help/fa/01` to `16`. Nothing for chart of accounts, vouchers, fiscal years, petty cash, inventory counts, or cost centres. Pages 12 (fixed assets) and 16 (treasury) say "TODO: not built yet" for the UI.

## Core ledger (owner per issue: laptop, lane `modules/accounting`)

### 1. Chart of accounts: tree, floating detail levels, cost centres (#164), projects
| Sub-capability | Status | Proof | Spec / page |
|---|---|---|---|
| Account tree (GROUP/KOL/MOEIN/TAFSILI, template) | present | `modules/accounting/enums/accounting.enum.ts` (AccountLevel), `services/chart-template.service.ts` | `fiscal-close.pg.spec.ts` ("applies the template additively"), page component `frontend/src/components/accounting/account-tree-card.tsx` on `/app/accounting` |
| Floating detail levels | partial (API only) | `modules/accounting/services/dimension.service.ts` (DimensionKind.DETAIL) | `dimensions.pg.spec.ts`; no page |
| Cost centres | partial | `modules/accounting/controllers/dimension.controller.ts` (`:kind/balances`), DimensionKind.COST_CENTER | `dimensions.pg.spec.ts`; PR #164 (trial balance by cost centre) OPEN; no page |
| Projects | partial (API only) | DimensionKind.PROJECT in the same service | `dimensions.pg.spec.ts`; no page |
Item standard: page for tree only (no dimension UI: grep of frontend finds none). Help: none. Row: E-02 partial, roadmap "Cost centres" says missing (stale).
**Verdict: NOT YET** — missing: UI for floating details/cost centres/projects, trial balance by cost centre (#164 open), Persian help, REQUIREMENTS rows.

### 2. Vouchers: manual, draft, temporary, reversal, copy, attachments, edit lock, recurring, auto-reversing accruals
| Sub-capability | Status | Proof | Spec / page |
|---|---|---|---|
| Manual voucher | present | `modules/accounting/controllers/accounting.controller.ts` (`POST journal-entries`) | `accounting.ledger.pg.spec.ts`; `frontend/src/components/accounting/journal-entry-form.tsx` |
| Draft | partial (API; no UI to save or finalise) | `services/accounting.service.ts` (`updateVoucher`, JournalEntryStatus.DRAFT) | `voucher-states.pg.spec.ts`; UI only shows the status label (`journal-entries-table.tsx`) |
| Temporary | partial (same) | same, `POST journal-entries/:id/status` | `voucher-states.pg.spec.ts` |
| Reversal | partial (API; no button) | `services/accounting.service.ts` `reverseJournalEntry` | `accounting.ledger-integrity.spec.ts` (reverse, double reverse, tenant) |
| Copy voucher | missing | none | none |
| Attachments on vouchers | missing | none (attachments exist only on bank recon items) | none |
| Edit lock (concurrent edit) | missing | none (period lock is a different thing) | none |
| Recurring vouchers | missing | none | none |
| Auto-reversing accruals | missing | none | none |
Item standard: help none (no voucher help; 11 is journal search). Row: E-04 partial, N-04 partial (no attachments, no edit lock).
**Verdict: NOT YET** — missing: copy, attachments, edit lock, recurring vouchers, auto-reversing accruals; partial UI for draft/temporary/reversal; help.

### 3. Ledger invariants: property tests (fast-check); hash-chained audit (#200, done)
| Sub-capability | Status | Proof | Spec / page |
|---|---|---|---|
| Property tests on ledger | missing | `fast-check` is in `package.json` but only `modules/posting_rules/domain/posting-engine.property.spec.ts` uses it; accounting has none | `accounting.ledger-integrity.spec.ts` is example-based |
| Hash-chained audit of ledger | present | `modules/access/services/ledger-audit.service.ts`, `audit.service.ts` | `ledger-audit.service.spec.ts`; page `/app/settings/audit` |
Item standard: help none. Row: "Hash-chained audit log" done; "Property tests" missing.
**Verdict: NOT YET** — missing: fast-check property tests for the accounting ledger.

### 4. Fiscal years: open, period locks, closing entries, carry-forward, read-only closed years; 100k vouchers under 2 s
| Sub-capability | Status | Proof | Spec / page |
|---|---|---|---|
| Open a fiscal year | present | `modules/accounting/services/fiscal-year.service.ts` `create` | `fiscal-close.pg.spec.ts`; page `frontend/src/app/app/accounting/fiscal-years/page.tsx` |
| Period locks | present (API; no UI) | `controllers/accounting.controller.ts` (`period-locks`) | `accounting.ledger.pg.spec.ts` |
| Closing entries | present | `fiscal-year.service.ts` `postClosingEntries` (FC-1/2/3) | `fiscal-close.pg.spec.ts` ("closes a year, carries permanent balances and reopens by reversal") |
| Carry-forward | present | same file, FO opening entry | `financial-reports.pg.spec.ts` ("keeps every number after the close and carries balances") |
| Read-only closed years | partial | close locks the year; refusal shown for vouchers (`voucher-states.pg.spec.ts`) and depreciation (`fixed-assets.pg.spec.ts`); #227 T5 still lists "every write path refuses" as open | no spec across all write paths |
| 100k vouchers under 2 s | missing | `accounting.large-ledger.spec.ts` is 20,000 entries on a mocked repository, no timing | none |
Item standard: page yes. Help none. Row: "Jalali fiscal years and year close" done; E-06 partial.
**Verdict: NOT YET** — missing: 100k-voucher performance proof; partial read-only closed years across all write paths; no pre-close checklist (#300); help.

### 5. Reports
| Sub-capability | Status | Proof | Spec / page |
|---|---|---|---|
| Trial balance 2/4/6/8 columns | present | `modules/accounting/dto/report.dto.ts` (columns 2,4,6,8,10), `controllers/reports.controller.ts` | `financial-reports.pg.spec.ts` ("2 to 10 column"); page `frontend/src/app/app/accounting/reports/page.tsx` |
| General ledger | present | `reports.controller.ts` `ledger` | `financial-reports.pg.spec.ts` ("general and subsidiary ledgers") |
| Subsidiary and detail ledgers | present | `reports.controller.ts` `subsidiary`, `ledger` with `partyCode` | same spec; reports page tabs |
| Statements (balance sheet, P&L, equity) | present | `modules/accounting/reports/statements.ts` | `statements.spec.ts` |
| Cash flow | present | `reports/statements.ts`, `reports.controller.ts` `cash-flow` | `statements.spec.ts` |
| Ageing | partial | `reports/ageing.ts`, export only (`ExportOnlyTab` "ageing" in reports page); JSON endpoint and on-screen table pending; real allocation ageing is PR #347 (open), party statement PR #124 (open) | `ageing.spec.ts`, `accounting.ageing.spec.ts` |
| Budget vs actual | missing | none (grep "budget" hits no accounting code) | none |
| Report builder | missing | none | none |
| Combined report across a user's companies | missing | none | none |
Item standard: page yes, help 09 yes (`docs/help/fa/09-reports.md`). Row: E-05 done, ageing partial, I-05 partial (no report builder).
**Verdict: NOT YET** — missing: budget vs actual, report builder, combined cross-company report; partial ageing (no JSON/on-screen, PR #347 open).

### 6. Fixed assets: register, monthly depreciation run that posts, disposal (#63, #129)
| Sub-capability | Status | Proof | Spec / page |
|---|---|---|---|
| Register | present (API) | `modules/accounting/services/fixed-asset.service.ts` `create`, `entities/fixed-asset.entity.ts` | `fixed-assets.pg.spec.ts`; no page |
| Monthly depreciation run that posts | present (API) | `fixed-asset.service.ts` `runMonth`, `controllers/fixed-asset.controller.ts` (`POST depreciation-runs`) | `fixed-assets.pg.spec.ts`, `assets/depreciation.spec.ts` |
| Disposal | missing | only the status literal `'DISPOSED'` in the entity; no service or route | none |
| #129 zero-rounding fix | missing on main | PR #157 OPEN | none |
Item standard: no page, help 12 exists but says the UI is not built. Row: I-04 stale ("no asset register"); no done row. Open PRs: #445 (register report), #456 (posting rules).
**Verdict: NOT YET** — missing: disposal, page, #157 merge, REQUIREMENTS row (and the I-04 text is stale).

## Automatic posting (owner per issue: Mac for engine and Mac adapters; laptop for invoicing, inventory, POS close, fixed assets)

### 7. One posting-rules engine
| Sub-capability | Status | Proof | Spec / page |
|---|---|---|---|
| Engine core, balanced idempotent vouchers | present | `modules/posting_rules/domain/posting-engine.ts` | `posting-engine.spec.ts`, `posting-engine.property.spec.ts` |
| One template per document type | present | `modules/posting_rules/domain/posting-templates.ts` | `posting-templates.spec.ts` |
| Map to tenant accounts (settings API) | present | `modules/posting_rules/services/posting-rules.service.ts`, `controllers/posting-rules.controller.ts` | `posting-rules.service.spec.ts`, `posting-rules.controller.spec.ts`; page `frontend/src/app/app/settings/posting-rules/page.tsx` |
| Defaults from the chart template | present | `modules/posting_rules/constants/posting-roles.ts` (codes of `iran-chart-template.ts`) | `posting-roles.spec.ts` |
| Every module posts through it | missing | only cheques, payroll posting use `PostingRulesService`; invoicing, inventory, banking, treasury (wired), tax, fixed assets, petty cash, invoice capture do not | none |
| No hardcoded account codes anywhere | missing | `modules/cheques/constants/cheque.constants.ts`, `modules/hr/constants/hr.constants.ts`, `modules/invoicing/constants/suite-events.constants.ts`, `modules/inventory/constants/stock-accounts.ts`, `modules/invoice_capture/constants/capture.constants.ts`, `modules/accounting/constants/accounting.constants.ts` | none |
Item standard: page yes, help 15 yes (one TODO: global map). Row: no dedicated row (E-04 partial mentions it). No dedicated pg spec of the repository (RLS covered in `modules/access/rls/tenant-rls.pg.spec.ts`).
**Verdict: NOT YET** — missing: all modules posting through it, removal of hardcoded account codes, a REQUIREMENTS row, global-map UI.

### 8. Adapters (cheques, payroll, tax, treasury = Mac; invoicing, inventory, POS close, fixed assets = laptop)
| Adapter | Owner | Status | Proof | Spec |
|---|---|---|---|---|
| Cheques | Mac | present (follow-up PR #449 open, issue #368 open) | `modules/cheques/services/cheques.service.ts` (`postingRules.post`) | `cheques.pg.spec.ts` |
| Payroll | Mac | present | `modules/hr/services/payroll-run.service.ts` (`postingRules.post`, #435) | `modules/hr/payroll.posting-rules.spec.ts`, `payroll.pg.spec.ts` |
| Tax (provision) | Mac | missing (mapper only, unwired; PR #441 closed; issue #364 open) | `modules/tax_compliance/posting/tax-provision-proposal.ts` | `tax-provision-proposal.spec.ts` |
| Treasury | Mac | partial (adapter written, not wired; module still `useClass TreasuryLedgerPostingAdapter`) | `modules/treasury/posting/treasury-posting-rules.adapter.ts` | `treasury-posting-rules.adapter.spec.ts` |
| Banking (named in the Mac status comment, issue #366) | Mac | missing | none | none |
| Invoicing / POS sale | laptop | missing (issue #378) | `modules/invoicing/constants/suite-events.constants.ts` is hardcoded | none |
| Inventory | laptop | missing on main (PR #458 open, issue #380) | `modules/inventory/purchasing/purchase-posting.adapter.ts` is name/code based | none |
| POS close | laptop | missing (issue #381; no POS-close code exists) | none | none |
| Fixed assets | laptop | missing on main (PR #456 open, issue #383) | `fixed-asset.service.ts` takes codes in DTO | none |
| Petty cash (named in comment, issue #386) | laptop | missing | none | none |
Item standard: no adapter page needed; help 15 only. Row: none done.
**Verdict: NOT YET** — missing: tax, treasury (wire), banking, invoicing/POS sale, inventory, POS close, fixed assets, petty cash adapters; cheques follow-up #449 unmerged.

## Treasury (owner per issue: Mac, `modules/banking` and `modules/treasury`)

### 9. Receipts and payments with settlement, partial payments, advances
| Sub-capability | Status | Proof | Spec / page |
|---|---|---|---|
| Receipt and payment documents | present (API) | `modules/treasury/services/treasury.service.ts`, `controllers/treasury.controller.ts` | `treasury.service.spec.ts`, `treasury.pg.spec.ts` |
| Linked to parties | partial | `partyCode` on the document; allocation is not checked against the invoice's party (REQ gap) | `treasury.pg.spec.ts` |
| Allocation to invoices (settlement) | present | `modules/treasury/allocation/allocation-engine.ts` | `allocation-engine.spec.ts`, `allocation-engine.edge.spec.ts` |
| Partial payments | present | same engine | same specs |
| Advances | present | same engine (advance with later allocation) | `treasury.pg.spec.ts` |
| Reversal of a document | missing | status enum has `reversed`, no service path (REQ gap) | none |
Item standard: no page (no treasury file under `frontend/src`), help 16 exists with TODO "not built", row TRS-01 partial.
**Verdict: NOT YET** — missing: page, reversal, party check on allocation, posting via posting_rules, Playwright M1 step, row done.

### 10. Cash boxes, bank accounts, transfers, POS-terminal settlements, bank fees
| Sub-capability | Status | Proof | Spec / page |
|---|---|---|---|
| Cash boxes | missing | only an unused `cash_box_id` column in `migrations/1789500000000-CreateTreasury.ts`; petty-cash funds are a different thing | none |
| Bank accounts | present | `modules/banking/services/banking.service.ts`, `controllers/banking.controller.ts` | `banking.repository.spec.ts`; page `/app/accounting/bank` |
| Transfers | missing | none | none |
| POS-terminal settlements (TRS-02) | missing | CARD method exists, no settlement | none |
| Bank fees | partial | only as classified statement lines: `modules/banking/recon/classify/classifier.ts` (`bank_fee` drafts); no fee/interest posting in treasury | `classification-eval.data.ts` |
Item standard: bank page yes, help 07 for reconciliation only. Row: TRS-01 notes these as missing.
**Verdict: NOT YET** — missing: cash boxes, transfers, POS settlements, treasury bank fees and interest, their pages.

### 11. Cheques (Sayad, CHK-01), bank reconciliation, petty cash
| Sub-capability | Status | Proof | Spec / page |
|---|---|---|---|
| Cheque lifecycle (received, issued, partial, endorse) | present | `modules/cheques/lifecycle/cheque-lifecycle.ts`, `services/cheques.service.ts` | `cheques.lifecycle.spec.ts`, `cheques.pg.spec.ts`; page `/app/cheques` (`frontend/src/components/cheques/cheques-view.tsx`) |
| Sayad fields and manual verification | present | `modules/cheques/sayad/sayad.ts` | `sayad.spec.ts` |
| Live central-bank Sayad check | missing | REQ gap: manual flags only | none |
| Bank reconciliation | present | `modules/banking/recon/recon.service.ts`, cheque matching `services/cheque-recon.service.ts` | `modules/banking/recon/recon.pg.spec.ts`; page `/app/accounting/bank/reconcile` |
| Petty cash | present | `modules/accounting/services/petty-cash.service.ts` | `petty-cash.pg.spec.ts`; page `/app/accounting/petty-cash` |
Item standard: pages yes. Help: 06 (cheques), 07 (reconciliation) yes; petty cash has none. Row: CHK-01 partial, no done row for reconciliation or petty cash.
**Verdict: NOT YET** — missing: live Sayad lookup (CHK-01 stays partial), Persian help for petty cash, REQUIREMENTS done rows, PR #449 follow-up unmerged. Closest of the 15 to a tick.

## Subledgers (owner per issue: laptop)

### 12. Sales cycle (#227 T1), purchase cycle with landed cost (T2), FIFO valuation, count adjustments
| Sub-capability | Status | Proof | Spec / page |
|---|---|---|---|
| Sales: quotation | missing | none | none |
| Sales: sales order with stock reservation | missing | `inventory.repository.ts` comment says reservation will come with T1; REQ notes no reserved-stock view | none |
| Sales: delivery note | partial (stock document only, not tied to order) | `modules/inventory/services/stock-documents.service.ts` `createDelivery` | `stock-documents.pg.spec.ts` |
| Sales: invoice from deliveries, partial invoicing | partial (invoice posts its own stock out) | `modules/invoicing/services/invoice-posting.service.ts` | `invoicing.kinds.pg.spec.ts` |
| Sales: return / credit note | partial (invoice kinds incl. return; POS return link is PR #123 open) | `modules/invoicing/services/invoicing.service.ts` | `invoicing.kinds.pg.spec.ts` ("purchase -> sale -> return -> cancel") |
| Purchase: request, order, receipt | partial (rules only, no service, tables or HTTP) | `modules/inventory/purchasing/purchase-order.domain.ts` | `purchase-order.domain.spec.ts` |
| Purchase: supplier invoice with 3-way match | missing | none | none |
| Purchase: landed cost | missing | types only in `purchasing/purchase.types.ts` | none |
| Stock valuation FIFO | present | `modules/inventory/entities/fifo-batch.entity.ts`, `dto/inventory-valuation.dto.ts` | `stock-documents.pg.spec.ts`; `frontend/src/components/inventory/fifo-valuation-report.tsx` |
| Inventory count adjustments | partial (signed adjustment document with reason; no count sheet or variance workflow) | `stock-documents.service.ts` `createAdjustment` | `stock-documents.pg.spec.ts` ("an adjustment moves stock and posts one balanced voucher"); `stock-document-drawer.tsx` |
Item standard: pages for invoicing and inventory exist; no help for inventory, orders or purchasing. Row: PURCHASE_CYCLE row partial; I-02 partial; R-10 partial.
**Verdict: NOT YET** — missing: quotation, sales order and reservation, order-linked delivery and partial invoicing, purchase tables/service/HTTP, 3-way match, landed cost, supplier invoice match, count sheet; help; rows.

### 13. Contracting and project accounting (#227 T3)
| Sub-capability | Status | Proof | Spec / page |
|---|---|---|---|
| Contracts (employer/contractor side) | missing (HR employment contracts only) | `modules/hr/controllers/hr.controller.ts` `contracts` | n/a |
| Statutory parameters for contracts | present (read-only resolver) | `modules/hr/statutory/contract-terms.ts` | `contract-terms.spec.ts`, `statutory.pg.spec.ts` |
| Projects | partial (dimension tag only) | DimensionKind.PROJECT | `dimensions.pg.spec.ts` |
| Progress statements (صورت وضعیت) | missing | none | none |
| Retention, insurance deduction, advance recovery | missing (parameters only) | none | none |
| Project profitability report | missing | none | none |
**Verdict: NOT YET** — missing: contracts, progress statements, retention/insurance/advance recovery, project profitability report, page, help, row (I-04 partial).

## Compliance that posts into the books (owner per issue: Mac, tax and HR)

### 14. VAT and seasonal returns (done), Moadian all patterns (in progress), corporate tax workbench (preview)
| Sub-capability | Status | Proof | Spec / page |
|---|---|---|---|
| VAT return draft | present (RET-01 partial: no annual return, levies unclear) | `modules/tax_compliance/reports/vat-return.service.ts` | `vat-return.spec.ts` (ledger reconciliation); page `/app/tax` |
| Seasonal transactions report | partial (no 5% threshold, CSV unverified) | `modules/tax_compliance/reports/seasonal-report.service.ts` | `seasonal-report.spec.ts`; page `/app/tax` |
| Moadian all patterns | partial (types 1-2, patterns 1-7; no type 3 table; gold/export/contracting missing; UI does not collect extras) | `modules/tax_compliance/utils/moadian-packet.mapper.ts` | `moadian.spec.ts`, `moadian-patterns.spec.ts` |
| Corporate tax workbench | partial (preview only, no posting, no page) | `modules/tax_compliance/services/corporate-tax.service.ts` | `corporate-tax.spec.ts` |
Item standard: help 09 and 14 yes (14 has a TODO). Rows: RET-01, QTR-01, TPS-01, DTX-01 all partial, TPS-02 missing.
**Verdict: NOT YET** — missing: Moadian type 3 and gold/export/contracting patterns, corporate tax page and posting, annual return, 5% threshold, done rows.

### 15. Payroll voucher (done), leave, attendance, loans (hr-deep)
| Sub-capability | Status | Proof | Spec / page |
|---|---|---|---|
| Payroll voucher | present | `modules/hr/services/payroll-run.service.ts` (`POST payroll-runs/:id/post`, via posting rules) | `payroll.pg.spec.ts`, `payroll.posting-rules.spec.ts`, `payroll-run.tenant.spec.ts`; page `/app/hr/payroll`; help `docs/help/fa/08-payroll.md`; PAY-02 done (API) |
| Leave | partial (leave settlement calculation only, employee status ON_LEAVE) | `modules/hr/services/end-of-service.ts` | `end-of-service.spec.ts`; no leave records or UI |
| Attendance | partial (overtime amount as an input field only) | `modules/hr/dto/payroll.dto.ts` | none |
| Loans | missing | none | none |
**Verdict: NOT YET** — missing: leave records, attendance records, loans (and the settlement endpoint wiring noted in LAB-01).

## Design items #294 to #307 (owner: laptop, label `claude-win`)
All 14 issues are OPEN. No merged PR implements any of them on main (only the audit doc, PR #289). Open PRs: #346 for #301, #344 for #307, #459 for #306 (WIP). Issue labels `in-progress`: #301, #306, #307.
| Issue | State | Merged PR | Open PR |
|---|---|---|---|
| #294 financial home dashboard | OPEN | none | none |
| #295 menu tree | OPEN | none | none |
| #296 split accounting page | OPEN | none | none |
| #297 petty cash and cash boxes under Treasury | OPEN | none | none |
| #298 bank accounts page and reconciliation name | OPEN | none | none |
| #299 reports hub | OPEN | none | none |
| #300 fiscal years pre-close checklist | OPEN | none | none |
| #301 invoice list redesign | OPEN, in-progress | none | #346 |
| #302 customer drawer | OPEN | none | none |
| #303 cheques tabs and strip | OPEN | none | none |
| #304 tax page tabs | OPEN | none | none |
| #305 payroll wizard | OPEN | none | none |
| #306 inventory list | OPEN, in-progress | none | #459 (WIP) |
| #307 number formatter, tokens, seed | OPEN, in-progress | none | #344 |
**Verdict for all 14: NOT YET** (none merged).

## Verdicts, one line each
1. Chart of accounts: NOT YET — dimension UI, trial balance by cost centre (#164 open), help, rows.
2. Vouchers: NOT YET — copy, attachments, edit lock, recurring, auto-reversing accruals; UI for draft/temporary/reversal.
3. Ledger invariants: NOT YET — fast-check property tests on the accounting ledger.
4. Fiscal years: NOT YET — 100k vouchers under 2 s; read-only closed years across every write path; help.
5. Reports: NOT YET — budget vs actual, report builder, combined cross-company report; ageing on screen.
6. Fixed assets: NOT YET — disposal, page, #157 unmerged, row.
7. Posting-rules engine: NOT YET — every module through it, no hardcoded codes, row.
8. Adapters: NOT YET — tax, treasury wiring, banking, invoicing/POS sale, inventory, POS close, fixed assets, petty cash.
9. Receipts and payments: NOT YET — page, reversal, party check, posting_rules, M1 step, row.
10. Cash boxes, banks, transfers, POS, fees: NOT YET — cash boxes, transfers, POS settlement, treasury fees.
11. Cheques, reconciliation, petty cash: NOT YET — live Sayad, petty cash help, done rows, PR #449.
12. Sales, purchase, FIFO, counts: NOT YET — quotation, order/reservation, order-linked delivery and invoicing, purchase service/HTTP, 3-way match, landed cost, count sheet.
13. Contracting and projects: NOT YET — contracts, progress statements, retention/insurance/advance, profitability report.
14. VAT, Moadian, corporate tax: NOT YET — Moadian type 3 and special patterns, corporate tax page and posting, annual return.
15. Payroll voucher, leave, attendance, loans: NOT YET — leave, attendance, loans.
16-29. Design #294 to #307: NOT YET — all open, none merged.

## Missing parts that belong to the laptop
By the issue's own split (laptop = core ledger, subledgers, fixed assets, laptop adapters, design):
- Item 1: dimension UI, trial balance by cost centre (merge #164), help.
- Item 2: copy voucher, attachments, edit lock, recurring vouchers, auto-reversing accruals, draft/temporary/reversal UI.
- Item 3: fast-check property tests on the ledger.
- Item 4: 100k-voucher performance spec (#227 T5), read-only closed years on all write paths, pre-close checklist (#300).
- Item 5: budget vs actual, report builder, combined report, ageing JSON and on-screen (#347, #124).
- Item 6: disposal, fixed-asset page, merge #157, register report (#445).
- Item 8 (laptop part): invoicing/POS sale (#378), inventory (PR #458, #380), POS close (#381), fixed assets (PR #456, #383), petty cash (#386).
- Item 7: removal of hardcoded codes in laptop modules (invoicing, inventory, accounting constants, invoice capture).
- Item 12: all of it (sales cycle T1, purchase and landed cost T2, count sheet).
- Item 13: all of it (T3).
- Design #294 to #307: all 14 (three in progress: #301, #306, #307).
- Not laptop by the issue text but laptop by the 2026-11-05 handoff (Mac fleet paused, laptop carries the project): items 7 (engine UI gaps), 8 (tax, treasury wiring, banking, cheques follow-up), 9, 10, 11, 14, 15. The laptop owns these only until about 2026-11-12.
