# Income tax of business owners and civil partnerships (DTX-02), design

Status: design plus a **preview-only** computation. Nothing is posted to the ledger.

## Sources

- `docs/legal_sources/iran/direct-taxes-act-1366-updated-1400-10-20.txt` (the Act, mirror text updated to 1400/10/20, later amendments missing). Cited below as "Act, Art. N".
- `docs/legal_sources/iran/budget-1405-tax-provisions-circular.txt` (tax provisions of the 1405 budget law, row numbers of the table). Cited as "1405 circular, row X".

## Rules and where they come from

| Rule | Source | Status |
| --- | --- | --- |
| Business owners file a return per unit and pay at the Art. 131 rates | Act, Art. 100 | sourced |
| Annual taxable income of owners who filed on time is exempt up to the Art. 84 exemption; the rest is taxed at the Art. 131 rates | Act, Art. 101 | sourced |
| Several business units of one person: their income is added up, only one exemption is deducted | Act, Art. 101 note 2 | sourced |
| Civil partnerships: partners use at most two exemptions, the exemption amount is divided equally, the rest of each partner's share is taxed separately; spouses count as one partner and the exemption goes to the husband; heirs of a deceased partner take his exemption share | Act, Art. 101 note 1 | sourced. "Divided equally between them" is read as: total = (number of exemptions used) x ceiling, divided equally among the effective partners. The reading is ours: `unclear` until a tax office confirms it. |
| Maximum exempt income for Art. 57 properties and Art. 101 business income in 1405: 2,800 million rial | 1405 circular, row 1-5-2 | sourced (1405) |
| Art. 131 rates for individuals (15/20/25% above 500 million and 1 billion rial in the Act text) with a discount of one point per 10% growth of declared income, at most five points | Act, Art. 131 and its note | The Act text is the 1400/10/20 version. Whether the 1405 schedule differs is `unclear`: it is not in the 1405 circular. The discount needs the previous year's declared income and settled debt, so it is not modelled. |
| Salary brackets 10/15/20/25/30% (1405) | 1405 circular, rows 1-2-1 to 1-2-5 | sourced, but they are the **salary** schedule (HR lane), not Art. 131. They must not be used here. |
| Flat-rate tax for small businesses (Art. 100 note), the sales limit 720,000 million rial for 1404 | Act Art. 100 note; 1405 circular row 1-5-1 | not modelled |

## Parameters (statutory store)

New keys (names and shape only, no figure in code): `income_tax_art131_brackets` (brackets, upper bounds in rials, rates as decimal strings), `income_exemption_ceiling_art57_art101` (money, rials; shared with DTX-03), `civil_partnership_max_exemptions` (count; the Act says two). Values are in force at the end of the Jalali fiscal year. No value is seeded: the preview refuses (HTTP 400 naming the key) until someone sets them with a source. For 1405 the exemption ceiling can be set to 2,800,000,000 from row 1-5-2; the Art. 131 schedule needs an official 1405 source first.

## Inputs

`fiscalYear`; `mode` = `SOLE` or `PARTNERSHIP`; `units[]` with `revenue` and `deductibleExpenses` (rials, exact decimal strings); for a partnership `partners[]` with `shareBps` (sum 10000), optional `name` and `spouseGroup`.

## Computation (integer minor units, half-up per band)

```
income        = sum(units.revenue - units.deductibleExpenses)        (a loss counts as zero)
SOLE          taxable = max(0, income - ceiling);  tax = bracketTax(taxable)
PARTNERSHIP   effective partners = spouse groups + single partners
              exemptions = min(effective partners, civil_partnership_max_exemptions)
              pool = exemptions x ceiling, split equally per effective partner (remainder to the first)
              share_i = income x shareBps_i / 10000 (remainder to the largest share)
              taxable_i = max(0, share_i - exemption_i);  tax_i = bracketTax(taxable_i)
```

## Not modelled

Art. 131 note discount, losses of earlier years, the flat-rate regime, penalties, advance payments, a partner who also has other income, death of a partner.

## Endpoint

`POST /enterprise-hub/tax-compliance/business-tax/preview`, `tax:export`. Response: per-taxpayer lines, total, parameter versions used, `voucher.posted = false`, `notes`.
