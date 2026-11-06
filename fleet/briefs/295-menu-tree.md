# Brief: issue #295 new menu tree (worktree root given to you; frontend = output_apps/enterprise_hub/frontend)

Do NOT commit, do NOT push, do NOT touch package.json (I edit it), e2e/, docs/, .github. node_modules is installed by me (npm ci); do not run npm install.
Run tests only with: `cd output_apps/enterprise_hub/frontend && npx --yes tsx --test src/lib/nav-menu.test.ts`.
Labels in Persian, no Latin words in any label, code/comments in English.

## 1. New pure file `frontend/src/lib/nav-menu.ts` (no React, no lucide import; only `import type { AccessActionKey, AccessModuleKey } from "../types/access"`)
```ts
export interface MenuLeaf { href: string; label: string; icon: string; module?: AccessModuleKey; keywords?: string[]; }
export interface MenuGroup { id: string; label: string; icon: string; items: MenuLeaf[]; }
export const MENU_GROUPS: MenuGroup[]   // exactly 9, in this order
export const OPERATOR_ITEMS: MenuLeaf[] // platform-admin only, rendered outside the groups
export interface QuickCreate { id: string; label: string; href: string; module: AccessModuleKey; action: AccessActionKey; keywords: string[]; icon: string }
export const QUICK_CREATE: QuickCreate[]
export function visibleGroups(can:(m:AccessModuleKey,a:AccessActionKey)=>boolean, opts:{assistantEnabled:boolean}): MenuGroup[]
export function activeHref(pathname: string, hrefs: string[]): string | null
```
`icon` values are lucide icon names as strings (the shell maps them).

Groups (id, label, items). Use EXACTLY these labels and hrefs; all hrefs exist today:
1. `dashboard` «پیشخوان»: «داشبورد» /app (no module); «دستیار هوشمند» /app/assistant module assistant
2. `parties` «طرف‌حساب‌ها و کالاها»: «مشتریان و طرف‌حساب‌ها» /app/crm module crm; «ورود از اکسل» /app/import module data_import
3. `sales` «فروش و پایانه فروشگاهی»: «صورتحساب‌ها» /app/invoicing module invoicing
4. `purchase` «خرید و هزینه‌ها»: items [] (no pages exist yet)
5. `stock` «انبارداری»: «کالا و موجودی» /app/inventory module inventory; «خسارت‌ها» /damages module damages
6. `treasury` «خزانه‌داری»: «بانک و تطبیق» /app/accounting/bank module banking; «چک‌ها» /app/cheques module cheques; «تنخواه» /app/accounting/petty-cash module accounting
7. `accounting` «حسابداری و اموال»: «حساب‌ها و اسناد» /app/accounting module accounting; «داشبورد مدیریتی» /app/accounting/dashboard module accounting; «سال مالی و سرفصل» /app/accounting/fiscal-years module accounting
8. `payroll-tax` «حقوق و دستمزد و مالیات»: «مالیات و مودیان» /app/tax module tax; «کارکنان» /app/hr module hr; «حقوق و دستمزد ماهانه» /app/hr/payroll module hr; «پارامترهای قانونی» /app/hr/statutory module hr
9. `reports-settings` «گزارش‌ها و تنظیمات»: «گزارش‌های حسابداری» /app/accounting/reports module accounting; «اعضا و نقش‌ها» /app/settings/members module members; «ماژول‌ها» /app/settings/modules module members; «ثبت خودکار سند» /app/settings/posting-rules module accounting; «گزارش رخدادها» /app/settings/audit module audit; «امنیت حساب» /app/settings/security (no module)

OPERATOR_ITEMS: «ماژول‌های مشتریان» /app/admin/entitlements.

QUICK_CREATE (only things that really work today): «سرنخ جدید» /app/crm?new=1 crm/create; «صورتحساب جدید» /app/invoicing?new=1 invoicing/create; «کارمند جدید» /app/hr?new=1 hr/create; «ورود فایل» /app/import data_import/create. Give each Persian+English keywords like the existing palette entries in command-palette.tsx.

`visibleGroups` replicates today's filter in app-shell.tsx exactly: drop /app/assistant when !assistantEnabled; keep an item with no module; keep a module item only if `can(module,"read")`; /app always kept. Return only groups with at least one visible item. It only filters, never adds.

`activeHref(pathname, hrefs)`: return the longest href such that pathname === href or pathname.startsWith(href + "/"); special case: href "/app" matches ONLY pathname === "/app". Return null when none. (Replaces the old special case for /app/accounting/bank.)

