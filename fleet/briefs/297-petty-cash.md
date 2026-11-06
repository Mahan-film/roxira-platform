# Brief: #297 petty cash under Treasury («صندوق و تنخواه») (frontend only)

Scope decision (owner): this PR does the PETTY CASH part only. Cash boxes (صندوق) have no backend routes; do NOT invent cash-box rows, a cash-box API, or fake data. The cash-box part is reported as a gap.

Do NOT commit, push, or run git commit. Do NOT edit package.json, any lockfile, app-shell.tsx, app.module.ts, permission-matrix.snapshot.json, or anything under modules/ (no backend change). Only the files listed below.

Worktree root: the worktree for #297 (created by claim.sh; path given in the run command)
Frontend root (relative paths below): output_apps/enterprise_hub/frontend
Frontend source: output_apps/enterprise_hub/frontend/src

## Why
Design audit section 4 (docs/design/DESIGN_AUDIT_2026-11.md): petty cash was treated as a top-level accounting feature. In Sepidar/Hamkaran it sits in treasury beside bank and cheques. Target:
- Page titled «صندوق و تنخواه» in the Treasury group (nav group id `treasury` in src/lib/nav-menu.ts already contains the petty cash item).
- List of funds (boxes): balance, custodian, limit, last settlement.
- Primary action «+ هزینه تنخواه»; secondary action «تسویه تنخواه».
- Empty state with explanation and a primary action.

