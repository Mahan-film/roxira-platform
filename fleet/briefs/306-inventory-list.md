# Brief #306: inventory list columns, low-stock chip, import rename (frontend only)
Work dir: output_apps/enterprise_hub/frontend/src (relative to the worktree). DO NOT commit. DO NOT run next build, tsc, npm install. DO NOT edit package.json or components/app/app-shell.tsx. Do not edit any backend file. Do not invent API fields (there is NO unit field on StockItem: do not add a unit column). Persian UI text, English code.

## 1. New file lib/stock-status.ts (pure, import types with `import type`, relative imports end in .ts like lib/reorder.ts)
- `export type StockStatus = "empty" | "low" | "ok";`
- `export function stockStatus(item: { quantity: number; isLowStock: boolean }): StockStatus` : quantity <= 0 -> "empty"; else isLowStock -> "low"; else "ok". (Same order as the old table badge.)
- `export const STOCK_STATUS_LABEL: Record<StockStatus,string> = { empty: "بدون موجودی", low: "زیر نقطهٔ سفارش", ok: "کافی" }`
- `export function stockTotals(items: readonly {quantity:number; isLowStock:boolean; fifoValuation:number}[]): { lowCount:number; emptyCount:number; value:number }` counting by stockStatus; value = sum of fifoValuation.
New file lib/stock-status.test.ts using node:test + node:assert/strict (copy style of lib/reorder.test.ts): cases: qty 0 & low=true -> "empty"; qty -1 -> "empty"; qty 3 low -> "low"; qty 3 not low -> "ok"; labels; stockTotals([{3,true,100},{0,true,0},{5,false,250}]) = {lowCount:1, emptyCount:1, value:350}; empty array -> zeros.

## 2. components/inventory/stock-items-table.tsx
- Columns in this order: کد کالا (sku), نام کالا (name; the barcode goes below the name in a small muted `dir="ltr"` line, only if non-empty; remove the separate barcode column), موجودی, حداقل موجودی (keep MinQuantityEditor), ارزش (formatRial(item.fifoValuation); header text «ارزش (FIFO)»), وضعیت, and a last narrow column with `RowActionsMenu` (components/ui/row-actions-menu.tsx, see app/app/crm/page.tsx for use) label `عملیات کالا ${item.name}`, one action «کارت کالا» that calls onSelectItem(item.sku). Update skeleton cell count and colSpan to 7 (still 7 columns).
- Status chip uses stockStatus + STOCK_STATUS_LABEL: empty -> Badge variant outline with PackageSearch icon-free text; low -> Badge variant destructive with the TriangleAlert icon; ok -> Badge secondary. Text is always present (colour is never the only signal).
- Quantity cell: when status is "low" use `font-bold text-rose-700 dark:text-rose-300` (not rose-600). All numeric cells get `tabular-nums`. Use logical classes only (text-start, ms-/me-, ps-/pe-); no left/right/ml/mr.
- Keep table wrapper `overflow-x-auto`; give the table `min-w-[40rem]`. Heading text «کالاها و موجودی».
- Keep existing props and behaviour (row click selects, refresh button).

## 3. app/app/inventory/page.tsx
- PageHeader title «کالاها و موجودی». Filter button labels: "all" «همه», "low" «زیر نقطهٔ سفارش», "empty" «بدون موجودی» (unchanged). Add `aria-pressed={filter === key}` to the filter buttons. EmptyImportState hint: «فایل اکسل کالا یا موجودی انبار را در صفحهٔ ورود از اکسل بارگذاری کنید».

## 4. Rename «ورود داده» -> «ورود از اکسل» (user-visible page name only)
- app/app/import/page.tsx: PageHeader title «ورود از اکسل».
- components/app/command-palette.tsx: labelFa «ورود از اکسل» (labelEn «Import from Excel»).
- components/app/drop-overlay.tsx text: «برای ورود خودکار به صفحهٔ ورود از اکسل منتقل می‌شوید».
- app/app/hr/page.tsx hint, components/accounting/bank/bank-reconciliation.tsx text: replace «صفحه ورود داده» / «صفحهٔ ورود داده» with «صفحهٔ ورود از اکسل».
- components/app/import-wizard.tsx: only the two aria-labels «نوع ورود داده» and «مراحل ورود داده» -> «نوع داده ورودی» and «مراحل ورود از اکسل». Leave «ورود داده انجام شد/نشد» messages alone.
- Do NOT touch app-shell.tsx, app/page.tsx, app/app/page.tsx, app/app/crm/page.tsx, lib/api/*, types/*, mcp, migrations.

When done, print `git status --short` and nothing else needed.
