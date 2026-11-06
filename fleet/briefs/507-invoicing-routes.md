# Task: purchases and gross-profit report routes (invoicing module). No commits.
Work dir: output_apps/enterprise_hub/modules/invoicing. Public repo, synthetic data only.
Follow merged commit ae94b902 (PR #498) EXACTLY: run `git show ae94b902 -- output_apps/enterprise_hub/modules/invoicing` and copy its shape file by file
(sales-report.controller.ts, sales-report.service.ts, dto/sales-report.dto.ts, invoicing.module.ts registration, repository query, sales-report.pg.spec.ts).
Report cores already exist, do NOT change them: reports/purchases-report.ts (purchasesReport, purchasesReportTable, PurchaseGroupBy 'item'|'supplier'),
reports/gross-profit-report.ts (grossProfitReport, grossProfitTable, marginText, ProfitGroupBy 'invoice'|'item'|'customer').

Build:
1. repository: generalise `findSalesBetween` into `findDocsBetween(tenantId, direction: InvoiceDirection, from?, to?)` (same query, same ISSUED+PAID filter, same ordering);
   keep `findSalesBetween` as a one-line wrapper so the sales service and its spec stay unchanged.
2. dto/purchases-report.dto.ts `PurchasesReportQueryDto` (groupBy 'item'|'supplier', from, to, format) and dto/gross-profit-report.dto.ts `GrossProfitReportQueryDto` (groupBy 'invoice'|'item'|'customer', from, to, format). Same decorators as SalesReportQueryDto.
3. services/purchases-report.service.ts `PurchasesReportService.build` and services/gross-profit-report.service.ts `GrossProfitReportService.build`, same signature/return `{json, table}` and same from>to BadRequest as SalesReportService.
   Purchases JSON: groupBy, from, to, groups[{key, quantity (quantityText), net, vat, foreign[{currency,net}]}] via moneyJson, exactly like sales.
   Gross-profit JSON: groupBy, from, to, groups[{key, revenue, cogs, profit, marginBp (string or null; use marginText for a `margin` field too)}] via moneyJson (bigint values are rial minor units, moneyJson converts them as it does for sales). Table via grossProfitTable.
   Gross profit reads SALE documents with `postingMeta` and `taxInvoiceNumber`; InvoiceEntity from findDocsBetween has them.
   Note for gross profit: with a `from`/`to` range a corrective chain may be cut by the range; that is accepted, document it in a one-line comment.
4. controllers/purchases-report.controller.ts at `enterprise-hub/invoicing/reports/purchases` and controllers/gross-profit-report.controller.ts at `enterprise-hub/invoicing/reports/gross-profit`, each a copy of SalesReportController (ModuleAccess INVOICING, single @Get(), filename `purchases-by-${groupBy}` / `gross-profit-by-${groupBy}`, Persian ApiOperation summary).
5. register the two controllers and two services in invoicing.module.ts.
6. pg specs `purchases-report.pg.spec.ts` and `gross-profit-report.pg.spec.ts` modelled on sales-report.pg.spec.ts (tenant isolation: tenant A rows are returned, tenant B's rows never appear for the same query; plus a date-range case and an xlsx download case if the sales spec has one).
   Hand-computed numbers: use 2 or 3 invoices per tenant with simple integers, and write the expected rial figures as literals you computed yourself in a comment, never by calling the function under test.
   For gross profit, give each sale invoice `postingMeta.lines` with `{sku, quantity, moved:'OUT', value:<rial>, unitCost}` like gross-profit-report.spec.ts fixtures do; expected cogs = sum of values, profit = revenue - cogs, margin = profit*10000/revenue rounded half up in basis points.
Do NOT touch: any file under accounting/, access/, permission-matrix.snapshot.json, package.json, other modules, existing cores/specs. Do not commit.
Verify yourself with: `cd output_apps/enterprise_hub && npx tsc --noEmit -p tsconfig.json 2>&1 | head` is NOT allowed (too heavy); just keep types consistent by reading. The coordinator runs tsc and jest.
