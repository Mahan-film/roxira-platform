# Deep research — round 2 (R8–R12, 2026-11-15)

Prompts sent on 2026-11-15, kept here because the laptop Desktop copy was erased. Results: `research/R8_FACT_CHECK.md`, `research/R9_FIRST_CUSTOMER.md` and `research/R10_R11_R12_BUSINESS_GROWTH_TECH.md`; coverage rows in `STRATEGY_COVERAGE.md`.

How they were run: one fresh Deep Research chat per prompt. Paste stage 1; when the report arrives, paste stage 2 in the same chat; send both outputs to the hub. Some "decisions already taken" in the context were later reversed (see `MASTER_PLAN_2026-11-16.md` and `ARCHITECTURE_DECISIONS_2026-11-16.md`).

---

## R8 — fact-check every number and law from round 1

### Stage 1

```
CONTEXT
We are a very early-stage startup (one founder, one engineer, and AI coding agents working in parallel "lanes" through GitHub PRs with automated cross-model review). Budget is very tight. We build "Roxira", an experimental AI-first business platform:
- SMB suite: double-entry accounting, invoicing and e-invoicing, POS, inventory (FIFO, BOM/production), purchasing, treasury (bank, cash, cheques, reconciliation), payroll/HR/attendance, tax filings, CRM, reports, data import, multi-branch.
- In-app AI assistant over the user's own data (read-only tools, numeric grounding, citations to source records).
- AI legal-research assistant (RAG over statutes and rulings, auto-updated, source tiers, abstention).
- AI phone agent (SIP/LiveKit, streaming STT + LLM + TTS).
Stack: NestJS, Next.js 16 / React 19 / Tailwind v4, PostgreSQL behind PgBouncer with tenant_id + row-level security, Redis + BullMQ, Qdrant, Python FastAPI, LiteLLM gateway, Docker Compose on rented VPS, GitHub Actions + merge queue.
Decisions already taken (from a first research round): first market is Malaysia, segment = multi-branch retail, food & beverage and small trading/production businesses with 2-10 branches; Germany is phase 2; the current Persian (RTL, Jalali) locale stays as the default pack; country packs with effective-dated config; dual-amount multi-currency ledger; 7 job hubs + command bar; plan entitlements with usage packs for AI phone minutes and OCR pages; customer data only on paid no-training LLM tiers; sell first through a merchant of record, then a Malaysian Sdn Bhd with local payment gateways.
Rules for your answer: cite primary sources (official sites, regulators, vendor pricing pages, laws) with publication or last-updated dates; flag anything older than 12 months; separate FACTS from RECOMMENDATIONS; give prices in the original currency plus USD; say clearly when evidence is missing instead of guessing.

TASK R8 — Fact-check the claims our plan now depends on. For each claim below, find the current primary source, give the exact current value, the effective date, and whether it changed in the last 12 months. Then say which of our decisions would change if the claim is wrong.
Malaysia:
1. MyInvois e-invoicing: current phase dates, the turnover threshold below which businesses are exempt (a report said it was raised to RM 3 million on 30 Aug 2026 — verify), consolidated e-invoice rules and caps, API sandbox access and whether software providers must register or be certified.
2. Service tax on digital services by foreign providers: rate (reported 8%), registration threshold (reported RM 500,000), filing frequency; and whether a Malaysian Sdn Bhd selling SaaS must charge service tax and from what threshold.
3. PDPA 2024 amendments: in-force dates, data-processor duties, breach notification deadlines (reported 72 hours / 7 days), DPO appointment thresholds, cross-border transfer rules, penalties.
4. Payroll statutory items and rates for 2026-2027 (EPF, SOCSO, EIS, PCB/MTD, HRDF) and whether payroll software must be approved or tested against LHDN's PCB specification.
5. Company setup: Sdn Bhd with foreign shareholders (resident director rule, costs, bank account timelines), and the Labuan deduction restriction for Malaysian payers.
EU / Germany (phase 2, but it shapes design now):
6. EU AI Act Article 50 transparency duties: application date, what counts as sufficient disclosure for chatbots and voice agents, machine-readable marking of synthetic audio; status of any "Digital Omnibus" delay of Annex III obligations.
7. German B2B e-invoicing dates (receiving 2025, sending 2027/2028), GoBD procedural documentation, KassenSichV/TSE for POS, and § 201 StGB on recording calls.
AI vendors (terms and prices):
8. Google Gemini API: free-tier data use (training, human review), regional restrictions (EEA/UK/CH), paid-tier no-training terms, whether rate limits are per project, whether preview models are allowed in production; current Flash-class prices.
9. Same for Mistral, Groq, OpenRouter (and its upstream providers), DeepSeek, Cohere: training on API data, retention, zero-data-retention options, and whether using several API keys or accounts to increase limits is allowed.
10. Voice unit costs: LiveKit Cloud plans, Deepgram, AssemblyAI, ElevenLabs, Cartesia, Inworld, and any provider with good Malay / Malaysian English / Mandarin STT and TTS; price per minute.
Payments:
11. Paddle and Lemon Squeezy fees and payout terms; Stripe Malaysia fees; Billplz, HitPay, iPay88 fees for FPX, DuitNow QR and cards; which ones require a Malaysian entity.
Competitors:
12. Current list prices of StoreHub, Bukku, Financio, SQL Account, AutoCount Cloud, Xero Malaysia, QuickBooks Malaysia, Odoo, Zoho for a 3-branch retail/F&B business; which of them bundle POS + accounting + payroll.
OUTPUT: one table per section (claim | current value | source | date | changed?), then "decisions affected" with the change you recommend.
```

