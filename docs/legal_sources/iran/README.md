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
