Issue #257, second attempt. The first was rejected: its regexes did not compile, dotted paths and nested blocks did not render, the print button duplicated the mapper, and it invented a fiscal year. Frontend only, under output_apps/enterprise_hub/frontend/src. Follow this exactly.

1. lib/print/render-template.ts, no imports. renderTemplate(template: string, data: Record<string, unknown>): string. Implement as a small recursive parser, not sequential replaceAll:
   - scan for the next `{{`. `{{#if x}}...{{/if}}` and `{{#each x}}...{{/each}}` find their matching close by counting nested opens of the same kind.
   - `{{a.b}}` looks up dotted paths, first in the current item, then in the parent scopes.
   - values are HTML-escaped (& < > " '); null or undefined renders empty; `#if` is false for empty string, empty array, 0, null, undefined, false.
   - inside `#each`, scope is the item with the parent data behind it.
2. print-templates/accounting-voucher-a4.template.ts: exports ACCOUNTING_VOUCHER_A4_TEMPLATE, the exact HTML from accounting-voucher-a4.html in a String.raw literal, except the `<link rel="stylesheet" href="print-base.css">` line is replaced by `<style>` holding the exact contents of print-base.css. Do not edit the .html or .css.
3. lib/print/accounting-voucher.ts: mapJournalEntryToVoucherData(entry). Import helpers by relative path (`../fa-format.ts`, and `import type` for types) so node:test can load it; if fa-format.ts itself uses an @/ import, say so instead of working around it.
   - isDraft: entry.status === "DRAFT"
   - status: Persian label as journal-entries-table.tsx shows it
   - dateJalali: formatJalaliDate(entry.date)
   - amounts: formatMoneyRial
   - fiscalYear, company.name, sequenceNumber, voucherType, references, preparedBy, totals.inWords: empty string unless the entry type has the field. Never compute a year from new Date(). List the empty fields in your final message.
4. components/accounting/journal-entries-table.tsx: one print button per row calling a helper `printVoucher(entry)` defined in lib/print/open-print-window.ts: render the template with the mapper, open a window, write the html, `win.onafterprint = () => win.close()`, then `win.print()`. If window.open returns null, do nothing. Keep the table's column header row in step with the new cell.
5. Tests with node:test, importing relative paths with the .ts extension, same style as lib/account-tree.test.ts:
   - lib/print/render-template.test.ts: escaping of all five characters; dotted path; if true/false; each; if inside each; nested each; missing value empty.
   - lib/print/accounting-voucher.test.ts: rendering the real template with a synthetic entry leaves no `{{` in the output; draft vs posted; a description containing `<script>` comes out escaped.

Rules: synthetic data only. Do not touch package.json, lockfiles, app-shell.tsx, migrations or .github. Create only the files named here; no src/docs folder, no helper scripts. Do not commit or push. Only say tests ran if you saw them pass.
