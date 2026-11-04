# Print forms for an Iranian accounting suite (research, 2026-11-04)

Scope: the documents a Roxira customer prints and hands to a buyer, an auditor, an employee or a
warehouse clerk. For each form: required fields, legal basis, usual layout, and the template that
implements it (`output_apps/enterprise_hub/frontend/src/print-templates/`).

Evidence labels used below:

- **verified (repo)**: read in `docs/legal_sources/iran/` (official Moadian documents, Tir 1405 instruction).
- **verified (web)**: read on a public Iranian page on 2026-11-04 (URL in Sources).
- **convention**: what Iranian accounting software and accountants print by habit. Not a legal duty.
- **unverified**: could not be confirmed from a primary source in this session. Do not rely on it
  for compliance. Each one needs a human check (lawyer or tax accountant) before it is enforced.

Research limits: the search stack returned mostly news and vendor pages. No page with the official
ministry form image, no tax.gov.ir print guide and no intamedia.ir page could be fetched. The
official Moadian documents in the repo define the data of the e-invoice, not its printed look. Every
claim about "how it must look on paper" is therefore `convention` or `unverified`.

## 0. Cross-cutting rules (all forms)

| Rule | Status |
|---|---|
| RTL, Persian digits on paper, Jalali dates `yyyy/mm/dd` | convention |
| Amounts in integer rials with thousands separator (stored amounts are integer rials, `modules/accounting/money.ts`) | verified (repo) |
| Font Vazirmatn (bundled in `frontend/src/app/fonts/`), fallback Tahoma | verified (repo) |
| A4 portrait for documents with lines; A5 landscape for short vouchers; 80 mm roll for POS | convention |
| Every document carries tenant name, document number, issue date, page `n / N` | convention |
| A document printed from a draft carries a «پیش‌نویس» watermark | design choice |
| No erasure on an official invoice; a mistake is a corrective or cancel document (`ins` 2/3), never an edit | verified (web) + verified (repo) |

## 1. Sales invoice (صورتحساب فروش کالا و خدمات)

Two looks exist in practice. Roxira prints both from one template with a flag.

### 1a. Classic ministry-style form («فاکتور رسمی»)

Legal basis: Direct Taxes Act art. 95 and its executive regulation name the data an invoice must
carry (article numbers not re-read in this session: `unverified`). The field list below comes from a
public accountant-training page (verified (web), mohaseban.org «فاکتور رسمی»); it is a training site,
not the regulation.

- Header: invoice number, sale date, title «صورتحساب فروش کالا و خدمات».
- Seller block: name, address, phone, economic code (کد اقتصادی), national id / company national id
  (شناسه ملی), registration number, postal code.
- Buyer block: name, address, phone, economic code or national id / registration number, postal code.
  A search summary of an official circular says: for a final-consumer type-2 POS sale the address,
  buyer identity and economic code are not mandatory; in other sales identity and address are
  required but the economic code is not (`unverified`, circular number not seen).
- Item table: row, goods/service id (شناسه کالا/خدمت, 13 digits per line), description, quantity, unit
  of measure, unit price, amount before discount, discount, amount after discount, VAT rate and VAT,
  line total.
- Totals: before discount, discount, after discount, VAT and duties (مالیات و عوارض), grand total, in
  words (به حروف).
- Payment: cash / credit / mixed; Moadian `setm`, `cap`, `insp` (verified (repo)).
- Signatures: seller stamp and signature mandatory on a paper official invoice, buyer's optional
  (verified (web)). The red pre-printed serial (offset or embossed) applies to pre-printed pads only
  (verified (web)); software prints the number in the header.

Usual layout (convention): title centred; number and date on the far corner; seller block full width
under the title, buyer block under it; item table; totals box bottom; in-words line; two signature boxes.

### 1b. E-invoice (Moadian) printed form

Legal basis: Tir 1405 e-invoice instruction and the technical connection document of 1401/04/22
(verified (repo)).

