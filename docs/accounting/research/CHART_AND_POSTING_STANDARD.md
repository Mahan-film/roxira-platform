# Standard Iranian chart of accounts and posting conventions (research 2026-11-04)

Status of evidence: the **primary** documents (Audit Organization uniform chart, tax authority ledger template)
could not be fetched. Everything below comes from Persian accounting-education sites and vendor articles and
is marked `unverified` against the primary text. Verify with an Iranian accountant or the lawyer round before
treating any code as binding.

## 1. Structure

Levels used by Iranian accountants and by Sepidar's own docs: **گروه (group) → کل (kol) → معین (moein) →
تفصیلی (tafsili, optionally a second tafsili)**. Kol is the level reported to the tax authority and the one the
electronic ledger system asks for (kol code + kol title). Digit lengths are only loosely stated: group 1-2 digits,
kol 2-3, moein 2, tafsili free (one unique code per person/entity).

Kol table reported by mohaseban.org (2-digit kol, group by statement block), `unverified` against the Audit
Organization text:

| Block | Kol codes |
|---|---|
| Current assets | 11 موجودی نقد · 12 سرمایه‌گذاری کوتاه‌مدت · 14 حساب‌ها و اسناد دریافتنی · 15 سایر حساب‌های دریافتنی · 16 موجودی مواد و کالا · 18 سفارشات و پیش‌پرداخت‌ها · 19 دارایی‌های نگهداری‌شده برای فروش |
| Non-current assets | 21 اسناد دریافتنی بلندمدت · 22 سرمایه‌گذاری بلندمدت · 23 سرمایه‌گذاری در املاک · 24 دارایی‌های نامشهود · 25 دارایی‌های ثابت مشهود · 26 سایر دارایی‌ها |
| Current liabilities | 31 اسناد پرداختنی · 32 حساب‌های پرداختنی تجاری · 33 سایر پرداختنی‌ها · 34 مالیات پرداختنی · 35 سود سهام پرداختنی · 36 تسهیلات کوتاه‌مدت · 38 پیش‌دریافت‌ها و سپرده‌ها · 39 بدهی مرتبط با دارایی نگهداری‌شده برای فروش |
| Non-current liabilities | 41 اسناد پرداختنی بلندمدت · 42 پرداختنی تجاری بلندمدت · 45 تسهیلات بلندمدت · 46 ذخیره مزایای پایان خدمت |
| Equity | 51 سرمایه · 52 افزایش سرمایه در جریان · 53 صرف سهام · 54 اندوخته قانونی · 55 سایر اندوخته‌ها · 56 مازاد تجدید ارزیابی · 57 تفاوت تسعیر ارز · 58 سود انباشته · 59 عملکرد سود و زیان |
| Revenue | 61 فروش · 62 سایر درآمدهای عملیاتی |
| Expenses | 71 حقوق و دستمزد · 72 هزینه‌های عملیاتی · 73 توزیع و فروش · 74 سایر اقلام عملیاتی · 75 هزینه‌های مالی |
| COGS | 81 بهای تمام‌شده کالا و خدمات فروش‌رفته |
| Memorandum | 91 حساب‌های انتظامی · 92 طرف حساب‌های انتظامی |

A moein example from the same site: `1010101` bank rial, `1010102` bank foreign currency (group + kol + moein
+ currency digit) - shows that vendors differ in how they concatenate levels. Sepidar ships four default charts
(production, service, trading, contracting); their code lists are in articles whose bodies we could not fetch
(`sepidarsystem.com/blog/production-accounting-coding/` etc.). The "ledger standard file" of the electronic
ledger system requires kol code/title and must match the downloadable template: `unverified` headers.

## 2. Differences from `iran-chart-template.ts`

Our template: 5 groups (1 assets, 2 liabilities, 3 equity, 4 revenue, 5 costs+expenses), 2-digit kols (10, 11,
20, 21, 30, 40, 41, 50, 51, 52), 4-digit moeins. It is a US-style statement-block numbering, not the 2-digit-kol
scheme above.

| Topic | Standard (reported) | Our template | Impact |
|---|---|---|---|
| Kol numbering | 11,12,14... by statement line | 10/11 asset current/non-current, no kol per line | Tax ledger export needs kol = statement line; need a mapping table |
| Receivables | 14 trade+notes, 15 other | 1020/1021/1022 are moeins under kol 10 | Export would merge 14 and 15 |
| Inventory | kol 16 | moein 1030 | fine via mapping |
| Prepayments | kol 18 | 1040 | mapping |
| Non-current detail | 21-26 separate kols (intangible, tangible, investments) | one kol 11 with moeins 1110-1150 | cannot report per kol |
| Accumulated depreciation | contra moein inside 25 | 1120 separate | ok, keep contra flag |
| Payables | 31 notes, 32 trade, 33 other, 34 tax, 38 advances | 2010-2012, 2020-2021, 2070 under kol 20 | mapping |
| Long-term liabilities | 41,42,45,46 | 2110, 2120 under kol 21 | mapping |
| Equity | 51-59 incl. capital in progress, share premium, revaluation surplus, FX translation | 3010-3050 only | missing 52, 53, 56, 57 |
| Revenue | 61 sales, 62 other operating; returns/discount normally contra to 61 | 4010, 4020 sales, 4030 returns, 4110, 4120 | non-operating income missing in standard list: check |
| Payroll expense | 71 own kol | 5010 under kol 50 | mapping |
| COGS | kol 81 | 5110 in kol 51 | mapping |
| Memorandum accounts | 91/92 | absent | needed for guarantees and cheques in custody; add |
| Financial and tax expense | 75 finance; income tax expense (unverified kol) | 5210, 5220 | mapping |
| VAT | tax payable 34; VAT input commonly a current asset (own moein) | 2020 payable, 1045 receivable | ok, but name them the standard way |

