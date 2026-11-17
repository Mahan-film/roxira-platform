# Architecture decisions — 2026-11-16 (hub as central architect)

Input: the owner's outside research "Rust migration and next-generation modular stack" (a report written by another AI, November 2026), plus hub checks of the key claims against primary sources and our own repo and CI. This file decides what we adopt, when, and what we refuse. It sits under `MASTER_PLAN_2026-11-16.md`.

**Owner direction (2026-11-16):** finish the product first: CRM, ERP, accounting and tax, globally usable (Germany and the EU, the Gulf states, others; Iran is already live). No company or market decisions until the product is complete. Lowest cost.

## Checked facts (hub, 2026-11-16)

| Claim in the report | Check | Result |
|---|---|---|
| TypeScript 7.0 (Go compiler) is stable, 8–12× faster builds | Microsoft blog, InfoQ, The Register | **True** (GA mid-2026). No stable programmatic API until 7.1, so typescript-eslint and similar tools are blocked. |
| Gemini Decisions API (`gemini-decision-1`, 11 Nov 2026): closed-set yes/no, choice and score over text, PDF, image and audio; 150–250 ms; USD 0.10 per 1M input tokens, no output tokens | Google blog, MarkTechPost, Vercel AI Gateway | **True.** Benchmarks are Google's own. |
| A2UI 1.0 (11 Nov 2026): agents return native UI from the client's own component catalog; sensitive values never reach the model | Google Developers blog, SD Times | **True.** The spec site still lists 1.0 as RC; Compose and Gemini Enterprise lag behind. |
| PostgreSQL 19 GA on 19 Nov 2026 | postgresql.org RC1 news | **Scheduled**, not yet released. |
| "Agent distraction": stale TODOs cost agents ~70% more steps | not checked | Moot for us: the repo has 2 TODO/FIXME in `.ts`/`.py`. |
| Our CI | hub, lane PR #849 run | Backend tsc + jest + pg specs **4 min**; frontend 2 min; **M1 Playwright gate 11 min**; everything else under 1 min. |

## Decisions

### Refused (and why)
1. **No rewrite into Rust, Go, Effect or Bun.** The report itself concludes this, and our case is stronger: our bottleneck is review and merge throughput, not runtime speed. NestJS + Next.js (TypeScript) and the Python AI core stay. Rust only for a **measured** hotspot; none exists today.
2. **No adoption of outside suites** (Twenty, NocoBase, Teable, Plane, Huly, Medusa). They are AGPL or a second platform, and Huly is frozen. We use them as UX references only.
3. **No new runtime platforms now:** Restate, Rivet, Durable Objects, Kata, Hyperlight, NATS, Iggy, MoQ, LiteLLM-Rust (beta). BullMQ + outbox + Postgres cover our load. Each has a revisit trigger below.
4. **No database change on `.0` releases.** PostgreSQL 19 upgrade waits for 19.1, on staging first, then production.

### Adopt (in order)

| # | What | Why for us | Row / when |
|---|---|---|---|
| 1 | **WIP limit in the software factory:** a lane with 3 or more unmerged PRs takes no new row and works only on its own blockers or on review fixes. | The factory's real bottleneck: about 30 unmerged PRs with chains between them. More lanes would make it worse. | WAVE rule, now |
| 2 | **Merge pass in dependency order**, triaged by an agent: green + no blocker → merge; small fixes by the hub's agents; the rest go back to the lane. | Turns built work into product. | now |
| 3 | **`decide` model role on Gemini Decisions API** for closed questions: assistant intent routing, document-type detection in imports and OCR, the legal abstention pre-check, ticket priority. With a fallback to the current path. | 150–250 ms and almost free, versus a full LLM call. Fits "cheapest first". | T166 spike + eval |
| 4 | **A2UI 1.0 for assistant answers:** the assistant returns tables, KPI tiles and confirm forms from our own component catalog instead of prose. Values bind server-side, so tenant data and masked fields never pass through the model. | Implements R1 "ask first, click second" safely; one protocol for web and later mobile. | T167 spike, after T108 and T128 merge |
| 5 | **Faster M1 gate:** run only the Playwright specs whose pages a PR touches, plus a fixed smoke set; the full suite runs on main nightly. | 11 of the ~13 critical-path minutes per PR in the merge queue. | T168 |
| 6 | **TypeScript 7 for CI typecheck** once 7.1 ships its API (eslint unblocked); until then nothing. Saves under a minute today. | Low gain now. | revisit at TS 7.1 |
| 7 | **PostgreSQL 19.1** (staging first): `REPACK CONCURRENTLY`, plan advice, `WAIT` for replica reads. **`pg_duckdb` on a read replica** only when report queries exceed 2 s at p95. | Accounting reports at scale without a separate warehouse. | Q1 2027 |
| 8 | **Valkey** instead of Redis at the next infra window (BSD licence; we already run it in one compose file). | Licence hygiene, drop-in. | next infra window |

