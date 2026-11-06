# Brief: #298 bank accounts page and one name for reconciliation (frontend only)

Do NOT commit, push, or run git commit. Do NOT edit package.json, any lockfile, app-shell.tsx, app.module.ts, permission-matrix.snapshot.json, or anything under modules/ (backend is not needed for this slice). Only the files listed below.

Worktree root: /home/mahan/Developer/roxira-wt/298-bank-accounts
Frontend root (all paths below are relative to it): output_apps/enterprise_hub/frontend
Frontend source: output_apps/enterprise_hub/frontend/src

## Why
Design audit section 5 (docs/design/DESIGN_AUDIT_2026-11.md): three names for one feature today, and statement import jumps to the generic /app/import. Target:
- Menu, page title and button use the same terms: «حساب‌های بانکی» (accounts) and «مغایرت‌گیری بانکی» (reconciliation).
- The bank page becomes a list of bank accounts (balance, unreconciled count, last statement date).
- Statement import is a dialog on the bank page.

## Exact Persian strings (use these, character for character)
- Nav item and module label: «حساب‌های بانکی»
- Bank page title: «حساب‌های بانکی»
- Bank page description: «موجودی هر حساب بانکی، تعداد ردیف‌های مغایرت‌نشده و تاریخ آخرین صورتحساب»
- Primary button on bank page: «مغایرت‌گیری بانکی»
- Secondary button on bank page: «ورود صورتحساب»
- Reconcile page title: «مغایرت‌گیری بانکی»
- Dialog title: «ورود صورتحساب بانک»
- Dialog submit button: «بارگذاری صورتحساب»
- Column headers: «حساب بانکی» | «حساب دفتر کل» | «موجودی دفتر» | «موجودی بانک» | «ردیف مغایرت‌نشده» | «آخرین صورتحساب»
- Empty account list: title «هنوز حساب بانکی ثبت نشده است» ; text «برای شروع، حساب بانکی را با حساب دفتر کل آن وصل کنید.» ; primary action «+ حساب بانکی» (opens the existing BankAccountForm, see below)
- Last statement missing: «ثبت نشده»
- Per-account load error: «خطا در بارگذاری» (never show 0 for an account whose summary failed)
- Bank label: use BANK_LABELS from src/types/banking.ts.

## Existing pieces to reuse (do not rewrite)
- `src/app/app/accounting/bank/page.tsx`: current page. Keep `EnterpriseRouteGuard requireAdmin`, `PageHeader`, `buttonVariants`. Remove the link to `/app/import`. Keep `<BankReconciliation />` mounted BELOW the new accounts list (it is the manual matching table and stays unchanged in behaviour).
- `src/components/accounting/bank/bank-reconciliation.tsx`: existing combined view. Do not change its behaviour. Its ErrorNotice title already says «خطا در مغایرت‌گیری بانکی».
- `src/components/accounting/bank/bank-account-form.tsx`: export `BankAccountForm` (create account). Reuse it for the empty-state primary action and for the "+ حساب بانکی" button. Read its props first.
- `src/components/accounting/bank/bank-recon-wizard.tsx`: the reconcile wizard. It already lists sessions (`listSessions`) and can open one (`getSession`). Do not change it.
- `src/lib/api/banking-client.ts`: `listBankAccounts(signal?)`, `getReconciliationSummary(accountId, asOfIso?, signal?)`, `listStatementLines(accountId, params = {}, signal?)`.
- `src/lib/api/bank-recon-client.ts`: `uploadStatement(file: File, bankAccountId?: number): Promise<ReconSession>` (ReconSession has `id`, `bankAccountId`, `fileName`, `status`). Accepts .xlsx .xls .csv .pdf.
- `src/components/ui/drawer.tsx`: `Drawer` with props `open`, `title`, `description?`, `size?`, `onClose`, `children`. Use it as the dialog. Do not add a dependency.
- `src/lib/fa-format.ts`: `formatJalaliDate(value)` (Jalali date text from ISO), `formatNumber(n)` (Persian digits with separators), `formatReportMoney(n)`.
- `src/components/ui/money.tsx`: `Money` (`value`, optional `unit`, `suffix`) honours the viewer's unit switch. Prefer it for balances.
- `src/components/app/app-ui.tsx`: `PageHeader`, `ErrorNotice`, `LoadingLine`, `EmptyImportState` (check its props; use only if it fits the empty state), `loadErrorMessage`.
- `src/components/ui/table.tsx`, `card.tsx`, `badge.tsx`, `button.tsx`, `select.tsx`, `input.tsx`, `label.tsx`.

## Files to create
1. `src/lib/bank-accounts-ui.ts` (pure logic, no React). Export:
   - `unreconciledCount(summary: { unmatchedStatementCount: number; unmatchedBookCount: number }): number` = the sum of both fields. Example: 2 and 3 give 5.
   - `lastStatementDate(lines: Array<{ txnDate: string }>): string | null` = the greatest txnDate (ISO YYYY-MM-DD, compare as strings) or null when there are no lines. Example: ["2026-10-02","2026-11-01","2026-09-30"] gives "2026-11-01"; [] gives null.
   - `bankLabel(code: BankCode): string` = BANK_LABELS[code] (import BankCode from types/banking.ts).