### Stage 2 (same chat, after the report)

```
STAGE 2 — Act now as a skeptical senior reviewer of the report you just wrote.
1. Re-check every number, date, price, threshold and legal claim in your report against a primary source. Output a table: claim | source URL | source date | VERIFIED / CHANGED (give the correct value) / UNVERIFIABLE.
2. List what the report missed that a small startup in our position would regret in 12-24 months (at least 10 items), each with why it matters.
3. Turn the report into a DECISION PACK. For each decision: options, your recommendation, one-off and monthly cost, effort, how reversible it is, what to do THIS MONTH, what to do at 3 / 6 / 12 months, and the trigger (metric or event) that should make us revisit it.
4. List the questions only the founder can answer (money, risk appetite, personal presence in a country), each with the default you would choose if the founder does not answer.
5. For each decision that a changed fact affects, state the new decision in one sentence.
Keep facts and recommendations visibly separate. Do not repeat the original report; only correct, extend and decide.
```

---

## R9 — first customer: real needs of multi-branch retail and F&B in Malaysia

### Stage 1

```
CONTEXT
We are a very early-stage startup (one founder, one engineer, and AI coding agents working in parallel "lanes" through GitHub PRs with automated cross-model review). Budget is very tight. We build "Roxira", an experimental AI-first business platform:
- SMB suite: double-entry accounting, invoicing and e-invoicing, POS, inventory (FIFO, BOM/production), purchasing, treasury (bank, cash, cheques, reconciliation), payroll/HR/attendance, tax filings, CRM, reports, data import, multi-branch.
- In-app AI assistant over the user's own data (read-only tools, numeric grounding, citations to source records).
- AI legal-research assistant (RAG over statutes and rulings, auto-updated, source tiers, abstention).
- AI phone agent (SIP/LiveKit, streaming STT + LLM + TTS).
Stack: NestJS, Next.js 16 / React 19 / Tailwind v4, PostgreSQL behind PgBouncer with tenant_id + row-level security, Redis + BullMQ, Qdrant, Python FastAPI, LiteLLM gateway, Docker Compose on rented VPS, GitHub Actions + merge queue.
Decisions already taken (from a first research round): first market is Malaysia, segment = multi-branch retail, food & beverage and small trading/production businesses with 2-10 branches; Germany is phase 2; the current Persian (RTL, Jalali) locale stays as the default pack; country packs with effective-dated config; dual-amount multi-currency ledger; 7 job hubs + command bar; plan entitlements with usage packs for AI phone minutes and OCR pages; customer data only on paid no-training LLM tiers; sell first through a merchant of record, then a Malaysian Sdn Bhd with local payment gateways.
Rules for your answer: cite primary sources (official sites, regulators, vendor pricing pages, laws) with publication or last-updated dates; flag anything older than 12 months; separate FACTS from RECOMMENDATIONS; give prices in the original currency plus USD; say clearly when evidence is missing instead of guessing.

TASK R9 — Deep field requirements for multi-branch retail and food & beverage businesses (2-10 branches) in Malaysia, so we build exactly what they need first.
1. Daily workflows per role (owner, branch manager, cashier, kitchen, warehouse, bookkeeper/external accountant): what they do every day, week and month; where current tools fail. Use reviews (Google Play/App Store, G2, Capterra, local forums, Facebook groups, Lowyat), vendor case studies and help-centre articles.
2. POS ecosystem: receipt printers, kitchen printers and kitchen display systems, cash drawers, barcode scanners, label printers, scales, customer displays; which models are common in Malaysia; how web/PWA POS systems talk to them (WebUSB, Web Bluetooth, local print bridge, Android apps); offline mode expectations.
3. Payments at the counter: DuitNow QR, e-wallets (Touch 'n Go, GrabPay, Boost, ShopeePay), card terminals; which terminals/acquirers offer integration APIs for a small POS vendor; costs.
4. Delivery and marketplaces: GrabFood, foodpanda, ShopeeFood, Shopee, Lazada, TikTok Shop — order and menu sync APIs, partner requirements, fees.
5. Languages and culture: Malay, English and Chinese (Mandarin / Simplified) in UI, receipts and phone; halal-related data needs; public-holiday and multi-calendar needs; typical working hours and shift patterns.
6. F&B and retail specifics: recipes/BOM with yield and wastage, central kitchen transfers, modifiers and combos, table/queue management, loyalty and vouchers, stock counts, consignment, multiple price lists per branch, staff meals.
7. Payroll/attendance specifics for shift workers: part-timers, foreign workers, overtime rules under the Employment Act, biometric clock-in and its PDPA implications.
8. Competitor teardown: StoreHub, Eats365, Xilnex, Qashier, Loyverse, Slurp!, iChef, FeedMe, Bukku, Financio, SQL Account — features, pricing, integrations, what users complain about.
9. A customer discovery plan: interview script (15 questions), how to find 20 interviewees cheaply, what a paid pilot offer should look like, and success criteria for the pilot.
OUTPUT: prioritised requirement list (must-have for a pilot / needed within 6 months / later) with evidence; hardware compatibility matrix; integration list with API availability and cost; competitor gap table; the interview kit and pilot plan.
```