## Exact Persian strings
- Page title: «صندوق و تنخواه»
- Page description: «تنخواه‌گردان‌ها، رسید هزینه‌ها و تسویه با دفتر» (replaces the current description «تنخواه‌گردان‌ها، رسید هزینه و تسویه در دفتر')
- Nav label (src/lib/nav-menu.ts, item href /app/accounting/petty-cash): «صندوق و تنخواه»
- Accounting hub link label (src/app/app/accounting/page.tsx around line 82, currently «تنخواه»): «صندوق و تنخواه»
- Table headers: «تنخواه» (name) | «مسئول» (custodian) | «سقف تنخواه» (imprestAmount) | «موجودی» (balance) | «قابل استفاده» (available) | «آخرین تسویه» (last settlement) | «عملیات»
- Primary button: «+ هزینه تنخواه» (opens the expense form in a Drawer)
- Secondary button: «تسویه تنخواه» (opens the settlement form in a Drawer)
- Empty state title: «هنوز تنخواهی ثبت نشده است»; text: «تنخواه‌گردان، مبلغ سقف و مسئول آن را ثبت کنید. هزینه‌های نقدی با رسید به تنخواه ثبت و با تسویه به دفتر منتقل می‌شوند.»; primary action: «+ تعریف تنخواه» (the existing create form at the top of the page).
- Last settlement missing: «ثبت نشده»
- Keep the existing labels for movement, expense, settlement and close actions unless they are the old «تنخواه» wording of the page title.

## Existing code (src/app/app/accounting/petty-cash/page.tsx, 366 lines)
It already does most of the work: lists funds (around lines 121-189), a create-fund form, a statement card per selected fund (around lines 192-362) with charge/return, expense, expense void, settle, close. Keep the working logic. Change:
1. Page title and description (line ~115-116).
2. The funds table: add the «آخرین تسویه» column and the «قابل استفاده» (`available`) column if missing; keep balance, custodian, imprestAmount. Use `formatReportMoney` (already imported) for money and `formatJalaliDate` for dates. Both are in `src/lib/fa-format.ts`.
3. Empty state text (line ~182) replaced by the empty state above (title, text, primary action). Use `EmptyImportState` only if its props fit; otherwise a plain block with the same text.
4. Replace the in-card forms for expense and settlement with two buttons in each selected fund's header («+ هزینه تنخواه» primary, «تسویه تنخواه» secondary). Each opens `Drawer` from `src/components/ui/drawer.tsx` (props: `open`, `title`, `description?`, `size?`, `onClose`, `children`). Move the EXISTING expense form JSX and the EXISTING settlement JSX into the drawers unchanged in behaviour. Do not rewrite their state logic.
5. Layout: logical CSS only (`ms-`, `me-`, `ps-`, `pe-`, `text-start`). No `ml-`, `mr-`, `pl-`, `pr-`, `text-left` (the current file uses `text-left` on money cells: replace with `text-end`). Must work at 375 px with no horizontal page scroll: the funds table gets the mobile card layout (one card per fund) below `sm`.
6. Date inputs stay `JalaliDateInput` (`src/components/ui/jalali-date-input.tsx`).

## Last settlement (pure logic)
Create `src/lib/petty-cash-ui.ts` (no React) with:
- `lastSettlementDate(transactions: Array<{ status: string; date: string }>): string | null`: the greatest `date` among transactions with `status === "SETTLED"` (ISO YYYY-MM-DD compare as strings). Returns null when none. Example: [{SETTLED, "2026-10-02"}, {PENDING, "2026-11-01"}, {SETTLED, "2026-10-20"}] gives "2026-10-20". [] gives null. [{PENDING,"2026-11-01"}] gives null.
- `availableAfterPending(balance: number | string, pending: number | string): number | null`: null when either is not a plain decimal (use the same approach as `toMinorUnits` in src/lib/cheques-ui.ts or plain Number when both are safe integers). Example: balance 5000000, pending 1200000 gives 3800000. Keep this only if the API `available` field is missing; otherwise skip it and say so.

Test: `src/lib/petty-cash-ui.test.ts` (Node test runner: `import { test } from "node:test"; import assert from "node:assert/strict";`), with the examples above. Hand-computed expectations only.

Where to load last settlement: for each fund, `getPettyCashStatement(id, signal)` (client already in `src/lib/api/accounting-reports-client.ts`, around line 90) returns `{ fund, transactions }`. Load them with `Promise.allSettled` after `listPettyCashFunds`. A failed statement shows «خطا در بارگذاری» in that cell, never a fake date or 0.

Data types already exist: `PettyCashFund` (`src/types/accounting-reports.ts` line ~181: id, name, custodianName, ledgerAccountCode, imprestAmount, status, balance, pending, available), `PettyCashTransaction` (line ~193: id, kind, status, date, amount, accountCode, description, receiptNumber), `PettyCashStatement` ({ fund, transactions }).

Backend routes already exist (modules/accounting/controllers/petty-cash.controller.ts): GET /enterprise-hub/accounting/petty-cash/funds, POST funds, GET funds/:id, POST funds/:id/charge, /return, /expenses, /expenses/:expenseId/void, /settle, /close. Use only the client functions already in the page. Do not add routes.

## Hardcoded account codes (existing, do not extend)
The page has default codes `"1012"` (movement and settlement) and `"5030"` (expense). These are existing. Do not add new ones. Do not change them in this PR; the report will mention them as a follow-up for the Mac posting-rules owner (RULES: no hardcoded account codes in posting code).

## Cash boxes (gap, do not build)
There is no cash-box backend. Do not add a cash-box table, mock rows, or a "صندوق" list. If you want, add nothing else. The final report will say the cash-box half is not built.

## Other text to change
- `src/lib/nav-menu.ts` around line 109: label «تنخواه» → «صندوق و تنخواه».
- `src/app/app/accounting/page.tsx` around line 82: «تنخواه» → «صندوق و تنخواه».
- Grep `e2e` (repo root `e2e` and `output_apps/enterprise_hub/e2e`, if any) for the old texts «تنخواه» and «تعریف تنخواه», and update visible-text references that this change breaks. Report every changed hit.

## Do not do
- No backend change. No migration. No new API route.
- No new dependency. No change to package.json.
- No fake data, no placeholder names. Real custodian names only (from the API).
- Do not change the accounting dashboard (src/app/app/accounting/dashboard/page.tsx) except nothing; it is out of scope.

## Tests the brief requires
- `cd output_apps/enterprise_hub/frontend && npx --yes tsx --test src/lib/petty-cash-ui.test.ts` must pass.
- `npx --yes tsx --test src/lib/nav-menu.test.ts` must pass.
- Typecheck: `/home/mahan/Developer/roxira-wt/_fleet/heavy.sh npx tsc --noEmit -p output_apps/enterprise_hub/frontend/tsconfig.json` from the worktree root. Fix errors in files you touched. Report pre-existing errors elsewhere without fixing.

## Output expected from you
Leave the changed files in the worktree, uncommitted. Your last message: files changed, test output summary, the e2e hits changed, the hardcoded codes you left in place (line numbers), and anything not done.
