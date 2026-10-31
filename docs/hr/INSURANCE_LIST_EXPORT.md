# Payroll run and SSO insurance list export

Business suite phase 2 (`docs/strategy/ROXIRA_BUSINESS_SUITE_2026-10-22.md` §4).
Code: `output_apps/enterprise_hub/modules/hr/`.

## Where the numbers live

Every statutory figure is a row in `statutory_parameters`, keyed by country, fiscal year, key and
effective date, with a `source`, a `source_kind` and a `verified` flag per value. Code holds key names
only (`modules/hr/statutory/statutory-catalogue.ts`). Rules:

- `tenant_id` NULL is the platform default, seeded once by migration 1789410000000 from
  `modules/hr/statutory/statutory-seed.ts`. An organisation's edit is a new row with its own tenant id.
- Rows are append-only (database trigger); an edit inserts the next `version`.
- The value in force on a date is the latest effective date not after it; on the same date a tenant
  row beats the default and the highest version wins. Payroll reads as of the last day of the month.
- `GET /enterprise-hub/hr/statutory-parameters/:year` reads (`hr:read`). `PUT
  /enterprise-hub/hr/statutory-parameters` writes (`hr:admin`, owner and admin only) and records the
  old and new value in the audit log. UI: `/app/hr/statutory`.
- A payroll run for a year with no rows is refused (HTTP 400), as is a year missing a required key.
- To add 1406, add a migration with the new rows.

Only the six values of circular 6682 (minimum daily wage, the two other-level figures, seniority,
consumables allowance, marriage allowance) are `verified`. Everything else is listed in
`docs/hr/STATUTORY_OPEN_ITEMS.md`, and the payroll page warns with the count of unverified values.

## Calculation rules (`services/payroll-calculator.ts`)

- Hourly wage = (base + seniority) / 220. Overtime = hours × hourly × 1.4; night work =
  hours × hourly × 0.35 (premium only); holiday/Friday work = hours × hourly × 1.4.
- Unpaid absence deducts (base + seniority + housing + food) / 30 per day.
- Insurable wage = gross − child allowance, capped at the ceiling.
- Taxable income = gross − employee insurance share (Direct Taxation Act art. 137).
- Child allowance uses `hr_employees.dependants`; the 720-insured-days eligibility check is
  left to HR. A non-zero `childAllowance` on the contract overrides it.
- Amounts are whole rials.

## Run lifecycle

1. `POST /enterprise-hub/hr/payroll-runs` `{periodYear, periodMonth, items?}` creates or
   recalculates the DRAFT run for every ACTIVE employee with an ACTIVE contract. Employees
   who already have a single payslip (legacy `POST /hr/payslips`) for that month are skipped
   and listed in `skipped`.
2. `POST /enterprise-hub/hr/payroll-runs/:id/post` creates **one balanced journal entry**
   (`PR-YYYYMM`, dated the last day of the Jalali month) through `AccountingService` and
   freezes the run (POSTED, payslips ISSUED):

   | Account | Dr | Cr |
   | --- | --- | --- |
   | 5010 Salary expense | gross | |
   | 5040 Employer insurance expense | employer 20% + unemployment 3% | |
   | 2030 Social-security payable | | employee 7% + employer 20% + unemployment 3% |
   | 2040 Wage tax payable | | wage tax |
   | 2060 Other payroll deductions | | other deductions |
   | 2050 Salaries payable | | net pay |

   Accounts that are missing from the tenant's chart are created on first posting. An existing
   account with the same code is reused as is.

## Insurance list (`GET /payroll-runs/:id/insurance-list`)

Query: `workshopCode`, `workshopName`, `employerName`, optional `workshopAddress`,
`contractRow` (ردیف پیمان, default `000`), `listNumber` (default `01`).

The SSO "DISKET" program (DSKWIN) uses two dBase files: `DSKKAR00.DBF` (workshop header) and
`DSKWOR00.DBF` (workers). **Format assumptions:**

- We return the same columns, in the same order and with the same field names, as **UTF-8 CSV
  text** (comma separated, CRLF line ends, header row): `DSKKAR00.csv` and `DSKWOR00.csv`. The
  UI adds a BOM when it downloads them. Converting to DBF in the Iran System code page, which
  the desktop program reads, is **not** done yet (follow-up).
- Year is two digits (1405 → `05`), month two digits, dates are compact Jalali `YYYYMMDD`,
  amounts are whole rials without separators.
- `DSW_DD` = paid days (30 − absence days); `DSW_ROOZ` = (base + seniority) / 30;
  `DSW_MAH` = `DSW_ROOZ` × `DSW_DD`; `DSW_MAZ` = insurable benefits above that;
  `DSW_MASH` = `DSW_MAH` + `DSW_MAZ` (capped insurable wage); `DSW_TOTL` = gross pay;
  `DSW_BIME` = employee 7%.
- Header: `DSK_TKOSO` = employer 20% total, `DSK_BIC` = unemployment 3% total,
  `DSK_RATE` = 23, `DSK_KIND` = 0 (normal list), `DSK_PRATE`/`DSK_BIMH` = 0.
- `DSW_SDATE`/`DSW_EDATE` are filled only when the hire or termination date falls inside the
  month. `DSW_IDPLC`, `DSW_IDATE`, `DSW_JOB` (job code) are empty: we do not store them.
- An employee without an insurance number (`hr_employees.insurance_number`) is still exported
  and reported in `warnings`.