| Printed item | Moadian field | Rule (verified (repo)) |
|---|---|---|
| شماره منحصر به فرد مالیاتی | `taxid` | mandatory on every type 1 and 2 template; 22 chars: 6-char memory id + 5 hex days since 1970-01-01 + 10 hex serial + 1 check digit |
| سریال داخلی | `inno` | 10 hex chars, equals chars 12-21 of `taxid` |
| تاریخ و زمان صدور | `indatim` | mandatory |
| نوع (1/2) and الگو | `inty`, `inp` | type 3 is the bank-POS receipt, not submitted as JSON |
| موضوع (اصلی/اصلاحی/ابطالی/برگشت از فروش) | `ins` | 1-4; 2-4 require `irtaxid` |
| Seller economic code | `tins` | 11 or 14 digits |
| Seller branch | `sbc` | optional |
| Buyer type, id, economic code, postal code | `tob`, `bid`, `tinb`, `bpc` | conditional on type and pattern |
| Lines | `sstid sstt am mu fee prdis dis adis vra vam tsstam` | rials |
| Totals | `tprdis tdis tadis tvam todam tbill` | |
| Settlement | `setm cap insp` | |
| Notes | `nti1 nti2` | optional |

Not in the official documents we hold: a mandated print layout, a mandatory QR code, or a mandated
position of the tracking code (کد رهگیری). Public vendor pages (verified (web), search summaries of
sepidarsystem.com, systemgroup.net, thdorsan.com) say only that the system returns a tracking code
after a successful send and that a PDF alone is not an e-invoice. Template decision: print `taxid`
(large, monospace), the tracking code when present, and the line «ارسال‌شده به سامانه مودیان»; the QR
slot is behind a flag and is `unverified`.

Special patterns (gold, fuel, insurance, currency sale, export, airline, contracting) add header
fields such as `crn` contract number, `cdcn` customs, `bpn` passport. The template has an "extra
header facts" block; per-pattern lists stay in `docs/legal_sources/iran/moadian-fields.md`.

Corrective, cancel and return documents (`ins` 2/3/4): title becomes «صورتحساب اصلاحی / ابطالی /
برگشت از فروش» and the reference `irtaxid` must be printed (verified (repo)).

Templates: `sales-invoice-a4.html`, `sales-invoice-a5.html`.

## 2. Accounting voucher (سند حسابداری)

Legal basis: books and supporting documents are required by law; the voucher format is not prescribed
(`unverified`, no primary text read). Everything below is convention from Iranian accounting software
and training sites.

- Voucher number (شماره سند), daily sequence (شماره عطف), Jalali date, type (عمومی، افتتاحیه، اختتامیه،
  اصلاحی), status (موقت / قطعی), fiscal year, description.
- Table: row, account code (کل / معین / تفصیلی), account name, line description, optional detail (party,
  cost centre, project), debit, credit.
- Footer: debit total = credit total, total in words, referenced documents (invoice, cheque numbers).
- Signature blocks: «تنظیم‌کننده», «حسابدار», «مدیر مالی», «مدیرعامل / تأییدکننده».

Layout: header strip, table fills the page with repeated head, bold totals, signature row at the bottom.

Template: `accounting-voucher-a4.html`.

## 3. Receipt and payment voucher (رسید دریافت / پرداخت)

No legal text found (`unverified`); convention of treasury modules.

Fields: number, date, payer / payee and id, amount in digits and words, payment lines (cash to fund,
transfer with account and tracking number, cheque with number, bank, due date, POS), purpose, related
invoices, the ledger voucher number it posted to. Signatures: receiver and cashier (receipt); payee and
approver (payment).

Template: `receipt-payment-voucher-a5.html` (A5 landscape, title by placeholder).

## 4. Cheque receipt (رسید چک)

The cheque itself is governed by the Commerce Code and the Sayad regime; the receipt we hand over is an
internal document (`unverified`). Lifecycle: `docs/accounting/CHEQUES.md`.

Fields: receipt number and date; direction (received / issued); per cheque: number, **Sayad id**
(16 digits), bank and branch, account owner, account number, amount in digits and words, due date,
status, endorsement chain; holder; giver and receiver signatures; «بابت» with invoice reference.

Template: `cheque-receipt-a5.html`.

## 5. Warehouse receipt and issue (رسید / حواله انبار)

No legal text found (`unverified`); stock-keeping convention. Roxira's documents are `receipts`,
`deliveries`, `transfers`, `adjustments` (`modules/inventory/controllers/stock-documents.controller.ts`).

