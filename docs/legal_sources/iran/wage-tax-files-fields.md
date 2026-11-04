# Wage-tax (salary.tax.gov.ir) upload files WP and WH: what is known

Status: **no field-level layout was found. Everything about position, width, order, separator and code tables is `unclear`.**
Researched 2026-11-04 for requirement PAY-01. The official guide ("دفترچه راهنمای تهیه فایل الکترونیکی لیست حقوق", current
version noted by sources as 1.7.0.4) is linked from salary.tax.gov.ir and tax.gov.ir page 16; **both hosts timed out from the
build machine** (tried 2026-11-04), and search did not return the booklet. No guessed layout is shipped.

## Sources

| # | Source | What it states | Weight |
| --- | --- | --- | --- |
| T1 | https://www.sepidarsystem.com/blog/sepidar-payroll-system-instruction/ (read 2026-11-04) | The system creates WP, WH and WK. WP = per-employee detail (name, insurance number, place of service, hire date; not created when nothing changed). WH = tax calculation detail: national id, actual months worked since the start of the year, currency type, currency conversion type, start date, end date, employment status, gross regular cash payments of the month (rials), overdue regular payments with no tax recorded, non-regular non-cash benefits, Eidi and year-end benefits. WK = year, month, tax debt this month, tax debt to last month, payment method, bank code. | Vendor tutorial. Content only. |
| T2 | https://khanehesabdari.com/ارسال-فهرست-مالیات-حقوق-و-دستمزد/ | Files must be WP, WH or WK format; several files are zipped. | Blog. No structure. |
| T3 | search snippets for "WPYYYYMM.TXT / WHYYYYMM.TXT, no separator characters" | Names `WPYYYYMM.TXT`, `WHYYYYMM.TXT`; fixed-width, no separators. Seen only in a search summary, not confirmed on a page we read. | **Unconfirmed.** |
| T4 | the owner's research report (cited in `docs/hr/STATUTORY_OPEN_ITEMS.md`) | Only WP and WH go up, as TXT or ZIP; WK is gone in the new format; list is main, additional or corrective. | Report. |
| T5 | https://accsupport.nosa.com/tabid/63/aft/1188/Default.aspx | Export is a text file; names like `DYYYYMM`; no layout. | Vendor forum. |

## WH content items named by sources (order, width, type of each: `unclear`)

| Item | Our data | In today's working file |
| --- | --- | --- |
| national id | have | yes |
| actual months worked since start of the year | have (payroll months on record) | no |
| currency type, currency conversion type | no (always rials) | no |
| start date, end date | have | no |
| employment status | no | no |
| gross regular cash payments of the month | have | `gross_pay` |
| overdue regular payments with no tax recorded | no | no |
| non-regular non-cash benefits | have | `non_cash` |
| Eidi and year-end benefits | have | `eidi` |
| insurance type, exemptions, tax | have | `employee_insurance`, `taxable_income`, `income_tax` |

## WP content items (order, width, type: `unclear`)

name and family name, insurance number, place of service, hire date, employment type, education degree, nationality,
contract type, national id, phone, address (T1, T2). We hold name, father name, birth date, national id, hire date.
Changed-identity detection is not built (only new hires appear).

## Whole-file rules

| Topic | Value | Status |
| --- | --- | --- |
| Which files go up | WP and WH (WK removed in the new format) | T4; T1 still describes WK, so `unclear` |
| File type | text, `WPYYYYMM.TXT` / `WHYYYYMM.TXT` | T3 only: `unclear` |
| Separator / fixed width | no separator, fixed width | T3 only: `unclear` |
| Encoding | not stated | `unclear` |
| Field order, widths, code tables (list type, payment type, currency, employment status) | not found | `unclear` |

## What the code does

`WP-YYYYMM-working.csv` and `WH-YYYYMM-working.csv` stay **working files with our own columns** for an accountant to check.
`uploadReady` is false and the response carries `unverified[]`, which the payroll page shows. No upload file is produced
until the booklet (or one real accepted file) gives the layout.
