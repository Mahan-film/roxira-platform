# Brief 256: wire sales-invoice-a5 print template
Worktree: /home/mahan/Developer/roxira-wt/256-wire-print-template-sales-invoice-a5
Template: output_apps/enterprise_hub/frontend/src/print-templates/sales-invoice-a5.html (A5 landscape; read its placeholders and map only those).
Create: print-templates/sales-invoice-a5.template.ts, lib/print/sales-invoice-a5.ts (mapper), lib/print/sales-invoice-a5.test.ts, lib/print/open-sales-invoice-a5-window.ts exporting printSalesInvoiceA5(invoice, statusLabel).
Page: components/invoicing/invoice-print-view.tsx already has the A4 print button calling printSalesInvoice (line ~106). Add a second button next to it, label "چاپ A5", that calls printSalesInvoiceA5(invoice, statusLabel(invoice.status)). Do not change the A4 button.
Mapper input: InvoiceResponseDto from types/invoicing.ts. Reuse the field logic of lib/print/sales-invoice.ts where the placeholders match.
Draft watermark when invoice.status is DRAFT.
Tests (hand-written expectations, fixture: taxInvoiceNumber 1001, one item quantity 2, unitPrice 500000, total 1100000, finalPayable 1100000): invoiceNumber "1001" shown in Persian digits as the renderer produces; grand total is formatted from 1100000; isDraft true only for DRAFT. Escaping test.

## Rules (all forms)
- Work only in the worktree given above. Do not commit, do not push, do not run npm install or npm ci, do not run next build or the dev server.
- Do not edit package.json, lockfiles, app-shell.tsx, app.module.ts, permission-matrix.snapshot.json, migrations, .github/workflows, modules/posting_rules, modules/treasury or the cheques module.
- Do not change the .html placeholder file except to inline print-base.css the way sales-invoice-a4.template.ts does.
- Pattern to copy exactly: output_apps/enterprise_hub/frontend/src/print-templates/sales-invoice-a4.template.ts (String.raw, print-base.css inlined), lib/print/sales-invoice.ts (mapper), lib/print/open-sales-invoice-window.ts (window opener), lib/print/sales-invoice.test.ts (tests).
- Mapper: pure function, returns the placeholder data. Amounts are integer rials through formatNumber (Persian digits, thousands separators). Dates are Jalali through formatJalaliDate. No arithmetic inside the template. HTML escaping is done by the existing renderTemplate.
- Any template field whose value is not in the page data: leave it empty string and list it in a doc comment at the top of the mapper, in the same style as sales-invoice.ts. Do not invent values, do not call new API routes.
- Keep existing Persian labels and terms exactly. Add the print button with a Persian label (چاپ), using the existing Button and Printer icon used by invoice-print-view.tsx.
- Tests: node:test with assert/strict, run with `npx --yes tsx --test <file>`. Expected values must be written by hand from literal fixture numbers (for example 1100000 gives formatNumber output you can check by hand, or assert the Persian digits literally). Do not compute expected values with the function under test. Do not adjust an expectation to match wrong output: fix the code.
- Also add a test that escapes a user-text field through renderTemplate.
- Run the new and existing print tests in output_apps/enterprise_hub/frontend/src/lib/print with tsx. Report the counts.
- Final stdout: under 10 lines: files changed, test counts, the list of empty fields, and any NEEDS line (NEEDS BACKEND, NEEDS HOTSPOT, NEEDS MAC) if the page or data is missing. If the real page does not exist or has no data for this form, stop and print NEEDS BACKEND or NEEDS PAGE with the reason; change nothing.
