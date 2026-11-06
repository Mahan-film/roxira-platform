# Brief: stock balance as of a date + reorder alerts (core only, issue #246)

Worktree: /home/mahan/Developer/roxira-wt/246-report-stock-balance-as-of-a-date-and-re (app dir: output_apps/enterprise_hub).
DO NOT commit, push, or run git commands that change state. Do not run npm/jest (the caller runs tests). Do NOT touch any other file than the three listed below.

Create exactly these files in `output_apps/enterprise_hub/modules/inventory/reports/`:
- `stock-balance.ts`
- `stock-balance.spec.ts`
Read `cardex.ts` (same folder) and `../../accounting/reports/report-table.ts` first. REUSE `cardex()`, `CardexMovement`, from `./cardex`; do not copy FIFO logic. No decimals, all bigint. ISO dates `YYYY-MM-DD`, compared as strings. Persian labels. No new route, no DB.

## stock-balance.ts exports
```ts
export interface BalanceMovement extends CardexMovement { itemId: string; warehouseId: string }
export interface BalanceItem { id: string; code: string; name: string; reorderPoint: bigint | null }  // null or 0n = not set
export interface BalanceWarehouse { id: string; name: string }
export interface BalanceLine { itemId: string; warehouseId: string; quantity: bigint; value: bigint; shortageQty: bigint }
export interface ItemBalance { itemId: string; quantity: bigint; value: bigint; shortageQty: bigint }
export interface ReorderAlert { itemId: string; quantity: bigint; reorderPoint: bigint; shortfall: bigint }
export interface StockBalanceReport { asOf: string; lines: BalanceLine[]; items: ItemBalance[]; alerts: ReorderAlert[] }
export function stockBalance(asOf: string, items: readonly BalanceItem[], movements: readonly BalanceMovement[]): StockBalanceReport
export function stockBalanceTable(report, items, warehouses, jalali: (day: string) => string): ReportTable
export function reorderAlertTable(report, items, jalali): ReportTable
```
Behaviour of `stockBalance`:
- Ignore movements with `date > asOf` and movements whose itemId is not in `items`.
- For each item, group its remaining movements by warehouseId and run `cardex(group, [])` (default options, so transfer legs stay on their warehouse). A line = closingQty, closingValue, shortageQty of that cardex. Keep a line only if quantity !== 0n or shortageQty !== 0n.
- `items` of the report: one entry for EVERY input item (even with no movements: 0n/0n/0n), quantity/value/shortage = sums over its lines. Report items and lines sorted by item code, lines then by warehouseId.
- Shortage is reported in shortageQty; value never negative (cardex already clamps).
- `alerts`: only items whose reorderPoint is non-null and > 0n and whose total quantity <= reorderPoint (at or below). shortfall = reorderPoint - quantity. Sorted by item code. Items without reorder point are never in alerts.
Do not mutate inputs.

Tables (ReportTable from accounting/reports/report-table, cells `string | bigint | null`, money columns have `money: true`, money in minor units):
- `stockBalanceTable`: title 'موجودی کالا در تاریخ', subtitle `تا تاریخ ${jalali(asOf)}` plus, if any line has shortageQty > 0n, `، خروجی بیش از موجودی؛ گردش کالا ناقص است`. Columns: 'کد کالا', 'نام کالا' (width 1.6), 'انبار' (1.2), 'مقدار', 'ارزش (ریال)' (money). One row per line: [code, name, warehouse name, String(quantity), value]. Last row bold: ['', 'جمع ارزش', '', null, totalValue] (total = sum of item values).
- `reorderAlertTable`: title 'کالاهای زیر نقطه سفارش', subtitle `تا تاریخ ${jalali(asOf)}`. Columns 'کد کالا', 'نام کالا' (1.6), 'موجودی', 'نقطه سفارش', 'کمبود'. None money. One row per alert, all strings.

## stock-balance.spec.ts (hand-computed, assert exactly these)
Use StockMovementType.INBOUND/OUTBOUND from '../enums/stock-movement-type.enum'. Helper builds a BalanceMovement.
Items: A1 'کالای الف' reorder 500n id 'A'; B1 reorder null id 'B'; C1 reorder 20n id 'C' (no movements); D1 reorder null id 'D'; E1 reorder 100n id 'E'. Warehouses W1 'انبار مرکزی', W2 'انبار فروشگاه'.
Movements:
- A, W1: 2026-01-01 IN 1000 @80; 2026-01-02 IN 500 @120; 2026-01-03 OUT 1200
- A transfer 2026-01-04: W1 OUT 300 (transfer:true); W2 IN 300 @80 (transfer:true)
- A, W1: 2026-02-01 OUT 900   (after the first as-of date)
- B, W1: 2026-01-01 IN 10 @50
- D, W1: 2026-01-01 IN 5 @10; 2026-01-02 OUT 8
- E, W1: 2026-01-01 IN 100 @7
Test 1, asOf '2026-01-31' (the 02-01 movement excluded): lines for A: W1 qty 1000n value 100000n (500@80 + 500@120); W2 qty 300n value 24000n. A item total 1300n / 124000n (equals the 1300/124000 before the transfer: transfer keeps total value). B 10n/500n. C 0n/0n and has NO lines. D: no line value but shortage: quantity 0n, value 0n, shortageQty 3n (line kept). E 100n/700n. Alerts exactly [C: qty 0n, point 20n, shortfall 20n; E: qty 100n, point 100n, shortfall 0n] in that order; B and D are NOT in alerts although low (no reorder point); A is not (1300 > 500).
Test 2, asOf '2026-02-01': A W1 qty 100n value 12000n (the 900 issue takes 500@80 = 40000 and 400@120 = 48000, leaving 100@120); W2 300n/24000n; A total 400n / 36000n; alerts now: A (qty 400n, point 500n, shortfall 100n), C, E in code order A1, C1, E1.
Test 3: inputs not mutated (movements array order unchanged after call), and unknown itemId movement ignored.
Test 4 stockBalanceTable (asOf '2026-01-31', jalali = d => `j:${d}`): title/subtitle 'تا تاریخ j:2026-01-31' contains no shortage warning when only A,B,C,E... BUT with D included the warning IS present: assert subtitle contains 'ناقص'. Money column title 'ارزش (ریال)' is the only money column. First row cells ['A1','کالای الف','انبار مرکزی','1000',100000n]. Last row bold with total value 100000n+24000n+500n+0n+700n = 125200n.
Test 5 reorderAlertTable: rows [['C1', name, '0','20','20'], ['E1', name, '100','100','0']].