## 2. Test `frontend/src/lib/nav-menu.test.ts` (node:test + node:assert/strict, style of src/lib/import-routing.test.ts)
- group ids in the exact order above, 9 groups, and the 9 Persian labels exactly.
- every leaf href and the path part (before `?`) of every QUICK_CREATE href maps to an existing page: walk `src/app` (resolve with `fileURLToPath(new URL("../app", import.meta.url))`), collect routes from every `page.tsx` (strip `(group)` segments; keep `[x]` segments literally so they never match), assert membership. `/app` is src/app/app/page.tsx.
- no duplicate href across all groups + operator items; no duplicate group id; no duplicate leaf label.
- at most two levels: assert no leaf has an `items` property.
- no Latin letters (/[A-Za-z]/) in any group, leaf or quick-create label.
- visibleGroups: can=()=>true -> everything except assistant when assistantEnabled=false; can=()=>false -> only /app (group 1) and /app/settings/security (group 9); every returned href is in MENU_GROUPS; a role with only crm read sees exactly /app, /app/crm, /app/settings/security.
- activeHref: "/app/accounting/bank/reconcile" -> "/app/accounting/bank"; "/app/accounting" -> "/app/accounting"; "/app/hr/payroll" -> "/app/hr/payroll"; "/app/hr/contracts/5/allowances" -> "/app/hr"; "/app/settings/security" -> itself; "/app" -> "/app"; "/app/unknown" -> null; "/damages" -> "/damages" (use all hrefs of MENU_GROUPS as input).

## 3. `frontend/src/components/app/app-shell.tsx` (hotspot, I hold it; edit surgically)
Replace NAV_ITEMS/NavItem/GROUP_* /isActive and the list rendering in SidebarContent with the new data:
- icon name -> lucide component via a const record in app-shell (reuse existing imports; add what you need such as Wallet, ChartColumn, CalendarRange, Boxes, ShoppingCart, Calculator, ChevronDown, Plus; verify each name exists in node_modules/lucide-react).
- Keep `<nav aria-label="منوی نرم‌افزار" data-testid="app-sidebar-nav">` and the mobile drawer's dialog aria-label unchanged.
- Each group is a disclosure: `<button type="button" aria-expanded={open} aria-controls={panelId}>` with group icon, label and ChevronDown (rotates), followed by `<ul id={panelId}>` of links, using the `hidden` attribute when collapsed. Buttons use `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`. ALL groups start expanded (existing e2e specs look for links without opening groups); the user can collapse/expand with plain React state (a Set of collapsed ids, no storage). Use React useId for panel ids (must be unique between the desktop sidebar and the mobile drawer, which can both be mounted).
- Active item: `activeHref(pathname, visibleHrefs)`; only that link gets `aria-current="page"` and the existing active classNames.
- Filtering: `visibleGroups(can, {assistantEnabled})`. Operator item: render OPERATOR_ITEMS in a separate section after the groups titled «مدیریت پلتفرم», only when `user?.role === "ADMIN"`.
- Links keep `onClick={onNavigate}`.
- Header: next to the search button add a button «+ ثبت جدید» (`aria-label="ثبت جدید"`, Plus icon, text visible from sm up, icon-only on mobile, 40px target, same focus ring) that opens the command palette in create mode: state `paletteMode: "all" | "create"` in AppShell; the search button opens "all"; Ctrl+K keeps working (opens "all"). Pass `mode={paletteMode}` to CommandPalette.

## 4. `frontend/src/components/app/command-palette.tsx`
- New optional prop `mode?: "all" | "create"` (default "all"). In "create" mode the list contains only create actions (QUICK_CREATE filtered with `can(module, action)`). Keep the dialog's existing aria-label containing «پالت فرمان» (e2e/app/06 matches /پالت فرمان/), keep import-file (goImport("file")) and import-database («انتقال کامل دیتابیس», goImport("package")) behaving exactly as now (import-database stays in "all" mode only, with its existing `data_import/create` need).
- In "all" mode replace the hard-coded navigation entries (dashboard, crm, hr, inventory, accounting, invoicing, import, assistant) with entries generated from `visibleGroups(can,{assistantEnabled})`: one per leaf, labelFa = leaf.label, labelEn = the group label, keywords = [group.label, ...(leaf.keywords ?? [])], id = href, icon from the same name->component record (put that record in a small shared file `src/components/app/nav-icons.ts` exporting `NAV_ICONS`, and import it from both app-shell and the palette). Also generate the create entries from QUICK_CREATE (replacing new-lead, new-employee, new-invoice, import-file's navigation target stays goImport("file")). Typing «خزانه» must find the treasury leaves via the group-label keyword.
- Add Persian + English keywords on leaves in nav-menu.ts where cheap (crm: customer, lead, مشتری, سرنخ; inventory: stock, warehouse, کالا, انبار, موجودی; invoicing: invoice, فاکتور; accounting: ledger, journal, دفتر, تراز; import: excel, csv, اکسل; hr: employee, کارمند, پرسنل; assistant: ai, دستیار).

## 5. Out of scope
No new pages, no route changes, no redirects (no URL changes), no CSS files. Keep the diff small. When done print a one-paragraph summary and the test output.
