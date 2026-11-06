# Brief #380: inventory stock vouchers through PostingRulesService

Worktree: /home/mahan/Developer/roxira-wt/380-posting-rules-switch-inventory-stock-doc
App dir: output_apps/enterprise_hub. DO NOT COMMIT. Do not touch anything under modules/posting_rules, modules/treasury, modules/cheques, package.json, lockfiles, app.module.ts, migrations, .github.
Read first: modules/hr/payroll.posting-rules.spec.ts, modules/hr/__fixtures__/*.ts, modules/hr/services/payroll-run.service.ts (how HR calls PostingRulesService), modules/posting_rules/services/posting-rules.service.ts and domain/posting-templates.ts (docTypes stock.opening, stock.adjustment_gain, stock.adjustment_loss already exist, amount name `amount`; roles inventory, opening_equity, stock_adjustment).

## Facts
Templates have NO `defaults` for these roles and the global defaults for inventory (1030) and stock_adjustment (5030) differ from the legacy codes, and we may not edit posting_rules. So the service keeps resolving the legacy account codes with the existing `StockDocumentsService.resolveAccounts` (name match, then code, else create) and passes them to the engine as `overrides`. No account code literal may appear in new non-spec code; the codes still come only from modules/inventory/constants/stock-accounts.ts (leave that file unchanged).

## Change 1: modules/inventory/posting/stock-posting.ts (new, pure)
```ts
export type StockValueKind = 'opening' | 'adjustment';
export function stockPostingDocType(kind, net: bigint): string  // opening -> 'stock.opening'; adjustment net>0 -> 'stock.adjustment_gain', net<0 -> 'stock.adjustment_loss'
export function stockPostingOverrides(kind, accounts: string[]): RoleAccounts
   // accounts = [inventoryCode, counterCode] exactly as resolveAccounts returns it.
   // opening: { inventory: accounts[0], opening_equity: accounts[1] }; adjustment: { inventory: accounts[0], stock_adjustment: accounts[1] }
export const STOCK_SOURCE_TYPE = 'stock_document';
```
net === 0n is never posted (callers already guard). Use RoleAccounts type from ../../posting_rules/domain/posting-engine.

## Change 2: StockDocumentsService (modules/inventory/services/stock-documents.service.ts)
- Add 4th constructor param `@Optional() private readonly postingRules?: PostingRulesService` (import from ../../posting_rules/services/posting-rules.service).
- Change `postValueEntry` to take `(tenantId, source: { id: number | string; docNumber: string; docDate: string }, kind: StockValueKind, description: string, accounts: string[], net: bigint, manager)` and return `{ id: number }`. If !this.postingRules throw Error('StockDocumentsService needs PostingRulesService to post stock vouchers.'). Call
  postingRules.post(tenantId, { docType: stockPostingDocType(kind, net), sourceType: STOCK_SOURCE_TYPE, sourceId: String(source.id), date: `${source.docDate}T12:00:00.000Z`, amounts: { amount: net < 0n ? -net : net }, description, entryNumber: `STK-${source.docNumber}`, overrides: stockPostingOverrides(kind, accounts) }, manager) and return { id: result.entryId }.
  (Legacy date, entry number STK-<docNumber> and the T12:00 time must stay identical.)
- Remove the now unused `minorToDecimal` import if unused elsewhere in the file. Keep `resolveAccounts` and the `accounting` dependency (still needed by it).
- In createAdjustment pass { id: document.id, docNumber, docDate } and kind 'adjustment'. Check what `save` returns for the id.

## Change 3: OpeningBalanceService.post (modules/inventory/services/opening-balance.service.ts ~line 235)
Call postValueEntry with { id: the opening document row id (`id` argument), docNumber: document.docNumber, docDate }, kind 'opening'. If net is 0n the engine throws EMPTY_VOUCHER where the old code posted a zero entry; check whether the old path could reach net 0 (lines validated?). Keep behaviour sane and mention it in your report.

## Change 4: inventory.module.ts
Import `PostingRulesModule` (../posting_rules/posting-rules.module) like hr.module.ts does.

## Change 5: frozen fixture + old-vs-new spec
- modules/inventory/__fixtures__/legacy-stock-posting.ts: header comment like the HR fixture ("Frozen copy of StockDocumentsService.postValueEntry line building before the posting rules engine (#380). Do not edit."). Export `legacyStockValueLines(accounts: string[], net: bigint)` returning {accountCode; debit?: string; credit?: string; description: string}[] copying the OLD logic exactly (net>0: debit inventory 'موجودی کالا', credit counter 'مابه‌ازای ثبت موجودی'; net<0: debit counter 'کسری انبار', credit inventory 'موجودی کالا'; amount = minorToDecimal(abs(net))). Also export legacyStockEntryNumber(docNumber) = `STK-${docNumber}`.
- modules/inventory/stock-posting.spec.ts: for kinds opening (positive nets only) and adjustment, nets [1n, 100n, 123456789n, -1n, -100n, -123456789n, 99999999999n]: build with buildProposal({ docType: stockPostingDocType(kind, net), amounts: { amount: abs }, overrides: stockPostingOverrides(kind, ['1301','3030'] or ['1301','5301']) }) and assert accountCode and debit/credit (compare via toJournalLines to the legacy decimal strings) identical to legacy, in order. Spec account literals are allowed. Descriptions: opening and loss lines equal legacy; for adjustment_gain the credit-line description differs from legacy on purpose ('اضافه انبار' vs 'مابه‌ازای ثبت موجودی'): assert that explicitly with a comment. Assert a custom pair (e.g. ['1399','5399']) lands on those codes.
- Second describe: copy modules/hr/__fixtures__/fake-posting-rules.ts into modules/inventory/__fixtures__/fake-posting-rules.ts (copy, do not import from hr) and with a tiny in-memory accounting fake (see how hr specs fake listAccounts/createJournalEntry; chart holds 1301 asset, 3030 equity, 5301 expense, posting level) test: posting the same stock_document id twice returns replayed: true with the same entryId and createJournalEntry called once; the entry sent has entryNumber STK-<docNumber>, date <docDate>T12:00:00.000Z and the legacy line shape. 

## Change 6: pg specs
modules/inventory/stock-documents.pg.spec.ts and opening-balance.pg.spec.ts build services by hand: pass a real new PostingRulesService(new PostingRulesRepository(new TenantScope(ds)), accounting) as 4th arg of StockDocumentsService (see modules/hr/payroll.pg.spec.ts). Keep existing assertions unchanged; they must still pass. In stock-documents.pg.spec add an assertion that the loss voucher has lines 5301 debit / 1301 credit and that a posting source row exists for sourceType stock_document (real table name from the posting_rules entity).

## Change 7: docs
docs/accounting/POSTING_MAP.md row 4: mark adopted by #380 (sourceType stock_document, id = document id, entry number STK-<docNumber>); note accounts are passed as overrides resolved by the legacy name match until template `defaults` for inventory 1301 / stock_adjustment 5301 exist (NEEDS MAC). Do not edit REQUIREMENTS_STATUS.md.

## Run (one at a time, through the lock)
cd output_apps/enterprise_hub; /home/mahan/Developer/roxira-wt/_fleet/heavy.sh npx jest --maxWorkers=2 modules/inventory/stock-posting.spec.ts
pg: ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55433 ROXIRA_TEST_PG_USER=postgres /home/mahan/Developer/roxira-wt/_fleet/heavy.sh npx jest --runInBand modules/inventory/stock-documents.pg.spec.ts modules/inventory/opening-balance.pg.spec.ts
Do not claim a pass you did not see. Report anything you could not run.
