# R24 digest: HR and payroll (Gemini Deep Research, stage 1 + stage 2, 2026-11-21)

Source: owner-run two-stage report. Stage 2 ran **without live web access**, so every figure below is
`REQUIRES PRIMARY CHECK` unless a primary URL is attached in a row. Never hardcode a rate from this file:
rates live in effective-dated config tables with a four-eyes activation gate.

## Decisions (adopt)
1. **Pure TypeScript bitemporal payroll kernel inside NestJS/Postgres.** Copy the *patterns* of the MIT
   PayrollEngine (valid time + recorded time + evaluation date, retro delta, zero-value baseline rows,
   compliance snapshots with four-eyes attestation). Do **not** embed its .NET runtime (third runtime,
   breaks RLS tenant isolation, slows agents).
2. **Money in integer minor units (BIGINT) everywhere.** No floats in the calculation DAG. Bank files must
   equal the sum of net payslips to the minor unit.
3. **Country packs** = versioned bundles: parameter tables, ordered rule DAG, holiday calendars,
   validation schemas, document/export adapters. Order: default pack, then Gulf and Malaysia native packs
   (format-driven, attainable), Germany via partner (below).
4. **Germany: do not self-certify (ITSG + ERiC).** Integrate DATEV Lohn-Datenservices behind a
   `PayrollExecutionProvider` interface so a certified embedded API can replace it later. Revisit only at
   very large German payroll volume.
5. **Closed payruns are immutable.** Late changes post a signed delta into the open run; the GL gets
   reversing + replacement entries in the open period, never edits to closed periods.
6. **HR AI = drafts only.** Policy Q&A over tenant documents, template drafting, read-only payslip
   explainer and variance flags, human-confirmed receipt extraction, aggregated survey summaries. Per-tenant
   kill switch default OFF, no individual-level AI telemetry, special-category fields never enter prompts,
   PII scrubbing before prompt assembly. No ranking, scoring, filtering or performance drafting.
7. **Privacy:** domain-split RBAC (directory, payroll calc, bank details + payment release, special
   category, read-only tax-auditor role); IBAN-change alerts to employee + owner; hashed payment files;
   tamper-evident append-only audit for payrun lock, time edits, sensitive reads, retention purge.
8. **Export on cancellation** is a product feature: GoBD Z3 export (CSV + index.xml), DLS files, JSON/CSV
   portability archive, deletion certificate after the retention window.

## Corrections Stage 2 made (still need a primary source)
| Stage 1 claim | Stage 2 correction | Status |
|---|---|---|
| One German payroll retention clock of 8 years | Three clocks: booking vouchers 8 y, wage accounts and pure tax/SV correspondence 6 y, ledgers/annual statements 10 y | check AO 147, HGB 257, EStG 41 |
| PV child discount 0.25% per child, children 2 to 5 | Only for children under 25; ends the month the child turns 25: store child birth dates | check SGB XI 55(3) |
| Malaysia worked public holiday pay = basic / 26 | Monthly-rated staff on a paid holiday get 2 days' ordinary rate (2 x basic / 26) on top of salary | **disputed, verify Employment Act s.60D before build** |
| Malaysia PDPA 72 h starts at occurrence | JPDP guidance ties it to reason to believe a breach occurred | verify final guideline text |
| UAE: federal GPSSA only | Abu Dhabi Pension Fund covers Emiratis in Abu Dhabi entities; DIFC uses DEWS not EOSG; key logic on `entity_jurisdiction` not just country | verify |
| UAE WPS 1st-of-month, 85% | Older rule was 15 days; verify MOHRE Resolution 340/2026 | verify on MOHRE |
| KSA GOSI step-up date (1 vs 3 July) | Confirm on GOSI invoices; also Labor Law amendments of Feb 2025 | verify |

## Blind spots to turn into rows
Cost-centre/branch allocation of wages and accruals; Malaysia PCB test-pack edge cases (BIK, VOLA, TP1/TP3,
zakat clamp, arrears); DATEV advisor-authorisation friction (2-4 weeks, needs a guided invite flow);
PgBouncer transaction pooling + RLS (use `SET LOCAL`, FORCE RLS on every payroll table, cross-tenant leak
test in CI, workers must not run as bypass-RLS); retail/F&B shifts and offline punch queue; rounding rules
per country; deduction priority waterfall and garnishment floor; Arabic/RTL payslips; PII scrubbing and
prompt-injection hardening in the AI gateway; German Verfahrensdokumentation template.

## Conflict with current direction (owner to decide)
Stage 2 recommends **Malaysia first**. STATE.md says default pack first, then DE/EU, then Gulf, product
before company steps. Treat the Malaysia pack as the second native pack, not a new priority, until the
owner says otherwise.

## Rows (see issues labelled research-row, R24)
Kernel schema; canonical remuneration taxonomy + `PayrollExecutionProvider`; Core HR MVP; payrun lock +
GL posting; retention/legal-hold engine; cancellation export; HR AI guardrails spec; per-country packs.

## Second opinion (Gemini Deep Research, 2026-11-22)