Fields: type (رسید ورود / حواله خروج / انتقال / تعدیل), number, date, warehouse (and destination for a
transfer), counterparty, reference invoice or order; table: row, item code, name, unit, quantity, unit
cost, amount (cost columns optional, often hidden on the clerk copy), description. Signatures: warehouse
keeper (انباردار), receiver / deliverer, approver.

Template: `warehouse-document-a4.html` (`{{docTitle}}` switches direction).

## 6. Payslip (فیش حقوقی)

Amount rules come from labour and social-security law. That a payslip must be issued monthly is
convention; no text confirming a duty was found (`unverified`). Deduction items confirmed on a public
page (verified (web), mohaseban.org «کسورات حقوق و دستمزد»): employee insurance 7% of insurable wage,
progressive income tax after exemptions, optional supplementary health, court-ordered deductions,
company deductions (advance, loan).

Fields (same set as `PayslipPrint` in `modules/hr/services/payslip-pdf.ts`): company, Jalali month and
year, employee name, personnel number, national id, insurance number, job title, work days; earnings:
base salary, seniority, housing, food, child, marriage, overtime, night shift, holiday, عیدی; deductions:
absence, insurance, income tax, other; totals: gross, deductions, net; informational employer insurance
and unemployment insurance. Employee acknowledgement signature optional.

The server A4 PDF already exists (PAY-02). This HTML template serves browser printing until the
download button is wired; it must keep the `PayslipPrint` line set.

Template: `payslip-a5.html`.

## 7. POS 80 mm receipt

Tir 1405 §3-3 (verified (repo)): the bank-POS receipt carries payment amount, acceptor details (switch
number, merchant acceptor number, terminal number), tracking number, payment date and time, minimum
seller details and `taxid`. For Roxira's own POS (type-2 invoice) the usual content is below; buyer
details are not required on an anonymous type-2 sale (`unverified` circular).

Fields: shop name, seller economic code, branch, short address, receipt number, date and time, cashier,
lines (name, qty × unit price, total), subtotal, discount, VAT, total, payment split, `taxid` and
tracking code when sent, policy line.

Layout: roll 80 mm, printable ~72 mm, 11-12 px, dashed separators, `@page { size: 80mm auto; }`.

Template: `pos-receipt-80mm.html`.

## 8. Wiring

Wiring templates into pages is the laptop lane (`claude-win`), one issue per form: sales invoice A4
#255, sales invoice A5 #256, accounting voucher #257, receipt/payment voucher #258, cheque receipt #259,
warehouse document #260, payslip #261, POS 80 mm #262.
Server PDF writers (`modules/accounting/reports/pdf-writer.ts`, `modules/hr/services/payslip-pdf.ts`)
stay as they are.

## 9. Open questions for the owner or a tax accountant

1. Must the printed e-invoice show a QR code or only `taxid` and the tracking code? (`unverified`)
2. Does the regulation require the buyer's economic code on a printed type-1 invoice, per buyer type?
3. Does the auditor require a stamped receipt voucher, or is the ledger voucher enough?
4. Should the warehouse clerk copy hide cost columns by default?

## Sources

- Repo: `docs/legal_sources/iran/moadian-fields.md`, `e-invoice-instruction-tir-1405.txt`,
  `moadian-technical-connection-14010422.txt`, `terminals-moadian-law.txt`.
- [mohaseban.org: فاکتور رسمی](https://mohaseban.org/%d9%81%d8%a7%da%a9%d8%aa%d9%88%d8%b1-%d8%b1%d8%b3%d9%85%db%8c/)
- [mohaseban.org: کسورات حقوق و دستمزد](https://mohaseban.org/%da%a9%d8%b3%d9%88%d8%b1%d8%a7%d8%aa-%d8%ad%d9%82%d9%88%d9%82-%d9%88-%d8%af%d8%b3%d8%aa%d9%85%d8%b2%d8%af/)
- [sepidarsystem.com: accounting system](https://www.sepidarsystem.com/products/sepidar/accounting-system/)
- [sepidarsystem.com: صورتحساب چیست؟](https://www.sepidarsystem.com/blog/electronic-bill/)
- [beytoote.com: e-invoice guide](https://www.beytoote.com/scientific/laws/electronic-tax-01invoice.html) (news-style, no field list)
