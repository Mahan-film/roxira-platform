# Brief #509 (T1 slice 1): quotations and sales orders. Do NOT run git commit/push. Do not touch other modules except the one line below.

Model it on `output_apps/enterprise_hub/modules/parties/` (entity, repository via TenantScope, service, controller, module, pg spec) and migration `migrations/1789540000000-CreateParties.ts` (uses `enableTenantRls` from `migrations/data/tenant-rls.ts`). Read those first. For document numbering copy how `modules/inventory/repositories/stock-documents.repository.ts` generates `docNumber` (prefix + per-tenant sequence, unique index on tenant+number).

## New module: `output_apps/enterprise_hub/modules/sales/`
Files: `sales.module.ts`, `entities/sales-quotation.entity.ts` (quotation + line classes), `entities/sales-order.entity.ts` (order + line), `enums/sales-status.enum.ts`, `sales-math.ts` (pure), `dto/sales.dto.ts`, `repositories/sales.repository.ts`, `services/sales.service.ts`, `controllers/sales.controller.ts`, specs below.
Register: add `SalesModule` to the imports of `app.module.ts` (ONE import line plus one array entry; nothing else in that file). SalesModule imports `PartiesModule` (to check the customer: `PartiesService.getByCode`, party role must be customer or both, active) and uses TenantScope like parties.

## Migration: `migrations/1789600000000-CreateSalesQuotationsOrders.ts` (class `CreateSalesQuotationsOrders1789600000000`)
Four tables, all with `tenant_id uuid NOT NULL`, `enableTenantRls(q, table)` (FORCE RLS) for each, down() disables and drops in reverse order:
- `erp_sales_quotations`: id SERIAL PK, tenant_id, number varchar(40), party_code varchar(64), quote_date date, valid_until date NULL, status varchar(12) CHECK in (DRAFT,SENT,ACCEPTED,REJECTED,CONVERTED) default DRAFT, note varchar(512) NULL, total_amount numeric(18,2) NOT NULL default 0, created_by varchar(64) NULL, created_at, updated_at. Unique (tenant_id, number). Index (tenant_id, party_code, status).
- `erp_sales_quotation_lines`: id, tenant_id, quotation_id int NOT NULL REFERENCES erp_sales_quotations(id) ON DELETE CASCADE, line_no int, item_id int NOT NULL, description varchar(255) NULL, quantity numeric(12,2) CHECK >0, unit_price numeric(18,2) CHECK >=0, discount numeric(18,2) default 0 CHECK >=0, line_total numeric(18,2). Unique (quotation_id,line_no). Index (tenant_id, quotation_id).
- `erp_sales_orders`: same shape as quotations plus `quotation_id int NULL REFERENCES erp_sales_quotations(id)`, `warehouse_id int NOT NULL`, `order_date date`, `promised_date date NULL`, status CHECK in (DRAFT,CONFIRMED,CANCELLED) default DRAFT, number prefix SO. No valid_until/quote_date.
- `erp_sales_order_lines`: like quotation lines (order_id FK cascade) plus `delivered_quantity numeric(12,2) NOT NULL default 0`, `invoiced_quantity numeric(12,2) NOT NULL default 0`, CHECK (delivered_quantity >= 0 AND delivered_quantity <= quantity), CHECK (invoiced_quantity >= 0 AND invoiced_quantity <= quantity).
Entities must match columns exactly; numeric columns are mapped as `string` (no float transformer). Quotation number prefix QT.

