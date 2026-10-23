# Payroll run and SSO insurance list export

Business suite phase 2 (`docs/strategy/ROXIRA_BUSINESS_SUITE_2026-10-22.md` §4).
Code: `output_apps/enterprise_hub/modules/hr/`.

## Where the numbers live

All statutory rates and amounts are in **one** file, versioned by Jalali year:
`modules/hr/constants/payroll-rates.ts` (`PAYROLL_RATES_BY_YEAR`). Each year has a
`source` string. To add 1406, copy the 1405 entry, change the values and the source.
A payroll run for a year that is not configured is refused (HTTP 400).

1405 values (Supreme Labour Council decree of 1404-12-24 and Budget Law 1405, taken from
secondary sources on 2026-10-22; **re-check against the official circular**):

| Item | 1405 |
| --- | --- |
| Minimum daily / monthly wage | 5,541,850 / 166,255,500 IRR |
| Housing allowance (حق مسکن) | 30,000,000 IRR |
| Worker food allowance (بن کارگری) | 22,000,000 IRR |
| Child allowance (حق اولاد) | 3 × minimum daily wage per child |
| Seniority base (پایه سنوات) | 5,000,000 IRR per full year of service |
| Insurance | employee 7%, employer 20% + unemployment 3% (= 23%) |
| Insurable wage ceiling | 7 × minimum monthly wage |
| Wage tax (monthly) | 0% to 400M, 10% to 800M, 15% to 1,000M, 20% to 1,200M, 25% to 1,400M, 30% above |

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
