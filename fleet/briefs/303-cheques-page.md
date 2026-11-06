# Brief: #303 cheques page tabs, status chips and due-this-week strip (frontend only)

Do NOT commit, push, or run git commit. Do NOT edit package.json, any lockfile, app-shell.tsx, app.module.ts, permission-matrix.snapshot.json, or anything under modules/ (no backend change). Only the files listed below. Do NOT edit modules/cheques or modules/posting_rules (backend is owned elsewhere).

Worktree root: the worktree for #303 (created by claim.sh; path given in the run command)
Frontend root (paths below are relative to it): output_apps/enterprise_hub/frontend
Frontend source: output_apps/enterprise_hub/frontend/src

## Why
Design audit section 10 (docs/design/DESIGN_AUDIT_2026-11.md): the cheques page has only a back link in its header, no primary action, and no view of due dates. Target:
- Tabs «دریافتی» | «پرداختنی» at the top.
- Status chips with counts (toggle the status filter).
- A due strip «سررسید ۷ روز آینده» (see note below on the window).
- Primary button «+ ثبت چک».
- After each status change, the notice shows the accounting voucher it posted.

## Exact Persian strings
- Direction tabs: «دریافتی» (received), «پرداختنی» (issued). Use the labels from DIRECTION_LABELS in src/types/cheques.ts if they match; otherwise these exact words.
- Primary button: «+ ثبت چک».
- All chip: «همه» with the total count.
- Due strip title: «سررسید ۷ روز آینده». Note: this is a rolling 7-day window from today, not the Jalali calendar week. Do not label it «این هفته».
- Due strip empty: «چکی در ۷ روز آینده سررسید ندارد.»
- Due strip totals: label «جمع مبلغ» with the server total for the direction.
- Voucher notice after a transition: «چک {chequeNumber}: «{status label}» ثبت شد. سند حسابداری {entryNumber} صادر شد.» If the voucher number cannot be fetched, write «سند حسابداری صادر شد.» and link to the journal entry. Never invent a voucher number.
- Keep the existing status/transition labels (STATUS_LABELS, ACTION_LABELS).

## Existing pieces (read them, reuse them)
- `src/components/cheques/cheques-view.tsx`: holds the four sub-tabs (فهرست چک‌ها, سررسیدها, چک‌های برگشتی, تطبیق با بانک). Keep these four. Add the direction tabs ABOVE them and the «+ ثبت چک» button in the same top row.
- `src/components/cheques/cheques-list.tsx` (387 lines): has its own direction select (around line 201, `aria-label="نوع چک"`) and status select (around line 208), the table, `run()` (around line 98) that builds the notice (around lines 126 and 184), the form toggle `showForm` (line 42, button around line 190), and the transition buttons (around line 344). Change it as below. Do not rewrite the table.
- `src/components/cheques/cheque-form.tsx`: the create form (`ChequeForm` with `onCancel`, `onSaved`-style callback at around lines 180-183). Reuse it unchanged.
- `src/components/cheques/cheque-reports.tsx`: `DueReport`, `BouncedReport`. Unchanged.
- `src/lib/cheques-ui.ts`: `statusesFor(direction)`, `sortByUrgency(rows, today)`, `toMinorUnits`, `DUE_WINDOWS`. Add to this file (see below).
- `src/lib/cheques-ui.test.ts`: existing tests. Add cases; do not change existing expectations.
- `src/lib/api/cheques-client.ts`: `listCheques(params, signal)`, `listDueCheques(days, signal)`, `transitionCheque(id, payload, signal)`. `transitionCheque` is typed as returning `Cheque` but the backend returns `ChequeDetailResponseDto` (a Cheque plus `events`). Change its return type to the new `ChequeDetail` type (below).
- `src/types/cheques.ts`: `Cheque`, `DueCheque`, `DueCheques` ({ asOf, until, items, receivedTotal, issuedTotal }), `DIRECTION_LABELS`, `STATUS_LABELS`, `ACTION_LABELS`. Add the types below.
- `src/components/ui/badge.tsx`: check its variants before choosing chip tones.
- `src/components/ui/money.tsx` (`Money`), `src/lib/fa-format.ts` (`formatJalaliDate`, `formatNumber`, `formatReportMoney`), `src/components/ui/jalali-date-input.tsx`.
- `src/lib/api/accounting-client.ts` line ~59 has the list of journal entries (`GET /enterprise-hub/accounting/journal-entries`). Also `GET /enterprise-hub/accounting/journal-entries/:id` exists on the backend (modules/accounting/controllers/accounting.controller.ts line ~248). Grep the client for an existing single-entry function before writing one. Check the response field name for the entry number in the DTO; do not guess it.

