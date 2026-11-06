# Brief #386: petty cash charge / return / replenish through the posting-rules engine
Worktree: /home/mahan/Developer/roxira-wt/386-posting-rules-switch-petty-cash-to-the-e (backend in output_apps/enterprise_hub). DO NOT git commit/push. Public repo content only.

## Goal
`PettyCashService.postMovement` (modules/accounting/services/petty-cash.service.ts) currently calls `AccountingService.createJournalEntry` directly. Make it post through `PostingRulesService.post` with the SAME voucher: same accounts, sides, amounts, entry number `PC-<row.id>`, date `entryDate(day)`, voucher description `${description} (${fund.name})`, line order, and NO line descriptions (so reports show the voucher description which carries the user text).
`settle()` (the PCS- voucher with one debit line per receipt, each with its own receipt text, and a variable line count) stays on createJournalEntry: a template cannot repeat lines. Add a comment saying so. Do not touch it. The replenish refill inside settle already goes through postMovement, so it moves with this.

## Files to change (nothing else)
1. modules/posting_rules/domain/posting-templates.ts: ADD two templates to POSTING_TEMPLATES (do not modify existing ones; the existing pettycash.charge/expense carry line texts the legacy voucher never had, and nothing uses them):
   - docType `pettycash.fund_charge`, title 'شارژ تنخواه (حرکت صندوق)', amounts ['amount'], lines: dr('petty_cash','amount',''), cr('counter','amount','')
   - docType `pettycash.fund_return`, title 'برگشت وجه تنخواه (حرکت صندوق)', amounts ['amount'], lines: dr('counter','amount',''), cr('petty_cash','amount','')
   Empty line text on purpose. Defaults: none needed (both roles always passed as overrides), but check posting-templates.spec.ts for rules every template must satisfy and keep it green.
2. modules/accounting/services/petty-cash.service.ts: inject a posting port like FixedAssetService does (read modules/accounting/services/fixed-asset.service.ts top 35 lines and accounting.module.ts providers). Add `export const PETTY_CASH_POSTING = Symbol('PETTY_CASH_POSTING'); export type PettyCashPosting = Pick<PostingRulesService,'post'>;`, constructor param `@Inject(PETTY_CASH_POSTING) private readonly posting: PettyCashPosting` (add as LAST constructor arg).
   In postMovement keep the "fund account differs from counter" check. After saving the row call
   `this.posting.post(tenantId, { docType: kind===CHARGE ? 'pettycash.fund_charge' : 'pettycash.fund_return', sourceType: 'petty_cash_tx', sourceId: String(row.id), date: entryDate(data.date), amount..., amounts: { amount: data.amount }, description: `${data.description} (${context.fund.name})`, entryNumber: `PC-${row.id}`, overrides: { petty_cash: context.code, counter: data.accountCode } }, manager)`
   (PostingRequest fields: see posting_rules/services/posting-rules.service.ts) and save `journalEntryId: result.entryId` on the row as today (entry.id before). `data.amount` is already bigint minor units. Overrides (the fund's own account and the user's chosen counter account) intentionally WIN over any tenant mapping: both are explicit per-fund / per-transaction choices and the fund balance is read from the fund's ledger account.
3. modules/accounting/accounting.module.ts: add provider `{ provide: PETTY_CASH_POSTING, useExisting: FIXED_ASSET_POSTING }` (same lazy ModuleRef port; PostingRulesModule imports AccountingModule so we cannot import it back).
4. modules/accounting/petty-cash.pg.spec.ts line ~65: `new PettyCashService(new PettyCashRepository(ds), repo, accounting)` needs a real engine as last arg. Build `new PostingRulesService(new PostingRulesRepository(ds), accounting)` (look at how other pg specs, e.g. invoicing/pos-sale.pg.spec.ts or posting_rules specs, construct it and its repository) and pass `{ post: (...a) => engine.post(...a) }`. Existing assertions must pass unchanged; add: the movement entry line `description` is NULL for both lines and entry description contains the user text; posting the same row id twice via the engine returns replayed:true (a small test calling engine.post directly with the same sourceId and docType).
5. NEW modules/accounting/__fixtures__/legacy-petty-cash-posting.ts: frozen copy of the old lines:
   `legacyMovementLines(kind:'CHARGE'|'RETURN', fundCode, counterCode, amountMinor: bigint)` returns [{accountCode, debit, credit}] as decimal strings via minorToDecimal: CHARGE => [Dr fundCode, Cr counterCode], RETURN => [Dr counterCode, Cr fundCode], each amount on its side and '0.00' on the other. Header comment "Frozen copy, do not edit".
6. NEW modules/accounting/petty-cash.posting-rules.spec.ts (model: modules/accounting/assets/depreciation.posting-rules.spec.ts): pure spec with buildProposal+toJournalLines vs legacy lines, overrides {petty_cash: fund, counter}. Cases (hand-computed, must equal exactly):
   - CHARGE fund '101301', counter '1010', 5000000n => lines [{101301, debit '5000000.00'...}] BUT note money.ts minorToDecimal scale 2: read money.ts and assert via the fixture, plus one literal assertion: engine lines for CHARGE 1n minor unit are [{accountCode:'101301', debit:'0.01', credit:'0.00'},{accountCode:'1010', debit:'0.00', credit:'0.01'}].
   - RETURN fund '101301', counter '1010', 250000050n (Dr 1010 first, Cr 101301 second).
   - a very large 500000000000n.
   - every line has empty description (toJournalLines omits the key).
   - mapping does NOT beat overrides: buildProposal with mapping {petty_cash:'9999'} and overrides {petty_cash:'101301'} uses 101301.
7. docs/accounting/POSTING_MAP.md row 6: mark charge/return/replenish adopted by #386 (docTypes pettycash.fund_charge / fund_return, sourceType petty_cash_tx, id = transaction row id, number PC-<id>); settle (PCS-) stays raw because a template cannot repeat lines (NEEDS MAC: variable-line templates).
8. docs/strategy/REQUIREMENTS_STATUS.md: add evidence to the posting-rules / petty cash row (grep "petty" there) with file paths and the two spec names. Keep it one or two lines.

## Do not touch
posting_rules services/controllers/entities, any other template, treasury, migrations, package.json, settle() logic, DTOs.

## Run (via /home/mahan/Developer/roxira-wt/_fleet/heavy.sh, one at a time)
`cd output_apps/enterprise_hub && npx tsc --noEmit -p .` ; `npx jest --maxWorkers=2 modules/accounting/petty-cash.posting-rules modules/posting_rules/domain/posting-templates`
pg: `ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55433 ROXIRA_TEST_PG_USER=postgres npx jest --runInBand modules/accounting/petty-cash.pg.spec.ts`
Report honestly which passed. Never edit a spec expectation to fit wrong code.

## ATTEMPT 2 WARNING
The first attempt only added an import/constants, DELETED the existing `pettycash.expense` template, and invented a `stock.adjustment_loss` template. Wrong. Only ADD the two new templates; never remove or alter any existing template. Do ALL 8 items; postMovement must call this.posting.post. Finish every file before stopping.
