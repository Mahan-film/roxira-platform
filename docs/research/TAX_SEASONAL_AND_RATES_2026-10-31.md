# Seasonal VAT / transactions report and statutory rates (checked 2026-10-31)

Scope: PR adding `/app/tax`, `GET enterprise-hub/tax-compliance/reports/*` and the 1405 payroll check.
Everything below was read from **public secondary sources**. None is the official gazette or the tax
authority portal (tax.gov.ir needs a login). Items marked **ACCOUNTANT TO CONFIRM** are not settled.

## 1. VAT rate

| Claim | Source | Status |
|---|---|---|
| VAT stays 10% in 1405 ("همچنان با نرخ ۱۰ درصد") | [rade.ir, 27 Tir 1405](https://www.rade.ir/32905-%D9%85%D8%A7%D9%84%DB%8C%D8%A7%D8%AA-%D8%A8%D8%B1-%D8%A7%D8%B1%D8%B2%D8%B4-%D8%A7%D9%81%D8%B2%D9%88%D8%AF%D9%87/) | secondary |
| Rise 9% to 10% came from the 1404 budget law | same page (no article number given) | secondary |
| A 12% rate appeared in the **1405 budget bill** | news search results (bankavl.com, tejaratnews.com) | bill only, not enacted per rade.ir |

`DEFAULT_VAT_RATE = 0.1` (and the tenant `default_vat_rate` default) is kept. Test:
`seasonal-report.spec.ts` "default VAT rate is 10%".
**ACCOUNTANT TO CONFIRM** against the enacted 1405 budget law and the VAT law (قانون مالیات بر ارزش افزوده, 1400) text;
the article number was not found. Gold/jewellery wage and some goods have special rules and are not modelled.

## 2. Seasonal transactions (معاملات فصلی)

- Basis: Direct Taxes Act art. 169, note 3. File within 45 days after each quarter ends; next working day if it
  falls on a holiday. Via the tax authority "معاملات فصلی" portal, separate sales and purchase reports.
  Sources: [sepidarsystem.com guide](https://www.sepidarsystem.com/blog/quarterly-trading-system),
  [heyvalaw.com](https://www.heyvalaw.com/web/articles/view/2520/نحوه-ارسال-صورت-معاملات-فصلی.html).
- Penalty cited: 1% of the unreported transaction value (same guide). **ACCOUNTANT TO CONFIRM.**
- Quarters are Jalali: Farvardin-Khordad, Tir-Shahrivar, Mehr-Azar, Dey-Esfand. Implemented in
  `utils/jalali-quarter.util.ts` with half-open ranges at Tehran midnight, tested for contiguity and for the
  Esfand length (30 in leap 1403, 29 in 1405).
- **Official column layout and upload file format were NOT found.** No source listed the columns or whether
  Excel/JSON is accepted. Our CSV (invoice no., Jalali date, buyer, buyer national id and economic code,
  base, VAT, total, status) is our own layout, labelled as such in the API notes and the UI. It is not an upload file.
- Purchases and input VAT are not stored in the suite (no purchase entity exists), so the report returns
  `purchases.available=false` rather than zero. The accountant enters purchases separately.
- Included invoices: domestic (IR), status ISSUED or PAID, `issued_at` inside the quarter. Drafts and cancelled
  are excluded. Cancellation after quarter end, credit notes and returns are not netted. **ACCOUNTANT TO CONFIRM.**
- The annual purchases and sales report (آمار فصلی/سالانه) is the four quarters of the same data; no separate
  annual form was found, so no annual-specific export was built.

## 3. 1405 payroll rates (`hr/constants/payroll-rates.ts`)

Source: Supreme Labour Council decree dated 1404-12-24, text on
[ekhtebar.ir](https://www.ekhtebar.ir/%D9%85%D8%B5%D9%88%D8%A8%D9%87-%D8%B4%D9%88%D8%B1%D8%A7%DB%8C-%D8%B9%D8%A7%D9%84%DB%8C-%DA%A9%D8%A7%D8%B1-%D8%AF%D8%B1-%D8%AE%D8%B5%D9%88%D8%B5-%D8%AA%D8%B9%DB%8C%DB%8C%D9%86-%D8%AD%D8%AF%D8%A7%D9%82/).

| Field | Code | Decree page | Result |
|---|---|---|---|
| min daily wage | 5,541,850 | 5,541,850 | confirmed |
| housing allowance | 30,000,000 | 30,000,000 | confirmed |
| seniority | 5,000,000/month | 166,666/day (about 4,999,980) | consistent, kept |
| consumer goods allowance | 22,000,000 | digits garbled ("22.0000.000") | corroborated by one search summary only |
| wage tax brackets, 400M exemption | as coded | not on that page | only the 400M exemption corroborated (several sources); bracket steps unconfirmed |

No numeric value was changed. `verified` stays `false`; only the `source` text was extended with this audit and
a test pins the two confirmed figures. **ACCOUNTANT TO CONFIRM** food allowance and the tax brackets against
the official circular and the 1405 budget law.

## 4. Moadian UI

`/app/tax` shows the `MOADIAN_ENABLED` flag and whether credentials are stored (`GET moadian/status`), and
disables submit when the flag is off. After submit it polls `moadian/invoices/:id/status` every 5 s (max 24).
`SUCCESS` is labelled "inquiry succeeded per the system response", never "accepted". The client has not been
exercised against the real or sandbox Moadian environment.
