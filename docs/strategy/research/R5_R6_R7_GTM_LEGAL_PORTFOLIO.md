# Research R5, R6, R7 — go-to-market, legal assistant, portfolio and "zero-hunting" UX (digest)

Source: the owner's deep-research runs of prompts 5, 6 and 7 (`deep_research_prompts.md`), received 2026-11-15. With R1–R4 this completes the set of seven. This file is the coordinator's digest, the decisions taken, the owner decisions still open, and the rows added to the WAVE 15 plan in `R4_COUNTRY_PACKS.md`.

**Caution:** prices, thresholds, dates and legal claims in the reports were not verified here. Prices are proposals for the owner, never code. Legal numbers go into effective-dated pack config with a source URL (R4 decision 4).

## R5 — go-to-market, pricing, entity, trust

### What the report found (summary)
- **Beachhead:** multi-branch retail, food-and-beverage and small trading/production businesses with 2–10 branches in Malaysia.
  - Today they stack three products: POS, accounting and payroll. In the report's own estimate that costs roughly RM 410–880 a month, with no AI, no BOM and no phone agent.
  - Micro-businesses are saturated by free plans. Contractors need compliance work we lack. Accountants are a channel, not the first buyer.
- **Germany is phase 2.** It needs certified audit compliance, e-invoicing, tax-office and filing integrations, German support and explicit call-recording consent. The report treats a later entry as a criminal-law risk, not just extra work.
- **Pricing pattern for 2026:**
  - a base price per company and branch, with unlimited cashier and attendance users;
  - usage packs for AI phone minutes and OCR pages;
  - light chat included.
- **Voice unit cost:** a self-hosted stack comes to about $0.02 a minute. A cloud fallback with cheap STT and TTS costs about $0.035. Premium voice platforms cost $0.065–0.11. **Unlimited minutes in a flat plan loses money.**
- **Payments and entity:**
  - Start with a merchant of record (Paddle) so we owe no tax registration on day one.
  - Then set up a Malaysian Sdn Bhd with local gateways (Billplz/HitPay, FPX/DuitNow) for cheap domestic collection.
  - Avoid Labuan: Malaysian buyers face a tax-deduction restriction when they pay a Labuan entity.
- **Trust signals buyers ask for:**
  - native e-invoice and sales/service-tax correctness;
  - a data-export guarantee after cancellation;
  - offline POS during internet outages;
  - a public status page and SLA;
  - local-language support with weekend coverage for POS.
- **Compliance:**
  - Free LLM tiers that may train on prompts conflict with Malaysia's PDPA (amended 2024) and with GDPR for paying customers' data.
  - The EU AI Act Art. 50 requires AI disclosure at the first interaction, from 2026-08-02.
  - Breach notification is due within 72 h to the regulator and within 7 days to individuals, with a 2-year breach log.
  - Biometric attendance data is sensitive data.

### Decisions (adopted)
1. **Malaysia multi-branch retail and F&B is the design target** for WAVE 15–17 features. It matches R4's country order. Germany stays phase 2.
2. **Plan entitlements and usage metering are core.** Each tenant has a plan record with limits: branches, office users, payroll employees, AI messages, OCR pages and voice minutes. Usage counters are per tenant per month, and every metered service checks and decrements them. Prices live in config and are set by the owner.
3. **No unlimited voice.** The phone agent stops at the plan's minute cap, then follows a configurable overflow (voicemail or a human callback). The cloud fallback stays margin-positive.
4. **AI disclosure everywhere.** The first assistant message and the first seconds of every call say it is an AI. Call recording or transcription starts only after an explicit opt-in (a keypress or a spoken yes), stored with a timestamp. Where consent is not given, the call continues without recording.
5. **Customer data only on no-training paid keys.** This is the R2/R3 proposal and T136; this report confirms it. It is a hard gate before the first paying customer.
6. **Data export guarantee.** After cancellation a tenant stays read-only with full export (CSV/Excel/JSON) for a configurable 30–90 days before deletion.
7. **Offline POS.** POS keeps selling during an outage from a local queue and syncs with idempotency keys when the connection returns.
8. **Security-incident log.** Keep a per-tenant incident register with notification timestamps, kept 2 years, plus a processor-to-customer notice workflow.

### Owner decisions (not engineering)
- **Prices:** the report proposes RM 89 / 249 / 449 a month for the three plans, plus branch and voice packs. Pricing is the owner's call.
- **Entity and payments:** start with a merchant of record, then set up a Malaysian Sdn Bhd and local gateways. Avoid Labuan.
- **Legal documents:** terms, DPA, sub-processor list and privacy policy are drafted by us. A local lawyer reviews them before launch.
- **First channel:** direct demos with free migration, then accountant partners with a revenue share.

