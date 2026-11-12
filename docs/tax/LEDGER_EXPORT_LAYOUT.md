# Electronic commercial books export (دفاتر تجاری الکترونیکی) & Journal/Ledger (LDG-01)

Status:
- **Electronic commercial books**: **unverified** (`X-Layout-Status: unverified`; column headers aligned with `docs/tax/official/electronic-books-template.xlsx` downloaded from my.tax.gov.ir on 2026-11-11 per `docs/tax/official/README.md`, awaiting live portal upload confirmation).
- Legacy detailed journal and ledger CSV: **unverified** internal layout.

## 1. Electronic Commercial Books (سامانه دفاتر تجاری الکترونیکی)

Under Bylaw 95 (آیین‌نامه تحریر دفاتر - اصلاحیه ۱۴۰۴/۰۸/۲۱، بند الف-۲ ماده ۶)، taxpayers must upload financial event summaries according to the sample announced by the tax administration.
The upload file is an XLSX (or CSV) containing **account turnover** (گردش حساب‌ها) per kol, moein, tafsili (floating detail), and Jalali date.

### Endpoints

Both require the `tax:export` action. The tenant is strictly read from JWT.
Returns header `X-Layout-Status: unverified`.

| Endpoint | Content |
| --- | --- |
| `GET /enterprise-hub/tax-compliance/reports/electronic-books.xlsx?year[&quarter][&month][&half]` | Official Excel (XLSX) workbook matching `Sheet1` template |
| `GET /enterprise-hub/tax-compliance/reports/electronic-books.csv?year[&quarter][&month][&half]` | Official CSV (UTF-8 with BOM, CRLF) |
| `GET /enterprise-hub/tax-compliance/reports/commercial-books.xlsx` | Alias for `electronic-books.xlsx` |
| `GET /enterprise-hub/tax-compliance/reports/commercial-books.csv` | Alias for `electronic-books.csv` |

### Official Columns (Sheet1, row 1, A-I in exact order)

1. **کد حساب کل** (A): General ledger account code (from chart hierarchy or first 2 digits)
2. **عنوان حساب کل** (B): General ledger account name
3. **کد حساب معین** (C): Subsidiary account code
4. **عنوان حساب معین** (D): Subsidiary account name
5. **کد حساب تفصیلی** (E): Floating detail account code (`fin_dimensions.kind = 'DETAIL'` or party reference)
6. **عنوان حساب تفصیلی** (F): Floating detail account title
7. **گردش بدهکار (میلیون ریال)** (G): Debit turnover in million rials (exact decimal string, no float arithmetic)
8. **گردش بستانکار (میلیون ریال)** (H): Credit turnover in million rials (exact decimal string, no float arithmetic)
9. **تاریخ گردش حساب** (I): Jalali date `YYYY/MM/DD`

### Turnover & Totals Rules
- Data represents **account turnover**, not voucher lines: finalized posted voucher lines (`fin_journal_entries.status = 'POSTED'`) are aggregated per kol + moein + tafsili + date.
- Closing/opening pairs (`CLOSING_PERM`, `OPENING_AUTO`, `OPENING`, `OB-*`) are excluded.
- Amounts are converted from minor units (`scale 2`) to exact decimal strings without float arithmetic or rounding distortion via `minorToMillionRials` (or exact rials when `unit=rial`) in `modules/accounting/money.ts`.
- No per-row rounding or synthetic rounding plug account is applied, so accounts under 0.5M rials retain their exact turnover and total sum of debit turnover equals total sum of credit turnover.

---

## 2. Legacy Journal and Ledger CSV (Internal Export)

Status: **unverified**.

| Endpoint | Content |
| --- | --- |
| `GET /enterprise-hub/tax-compliance/reports/journal.csv?year&quarter` | Detailed journal, one row per posted line |
| `GET /enterprise-hub/tax-compliance/reports/ledger.csv?year&quarter[&accountCode]` | Ledger, per account an opening row, then lines with a running balance |

Returns header `X-Layout-Status: unverified`.

## Safety

Text cells starting with `= + - @ \t \r` are prefixed with `'` so strings cannot execute as spreadsheet formulas. A plain signed decimal is left as numeric.