### Stage 2 (same chat, after the report)

```
STAGE 2 — Act now as a skeptical senior reviewer of the report you just wrote.
1. Re-check every number, date, price, threshold and legal claim in your report against a primary source. Output a table: claim | source URL | source date | VERIFIED / CHANGED (give the correct value) / UNVERIFIABLE.
2. List what the report missed that a small startup in our position would regret in 12-24 months (at least 10 items), each with why it matters.
3. Turn the report into a DECISION PACK. For each decision: options, your recommendation, one-off and monthly cost, effort, how reversible it is, what to do THIS MONTH, what to do at 3 / 6 / 12 months, and the trigger (metric or event) that should make us revisit it.
4. List the questions only the founder can answer (money, risk appetite, personal presence in a country), each with the default you would choose if the founder does not answer.
5. Mark which must-have requirements a web/PWA POS cannot meet without a native app or local bridge, and recommend the cheapest reliable approach.
Keep facts and recommendations visibly separate. Do not repeat the original report; only correct, extend and decide.
```

---

## R10 — our own business: subscription billing, financial model, funding and company setup

### Stage 1

```
CONTEXT
We are a very early-stage startup (one founder, one engineer, and AI coding agents working in parallel "lanes" through GitHub PRs with automated cross-model review). Budget is very tight. We build "Roxira", an experimental AI-first business platform:
- SMB suite: double-entry accounting, invoicing and e-invoicing, POS, inventory (FIFO, BOM/production), purchasing, treasury (bank, cash, cheques, reconciliation), payroll/HR/attendance, tax filings, CRM, reports, data import, multi-branch.
- In-app AI assistant over the user's own data (read-only tools, numeric grounding, citations to source records).
- AI legal-research assistant (RAG over statutes and rulings, auto-updated, source tiers, abstention).
- AI phone agent (SIP/LiveKit, streaming STT + LLM + TTS).
Stack: NestJS, Next.js 16 / React 19 / Tailwind v4, PostgreSQL behind PgBouncer with tenant_id + row-level security, Redis + BullMQ, Qdrant, Python FastAPI, LiteLLM gateway, Docker Compose on rented VPS, GitHub Actions + merge queue.
Decisions already taken (from a first research round): first market is Malaysia, segment = multi-branch retail, food & beverage and small trading/production businesses with 2-10 branches; Germany is phase 2; the current Persian (RTL, Jalali) locale stays as the default pack; country packs with effective-dated config; dual-amount multi-currency ledger; 7 job hubs + command bar; plan entitlements with usage packs for AI phone minutes and OCR pages; customer data only on paid no-training LLM tiers; sell first through a merchant of record, then a Malaysian Sdn Bhd with local payment gateways.
Rules for your answer: cite primary sources (official sites, regulators, vendor pricing pages, laws) with publication or last-updated dates; flag anything older than 12 months; separate FACTS from RECOMMENDATIONS; give prices in the original currency plus USD; say clearly when evidence is missing instead of guessing.

TASK R10 — Run our own startup correctly: revenue operations, a financial model, funding and company setup, for selling SaaS in Malaysia first.
1. Subscription billing and metering for our own customers: compare Paddle Billing, Stripe Billing, Chargebee, Lago (open source), OpenMeter, Kill Bill, and building on our own BullMQ jobs — plans with included usage, add-on packs (AI phone minutes, OCR pages, extra branches), proration, annual prepay discounts, dunning, invoices that satisfy Malaysian rules (and MyInvois when it applies to us), refunds, revenue recognition basics. Costs and lock-in.
2. Unit economics: a template for cost per tenant (hosting, LLM, voice minutes, SMS/WhatsApp, payment fees, support time) and gross margin per plan; typical SaaS benchmarks for SMB software (CAC payback, churn, expansion) from credible sources.
3. A 24-month financial model structure: assumptions list, monthly cash flow, runway, break-even; what to measure from day one.
4. Funding options in Malaysia and ASEAN for an AI SaaS startup in 2026: government grants and programmes (MDEC, Malaysia Digital status, Cradle, MRANTI, SME Corp, others), accelerators, angel networks, venture firms active at pre-seed; eligibility (local shareholding, local directors), amounts, timelines, obligations.
5. Company setup execution: step-by-step for a Sdn Bhd with foreign founders (or a Singapore holding + Malaysian subsidiary), visa/work-pass options for founders (e.g. Malaysia Tech Entrepreneur Programme), bank accounts, accounting/secretarial providers and their prices, annual compliance calendar.
6. Protecting the business: trademark search and registration for the name "Roxira" in Malaysia (MyIPO), the EU (EUIPO) and international (Madrid), domain names; professional indemnity and cyber insurance for a B2B SaaS handling financial data; founder agreements and IP assignment for code written by contractors and AI tools.
7. Keeping our own books: what we must file, when, and which tools; can we dog-food our own product for this.
OUTPUT: billing stack recommendation with a migration path; a unit-economics table per plan; the financial-model outline; a funding shortlist with deadlines; a company-setup checklist with costs and timeline; a protection checklist; a 12-month compliance calendar.
```

