# Brief #304: tax page tabs and «مهلت بعدی» card (frontend only)

Worktree: /home/mahan/Developer/roxira-wt/304-design-tax-page-tabs-and-next-deadline-c
Frontend root: output_apps/enterprise_hub/frontend (all paths below are relative to it).
Do NOT commit. Do NOT touch package.json, lockfiles, app-shell.tsx, app.module.ts, permission-matrix.snapshot.json, migrations, .github, modules/posting_rules, modules/treasury. Backend is not changed.

## Goal (from #304 and docs/design/DESIGN_AUDIT_2026-11.md section 11)
Page `src/app/app/tax/page.tsx` (540 lines) has VAT and Moadian in one scroll. Change it to:
1. Two tabs, Persian labels exactly: «ارزش افزوده» and «سامانه مودیان». The Moadian card (`MoadianCard`) shows only under the second tab; the seasonal VAT card (`SeasonalCard`) only under the first.
2. A top card above the tabs titled «مهلت بعدی» showing a Jalali date and an amount (see the data rule below).
3. Specific error titles: replace the two `<ErrorNotice title="خطا" ...>` uses with specific titles, e.g. «خطا در دریافت اظهارنامه ارزش افزوده» (in SeasonalCard) and «خطا در ارسال به مودیان» (in MoadianCard). Keep `message={error}`.

## Reuse (do not reinvent)
- Tabs: copy the pattern in `src/components/cheques/cheques-view.tsx` lines 24-26: `<div role="tablist" aria-label="...">` with `<Button role="tab" aria-selected=... size="sm" variant={active ? "default" : "outline"}>`. Keep it inside page.tsx; do not add a shadcn Tabs package.
- Money: `src/components/ui/money.tsx` (`Money`, `Balance`) or `formatMoneyRial` from `src/lib/fa-format.ts` (already imported in page.tsx). Amounts are rials; show with `formatMoneyRial`.
- Jalali date text: `formatJalaliDate` from `src/lib/fa-format.ts`. Dates from the API are already Jalali strings where a `...Jalali` field exists; otherwise use `formatJalaliDate`.
- Numbers: `formatNumber` from fa-format (Persian digits). Do not write raw ASCII digits in UI text except inside ids.
- Errors: `loadErrorMessage` and `ErrorNotice` from `src/components/app/app-ui.tsx` (already imported).
- Existing imports at the top of page.tsx stay. Add nothing that is not used.

## The «مهلت بعدی» card: data rule (important)
There is NO VAT filing deadline in the API. Grep found no `deadline` field in `modules/tax_compliance` and no VAT term in the statutory store. Do not hardcode a legal date and do not invent one.
- Show the card with the two facts the API really gives for the current season: the period end date `period.to` from `getSeasonalVat(...)` (`SeasonalVatReport.period.to`, a Gregorian ISO string: format it with `formatJalaliDate`), and the payable amount `ret.payable` from `VatReturnDraft` (`ret` in SeasonalCard; hoist it or pass it up if the card lives in the other component; keep fetching where it is now).
- Label the date «پایان فصل» and add the honest line «مهلت قانونی این اظهارنامه در سامانه ثبت نشده است.» under it. Do not call it a deadline unless it is one.
- While loading: show a `LoadingLine` or the text «در حال بارگذاری…». When there is no data: show «اطلاعی برای این فصل نیست».
- The card is inside the tax page, above the tabs, and is visible on both tabs.
- The current season comes from the existing `currentJalali()` and the year/quarter selects. Do not change the year/quarter logic.

## Persian strings (exact)
- Page title stays «مالیات و مودیان». Description stays as is.
- Tabs: «ارزش افزوده», «سامانه مودیان».
- Card title: «مهلت بعدی». Label: «پایان فصل». Note: «مهلت قانونی این اظهارنامه در سامانه ثبت نشده است.»
- Error titles: «خطا در دریافت اظهارنامه ارزش افزوده» and «خطا در ارسال به مودیان».

## Accessibility and layout
- Tabs: `role="tablist"`, `role="tab"`, `aria-selected`, and `role="tabpanel"` on the content wrapper with `aria-labelledby` pointing to the active tab id.
- Logical CSS only (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`). No `left-`/`right-`/`ml-`/`mr-`.
- Tab row uses `flex flex-wrap gap-2` so it works at 375 px. No fixed widths above 100%.
- Contrast: use existing Button variants only.
- Keep page under the same `EnterpriseRouteGuard`.

## Tests
- Pure logic goes in a lib file: create `src/lib/tax-deadline.ts` exporting `nextDeadlineView(input)` where input is `{ periodTo: string | null; payable: number | string | null; loading: boolean }` and the output is `{ state: "loading" | "empty" | "ready"; dateLabel: string | null; amountLabel: string | null; note: string }`. `dateLabel` uses `formatJalaliDate(periodTo)`, `amountLabel` uses `formatMoneyRial(Number(payable))` (if payable is a decimal string keep the string via `formatMoneyRial` if it accepts a number only, then convert with Number only when it is a safe integer; otherwise return the raw string). Keep it short.
- Test: `src/lib/tax-deadline.test.ts` using `node:test` and `node:assert/strict`, run with `npx --yes tsx --test src/lib/tax-deadline.test.ts`. Cases: loading -> state loading; null periodTo -> state empty with dateLabel null; a periodTo of "2026-03-20" -> dateLabel is Persian digits (contains "۱۴۰۴" or "۱۴۰۵" as computed by formatJalaliDate; compute the expected by calling formatJalaliDate in the test rather than hardcoding); payable "0" -> amountLabel "۰ ریال"-style text produced by formatMoneyRial (call it in the test to compare).
- Add the test file to the `test` script in package.json? NO: package.json is a hotspot. Do not edit it. Report it as NEEDS HOTSPOT if needed.

## Do not
- Do not change the API client, the backend, or `src/lib/api/moadian-seasonal-client.ts` (the #443 fix is on another branch; leave the imports as they are on this branch, they are already fixed on main by the other PR; if the imports are missing in your branch, add the 2 missing names `downloadVatReturn` and `getVatReturn` to the import list, nothing else).
- Do not add a new npm dependency.
- Do not change nav-menu.ts labels for the tax item in this PR.
- No fake data. Use only the API responses.

## Final check the builder must do
- `npx --yes tsx --test src/lib/tax-deadline.test.ts` passes.
- `grep -n "title=\"خطا\"" src/app/app/tax/page.tsx` returns nothing.
- `grep -n "left-\|right-\|ml-\|mr-" src/app/app/tax/page.tsx` returns nothing.