### Revisit triggers for refused items
- **Rust module:** a CPU-bound path above 30% of a request's p95 in production traces.
- **Durable execution (Restate or Rivet):** an agent workflow that must survive restarts for more than 1 hour, or more than 3 hand-written saga retries.
- **MicroVM sandbox:** we run customer-supplied or model-generated code on our servers.
- **LiteLLM Rust gateway:** it reaches GA and our gateway p99 overhead exceeds 50 ms.
- **VectorChord instead of Qdrant:** Qdrant ops cost exceeds one more container, or a tenant needs vector data inside its RLS boundary.

## Global product: country-pack order (product, not market)
Iran is live. The core already resolves a country pack per company (T137–T142). Foreign packs are built in this order:
1. **Germany (DE)** first. The strictest regime (GoBD immutability, KassenSichV/TSE for POS, XRechnung/ZUGFeRD, ELSTER VAT returns, DATEV export). A core that passes Germany passes most of the EU.
2. **Gulf:** Saudi Arabia (ZATCA Fatoora phase 2: cryptographic stamp, CSID onboarding, QR) and the UAE (Peppol-based e-invoicing, corporate tax). Arabic RTL and the Hijri calendar reuse the Persian RTL work.
3. **Malaysia:** finish the queued rows (T152, T159) only, since they also test the framework. No new MY rows until the product is complete.

Packs are data plus adapters (R4); nothing country-specific goes in core code. Research prompts R13 (DE/EU) and R14 (Gulf) feed the pack rows.

## Rows added

| Lane | Task | Done when |
|---|---|---|
| L4 | **T166 `decide` role (Gemini Decisions API)** | `config/models.yaml` gains a `decide` role with `gemini-decision-1`, plus a fallback to the current classifier path. A thin client in the Python core and one in Nest call it. It is wired behind a flag into two places: assistant intent routing and import document-type detection. An eval script compares accuracy, latency and cost against the current path on 100 labelled cases from our data. A report in `docs/eval/`. No default change until the eval passes. |
| L2 | **T167 A2UI spike for assistant answers** (*after T108 and T128*) | The assistant can return an A2UI surface built only from a whitelist catalog (table, KPI tile, chart, confirm form) that maps to our existing components. Values bind server-side from tool results, and masked fields stay masked. Behind a flag on the Home hub only. Specs: an unknown component is rejected, and a masked value never appears in the model payload. |
| L1 | **T168 Faster M1 gate** | CI maps changed paths to Playwright specs and runs those plus a fixed smoke set on PRs. The full M1 suite runs nightly on main and on the merge queue's last batch. The PR-time gate drops below 5 minutes, measured on 5 PRs. No spec is deleted. |

## Update 2026-11-17: rows from R14 (Gulf) and R15 (factory)
Digests: `research/R14_GULF.md`, `research/R15_FACTORY.md`. **T168** gains 4 Playwright shards with blob-report merge in the `merge_group` run. **T161** gains a check of every price in `config/models.yaml` before 1 Jan 2027 (Gemini Flash introductory prices end 31 Dec 2026).

| Lane | Task | Done when |
|---|---|---|
| L2 | **T169 Currency precision (core)** (*after T138*) | A table of ISO 4217 currency exponents (0, 2 or 3 decimals) lives in pack data. Ledger, invoice, payment and stock-value amount columns widen from `numeric(18,2)` to `numeric(20,4)` in expand-style migrations with `lock_timeout`, one module per migration. One rounding helper rounds to the currency's exponent at posting time. Specs: post 1.234 OMR and 0.125 KWD entries and the trial balance balances to the fils; an IRR amount has no fraction; existing 2-decimal data is unchanged after the migration. |
| L1 | **T170 Migration lint** | Squawk runs in CI on new migration files only, with `require-lock-timeout`, `adding-not-nullable-field` and `prefer-robust-stmts` enforced and the rest reported. A script fails CI when a new migration id is not above the newest id on `origin/main` or appears twice. Both run in `local_ci` too. |
| L1 | **T171 Generated hotspot files** | Each module owns a manifest for its permissions, its Nest module import and its navigation entries. A deterministic, alphabetically sorted generator writes the permission matrix, the module import list for `app.module.ts` and the navigation menu. CI fails when the generated files are stale or edited by hand. Lanes never edit the generated files. |
| L4 | **T172 Review desk freshness** | The review desk skips draft PRs and stores the head SHA it reviewed. A new push marks its last review outdated and queues a new one. A PR is not queued for merge without a review on its current head. A 100-PR sample is labelled (comment led to a fix, or not) and the precision is written to `docs/eval/REVIEW_DESK_PRECISION.md`. |
| L3 | **T173 Ledger property tests** | fast-check properties for the posting engine: every posted entry balances; a reversal nets to zero; an FX conversion round-trip stays within one minor unit; no posting into a locked period succeeds. A nightly Stryker run scoped to the ledger module writes a mutation report (report-only, no gate yet). |

