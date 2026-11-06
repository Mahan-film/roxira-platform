# Brief #378: invoicing posts through the posting-rules engine (vouchers must stay identical)

Worktree root: /home/mahan/Developer/roxira-wt/378-posting-rules-switch-invoicing-sales-pur ; code in output_apps/enterprise_hub/modules.
DO NOT COMMIT. Do not touch anything in modules/posting_rules (I already added the templates, read `INVOICE_TEMPLATES` at the top of
posting_rules/domain/posting-templates.ts and do not edit it). Do not touch splitPayments, package.json, app.module.ts, migrations, .github.

## Goal
`modules/invoicing/services/invoice-posting.service.ts` currently builds journal lines itself (`documentLines`, `toLines`, and the settlement
block in `postPaid`) and calls `accountingService.createJournalEntry`. Replace the line building and that call by
`PostingRulesService.post(tenantId, {docType, sourceType:'invoice', sourceId: invoice.id, date, amounts, description, entryNumber, overrides}, manager)`.
Everything else (stock movement, markers, postingMeta, error handling, entry numbers `INV-<id>-ISSUED|PAID|CANCEL`, dates, entry descriptions,
the transaction) stays as is. The stock-document link uses `entry.id` -> use `result.entryId`.

## Templates (already written, read them)
Each template has, per row key K, two amounts `KDr` and `KCr`, both bigint >= 0 and ALL must be passed. Signed debit value v of a row:
`KDr = v > 0n ? v : 0n`, `KCr = v < 0n ? -v : 0n`. The engine drops zero lines, puts all debits first then credits (same as old `toLines`).
- `invoice.sale.issue` (ISSUED, sale) and `invoice.sale.cancel` (CANCELLED, sale). Row signed values, EXACTLY the old `documentLines` with sign = reverse ? -1 : 1:
  receivable = sign*amounts.receivable ; sales = sign*(-amounts.net) ; vat = sign*(-amounts.vat) ; stock = sign*amounts.stock ; cogs = sign*(-amounts.stock).
- `invoice.purchase.issue` / `invoice.purchase.cancel`: stock = sign*amounts.stock ; purchases = sign*(net - stock) ; vat = sign*amounts.vat ; payable = sign*(-amounts.receivable).
- Settlement (postPaid): `invoice.sale.settle` or `invoice.purchase.settle`; if the FIRST element of `splitPayments(...)` is a CARD payment use the `_card_first` variant
  (`invoice.sale.settle_card_first`). Rows: cash = sum over non-CARD parts of sign*amount ; card = sum over CARD parts of sign*amount ;
  party = -sign*owed (sale: receivable row; purchase: payable row). `sign = sale ? 1n : -1n` exactly as the existing code. Aggregating same-method payments into one line is a
  known, accepted difference; keep `splitPayments` untouched and call it as today.
Put the pure mapping (signed row values -> Dr/Cr amounts, and the docType choice) in a NEW file `modules/invoicing/services/invoice-voucher.ts` (small pure functions, unit-testable).