### Stage 2 (same chat, after the report)

```
STAGE 2 — Act now as a skeptical senior reviewer of the report you just wrote.
1. Re-check every number, date, price, threshold and legal claim in your report against a primary source. Output a table: claim | source URL | source date | VERIFIED / CHANGED (give the correct value) / UNVERIFIABLE.
2. List what the report missed that a small startup in our position would regret in 12-24 months (at least 10 items), each with why it matters.
3. Turn the report into a DECISION PACK. For each decision: options, your recommendation, one-off and monthly cost, effort, how reversible it is, what to do THIS MONTH, what to do at 3 / 6 / 12 months, and the trigger (metric or event) that should make us revisit it.
4. List the questions only the founder can answer (money, risk appetite, personal presence in a country), each with the default you would choose if the founder does not answer.
5. Give the cheapest sequence that keeps us legal from the first paying pilot, with the month each step must happen.
Keep facts and recommendations visibly separate. Do not repeat the original report; only correct, extend and decide.
```

---

## R11 — growth and customer operations: channels, support, website, accountant partners

### Stage 1

```
CONTEXT
We are a very early-stage startup (one founder, one engineer, and AI coding agents working in parallel "lanes" through GitHub PRs with automated cross-model review). Budget is very tight. We build "Roxira", an experimental AI-first business platform:
- SMB suite: double-entry accounting, invoicing and e-invoicing, POS, inventory (FIFO, BOM/production), purchasing, treasury (bank, cash, cheques, reconciliation), payroll/HR/attendance, tax filings, CRM, reports, data import, multi-branch.
- In-app AI assistant over the user's own data (read-only tools, numeric grounding, citations to source records).
- AI legal-research assistant (RAG over statutes and rulings, auto-updated, source tiers, abstention).
- AI phone agent (SIP/LiveKit, streaming STT + LLM + TTS).
Stack: NestJS, Next.js 16 / React 19 / Tailwind v4, PostgreSQL behind PgBouncer with tenant_id + row-level security, Redis + BullMQ, Qdrant, Python FastAPI, LiteLLM gateway, Docker Compose on rented VPS, GitHub Actions + merge queue.
Decisions already taken (from a first research round): first market is Malaysia, segment = multi-branch retail, food & beverage and small trading/production businesses with 2-10 branches; Germany is phase 2; the current Persian (RTL, Jalali) locale stays as the default pack; country packs with effective-dated config; dual-amount multi-currency ledger; 7 job hubs + command bar; plan entitlements with usage packs for AI phone minutes and OCR pages; customer data only on paid no-training LLM tiers; sell first through a merchant of record, then a Malaysian Sdn Bhd with local payment gateways.
Rules for your answer: cite primary sources (official sites, regulators, vendor pricing pages, laws) with publication or last-updated dates; flag anything older than 12 months; separate FACTS from RECOMMENDATIONS; give prices in the original currency plus USD; say clearly when evidence is missing instead of guessing.

TASK R11 — Growth and customer operations for a tiny team selling to SMBs in Malaysia (later Germany).
1. Messaging channels as product features and as our own channels: WhatsApp Business Platform (current per-message/conversation pricing in Malaysia, template rules, policy on AI agents and on sending reports/invoices, Business Solution Providers vs Cloud API direct), Telegram bots, SMS providers in Malaysia (prices, sender ID rules), email deliverability (SPF/DKIM/DMARC, providers and prices). What competitors already send through these channels.
2. Website and acquisition: multilingual marketing site (Malay, English, Chinese) and SEO for "accounting software Malaysia", "POS system Malaysia" style queries; comparison pages; free tools (e-invoice checkers, payroll calculators) as lead magnets; paid ads benchmarks (CPC) for these keywords; review sites (G2, Capterra, Google reviews) strategy.
3. Accountant and bookkeeper partner programme: how Xero, QuickBooks, Bukku and Financio run partner tiers in Malaysia; what a small vendor can offer (multi-client console, revenue share, free seats, certification course); how to recruit the first 10 partners.
4. Support and customer success with AI: helpdesk options (open source and paid: Chatwoot, Zammad, Freshdesk, Zendesk, Intercom), AI-first support with human escalation, knowledge base in three languages, support hours expectations for POS (weekends), SLA wording; costs.
5. Onboarding and migration at scale: data import from StoreHub, AutoCount, SQL Account, UBS, Bukku, Xero, Excel; what exports those tools provide; how competitors run "free migration" offers; time and cost per migration.
6. Community and trust: user groups, webinars, case studies, public roadmap and status page, security page; what actually moved SMB buyers in published case studies.
7. Metrics: activation, weekly active companies, trial-to-paid, churn reasons; tools that keep customer data private (self-hosted analytics).
OUTPUT: a 6-month growth plan with weekly hours for a 2-person team plus AI agents; channel cost table; partner programme design; support stack choice; migration playbook per source system; the metrics dashboard definition.
```