## Backend facts (verified by grep)
- `GET /enterprise-hub/cheques?direction=&status=&dueFrom=&dueTo=` returns `Cheque[]`.
- `GET /enterprise-hub/cheques/due?days=7` returns `{ asOf, until, items: DueCheque[], receivedTotal, issuedTotal }`. Each item has `daysUntilDue` and `overdue`.
- `POST /enterprise-hub/cheques/:id/transition` returns `ChequeDetailResponseDto` = Cheque + `events: ChequeEvent[]`.
- `ChequeEvent` = { id, fromStatus: ChequeStatus | null, toStatus: ChequeStatus, eventDate: string, journalEntryId: number | null, amount: number | string | null, note: string | null }.
- Cheque fields include `direction`, `chequeNumber`, `partyName`, `amount` (number or decimal string), `dueDate` (ISO), `status`, `allowedNext`.

## Changes to make

1. `src/types/cheques.ts`: add
   `export interface ChequeEvent { id: number; fromStatus: ChequeStatus | null; toStatus: ChequeStatus; eventDate: string; journalEntryId: number | null; amount: number | string | null; note: string | null; }`
   and `export interface ChequeDetail extends Cheque { events: ChequeEvent[]; }`.

2. `src/lib/api/cheques-client.ts`: `transitionCheque` returns `Promise<ChequeDetail>`. Fix any caller that relied on `Cheque` (grep for `transitionCheque(`).

3. `src/lib/cheques-ui.ts`: add pure helpers, no React:
   - `countByStatus(rows: Array<Pick<Cheque, "status">>): Partial<Record<ChequeStatus, number>>`. Example: [registered, registered, bounced] gives { registered: 2, bounced: 1 }.
   - `dueStripRows<T extends { dueDate: string; status: ChequeStatus; direction: ChequeDirection }>(items: T[], direction: ChequeDirection, today: string, limit = 5): T[]`: keep the direction, then `sortByUrgency(rows, today)`, then take `limit`. Example: direction received, today "2026-11-06", items with dueDate "2026-11-12", "2026-11-08", "2026-11-10" (all status registered, received) and one issued item: returns the 08, 10, 12 received items in that order when limit is 5.
   - `voucherNoticeText(args: { chequeNumber: string; statusLabel: string; entryNumber: string | null }): string`. With entryNumber null, return the text without a number (see the exact string above). Example: { chequeNumber: "1024", statusLabel: "وصول‌شده", entryNumber: "1405-0231" } gives «چک 1024: «وصول‌شده» ثبت شد. سند حسابداری 1405-0231 صادر شد.» Use the text exactly; keep digits as the caller gives them.
   - `chipTone(status: ChequeStatus): "neutral" | "info" | "success" | "danger"`: cleared gives "success"; bounced and returned give "danger"; deposited and delivered give "info"; registered and spent give "neutral". Colour is never the only signal: the chip also shows its text label.

4. `src/lib/cheques-ui.test.ts`: add tests for the four helpers above with the examples. Use hand-computed expectations only. Make sure the existing tests still pass.

5. `src/components/cheques/cheques-view.tsx`:
   - Top row: direction tabs (role="tablist", aria-selected) with state `direction: ChequeDirection` default "received", and the primary button «+ ثبت چک» (`Button` default variant, Plus icon from lucide-react) that opens the create form.
   - Lift `showForm` here: pass `direction`, `formOpen`, `onFormOpenChange` into `ChequesList`. Keep the four sub-tabs.
   - When the direction tab changes, the list and the due strip follow it.