Saved unchanged in `R24_GEMINI.md` (Stage 1 and Stage 2 both present). Important limit: this digest's header already credits a Gemini two-stage report, and its decisions and Stage 2 corrections match the pasted text point by point, so the pasted output is very likely the same run (or a rerun) that this digest was built from. Agreement below is therefore not independent corroboration. No `R24_RAW.md` exists on main, so "digest only" was checked against the digest text alone. Stage 2 says live web lookup was disabled: its VERIFIED labels come from the model's memory, not from a page, so they count as UNVERIFIED. Rule used: where the two sides conflict, the claim with a primary URL and a date wins; everything else is UNVERIFIED until a lane reads the page. A third block in the same owner paste (the broad technical, regulatory and cost baseline) is a different research and belongs to R26.

### Agreements
- Bitemporal kernel (valid time, recorded time, evaluation date), copy PayrollEngine patterns (MIT) and do not embed the .NET runtime; pure TypeScript in NestJS/Postgres.
- Money as integer minor units; bank file equals sum of net payslips.
- Closed payruns immutable; retro delta posted in the open run; GL reversing and replacement entries in the open period.
- Germany via DATEV Lohn-Datenservices behind `PayrollExecutionProvider`; no self-certification (ITSG, ERiC).
- HR AI drafts only, tenant kill switch default OFF, PII scrubbing before prompts.
- Domain-split RBAC, hashed payment files, IBAN-change alerts, GoBD Z3 export on cancellation.
- The seven Stage 2 corrections and the blind-spot list are the same in both.

### Conflicts
| Topic | This digest | Gemini | Verdict |
|---|---|---|---|
| Malaysia worked public-holiday pay | "disputed", verify Employment Act s.60D before build | Stage 2 states flatly: 2 x basic / 26 on top of salary; Stage 1's 1 x was a "critical error" | UNVERIFIED both; no URL. Keep "verify before build" (digest wording stands). |
| Country order | Default pack, then Gulf and Malaysia, Germany via partner | Stage 1 lists UAE, KSA, Malaysia; Stage 2 Option A: Malaysia first (months 1-6), Germany DATEV track in months 4-6, UAE and KSA in months 7-12 | Not a fact conflict; the owner decides (see below). |
| Stage 2 status labels | Everything is REQUIRES PRIMARY CHECK | Mix of VERIFIED, CHANGED, REQUIRES PRIMARY CHECK | Digest is stricter and right: no web access in Stage 2. |

### Only one side has it
- **Gemini only (all UNVERIFIED, no primary URL in the text):**
  - Option table A-D: one-off and monthly cost ranges (A about USD 3-8k; native German engine USD 150-400k+, 18-30 months), including global payroll APIs listed from about USD 29 per employee per month.
  - Revisit triggers: German embedded API if over 30% of German leads lack a tax advisor or a certified partner passes audit at EUR 6 per employee per month or less; native German engine only above about EUR 1.5M yearly payroll revenue; Gulf in-region hosting node before the first Gulf tenant over 50 employees or when local storage is gazetted.
  - Open-source licence table: Frappe HR GPL-3.0 (avoid embedding), Horilla LGPL-2.1 (check forks for AGPL), Odoo payroll enterprise-only (proprietary), PayrollEngine MIT.
  - Malaysia: contract 24 h processor-to-controller breach notice; DPO threshold (over 20k subjects or over 10k sensitive records) and a resident DPO; apply for LHDN verification about 60 days before GA.
  - Germany: DATEV Marktplatz onboarding for a non-German IP holder.
  - Statutory parameters in Stage 1 (2026 ceilings, Minijob, GPSSA and GOSI rates, WPS thresholds). The digest deliberately carries none of them.
- **Digest only:** the "never hardcode a rate" rule with a four-eyes activation gate (Gemini has it only as a safe default in open question 5, same effect); the explicit conflict with STATE.md on country order.

### Row changes
- No new row and no comment posted: the Gemini-only items are cost ranges, triggers and licence notes, not yet covered by an open row but not a change of any row scope. Open rows found: #1054 (kernel schema), #1055 (taxonomy and provider interface), #1056 (HR AI guardrails). Rows for Core HR MVP, payrun lock, retention, export and country packs were not found under the search "R24".
- The licence table and the revisit triggers are worth carrying into #1055 and the country-pack rows when they are opened; both stay UNVERIFIED until a lane reads the sources.

### Owner decisions (not for agents)
1. Country order: Stage 2 says Malaysia first; STATE.md says default pack first, then DE/EU, then Gulf. Unchanged until the owner decides.
2. Whether the Option A-D cost ranges and revisit triggers become planning numbers (all UNVERIFIED).
3. Whether to build native Malaysia payroll (LHDN verification effort) versus a partner, since Gemini's recommendation depends on it.

### Expert questions added (default in brackets)
1. Malaysia tax agent: current LHDN PCB test-case requirements and verification turnaround. [exact integer-sen math, regression suite from published examples]
2. Malaysia employment law: public-holiday pay for monthly-rated staff under s.60D. [implement as a config table, do not hardcode 1x or 2x]
3. Malaysia PDPA: 72 h clock start and DPO threshold for a multi-tenant processor. [24 h notice to controllers]
