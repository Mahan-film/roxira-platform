# Brief 262: wire POS 80 mm receipt print template
Worktree: /home/mahan/Developer/roxira-wt/262-wire-print-template-pos-80-mm-receipt
Template: output_apps/enterprise_hub/frontend/src/print-templates/pos-receipt-80mm.html (80 mm roll width).
First find the real POS sale page or drawer with API data (grep app/ and components/ for pos, POS, sale receipt). If there is no POS page in the frontend with real sale data, stop and print NEEDS PAGE: no POS sale page in the frontend, and change nothing.
If found: create print-templates/pos-receipt-80mm.template.ts, lib/print/pos-receipt.ts, its test, lib/print/open-pos-receipt-window.ts; add a print button label "چاپ" on that page.
Tests: hand-written expectations from literal fixture values, escaping test, and the 80 mm width kept in the template CSS (assert the string).

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
