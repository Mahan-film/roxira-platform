# Brief #461: fractional quantities in inventory reports (do NOT commit, do NOT push)
Worktree: this one. Dir: output_apps/enterprise_hub/modules/inventory/reports/. Touch ONLY cardex.ts, stock-balance.ts, cardex.spec.ts, stock-balance.spec.ts, and constants/inventory.constants.ts (add one constant). No other file, no package.json, no migrations.

## Design (decided, implement exactly)
1. constants/inventory.constants.ts: QUANTITY_SCALE = 2 already exists. Add `export const QUANTITY_UNIT = 100n; // one whole unit in hundredths, 10n ** BigInt(QUANTITY_SCALE)`. Use it everywhere; no literal 100n.
2. All quantities in cardex.ts and stock-balance.ts (movement quantity, layer quantity, in/out/running/closing/shortage, reorderPoint, shortfall) are bigint HUNDREDTHS (1.5 kg = 150n). Unit cost stays minor units per whole unit.
3. In cardex.ts export `layerValue(quantity: bigint, unitCost: bigint): bigint` = round-half-up of quantity*unitCost/QUANTITY_UNIT (quantities and costs are non-negative: `(q*c + QUANTITY_UNIT/2n) / QUANTITY_UNIT`). This matches inventory.service.ts, which values every layer take with Math.round(qty*cost) (round half up).
4. FifoLayer gets an internal remaining value. Internal queue item: {quantity, unitCost, value} where value = layerValue(quantity, unitCost) when the layer is created (opening layers and inbound movements). Inbound adds `value` to runningValue.
5. Outbound take from a layer: if take === layer.quantity, takeValue = layer.value (the whole remainder, so no rounding remainder is lost); else takeValue = layerValue(take, layer.unitCost). Then layer.quantity -= take, layer.value -= takeValue, runningValue -= takeValue. Invariant: closingValue === sum of remaining layer values; add a comment saying this. openingValue = sum of layerValue of opening layers.
6. Same-day order: in cardex() the sort is by date, and for equal dates INBOUND before OUTBOUND (stable otherwise). Add a spec.
7. Formatting: export `formatQty(q: bigint): string` always two decimals, e.g. 150n -> "1.50", 1000n -> "10.00", 5n -> "0.05", 0n -> "0.00", negative not needed. Use it for every quantity cell in cardexTable, stockBalanceTable, reorderAlertTable and in the shortage subtitle. Cells stay `string | bigint | null`.
8. Null warehouse: BalanceMovement.warehouseId becomes `string | null` (inventory_fifo_batches.warehouse_id is nullable). A null warehouse is its own group in stockBalance (key it with a Map keyed by warehouseId, null allowed) and BalanceLine.warehouseId is `string | null`. In stockBalanceTable it prints the label constant `NO_WAREHOUSE_LABEL = 'بدون انبار'` (export it). Update the stale doc comment at the top of stock-balance.ts (remove "fractional stock is #461").

## Spec work
Existing specs use whole numbers: convert them by multiplying every quantity by 100 (use a local helper `const u = (n: number) => BigInt(n) * QUANTITY_UNIT` rather than editing digits where possible) and update expected quantity strings to two decimals ("10" -> "10.00"). Money expectations in existing tests do not change. Do not change an expected value to make a failing test pass: if a value differs, stop and tell me.

New cases in cardex.spec.ts (values computed by hand, they are the truth):
A) Rounding half up: opening none; inbound 1.50 @ 1001 on 2026-01-01 -> layerValue=1502 (1501.5 rounds up), runningValue 1502. Outbound 0.50 on 2026-01-02 -> take value 501 (500.5 up); runningQty 100n, runningValue 1001n. Outbound 1.00 on 2026-01-03 empties the layer: runningValue 0n, closingQty 0n, closingValue 0n (the last take uses the remainder 1001, not round(1001)). 
B) Two layers: inbound 1.50 @ 1001 (value 1502) then inbound 2.00 @ 2000 (value 4000), then outbound 2.00. Takes: layer A whole 1.50 = 1502, layer B 0.50 = 50*2000/100 = 1000. Out row total 2502. closingQty 150n (layer B has 1.50 left), closingValue 3000n (= 1502+4000-2502 = 4000-1000).
C) Same layer split three ways: inbound 3.33 @ 100 (value 333); outbound 1.11 -> 111; outbound 1.11 -> 111; outbound 1.11 (last, whole remainder) -> 111; closing 0/0. And a 0.01 @ 150 inbound: value 2 (1.5 rounds up).
D) Same-day order: an outbound and an inbound on the same date, outbound listed first in input: result has no shortage.
E) cardexTable: a row with 150n prints "1.50".
New in stock-balance.spec.ts: a fractional case (item inbound 2.50 @ 1001 in warehouse W1 -> value 2503 (2502.5 up); outbound 1.00 -> 1001 (round 1001.0); line qty 150n, value 1502; alert printing "1.50"), a null-warehouse movement producing a line printed with 'بدون انبار'.

## Run
From output_apps/enterprise_hub: `/home/mahan/Developer/roxira-wt/_fleet/heavy.sh npx jest --maxWorkers=2 modules/inventory/reports`. Nothing else heavy.
