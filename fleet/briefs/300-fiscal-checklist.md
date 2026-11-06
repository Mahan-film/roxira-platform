# Brief: #300 design: fiscal years page with pre-close checklist (frontend only)

Do NOT run git commit, git push or git stash. The supervisor commits. Do not touch files not listed below.
Frontend root: `output_apps/enterprise_hub/frontend` (relative to the worktree root). Paths below are relative to that root.

## Context (read these parts only)
- `src/app/app/accounting/fiscal-years/page.tsx` (287 lines). The close card starts near line 222 (`closing` state; «بستن سال مالی {closing.name}»; the confirm button «تأیید و بستن» calls `closeFiscalYear(closing.id, ...)`). The year list card is near line 157; status Badge near line 192. Keep everything else on the page as it is.
- `src/lib/api/accounting-reports-client.ts`: `BASE`, `listFiscalYears`, `closeFiscalYear`. Uses `apiRequest` from `@/lib/api/http-client`.
- `src/lib/api/banking-client.ts`: `listBankAccounts(signal?)` and `getReconciliationSummary(accountId, asOf?, signal?)` already exist. Reuse them, do not duplicate.
- `src/lib/api/accounting-client.ts`: `listJournalEntries(params: QueryJournalEntryDto = {}, signal?)` already exists (line ~60). Reuse it.
- `src/lib/fa-format.ts`: `formatJalaliDate(value)` exists (line 39), `formatNumber`, `formatMoneyRial`.
- `src/components/ui/badge.tsx`, `button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`, `jalali-date-input.tsx`, `money.tsx` (`Money` component, line 26) exist.
- Backend contract (read-only, do not edit):
  - `GET enterprise-hub/accounting/journal-entries` with query `status` (`POSTED|DRAFT|TEMPORARY|VOID`), `fromDate`, `toDate` (YYYY-MM-DD, inclusive), `page`, `limit`. Response `{ data, total }`. Check `modules/accounting/dto/query-journal-entry.dto.ts` lines 1-60 for the exact param names before use.
  - `GET enterprise-hub/accounting/period-locks`: returns `PeriodLockResponseDto[]` with fields `id, periodStart, periodEnd, reason, lockedBy, lockedAt, active, unlockedAt` (from `modules/accounting/dto/period-lock.dto.ts` line 32). Dates are YYYY-MM-DD strings.
  - `GET enterprise-hub/banking/accounts` returns bank accounts (`id`, `name`, ...).
  - `GET enterprise-hub/banking/accounts/:id/summary?asOf=YYYY-MM-DD` returns `ReconciliationSummaryDto` with `difference` (0 = fully reconciled), `unmatchedBankDeposits`, `unmatchedBankWithdrawals`, and so on (`modules/banking/dto/reconciliation.dto.ts` line 118).
  - No route tells the last depreciation month. Do not invent one.

## What to build

### 1. New `src/lib/fiscal-close.ts` (pure logic, no React, no fetch)
Export:
- `type ChecklistStatus = "ok" | "blocked" | "unknown"`.
- `interface ChecklistItem { key: "drafts" | "bank" | "depreciation"; label: string; status: ChecklistStatus; detail: string }`.
- `buildCloseChecklist(input: { draftCount: number | null; bankDifferences: Array<{ accountName: string; difference: number | null }>; }): ChecklistItem[]`
  Returns exactly 3 items in this order:
  1. key `drafts`, label «سندهای پیش‌نویس»:
     - `draftCount === null` gives status `unknown`, detail «تعداد سندهای پیش‌نویس در دسترس نیست».
     - `draftCount === 0` gives `ok`, detail «سند پیش‌نویسی در این سال نیست».
     - `draftCount > 0` gives `blocked`, detail = «`{n}` سند پیش‌نویس باید قطعی یا حذف شود» where `{n}` is Persian digits (use `toPersianDigits` below).
  2. key `bank`, label «مغایرت‌گیری بانک»:
     - empty `bankDifferences` gives `ok`, detail «حساب بانکی تعریف نشده است».
     - any entry with `difference === null` gives `unknown`, detail «مانده مغایرت‌گیری حساب ‹name› در دسترس نیست».
     - any entry with `difference !== 0` gives `blocked`, detail «حساب ‹name› هنوز تطبیق نشده است» (use the first such account name).
     - all `difference === 0` gives `ok`, detail «همه حساب‌های بانکی تطبیق شده‌اند».
  3. key `depreciation`, label «استهلاک دارایی‌های ثابت», always `status: "unknown"`, detail «آخرین ماه ثبت‌شده هنوز از سرور در دسترس نیست؛ پیش از بستن دستی بررسی کنید».
