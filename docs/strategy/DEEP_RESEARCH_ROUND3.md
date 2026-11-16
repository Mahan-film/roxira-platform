# Deep research — round 3 (R13–R16)

برای مالک: هر پرامپت را جدا کپی کنید و در Deep Research اجرا کنید. بعد از گزارش اول، متن «STAGE 2» پایین همین فایل را در همان گفتگو بفرستید و سپس هر دو خروجی را برای من بفرستید. ترتیب اولویت: R13، R14، R16، R15.

---

## R13 — Germany and EU accounting/tax pack

```
CONTEXT
We build "Roxira", a multi-tenant cloud ERP (accounting, invoicing, inventory, POS, payroll/HR, CRM) with an AI assistant. Core: NestJS + PostgreSQL (row-level security per tenant), double-entry ledger with book and transaction currency, per-company "country packs" (data + adapters: chart templates, tax codes, e-invoice adapter, payroll rules, statutory reports). Iran pack is live. We now design the Germany pack as the strictest EU reference. Small team; we build in-house, buy only certified components.

TASK R13 — produce a complete, testable requirements catalogue for a German accounting/ERP product, current as of today.
Cover, each as a requirement row (id, requirement, legal source with paragraph and URL, effective date, what the software must store/do/output, a numeric or file-level acceptance test):
1. GoBD (BMF letter, latest version): immutability, audit trail, Verfahrensdokumentation, retention (§147 AO, §257 HGB, the 2025 change to 8 years for vouchers), data access for auditors (Z1/Z2/Z3), GDPdU/IDEA export format.
2. E-invoicing: B2B obligation timeline (receive since 2025, issue 2027/2028 thresholds), EN 16931, XRechnung (current version), ZUGFeRD/Factur-X profiles, Peppol BIS 3.0, KoSIT validator, exceptions (small amounts, tickets), latest BMF letters.
3. POS: KassenSichV, TSE (certified cloud TSE options and costs), DSFinV-K export, receipt obligation, registration of tills with the tax office (since 2025), Kassennachschau.
4. VAT: rates, Kleinunternehmer, reverse charge §13b, UStVA and Zusammenfassende Meldung via ELSTER (ERiC library, certification, test environment), OSS/IOSS, VIES checks, ViDA timeline.
5. Charts and reports: SKR03/SKR04, HGB balance sheet and P&L layouts, E-Bilanz (XBRL taxonomy version), DATEV export formats (EXTF), Jahresabschluss for small GmbH/UG.
6. Payroll: only what software must do to integrate (ELStAM, DEÜV, sv.net) and whether payroll requires a certified program (ITSG certification); recommend build vs partner.
7. Privacy and AI: GDPR processor duties, German specifics (BDSG), EU AI Act Art. 50 duties for a business assistant, and any rule on storing accounting data outside the EU.
8. Open-source building blocks: validators, XRechnung/ZUGFeRD libraries, ERiC wrappers, TSE SDKs, with licence and maintenance status.
RULES: primary sources (BMF, gesetze-im-internet.de, EU EUR-Lex, KoSIT, BSI, DATEV docs) with dates; flag anything older than 12 months; give prices in EUR plus USD; say when evidence is missing.
OUTPUT: the requirements table, a build-vs-buy table, and a phased plan (minimum for a German small business to legally run its books on Roxira, then POS, then payroll).
```

## R14 — Gulf (Saudi Arabia, UAE, then Oman, Bahrain, Qatar, Kuwait)

```
CONTEXT
Same product as R13 (multi-tenant cloud ERP with country packs; Persian RTL and Jalali calendar already supported, so Arabic RTL and Hijri are reusable). We now design Gulf packs.

TASK R14 — testable requirements catalogue per country, current as of today.
1. Saudi Arabia (ZATCA): Fatoora phase 1 and phase 2 integration waves and thresholds; UBL 2.1 XML spec version; cryptographic stamp; CSID/PCSID onboarding (compliance and production); QR code TLV fields; clearance (B2B) vs reporting (B2C) flows and time limits; credit/debit notes; simplified vs standard invoices; sandbox; whether a solution provider must be certified or listed; VAT rate and return (frequency, form fields); Zakat basics a bookkeeping product must support; Hijri date rules on invoices; Arabic language requirements.
2. UAE: e-invoicing mandate (Peppol-based "5-corner" model, PINT AE), accredited service provider (ASP) requirement and how a software vendor becomes or connects to one, timeline by revenue band; VAT (rate, return, FTA e-services), corporate tax 9% (registration, small business relief, record keeping, transfer pricing basics), retention periods, Arabic/English invoice rules.
3. Oman, Bahrain, Qatar, Kuwait: VAT/e-invoicing status and timelines (one table).
4. Data residency rules for accounting data (cloud outside the country allowed or not) per country.
5. Open-source building blocks: ZATCA SDK, UBL/PINT validators, Peppol access point options (open source vs commercial, costs).
RULES: primary sources (zatca.gov.sa, tax.gov.ae, mof.gov.ae, peppol.org) with dates; flag >12 months old; prices in local currency plus USD; say when evidence is missing.
OUTPUT: requirements table per country, a comparison table, build-vs-buy, and the minimum legal scope for a small business per country.
```

