# Deep research — round 1 (R1–R7, 2026-11-15)

The prompts the owner ran on 2026-11-15, kept here because the laptop Desktop copy was erased (laptop handoff, docs/ops/LAPTOP_HANDOFF_2026-11-18.md). Results are digested in `research/R1_PRODUCT_UX.md`, `research/R2_R3_INFRA_ASSISTANT.md`, `research/R4_COUNTRY_PACKS.md` and `research/R5_R6_R7_GTM_LEGAL_PORTFOLIO.md`; coverage is tracked in `STRATEGY_COVERAGE.md`.

How they were run: each prompt in its own Deep Research chat, with the context block first. Suggested order: R3 → R7 → R2 → R1 → R4 → R5 → R6. Round 1 had no stage 2; the two-stage format (research, then self-review) started in round 2 (`DEEP_RESEARCH_ROUND2.md`).

---

## Context block (put it before every prompt)

```
CONTEXT
We are a small team building an experimental, AI-first business software platform ("Roxira") through rapid trial and error. Components:
- Business suite for small and medium businesses: accounting (double-entry ledger, chart of accounts, fiscal years, fixed assets, cost centres), invoicing and e-invoicing, POS, inventory (FIFO, BOM/production), purchasing, treasury (bank, cash, cheques, reconciliation), payroll/HR/attendance, tax filings, CRM, reports and a report builder, data import (CSV/Excel/PDF/images/SQL dumps), multi-branch stores.
- An in-app AI assistant that answers questions about the user's own business data through read-only tools with numeric grounding.
- An AI legal-research assistant (RAG over statutes and court rulings in a vector DB, auto-updated).
- An AI phone agent (SIP/LiveKit, speech-to-text + LLM + text-to-speech) that answers callers.
Current state: first locale is Persian (RTL, Jalali calendar); we want to become multi-country (first candidates: Malaysia, Germany) and multi-language.
Stack today: NestJS (TypeScript) backend, Next.js 16 / React 19 / Tailwind v4 / shadcn frontend, PostgreSQL behind PgBouncer with tenant_id on every table and row-level security, Redis + BullMQ, Qdrant vector DB, Python FastAPI services, a LiteLLM gateway with pooled API keys, Docker Compose on rented VPS servers, nginx, GitHub (Actions CI, PR-only workflow, merge queue). Development is done mostly by AI coding agents working in parallel "lanes", coordinated through GitHub issues, with cross-model automated code review.
Constraints: very cost-sensitive (free and cheap LLM tiers first: Gemini, OpenRouter free models, Groq, Mistral, with key rotation where provider terms allow); every component must have a tested fallback; secrets never in code; database migrations only via reviewed PRs.
Please cite primary sources (official docs, regulators, vendor documentation) with publication dates, flag anything older than 12 months, and separate facts from your recommendations.
```

---

## R1 — Product, UX and next-generation design