- `canConfirmClose(items: ChecklistItem[], typedName: string, yearName: string): boolean`
  Returns true only when no item is `blocked`, and `normalizeName(typedName) === normalizeName(yearName)` and the normalized year name is not empty.
- `normalizeName(s: string): string`: trim, convert Persian (۰-۹) and Arabic-Indic (٠-٩) digits to Latin 0-9, and remove all ZWNJ (U+200C) and spaces.
- `toPersianDigits(n: number): string`: converts 0-9 to ۰-۹; for negative numbers prefix «-» before the digits.
- `periodLockState(locks: PeriodLockLike[], startDate: string, endDate: string): "locked" | "open"`
  `PeriodLockLike = { periodStart: string; periodEnd: string; active: boolean }`. Returns `"locked"` when at least one lock with `active === true` overlaps the range (overlap = `lock.periodStart <= endDate && lock.periodEnd >= startDate`, string comparison on YYYY-MM-DD). Else `"open"`.

Test file: `src/lib/fiscal-close.test.ts`, using `node:test` and `node:assert/strict`, importing from `./fiscal-close.ts`, like `src/lib/nav-menu.test.ts`. Cover at least these (expected values computed by hand, must match):
- `buildCloseChecklist({draftCount: 0, bankDifferences: []})` → statuses `["ok","ok","unknown"]`.
- `buildCloseChecklist({draftCount: 3, bankDifferences: [{accountName:"بانک ملی", difference: 0}]})` → statuses `["blocked","ok","unknown"]` and item[0].detail contains `۳`.
- `buildCloseChecklist({draftCount: null, bankDifferences: [{accountName:"بانک ملت", difference: null}]})` → statuses `["unknown","unknown","unknown"]`.
- `buildCloseChecklist({draftCount: 0, bankDifferences: [{accountName:"بانک ملت", difference: 125000}]})` → item[1].status `"blocked"` and item[1].detail contains «بانک ملت».
- `canConfirmClose(items_all_ok, "۱۴۰۵", "1405")` → true.
- `canConfirmClose(items_all_ok, " ۱۴۰۵ ", "۱۴۰۵")` → true.
- `canConfirmClose(items_all_ok, "۱۴۰۴", "۱۴۰۵")` → false.
- `canConfirmClose(items_with_one_blocked, "۱۴۰۵", "۱۴۰۵")` → false.
- `canConfirmClose(items_all_ok, "", "")` → false.
- `toPersianDigits(0) === "۰"`, `toPersianDigits(-1405) === "-۱۴۰۵"`, `toPersianDigits(12) === "۱۲"`.
- `normalizeName("۱۴۰۵‌۰۱")` → `"140501"`.
- `periodLockState([{periodStart:"2026-03-21", periodEnd:"2027-03-20", active:true}], "2026-03-21", "2027-03-20")` → `"locked"`; same lock with `active:false` → `"open"`; `[]` → `"open"`; lock `"2025-01-01".."2025-12-29"` with range `"2026-03-21".."2027-03-20"` → `"open"`.

### 2. Edit `src/lib/api/accounting-reports-client.ts`
Add, following the file's existing style:
- `export interface PeriodLock { id: number; periodStart: string; periodEnd: string; reason: string | null; lockedBy: string; lockedAt: string; active: boolean; unlockedAt: string | null }` (or put the type in `src/types/accounting-reports.ts` next to `FiscalYear` at line 165, and import it. Choose one and be consistent).
- `export const listPeriodLocks = (signal?: AbortSignal) => apiRequest<PeriodLock[]>(`${BASE}/period-locks`, { signal });`

### 3. New `src/components/accounting/fiscal-close-checklist.tsx`
Props: `{ year: FiscalYear; typedName: string; onTypedNameChange: (v: string) => void; onReadyChange: (ready: boolean) => void }`. Hmm, simpler: props `{ year: FiscalYear; onReadyChange: (ready: boolean) => void }` and the typed input lives in this component too. Then the close button on the page is disabled based on `ready` from the callback. Use this design:
- On mount and when `year` changes: fetch in parallel with `Promise.all`:
  a. `listJournalEntries({ status: "DRAFT", fromDate: year.startDate, toDate: year.endDate, page: 1, limit: 1 })` → `draftCount = result.total`. Check the exact `listJournalEntries` params type (`QueryJournalEntryDto`) first and adapt.
  b. `listBankAccounts()` then, for each account, `getReconciliationSummary(account.id, year.endDate)` → `{ accountName: account.name, difference: summary.difference }`. Use `Promise.all`. If the bank call fails, use `[]`? NO: if listBankAccounts fails, pass `difference: null` for one synthetic entry is wrong too. Instead: on bank failure return `null` for the whole bank part and show that the bank item is unknown. Adjust `buildCloseChecklist` input accordingly: `bankDifferences: Array<...> | null`, and when `null` return status `unknown` for bank with detail «وضعیت حساب‌های بانکی در دسترس نیست». ADD this case to the lib and to the test (`bankDifferences: null` → item[1].status `"unknown"`).
  c. `listPeriodLocks()` → `periodLockState(locks, year.startDate, year.endDate)`.
