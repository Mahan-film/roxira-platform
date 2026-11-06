# Brief: #299 design: reports hub at /app/reports (frontend only)

Do NOT run git commit, git push or git stash. The supervisor commits. Do not touch any file not listed below.
Frontend root: `output_apps/enterprise_hub/frontend` (relative to the worktree root). All paths below are relative to that frontend root.

## Context (read only these)
- `src/app/app/accounting/reports/page.tsx` (342 lines): the existing report page. Its `TABS` const (lines 45-58) holds 12 keys with Persian labels. Tabs are local `useState`, no URL param.
- `src/lib/nav-menu.ts`: `MENU_GROUPS`. The group with `id: "reports-settings"` has a leaf `href: "/app/accounting/reports"`, label «گزارش‌های حسابداری», icon `ChartColumn`.
- `src/lib/nav-menu.test.ts`: existing menu tests. Read the first 30 lines only.
- Page shell to copy: `src/app/app/accounting/page.tsx` (first 60 lines): `"use client"`, `EnterpriseRouteGuard requireAdmin`, `PageHeader` from `@/components/app/app-ui`, `Link` from `next/link`, `buttonVariants` from `@/components/ui/button`.
- Card: `@/components/ui/card` exports `Card`, `CardHeader`, `CardTitle`, `CardContent` (check the export names with grep before use).

## Exact behaviour

### 1. New file `src/lib/reports-hub.ts` (pure logic, no React)
Export:
- `REPORT_GROUPS`: an array of exactly 3 groups, each `{ id: string; title: string; reports: ReportCard[] }`, where `ReportCard = { key: string; title: string; description: string }`.
- `reportHref(key: string): string` returns `` `/app/accounting/reports?tab=${key}` ``.
- `parseReportTab(value: string | null | undefined): string | null` returns `value` if it is one of the 12 keys, else `null`.
- `ALL_REPORT_KEYS: string[]` = all 12 keys in group order.

Groups, in this order, with these exact strings (copy them character for character):

Group id `statements`, title «صورت‌های مالی»:
1. key `balance-sheet`, title «ترازنامه», description «وضعیت دارایی‌ها، بدهی‌ها و حقوق مالکانه در یک تاریخ»
2. key `income-statement`, title «سود و زیان», description «درآمد، هزینه و سود یا زیان یک دوره»
3. key `cash-flow`, title «جریان نقد», description «ورود و خروج نقد در یک دوره»
4. key `equity-changes`, title «تغییرات حقوق مالکانه», description «تغییر سرمایه، اندوخته و سود انباشته در یک دوره»

Group id `books`, title «دفاتر و تراز»:
5. key `trial-balance`, title «تراز آزمایشی», description «مانده بدهکار و بستانکار حساب‌ها»
6. key `subsidiary`, title «تراز تفصیلی», description «مانده معین‌ها به تفکیک تفصیلی»
7. key `ledger`, title «دفتر کل و معین», description «گردش یک حساب یا یک معین»
8. key `journal-book`, title «دفتر روزنامه», description «همه اسناد به ترتیب تاریخ و شماره»
9. key `general-ledger-book`, title «دفتر کل (چاپی)», description «دفتر کل آماده چاپ»
10. key `chart-of-accounts`, title «سرفصل حساب‌ها», description «فهرست کامل سرفصل‌ها برای خروجی»

Group id `receivables`, title «مطالبات و بدهی‌ها»:
11. key `ageing`, title «گزارش سنی», description «سن مطالبات و بدهی‌ها بر اساس روز گذشت»
12. key `party-statement`, title «صورت‌حساب طرف حساب», description «گردش حساب یک مشتری یا تأمین‌کننده»

