# Product reset — 2026-11-15

Owner request (2026-11-15): review the whole suite for clarity, standards, beauty and future-readiness; simplify; make AI the main way people use it; answer whether customers in Germany or Malaysia can run their books on Roxira.

This document is the hub's answer, grounded in a read-only audit of `main` at `36e27f18`. It feeds WAVE 13+ on #592. It does not replace `ADR_GLOBAL_CORE.md` (country packs) or `LEGAL_CORE_2026-11-13.md`; it orders the work.

## 1. Findings

### 1.1 Navigation and UI
- `frontend/src/lib/nav-menu.ts` has 10 groups and 36 items. There are 51 pages under `/app`, and many are reachable only by URL.
- The same job appears in several places:
  - **Reports:** `/app/reports`, `/app/accounting/reports`, `/app/accounting/report-builder` and two dashboards.
  - **Cash and petty cash:** 4 pages, including `/app/treasury` (724 lines), which is not in the nav. Bank accounts are listed under Treasury but live at an `/app/accounting/…` URL.
  - **Settings:** `settings/members` overlaps `settings/access`, and `settings/modules` overlaps `admin/entitlements`.
  - **Legacy pages:** `/accounting`, `/inventory`, `/crm`, `/hr` and `/invoicing` are pre-shell pages with the marketing header.
- The "خرید و هزینه‌ها" group is empty, so it is hidden, yet purchasing is half of a business.
- The damages calculator (a legal tool) sits under Inventory and opens outside the app shell.
- Bugs the owner saw:
  - `/app/settings/posting-rules` returns 404. The client calls `/posting-rules`, but the controller is `enterprise-hub/posting-rules`.
  - The damages form shows the raw `CPI_INDEX` value because the Select has no `items` prop, and it uses native Gregorian date inputs although `JalaliDateInput` exists and is used in 17 places.
  - "ورود از اکسل" accepts CSV, Excel, PDF, images, SQL dumps and ZIP, so the name is wrong.
- Design system:
  - `DESIGN.md` says to use semantic tokens only, but 2,457 raw palette classes appear across 187 files.
  - There are two competing empty-state components, plus about 30 inline variants.
- i18n: none. 278 of 319 `.tsx` files contain hard-coded Persian, and 73 files hard-code `dir="rtl"`.

### 1.2 AI assistant
- An "ask your business" assistant already exists (`modules/assistant`):
  - 10 read-only hand-written tools and about 27 certified metrics;
  - a numeric validator that rejects any number without evidence;
  - tenant taken from the JWT only, and per-tool permission re-checks.
  It is gated by `ASSISTANT_ENABLED`.
- It cannot answer the owner's example questions yet:
  - **Profit for a day or month:** only YTD metrics are exposed, even though the income-statement service accepts any range.
  - **Profit by branch:** not possible. Invoices and journal lines have no branch, and stores only link warehouses.
  - **Who came to work today at branch X:** not possible. Attendance is stored as monthly totals, there are no clock-in events, employees have no branch, and there are no HR tools.
- Safety gaps:
  - Branch scope (`requireScopedAction`) is defined but never called.
  - Cost and salary masking applies to JSON, not prose.
  - There is no audit log of prompts, tool calls, models or cost.
- The Nest assistant calls OpenRouter with one key. It ignores the LiteLLM key pool (`config/key_pool.yaml`) and the Redis cache that the Python side already has.

### 1.3 Platform
- **RLS is bypassed in production.** Migrations and `TenantScope` exist, but prod connects as `enterprise_admin`, which has BYPASSRLS, unless `APP_DB_USER` is set (`docs/ops/APP_DB_ROLE.md`). Tenant isolation is therefore only as good as each repository filter. This is the top platform risk.
- There is no transactional outbox: events go straight to BullMQ.
- There is no AI cost or usage telemetry on the Nest side.

### 1.4 Multi-country
- The seam is already designed: `modules/country_packs` defines the interface (locale, calendars, chart templates, tax, `EInvoiceAdapter`, `PayrollRulesAdapter`), backed by a registry and an IR pack. Nothing in production reads it yet.
- Iran is hard-coded in many places:
  - the statutory service (`IRAN`), the VAT resolver, and Moadian called directly from invoicing;
  - `'IRR'` defaults, a currency enum without MYR, no dated FX table, and no per-tenant book currency;
  - `Asia/Tehran` in about 10 services, and Jalali helpers duplicated in about 40 files;
  - the Iranian chart template and account levels only.
