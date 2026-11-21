# Research R16 — what a global-grade accounting core needs (digest)

Source: the owner's deep-research run R16, stage 1 (benchmark of Xero, QuickBooks Online / Intuit Enterprise Suite, Odoo, SAP Business One, Sage Intacct, NetSuite and Business Central, plus 15 acceptance tests) and stage 2 (self-review), received 2026-11-17. The stage 2 review had no live web access, so it marked every vendor claim **unverifiable**. Vendor facts below are leads, not facts. What we keep are the design lessons and the acceptance tests, which are our own arithmetic.

## Assumptions in the report that do not hold for us
- **Greenfield core.** We already run a live ledger (Iran) with posted-line guards, FX revaluation, budgets, a consolidated report, dimensions and Jalali calendars. Each gap below is checked against our code (hub grep, 2026-11-17), not assumed.
- **Build cost and team size** (USD 1.15–1.55M, 6–8 engineers, options A/B/C). Not our model; lanes plan rows. Option B (fork Odoo/ERPNext) was already refused (`ARCHITECTURE_DECISIONS_2026-11-16.md`: no rewrite).
- **Country order** (EU first, Iran last). Iran is live. Our order stays DE → SA/AE → MY.
- **Infrastructure placement advice.** Not taken here; infra decisions are separate.
- **ZATCA and UAE facts.** Already digested with primary sources in `R14_GULF.md`.

## The main lesson
The vendors whose retrofits failed say so in their own docs: SuiteTax cannot be turned off, Intuit multi-currency cannot be reversed and is USD-only in beta, Xero cannot change base currency, Business Central warns against editing posted depreciation books. The primitives that cannot be retrofitted go into the core before the first foreign pack ships: an append-only journal with gapless numbering, three amounts per line, effective-dated tax, unlimited dimensions kept apart from tax metadata, multi-entity with eliminations, multi-book assets.

## Gap check against our core

| Primitive | We have | Gap | Row |
|---|---|---|---|
| Append-only journal, gapless audit number, hash chain | posted-line guard trigger; hash chain on `audit_log` only | no per-entity gapless GL number, no journal hash chain, no verify endpoint | T178 |
| Period states | fiscal-year close, closed-year spec | no soft lock with role exception, no adjustment period 13, no irreversible hard close | T178 |
| Three amounts per line (transaction, book, reporting) | dual amount (T138, #861), tenant currencies (#842), FX revaluation | reporting-currency amount per line; cross-currency settlement without a clearing account; rounding residual account | T169 + T179 |
| Effective-dated tax, reverse charge, withholding | Iran VAT, Iran withholding (doctor, rent) | rate chosen by tax point (credit note inherits the original rate); EU reverse charge; withholding at invoice or payment time with certificate numbers; deductible date apart from posting date | T180 |
| Dimensions | branch dimension and analytic dimensions | rule validation (e.g. project required for one cost centre), label history (renaming does not rewrite closed periods), e-invoice metadata kept out of dimensions | T181 |
| Multi-entity | consolidated report; company group (T155) | no intercompany mirror posting, no eliminations, no minority interest | T182 |
| Fixed assets | asset register | one book only; no tax book beside the IFRS book; no asset history sheet (the DE E-Bilanz needs it for FY 2028) | T183 |
| Inventory costing | FIFO and weighted average present | standard cost with price variance, GR/IR clearing: verify with Test 8 before building | T177 |
| Bank | bank SMS capture, reconciliation | CAMT.053/MT940 import, one payout matched to many invoices plus fees, replay without duplicates | T184 |
| API | idempotency keys in some endpoints | at least 24 h idempotency on every write; signed outbound webhooks for journal, period, asset and invoice events | T185 |
| AI | assistant writes drafts | keep: never posts; AI identity on every draft (EU AI Act Art. 50 applies since 2 Aug 2026, see R13) | T191 |
| Budgets | budgets, budget vs actual | encumbrance (PO checks the budget) — P2, no row yet | — |

## Acceptance tests (kept, with the stage 2 fixes)
The report's 15 tests are deterministic and become our core acceptance suite (T177). Stage 2 found five defects; the suite uses the fixed versions:
- **Test 1 (consolidation):** also eliminate the investment in the subsidiary against its equity, or the consolidated balance sheet does not balance.
- **Test 2 (FX):** assert the reporting-currency settlement difference (USD 16.99) and state the GBP/USD settlement rate so the GBP receivable closes to zero.
- **Test 4 (hash chain):** the pre-image is fixed fields (`entity_id`, `gl_audit_number`, `posted_at_utc`, the three amounts, previous hash), canonically serialised.
- **Test 7 (asset disposal):** the sale carries output VAT (19% in DE on EUR 22,000 = EUR 4,180).
- **Test 10C (withholding):** 5% WHT applies to non-residents, who charge no local VAT (the buyer self-accounts). Withholding is posted at payment (`Dr AP 1,150 / Cr Bank 1,100, Cr WHT payable 50`), not at bill posting.

## Stage 2 risks we keep
| Risk | Decision |
|---|---|
| A gapless number plus hash chain serialises all writes per entity. | Allocate numbers and hashes in a per-entity sequencer at commit, batched; measure p95 under 50 writes/s before rollout (T178). |
| A point-in-time restore can fork a hash chain or reuse an e-invoice counter that the tax authority already cleared. | The restore runbook reconciles the chain head and e-invoice counters with an external write-once copy before reopening writes (T178). |
| Migrating customers mid-year (open AR/AP, FIFO layers, e-invoice counter state). | Already partly in `data_import`; Test 8 and the import support matrix cover it. No new row. |
| Cash flow statement (IAS 7) needs activity tags and must strip unrealised FX. | P2, no row yet. |
| Segregation of duties and four-eyes on supplier bank-account edits. | P2; owner-approval flows exist; revisit after DE pack. |
| Country packs change on fixed statutory dates. | Pack data is versioned and effective-dated (already the pack framework rule); golden-file tests per pack. |
