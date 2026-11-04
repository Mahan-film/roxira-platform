# Corporate income tax workbench (DTX-01), design

Status: design plus a **preview-only** computation. Nothing is posted to the ledger.

## Source status (read this first)

`docs/legal_sources/iran/` holds no text of the Direct Taxes Act, no corporate tax rate table, no
provision rule and no statement of the effective-rate floor. Its README says so under "Not yet
verified from an official text" (`docs/legal_sources/iran/README.md`, section "Not yet verified from
an official text"). Therefore **every rate and rule below is `unclear`**: it has no page or section
in `docs/legal_sources/iran/` to cite. Nothing here may be shown to a customer as a confirmed rule.
Rates are never in code: they come from the statutory store (`modules/hr/statutory`) as dated
parameters. Until an owner-approved source is added, no value exists and the preview refuses to
compute (HTTP 400 naming the missing parameter).

| Item | Where it would be cited | Status |
| --- | --- | --- |
| General corporate income tax rate | none in `docs/legal_sources/iran/` | `unclear` |
| 10% effective-rate floor (minimum tax as a share of accounting profit) | none | `unclear`. The 10% figure comes from the owner's request, not from a source. |
| Which base the floor applies to (accounting profit before tax, or taxable income) | none | `unclear`. The preview uses accounting profit before tax. |
| Treatment of exempt income, tax losses carried forward (limits, expiry) | none | `unclear`. Accepted only as accountant inputs. |
| Provision timing (at year end, or each season) | none | `unclear`. The preview is for one fiscal year. |
| Provision account codes | `docs/legal_sources/iran/accounting-standards-list-owner-copy.md` lists standards only, no chart | `unclear`. The accountant names the accounts. |

## Parameters (statutory store)

Added to `STATUTORY_KEYS` (names and shape only, values live in `statutory_parameters`):

- `corporate_tax_rate`: rate, decimal string in [0, 1].
- `corporate_tax_effective_floor`: rate, decimal string in [0, 1].

Both are resolved for the fiscal year end like every other statutory value (the tenant row beats the
platform default, latest effective date not after the date). Seed rows must carry `verified = false`
until checked against an official text.

## Inputs (accountant supplies, all in integer rials as exact decimal strings)

1. `fiscalYear`: Jalali year.
2. `accountingProfit`: accounting profit before tax, may be negative. (Later: read from the
   income statement for the year. Not wired, so the number is reviewed by a person first.)
3. `nonDeductibleAdditions`: expenses not allowed for tax (>= 0).
4. `exemptIncomeAndDeductions`: exempt income and other deductions (>= 0).
5. `lossesBroughtForward`: tax losses carried in (>= 0). No expiry rule is applied (`unclear`).
6. Optional `expenseAccountCode` and `payableAccountCode` for the voucher preview.

## Computation (all integer minor units through `modules/accounting/money.ts`)

```
taxableIncome  = max(0, accountingProfit + nonDeductibleAdditions - exemptIncomeAndDeductions
                         - lossesBroughtForward)
taxByRate      = round_half_up(taxableIncome * corporate_tax_rate)
floorTax       = round_half_up(max(0, accountingProfit) * corporate_tax_effective_floor)
provision      = max(taxByRate, floorTax)
floorApplied   = floorTax > taxByRate
effectiveRate  = provision / accountingProfit   (null when accountingProfit <= 0)
```

Rounding is half up on the rial-scaled product, with rates as exact 6-decimal strings.

## Voucher (preview, never posted)

```
Dr  expense account  provision     (tax expense for the year)
Cr  payable account  provision     (income tax payable)
```

No line is built when the provision is zero. The preview returns the lines; posting is a separate,
reviewed step that does not exist yet (AI and previews propose, rules post).

## Worksheet

The response lists each step above with its amount and the statutory parameter versions used
(key, value, effective date, version, source, verified), so a reviewer sees which rate produced the
number and whether it is verified.

## Endpoint

`POST /enterprise-hub/tax-compliance/corporate-tax/preview`, body = inputs above, `tax:export`
(read-style, no write). The response has `status: "preview"` and `notes` repeating the `unclear`
list.

## Open questions for the accountant or the lawyer

1. The corporate rate(s) in force for the fiscal year, and their official source.
2. Exact definition and base of the 10% effective-rate floor.
3. Loss carry-forward rules.
4. Whether the provision is booked yearly or per season, and the account codes.