Recommendation (not applied here): keep our 4-digit codes (live postings depend on them, see header comment of the
template) and add a **`standard_kol_code` mapping column** per moein for the tax ledger export, plus the missing
equity/memorandum moeins. Re-numbering the chart to the 2-digit-kol scheme is a bigger migration and needs
owner and lawyer approval.

## 3. Typical vouchers (Dr = بدهکار, Cr = بستانکار)

Source for all: Persian accounting teaching articles (maktabkhooneh, faradars, mohaseban, sepidarsystem
blogs); the shape is standard double-entry practice. Account names are generic; map to our codes in brackets.
Rates, thresholds and legal effects of VAT are parameters, not constants here.

1. **Credit sale with VAT.** Dr حساب‌های دریافتنی تجاری [1020] (total incl. VAT); Cr فروش [4010/4020]; Cr مالیات ارزش افزوده پرداختنی / فروش [2020]. Cash sale: Dr صندوق/بانک instead. Perpetual inventory adds Dr بهای تمام‌شده کالای فروش‌رفته [5110] / Cr موجودی کالا [1030].
2. **Credit purchase with VAT.** Dr موجودی کالا [1030] (or expense); Dr مالیات ارزش افزوده خرید [1045] (only if creditable); Cr حساب‌های پرداختنی [2010]. Non-creditable VAT is added to the cost.
3. **Sales return.** Dr برگشت از فروش [4030]; Dr VAT payable [2020] (reverse); Cr دریافتنی/نقد [1020]. Perpetual: Dr موجودی کالا / Cr بهای تمام‌شده.
4. **Purchase return.** Dr پرداختنی [2010]; Cr موجودی کالا; Cr VAT خرید [1045].
5. **Receipt (cash/bank).** Dr صندوق/بانک [1011/1012]; Cr دریافتنی [1020] (tafsili = customer). **Payment:** Dr پرداختنی [2010] (tafsili = supplier); Cr صندوق/بانک.
6. **Cheque received (چک دریافتنی).** On receipt: Dr اسناد دریافتنی (در جریان وصول) [1021]; Cr دریافتنی [1020]. On clearing: Dr بانک [1012]; Cr اسناد دریافتنی [1021]. Bounced: reverse (Dr دریافتنی / Cr اسناد دریافتنی), revenue is not re-recognised. Endorsed to a supplier: Dr پرداختنی / Cr اسناد دریافتنی. Deposited to bank for collection (انتقال به بانک) may use a separate "اسناد در جریان وصول" moein. See also `docs/accounting/CHEQUES.md`.
7. **Cheque issued (چک پرداختنی).** On issue: Dr پرداختنی [2010]; Cr اسناد پرداختنی [2011]. On clearing: Dr اسناد پرداختنی [2011]; Cr بانک [1012]. Returned/cancelled: reverse.
8. **Payroll.** Accrual: Dr هزینه حقوق [5010]; Dr هزینه بیمه سهم کارفرما [5040]; Cr حقوق پرداختنی [2050]; Cr بیمه پرداختنی [2030] (employee + employer share); Cr مالیات حقوق پرداختنی [2040]; Cr سایر کسورات [2060]. Payment: Dr حقوق پرداختنی / Cr بانک; later Dr 2030/2040 / Cr بانک. Rates and exemptions come from the yearly payroll law (see payroll code), not from here.
9. **Depreciation.** Dr هزینه استهلاک [5060]; Cr استهلاک انباشته [1120]. Method and rates from the Direct Taxes Act tables (separate legal source).
10. **VAT settlement (end of tax period).** Dr VAT payable [2020]; Cr VAT خرید [1045]; the difference stays as payable (Cr بانک when paid) or as a receivable if input exceeds output. Period is the Jalali season for most taxpayers (`unverified` for special cases).
11. **Year-end closing (اختتامیه).** (a) Close revenues: Dr each revenue (and contra) account; Cr خلاصه سود و زیان [3050]. (b) Close expenses: Dr [3050]; Cr each expense account. (c) Move result: profit: Dr [3050] / Cr سود و زیان انباشته [3040]; loss reversed. Then the closing balance sheet voucher (بستن حساب‌های دائمی) and, next year, the opening voucher (سند افتتاحیه) restore balances, with tafsili detail kept. Some firms use the standard's "عملکرد سود و زیان" (59) in place of our 3050.

Open point `unverified`: whether the Audit Organization chart prescribes the exact moein for "اسناد در جریان وصول".

## 4. Sources

- https://mohaseban.org/کدینگ-حسابداری-بازرگانی-چیست/ (kol table)
- https://virgool.io/@miina/کدینگ-در-حسابداری-aahwgggwx2bp (level and digit conventions)
- https://www.sepidarsystem.com/blog/accounting-coding (five levels)
- https://www.sepidarsystem.com/series/accounting-coding/ (default charts, bodies not fetched)
- https://maktabkhooneh.org/mag/value-added-accounting-registration/ and https://blog.faradars.org/نحوه-ثبت-حسابداری-با-ارزش-افزوده/ (VAT vouchers)
- https://maktabkhooneh.org/mag/check-bookkeeping/ and https://www.sepidarsystem.com/blog/registration-of-receivables-and-payables-in-accounting/ (cheques)
- https://www.sepidarsystem.com/blog/cheques-operation-in-sepidar-software/ (cheque lifecycle in a product)
- https://www.ekhtebar.ir (electronic ledger system guide; titles/order must match the template)