```
TASK 1 — Product and UX design for a next-generation, minimal, AI-first SMB suite.

1. Benchmark how the leading SMB suites structure their product today: Xero (incl. its AI agent), QuickBooks Online (Intuit Assist), Zoho Books/Zoho One, Odoo 18/19, FreshBooks, Wave, Holded, sevDesk, lexoffice, Bukku, Financio, SQL Account, Sage Business Cloud, NetSuite (for contrast). For each: number of top-level navigation items, hub-vs-module organisation, onboarding (does it ask business type and hide modules?), empty states, command palette, mobile app scope, how AI is surfaced.
2. Information architecture: what does research (Nielsen Norman Group, Baymard, published case studies, churn/activation data) say about menu size, progressive disclosure, job-based navigation vs module navigation for SMB owners who are not accountants? Recommend a concrete IA (max top-level items) for a suite with ~50 pages across sales, purchasing, inventory, money, accounting, people, tax, reports, settings.
3. "Ask first, click second": patterns where a chat/command bar is the primary entry point but every AI answer links to the source record. Show real product examples and screenshots descriptions; what failed and why.
4. Design systems: recommended token architecture, component library choices for React/Next.js in 2026 (shadcn/base-ui/Radix/React Aria), RTL + LTR from one codebase (logical CSS properties), dark/light themes, data-dense tables, accessibility (WCAG 2.2 AA) — with concrete tooling (lint rules, visual regression testing).
5. Internationalisation: best i18n stack for Next.js App Router in 2026 (next-intl vs alternatives), message extraction from an existing codebase with ~280 files of hard-coded strings, locale-aware number/date/currency formatting, multiple calendars (Gregorian, Jalali, Hijri), AI-assisted translation workflow with human review.
6. Mobile: PWA vs React Native/Expo vs native for an SMB suite (POS, approvals, receipts capture, attendance clock-in).
7. Onboarding and data migration: best practices for importing a business from other software (accounting exports, Excel, scanned documents) with AI extraction and a human review step.
OUTPUT: executive summary (10 bullets); a recommended IA with a list of hubs and what goes in each; 10 patterns to copy and 5 anti-patterns; a design-system and i18n plan with exact libraries and versions; a phased implementation plan (weeks, team of AI coding agents + 1 reviewer) with acceptance criteria per phase; risks.
```

---

## R2 — AI assistant architecture (chat over business data + phone)

```
TASK 2 — Architecture for a safe, cheap, accurate "ask your business" AI assistant (chat + voice), multi-tenant.

Target questions: "How much profit did I make today / this month?", "Profit of branch X last week?", "Did branch X employees come to work today?", "Which cheques are due this week?", "Draft an expense for 2,000,000 for rent" (write action with confirmation).

1. Compare approaches with evidence: tool/function calling over curated endpoints, a semantic/metrics layer (Cube, dbt Semantic Layer, MetricFlow, Malloy), text-to-SQL (with sandboxed read replicas, row-level security), and hybrids. Accuracy benchmarks (BIRD, Spider 2.0, enterprise reports), failure modes, and what production products (Xero JAX, Intuit Assist, Microsoft Copilot for Finance, Ramp, Brex, Pigment) actually use.
2. Numeric grounding and hallucination control: validators that check every number against tool outputs, abstention, citations to source records, confidence display.
3. Multi-tenant safety: tenant isolation for AI tools, branch/role scoping, field-level masking (salaries, costs) in natural-language answers, prompt-injection defence when tools read user-entered text, audit logging (what to store, retention, privacy).
4. Write actions: propose → confirm → execute patterns, idempotency keys, undo, approvals; MCP (Model Context Protocol) servers as the tool layer — current best practice and security guidance.
5. Model strategy on a tight budget: routing across free/cheap tiers (Gemini, Groq, Mistral, OpenRouter free models, DeepSeek, Qwen, local small models), fallbacks, caching (semantic and exact), small-model distillation for tool selection, evaluation harnesses (golden question sets, regression evals in CI), observability (Langfuse, Helicone, OpenTelemetry GenAI conventions), cost per question targets. Include provider terms-of-service on using multiple keys/accounts and data-retention/no-training options per provider.
6. Voice: best 2026 stack for a phone agent in a low-resource language (streaming STT options and accuracy for Persian and Malay/German, turn-taking/endpointing, barge-in, echo, TTS quality/latency), SIP/LiveKit vs alternatives, target latency budget per stage and how leading voice-agent platforms achieve <1.5 s.
7. Multi-language: answering in the user's language when the data is in another; mixed-script handling.
OUTPUT: recommended architecture diagram (described in text), component choices with alternatives and fallbacks, data model for audit/memory, eval plan with metrics and thresholds, cost model (per 1,000 questions) for 3 traffic levels, phased build plan with acceptance tests, top risks.
```

---

## R3 — Infrastructure, security and delivery method

