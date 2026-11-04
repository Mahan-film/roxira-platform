# 10% advance withholding on doctors' fees (DTX-04), design

Status: design plus a **preview-only** computation. Nothing is posted to the ledger and nothing is sent to the Tax Organization.

## Source status (read this first)

The legal basis of this withholding is a clause of the yearly budget law, and the official texts needed to cite it are **not** in `docs/legal_sources/iran/`:

- The 1405 budget-law tax circular (`budget-1405-tax-provisions-circular.txt`) and the 1405 budget law text (searched for «پزشک», «حق الزحمه», «علی الحساب») contain no such clause. Its 1405 legal basis is therefore `unclear`.
- The official Tax Organization instructions (for example 200/1400/502 at https://inta.tax.gov.ir/Pages/Action/LawsDocShow/5/1/1/1000/5107, 200/99/505, bulletin 200/99/7 at intamedia.ir) could not be downloaded from this machine (connection closed / empty page), so they are not added.
- What is known comes from secondary sources, read on 2026-11-04 and NOT added to the repo: the Sepidar guide https://www.sepidarsystem.com/blog/doctors-tax/ (clause «ث» of note 6 of the 1403 budget law, Art. 199 applies, 10% of the fee, remitted by the end of the month after receipt, advance on the doctor's annual tax, employees and salary/bonus excluded by bulletin 230/8296/د of 1402), the Tax Organization doctors' withholding portal https://withholding.tax.gov.ir/ (basis: clause «ح» of note 6 of the 1399 and 1400 budget laws and the Tax Organization instruction), and snippets of instruction 200/1400/502 (the 10% covers the whole fee, paid, accrued or offset).

Only Art. 199 of the Direct Taxes Act is official text in the repo.

## Rules

| Rule | Source | Status |
| --- | --- | --- |
| Medical centres withhold 10% of the fee of the medical group as an advance on the doctor's tax | secondary sources above (budget law clause: «ث» note 6 of 1403, «ح» note 6 of 1399-1400) | rate and rule from secondary sources; 1405 basis `unclear`. The rate is read from the store key `doctor_fee_withholding_rate`, not from code. |
| Base: the whole fee, paid, accrued or offset | instruction 200/1400/502 (snippet) | `unclear`: the preview takes the date and amount the caller gives |
| Salary and bonus (karaneh) under the budget laws are outside this withholding; employed doctors fall under salary tax | bulletin 230/8296/د of 1402 (via Sepidar) | `unclear`; the preview excludes lines of kind `SALARY` and `BONUS` |
| Remit by the end of the month after receipt | Sepidar summary | `unclear`; the preview computes the end of the next Jalali month |
| A withholder who fails to deduct or remit is jointly liable and is fined 10% of the unpaid tax plus 2.5% for each month of delay | Act, Art. 199 (official text in `direct-taxes-act-1366-updated-1400-10-20.txt`, line about «ماده ۱۹۹») | sourced; the two rates are read from the store keys `withholding_late_penalty_rate` and `withholding_late_penalty_monthly_rate`. How a part month counts is `unclear` (a started Jalali month counts as one). |
| How the withheld amount is credited to the doctor in the annual return | no source | `unclear`, not modelled |

## Parameters (statutory store)

New keys (names and shape only): `doctor_fee_withholding_rate`, `withholding_late_penalty_rate`, `withholding_late_penalty_monthly_rate` (rates, decimal strings). Nothing is seeded: the preview refuses (HTTP 400 naming the key) until they are set. The Art. 199 figures are 0.10 and 0.025 per the Act text; the doctors' rate is 0.10 per the secondary sources, which must stay `verified = false` until an official text is added.

## Inputs and computation (integer minor units, half-up)

Inputs: `fiscalYear`; `payments[]` with `paidOn` (YYYY-MM-DD), `amount` (rials), `doctorRef` (your reference, not a national id), `kind` (`FEE`, `SALARY`, `BONUS`); optional `remittedOn`.

```
FEE line:           withheld = round(amount x doctor_fee_withholding_rate);  netToDoctor = amount - withheld
SALARY / BONUS:     withheld = 0, with the reason
remitBy             = end of the Jalali month after paidOn
late penalty (per line, when remittedOn > remitBy):
                    withheld x withholding_late_penalty_rate + withheld x withholding_late_penalty_monthly_rate x monthsLate
```

## Endpoint

`POST /enterprise-hub/tax-compliance/doctor-withholding/preview`, `tax:export`. Response: lines, totals by doctor, `latePenalty`, parameter versions used, `voucher.posted = false`, `notes`.
