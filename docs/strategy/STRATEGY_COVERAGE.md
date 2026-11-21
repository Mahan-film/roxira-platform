# Strategy coverage map (2026-11-15)

This file answers one question: **for each area the business depends on, have we researched it, decided it, planned it, and built it?** Update a row whenever its state changes.

Legend: ✅ done · 🟡 partial · ❌ not yet. "Plan" means a WAVE row exists.

| # | Area | Researched | Decided | Plan | Built | Next step |
|---|---|---|---|---|---|---|
| 1 | Product IA, 7 hubs, command bar | ✅ R1, R7 | ✅ | ✅ W14 T106 | 🟡 | Finish T106; universal search (T147) |
| 2 | Design system, RTL/LTR, accessibility | ✅ R1, R7 | ✅ | ✅ W14 T110/T115 | 🟡 | Axe and UI-debt ratchets in CI |
| 3 | i18n (multi-language) | ✅ R1 | ✅ next-intl | ✅ W14 T111+ | 🟡 | Extraction passes; Malay, English and **Chinese** (R9) |
| 4 | Business-data assistant (chat) | ✅ R3 | ✅ | ✅ W14 T108/T127 | 🟡 | Own golden set + CI eval |
| 5 | Phone agent | ✅ R3 | ✅ | ✅ W14 T135, W15 T150 | 🟡 | Disclosure, consent, minute cap; **measure STT on our own calls** |
| 6 | Legal assistant | ✅ R6 | ✅ | ✅ W15 T149 | 🟡 | As-of + abstention; **embedding benchmark on our own golden set** |
| 7 | Hosting, deploy, DB, RLS | ✅ R2 | ✅ | ✅ W14 T105 | 🟡 | RLS production cutover window |
| 8 | Security and compliance roadmap | ✅ R2, R8 | ✅ | 🟡 T133, T153, T154 | 🟡 | Pentest and incident retainer (R12) |
| 9 | LLM keys and customer data | ✅ R2/R3/R5/R8 | ✅ owner 2026-11-16: free-first, data may improve the service (disclosed in terms); paid **private data option** on request; no preview ids in product | ✅ T136, T151 | 🟡 | Terms/privacy drafts (#846) say so; Gemini Flash price doubles 1 Jan 2027 |
| 10 | Country packs, multi-currency | ✅ R4 | ✅ | ✅ W15 T137–T142 | 🟡 | Post WAVE 15 |
| 11 | Malaysia legal numbers (e-invoice, tax, payroll, PDPA) | ✅ R8 (part verified) | ✅ MyInvois modes; MY payroll deferred | ✅ T152, T154 | ❌ | Primary-source gaps in `R8_FACT_CHECK.md` before the MY pack ships |
| 12 | Beachhead customer needs (multi-branch retail and F&B) | ✅ R9 | ✅ pilot #1 = our own MY food-retail company; then daytime retail/trading/counter cafés | ✅ W16 T155–T160 | ❌ | Dogfood on our own company |
| 13 | POS hardware, offline, counter payments | ✅ R9 | ✅ PWA + local print bridge; clearing accounts per rail | ✅ T156, T158 | 🟡 offline queue (T93) | Tested-printer list |
| 14 | Pricing and plans | ✅ R5, R8 competitor prices | 🟡 owner decides prices | ✅ T145 metering | ❌ | Owner sets prices (per-branch bundle) |
| 15 | Our own subscription billing and revenue ops | ✅ R10 | ✅ HitPay via own Sdn Bhd; Paddle dropped (AUP); plans/entitlements in our ledger | 🟡 T145 | ❌ | Owner: open HitPay merchant account |
| 16 | Financial model, runway, funding and grants | ✅ R10 | ✅ lowest cost; grants/MD incentive only after revenue | ❌ | ❌ | Owner: company ownership % (24% vs MSME tax) |
| 17 | Company entity, bank, trademark, insurance | ✅ R5, R8, R10 | ✅ existing MY Sdn Bhd adds software/AI; no Paddle, no Labuan | ❌ | ❌ | Owner: SSM nature change; MyIPO search + classes 9/42; accountant owns WHT/SST |
| 18 | Customer legal documents (terms, DPA, privacy) | ✅ R5 | ✅ | ✅ W15 T144 drafts | ❌ | Lawyer review |
| 19 | Growth channels, website, SEO | ✅ R11 | ✅ partners → trigger outreach → 3-language comparison pages + free tools → clinics; ads wait | ❌ | 🟡 public site exists | WAVE row for free e-invoice checker + comparison pages |
| 20 | Messaging (WhatsApp, Telegram, SMS, email) | ✅ R11 | ✅ WhatsApp Cloud API, customer-owned number (Embedded Signup v4); SMS OTP only via local gateway; own SMTP + signed links | ❌ | 🟡 | Owner: Meta business verification under the Sdn Bhd |
| 21 | Support and customer success, migration service | ✅ R11 | ✅ AI first line 24/7, human P1 9–21 MYT; free smart cutover | 🟡 T100 | 🟡 importers exist | One inbox; Chatwoot only at volume |
| 22 | Accountant partner programme and practice portal | ✅ R5/R7/R11 | 🟡 owner sets % | 🟡 W16 | ❌ | Owner: partner commission % |
| 23 | Portfolio roadmap (next modules) | ✅ R7 | ✅ | 🟡 W16+ | 🟡 | Feature-gap audit (T143) first |
| 24 | Open-source licence compliance | ✅ R12 | ✅ gate shipped deps; internal AGPL tools OK | ✅ T163 | ❌ | — |
| 25 | Dependency and AI-model lifecycle | ✅ R12 | ✅ retired-id list + CI; Node 24 by Mar 2027 | ✅ T161, T162, PR #857 | 🟡 models.yaml | Owner: approve PR #857 |
| 26 | Vendor exit and fallback per component | ✅ R2, R12 | ✅ fallback rule; LiteLLM pinned, no enterprise features | 🟡 | 🟡 | — |
| 27 | Scale, load testing, cost per tenant | 🟡 R2, R12 (model only) | 🟡 | ✅ T164 restore drill | ❌ | Load test before tenant 20 |
| 28 | Product metrics and private telemetry | ✅ R7 | ✅ | 🟡 W16 | ❌ | Telemetry events table |

## Things research cannot answer (we must measure them ourselves)
Each becomes a WAVE row once its prerequisite exists.
- Embedding and reranker quality on our own legal golden set: current model vs bge-m3 vs multilingual-e5.
- STT accuracy and latency on our own call recordings, per language.
- OCR quality on our own sample invoices and receipts.
- Cost per tenant from real usage counters (needs T145).
- Activation and weekly active companies from real pilots (needs telemetry).

## Research round 2
Prompts: `DEEP_RESEARCH_ROUND2.md` (round 1, R1–R7: `DEEP_RESEARCH_ROUND1.md`). Each prompt has two stages: the research itself, then a self-review with fact re-checks and a decision pack.

| Prompt | Covers rows |
|---|---|
| R8 fact-check — **received, `research/R8_FACT_CHECK.md`** | 9, 11, 14, 17 |
| R9 first-customer field requirements — **received, `research/R9_FIRST_CUSTOMER.md`** | 3, 12, 13 |
| R10 our own business (billing, finance, funding, entity, trademark) — **received, `research/R10_R11_R12_BUSINESS_GROWTH_TECH.md`** | 15, 16, 17 |
| R11 growth and customer operations — **received, `research/R10_R11_R12_BUSINESS_GROWTH_TECH.md`** | 19, 20, 21, 22 |
| R12 technical future-proofing — **received, `research/R10_R11_R12_BUSINESS_GROWTH_TECH.md`** | 13, 24–27 |

When the answers arrive, they are digested like R1–R7, and this table is updated.

## Research round 3
Prompts: `DEEP_RESEARCH_ROUND3.md`.

| Prompt | Status |
|---|---|
| R13 Germany and EU pack | waiting for the owner |
| R14 Gulf packs | **received 2026-11-17, `research/R14_GULF.md`** (T169, T174–T176) |
| R15 software factory | **received 2026-11-17, `research/R15_FACTORY.md`** (T168 amended, T170–T173, lane prompt v6) |
| R16 global accounting core benchmark | waiting for the owner |