2. `src/lib/bank-accounts-ui.test.ts`: Node test runner (`import { test } from "node:test"; import assert from "node:assert/strict";`), covering the three examples above plus: unreconciledCount with 0 and 0 gives 0; lastStatementDate with a single line returns its date; bankLabel("mellat") gives "ملت". Hand-computed expectations only.
3. `src/components/accounting/bank/bank-accounts-list.tsx`: `export function BankAccountsList()`.
   - On mount: `listBankAccounts(signal)`. Then for each account, in parallel (Promise.allSettled): `getReconciliationSummary(id, undefined, signal)` and `listStatementLines(id, {}, signal)`. A rejected call marks that account's row as «خطا در بارگذاری» for the affected cells; never render a fake 0.
   - Row cells: name, bank label + accountNumber (tabular-nums, LTR-safe: wrap the number in `<bdi dir="ltr">`), ledgerAccountCode + ledgerAccountName, bookBalance (`Money`), bankBalance (`Money`), unreconciledCount(summary) as `formatNumber`, lastStatementDate via `formatJalaliDate` or «ثبت نشده».
   - Actions per row (use `RowActionsMenu` from `src/components/ui/row-actions-menu.tsx`, label «عملیات»): «مغایرت‌گیری بانکی» links to `/app/accounting/bank/reconcile`; «ورود صورتحساب» opens the dialog with that account preselected.
   - Below 768 px: a card per account instead of a table. Use logical CSS (`ms-`, `me-`, `ps-`, `pe-`, `text-start`), never `ml-`/`mr-`/`pl-`/`pr-`/`text-left`. Must not overflow at 375 px.
   - Empty state: the text and primary action above.
   - Loading: `LoadingLine`. Error for listBankAccounts: `ErrorNotice`.
4. `src/components/accounting/bank/bank-statement-dialog.tsx`: `export function BankStatementDialog({ open, accounts, preselectedAccountId, onClose, onUploaded })`.
   - Drawer title «ورود صورتحساب بانک». Account select (required) from `accounts` (BankAccount[]), file input `accept=".xlsx,.xls,.csv,.pdf"` labelled «فایل صورتحساب».
   - Submit «بارگذاری صورتحساب»: `uploadStatement(file, accountId)`. On success show the file name and status text, and a primary link «ادامه مغایرت‌گیری» to `/app/accounting/bank/reconcile`. Disable submit while busy. Show the API error text on failure (use `loadErrorMessage`).
   - Do NOT parse the file in the browser.
   - Reset state when closed.

## Files to modify
5. `src/app/app/accounting/bank/page.tsx`: title «حساب‌های بانکی», description above. Actions: back link to `/app/accounting` (keep), primary link «مغایرت‌گیری بانکی» to `/app/accounting/bank/reconcile` (`buttonVariants({ size: "sm" })`), secondary button «ورود صورتحساب» that opens BankStatementDialog (state lives in this page, `accounts` loaded by BankAccountsList or passed up; simplest: BankAccountsList takes an `onAccountsLoaded` callback or the dialog loads `listBankAccounts` itself on open. Choose the simpler one and say which in the final message). Render `<BankAccountsList />` then `<BankReconciliation />`. Keep the `EnterpriseRouteGuard requireAdmin`.
6. `src/app/app/accounting/bank/reconcile/page.tsx`: title «مغایرت‌گیری بانکی». Back link text «حساب‌های بانکی» pointing to `/app/accounting/bank`. Description unchanged.
7. `src/lib/nav-menu.ts` around line 102: label «بانک و تطبیق» becomes «حساب‌های بانکی». Keep href and module.
8. `src/types/access.ts` line 23: `banking: "بانک و تطبیق"` becomes `banking: "حساب‌های بانکی"`. Check with grep where this label is used; if a test asserts the old text, update the test.
9. `src/app/app/accounting/page.tsx` around line 86: «بانک و مغایرت‌گیری» becomes «حساب‌های بانکی». Read the surrounding lines first; keep the href.
10. e2e text: `grep -rn "بانک و تطبیق\|بانک و مغایرت\|مغایرت‌گیری هوشمند" /home/mahan/Developer/roxira-wt/298-bank-accounts/e2e /home/mahan/Developer/roxira-wt/298-bank-accounts/output_apps/enterprise_hub/e2e` and update every visible-text hit that refers to the renamed items (for example `e2e/tests/prod-feature-tour.spec.ts` line ~345 `getByRole('tab', { name: 'مغایرت‌گیری هوشمند' })`: change to «مغایرت‌گیری بانکی» only if that element is the reconcile page's button or title). Do not touch e2e tests unrelated to these labels. Report every e2e hit you changed.

## Do not do
- Do not add a new backend route, a new migration, or a backend change. All routes used already exist: GET /enterprise-hub/banking/accounts, GET /accounts/:id/summary, GET /accounts/:id/statement-lines, POST via uploadStatement.
- Do not add decimal arithmetic on money. Show values only through `Money` / `formatReportMoney`.
- Do not hardcode account codes.
- No fake data, no placeholder party names. Data only from the API.
- Do not change dashboard, cheques, petty-cash pages.
- Do not add dependencies.

## Tests the brief requires
- `cd output_apps/enterprise_hub/frontend && npx --yes tsx --test src/lib/bank-accounts-ui.test.ts` must pass.
- `npx --yes tsx --test src/lib/nav-menu.test.ts` must pass (it asserts the nav tree).
- Typecheck: `/home/mahan/Developer/roxira-wt/_fleet/heavy.sh npx tsc --noEmit -p output_apps/enterprise_hub/frontend/tsconfig.json` run from the worktree root. Fix every error in files you touched. Pre-existing errors elsewhere: report, do not fix.

## Output expected from you
Leave the changed files in the worktree, uncommitted. Your last message: list of files changed, the test output summary, and anything you could not do.
