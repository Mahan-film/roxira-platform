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
| 9 | LLM keys and customer data | ✅ R2/R3/R5/R8 | ✅ paid no-training for customer data; no preview ids in product (R8) | ✅ T136, T151 | 🟡 | **Owner: enable billing on one project**; Gemini Flash price doubles 1 Jan 2027 |
| 10 | Country packs, multi-currency | ✅ R4 | ✅ | ✅ W15 T137–T142 | 🟡 | Post WAVE 15 |
| 11 | Malaysia legal numbers (e-invoice, tax, payroll, PDPA) | ✅ R8 (part verified) | ✅ MyInvois modes; MY payroll deferred | ✅ T152, T154 | ❌ | Primary-source gaps in `R8_FACT_CHECK.md` before the MY pack ships |
| 12 | Beachhead customer needs (multi-branch retail and F&B) | 🟡 R5, high level only | 🟡 | ❌ | ❌ | **R9**: field requirements, hardware, delivery platforms, interviews |
| 13 | POS hardware, offline, counter payments | ❌ | ❌ | ❌ | ❌ | **R9 + R12**, then a WAVE row |
| 14 | Pricing and plans | ✅ R5, R8 competitor prices | 🟡 owner decides prices | ✅ T145 metering | ❌ | Owner sets prices (per-branch bundle) |
| 15 | Our own subscription billing and revenue ops | ❌ | ❌ | ❌ | ❌ | **R10** |
| 16 | Financial model, runway, funding and grants | ❌ | ❌ | ❌ | ❌ | **R10** |
| 17 | Company entity, bank, trademark, insurance | 🟡 R5, R8 (Sdn Bhd needs a resident director) | 🟡 Paddle MoR first, then Sdn Bhd; no Labuan | ❌ | ❌ | **R10**, then owner: resident director |
| 18 | Customer legal documents (terms, DPA, privacy) | ✅ R5 | ✅ | ✅ W15 T144 drafts | ❌ | Lawyer review |
| 19 | Growth channels, website, SEO | 🟡 R5 channels only | ❌ | ❌ | 🟡 public site exists | **R11** |
| 20 | Messaging (WhatsApp, Telegram, SMS, email) | ❌ | ❌ | ❌ | 🟡 | **R11** |
| 21 | Support and customer success, migration service | ❌ | ❌ | ❌ | 🟡 importers exist | **R11** |
| 22 | Accountant partner programme and practice portal | 🟡 R5/R7 | 🟡 | 🟡 W16 | ❌ | **R11** |
| 23 | Portfolio roadmap (next modules) | ✅ R7 | ✅ | 🟡 W16+ | 🟡 | Feature-gap audit (T143) first |
| 24 | Open-source licence compliance | ❌ | ❌ | ❌ | ❌ | **R12**, then a CI licence check |
| 25 | Dependency and AI-model lifecycle | 🟡 R2/R3 | 🟡 | ❌ | 🟡 models.yaml | **R12** |
| 26 | Vendor exit and fallback per component | 🟡 R2 | ✅ fallback rule | 🟡 | 🟡 | **R12** vendor-exit table |
| 27 | Scale, load testing, cost per tenant | 🟡 R2 | ❌ | ❌ | ❌ | **R12** |
| 28 | Product metrics and private telemetry | ✅ R7 | ✅ | 🟡 W16 | ❌ | Telemetry events table |

## Things research cannot answer (we must measure them ourselves)
Each becomes a WAVE row once its prerequisite exists.
- Embedding and reranker quality on our own legal golden set: current model vs bge-m3 vs multilingual-e5.
- STT accuracy and latency on our own call recordings, per language.
- OCR quality on our own sample invoices and receipts.
- Cost per tenant from real usage counters (needs T145).
- Activation and weekly active companies from real pilots (needs telemetry).

## Research round 2
The owner has the prompts in `Desktop/Roxira/deep_research_round2.html` (copy buttons) and `.txt`. Each prompt has two stages: the research itself, then a self-review with fact re-checks and a decision pack.

| Prompt | Covers rows |
|---|---|
| R8 fact-check — **received, `research/R8_FACT_CHECK.md`** | 9, 11, 14, 17 |
| R9 first-customer field requirements | 3, 12, 13 |
| R10 our own business (billing, finance, funding, entity, trademark) | 15, 16, 17 |
| R11 growth and customer operations | 19, 20, 21, 22 |
| R12 technical future-proofing | 13, 24–27 |

When the answers arrive, they are digested like R1–R7, and this table is updated.