### Gulf pack rows (queued; start after the DE pack rows are merged)

| Task | Done when |
|---|---|
| **T174 Saudi Fatoora adapter** | Per-device CSID onboarding as one flow within the 24-hour compliance-CSID window; secp256k1 signing in Node; ICV/PIH chain locked per device; clearance for standard and 24-hour reporting queue for simplified invoices; credit/debit notes (381/383) linked to the original; 9-tag QR with UTF-8 byte lengths. Every document type passes the official SDK validator in CI and the simulation portal before release. |
| **T175 Peppol PINT mapper and ASP adapter** | PINT AE (and PINT OM) UBL output with a pre-send validator for mandatory fields; a provider-neutral ASP interface (send, receive, status webhook) with one provider implementation and a tenant "bring your own ASP" setting; tax ids per legal entity, never the group TIN. |
| **T176 Gulf tax data** | VAT rates and return mappings for SA, AE (box 1 per emirate and e-commerce split), OM and BH; Zakat base report and Zakat-to-VAT revenue reconciliation; data-only packs for QA and KW; Hijri display option; retention per country. Secondary facts marked `verified: false`. |

## Update 2026-11-17: rows from R16 (global core) and R13 (Germany)
Digests: `research/R16_GLOBAL_CORE.md`, `research/R13_GERMANY.md`. Order: the core rows go first, because the vendors that retrofitted these primitives could not undo them. The DE rows start once T177–T180 are merged; the Gulf rows T174–T176 still follow the DE rows. Lanes are assigned when a lane drops below the WIP limit. New migrations take ids above every open PR (from `1789900011300` today).

### Core rows

