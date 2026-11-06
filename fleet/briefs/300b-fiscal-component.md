# Brief 300b: #300 checklist component and fiscal-years page wiring (frontend only)

Do NOT git commit, push or stash. Do NOT create or edit `frontend/AGENTS.md`. Do NOT symlink node_modules.
All paths relative to frontend root `output_apps/enterprise_hub/frontend`. Use EXACTLY these existing exports; they are already in the repo:
- `src/lib/fiscal-close.ts`: `buildCloseChecklist(input: {draftCount: number|null; bankDifferences: Array<{accountName: string; difference: number|null}> | null})`, `canConfirmClose(items, typedName, yearName)`, `periodLockState(locks, startDate, endDate)` returning `"locked"|"open"`, types `ChecklistItem` (fields key,label,status,detail) and `PeriodLockLike`.
- `src/lib/api/accounting-reports-client.ts`: `listPeriodLocks(signal?)` returns `PeriodLock[]` (fields periodStart, periodEnd, active, ...). Also already there: `closeFiscalYear`, `listFiscalYears`.
- `src/lib/api/accounting-client.ts`: `listJournalEntries(params: QueryJournalEntryDto = {}, signal?)` returns `{ data, total }`. `QueryJournalEntryDto` now has `fromDate?` and `toDate?` and `status?` (type `JournalEntryStatus`, value `"DRAFT"`).
- `src/lib/api/banking-client.ts`: `listBankAccounts(signal?)` returns accounts with `id` and `name`; `getReconciliationSummary(accountId: number, asOf?: string, signal?)` returns an object with `difference` (number).
- `src/lib/fa-format.ts`: `formatJalaliDate(value)`.
- `src/components/app/app-ui.tsx`: `loadErrorMessage(err)`, `LoadingLine`.
- UI: `@/components/ui/badge` (Badge), `@/components/ui/button` (Button), `@/components/ui/card`, `@/components/ui/input` (Input), `@/components/ui/label` (Label). Icons from `lucide-react`: `CheckCircle2`, `AlertTriangle`, `CircleHelp`, `Lock`, `LockOpen`. Check each icon name exists in the installed lucide-react with a grep in `node_modules/lucide-react/dist/lucide-react.d.ts` before use. Replace any missing name with a close existing one.

## 1. Create `src/components/accounting/fiscal-close-checklist.tsx`
A client component (`"use client";`), default export NOT used; named export `FiscalCloseChecklist` with props `{ year: FiscalYear; onReadyChange: (ready: boolean) => void }`. `FiscalYear` type from `@/types/accounting-reports` (fields id, name, startDate, endDate, status, closedAt).

Behaviour:
- State: `items: ChecklistItem[] | null`, `lockState: "locked"|"open"|null`, `typed: string`, `loadError: string|null`.
- Effect keyed on `year.id`: AbortController; in parallel:
  a. `listJournalEntries({ status: "DRAFT", fromDate: year.startDate, toDate: year.endDate, page: 1, limit: 1 }, signal)` → `draftCount = res.total`. On error, `draftCount = null`.
  b. `listBankAccounts(signal)` → then `Promise.all(accounts.map(a => getReconciliationSummary(a.id, year.endDate, signal).then(s => ({accountName: a.name, difference: s.difference}))))`. On any error of the bank part, `bankDifferences = null`. Each individual account failure gives `difference: null` for that account only.
  c. `listPeriodLocks(signal)` → `lockState = periodLockState(locks, year.startDate, year.endDate)`. On error set `lockState` to `"open"` and set `loadError` to `loadErrorMessage(err)`. Do not fake it: if the locks call fails, show the error text.
  Set `items = buildCloseChecklist({draftCount, bankDifferences})` once all settle. Skip the state update if aborted.
- Effect: `onReadyChange(items !== null && canConfirmClose(items, typed, year.name))`. Call `onReadyChange(false)` in the cleanup of an unmount effect.
- Render:
  - A heading line with the year range `formatJalaliDate(year.startDate) + " تا " + formatJalaliDate(year.endDate)`.
  - Lock Badge: `locked` → text `قفل` with `Lock` icon and the sentence `این سال مالی قفل است`; `open` → text `باز` with `LockOpen` icon.
  - While `items === null` and no error: `LoadingLine show` (import from app-ui) or the text `در حال بررسی…`.
  - For each item, a row: Badge text by status (`ok` → `آماده`, `blocked` → `نیاز به اقدام`, `unknown` → `بررسی دستی`), with icon (`ok` CheckCircle2, `blocked` AlertTriangle, `unknown` CircleHelp), then `item.label` (bold) and `item.detail`. Never use colour alone: text and icon are always present.
  - Typed confirmation: `<Label htmlFor="fiscal-close-typed">برای تأیید، نام سال مالی را تایپ کنید</Label>` and `<Input id="fiscal-close-typed" dir="auto" value={typed} placeholder={year.name} aria-describedby="fiscal-close-hint" onChange=... />` plus `<p id="fiscal-close-hint" className="text-sm text-muted-foreground">نام سال: {year.name}</p>`.
  - Errors: if `loadError`, show it in a `<p role="alert">`.
- Layout: logical CSS only: `ms-`, `me-`, `ps-`, `pe-`, `text-start`, `text-end`, `start-`, `end-`. Never `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right`. Rows `flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3`. Works at 375 px with no horizontal scroll.
- Persian digits: all counts already go through `toPersianDigits` inside the lib. Do not add Latin digits in UI text.

## 2. Edit `src/app/app/accounting/fiscal-years/page.tsx` (minimal)
Inside the close card only (the block that renders «بستن سال مالی {closing.name}», around line 222-245):
- Add `import { FiscalCloseChecklist } from "@/components/accounting/fiscal-close-checklist";`.
- Add state `const [closeReady, setCloseReady] = useState(false);` next to the other state.
- Render `<FiscalCloseChecklist year={closing} onReadyChange={setCloseReady} />` just above the paragraph that starts «پیش از بستن، هزینه مالیات عملکرد…».
- Change the «تأیید و بستن» Button's `disabled` so it is `disabled={busy || !closeReady || (!nextExists && (!nextYear.name.trim() || !nextYear.startDate || !nextYear.endDate))}`.
- Reset: where the page sets `setClosing(null)` (inside the close handler and the cancel handler), also call `setCloseReady(false)`.
- Do not change the list card, template card or reopen card. Do not change any other line.

## Do not touch
`src/lib/fiscal-close.ts`, its test, the API clients, `src/types/*`, any backend, `package.json`, lockfiles, nav-menu, app-shell, accounting page.

## Tests and type check (you must run and report)
From the frontend root:
- `npx --yes tsc --noEmit -p tsconfig.json 2>&1 | grep -E "fiscal-close|fiscal-years" | head -40` (only errors in the touched files matter; report the count of those errors; if tsc itself takes more than 8 minutes, say so and stop).
- `npx --yes tsx --test src/lib/fiscal-close.test.ts` (must still pass 15/15).

## Final message
Files created or changed, tsc error count in touched files, tsx counts, and anything you did not do.