## R15 — software factory with AI agents (speed and quality)

```
CONTEXT
Two humans plus AI coding agents build a large monorepo (NestJS, Next.js, Python FastAPI, PostgreSQL). Four parallel agent "lanes" (Gemini-based IDE agents) each take tasks from a written wave plan, open one PR per task; an automated cross-family LLM reviewer comments; a human-free hub merges through a GitHub merge queue with CI (backend jest + Postgres specs ~4 min, frontend build ~2 min, Playwright gate ~11 min). Problem: about 30 PRs pile up unmerged, with dependency chains, migration timestamp collisions, shared files (permission matrix, app module, nav menu) causing rebase conflicts, and stale LLM reviews after force-pushes.

TASK R15 — best current practice (2025–2026, with evidence) to maximise merged, correct work per day:
1. Flow control: WIP limits per agent, stacked PRs vs one-task-one-PR, trunk-based with feature flags, how to slice tasks to avoid shared-file conflicts (codegen for registries, per-module manifests).
2. Merge queues: batching, bisection, flaky-test quarantine, affected-test selection (Nx/Turborepo/Bazel-style or custom path maps), Playwright sharding and selection.
3. Migrations from parallel agents: timestamp/ordering strategies, squash, migration linters, expand/contract.
4. Automated review that works: which checks catch real bugs (property tests, mutation testing, SAST, type-level rules), how to keep LLM review fresh after pushes, how to measure reviewer precision.
5. Agent orchestration: planner/executor splits, verification loops, cost per merged PR, published case studies with numbers.
6. Tools released in 2026 worth adopting for a 2-person team (with licence and cost), and which to avoid.
RULES: cite primary sources (official docs, engineering blogs with data, papers); flag >12 months old; separate evidence from opinion.
OUTPUT: a ranked list of changes with expected effect, effort, and a 30/60/90-day plan.
```

## R16 — what a "global-grade" accounting core must have

```
CONTEXT
Same product. We want one accounting core that serves Iran, Germany/EU, the Gulf and Southeast Asia through country packs.

TASK R16 — benchmark the cores of Xero, QuickBooks Online, Odoo, SAP Business One, Sage Intacct, NetSuite and Microsoft Business Central on:
multi-entity and consolidation (intercompany eliminations, minority interest), multi-currency (book/transaction/reporting currency, revaluation, rounding), period close and locks, audit trail and immutability, dimensions/analytic accounts, budgets, fixed assets, inventory valuation methods (FIFO, weighted average, standard), bank feeds and reconciliation, tax engine design (effective-dated rates, reverse charge, withholding), e-invoicing adapter architecture, accountant/partner access, open APIs and webhooks, data export for auditors, AI features shipped in 2025–2026.
For each: what is table stakes, what is a differentiator, and a concrete acceptance test we can run on our system.
RULES: primary vendor docs with dates; say when evidence is missing.
OUTPUT: a capability matrix, a prioritized gap list for a new core, and test scenarios (with sample data) for each capability.
```

---

## STAGE 2 (send after each report, in the same chat)

```
STAGE 2 — Act now as a skeptical senior reviewer of the report you just wrote.
1. Re-check every number, date, threshold and legal claim against a primary source. Table: claim | source URL | source date | VERIFIED / CHANGED (correct value) / UNVERIFIABLE.
2. List what the report missed that would hurt us in 12–24 months (at least 10), each with why it matters.
3. Turn it into a DECISION PACK: options, recommendation, one-off and monthly cost, effort, reversibility, what to do this month / 3 / 6 / 12 months, revisit trigger.
4. List open questions that need a human expert (tax advisor, lawyer), each with the default you would choose.
Keep facts and recommendations separate. Do not repeat the original report; only correct, extend and decide.
```
