# Print templates

Plain HTML/CSS templates for the documents in `docs/accounting/research/PRINT_FORMS.md`.
**Not wired into any page.** Wiring is tracked in one issue per form.

| File | Page | Form |
|---|---|---|
| `sales-invoice-a4.html` | A4 portrait | Sales invoice, classic and Moadian e-invoice (`isEinvoice`) |
| `sales-invoice-a5.html` | A5 landscape | Short sales invoice |
| `accounting-voucher-a4.html` | A4 portrait | Accounting voucher with signature blocks |
| `receipt-payment-voucher-a5.html` | A5 landscape | Receipt / payment voucher |
| `cheque-receipt-a5.html` | A5 landscape | Cheque receipt with Sayad id |
| `warehouse-document-a4.html` | A4 portrait | Warehouse receipt / issue / transfer / adjustment |
| `payslip-a5.html` | A5 portrait | Payslip (same line set as `PayslipPrint`) |
| `pos-receipt-80mm.html` | 80 mm roll | POS receipt |
| `print-base.css` | | Shared styles |

## Placeholder syntax

Mustache-like and deliberately minimal so any renderer works:

- `{{path.to.value}}` text, HTML-escaped by the renderer.
- `{{#if flag}}...{{/if}}` conditional.
- `{{#each list}}...{{/each}}` loop; inside, fields refer to the item.

Rules for the caller:

1. Pass amounts as ready strings (integer rials, thousands separators, Persian digits). Templates do no maths.
2. Pass dates as Jalali strings. Money and dates are never computed in the template.
3. Escape every value. Never put user text into `style`, `href` or `src` without validation.
4. Provide the Vazirmatn `@font-face` from the host page (`src/app/fonts/Vazirmatn-Variable.woff2`).
5. The QR slot in the e-invoice is `unverified` (no official rule found); keep it behind `showQr`.
6. Test by opening a file in a browser and printing to PDF; the placeholders stay visible, which is intended.