## R6 — legal research assistant

### Where we already are (checked 2026-11-15)
- Rows carry `source_tier` (official / secondary / unofficial). Law watch writes `valid_from` versions, the rulings timer runs on the server, and unofficial rows are labelled.
- The Malaysia allowlist is `proposed` only, and AGC reuse permission is pending (`MALAYSIA_AGC_TERMS_2026-10-22.md`). That is exactly what the report says to do.
- Golden sets exist (`data/eval/chat_golden/legal_gate_*`, `scripts/eval/legal_gate.py`).

### Decisions (adopted)
1. **Versioned, as-of retrieval.** Every legal version has `valid_from` / `valid_to` and a status (active / amended / repealed / transitional). Retrieval always filters on the query's as-of date in both the vector payload and Postgres. With no valid version on that date, the answer says so and abstains.
2. **Hybrid retrieval with a safe fallback:**
   - dense + sparse search in Qdrant, plus Postgres full-text search with article-number regexes, fused with RRF and then reranked;
   - if the embedding model is down, never query the collection with another model's vectors; fall back to keyword search and full-text search only.
3. **Hard abstention gate.** The assistant abstains in four cases:
   - the rerank score is below the threshold;
   - an old version and a current version conflict and the conflict is unresolved;
   - the question is outside the corpus;
   - the question's premise contradicts the retrieved text.
4. **Deterministic citation check.** Every cited law and article in the model's JSON must appear in the retrieved chunks, or the claim is dropped. The UI shows the source tier on every citation. An unofficial source never stands alone.
5. **Golden set per country.** Grow to 150–200 questions in four classes: exact recall, as-of/amendment, false premise, out of scope. It runs in CI on every prompt, model or chunking change. Beta gates are a hallucination rate under 10% and abstention recall over 85%. Production gates are under 5% and over 95%.
6. **Scope lock.** The assistant is positioned as a research and summary tool: no case-specific advice and no drafting of pleadings. It is walled off from HR performance and dismissal data, so it does not become a high-risk employment system under the EU AI Act. A disclaimer banner appears on web, SMS and voice.
7. **Voice legal answers:**
   - AI disclosure first;
   - read back the law and article number for confirmation;
   - a spoken summary of 45 seconds or less;
   - send the citation link (full text, tier, valid date) by SMS or in-app;
   - abstain and offer a human callback below the threshold.
8. **Sources:** never crawl behind captchas or one-time passwords, and never ingest private publishers' headnotes. Malaysian portals wait for written terms review. For Germany use EUR-Lex CELLAR plus NeuRIS (fallback: the federal XML). Never claim coverage of state law or lower-court decisions.
9. **No preview models in production, and no farming of free accounts.** Both are already the R2/R3 position.

## R7 — portfolio and "zero-hunting" UX

### Decisions (adopted)
1. **Navigation stays the 7-hub IA** adopted from R1 (T106). R7 proposes 8 items with Purchases and Inventory split; we keep "Purchases & Inventory" as one hub and hide Inventory pages for service-only companies. Adaptive menus that reorder by usage are banned.
2. **The command bar never waits on an LLM.** Entity and action search uses Postgres full-text search plus `pg_trgm`, under RLS (no external search engine). AI answers are an extra route from the same bar.
3. **NL reports compile to a JSON query spec.** The LLM produces metrics, dimensions, filters and dates; the backend compiles them deterministically to SQL under the tenant's RLS role. The LLM only narrates the numbers it got back.
4. **Universal drill-down.** Every aggregate number links to its ledger lines and source document. Report state lives in the URL and can be saved as a named view.
5. **Scheduled reports** are BullMQ jobs that render a PDF or image and send it by email, Telegram or WhatsApp.
6. **AI degradation tiers.** Normal; slow or rate-limited (search and rule-based categorisation keep working, and the report builder shows filters); AI offline (a badge, with every core flow unaffected).
7. **Accessibility rules:**
   - numeric cells are `dir="ltr"` inside RTL;
   - touch targets are 44×44 px on POS and mobile;
   - an optional plain-language mode renames jargon (for example "Accounts receivable" becomes "Money owed to you");
   - full keyboard entry on invoices, bills and journals;
   - axe gate in CI (T110).
8. **Telemetry without PII.** Self-hosted events record structural metadata only: role, intent, latency, accepted. They never record amounts, names or prompt text. The north-star metric is weekly active companies (3 or more value actions a week). Also track time to first value, command-bar success rate, AI acceptance and undo-within-2-minutes.
9. **Portfolio order (next 3 months):**
   - accountant practice portal (one login, many companies, a cross-client attention matrix);
   - payment links through partner gateways (T90 exists);
   - expense capture from a photo or Telegram/WhatsApp into a draft awaiting approval;
   - notifications and an approvals inbox.
