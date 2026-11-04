# Rental income tax with the Art. 57 exemption (DTX-03), design

Status: design plus a **preview-only** computation. Nothing is posted to the ledger.

## Sources

- `docs/legal_sources/iran/direct-taxes-act-1366-updated-1400-10-20.txt` (the Act, text updated to 1400/10/20): Art. 53 with notes 1 to 12, Art. 57 with notes 1 and 2, Art. 131. Cited as "Act, Art. N".
- `docs/legal_sources/iran/budget-1405-tax-provisions-circular.txt`: row 1-5-2 (maximum exempt income of Art. 57 properties and Art. 101 business income, 1405).
- Secondary, not official, not added to the repo: a legal wiki summary of the 1403 discount clauses of Art. 53 (https://edalatsara.com/rules/قانون-مالیاتهای-مستقیم/ماده-53) and the ekhtebar announcement of the 1405 ceiling (https://www.ekhtebar.ir/اعلام-سقف-معافیت-سالانه-برای-مستغلات-ا/, page did not load for the tool). Used only to know that the discounts exist.

## Rules and where they come from

| Rule | Source | Status |
| --- | --- | --- |
| Taxable rent = total rent, cash and in kind, minus 25% for the owner's costs, depreciation and obligations | Act, Art. 53 | sourced. The 25% is read from the store key `rental_expense_deduction_rate`, not from code. |
| A lessor who is not the owner: taxable income is rent received minus rent paid | Act, Art. 53 | sourced |
| In-kind amounts: improvements made by the tenant for the owner (+50% of value in the handover year) and owner costs paid by the tenant | Act, Art. 53 notes 5 and 6 | sourced; the accountant supplies the valued amount in `inKindIncome` (the 50% uplift of note 5 is applied by the accountant, the code adds the amount at 100%) |
| Residences of the owner, parents, spouse, children and dependants, rent-free state use, note 11 area exemptions (note 3: each apartment unit is a separate property; note 4: furniture and machinery rent is added to the property's income) | Act, Art. 53 notes 1 to 4 and 11 | sourced, not computed: the accountant removes the GROSS rent of exempt units with `exemptRentPortion` (it leaves the base before the 25% cut) |
| A natural person with no other income is exempt up to the Art. 84 salary exemption, the rest is taxed; special declaration needed; pensions, prizes and bank interest are not income | Act, Art. 57 | sourced |
| If the other taxable income is below the ceiling, the part of the rent that together with it reaches the ceiling is exempt | Act, Art. 57 note 2 | sourced |
| No exemption for minor children under the father's guardianship | Act, Art. 57 note 1 | sourced |
| Ceiling for 1405: 2,800 million rial | 1405 circular, row 1-5-2 | sourced (1405) |
| Rental income is taxed at the Art. 131 rates | Act, Art. 131 ("rates of tax on the income of individuals") | The Act text is the 1400/10/20 version; the 1405 schedule is `unclear` |
| Note 2 of Art. 57 says the other income is "monthly" in the text; the preview treats it as annual | read as annual | `unclear` (almost certainly annual) |
| Whether rent is added to other income before the brackets apply | none read | `unclear`. The preview taxes the taxable rent on its own. |
| 1403 discounts: 70% for a 2-year contract, 100% for 3 years or more, 50% for rent at least 15% below the regional rental value | secondary summary only, not in the 1400 text | `unclear`, not modelled |
| Withholding by public bodies from the rent they pay | Act, Art. 53 note 9 | not modelled |

## Parameters (statutory store)

`rental_expense_deduction_rate` (new, rate), `income_exemption_ceiling_art57_art101` (shared with DTX-02, money in rials), `income_tax_art131_brackets` (shared with DTX-02). Values are those in force at the end of the Jalali fiscal year. Nothing is seeded: the preview refuses (HTTP 400 naming the key) until they are set with a source. For 1405 the ceiling is 2,800,000,000 rial (row 1-5-2).

## Inputs and computation (integer minor units)

Inputs: `fiscalYear`, `rentReceived`, `inKindIncome`, `lessorIsOwner`, `rentPaid` (required when the lessor is not the owner), `exemptRentPortion`, `otherTaxableIncome`, `minorUnderGuardianship`.

```
gross       = rentReceived + inKindIncome
base        = gross - min(gross, exemptRentPortion)
taxableRent = owner ? base - round(base x rate) : base - rentPaid          (never below 0)
exemption   = minorUnderGuardianship ? 0 : min(taxableRent, max(0, ceiling - otherTaxableIncome))
taxable     = taxableRent - exemption
tax         = bracketTax(taxable)  (each band at its own rate, half-up)
```

## Endpoint

`POST /enterprise-hub/tax-compliance/rental-tax/preview`, `tax:export`. Response: worksheet, amounts, parameter versions used, `voucher.posted = false`, `notes`.
