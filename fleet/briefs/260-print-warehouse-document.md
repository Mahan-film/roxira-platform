# Brief 260: wire warehouse receipt/issue print template
Worktree: /home/mahan/Developer/roxira-wt/260-wire-print-template-warehouse-receipt-is
Template: output_apps/enterprise_hub/frontend/src/print-templates/warehouse-document-a4.html (A4 portrait; covers receipt, issue, transfer and adjustment).
Page: components/inventory/stock-document-drawer.tsx (opened from components/inventory/stock-documents-list.tsx, page app/app/inventory/page.tsx). Add a print button in the drawer, label "چاپ", that prints the open document. Types in types/inventory.ts and client in lib/api/inventory-client.ts. Use only existing API calls.
Create: print-templates/warehouse-document-a4.template.ts, lib/print/warehouse-document.ts, its test, lib/print/open-warehouse-document-window.ts.
Quantities: pass as formatted strings; if the document type has a fractional quantity, use formatNumber as it is.
Tests: hand-written expectations from literal fixture values for a receipt and an issue; escaping test; the document-type title in Persian for each type.

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