```
TASK 3 — Target infrastructure, security and delivery process for an early-stage, cost-sensitive multi-tenant SaaS that will run in several countries.

1. Hosting: compare Hetzner, OVH, Scaleway, DigitalOcean, AWS/GCP/Azure (incl. Malaysia and Frankfurt regions), Cloudflare for (a) EU data residency (GDPR), (b) Malaysia/ASEAN latency and PDPA, (c) cost at 100 / 1,000 / 10,000 tenants. Single-region vs per-country deployments; when data residency forces separate stacks.
2. Orchestration: Docker Compose vs Kamal vs Nomad vs k3s/Kubernetes vs managed PaaS (Fly.io, Railway, Render) for a team of AI agents + 1 human operator. Zero-downtime deploys, blue/green, database migrations under a merge queue.
3. Database: PostgreSQL multi-tenancy patterns (shared schema + RLS, schema-per-tenant, database-per-tenant, Citus), enforcing RLS with a non-superuser app role behind PgBouncer (transaction pooling caveats with SET/SET LOCAL), backups and point-in-time recovery, read replicas for reporting/AI, managed Postgres options (Neon, Supabase, Crunchy, RDS, Hetzner-managed) and their costs.
4. Eventing and jobs: transactional outbox, BullMQ vs Temporal vs Postgres-based queues (pg-boss, Graphile Worker), idempotency, exactly-once effects for e-invoice submissions.
5. Vector/search: Qdrant vs pgvector vs OpenSearch for legal RAG and in-app search; hybrid search; update pipelines.
6. Observability: OpenTelemetry, Grafana stack vs SigNoz vs Better Stack vs Sentry; SLOs and alerting for a tiny team; LLM telemetry.
7. Security and compliance roadmap: OWASP ASVS level 2, secrets management (Bitwarden Secrets Manager, Infisical, SOPS+age, Vault) for a team using AI coding agents, supply-chain security (dependency pinning, SBOM, signed commits, GitHub Actions hardening, pull_request_target changes), pentest cadence, ISO 27001 / SOC 2 readiness steps and cost, GDPR DPA/sub-processor list, Malaysia PDPA.
8. Delivery process with many AI coding agents: proven patterns for parallel agents (task decomposition, file ownership, merge queues, cross-model review, eval gates, preventing duplicate work), what GitHub features help (rulesets, merge queue, CODEOWNERS, required checks), and cost control.
9. Resilience: every component with a tested fallback (LLM providers, STT/TTS, payment, email/SMS, hosting) — how mature teams test fallbacks (chaos drills, synthetic checks).
OUTPUT: target architecture (text diagram) for now and for 12 months; a decision table (option, cost, effort, risk, recommendation); a migration plan from Docker Compose on VPS step by step with rollback points; security/compliance checklist with order and cost; runbooks list; top 10 risks.
```

---

## R4 — Multi-country accounting (Malaysia, Germany and later markets)