10. **Next 6 months:**
    - a bookkeeping/reconciliation agent with rules first and AI second;
    - a collections agent;
    - recurring billing;
    - a customer portal.
11. **Next 12 months:**
    - marketplace sync (WooCommerce exists; then Shopify, Shopee and Lazada);
    - budgeting and forecasting;
    - supplier portal and 3-way match;
    - public API and webhooks.
12. **Never in-house:** card issuing, lending, earned-wage access or holding funds. Partner only, later.

### The 30 features users miss when switching
Bank rules, partial and over-payments, split transactions, keyboard-only entry, bulk actions, period lock, immutable audit trail, realised/unrealised FX, credit notes linked to invoices, multi-level approvals, duplicate detection, recurring invoices and journals, report drill-down, invoice templates, landed cost, unit-of-measure conversion, configurable negative stock, payment reminders, attachments on every transaction, saved report filters, tax-inclusive/exclusive and withholding, customer/vendor statements, shift close / Z-report, depreciation schedules, granular RBAC, void instead of delete, validated imports, line-level cost-centre tags, company switcher, and consolidation.

Which of these we already have is **not yet known**. The WAVE 15 row "Feature-gap audit" produces `docs/strategy/FEATURE_GAP_30.md` with file-path evidence per feature, and the gaps become WAVE 16 rows.

## Rows added to the WAVE 15 plan
These run alongside the R4 rows. Lanes carry the volume.

| Lane | Task | Done when |
|---|---|---|
| L1 | **Feature-gap audit (30 features)** | `docs/strategy/FEATURE_GAP_30.md` marks each feature exists / partial / missing, with file paths and a spec name as evidence. Each missing or partial feature has a one-line WAVE-ready task and an effort size (S/M/L). Docs only, one PR. |
| L1 | **Draft customer legal documents** | `docs/legal_customer/` holds B2B terms with a SLA section, a DPA (processor duties, incident notice to customer within 24 h, deletion/return), a sub-processor list generated from `config/models.yaml` and the infrastructure, and a privacy policy (biometric and voice data, retention). Every file is headed "DRAFT — needs local lawyer review". No code. |
| L2 | **Plan entitlements and usage metering** | A `tenant_plans` table and a monthly `usage_counters` table, each with tenant_id, FORCE RLS and a pg spec as roxira_app. A `EntitlementService.check/consume(tenant, meter, n)` with meters `ai_messages`, `ocr_pages`, `voice_minutes`, `branches`, `office_users` and `payroll_employees`, using limits from config. It is wired into the assistant, OCR import and branch creation, and returns a clear "limit reached" error. Specs cover limit, rollover and concurrent consume. |
| L2 | **Period lock + void-not-delete audit** (*after the gap audit marks it partial/missing*) | Posted entries cannot be deleted, only voided by a reversing entry; locked periods reject posting except by an override role, with an audit row. Specs cover both. |
| L3 | **Universal entity search** | One `/search` endpoint over customers, suppliers, products, invoices, bills, cheques, accounts and pages, using Postgres full-text search + `pg_trgm` indexes added through a migration. It runs under RLS and returns results in under 300 ms on seed data. The command palette uses it and never calls the LLM for navigation. |
| L3 | **Data export after cancellation** | A tenant `status=cancelled_readonly` with `delete_after`. Writes are blocked by a guard while reads and the full export (a CSV/JSON zip of every tenant table via a BullMQ job) keep working. A purge job runs after `delete_after`. Specs cover each step. |
| L4 | **Legal as-of + abstention gate** | Retrieval filters on as-of valid dates. The four abstention rules from R6 decision 3 apply, plus the deterministic citation check. The source tier shows on every citation in the UI. `scripts/eval/legal_gate.py` gains false-premise and out-of-scope classes, and CI fails below the beta thresholds. |
| L4 | **Voice: AI disclosure, consent, minute cap** | The first sentence of every call discloses the AI. Recording and transcription start only after an explicit opt-in, saved with a timestamp. `voice_minutes` is consumed through EntitlementService, with the overflow from R5 decision 3. Legal answers follow R6 decision 7 (read-back, 45 s or less, link by SMS). |

## WAVE 16+ (later, from R5–R7)
- Offline POS queue with idempotent sync.
- Approvals inbox and notification centre.
- Accountant practice portal.
- Expense capture from photos and messengers.
- NL report → JSON query spec → SQL compiler.
- Universal drill-down and saved views.
- Scheduled reports.
- Plain-language mode.
- Telemetry events table and the weekly-active-companies metric.
- Security-incident register.
- Status page.
- Bookkeeping and collections agents.
- Recurring billing and customer portal.
- Gaps found by the feature audit.
