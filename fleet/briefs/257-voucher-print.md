Issue #257: wire the accounting voucher print form. Frontend only, under output_apps/enterprise_hub/frontend/src.
Read first: print-templates/README.md, print-templates/accounting-voucher-a4.html, components/invoicing/invoice-print-view.tsx (existing print view), components/accounting/journal-entries-table.tsx, lib/fa-format.ts, docs/accounting/research/PRINT_FORMS.md section 2.
Build:
1. lib/print/render-template.ts: pure renderTemplate(template, data) supporting exactly the README syntax ({{path}}, {{#if flag}}, {{#each list}}), HTML-escaping every value (& < > " '). A missing value renders empty.
2. print-templates/accounting-voucher-a4.template.ts: export the HTML of accounting-voucher-a4.html as a string constant (Next cannot import .html); delete nothing.
3. lib/print/accounting-voucher.ts: pure mapper from the journal entry type used by journal-entries-table.tsx to the template's data: every placeholder in the template filled. Persian digits, Jalali date, amounts as ready strings via fa-format. isDraft true when the entry is not posted (draft watermark).
4. A print button on each row of journal-entries-table.tsx that opens the rendered HTML in a new window and calls print.
5. Tests: lib/print/render-template.test.ts (escaping, if, each, missing) and lib/print/accounting-voucher.test.ts asserting no {{ remains in rendered output. Use node:test as lib/*.test.ts files do, and import only relative paths in the two lib modules.
6. Any field the API does not supply (e.g. preparedBy): render empty and list it in your final message; do not invent values.
Rules: repo is public; synthetic data only. Do not touch package.json, lockfiles, app.module.ts, app-shell.tsx, permission-matrix snapshot, migrations or .github. Do not touch modules/posting_rules, treasury or cheques. Do not commit or push. Create no helper or debug scripts. Money is integer rials with bigint/money.ts, never floats. Dates shown in Jalali. Only claim tests ran if you saw them pass.