```
TASK 4 — Make the suite usable by businesses in other countries under their own rules, without forking the code ("country packs").

1. Architecture: how Odoo (l10n modules), Xero, Zoho, SAP Business One and Microsoft Business Central structure localisation (chart-of-accounts templates, tax engines, e-invoicing adapters, payroll packs, statutory reports, calendars, fiscal years). Recommend an interface design for a country pack in a TypeScript/NestJS codebase and a multi-currency ledger design (book currency per company, transaction currency, dated FX rates, revaluation).
2. Build vs buy: tax engines (Avalara, Vertex, Fonoa, Stripe Tax, Quaderno), e-invoicing networks (Peppol access points such as Storecove, Pagero, Tradeshift, Banqup), payroll APIs/partners (Deel, Remote, local providers), with prices.
3. Malaysia in detail: MyInvois e-invoicing (phases and dates, API vs portal, consolidated e-invoices, software provider registration or certification, Peppol relation), SST rates/registration/filing, accounting standards for SMEs (MPERS/MFRS), payroll statutory (EPF, SOCSO, EIS, PCB/MTD, HRDF) and any approval for payroll software, record retention, PDPA (2024 amendments, cross-border transfer), local competitors and pricing.
4. Germany in detail: GoBD (procedural documentation, immutability, retention, IDW PS 880 software audits), e-invoicing mandate timeline 2025–2028 (XRechnung, ZUGFeRD/Factur-X, receiving vs sending), DATEV export formats and partner programme, SKR03/SKR04, VAT returns via ELSTER/ERiC (vendor certification?), KassenSichV/TSE for POS, payroll software certification (ITSG/GKV) and whether partnering is the norm, GDPR hosting expectations, competitors and pricing.
5. Rank 5 further markets by ease of entry for an AI-first SMB suite (e.g. UAE, Saudi Arabia, Turkey, UK, Indonesia, Singapore): e-invoicing mandates, language, competition, payment rails.
OUTPUT: country-pack interface (TypeScript-level description), per-country requirement checklists with official links, build-vs-buy table with costs, effort estimates per country (person-weeks with AI agents), recommended order, go/no-go criteria, risks.
```

---

## R5 — Market, pricing and legal structure

```
TASK 5 — Go-to-market and business setup for selling an AI-first SMB suite internationally.

1. Positioning against Xero, QuickBooks, Zoho, Odoo, and local leaders in Malaysia and Germany: what segment is underserved (micro-businesses, multi-branch retail, contractors, accountants managing many clients)?
2. Pricing models in 2026 for SMB SaaS with AI features (per company, per user, usage-based AI credits), with real price points from competitors.
3. Channels: accountant/bookkeeper partner programmes, marketplaces (app stores, Shopify/WooCommerce), bank partnerships; how competitors acquired their first 1,000 customers per country.
4. Company setup: options for a legal entity to sell in the EU and Malaysia (EU GmbH/OÜ/Irish Ltd, Malaysian Sdn Bhd, Labuan, Singapore Pte Ltd as ASEAN hub), banking and payment processors (Stripe, Adyen, Paddle/Lemon Squeezy as merchant of record, local gateways like iPay88, Billplz), invoicing our own customers correctly (VAT OSS, SST on digital services), required policies (terms, DPA, privacy).
5. Trust signals that SMBs and accountants need before switching (certifications, data export guarantees, uptime SLAs, support hours, local language support).
OUTPUT: recommended beachhead segment and country with reasoning, pricing table, channel plan for the first 6 months, entity/payment setup options with costs and timelines, checklist of legal documents, top risks.
```

---

## R6 — AI legal assistant with automatic updates

```
TASK 6 — Best-practice architecture for an AI legal-research assistant whose corpus updates automatically.

1. Ingestion: monitoring official gazettes, court-ruling publications and trusted secondary sources; change detection; parsing PDFs/HTML (OCR, layout models); deduplication and versioning of laws (consolidated text at a date, amendments, repeals).
2. Retrieval: hybrid search (BM25 + dense), embedding models for non-English legal text (bge-m3, multilingual-e5, Cohere, Voyage, Jina), chunking by article/section, reranking, citation formatting, "as of date" queries.
3. Quality: legal RAG evaluation (LegalBench-RAG, CLERC, custom golden sets), hallucination rates of current systems (Stanford RegLab studies on Lexis+ AI, Westlaw AI), abstention, showing source tier (official vs unofficial), human review workflow and SLAs for new rulings.
4. Liability and disclaimers: how commercial legal AI products present answers; regulations on AI legal advice (EU AI Act transparency duties, unauthorised practice of law rules in common jurisdictions).
5. Multi-country: adding Malaysian and German legal sources — official sources, licences, APIs (e.g. EUR-Lex, German federal law portals, Malaysian AGC), copyright on court decisions.
6. Voice access: answering legal questions by phone safely (summaries, citations by SMS/link).
OUTPUT: pipeline architecture (text diagram), tool choices with fallbacks, update cadence and monitoring, eval plan with thresholds, per-country source list with licence notes, phased plan, risks.
```

