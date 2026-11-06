# Task: wire the sales invoice A4 print template (issue #255)

Worktree: /home/mahan/Developer/roxira-wt/255-wire-print-template-sales-invoice-a4-cla
App root: output_apps/enterprise_hub/frontend (run npx commands there). Do NOT commit. Do NOT edit package.json, lockfiles, app-shell.tsx, app.module.ts. Do not touch output_apps/enterprise_hub/modules/*.

Reference pattern (already in repo, read only what you need):
- src/lib/print/accounting-voucher.ts: pure mapper `mapJournalEntryToVoucherData(entry, statusLabel): Record<string, unknown>`.
- src/lib/print/open-print-window.ts: `printVoucher` opens a window, writes html from renderTemplate, prints.
- src/lib/print/render-template.ts: `renderTemplate(template, data)`; it HTML-escapes every `{{x}}` value itself. Do not write your own escaping.
- src/print-templates/accounting-voucher-a4.template.ts: the template as `export const X = String.raw\`...\`` with print-base.css inlined into a <style> block.
- src/print-templates/sales-invoice-a4.html: the source template (placeholders listed in print-templates/README.md).

## Files to create
1. src/print-templates/sales-invoice-a4.template.ts: export `SALES_INVOICE_A4_TEMPLATE`. Copy sales-invoice-a4.html exactly, but replace the `<link rel="stylesheet" href="print-base.css">` with an inlined `<style>` containing print-base.css (copy it from src/print-templates/print-base.css, same way as the voucher template). Keep the html comment block out or keep it; no logic changes.
2. src/lib/print/sales-invoice.ts: export `mapInvoiceToSalesInvoiceA4Data(invoice: InvoiceResponseDto, statusLabel: string): Record<string, unknown>`. Import the type from src/types/invoicing.ts. Use formatters from src/lib/fa-format.ts (formatJalaliDate, formatNumber, formatMoneyRial) and integerToPersianWords from src/lib/persian-words.ts, CURRENCY_LABELS and isForeignInvoice / invoiceRialEquivalent from src/types/invoicing.ts.
3. src/lib/print/open-sales-invoice-window.ts: export `printSalesInvoice(invoice, statusLabel): void`, same shape as printVoucher in open-print-window.ts, using SALES_INVOICE_A4_TEMPLATE and the mapper.
4. src/lib/print/sales-invoice.test.ts: node:test, run with `npx --yes tsx --test src/lib/print/sales-invoice.test.ts`.

## Field mapping (exact)
- docTitle: "فاکتور فروش". invoiceNumber: invoice.taxInvoiceNumber. issueDateJalali: formatJalaliDate(invoice.issuedAt ?? invoice.createdAt). issueTime: "" (no time field decided here).
- statusLabel passed in. isDraft: invoice.status === InvoiceStatus.DRAFT (check the enum in types/invoicing.ts lines 3-9 for the exact member name).
- isEinvoice: true only when invoice.einvoiceType is a real Moadian type (read enum EInvoiceType lines 66-78; if the enum has a "none" member, use it to set false). einvoiceType: EINVOICE_TYPE_LABELS value or "".
- Legal Moadian fields not in the type: taxId, trackingCode, sendStatusText, pattern, relatedTaxId, qrSvg, showQr, logoUrl, footerText, notes, settlementMethod, cashAmount, creditAmount, seller.branchCode, seller.postalCode, buyer.postalCode. Set them to "" or false. Do NOT invent values. These are reported later as empty.
- seller: from invoice.sellerInfo (name, economicCode, nationalId, registrationNumber, address, phone). buyer: from invoice.buyerInfo the same way. Missing optional strings become "".
- lines: one per invoice.items entry, in order. row: formatNumber(index+1). description: item.description. itemId: item.sku ?? "". unit: "". quantity: formatNumber(item.quantity). unitPrice: formatNumber(item.unitPrice). discount: formatNumber(item.discount). vatRate: formatNumber(item.vatRate * 100) + "٪" (check how invoice-print-view.tsx line ~246 does it and copy that). lineTotal: formatNumber(item.total). Use the exact placeholder names the template uses (grep `{{#each lines}}` block in the html).
- totals: beforeDiscount, discount, afterDiscount, vat, otherTaxes, grand, grandInWords. Mirror exactly how src/components/invoicing/invoice-print-view.tsx computes these (read its totals section, around lines 250-290). otherTaxes: "" if the view has none. grandInWords: integerToPersianWords(invoice.finalPayable) + " ریال" (integer rials; finalPayable is a whole number).
- currencyLabel: CURRENCY_LABELS[invoice.currency] or the code. If isForeignInvoice(invoice): add to the data `isForeign: true`, `foreignTotalText: formatLatinMoney-free string = formatNumber(invoice.amountFx ?? 0) + " " + invoice.currency`, `rialEquivalentText: formatMoneyRial(invoiceRialEquivalent(invoice))`. Add a matching `{{#if isForeign}}` row under the totals in the html (only that one addition to the template). Otherwise isForeign: false.
- All other template keys the template uses that are not listed above: "" .

## Test expectations (write these; do not adjust them to match output)
Fixture: taxInvoiceNumber "1001", issuedAt "2026-11-05T10:00:00Z", status ISSUED (use the enum member), currency IRR, einvoiceType none, sellerInfo {name "شرکت نمونه آزمایشی"}, buyerInfo {name "علی رضایی"}, one item {description "کالای نمونه", quantity 2, unitPrice 500000, discount 0, vatRate 0.1, tax 100000, total 1100000}, totalAmount 1000000, totalDiscount 0, totalTax 100000, finalPayable 1100000.
Assert:
- invoiceNumber === "1001"
- docTitle === "فاکتور فروش"
- isEinvoice === false, isDraft === false
- seller.name === "شرکت نمونه آزمایشی", buyer.name === "علی رضایی"
- lines[0].description === "کالای نمونه"
- grandInWords contains "یک میلیون و صد هزار"
- Escape check: build the rendered html with renderTemplate(SALES_INVOICE_A4_TEMPLATE, mapInvoiceToSalesInvoiceA4Data(fixtureWithName("<b>x</b>"), "پیش‌نویس")) and assert it does NOT contain "<b>x</b>" but contains "&lt;b&gt;x&lt;/b&gt;".
- The mapper output for numbers equals formatNumber(...) of the value (compute expected with formatNumber in the test, not by hand; this is the one allowed exception, state it in a comment).
- The date: read formatJalaliDate in src/lib/fa-format.ts first; then assert dateJalali equals what it returns for "2026-11-05", and state in a comment that 2026-11-05 is 1405/08/14 in the Jalali calendar.

## Done when
- The test file passes with tsx. Run `npx --yes tsx --test src/lib/print/sales-invoice.test.ts` and report the pass/fail counts.
- `npx tsc --noEmit -p .` is NOT run by you (the supervisor runs it through heavy.sh).
- Report: the list of files changed, the test result, and every field you left empty.