### Stage 2 (same chat, after the report)

```
STAGE 2 — Act now as a skeptical senior reviewer of the report you just wrote.
1. Re-check every number, date, price, threshold and legal claim in your report against a primary source. Output a table: claim | source URL | source date | VERIFIED / CHANGED (give the correct value) / UNVERIFIABLE.
2. List what the report missed that a small startup in our position would regret in 12-24 months (at least 10 items), each with why it matters.
3. Turn the report into a DECISION PACK. For each decision: options, your recommendation, one-off and monthly cost, effort, how reversible it is, what to do THIS MONTH, what to do at 3 / 6 / 12 months, and the trigger (metric or event) that should make us revisit it.
4. List the questions only the founder can answer (money, risk appetite, personal presence in a country), each with the default you would choose if the founder does not answer.
5. Rank the channels by expected paying customers per 10 hours of founder time, and cut everything below the line.
Keep facts and recommendations visibly separate. Do not repeat the original report; only correct, extend and decide.
```

---

## R12 — technical future-proofing: licences, maintenance, an alternative for every service, scale and cost

### Stage 1

```
CONTEXT
We are a very early-stage startup (one founder, one engineer, and AI coding agents working in parallel "lanes" through GitHub PRs with automated cross-model review). Budget is very tight. We build "Roxira", an experimental AI-first business platform:
- SMB suite: double-entry accounting, invoicing and e-invoicing, POS, inventory (FIFO, BOM/production), purchasing, treasury (bank, cash, cheques, reconciliation), payroll/HR/attendance, tax filings, CRM, reports, data import, multi-branch.
- In-app AI assistant over the user's own data (read-only tools, numeric grounding, citations to source records).
- AI legal-research assistant (RAG over statutes and rulings, auto-updated, source tiers, abstention).
- AI phone agent (SIP/LiveKit, streaming STT + LLM + TTS).
Stack: NestJS, Next.js 16 / React 19 / Tailwind v4, PostgreSQL behind PgBouncer with tenant_id + row-level security, Redis + BullMQ, Qdrant, Python FastAPI, LiteLLM gateway, Docker Compose on rented VPS, GitHub Actions + merge queue.
Decisions already taken (from a first research round): first market is Malaysia, segment = multi-branch retail, food & beverage and small trading/production businesses with 2-10 branches; Germany is phase 2; the current Persian (RTL, Jalali) locale stays as the default pack; country packs with effective-dated config; dual-amount multi-currency ledger; 7 job hubs + command bar; plan entitlements with usage packs for AI phone minutes and OCR pages; customer data only on paid no-training LLM tiers; sell first through a merchant of record, then a Malaysian Sdn Bhd with local payment gateways.
Rules for your answer: cite primary sources (official sites, regulators, vendor pricing pages, laws) with publication or last-updated dates; flag anything older than 12 months; separate FACTS from RECOMMENDATIONS; give prices in the original currency plus USD; say clearly when evidence is missing instead of guessing.

TASK R12 — Technical future-proofing review: make sure today's choices stay cheap, legal and replaceable for 3-5 years.
1. Open-source licence compliance for a commercial SaaS: risks of AGPL/SSPL/BSL/Elastic/fair-code components (e.g. MinIO, Documenso, n8n, Redis 7.4+ licence change and Valkey, Qdrant, LiveKit, Grafana stack), what obligations apply when hosted, and safe alternatives. How to run an automated licence audit in CI (tools, policies).
2. Dependency lifecycle: support windows and upgrade cadence for Node.js, NestJS, Next.js, React, PostgreSQL, PgBouncer, Python, Redis/Valkey; a policy for staying current with AI coding agents doing upgrades safely.
3. AI model churn: how fast providers deprecate models, how to pin and test model versions, an eval-gated model switch process, keeping prompts portable across providers, local/open-weight fallbacks that run on a small VPS or a cheap GPU.
4. Vendor exit plan: for each external dependency (LLM providers, STT/TTS, LiveKit, VPS host, DNS/CDN, email/SMS/WhatsApp, payment providers, merchant of record, GitHub), the switching cost, data export path, and a tested fallback.
5. Scale and cost: realistic load and cost per tenant at 100 / 1,000 / 10,000 tenants on our stack; where PostgreSQL + RLS + PgBouncer hits limits; read replicas, partitioning, archiving; load-testing tools and a test plan.
6. Offline-first POS architecture: local storage, sync with conflict rules, idempotency, device identity and security, printing; libraries and proven designs.
7. Data platform for later: event/analytics store, reporting on large tenants, customer data export, backups and restore drills, data residency per country (separate stacks or one?).
8. Security operations for a tiny team: affordable pentest and bug-bounty options in Malaysia/ASEAN, incident-response retainer, secrets rotation, audit logging that satisfies accountants and regulators.
OUTPUT: a risk register (component | risk | likelihood | impact | mitigation | owner | review date); licence policy; upgrade policy; model-switch process; vendor-exit table; scale plan with thresholds that trigger each change; offline POS reference design.
```

### Stage 2 (same chat, after the report)

```
STAGE 2 — Act now as a skeptical senior reviewer of the report you just wrote.
1. Re-check every number, date, price, threshold and legal claim in your report against a primary source. Output a table: claim | source URL | source date | VERIFIED / CHANGED (give the correct value) / UNVERIFIABLE.
2. List what the report missed that a small startup in our position would regret in 12-24 months (at least 10 items), each with why it matters.
3. Turn the report into a DECISION PACK. For each decision: options, your recommendation, one-off and monthly cost, effort, how reversible it is, what to do THIS MONTH, what to do at 3 / 6 / 12 months, and the trigger (metric or event) that should make us revisit it.
4. List the questions only the founder can answer (money, risk appetite, personal presence in a country), each with the default you would choose if the founder does not answer.
5. Mark the three choices in our current stack you would change now, before customers arrive, and why.
Keep facts and recommendations visibly separate. Do not repeat the original report; only correct, extend and decide.
```
