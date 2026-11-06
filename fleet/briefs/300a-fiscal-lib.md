# Brief 300a: #300 pure logic and period-lock client (frontend only)

Do NOT git commit, push or stash. Do NOT create or edit `frontend/AGENTS.md`. Do NOT symlink node_modules.
All paths relative to the frontend root `output_apps/enterprise_hub/frontend` of the worktree.
You MUST create these new files and make these edits. Do not stop after the edits to `accounting.ts` and `accounting-client.ts` (already done).

## 1. Create `src/lib/fiscal-close.ts` (pure, no React, no fetch)
Export exactly:
- `type ChecklistStatus = "ok" | "blocked" | "unknown";`
- `interface ChecklistItem { key: "drafts" | "bank" | "depreciation"; label: string; status: ChecklistStatus; detail: string; }`
- `interface CloseChecklistInput { draftCount: number | null; bankDifferences: Array<{ accountName: string; difference: number | null }> | null; }`
- `buildCloseChecklist(input: CloseChecklistInput): ChecklistItem[]` returns exactly 3 items in this order:
  1. key `drafts`, label `سندهای پیش‌نویس`.
     - `draftCount === null`: status `unknown`, detail `تعداد سندهای پیش‌نویس در دسترس نیست`.
     - `draftCount === 0`: status `ok`, detail `سند پیش‌نویسی در این سال نیست`.
     - `draftCount > 0`: status `blocked`, detail = `${toPersianDigits(n)} سند پیش‌نویس باید قطعی یا حذف شود`.
  2. key `bank`, label `مغایرت‌گیری بانک`.
     - `bankDifferences === null`: status `unknown`, detail `وضعیت حساب‌های بانکی در دسترس نیست`.
     - empty array: status `ok`, detail `حساب بانکی تعریف نشده است`.
     - any entry with `difference === null`: status `unknown`, detail `مانده مغایرت‌گیری حساب ${name} در دسترس نیست` (name = first such accountName).
     - any entry with `difference !== 0` (first such entry): status `blocked`, detail `حساب ${name} هنوز تطبیق نشده است`.
     - all differences `=== 0`: status `ok`, detail `همه حساب‌های بانکی تطبیق شده‌اند`.
  3. key `depreciation`, label `استهلاک دارایی‌های ثابت`, status always `unknown`, detail `آخرین ماه ثبت‌شده هنوز از سرور در دسترس نیست؛ پیش از بستن دستی بررسی کنید`.
- `canConfirmClose(items: ChecklistItem[], typedName: string, yearName: string): boolean`: true only when no item has status `blocked`, and `normalizeName(typedName) === normalizeName(yearName)`, and that normalized year name is not empty.
- `normalizeName(s: string): string`: trim; convert Persian digits ۰-۹ (U+06F0-U+06F9) and Arabic-Indic digits ٠-٩ (U+0660-U+0669) to Latin 0-9; remove ZWNJ U+200C and all whitespace.
- `toPersianDigits(n: number): string`: maps 0-9 to ۰-۹; negative numbers get a leading `-` then the digits.
- `type PeriodLockLike = { periodStart: string; periodEnd: string; active: boolean };`
- `periodLockState(locks: PeriodLockLike[], startDate: string, endDate: string): "locked" | "open"`: `"locked"` when some lock with `active === true` overlaps, where overlap means `lock.periodStart <= endDate && lock.periodEnd >= startDate` (string compare on YYYY-MM-DD). Otherwise `"open"`.

## 2. Create `src/lib/fiscal-close.test.ts`
`node:test` and `node:assert/strict`, `import { ... } from "./fiscal-close.ts";` (same style as `src/lib/nav-menu.test.ts`). At least these assertions, with these exact expected values:
- `buildCloseChecklist({draftCount:0, bankDifferences:[]}).map(i=>i.status)` deep-equals `["ok","ok","unknown"]`.
- `buildCloseChecklist({draftCount:3, bankDifferences:[{accountName:"بانک ملی", difference:0}]}).map(i=>i.status)` deep-equals `["blocked","ok","unknown"]`, and item[0].detail includes `۳`.
- `buildCloseChecklist({draftCount:null, bankDifferences:null}).map(i=>i.status)` deep-equals `["unknown","unknown","unknown"]`.
- `buildCloseChecklist({draftCount:0, bankDifferences:[{accountName:"بانک ملت", difference:125000}]})[1].status === "blocked"` and its detail includes `بانک ملت`.
- `buildCloseChecklist({draftCount:0, bankDifferences:[{accountName:"بانک ملت", difference:null}]})[1].status === "unknown"`.
- `canConfirmClose(allOk, "۱۴۰۵", "1405") === true` where allOk = `buildCloseChecklist({draftCount:0, bankDifferences:[]})`.
- `canConfirmClose(allOk, " ۱۴۰۵ ", "۱۴۰۵") === true`.
- `canConfirmClose(allOk, "۱۴۰۴", "۱۴۰۵") === false`.
- `canConfirmClose(buildCloseChecklist({draftCount:2, bankDifferences:[]}), "۱۴۰۵", "۱۴۰۵") === false`.
- `canConfirmClose(allOk, "", "") === false`.
- `toPersianDigits(0) === "۰"`, `toPersianDigits(-1405) === "-۱۴۰۵"`, `toPersianDigits(12) === "۱۲"`.
- `normalizeName("۱۴۰۵‌۰۱") === "140501"`.
- `periodLockState([{periodStart:"2026-03-21", periodEnd:"2027-03-20", active:true}], "2026-03-21", "2027-03-20") === "locked"`.
- same lock with `active:false` gives `"open"`; `[]` gives `"open"`; lock `2025-01-01`..`2025-12-29` against range `2026-03-21`..`2027-03-20` gives `"open"`.

Run: `npx --yes tsx --test src/lib/fiscal-close.test.ts`. All must pass.

## 3. Edit `src/lib/api/accounting-reports-client.ts`
Add (follow the file's style, it already imports `apiRequest` and defines `BASE`):
- `export interface PeriodLock { id: number; periodStart: string; periodEnd: string; reason: string | null; lockedBy: string; lockedAt: string; active: boolean; unlockedAt: string | null; }`
- `export const listPeriodLocks = (signal?: AbortSignal) => apiRequest<PeriodLock[]>(`${BASE}/period-locks`, { signal });`

## Do not touch
Anything else. Do not edit the fiscal-years page yet. Do not create the component yet.

## Final message
List files created or changed, and the tsx test result (pass/fail counts).
