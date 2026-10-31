# Statutory values and file layouts awaiting official confirmation

Issue #933. Each row stays `verified = false` until someone checks it against the official text and
records that with `PUT /enterprise-hub/hr/statutory-parameters`.

## Values (1405)

| Key | Seeded value | Where it comes from now | What would confirm it |
| --- | --- | --- | --- |
| `housing_allowance` | 30,000,000 | Not in circular 6682; matches the decree text on ekhtebar.ir (docs/research/TAX_SEASONAL_AND_RATES_2026-10-31.md) | Official copy of the cabinet decree |
| `wage_tax_annual_brackets` | 4.8 / 9.6 / 12 / 14.4 / 16.8 bn, 10 to 30% | Research report | Budget Law 1405 text and the tax directive |
| `wage_flat_tax_rate` | 10% | Research report | Tax circular |
| `eidi_exempt_ceiling` | 400,000,000 | Research report | Budget Law 1405 |
| `non_cash_exempt_annual` | 800,000,000 | Research report | Art. 91(13) with Budget Law 1405 |
| `vat_general_rate` | 10% | Research report | Budget Law 1405; the report records a 10 versus 12 dispute |
| `employee_insurance_rate`, `employer_insurance_rate`, `unemployment_insurance_rate` | 7 / 20 / 3% | Research report, old code | Social Security Act art. 28, Unemployment Insurance Act art. 5 |
| `insurable_ceiling_multiplier` | 7 | Old code | SSO circular for 1405 |
| `child_allowance_days` | 3 | Old code | Social Security Act art. 86 |
| `monthly_work_hours`, `payroll_month_days`, `overtime_premium`, `night_shift_premium`, `holiday_premium` | 220, 30, 40%, 35%, 40% | Old code | Labour Law arts. 51, 58, 59, 62 |
| All 1404 values | see seed | Old code | The 1404 texts; they are not in this repository |

Note: the old code carried seniority as 5,000,000 a month. Circular 6682 sets 166,667 a day, so the
store holds the daily figure and a 30-day month gives 5,000,010. The ekhtebar.ir copy says 166,666;
the circular wins. Only the 400,000,000 monthly exemption has a second source; the rest of the
brackets do not.

## Payroll rules to confirm with an accountant

- Whether m in cumulative tax counts months on payroll (built) or calendar months since Farvardin
  (the report's formula for a full-year employee; the two differ only for mid-year hires).
- Flat allowances: the report says the flat rate applies "after the proportional exemption". Built as
  rate × amount with no exemption.
- Housing, food, child and marriage allowances are taxed in full here. The report says welfare items
  may be exempt under Administrative Court rulings of 1405; mark them EXEMPT per contract if so.
- Marriage allowance is treated as insurable; only child allowance and eidi are excluded by default.
- Base pay for calendar days: a 31-day month pays 31 × daily wage and Esfand 29 or 30, following the
  report's insurance example. Confirm for monthly-salaried staff.
- Non-cash allowances are in gross and net pay here. If they are paid in kind, net pay must exclude them.
- Refunds: a low month reduces tax to zero at most; nothing is paid back.
