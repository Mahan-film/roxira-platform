# Official electronic commercial books template

`electronic-books-template.xlsx`: the upload template of the tax administration's electronic commercial books system (دفاتر تجاری الکترونیکی), downloaded by the owner from my.tax.gov.ir on 2026-11-11. One sheet (`Sheet1`), headers in row 1, columns A-I in this order:

| Col | Header |
|---|---|
| A | کد حساب کل |
| B | عنوان حساب کل |
| C | کد حساب معین |
| D | عنوان حساب معین |
| E | کد حساب تفصیلی |
| F | عنوان حساب تفصیلی |
| G | گردش بدهکار (میلیون ریال) |
| H | گردش بستانکار (میلیون ریال) |
| I | تاریخ گردش حساب |

Notes for the export (T80):
- It is **account turnover** per kol/moein/tafsili and date, not one row per voucher line; there is no row number or description column.
- Amounts are in **million rials**. How fractions must be written (decimals or rounding) is not stated in the template; ask the accountant before release and keep the conversion in one place, from bigint rials via `modules/accounting/money.ts`.
- This file replaces the earlier provisional 9-column layout from secondary sources.