Tests: `src/lib/reports-hub.test.ts`, using `node:test` and `node:assert/strict` like `src/lib/nav-menu.test.ts`. Import from `./reports-hub.ts`. Cover:
- exactly 3 groups; 12 cards in total; all keys unique.
- `ALL_REPORT_KEYS` equals the 12 keys in the order above.
- every `reportHref(k)` starts with `/app/accounting/reports?tab=` and ends with `k`.
- `parseReportTab("ageing") === "ageing"`, `parseReportTab("bogus") === null`, `parseReportTab(null) === null`, `parseReportTab("") === null`.
- every title and description is non-empty and contains no Latin letters `[A-Za-z]` and no Latin digits `[0-9]`.

### 2. New file `src/app/app/reports/page.tsx` (route `/app/reports`)
- `"use client"`, default export `ReportsHubPage`.
- Wrapped in `<EnterpriseRouteGuard requireAdmin>`.
- `<PageHeader title="گزارش‌ها" description="صورت‌های مالی، دفاتر و مطالبات؛ هر گزارش با دوره، مقایسه و خروجی اکسل یا PDF" icon={...} />`. Use the `FileBarChart` icon from `lucide-react` with class `size-6 text-indigo-500`, as the accounting page does. Check the exact `PageHeader` prop names in `src/components/app/app-ui.tsx` (lines 17-43) before writing.
- Render each group as a section: `<h2>` with the group title, then a responsive grid `grid gap-3 sm:grid-cols-2 xl:grid-cols-3`. Each report is a `Card` with the title as a link to `reportHref(key)` and the description under it. The whole card is one `Link` to `reportHref(key)` (or the title is the link; pick one and keep it accessible: one link per card).
- No API calls and no fake data. Do not call `listAccounts` or any other API here.
- Layout: RTL and mobile. Use logical classes only (`ms-`, `me-`, `ps-`, `pe-`, `text-start`, `text-end`). Never use `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right`. Works at 375 px with no horizontal scroll.
- Minimum tap target 44 px (`min-h-11`) on the link cards.
- Colour: use only existing Tailwind colours already used in the repo (for example `text-foreground`, `text-muted-foreground`, `indigo-500` for the icon). No `#000` or `#fff`.
- Persian digits: none are needed in this page.

### 3. Edit `src/app/app/accounting/reports/page.tsx`
Make the report page honour `?tab=<key>` on first load so hub links work:
- Add `import { parseReportTab } from "@/lib/reports-hub";`.
- Add a `useEffect(() => { const t = parseReportTab(new URLSearchParams(window.location.search).get("tab")); if (t) setTab(t as TabKey); }, []);` near the existing state. Cast as needed. Do not use `useSearchParams` (it needs a Suspense boundary).
- Change nothing else in that file. The default tab stays `trial-balance`.

### 4. Edit `src/lib/nav-menu.ts`
In the `reports-settings` group, replace the leaf `href: "/app/accounting/reports"`, `label: "گزارش‌های حسابداری"` with:
`{ href: "/app/reports", label: "گزارش‌ها", icon: "ChartColumn", module: "accounting" }`.
Keep the other leaves in that group untouched. Do not touch any other group.
If `src/lib/nav-menu.test.ts` asserts the old label or href, update that assertion to the new value and say so in your report.

## Do not touch
- `src/app/app/page.tsx` (the dashboard is frozen until the design audit #294 specifies it).
- `src/app/app/accounting/page.tsx` (that is issue #296, a later slice).
- `src/app/app-shell.tsx`, `package.json`, any lockfile, `app.module.ts`, `permission-matrix.snapshot.json`, anything in `migrations/`, `.github/`, `modules/posting_rules`, `modules/treasury`.
- Do not add npm packages.
- Do not add a new API route.

## Tests to run (you must run them and paste the pass/fail counts)
From `output_apps/enterprise_hub/frontend`:
- `npx --yes tsx --test src/lib/reports-hub.test.ts src/lib/nav-menu.test.ts`
Expected: all tests pass. The `reports-hub` file must have at least 6 tests.

## Done means
- The files above exist and the two tsx tests pass.
- Do not commit. Print `git status --short` and the output of `git diff --stat` at the end.
- Final message to the supervisor: list of files changed, test output summary, and anything you could not do.