6. `src/components/cheques/cheques-list.tsx`:
   - Remove the internal direction select; take `direction` as a prop.
   - Remove the internal `showForm` state; use the props from the view. The create form still renders `ChequeForm` in the same place.
   - Status filter: keep the status select for accessibility, AND add status chips above the table. Chips come from `statusesFor(direction)` with the count from `countByStatus(allRowsOfDirection)`, plus an «همه» chip. Clicking a chip sets `status`. The status filter is applied client-side on the rows the server returned for the direction and the due window. (So fetch with `direction` only, not `status`, and apply `status` in memory. Keep dueFrom/dueTo on the server.)
   - Chip markup: a `button` with `aria-pressed`, text label and count, `Badge`-based tone from `chipTone`, min height 44px on mobile (`min-h-11 sm:min-h-8`).
   - Transition notice: after `transitionCheque` returns a `ChequeDetail`, take the newest event with a non-null `journalEntryId` (events may be in any order: sort by eventDate then id). Fetch the entry number with the existing or new single-entry client function (see the backend facts). Then set the notice with `voucherNoticeText`. If the fetch fails, use the null form. Do not block the transition on the fetch.
   - Keep the sort (`sortByUrgency`) and the existing per-row actions.

7. `src/components/cheques/due-strip.tsx` (new): `export function DueThisWeekStrip({ direction, today })`.
   - On mount `listDueCheques(7, signal)`. Show a Card titled «سررسید ۷ روز آینده». Show the server total for the direction: `receivedTotal` for "received", `issuedTotal` for "issued", labelled «جمع مبلغ». Show the rows from `dueStripRows(items, direction, today, 5)`: party name, chequeNumber, `formatJalaliDate(dueDate)`, amount via `Money`, and an «معوق» badge when `overdue` is true (badge text, not colour only).
   - Loading: LoadingLine. Error: ErrorNotice with `loadErrorMessage`. Empty: «چکی در ۷ روز آینده سررسید ندارد.»
   - Refresh the strip after each successful transition or creation: give it a `refreshKey` prop from the view, incremented on success. The list calls a callback `onChanged` after success; the view bumps the key.
   - Render the strip above the sub-tabs in the view, only in the list tab (`tab === "list"`).

8. `src/app/app/cheques/page.tsx`: keep the PageHeader and the back link. Leave the title «چک‌ها». No other change.

9. e2e: `grep -rn "نوع چک\|فهرست چک\|چک‌ها\|ثبت چک" /home/mahan/Developer/roxira-wt/<worktree>/e2e` and update visible-text selectors that the change breaks (for example a `getByLabel('نوع چک')` or a `getByRole('tab')` of the direction select). Report every changed e2e hit. Do not change unrelated tests.

## Layout rules
- Logical CSS only: `ms-`, `me-`, `ps-`, `pe-`, `text-start`. No `ml-`, `mr-`, `pl-`, `pr-`, `text-left`.
- Works at 375 px: chips wrap; the tab row wraps; the table keeps its existing mobile handling; no horizontal page scroll at 375 px.
- Persian digits and Jalali dates everywhere (`formatJalaliDate`, `formatNumber`). Money via `Money` or `formatReportMoney`.
- Real party names only (`partyName` from the API). No placeholders.

## Tests the brief requires
- `cd output_apps/enterprise_hub/frontend && npx --yes tsx --test src/lib/cheques-ui.test.ts` must pass (old and new cases).
- `npx --yes tsx --test src/lib/nav-menu.test.ts` must still pass.
- Typecheck: `/home/mahan/Developer/roxira-wt/_fleet/heavy.sh npx tsc --noEmit -p output_apps/enterprise_hub/frontend/tsconfig.json` from the worktree root. Fix every error in files you touched; report pre-existing errors elsewhere without fixing them.

## Output expected from you
Leave the changed files in the worktree, uncommitted. Your last message: list of files changed, the test output summary, anything you could not do, and whether the journal-entry number lookup exists or was added.