- Show a loading line while fetching (`LoadingLine` from `@/components/app/app-ui`, or a text «در حال بررسی…»).
- Show the three checklist items as rows: a Badge for status (ok: «آماده»; blocked: «نیاز به اقدام»; unknown: «بررسی دستی»), the label, and the detail. Never use colour alone: each badge has text and an icon (`CheckCircle2`, `AlertTriangle`, `CircleHelp` from `lucide-react`).
- Show the lock state: `locked` gives Badge «قفل» plus text «این سال مالی قفل است»; `open` gives Badge «باز». Show the year range with `formatJalaliDate(year.startDate)` and `formatJalaliDate(year.endDate)`, joined with « تا ».
- Typed confirmation: a `Label` «برای تأیید، نام سال مالی را تایپ کنید» and an `Input` with the placeholder equal to `year.name`, `dir="auto"`, `aria-describedby` pointing to the detail text. `ready = canConfirmClose(items, typed, year.name)` (only once loaded; before load, `ready` is false). Call `onReadyChange(ready)` in an effect when it changes. Also ensure `onReadyChange(false)` on unmount.
- Error handling: if `draftCount` fails, status unknown, no crash. Use `loadErrorMessage` from `@/components/app/app-ui` for any error text.
- Layout: logical CSS only (`ms-`, `me-`, `ps-`, `pe-`, `text-start`, `text-end`). Never `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right`. Works at 375 px with no horizontal scroll; the row stacks vertically below 640 px (`flex-col sm:flex-row`).
- Numbers: Persian digits for counts via `toPersianDigits`. Money (only if you show it): use `Money` from `@/components/ui/money`. You do not need money here.

### 4. Edit `src/app/app/accounting/fiscal-years/page.tsx`
Only inside the close card (the `closing` block near line 222):
- Render `<FiscalCloseChecklist year={closing} onReadyChange={setCloseReady} />` above the «پیش از بستن…» paragraph.
- Add `const [closeReady, setCloseReady] = useState(false);` near the other state. Reset `closeReady` to false when `closing` changes to null (in the existing code path that does `setClosing(null)`, or with an effect; keep it small).
- Disable the «تأیید و بستن» button when `!closeReady` in addition to the existing `busy || ...` condition.
- Do not change the list card, the template card or the reopen card.

## Do not touch
- `src/app/app/accounting/page.tsx` (issue #296 is a later slice).
- `src/lib/nav-menu.ts`, `src/app/app-shell.tsx`, `package.json`, lockfiles, `app.module.ts`, `permission-matrix.snapshot.json`, `migrations/`, `.github/`, `modules/posting_rules`, `modules/treasury`, anything under `output_apps/enterprise_hub/modules/` (backend is read-only here).
- Do not add npm packages. Do not add a backend route.

## Tests to run (paste the pass/fail counts)
From `output_apps/enterprise_hub/frontend`:
- `npx --yes tsx --test src/lib/fiscal-close.test.ts`
Expected: all pass, at least 12 tests.
Also run `npx --yes tsc --noEmit -p tsconfig.json` from the same folder ONLY if it finishes in under 5 minutes; otherwise say so.

## Done means
- Files above exist, the tsx test passes, the page still compiles in your reading (check imports by grep).
- Do not commit. At the end print `git status --short` and `git diff --stat`.
- Final message: list of files changed, test output summary, and anything you could not do. Say explicitly that depreciation status is always «unknown» because no route exposes it.

## Addendum (supervisor, checked against the types)
- The frontend type `QueryJournalEntryDto` in `src/types/accounting.ts` (lines 93-98) has no `fromDate` or `toDate`. Add them as optional `string` fields there (one-line each, with a comment «YYYY-MM-DD»). This is the only edit allowed in `src/types/accounting.ts`.
- The journal list response `JournalEntryResponse` (same file, line 64) has `totalDebit` and `totalCredit`. You do not need them here.

## Coordinator correction (applies to all frontend work)
- Do NOT symlink `node_modules` anywhere; a symlinked `node_modules` breaks Next dev (500s, ENOENT on build-manifest).
- Do NOT create, edit or commit `frontend/AGENTS.md`.