---

## R7 — Product portfolio, new capabilities and a "zero-hunting" experience

```
TASK 7 — Product portfolio, new capabilities and a "zero-hunting" user experience for an all-in-one business platform (accounting, management, HR and adjacent apps).

Goal: any user — from a shop owner with no accounting knowledge to an accountant managing 50 companies — reaches what they need (an action, a number, a report, a document) in seconds, without browsing menus or hunting across pages.

1. Portfolio: which adjacent platforms and modules should an SMB all-in-one suite add next, ranked by customer demand, revenue potential, retention impact and build effort? Evaluate at least: purchasing/procurement and supplier portal, expense management and corporate cards, payments and payment links, embedded lending/financing, payroll cards/earned-wage access, e-commerce and marketplace sync, bookings/appointments, project and job costing, field service, subscriptions/recurring billing, budgeting and forecasting, BI and dashboards, document management and e-signature, workflow automation (approvals, rules), customer portal, accountant/practice portal (multi-client), team chat/notifications, AI agents that do work (bookkeeping agent, collections agent, payroll agent). Show which ones Xero, QuickBooks, Zoho One, Odoo, Intuit Mailchimp/QuickBooks ecosystem, Square, Shopify, Rippling, Deel, Gusto, Pleo, Ramp, Brex, Qonto, Revolut Business added in 2024–2026 and with what results (adoption, ARPU, churn) where data exists. Include build vs partner vs marketplace/app-store options.
2. Feature depth inside the core: which features users most often miss when switching between accounting/HR products (published switching surveys, G2/Capterra review mining, community forums). Give the top 30 features with evidence.
3. "Zero-hunting" UX: compare and recommend among (a) minimal menu + universal search/command bar, (b) role-based home screens/workspaces (owner, accountant, cashier, HR), (c) an inbox/task-driven model ("things that need you": approvals, overdue invoices, due cheques, anomalies), (d) conversational/AI-first interface with generated reports and charts, (e) adaptive menus that learn usage. What do usability studies, A/B tests and product write-ups show for task completion time, error rates and adoption among non-expert users? What is the best combination and how should it degrade when AI is unavailable?
4. Reports without effort: natural-language report generation, saved views, scheduled reports by email/WhatsApp/Telegram, drill-down from any number to the source document, comparing branches/periods, mobile-friendly report layouts. Which products do this best today and how?
5. Accessibility for everyone: low digital literacy, older users, small screens, voice input/output, right-to-left and left-to-right languages, keyboard-only accountants; concrete design rules and testing methods.
6. Menu and navigation spec: propose a concrete structure (top-level items, second level, what lives in search only), naming guidelines, and how modules appear when a company turns them on/off. Include wireframe-level descriptions of the home screen for 3 roles.
7. Tools and infrastructure to build it: frontend framework and component libraries, search engine for universal search across entities (Meilisearch, Typesense, OpenSearch, Postgres FTS + pgvector), event/notification infrastructure, workflow engine (Temporal, n8n embedded, custom rules), embedded analytics (Metabase, Superset, Cube, Evidence, custom), document/e-signature services, app marketplace/plugin architecture and security, mobile/PWA. Give options with costs, licences and fit for a small team using AI coding agents.
8. Measurement: which product metrics prove the UX works (time-to-first-value, task success, search success rate, AI answer acceptance, weekly active companies), and how to instrument them with privacy.
OUTPUT: executive summary (10 bullets); a ranked portfolio roadmap (next 3, next 6, next 12 months) with reasoning and effort; top 30 core features with evidence; the recommended UX model with a concrete navigation spec and 3 home-screen wireframe descriptions; a tools/infrastructure decision table; a metrics plan; top risks and what to avoid.
```