## Accounts: keep the legacy resolution, let tenant mappings win
`resolveAccountMap` (name match / create 1201 etc.) stays and still runs BEFORE the transaction. Map its result to roles and pass as `overrides`:
receivable->receivable, sales->revenue, vat->vat_output, inventory->inventory, cogs->cogs, payable->payable, purchases->purchases, vatReceivable->vat_input, cash->cash, posClearing->pos_clearing.
BUT a tenant mapping made on the posting-rules settings page must win: before posting, call `this.postingRules.describe(tenantId)`, find the entry for the ISSUE docType
(for cancel use the matching `.issue` docType's mapping; for settle variants use `invoice.<dir>.settle`), and for every role whose `source !== 'default'` use that entry's `accountCode`
instead of the legacy resolved one. Do this in a small private helper `roleAccounts(tenantId, mappingDocType, legacy)`; it runs outside the transaction.
Pass no `partyCode` (old vouchers had none).

## Constructor
New signature: `(invoicingRepository, inventoryService, accountingService, postingRules: PostingRulesService, @Optional() stockDocuments?)`.
Import `PostingRulesModule` in `invoicing.module.ts`. Update EVERY construction in specs: invoicing/suite-events.spec.ts, invoicing/invoicing.kinds.spec.ts,
invoicing/invoicing.kinds.pg.spec.ts, invoicing/pos-sale.pg.spec.ts, accounting/accounting.ledger.pg.spec.ts, tax_compliance/vat-return.spec.ts, tax_compliance/seasonal-report.spec.ts
(`grep -rn "new InvoicePostingService" modules`). Non-pg specs: use a new `modules/invoicing/__fixtures__/fake-posting-rules.ts` modelled on
modules/hr/__fixtures__/fake-posting-rules.ts (in-memory source ledger; add `listAllMappings(): []`; takes the spec's fake accounting). pg specs: build the real service like
modules/cheques/cheques.pg.spec.ts line ~109 (`new PostingRulesService(new PostingRulesRepository(new TenantScope(ds)), accounting)`); make sure the test DB has the posting tables (see how cheques.pg.spec sets up migrations).
Existing assertions that read `dto.lines` from `createJournalEntry` keep working (they use objectContaining); if one breaks only because lines now carry `credit: '0.00'`/`debit: '0.00'` fix the assertion, never the code.

## Old-vs-new proof (the important part)
1. `modules/invoicing/__fixtures__/legacy-invoice-posting.ts`: a FROZEN verbatim copy (header comment "Frozen copy of invoice-posting.service.ts before the posting rules engine (#230), only to prove identical vouchers. Do not edit.") of the OLD `documentLines`, `toLines`,
   the old settlement line building from `postPaid`, `splitPayments`, `rialMinor`, `resolveFxRate`, as pure functions taking plain data (direction, taxInvoiceNumber, fxRate, payments, amounts, an account map). Copy the code from `git show HEAD:output_apps/enterprise_hub/modules/invoicing/services/invoice-posting.service.ts`. Do not "improve" it.
2. `modules/invoicing/invoice-posting.posting-rules.spec.ts`: drive the REAL `InvoicePostingService.handle` over fakes (see suite-events.spec.ts for fakes: repo, inventory, accounting) and compare the lines handed to `createJournalEntry`
   (reduce to accountCode, debit minor, credit minor, in order via toMinor) with the lines the frozen fixture produces for the same invoice. Cases: (a) sale with a stock line, no VAT; (b) sale with VAT 10% and a discount;
   (c) foreign-currency sale (fxRate 50000, currency USD, amounts in USD, check rial amounts); (d) purchase with a stock line; (e) POS cash sale (status PAID, payments [{CASH}]) -> issue AND settle vouchers;
   (f) POS card sale (payments [{CARD}]); (g) sale return (subject RETURN, relatedInvoiceId, a related sale with postingMeta OUT lines); (h) cancel of an issued sale; also a cancel of a purchase; also a mixed payment [{CARD,400},{CASH,700}] (card first) and [{CASH,700},{CARD,400}].
   Also assert entryNumber, date and entry description equal the old values (`INV-<id>-ISSUED` etc.).
   Compute every expected number BY HAND in the spec as a comment (e.g. sale: invoice finalPayable 1100, totalTax 100 -> receivable 110000, vat 10000, net 100000 minor; stock -60000).
   Where the new voucher intentionally differs, assert it explicitly in a separate test named "known differences": line description of the receivable/payable rows no longer contains the invoice number (receivable 'صدور صورتحساب', payable 'بدهی بابت صورتحساب') and, for settlement, several payments of the same method become one line. Everything else must be equal.
3. Replay: a test that runs ISSUED, then resets the invoice's `journalEntryId`/`postingMeta` to null in the fake repo, runs ISSUED again and asserts `createJournalEntry` was called once in total and the invoice gets the FIRST entry id.
4. A cancel test must prove the cancel is a different source (`invoice.sale.cancel`) so it posts even though the issue voucher exists.

## Docs
Update rows 1-3 of docs/accounting/POSTING_MAP.md (site is now `PostingRulesService.post`; docTypes invoice.sale.issue/.cancel/.settle*, invoice.purchase.*; legacy codes are template defaults; note pos.sale is the settle template). Add the evidence (file paths and spec names) to the E-04 row of docs/strategy/REQUIREMENTS_STATUS.md. Keep both short.

## Run (do not run jest yourself more than needed; heavy commands via the lock)
`cd output_apps/enterprise_hub && /home/mahan/Developer/roxira-wt/_fleet/heavy.sh npx jest --maxWorkers=2 modules/invoicing modules/tax_compliance/vat-return modules/tax_compliance/seasonal-report modules/posting_rules` then `heavy.sh npx tsc --noEmit -p tsconfig.json`.