| Task | Done when |
|---|---|
| **T177 Core acceptance suite** | R16 Tests 1–15 (with the stage 2 fixes in the digest) exist as pg specs with the report's exact numbers. Tests that our core cannot pass yet are `skip`ped with a link to the row that fixes them. CI runs the passing ones. This row comes first: it shows the real gaps. |
| **T178 Journal integrity and period states** (*after T138*) | Per-entity gapless GL audit number and a SHA-256 hash chain over posted entries (fixed canonical pre-image), allocated by a per-entity sequencer at commit; `verify-chain` endpoint; p95 posting latency measured at 50 writes/s. Period states: open, soft-locked (role exception), adjustment period, hard-closed (irreversible; corrections go to the next open period). Restore runbook checks the chain head before reopening writes. Tests 3 and 4 pass. |
| **T179 Reporting currency and FX settlement** (*after T169*) | Every line carries transaction, book and reporting amounts. A foreign invoice can be settled from a bank account in a third currency without a clearing account; realised FX posts in book and reporting currency; per-document rounding residual account. Test 2 passes. |
| **T180 Tax engine interface** | Tax rate resolved by tax point (a credit note inherits the original invoice's rate); EU reverse charge posts input and output VAT; withholding at invoice or payment time per tax code with sequential certificates; a deductible date separate from the posting date. Iran codes keep their results (golden tests). Test 10 passes. |
| **T181 Dimensions v2** | Dimension rules (required when another dimension has a value), label history so a rename does not change closed periods, balance sheet by dimension; e-invoice and tax metadata live in their own fields, never in dimensions. Test 5 passes. |
| **T182 Intercompany and eliminations** (*after T155*) | Intercompany invoice creates the mirror bill; consolidation eliminates IC revenue/expense, AR/AP and investment against equity, and attributes minority interest. Test 1 passes. |
| **T183 Multi-book fixed assets** | Each asset has one or more depreciation books (e.g. IFRS and tax); dimension transfer without reversing past depreciation; disposal with output VAT and gain per book; asset history sheet report. Test 7 passes. |
| **T184 Bank statement import** | CAMT.053 and MT940 import, idempotent on bank transaction id; one payout matched to many invoices plus fees in one reconciliation. Test 9 passes. |
| **T185 Idempotency and outbound webhooks** | Every mutating endpoint honours `Idempotency-Key` for at least 24 h (same body returns the cached result, a different body returns 409); signed webhooks for invoice posted, journal posted, period locked, asset depreciated, with retries. Test 13 passes. |

### Germany pack rows (phase 1, bookkeeping)

| Task | Done when |
|---|---|
| **T186 DE GoBD** (*after T178*) | Retention classes 10/8/6 years with a legal hold; read-only auditor role scoped to fiscal years (Z1); GDPdU data handover (`index.xml` + DTD + CSV) whose totals equal the ledger (Z3); generated procedure documentation (system part). |
| **T187 DE e-invoices** (*after T175's adapter interface*) | One Java sidecar (KoSIT validator 1.6.0 + Mustangproject, Apache-2.0): inbound XML extracted and authoritative over the PDF; outbound XRechnung 3.0.2 (UBL and CII) and ZUGFeRD 2.5.2 (MINIMUM and BASIC WL refused); embedded attachments; itemised service description; Peppol send through the provider adapter, self-billing through BIS Self-Billing. 10 good and 10 broken samples validate as expected. |
| **T188 DE VAT data** (*after T180*) | Pack data: 19/7% rates, § 19 thresholds with mid-year warning and stop, § 34a invoice fields, § 18 return frequency and 1/11 special prepayment, § 13b codes (`verified: false` until checked), VIES check before a zero-rated EU invoice, neutral SKR03/04-compatible chart template with a separate Grundsteuer account. |
| **T189 DATEV EXTF export** | Buchungsstapel, Debitoren/Kreditoren and Sachkontenbeschriftungen in EXTF 700; CP1252 or UTF-8 with BOM; 99,999-row files; Belegfeld 1 sanitised; non-calendar fiscal years handled; foreign-currency fields filled. A 105,000-row export gives two files that a DATEV import accepts. |
| **T190 ELSTER and E-Bilanz** | Thin bridge around the official ERiC library for UStVA and ZM, signed with the tenant's own ELSTER certificate; E-Bilanz XBRL (taxonomy 6.9 and 6.10) with account-level proofs. Needs a manufacturer id from the Bavarian tax office: parked until the company step (owner decision 2026-11-16), build against the test mode first. |
| **T191 AI transparency labels** | Every AI draft shows an "AI-generated draft" label and its source citations; AI identities can never post, lock a period or file a return. EU AI Act Art. 50 applies since 2 Aug 2026. |

POS (cloud TSE, DSFinV-K) and payroll (certified partner) get rows after phase 1 is merged.

## Update 2026-11-17 (2): infrastructure audit and hub-owned rows
A read-only production audit (2026-11-17) found: backups healthy (hourly encrypted Postgres off-site, a second off-site copy, an encrypted Telegram copy, weekly drill), but vector-store snapshots only on the same disk and no timed full restore; no error tracking; no staging; the app's database login bypasses RLS (the cutover to the restricted role, PR #831, is not applied yet); 20 of 151 tables without RLS and no CI gate; pending OS updates. The owner approved fixing all of it. Cost rule: no new paid services and no heavy containers; reuse what we run (object storage free tier, Telegram bot, email, the owner's Mac).

Rows the hub runs with Claude agents (lanes: do not take them):

| Task | Done when |
|---|---|
| **T192 RLS coverage gate** | CI fails when a table with a tenant column lacks ENABLE + FORCE RLS and a tenant policy; global tables are listed with a reason; missing policies added. |
| **T193 Scanning and uptime** | Dependabot for npm and Docker, weekly CodeQL, uptime probes for all three domains. |
| **T194 Budget encumbrance** | A PO checks the budget (warn at 80%, block at 100%, revision unblocks). R16 Test 6 passes. |
| **T195 AVCO and standard costing** | Moving average and standard cost with price variance and GR/IR clearing. R16 Test 8 passes in full. |
| **T196 Accountant-firm access** | A firm user serves many tenants with a scoped role (view, request documents, adjustment-period journals; no bank-detail edits or payments); revoking the user ends all sessions within 60 s. R16 Test 12 passes. |
| **T197 Off-site vector and config backups** | Vector-store snapshots and configs encrypted and copied off-site and to Telegram with the existing jobs; the same-disk copy shrinks. |
| **T198 Restore drill and migration rehearsal** | A weekly job on the owner's Mac restores the newest encrypted backup into throwaway containers, runs main's pending migrations against it, checks row counts, records the real restore time and reports to Telegram. This doubles as our staging and migration rehearsal at zero cost. |
| **T199 Error capture** | Unhandled errors from the backend and the AI core are fingerprinted into one small table; new or spiking errors go to Telegram (max 10/hour) and a daily digest to Telegram and email. No new container. |
| **T200 Restricted database role** (*after #831*) | Production connects as the restricted application role; the superuser login is used only for migrations. Cross-tenant smoke test after the switch. |

Lane PRs keep their own rows. T194–T196 may go to lanes instead if a lane drops below its WIP limit first.