- The tenant record has `country_code` but no locale, time zone, base currency or calendar.
- **Answer today:** a German or Malaysian company cannot keep compliant books on Roxira. Malaysia is reachable in phases; Germany is a much larger certification job (see §4).

## 2. Principles
1. **Jobs, not modules.** The menu follows what an owner does (sell, buy, get paid, pay, pay people, file taxes, see how it's going), not how the code is split.
2. **Ask first, click second.** The assistant and the command palette (Ctrl K) are the front door, and every answer links to the page that proves it. Menus stay for people who browse.
3. **Show only what the business uses.** Onboarding asks about the business type (shop, services, contractor, multi-branch), turns modules on, and hides the rest.
4. **One place per job.** One reports hub, one money hub, one settings page with tabs, and no legacy pages.
5. **Every number is traceable.** This holds for both the UI and the assistant: drill down from a number to the voucher.
6. **Country is data, not code.** Everything Iranian moves behind the IR country pack before any second country.
7. **Security before features.** Fix RLS and audit AI usage before the assistant gets write tools.

## 3. Target information architecture (36 items → 8 hubs)

| Hub | Contains (today's pages) |
|---|---|
| خانه | dashboard, assistant (chat box on the home page), tasks/alerts ("3 cheques due this week") |
| فروش | invoices, POS, customers (CRM), quotes |
| خرید و هزینه | bills, suppliers, expenses, receipt bot (today scattered or missing) |
| کالا و انبار | items, warehouses, production/BOM, stock documents |
| پول | bank accounts, reconciliation, cash boxes, petty cash, cheques, damages calculator — one hub with tabs |
| حسابداری | vouchers, chart of accounts, fiscal years, recurring vouchers, fixed assets, dimensions, contracting |
| کارکنان | employees, attendance, payroll, insurance/tax |
| مالیات | Moadian, e-books, kartable reconciliation |
| گزارش‌ها | one hub: standard reports, report builder, consolidated, cost centres, budget vs actual |
| تنظیمات | one page with tabs: members and access, modules, posting rules, policies, integrations, audit, security |

"ورود اطلاعات" (import) becomes an action on every hub's empty state and in Ctrl K; it is not a menu item. Legacy pre-shell pages redirect to `/app/...`.

## 4. Roadmap

### Phase 0 — now (in flight)
- The UI quick-fix PR covers posting-rules, damages labels, Jalali dates, putting damages inside the app shell, and renaming import.
- Rulings delta loop (#823).

### Phase 1 — trust (2–3 weeks)
1. **RLS for real.** Production uses `APP_DB_USER` (no BYPASSRLS). Run a staging soak with the RLS e2e suite. The production switch needs an owner-approved runbook.
2. **AI audit log.** A table `ai_interactions` (tenant, user, question hash, tools and arguments, model, tokens, cost, latency, verdict), with RLS and a retention policy.
3. **Assistant through the key pool.** The Nest assistant calls the LiteLLM gateway (`key_pool.yaml`): free tiers first, rotation across all pooled keys, budgets per tenant. Add a Redis cache for deterministic tool-summary calls.
4. **Enforce branch scope and field visibility in assistant tools** (`requireScopedAction`, `requireFieldVisibility` before any value reaches prose).

### Phase 2 — simplify (3–4 weeks, can run in parallel with Phase 1)
1. New nav (§3), with redirects from old routes and the command palette indexing every page and action.
2. Business-type onboarding drives which modules are visible.
3. One `EmptyState` component (one action, an import link and a "load sample data" option), plus a lint rule banning raw palette classes outside `components/ui`.
4. Home page: KPI tiles, an alerts list, and the assistant input.
5. Delete the legacy pre-shell pages and the dead components.

### Phase 3 — answer anything (4–6 weeks)
1. **Branch dimension.** Add `branch_id` to invoices, POS sales, journal lines, employees and stores. This needs migrations through reviewed PRs and a tenant column on every new table.
2. **Daily attendance.** Clock-in/out events per employee and branch (manual, POS PIN, or device import), rolled up into the existing monthly totals.
3. **New assistant tools:**
   - `profit(period, branch?)` built on the income-statement service;
   - `sales(period, branch?)`;
   - `attendance(day, branch?)`;
   - `cash_position()`;
   - `due_cheques(range)`.
   Each comes with golden questions in Persian and an eval in CI.
4. **Write actions as proposals.** The assistant drafts (for example "record an expense"), and the user confirms on the real form. Writes are idempotent and audited.
5. **Voice.** The phone agent's turn-taking stack (`services/voice_phone_agent`) can call the same assistant tools for business owners.

### Phase 4 — global core (start when Phases 1–2 are done)
1. Wire `CountryPackRegistry.resolve(tenant.country_code)` into the request context. Add locale, time zone, base currency and calendar to the tenant (defaults from the pack, overridable per tenant).
2. Ledger: per-tenant book currency ("base amount" instead of Rial), ISO currency data, and a dated FX rate table.
3. Statutory service, VAT resolver and Moadian move behind the pack interfaces, with Moadian as the IR `EInvoiceAdapter`. Replace the hard-coded `Asia/Tehran` and the duplicated Jalali helpers with `CalendarService`.
4. Frontend i18n: next-intl with message catalogues, logical CSS (`ms-`/`me-`) instead of `dir="rtl"`, and `Intl` formatting by tenant locale.
5. **Malaysia pack first:**
   - English; SST; the MyInvois e-invoice adapter (JSON API);
   - MFRS-style chart template;
   - payroll for EPF, SOCSO, EIS and PCB.
6. **Germany later, mostly by integration:**
   - SKR03/SKR04 templates, USt, XRechnung/ZUGFeRD;
   - DATEV export, so the customer's Steuerberater does the filings;
   - GoBD procedural documentation and immutable audit trail.
   Payroll stays out of scope. German payroll software needs ITSG certification, so integrate with a partner instead.
7. **Before selling outside Iran:** a legal check on sanctions exposure, payment processors, data residency (GDPR, Malaysia's PDPA) and the operating entity. This is the owner's decision and needs the deep research below.

## 5. What the owner can provide
- **Keys:** more keys help only after Phase 1.3 routes the assistant through the pool. Today the business assistant uses a single OpenRouter key. After 1.3, add keys to `~/Secrets/roxira/roxira.env` with `add_secret.sh`. The pool rotates them, and free tiers come first.
- **Decisions:**
  - the RLS production switch window;
  - the business types to offer at onboarding;
  - whether to open MY or DE at all;
  - the legal entity for foreign sales.
- **Research:** run the deep-research prompt below and paste the result back on #592.

## 6. Deep-research prompt (for the owner to run)

> I am building an AI-first SMB business suite (accounting, invoicing/e-invoicing, inventory, POS, payroll/HR, tax) currently for Iran (Persian, Jalali calendar, Moadian e-invoicing). I want (1) a next-generation, minimal, AI-first product design and (2) a realistic plan to serve SMBs in Malaysia and Germany. Research and cite primary sources (official government sites, vendor docs) with dates; flag anything older than 12 months.
>
> Part A — product and UX benchmarks: How do Xero (incl. JAX), QuickBooks Online (Intuit Assist), Zoho Books, Odoo 18+, Holded, sevDesk, lexoffice, Bukku, SQL Account and Financio structure navigation (number of top-level items, hubs vs modules), onboarding by business type, empty states, command palettes, and AI assistants (what questions they answer, how they show evidence, how write actions are confirmed, pricing of AI features)? What do usability studies and churn data say about menu size and progressive disclosure in SMB software? Give 10 concrete design patterns worth copying and 5 anti-patterns.
>
> Part B — Malaysia: exact current requirements and timelines for MyInvois e-invoicing (phases, API vs portal, certification or registration of software vendors, consolidated e-invoice rules), SST (rates, filing, registration thresholds), MFRS/MPERS for SMEs, payroll statutory (EPF, SOCSO, EIS, PCB/MTD, HRDF) and any software approval needed, data protection (PDPA 2024 amendments, cross-border transfer), and local competitors' pricing.
>
> Part C — Germany: GoBD obligations for software vendors and users (procedural documentation, immutability, retention, IDW PS 880 audits), e-invoicing mandate timeline 2025–2028 (XRechnung, ZUGFeRD 2.x, receiving vs sending), DATEV export formats and partner program, SKR03/SKR04, USt-Voranmeldung via ELSTER/ERiC (certification needed?), KassenSichV/TSE for POS, payroll software certification (ITSG) and whether integrating a partner is the norm, GDPR hosting expectations, and local competitors' pricing.
>
> Part D — legal and commercial feasibility for a company with Iranian founders/developers: EU and Malaysian sanctions and export-control exposure for selling SaaS, using cloud hosting (Hetzner, AWS) and payment processors (Stripe, Adyen, local gateways), typical structures (separate EU/MY entity, reseller partners), and banking. Be precise about what is prohibited vs merely difficult; do not give legal advice, summarize the rules and name the regulators.
>
> Output: an executive summary (10 bullets), then one section per part, then a phased go/no-go recommendation for MY and DE with effort estimates and the top 5 risks.