## Maths: `sales-math.ts` (pure, no Nest)
- `parseQuantityHundredths(v: number|string): bigint` : uses `parseScaled(v, 2)` from `../accounting/money`; more than 2 decimals or <=0 throws a BadRequest-style error (never rounds, see issue #500).
- `computeLine(qtyHundredths: bigint, unitPriceMinor: bigint, discountMinor: bigint): bigint` = round-half-up of `qtyHundredths * unitPriceMinor / 100n` minus discount; throws if discount > gross or result < 0.
- Order/quotation total = sum of line totals (bigint). No VAT on quotes or orders: VAT is posted by the invoice from the statutory store. Only `money.ts` (`toMinor`, `fromMinor`, `fromDb`, `sumMinor`) for money; no Number arithmetic on money or quantity.
DTO input: quantity as number|string (max 2 decimals), unitPrice and discount as money number|string through `toMinor`. Responses return money via `fromMinor` and quantity as a number with 2 decimals.

## Service rules
- create quotation (DRAFT, number QT-n, lines validated: item must exist for tenant in `erp_stock_items` (query inside the scoped manager), at least 1 line, max 200 lines).
- update (PUT) only while DRAFT: replaces all lines, recomputes total.
- `POST quotations/:id/status` body `{status}` allowed transitions: DRAFT->SENT, SENT->ACCEPTED, SENT->REJECTED, ACCEPTED->REJECTED. Anything else 409.
- `POST quotations/:id/convert` body `{warehouseId, orderDate, promisedDate?}`: quotation must be SENT or ACCEPTED (else 409); creates order DRAFT with same party and lines (copy prices), sets quotation_id, sets quotation CONVERTED, all in one transaction. A quotation converts once.
- orders: `POST orders` (direct, DRAFT, warehouse must exist), `GET orders` (filters partyCode, status, limit, offset; returns items+total), `GET orders/:id` (with lines), `POST orders/:id/confirm` DRAFT->CONFIRMED, `POST orders/:id/cancel` from DRAFT or CONFIRMED when every line delivered_quantity = 0, else 409. Orders are editable (PUT, replace lines) only in DRAFT.
- Same GETs for quotations (`GET quotations`, `GET quotations/:id`). Not found -> 404, wrong state -> 409, tenant only from `requireTenantId(request)`.
- Routes prefix `enterprise-hub/sales/...`. Use the same decorators as PartiesController; pick the AccessModule for invoicing/sales that already exists in `modules/access/catalogue` (grep it); reads also allowed to ACCOUNTING via AlsoAllowModule.
- After adding routes regenerate the matrix: from output_apps/enterprise_hub run `UPDATE_PERMISSION_MATRIX=1 npx jest modules/access/permission-matrix.spec.ts --maxWorkers=2` and keep only added rows in `modules/access/permission-matrix.snapshot.json`.

## Tests (write them; I will verify the numbers myself)
1. `modules/sales/sales-math.spec.ts` (jest, plain): 
 - `parseQuantityHundredths('2.5')` = 250n; `'1.125'` throws; `0` throws.
 - computeLine(250n, 4000000n, 0n) = 10000000n (2.5 x 40,000 rials = 100,000 rials); computeLine(300n, 1250000n, 150000n) = 3600000n (3 x 12,500 less 1,500 = 36,000 rials); computeLine(1n, 1n, 0n) = 0n (0.01 x 0.01 rounds half-up to 0) ; computeLine(50n, 1n, 0n) = 1n (0.5 minor rounds up); discount above gross throws.
2. `modules/sales/sales.pg.spec.ts` modelled on parties.pg.spec.ts (non-superuser role, runMigrations, opt-in on ROXIRA_TEST_PG_HOST). Seed a customer party via PartiesRepository and two stock items and a warehouse (raw INSERTs as owner are fine, look at stock-documents.pg.spec.ts for how). Assert:
 - all four tables have relforcerowsecurity = true and relrowsecurity = true (query pg_class).
 - tenant isolation: tenant A creates a quotation and an order; tenant B (service call with tenant B id) cannot list or get them (404), and a raw query as the app role with `app.tenant_id` = B returns 0 rows from each of the four tables, and with no tenant set returns 0 rows; an INSERT with a foreign tenant_id is rejected by RLS.
 - Quote total: lines (item1 qty 2.5 @ 40000), (item2 qty 3 @ 12500 discount 1500) give total_amount 136000 and line totals 100000 and 36000. Convert after SENT: order is DRAFT with total 136000, quotation is CONVERTED, second convert is 409, converting a DRAFT quotation is 409. Order confirm then cancel: cancelled; with delivered_quantity manually set to 1 via owner UPDATE, cancel is 409. Quantity 1.125 is rejected (400). Numbers are QT-1, QT-2 and SO-1 style per the copied numbering scheme (assert the prefixes).
 - CHECK: owner UPDATE setting delivered_quantity > quantity fails.
3. Update the matching row in `docs/strategy/REQUIREMENTS_STATUS.md` (grep for sales order / quotation / T1) adding file paths and the spec names. Do not touch other rows.

Run (via lock): `/home/mahan/Developer/roxira-wt/_fleet/heavy.sh npx tsc --noEmit -p tsconfig.json` is mine; you only run the two specs with `npx jest --maxWorkers=2 modules/sales/sales-math.spec.ts` and, with ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55433 ROXIRA_TEST_PG_USER=postgres, `npx jest --runInBand modules/sales/sales.pg.spec.ts`. If an expected number disagrees with the code, fix the code, never the number.
