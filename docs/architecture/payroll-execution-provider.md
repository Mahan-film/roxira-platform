# Canonical Remuneration Taxonomy & PayrollExecutionProvider Seam (T260 / R24)

## Overview

Roxira's payroll engine is built around two pack-agnostic contracts under
`output_apps/enterprise_hub/modules/hr/payroll/`:

1. **Canonical Remuneration Taxonomy (`remuneration-taxonomy.ts`)**:
   - Defines canonical pay component codes (`CanonicalRemunerationCode`) and categories
     (`RemunerationCategory`: earnings, benefits in kind, employee deductions, statutory
     tax/social insurance, employer contributions, net adjustments, and retro deltas).
   - Every monetary amount is an integer minor unit (`bigint`). Floating-point math is
     forbidden in payroll aggregation and bank-file reconciliation (`assertBankTotalMatchesPayslips`).
   - Every payslip line carries bitemporal timestamps (`validFrom`, `validTo`, `recordedAt`)
     so closed payruns remain immutable and late corrections post signed `RETRO_DELTA` lines
     into the open period.
   - **Zero hardcoded statutory rates**: component definitions (`RemunerationComponentSpec`)
     declare taxability, insurability, deduction priority waterfall rank, and GL role only.
     Actual rates, brackets, and ceilings live in effective-dated configuration tables with
     four-eyes activation.

2. **Execution Seam (`payroll-execution-provider.interface.ts`)**:
   - `PayrollExecutionProvider` abstracts payroll calculation and submission behind two modes:
     - `native`: calculated inside Roxira's TypeScript bitemporal kernel (used by the default
       pack and future native packs).
     - `partner_handoff`: validated and exported to a certified external payroll engine (such
       as DATEV Lohn-Datenservices for Germany) without self-certifying local payroll authorities.
   - `PayrollExecutionProviderRegistry` resolves providers by `packCode` or `providerId` and
     fails closed when a pack is not registered.

## Default-Pack Fixture

`default-pack.remuneration.fixture.ts` provides:
- `DEFAULT_PACK_REMUNERATION_CATALOG`: maps the default pack's pay components to canonical
  codes, deduction priorities, and GL roles.
- `SYNTHETIC_DEFAULT_PACK_PAYSLIP_LINES`: illustrative `bigint` minor-unit fixture lines for
  unit tests (never representing official statutory rates).
