# Roxira business portal — honest product-readiness audit

Date: 2026-10-14
Scope: `roxira.ir` (Persian enterprise portal) and `roxira.net` (English B2B hub). Smart Judge pages
(`ghazihoushmand.ir`) are covered only where the requested routes live on that domain.
Method: read-only review of the Next.js routes and their imported components, `src/middleware.ts`,
`src/lib/seo/*`, and the NestJS module/controller/service layer. No production probing, no live API
calls. Everything below is derived from the code in this worktree.

Verdict in one line: the enterprise *back-end* for accounting, inventory, CRM and HR is real and
persists data; the *portal* around it is mostly a sales shell with unbacked pricing, an autonomous
software-foundry product that has no back-end, a simulated Moadian submission, and no client-side
auth gate. It is not sellable as-is.

## 1. Domain and routing (from `src/middleware.ts`)

One Next.js app serves three hostnames. Unknown hosts fall back to the Persian enterprise portal.

| Host | Root behaviour | Notes |
| --- | --- | --- |
| `ghazihoushmand.ir` | `/` rewritten to `/chat` | Smart Judge only. Enterprise paths (`/invoicing`, `/accounting`, `/inventory`, `/crm`, `/docs`, `/hr`, `/radar`, `/admin`) redirect to `roxira.ir`. `/contact` is rewritten to `/support`. |
| `roxira.ir` | Persian enterprise portal | `/chat`, `/judge`, `/guide`, `/draft-ruling`, `/draft-indictment` redirect to `ghazihoushmand.ir`. `/about`, `/services`, `/technology`, `/laws`, `/precedents`, `/coverage`, `/lawyers`, `/support` redirect to `ghazihoushmand.ir`. |
| `roxira.net` | `/` rewritten to `/en` | English B2B hub. `/en` on other domains redirects here. |

Consequence: the pages the brief lists under `services`, `technology`, `about` are **Smart Judge
pages on `ghazihoushmand.ir`**, not Roxira enterprise pages. `plans` is reachable on every host but
its canonical is `ghazihoushmand.ir`.

## 2. Per-page readiness

Legend — READY: real controller + service + persistence + wired front-end. PARTIAL: some real
back-end, but a material gap (simulated external system, no auth gate, unverified data, lost leads).
MARKETING_ONLY: no working back-end behind the claim. Effort to be sellable: S (<1 day), M (days),
L (weeks).

