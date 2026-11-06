# Brief #470: items import gains unit cost and opening stock (FIFO layer)

Work only in this worktree: /home/mahan/Developer/roxira-wt/470-items-import-unit-cost-and-opening-stock (backend in output_apps/enterprise_hub). Do NOT commit, do NOT touch package.json, migrations, app.module.ts, e2e/ or docs. Synthetic data only.

## Decision (architect)
No cost column on erp_stock_items. Cost lives in FIFO layers (modules/inventory/entities/fifo-batch.entity.ts, unitPurchaseCost). The items import creates the item and, for quantity > 0, receives stock through `InventoryService.receiveStock(tenantId, dto, manager)` so the layer exists.
The item import must NOT post a journal entry (M1 step 05 opening balances posts 1301 itself). Do not inject any accounting service.

## Status
The production code is DONE (by Claude, already in the worktree): read the git diff in `modules/inventory/services/inventory.service.ts` (`importStockItemWithOpeningStock`), the repository (`transaction`, `createStockItem(..., manager)`) and `modules/data_import/registry/inventory-items.registry.ts`. DO NOT edit those three files. Your ONLY job is to write the two spec files below and run them. If a spec fails because production code looks wrong, report it in your final message instead of changing production code or weakening the spec.

## Specs (write them; compute expected values by hand, never adjust a spec to fit wrong code)
A. `modules/data_import/registry/inventory-items.registry.spec.ts` (jest, mocks only, no DB):
   - unitCost field exists and maps the header «بهای واحد (ریال)».
   - commit passes unitCost and quantity and batchNumber through to `importStockItemWithOpeningStock`; a row with cost but no quantity passes no quantity.
   - a rejected promise (BadRequestException) lands in `failed` with its message and the other rows still insert.
   - duplicateKeys unchanged (`sku:ITM-1`).
B. `modules/inventory/items-import-stock.pg.spec.ts` (real Postgres, copy the setup of `modules/inventory/opening-balance.pg.spec.ts`: own database, runMigrations, same service wiring; skipped unless ROXIRA_TEST_PG_HOST). Use the registry too: build `new InventoryItemsRegistry(inventory)` and call `commit` with NormalisedRecords. Tenant T. Tests:
   1. Rows: ITM-1 qty 88 cost 14,900,000 batch LOT-1; ITM-2 qty 86 cost 8,900,000 (no batch); ITM-3 cost 5,000,000 no quantity. After commit: 3 inserted, 0 failed. `inventory_fifo_batches`: 2 rows (ITM-3 has none); ITM-1 batch_number LOT-1, ITM-2 batch_number `OPEN-ITM-2`; item quantities 88, 86, 0; `inventory.getFifoValuation(T).totalInventoryValue` === 88*14,900,000 + 86*8,900,000 = 1,311,200,000 + 765,400,000 = 2,076,600,000.
   2. No journal entry: count of rows in the journal entries table (look up the real table name from the accounting entity, e.g. `grep -rn "@Entity" modules/accounting/entities`) is 0 before and after the import, in the same test as the value assertion.
   3. Idempotent: run the same commit again through `findExistingDuplicateKeys` + commit as the import service does (the service filters existing SKUs, `entity-import.service.ts` filterDuplicates): the duplicate keys for the 3 SKUs are all reported existing, so a second import inserts nothing; and calling commit directly again with the same records returns 3 failed (Conflict) and the layer count and the valuation are unchanged.
   4. Row failures: quantity 5 with no unitCost -> failed; quantity 1.234 -> failed; unitCost 12.5 -> failed; unitCost -1 -> failed (service-level). Nothing was created for those SKUs (item row absent: the transaction rolled back).
   5. Warehouse: with an active warehouse "W1" created first, the layer's warehouse_id is its id; with a second tenant T2 that has no warehouse, warehouse_id is null.
   6. Atomicity: force a failure inside the transaction (e.g. a batchNumber of 101 chars is truncated by nothing; instead use a jest spy making `receiveStock` throw) and prove the item row was not left behind.

## Run (through the lock, one at a time, only these specs)
cd output_apps/enterprise_hub
/home/mahan/Developer/roxira-wt/_fleet/heavy.sh npx jest --maxWorkers=2 modules/data_import/registry/inventory-items.registry.spec.ts modules/data_import/registry/entity-registry.service.spec.ts
ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55433 ROXIRA_TEST_PG_USER=postgres /home/mahan/Developer/roxira-wt/_fleet/heavy.sh npx jest --runInBand modules/inventory/items-import-stock.pg.spec.ts
Also `npx tsc --noEmit -p tsconfig.json` through heavy.sh if it is quick. Report what failed honestly.
