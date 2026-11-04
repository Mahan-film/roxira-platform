# Electronic journal and ledger CSV export (LDG-01)

Status of the layout: **unverified**.

The regulation requires electronic books to be uploaded "according to the sample announced by the
organization" (`docs/legal_sources/iran/aeinnameh-mavad-95-owner-copy.md`, chapter 4 article 6 item
a-2, around line 172; definitions of the journal and ledger at lines 11 and 13; ledger posting by the
15th of the next month at line 164; summary to the machine at least monthly at line 172). That
sample itself is not in `docs/legal_sources/iran/` or `docs/research/`, so the file layout is
unverified. The columns below are Roxira's own. They are not an
upload file for any tax system. The API sends `X-Layout-Status: unverified` and the UI says so.
When an official layout is found, add the source under `docs/legal_sources/iran/`, change this file
and `LEDGER_EXPORT_LAYOUT_STATUS` in `modules/tax_compliance/reports/ledger-export.service.ts`.

## Endpoints

Both need the `tax:export` action. The tenant comes from the JWT. `year` and `quarter` select a
Jalali season (Tehran-day bounds, half open).

| Endpoint | Content |
| --- | --- |
| `GET /enterprise-hub/tax-compliance/reports/journal.csv?year&quarter` | Electronic journal, one row per posted line |
| `GET /enterprise-hub/tax-compliance/reports/ledger.csv?year&quarter[&accountCode]` | Ledger, per account an opening row, then lines with a running balance |

Only `POSTED` entries are exported. The year-end closing pair (`CLOSING_PERM`) and the automatic
opening pair (`OPENING_AUTO`) are left out, as in the accounting reports. A season with more than
200000 lines is refused; narrow the account (ledger) or ask for a smaller period.

## Journal columns (UTF-8 with BOM, CRLF, comma separated)

1. شماره سند (entry number)
2. تاریخ سند (شمسی) `YYYY/MM/DD`
3. ردیف (line number inside the entry)
4. کد حساب
5. نام حساب
6. شرح (line description, else the entry description)
7. کد طرف حساب
8. بدهکار (ریال), exact decimal with two places
9. بستانکار (ریال), exact decimal with two places

Rows are ordered by entry date, entry id, line id. Total debit equals total credit.

## Ledger columns

1. کد حساب
2. نام حساب
3. شماره سند (empty on the opening row)
4. تاریخ سند (شمسی)
5. ردیف
6. شرح (`مانده ابتدای دوره` on the opening row)
7. بدهکار (ریال)
8. بستانکار (ریال)
9. مانده (ریال، بدهکار مثبت): running balance, debit minus credit

The opening balance is the debit minus credit of every posted entry dated before the season.
Accounts with an opening balance but no line in the season still get their opening row.

## Safety

Text cells starting with `= + - @` TAB or CR are prefixed with `'` so a description cannot run as a
spreadsheet formula. A plain signed decimal (a negative balance) is left as a number.
