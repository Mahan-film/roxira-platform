# Triage: open issues and mahansudo PRs (Mahan-film/roxira-platform)

Snapshot: origin/main fetched 2026-11-05. Read-only. No repo file, GitHub comment or claim was changed.

Blocker categories: unmerged PR number, hotspot file (package.json, lockfiles, app.module.ts, app-shell.tsx, permission-matrix.snapshot.json, new migration), Mac-owned (modules/posting_rules or treasury edits), browser screenshots/runs, or "free to start now".

Size guess: S under 100 changed lines, M under 400, L 400 or more or needs splitting. Sizes for issues are guesses from the issue text, not measured.

"Screenshots" means the issue's acceptance requires screenshots or a browser run. "inferred" means the blocker is taken from another PR body or issue text, not from a file I opened.

## Issues

| Issue | Title (short) | Status on main | Proof / evidence | Blocked by | Size |
|---|---|---|---|---|---|
| 242 | Party statement report | partly | PR 124 (open) adds `modules/accounting/reports/party-statement.spec.ts`; no party statement on main | PR 124 (unmerged); its body says JSON route and print view need permission-matrix.snapshot.json (hotspot) | L (remaining part M) |
| 244 | Purchases by item and supplier | not started | No purchase report on main (grep of modules and frontend) | Core module free. API route: permission-matrix.snapshot.json (inferred from PR 431 and PR 124 bodies) | M |
| 247 | Gross profit per invoice, item, customer | not started | Main has `grossProfit` only at income-statement level (`modules/accounting/services/financial-reports.service.ts`, `frontend/src/types/accounting-reports.ts:116`); no per-invoice report | Route hotspot (inferred, as for 244) | M |
| 248 | POS day-end close report | not started | No day-end report on main; `modules/invoicing/services/pos-sale.service.ts` exists | Route hotspot (inferred). pos-sale.service.ts also edited by PR 123 and PR 163 (unmerged) | M |
| 249 | Legal journal and general ledger PDF | partly | PR 345 (open, ready) adds `reports/legal-books.ts`; not on main; issue labelled in-progress | PR 345 (unmerged, its own PR) | L |
| 255 | Print A4 sales invoice | not started | `frontend/src/print-templates/sales-invoice-a4.html` exists; `print-templates/README.md` says "Not wired into any page"; no code references it | PR 429 (unmerged, adds `lib/print/render-template.ts` used by print wiring, inferred); browser print check | M |
| 256 | Print A5 sales invoice | not started | `sales-invoice-a5.html` exists, unreferenced | Same as 255 | M |
| 258 | Print receipt/payment voucher | not started | `receipt-payment-voucher-a5.html` exists, unreferenced | Same as 255 | M |
| 259 | Print cheque receipt | not started | `cheque-receipt-a5.html` exists, unreferenced | Same as 255 | M |
| 260 | Print warehouse receipt/issue | not started | `warehouse-document-a4.html` exists, unreferenced | Same as 255 | M |
| 261 | Print payslip | not started | `payslip-a5.html` exists, unreferenced | Same as 255 | M |
| 262 | Print POS 80 mm receipt | not started | `pos-receipt-80mm.html` exists, unreferenced | Same as 255 | M |
| 266 | Import presets (Sepidar, Rahkaran, Mahak, Holoo) | not started | `e2e/fixtures/import-presets/` is synthetic (per issue); `modules/data_import/mapping/lead-field-synonyms.ts` has no vendor names | External: needs real vendor template files from a licensed user | M |
| 294 | Financial home dashboard at /app | partly | `frontend/src/app/app/accounting/dashboard/page.tsx` exists; `frontend/src/app/app/page.tsx` still has CRM (line 128) and HR (line 157) sections | Screenshots. app-shell.tsx if the nav changes (unverified) | L |
| 295 | New menu tree grouped by job | not started | Nav lives in `frontend/src/components/app/app-shell.tsx` (line 82 is the current nav); labels not changed | app-shell.tsx hotspot (issue says sidebar and mobile sheet change); screenshots | M |
| 296 | Split /app/accounting into vouchers and chart | not started | `frontend/src/app/app/accounting/page.tsx` still has two «سند جدید» buttons (lines 66, 113) | Screenshots; route/nav placement unverified | M |
| 297 | Petty cash under Treasury | not started | `frontend/src/app/app/accounting/petty-cash/page.tsx:115` title is "تنخواه", not «صندوق و تنخواه» | app-shell.tsx (nav placement, inferred); screenshots | M |
| 298 | Bank accounts page and one name | not started | `frontend/src/app/app/accounting/bank/page.tsx:15` title "بانک و مغایرت‌گیری" | app-shell.tsx (menu terms, inferred); screenshots | M |
| 299 | Reports hub at /app/reports | not started | No `/app/reports` route on main; only `frontend/src/app/app/accounting/reports/page.tsx` | app-shell.tsx (menu item, inferred); screenshots. PRs 124, 344, 345 also edit accounting/reports/page.tsx | L |
| 300 | Fiscal years page with pre-close checklist | not started | `frontend/src/app/app/accounting/fiscal-years/page.tsx` exists; no checklist or typed-confirmation UI on main | Screenshots; checklist backend needs unverified | M |
| 302 | Customer drawer with tabs | not started | No tabs and no «مشتریان و سرنخ‌ها» label on main | Screenshots; PR 346 (draft) also edits `app/app/crm/page.tsx` | M |
| 303 | Cheques page tabs, chips, strip | not started | `frontend/src/app/app/cheques/page.tsx` has no tabs | Screenshots | M |
| 304 | Tax page tabs and next-deadline card | not started | No «مهلت بعدی» on main. `frontend/src/app/app/tax/page.tsx:332,352` call getVatReturn and downloadVatReturn with no import (the #443 bug) | #443 (Mac lane, tax page broken on main); screenshots | M |
| 305 | Payroll wizard and grouping | not started | No wizard; `frontend/src/app/app/hr/payroll/page.tsx` has title «حقوق و دستمزد ماهانه» only | app-shell.tsx menu group (inferred); HR area, which other issues label Mac; screenshots | L |
| 306 | Inventory columns, low-stock filter, rename import | not started | No «ورود از اکسل» on main | Screenshots | M |
| 325 | Wire /app/import to resumable bulk upload | partly | `frontend/src/app/app/import/page.tsx` renders `BulkImportPanel` (calls `uploadBulkFile`, `components/app/bulk-import-panel.tsx:101`) and `ImportWizard` with `onBulkFile` for files over 5 MB (`components/app/import-wizard.tsx:85`). No .sql/.zip/.sqlite/.db routing, Cancel or localStorage resume found | Step 5 is a Playwright run (browser) | M |
| 378 | Posting: invoicing to the engine | not started | Invoicing services do not use PostingRulesService; `posting_rules/domain/posting-templates.ts` has invoice.sale, invoice.sale_cogs, invoice.purchase but no pos.sale | Issue says add a template in posting_rules/domain (Mac-owned); PR 123 and PR 163 overlap invoice-posting.service.ts and pos-sale.service.ts; split needed (sales, purchase, POS) | L |
| 381 | Posting: POS close to the engine | not started | No pos.close template in posting-templates.ts | posting_rules template addition (Mac-owned); PR 123 and PR 163 overlap pos-sale.service.ts | M |
| 386 | Posting: petty cash to the engine | not started | pettycash.charge and pettycash.expense exist in posting-templates.ts (lines 138, 144); no pettycash.replenish | posting_rules template addition (Mac-owned) | M |

## Open PRs by mahansudo (17)

| PR | Linked issue | Draft | Status | Blocked by | Size |
|---|---|---|---|---|---|
| 445 | #250 (not in list) | no | Ready. Core asset register and spec. Body says #250 stays open | Review and merge. API route needs permission snapshot (later PR) | M |
| 431 | #243 (not in list) | no | Ready. Sales report core, no route | Review and merge. Route later (hotspot) | M |
| 429 | #257 (not in list) | no | Ready. Adds lib/print renderer used by print items 255 to 262 | Browser print check (body says issue stays open until then) | M |
| 350 | #267 (not in list) | yes | WIP draft, chart template and cheques code collision | Draft; no hotspot or Mac file found | M |
| 347 | #237 (not in list) | yes | Draft. Ageing by treasury allocations | Edits `modules/treasury/treasury.module.ts`, a Mac-owned treasury edit | L |
| 346 | #301 (not in list) | yes | Draft. Invoice list redesign (frontend part) | #349 (open issue, backend fields, per PR body). Touches crm/page.tsx and invoicing/page.tsx | L |
| 345 | #249 | no | Ready. Legal journal and general ledger | None on main. Shares accounting/reports/page.tsx with PRs 124 and 344 | L |
| 344 | #307 (not in list) | no | Ready. Shared formatter and unit switch | None found. Shares accounting/reports/page.tsx with 124, 345 | L |
| 283 | #281 (not in list) | yes | Draft WIP, scrollable sidebar | app-shell.tsx hotspot | S |
| 166 | #148 (not in list) | no | Ready. Barcode box in sales invoice drawer | None found (touches an e2e spec and invoice-editor.tsx) | S |
| 164 | #160 (not in list) | no | Ready. Cost centres | Hotspots: new migration `1789510000000-AddCostCentreTree.ts`, `permission-matrix.snapshot.json`, `accounting.module.ts` | L |
| 163 | #162 (not in list) | no | Ready. Line and invoice discounts | Overlaps PR 123 and PR 161 on invoicing.service.ts; overlaps PR 123 on pos-sale.service.ts | L |
| 161 | #126 (not in list) | no | Ready. VAT resolver refuses instead of 10% fallback | Overlaps PR 123 and PR 163 on invoicing.service.ts | M |
| 157 | #129 (not in list) | no | Ready. Fixed-asset zero-charge fix | None found | M |
| 147 | #127 (not in list) | no | Ready. Calendar date validation in journal search | None found | S |
| 124 | #120 and #242 | no | Ready. Party statement export and service | permission-matrix.snapshot.json (per PR body, for JSON route and print view). Shares accounting/reports/page.tsx with 344, 345, 299 | L |
| 123 | #119 (not in list) | no | Ready. POS returns linked to sale | None listed in PR. Overlaps 161, 163 on invoicing.service.ts and pos-sale.service.ts; overlaps 378 and 381 | L |

## Summary

- Free to start now and not hotspot (strict, no blocker at all): none of the 28 issues.
- Closest, smallest first, with the stated caveat:
  1. 325, M: code steps 1 to 4 need no hotspot; step 5 needs a browser run.
  2. 244, M: core module is free; API route touches the permission-matrix hotspot (inferred).
  3. 247, M: same route caveat as 244.
  4. 248, M: route caveat, and pos-sale.service.ts overlaps PRs 123 and 163.
- Free apart from the screenshot acceptance: 303, 306, 296, 300, 302 (all M, frontend-only on the issue text; nav placement not verified).
- Already done on main: none verified. 294 and 325 are partly done, with proof files listed above.
