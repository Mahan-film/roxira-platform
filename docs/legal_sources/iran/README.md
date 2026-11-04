# Iranian legal sources for the accounting suite

Plain text extracted from files the owner supplied on 2026-10-31. PDF extraction can disorder Persian
punctuation and numbers, so check a figure against the original PDF before relying on it in code.

| File | Source | Status |
|---|---|---|
| `wage-circular-1405.txt` | Ministry circular 6682, 1405/01/31 | Official |
| `terminals-moadian-law.txt` | Terminals and Moadian law, compiled edition | Check amendments |
| `e-invoice-instruction-tir-1405.txt` | E-invoice instruction, Tir 1405 | Official, newest |
| `moadian-technical-connection-14010422.txt` | Moadian technical connection document, 1401/04/22 | Old; confirm current version |
| `customs-law.txt` | Customs Affairs Law | Check amendments |
| `aeinnameh-mavad-95-owner-copy.md` | Article 95 regulation, pasted | Not official; may mix versions |
| `accounting-standards-list-owner-copy.md` | Standards list, pasted | Secondary source |
| `direct-taxes-act-1366-updated-1400-10-20.txt` | Direct Taxes Act, mirror on ekhtebar.ir, updated to 1400/10/20 | Mirror of the official text; later amendments missing |
| `budget-1405-tax-provisions-circular.txt` | Tax Organization letter ص/۲۰۰/۱۰۰۵ (1405/01/31): tax provisions of the 1405 budget law | Official letter, extraction has lost letters |

## Verified 1405 labour figures (circular 6682)

| Item | Amount (rial) |
|---|---|
| Minimum daily wage | 5,541,850 |
| Other wage levels | 45% of fixed wage plus 519,549 per day |
| Seniority base | 166,667 per day |
| Household goods allowance | 22,000,000 per month |
| Marriage allowance | 5,000,000 per month |

Not in the circular: housing allowance, child allowance and the insurance ceiling.

## Not yet verified from an official text

Salary tax brackets, VAT rate (10% or 12%), Article 131 brackets, the Article 169 threshold and every other
figure in `docs/research/2026-10-31/05-iran-compliance-1405-fa.md` come from a research report. They must be
stored as dated parameters and must not be presented as confirmed until an official source is added.

Sample keys and tokens in `moadian-technical-connection-14010422.txt` are masked; use the original PDF for them.

## Direct Taxes Act and 1405 budget figures (added 2026-11-04)

Cited by `docs/tax/*.md`. Figures that come from the 1405 circular (row numbers in brackets): Article 84 exemption
4,800 million rial (1-1); salary brackets 10/15/20/25/30% above 4,800 / 9,600 / 12,000 / 14,400 / 16,800 million rial (1-2-1 to
1-2-5); maximum exempt income for Article 57 properties and Article 101 business income 2,800 million rial (1-5-2); minimum
effective tax rate 10% on profit above 300 billion rial (1-8). Article 131 rates in the Act text are the version of 1400/10/20 and
may have been amended since: treat the 1405 schedule as `unclear`. The 10% advance withholding on doctors' fees is NOT in this
circular and not in the 1405 budget law text (searched), so its 1405 basis is `unclear` (see `docs/tax/DOCTOR_FEE_WITHHOLDING.md`).
