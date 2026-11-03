# Sample Company Fixture — شرکت بازرگانی سپهر البرز نمونه (سهامی خاص)

Fictional Iranian trading company dataset for end-to-end data import tests.
All names, company titles, phone numbers (`09000000xxx`), national/economic IDs (`10000000xxx`), and emails (`*@example.invalid`) are synthetic test fixtures.

## Expected Totals (IRR / ریال)

| Metric | Amount (IRR) | Raw Integer (IRR) | Notes |
|---|---:|---:|---|
| **Debit (جمع بدهکار افتتاحیه)** | 259,026,700,000 | `259026700000` | Balanced opening journal entry across 14 lines |
| **Credit (جمع بستانکار افتتاحیه)** | 259,026,700,000 | `259026700000` | Exactly equals opening debit (`debit === credit`) |
| **Receivables — Opening (مانده اول دوره حساب‌های دریافتنی `1201`)** | 1,840,000,000 | `1840000000` | Opening trade receivables balance |
| **Receivables — Closing Unique (مانده حساب‌های دریافتنی پس از صورتحساب‌های یکتا)** | 9,453,512,500 | `9453512500` | Opening + unpaid unique sales invoices |
| **Receivables — Closing Raw (مانده حساب‌های دریافتنی با احتساب سطر تکراری)** | 9,494,487,500 | `9494487500` | Opening + all unpaid sales invoice rows |
| **Payables — Opening (مانده اول دوره حساب‌های پرداختنی `2101`)** | 1,120,000,000 | `1120000000` | Opening trade payables balance |
| **Payables — Closing Unique (مانده حساب‌های پرداختنی پس از صورتحساب‌های یکتا)** | 5,420,780,000 | `5420780000` | Opening + unpaid unique purchase invoices |
| **Payables — Closing Raw (مانده حساب‌های پرداختنی با احتساب سطر تکراری)** | 5,447,400,000 | `5447400000` | Opening + all unpaid purchase invoice rows |
| **Stock Value (ارزش موجودی کالا در انبار `1301`)** | 252,026,700,000 | `252026700000` | Exact sum of `quantity × unitCost` across all 300 items |
| **Bank Closing Balance (مانده نهایی صورتحساب بانک `1101`)** | 2,485,000,000 | `2485000000` | Opening bank balance + 100 statement lines |

## Generated Files

- `chart-of-accounts.csv` & `chart-of-accounts.xlsx` — 18 standard accounts
- `opening-balances.csv` & `opening-balances.xlsx` — 14 balanced opening lines (`debit = credit = 259026700000`)
- `customers-suppliers.csv`, `customers-suppliers.xlsx`, & `customers-suppliers-win1256.csv` — 50 rows (30 customers + 20 suppliers; includes Persian/Arabic digits, Arabic `ي`/`ك`, merged name & company, and 2 duplicate rows)
- `items.csv` & `items.xlsx` — 300 inventory items (`stock value = 252026700000`)
- `invoices.csv` & `invoices.xlsx` — 240 sales & purchase invoices (144 sales + 96 purchases: 200 single-line + 40 multi-line with 2 to 6 items each, total 360 rows; includes 6 blank-customer walk-in rows, Persian/Arabic digits, Arabic `ي`/`ك`, and 2 duplicate rows)
- `bank-statement.csv` & `bank-statement.xlsx` — 100 bank statement lines
- `sample-company.xlsx` — Multi-sheet workbook containing all 6 tables

## Reproducibility

Regenerate from fixed seed (`14030701`):

```bash
node e2e/fixtures/sample-company/generate.js
```
