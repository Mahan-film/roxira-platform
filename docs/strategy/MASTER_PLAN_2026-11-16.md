# Master plan — 2026-11-16

> **Update later on 2026-11-16 (owner): product first.** All work goes to finishing the product: CRM, ERP, accounting and tax, built to be usable worldwide (Germany and the EU, the Gulf states, others; Iran is live). **No company, market, pricing or pilot-customer decisions until the product is complete.**
>
> So:
> - Track B below (Malaysian dogfood and pilots) is **paused**. The MY pack rows already queued stay, because they test the country-pack framework.
> - Owner asks about the company are paused in `docs/owner/OWNER_ASKS_FA.md`.
> - Foreign pack order and the factory changes (WIP limit, merge pass, faster M1 gate) are in `ARCHITECTURE_DECISIONS_2026-11-16.md`.
> - Research prompts R13–R16 are in `DEEP_RESEARCH_ROUND3.md`.

This plan orders the work after research R1–R9. It replaces nothing. `MASTER_PLAN_2026-10-31.md` (Iran first) and the R digests in `research/` stay valid, and this file says what comes first. Status per area: `STRATEGY_COVERAGE.md`.

## Owner decisions behind this plan (2026-11-16)
- **Lowest possible cost.** Use the key pool and free tiers first; the owner tops up a paid account only when a free tier runs out. No new paid tools or subscriptions without a measured need.
- **Malaysia runs through the owner's existing Sdn Bhd** (food retail). Its nature of business changes to add software and AI services. That company is also **pilot #1**.
- **Data:** no special privacy promise. Customer data may improve the service, and the terms say so. A paid private data option exists on request.
- **The hub has full authority to plan and run.** The owner is asked only for money, signatures, physical actions, and facts that only they know.

## Two tracks
| Track | Market | Product | Goal by end of Q1 2027 |
|---|---|---|---|
| **A. Iran** | roxira.ir, Persian, Jalali, IRR | Accounting suite (issue #230 checklist), Moadian, legal assistant (ghazihoushmand.ir) | Accountant-day E2E green; the first paying accounting customers. |
| **B. Malaysia** | roxira.net, en-MY / BM / zh | MY pack: POS + inventory + ledger + MyInvois + clearing accounts | Our own food-retail company runs its books and counters on Roxira, then 3–5 outside pilots. |

Both tracks share one core: the country pack resolves per company, the ledger holds two amounts, tenant groups, entitlements, the assistant, and the 7 hubs. Track A keeps priority whenever the two compete for the same lane.

## Phases

### Phase 0 — until 31 Dec 2026: land what is built
1. **Merge the backlog.** About 30 lane PRs, in dependency order:
   1. RLS cutover (#831), navigation (#830), the design ratchet (#839);
   2. the country-pack chain (#842 → #850, #851 → #852);
   3. branch dimension (#848) before attendance (#849) and home (#847);
   4. everything else.

   The review desk reviews, the hub merges, and lanes fix blockers (WAVE 15b, step 1).
2. **WAVE 15b:** the remaining WAVE 15 rows, plus R8 rows T151–T154.
3. **Before 1 Jan 2027:** measure the invoice OCR on a cheaper stable model and switch off `gemini-3.8-flash` if quality holds (R8 decision 5).
4. **Legal drafts (#846) updated to the 2026-11-16 data decision** before any customer signs.

### Phase 1 — Jan to Mar 2027: dogfood Malaysia, sell Iran
- WAVE 16: T155 company groups, T156 clearing accounts, T157 marketplace import, T158 print bridge, T159 MyInvois intermediary, T160 attendance check.
- The owner's company goes live on the MY pack: first the books (opening balances, chart of accounts), then one counter with a tested printer, then MyInvois.
- Iran: the #230 accounting checklist, the year-end and Moadian gates, and onboarding of the first paying customers.

### Phase 2 — Apr to Jun 2027: outside pilots
- 3–5 Malaysian pilots: daytime retail, light trading or counter cafés with 2–10 branches. Found through the owner's network and bookkeeping firms; the channel details come from R11.
- Decide Malaysian payroll (build to the LHDN MTD spec, or partner) from pilot demand.
- Decide WhatsApp capture and the phone agent from R11 and measured demand.

## What we measure ourselves (no research can answer these)
- OCR quality and cost on our own Persian and Malaysian invoices (`docs/eval/INVOICE_CAPTURE_EVAL.md`).
- Embedding and reranker quality on the legal golden set.
- STT accuracy on our own calls, per language.
- Cost per tenant from the usage counters (T145).
- Time to first posted entry and weekly active companies, from pilot telemetry.

## Owner actions (only these)
1. **SSM:** the company secretary passes a board resolution, adds the software/AI nature of business with its MSIC codes, and notifies SSM within 14 days.
2. **MyInvois sandbox:** the company secretary or accountant emails LHDN for sandbox credentials (TIN, BRN, company name, email, and "Roxira" as the ERP). The credentials go into the server env with `set_secret.sh`, never into chat or git.
3. **Facts about pilot #1, the food-retail company:** number of branches; current POS and accounting software; printer, scanner and cash-drawer models at the counter; payment methods (card terminal bank, DuitNow QR, e-wallets, delivery apps); annual revenue band (under or over RM 3M); number of staff, and whether foreign workers are among them.
4. **Send R10–R12.** They are digested like R8 and R9.

## Research still needed (owner runs deep research, hub digests)
These are primary documents the hub could not read in full:
- The latest LHDN e-Invoice **Specific Guideline** PDF: consolidation limits, the RM 10k wording, the self-billed cases.
- RMCD service tax rules for **IT and software services** and **F&B**: rates, thresholds, the return period.
- KWSP Third Schedule, LHDN **MTD/PCB 2027** calculation spec, PERKESO contribution tables (the payroll decision in Phase 2).
- Employment Act 1955 (Act 265) text on hours, overtime and public holidays.
