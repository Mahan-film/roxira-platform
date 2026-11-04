# Contract statutory parameters (HR-CON-01, issue #228)

Checked 2026-11-04 for laptop track T3 (#227). Status key: **secondary** = stated consistently by several
accounting or legal websites, not yet checked against the text on rc.majlis.ir or tamin.ir (seeded with
`verified = false`). **unclear** = no figure could be established; the store holds NULL with `unclear = true`.
No figure here was typed from memory. Seeded for fiscal year 1405 only; a date before 1405/01/01 resolves to "no figure" (unclear).

| Store key | Seeded | Status | What the sources say |
|---|---|---|---|
| `contract_retention_rate` | 0.1 | secondary | General Conditions of Contract (شرایط عمومی پیمان, art. 35 as quoted): the employer keeps 10% of each payment as good-performance retention; half is returned at provisional handover, half at final handover. A contract term, not a statute: private contracts may differ. |
| `contract_insurance_deposit_rate` | 0.05 | secondary | Social Security Act art. 38: the employer pays the last 5% of the total contract price only against a clearance certificate (مفاصاحساب) from the Social Security Organisation; note 1 (added 1372) lets the employer settle debts from the 5% and the last instalment. |
| `contract_insurance_rate_mechanical` | 0.07 | secondary | SSO circular 14 (درآمد): non-civil mechanised contracts, 7% of gross work. Unemployment insurance is on top (see below). |
| `contract_insurance_rate_non_mechanical` | 0.15 | secondary | Same circular: wage or non-mechanised service contracts, 15% of gross work. |
| `contract_insurance_rate_civil_executive` | NULL | unclear | Sources give 6.6% (6% + 0.6%) based on Supreme Social Security Council resolutions 129 and 143, but split the unemployment part differently. |
| `contract_insurance_rate_civil_consulting` | NULL | unclear | 15.6% appears in one source only. |
| `contract_unemployment_addon_fraction` | NULL | unclear | Sources say "one ninth" of the coefficient (7% becomes 7.78%, 15% becomes 16.67%); the exact base is not in an official text we read. |
| `contract_tax_withholding_rate` | NULL | unclear | Direct Taxes Law art. 104 (the old 3% / 5% on-account deduction from contractors) was repealed by clause 25 of the amending law of 1394/04/31 (edalatsara.com shows the repeal note). What replaced it was not established from an official text. Do not default to 3% or 5%. |
| `contract_advance_payment_max_rate` | NULL | unclear | Advance payment limits are a term of public-sector contracts, not a statute for private ones; no official figure was established. |

Also checked: SSO ruling that the contract-premium rule is lawful (Guardian Council opinion 1381/09/25, Administrative
Court of Justice ruling 9 of 1384/01/14, as quoted by secondary sources).

## URLs read

- https://www.sepidarsystem.com/blog/contractor-insurance/ (coefficients by contract type; secondary)
- https://persianacc.ir/tamin-made-38-2/ , https://bidbarg.net/regulation/tamin/38/ , https://wikihoghoogh.net/wiki/ماده_38_قانون_تامین_اجتماعی (art. 38 text; secondary)
- https://edalatsara.com/rules/قانون-مالیاتهای-مستقیم/ماده-104 (art. 104 repeal note)
- https://www.ekhtebar.ir/ pages for the art. 38 regulation and the construction workers' insurance law could not be opened by the fetcher (redirect page only); they are the next official sources to read by hand.

## To close each `unclear` row

Read the text on rc.majlis.ir or tamin.ir, put it in this folder, then record the value with
`PUT /enterprise-hub/hr/statutory-parameters` (tenant) or a new platform migration.