| Route | Domain(s) | What the page claims | Working back-end / API behind it | Data persisted? | Auth required? | Readiness | Missing to be sellable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` (`page.tsx`) | roxira.ir, roxira.net root | "Integrated cloud enterprise OS + autonomous software foundry + Moadian tax compliance"; 6 module cards; 3 pricing tiers (Starter ۲٬۹۰۰٬۰۰۰، Business ۷٬۹۰۰٬۰۰۰، Foundry Developer ۱۴٬۹۰۰٬۰۰۰ تومان/ماه) | Module cards link to real apps. No billing/subscription API; pricing is a hardcoded array in the page. "Autonomous Software Foundry" has **no module** in `enterprise_hub` (sandboxes live in `data/sandboxes/`, outside this app). | No (static page) | No | PARTIAL (Foundry + pricing are MARKETING_ONLY) | S: remove/replace pricing CTAs and Foundry claims; add پیش‌ثبت‌نام. M: build subscription/billing. L: real Foundry product. |
| `/invoicing` | roxira.ir | Issue VAT (9%) e-invoices; 22-digit TaxID; JWS e-sign; **"ارسال به سامانه مودیان و پذیرفته شد"** with reference number | `InvoicingController` + `InvoicingService` (invoice CRUD, server-side 9% tax); `TaxComplianceController` + `TaxComplianceService` (RSA keypair, CSR, JWS RS256, 22-digit TaxID, verify) | Yes (invoices, signing keys, signatures) | Yes — global JWT; the مودیان tab additionally needs `ADMIN` role. No client-side route guard. | PARTIAL | L: real Moadian web-service integration (needs taxpayer credentials + official API). S/M: relabel the simulated submission honestly. M: client auth gate + tenant scoping. |
| `/accounting` | roxira.ir | Double-entry ledger, journal entries, trial balance, account ledger | `AccountingController` + `AccountingService` (balanced-entry enforcement, atomic balances) | Yes | Yes — JWT + `ADMIN`. No client gate. | READY | M: client auth gate + tenant scoping; seed a real chart of accounts + onboarding. |
| `/inventory` | roxira.ir | Multi-warehouse stock, FIFO valuation, low-stock alerts, batches | `InventoryController` + `InventoryService` (inbound/outbound FIFO transactions, valuation) | Yes | Yes — JWT (no role). No client gate. | READY | M: client auth gate + tenant scoping. |
| `/crm` | roxira.ir | Leads, kanban pipeline, contact history, revenue stats | `CrmController` + `CrmService` — **the only enterprise module that derives `tenantId` from the JWT** and scopes every query by it | Yes | Yes — JWT, tenant-scoped. No client gate. | READY | S: client auth gate + tenant onboarding. |
| `/hr` | roxira.ir | Employees, contracts, payroll (base + housing + grocery + child + overtime, 7% insurance, stepped 10/15/20% tax), payslip with auto journal entry | `HrController` + `HrService` (payroll calc, payslip issuance posting to accounting) | Yes | Yes — JWT + `ADMIN`. No client gate. | PARTIAL | M: verify/parameterise the statutory payroll constants against the current year's official values (legal exposure); tenant scoping; client gate. |
| `/damages` | roxira.ir | Late-payment damages on the Central Bank index (Civil Procedure Art. 522) or contract rate; history; bulk (queued) | `DamagesController` + `DamagesService` (calc + persist, BullMQ bulk) | Yes | Yes — JWT (no role). No client gate. | PARTIAL | M: verify the index source and the Art. 522 formula with a lawyer; tenant scoping. |
| `/services` | ghazihoushmand.ir | Free vs VIP plan; VIP "انشای لوایح", "اجرای مستقیم چک صیادی (ماده ۲۳)", "پشتیبانی اختصاصی ۲۴ ساعته"; enamad code ۷۴۹۱۴۳۹; coverage = N laws | Judge AI core (FastAPI, outside this module list); coverage read from `public/coverage_manifest.json`. No backend for "direct sayad-cheque enforcement". | Coverage manifest only | No | PARTIAL | M: remove/soften unbacked claims; confirm enamad; gate the VIP purchase on a working payment+entitlement flow. |
| `/technology` | ghazihoushmand.ir | RAG description, voice streaming, "graph database" of laws | Informational only; no product function | No | No | MARKETING_ONLY | S: keep as explanatory copy, but review each claim (e.g. "graph database") against the real stack. |
| `/about` | ghazihoushmand.ir | "اولین پلتفرم تخصصی…"; coverage numbers; founder named as "آقای ماهان محمدی"; enamad code ۷۴۹۱۴۳۹ | Informational; coverage from manifest | No | No | MARKETING_ONLY | S: remove the unverifiable "first platform" superlative; verify founder/enamad claims. |
| `/contact` | roxira.ir | Enterprise demo/sales inquiry form; "responses usually within one working day" | `POST /api/v1/enterprise/inquiry` (Next.js route) — **stub: validates and returns `RQ-…` reference, "no persistence yet"** | No — leads are dropped | No | PARTIAL | S: persist inquiries (DB or CRM lead) and notify sales. |
| `/en` | roxira.net | English B2B hub; 6 modules; "Contract-first REST API with Swagger"; "Live multi-currency settlement"; trust stats: **7+ currencies, 24/7 uptime, TLS 1.3, encryption at rest** | Modules exist; `CurrencyController` (`@Public`) + `CurrencyService` returns **4** currencies (USD/EUR/AED/IRR) from env or hardcoded defaults; `/docs` API explorer exists | Currency: no (static/env rates) | No (currency is `@Public`) | PARTIAL | S: fix "7+" → 4; substantiate or remove 24/7 / TLS 1.3 / encryption-at-rest. M: real FX feed. M: tenant scoping for the linked modules. |
| `/plans` | ghazihoushmand.ir (canonical) | Prices + limits for guest/user/VIP, read from the system | `loadPlans()` → judge `payments/pricing-matrix`; degrades gracefully when unreachable | Fetched at request time | No | READY | S: none (data-driven). Ensure payment/entitlement actually works before selling. |

## 3. Back-end module inventory (`output_apps/enterprise_hub/modules`)

All routes sit behind a **global `JwtAuthGuard`** (`security/global-guards.ts`); `@Public()` is the
only exception. `@Roles(ADMIN)` adds the `RolesGuard`.

| Module | Controller base route | Service | Persists? | Access |
| --- | --- | --- | --- | --- |
| auth | `auth` (`/v1/auth/*`, external `/api/backend/auth/*`) | `AuthService`, `WebAuthnService`, `KavenegarService` | Yes (users, passkeys) | send/verify-otp + webauthn auth are `@Public`; `me`/registration need JWT |
| health | `health/system` | `SystemHealthService` | No (Docker/host introspection) | `@Public`, version-neutral |
| accounting | `enterprise-hub/accounting` | `AccountingService` | Yes | JWT + `ADMIN` |
| invoicing | `enterprise-hub/invoicing` | `InvoicingService` | Yes | JWT (any authenticated user) |
| currency | `enterprise-hub/currency` | `CurrencyService` | No (env/hardcoded rates) | `@Public` |
| tax_compliance | `enterprise-hub/tax-compliance` | `TaxComplianceService` | Yes (keys, signatures) | JWT + `ADMIN` |
| damages | `enterprise-hub/damages` | `DamagesService` | Yes | JWT |
| hr | `enterprise-hub/hr` | `HrService` | Yes | JWT + `ADMIN` |
| crm | `enterprise-hub/crm` | `CrmService` | Yes, tenant-scoped | JWT |
| inventory | `enterprise-hub/inventory` | `InventoryService` | Yes | JWT |
| radar | `enterprise-hub/radar` | `RadarService` (reads `TECH_RADAR_REPORT.*`, spawns scripts) | No (reads files) | JWT + `ADMIN` |

## 4. Claims not backed by code (legal / brand risks)

These are statements a customer could rely on and that the code does not support. Ranked by risk.

| # | Where | Claim | Reality in code | Risk |
| --- | --- | --- | --- | --- |
| 1 | `/invoicing` مودیان tab | "بسته … به سامانه مودیان ارسال و پذیرفته شد. شماره مرجع: …" | `TaxComplianceService.submitSignature` sets status `ACCEPTED` and calls a local `generateReferenceNumber()`; the source comment states the acceptance cycle is **simulated natively**. No official Moadian call exists. | **High** — false claim of filing with a tax authority; legal/regulatory. |
| 2 | `/` home pricing | Starter ۲٬۹۰۰٬۰۰۰ / Business ۷٬۹۰۰٬۰۰۰ / Foundry ۱۴٬۹۰۰٬۰۰۰ تومان per month, with "شروع" CTAs | Hardcoded array; no subscription, billing, invoice or entitlement backend for Roxira OS. | High — advertised prices with no way to transact; consumer-protection exposure. |
| 3 | `/` home | "کارخانه نرم‌افزار خودمختار … از یک پرامپت، ماژول‌های سازمانی را می‌سازد …" (Foundry Developer plan) | No Foundry module in `enterprise_hub`; sandboxes live in `data/sandboxes/` and are not a supported product surface. | High — selling a product that does not exist. |
| 4 | `/en` | "7+ Currencies supported" | `SUPPORTED_CURRENCIES` = USD, EUR, AED, IRR (4). | Medium — materially false number. |
| 5 | `/en` | "24/7 uptime", "High availability … 24/7" | No SLA, no HA setup (single prod host per `docs/SYSTEM_MAP.md`), no uptime guarantee in code. | Medium — availability claim. |
| 6 | `/en` | "TLS 1.3", "encryption at rest for corporate documents and financial records" | Only TLS termination is evidenced; no at-rest encryption is visible in the reviewed code. | Medium — security claim. |
| 7 | `/en` | "Regulatory compliance … cross-border documentary requirements" | Vague and unverified; no cross-border reporting module. | Medium. |
| 8 | `/services`, `/about` | "نماد اعتماد الکترونیکی … کد ۷۴۹۱۴۳۹" (e-namad) | Cannot be verified from code; it is a Smart Judge credential shown on/next to Roxira surfaces. | Medium — certificate/legal. |
| 9 | `/services` | "پشتیبانی اولویت‌دار اختصاصی ۲۴ ساعته" and "پشتیبانی شبانه‌روزی" | No support system or process evidence. | Medium. |
| 10 | `/services` | "اجرای مستقیم چک صیادی (ماده ۲۳)" | No cheque/sayad integration in code. | Medium. |
| 11 | `/services`, `/about` | "پوشش فعلی … ۸ قانون" / coverage numbers | Backed by `coverage_manifest.json` (8 laws, 4,216 articles) **but** its own `warnings` state 7 of 8 laws come from an unofficial source and that «لایحه اصلاحی قانون تجارت» is a bill stored as active law. | Medium — the number is real but the corpus quality is not what "تنقیح‌شده" implies. |
| 12 | `/about` | "اولین پلتفرم تخصصی …" | Unverifiable superlative. | Low/Medium. |
| 13 | `/about` | Founder named personally ("آقای ماهان محمدی") | Personal attribution; verify consent. | Low. |
| 14 | `/contact` | "درخواست‌های سازمانی معمولاً در کمتر از یک روز کاری بررسی و پاسخ داده می‌شوند" | No persistence or notification behind the form. | Low/Medium. |
| 15 | `/services` | "محاسبات رسمی: تاخیر تادیه بر اساس شاخص بانک مرکزی" | The damages module computes but the index source/update path is not evidenced. | Low/Medium. |

## 5. Cross-cutting gaps (affect every enterprise page)

- **No client-side auth gate.** Enterprise pages render for anyone and then fail at the API with a
  401 alert. There is a login modal in the header, but no route guard / redirect and no onboarding
  for a new tenant. `accounting`, `hr`, `tax-compliance` and `radar` additionally require the
  `ADMIN` role, which no user gets automatically.
- **Incomplete multi-tenancy.** Only `CrmController` scopes by `tenantId` from the JWT. Invoicing,
  accounting, inventory, HR, damages and tax-compliance have **no tenant scoping** — the
  "multi-tenant enterprise SaaS" claim is not enforced for financial data. This is a data-isolation
  risk, not just a marketing gap.
- **Marketing-only "Foundry".** The autonomous software-foundry story (home page + Foundry Developer
  plan) has no corresponding service in this app.
- **Static "live" FX.** `/en` presents env/hardcoded reference rates as a live central feed.

## 6. Recommended order to make Roxira sellable

1. **Integrity first (S).** Remove or replace every unbacked claim in §4: pricing CTAs, Foundry,
   "7+ currencies", "24/7", "TLS 1.3", "encryption at rest", "cheque enforcement", and the
   "accepted by Moadian" wording. Switch the affected CTAs to پیش‌ثبت‌نام / درخواست همکاری.
2. **Fix the sales loop (S/M).** Persist `/contact` inquiries and notify sales. This is the cheapest
   way to capture demand while the product is finished.
3. **Auth + onboarding (M).** Add a real client-side gate (redirect unauthenticated users to login),
   a tenant-provisioning flow, and role assignment so `ADMIN` modules are reachable by a customer.
4. **Tenant scoping (M/L).** Add tenant/owner columns and enforce `tenantId` in invoicing,
   accounting, inventory, HR, damages and tax-compliance, matching the CRM pattern. Without this,
   do not sell multi-tenant.
5. **Moadian honesty or integration (S now / L real).** Immediately relabel the submission as
   "produce & sign a packet; submission is not connected". Then integrate the official Moadian
   web service (taxpayer credentials + API) before claiming filing.
6. **Legal data review (M).** Verify the HR payroll constants against the current year's official
   values and verify the damages index/formula with a lawyer. Reconcile the legal corpus warnings.
7. **Payments & entitlement (M/L).** Wire Roxira OS subscriptions (or a manual onboarding contract)
   so the advertised plans can actually be purchased.
8. **FX feed (M).** Either connect a real rate source for `/en` or present the rates as static
   reference rates.
9. **Foundry as a product (L).** Only sell the Foundry Developer plan after sandbox provisioning,
   isolation and metering are a supported service.

## 7. Pages that should temporarily show «پیش‌ثبت‌نام / درخواست همکاری»

Until the corresponding back-end exists, replace live-product CTAs on these surfaces:

| Page | Replace | With |
| --- | --- | --- |
| `/` home pricing section | "شروع انطباق مالیاتی", "مشاهده ERP و حسابداری", "درخواست دمو" | پیش‌ثبت‌نام / درخواست همکاری (keep module links only for accounting/inventory/crm/hr, which are real) |
| `/` home Foundry card | "درخواست دمو" for the Foundry product | درخواست همکاری |
| `/en` | "Open module" / "API Access" for unbuilt capabilities | Request partnership |
| `/services` (ghazi) | "خرید و فعال‌سازی اشتراک VIP" | پیش‌ثبت‌نام (until payment + entitlement are live) |
| `/invoicing` مودیان tab | "ارسال به مودیان / پذیرفته شد" | "تولید و امضای بسته — اتصال به سامانه مودیان در دست راه‌اندازی" + پیش‌ثبت‌نام |
| `/contact` | (already a request form) | keep, but label it درخواست همکاری and persist submissions |

Pages that are genuinely ready to use once a client gate exists: `/accounting`, `/inventory`, `/crm`
(and `/hr` and `/damages` after the legal-data review).

## 8. Assumptions / limits of this audit

- Judgements are from static code only; no live endpoint was exercised. A controller+service with a
  repository counts as "real", but runtime correctness is not verified.
- Smart Judge's FastAPI AI core was out of the requested read scope, so claims about the legal model
  itself are assessed only against the front-end pages and `coverage_manifest.json`.
- The `/docs` API explorer, `/radar` and `/admin` pages exist but were not in the requested route
  list; they are noted only where they appear in the back-end inventory.
