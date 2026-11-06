# Brief #527 (T1 slice 2): reservation as derived open quantity, available stock, reorder list on available. Do NOT run git commit/push. No new migration, no new table.

Context: slice 1 added `modules/sales` (read `sales.module.ts`, `repositories/sales.repository.ts`, `entities/sales-order.entity.ts`). Tables `erp_sales_orders` / `erp_sales_order_lines` have FORCE RLS: they only return rows inside `TenantScope` (see `modules/access/services/tenant-scope.ts`). `erp_stock_items` and the InventoryRepository do NOT use TenantScope, so NEVER join/subquery the sales tables from InventoryRepository SQL (it would silently see zero rows under the app role). Compute reservations in the sales module through TenantScope, then pass plain numbers into inventory.

## Definitions (decided by the owner)
- Reserved quantity of an item = SUM(quantity - delivered_quantity) over lines of orders with status 'CONFIRMED' for that tenant and that item_id (item_id = erp_stock_items.id). DRAFT and CANCELLED orders reserve nothing. Reservation never changes on-hand.
- Available = on-hand (`erp_stock_items.quantity`) - reserved. It can be negative (shows as backorder).
- Item-level only (all warehouses summed); no per-warehouse reservation in this slice.
- Quantities are numeric(12,2); do the maths in hundredths bigint (parseScaled / scaledToDecimal from `modules/accounting/money`, scale 2) or in SQL numeric. No float subtraction for the stored/compared value.

## Build
1. `modules/sales/repositories/sales.repository.ts`: add `reservedByItem(tenantId, itemIds?: number[]): Promise<Map<number, string>>` (run via `this.within(tenantId, undefined, ...)`; one SQL: join lines to orders on order_id and tenant_id, WHERE tenant_id = $1 AND o.status='CONFIRMED' AND l.quantity > l.delivered_quantity [AND l.item_id = ANY($2) when given] GROUP BY item_id; returns SUM as numeric text).
2. New `modules/sales/services/sales-availability.service.ts` `SalesAvailabilityService` with: `reservedMap(tenantId, itemIds?)`: Map<number,string>; `availability(tenantId, itemIds: number[])`: array of `{ itemId, sku, name, onHand, reserved, available }` (numbers with 2 decimals; onHand from `erp_stock_items` read inside the same scoped transaction by raw query on tenant_id and id = ANY; items that do not exist are omitted). Export it from SalesModule.
3. Route in `controllers/sales.controller.ts`: `GET enterprise-hub/sales/availability?itemIds=1,2,3` (comma list, max 200, ints only, 400 otherwise), same decorators as the other GETs (INVOICING + AlsoAllow ACCOUNTING). Add DTO in `dto/sales.dto.ts`. Regenerate the matrix: `UPDATE_PERMISSION_MATRIX=1 npx jest modules/access/permission-matrix.spec.ts --maxWorkers=2` (only added rows may change in `modules/access/permission-matrix.snapshot.json`).
4. Inventory: `modules/inventory/inventory.module.ts` imports `SalesModule` (it imports nothing from inventory, so there is no cycle). In `services/inventory.service.ts` the constructor gets a SECOND parameter `@Optional() private readonly reservations?: SalesAvailabilityService` (existing specs construct with one argument and must keep passing unchanged). Behaviour:
   - `isLowStock(quantity, minQuantity)` stays as the rule but is now called with AVAILABLE quantity (on-hand minus reserved) in `toStockItemResponse` and in the valuation rows (around line 640). When `reservations` is undefined, reserved = 0.
   - `StockItemResponseDto` and the valuation row DTO get two new fields: `reservedQuantity` and `availableQuantity` (numbers, 2 decimals); `quantity` stays on-hand and unchanged.
   - `listStockItems` (the paged list with `lowStockOnly`): fetch `reservedMap(tenantId)` first and pass `reserved: Array<{ itemId: number; quantity: string }>` into `InventoryRepository.findStockItemsAndCount` options. There replace `REORDER_STOCK_SQL` by an expression that subtracts reserved: `(item.quantity - COALESCE((SELECT x.q FROM unnest(CAST(:rIds AS int[]), CAST(:rQtys AS numeric[])) AS x(id, q) WHERE x.id = item.id), 0))` with parameters rIds / rQtys (empty arrays when nothing is reserved). Update the comment on the constant (it now says available stock) and fix the stale comment on `isLowStock` in the service.
   - `lowStockCount` and the page data use available too.
   - The as-of-date stock balance report (`reports/stock-balance.ts`) is historical and stays on-hand; do not touch it.

## Tests (write them; I verify numbers by hand)
`modules/sales/availability.pg.spec.ts` modelled on `modules/inventory/reorder-point.pg.spec.ts` (its way of building InventoryService/InventoryRepository) and `modules/sales/sales.pg.spec.ts` (non-superuser role, migrations, SalesRepository/TenantScope). Use this fixture exactly, tenant A:
- Item A: on-hand 10, min_quantity 6. Item B: on-hand 20, min_quantity 5. Item C: on-hand 3, min_quantity 0 (no reorder rule).
- Customer party + a warehouse. Orders for tenant A inserted through the sales service or owner INSERTs:
  - O1 CONFIRMED: A qty 3, B qty 4. Then owner UPDATE sets delivered_quantity of O1's A line to 1 (open 2).
  - O2 CONFIRMED: A qty 2.5.
  - O3 DRAFT: A qty 100. O4 CANCELLED: A qty 50.
- Tenant B has its own item and a CONFIRMED order for it; it must not change tenant A's numbers.
Expected for tenant A: A reserved 4.5, available 5.5, on-hand still 10. B reserved 4, available 16. C reserved 0, available 3.
- `availability(A, [A,B,C ids])` returns exactly those numbers.
- `listStockItems(A, { lowStockOnly: true })` returns only item A (available 5.5 <= 6; on-hand 10 would NOT have flagged it) and `lowStockCount` is 1; without lowStockOnly, A's `isLowStock` is true, `quantity` 10, `reservedQuantity` 4.5, `availableQuantity` 5.5; B isLowStock false.
- Cancel O2 (service cancelOrder): A reserved becomes 2, available 8, no longer low.
- Delivered-all line (set delivered = quantity on O1's B line) reserves 0 for B.
- Run InventoryService WITHOUT the reservations argument: lowStockOnly then follows on-hand (A 10 > 6 -> none).
- The HTTP route is covered by the permission-matrix snapshot; also unit-test the itemIds parser (pure function in the DTO file or controller) in `modules/sales/sales-availability.dto.spec.ts`: '1,2,3' -> [1,2,3]; '1,x' -> 400; '' -> 400; 201 ids -> 400.
Update the T1 row in `docs/strategy/REQUIREMENTS_STATUS.md` (append reservation evidence: file paths and test names). Existing specs that must still pass: `modules/inventory/reorder-point.pg.spec.ts`, `modules/inventory/inventory.tenant.spec.ts`, `modules/sales/sales.pg.spec.ts`.
Run only: `npx jest --maxWorkers=2 modules/sales/sales-availability.dto.spec.ts modules/inventory/inventory.tenant.spec.ts` and with ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55433 ROXIRA_TEST_PG_USER=postgres `npx jest --runInBand modules/sales modules/inventory/reorder-point.pg.spec.ts`. If an expected number disagrees with the code, fix the code, never the number.
