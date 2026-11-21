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
