# Brief #496: API routes for the sales report (#243) and the fixed-asset register (#250)

Worktree: your cwd. Backend app: `output_apps/enterprise_hub`. DO NOT commit, push, or run git stash. Do not touch
`package.json`, lockfiles, `app.module.ts`, `modules/access/permission-matrix.snapshot.json` (I regenerate that myself),
migrations, `modules/posting_rules`, `modules/treasury`, cheques. Money is integer minor units (bigint) through
`modules/accounting/money.ts`; no decimal arithmetic. Persian labels are already in the pure cores.
Tests: do NOT run jest, tsc or any heavy command; I run them. Only write the code and specs.

Pure cores that already exist and must NOT be changed in behaviour:
- `modules/invoicing/reports/sales-report.ts`: `salesReport(docs, 'item'|'customer')`, `salesReportTable(groups, groupBy, subtitle)`.
- `modules/accounting/assets/asset-register.ts`: `assetRegister(rows)`, `assetRegisterTable(result, jalali)`,
  `depreciationSchedule(asset)`, `depreciationScheduleTable(schedule, jalali)`.

Read first (small): `modules/accounting/controllers/reports.controller.ts`, `modules/accounting/services/report-export.service.ts`,
`modules/accounting/controllers/fixed-asset.controller.ts`, `modules/accounting/repositories/fixed-asset.repository.ts`,
`modules/accounting/services/fixed-asset.service.ts` (`list`), `modules/invoicing/repositories/invoicing.repository.ts`,
`modules/invoicing/invoicing.module.ts`, `modules/accounting/accounting.module.ts`, `modules/accounting/reports/report-tables.ts` (`jalali`, `periodText`).

## Policy (decided by the owner)
Every new route is a plain GET under the owning module's class-level `@ModuleAccess(...)` with NO `@RequireAction`, so the policy is
`<module>:read` and the `read_only` role may call it. The file download is the same route with `?format=xlsx|pdf`
(default: JSON). Do not use EXPORT.

## 1. Shared renderer (module: accounting, owner of the writers)
In `ReportExportService` add a public method
`render(table: ReportTable, format: 'xlsx' | 'pdf' | undefined, filename: string): Promise<ExportedReport>` that uses the existing
`writePdf` / `writeXlsx` and the same content types as `export()` (reuse it from `export()` so there is one code path).
Add `ReportExportService` to the `exports` of `AccountingModule`. `AccountingModule` must NOT import `InvoicingModule`
(no cycle: InvoicingModule already imports AccountingModule).
Add a small helper that turns the render result into a response (set `Content-Type`, `Content-Disposition: attachment; filename="..."`,
`new StreamableFile(body)`) next to the service only if both controllers need it; otherwise inline as `reports.controller.ts` does.

## 2. Fixed-asset register (module: AccountingModule, class `FixedAssetController`, tenant from `requireTenantId`)
Add to `FixedAssetController` (keep existing routes untouched; the new `register` route must be declared before any `:param` route):
- `GET enterprise-hub/accounting/fixed-assets/register?format=` -> `assetRegister(rows)` where rows are
  `FixedAssetRepository.list(tenantId)` entities (already RLS-scoped, ordered by code) mapped to `FixedAssetRow`.
  JSON: `moneyJson(result)` (from `financial-reports.service`). xlsx/pdf: `exporter.render(assetRegisterTable(result, jalali), format, 'fixed-asset-register')`.
- `GET enterprise-hub/accounting/fixed-assets/:code/schedule?format=` -> `depreciationSchedule(row)`; unknown code for the tenant
  -> `NotFoundException('دارایی یافت نشد.')`. Same JSON/file handling with `depreciationScheduleTable`, filename `depreciation-schedule-<code>`.
  Add `findByCode` use via a scoped read (the repository's `scoped` + existing `findByCode`).
Put the logic in `FixedAssetService` (new methods `register(tenantId)` and `schedule(tenantId, code)` returning the core results);
the controller only handles format. Query DTO `FixedAssetReportQueryDto { format?: 'xlsx'|'pdf' }` in `dto/fixed-asset.dto.ts`
(`@IsOptional() @IsIn(['xlsx','pdf'])`).

## 3. Sales report (module: InvoicingModule, new files)
- `modules/invoicing/dto/sales-report.dto.ts`: `SalesReportQueryDto { groupBy: 'item'|'customer' (required, @IsIn); from?: YYYY-MM-DD; to?: YYYY-MM-DD; format?: 'xlsx'|'pdf' }`
  (dates are Gregorian Tehran days, inclusive, regex `^\d{4}-\d{2}-\d{2}$`, same as `ReportPeriodDto`; if both given, `from <= to` else BadRequest).
- Repository: `InvoicingRepository.findSalesBetween(tenantId, from?: Date, to?: Date): Promise<InvoiceEntity[]>`: query builder,
  `invoice.tenantId = :tenantId`, `direction = 'SALE'`, `status IN (ISSUED, PAID)`, and `issuedAt >= :from` (Tehran midnight of `from`,
  i.e. `new Date(`${from}T00:00:00+03:30`)`) and `issuedAt < :to` (Tehran midnight of the day AFTER `to`), each only when given. Order by `issuedAt` ASC, id ASC.
  Corrective/return chains are resolved by the core over the fetched set (documented assumption: the period is by issue date).
- Service `modules/invoicing/services/sales-report.service.ts` (`@Injectable`): `report(tenantId, query)` -> `{ groupBy, from, to, groups: SalesGroup[] }`
  using `salesReport`; `table(...)` -> `salesReportTable(groups, groupBy, subtitle)` with subtitle built from `periodText`-like Jalali text
  when from/to are given (reuse `jalali` from `accounting/reports/report-tables`; plain text `مبالغ به ریال` when no period).
  JSON output: groups with `key`, `quantity` (string, the same text as the table's quantity column: export a small `quantityText` from sales-report.ts if needed;
  do not change its behaviour), `net`, `vat` as `moneyJson` values, and `foreign`: `[{currency, net}]` sorted by currency.
- Controller `modules/invoicing/controllers/sales-report.controller.ts`: `@ApiTags('Invoicing - گزارش فروش')`, `@ModuleAccess(AccessModule.INVOICING)`,
  `@Controller('enterprise-hub/invoicing/reports/sales')`, one `@Get()`; injects `SalesReportService` and the exported `ReportExportService`.
  filename `sales-by-<groupBy>`.
- Register controller + service in `invoicing.module.ts` (`controllers`, `providers`). Module file only, not app.module.

## Specs (you write; I run them)
A. Unit specs (jest, no DB) for the new service methods are optional; the required specs are the two pg specs below. Follow
`modules/accounting/fixed-assets.pg.spec.ts` (own database per run, runMigrations, a non-superuser APP_ROLE so FORCE RLS applies, skipped unless `ROXIRA_TEST_PG_HOST`) for setup.

B. `modules/accounting/fixed-asset-register.pg.spec.ts` ("Fixed-asset register on PostgreSQL"). Two tenants T1, T2 (uuids as in that spec).
Insert through `FixedAssetService.create` or direct inserts as that spec does. T1 assets (category FURNITURE, acquisitionDate 2026-04-10):
  - FA-1: cost 1200.00, salvage 0, STRAIGHT_LINE lifeMonths 12, accumulated depreciation 0.00 (not yet depreciated).
  - FA-2: cost 1000.00, DECLINING_BALANCE annualRate 0.24, accumulated 20.00 (set by direct UPDATE on the row, monthsDepreciated 1, nextPeriodIndex as in asset-register.spec.ts).
  T2 has one asset FA-1 with cost 99999.00 (same code, different tenant).
Expected, hand computed: for T1 `register` rows are exactly [FA-1: cost 1200.00, accumulated 0.00, book 1200.00], [FA-2: cost 1000.00, accumulated 20.00, book 980.00],
totals cost 2200.00, accumulated 20.00, book 2180.00; no T2 row appears; the same request for T2 returns only its own FA-1 with cost 99999.00. `schedule('FA-1')` for T1 has
12 rows of 100.00 each, closing accumulated 1200.00, closing book value 0.00 (assert the first row, last row and sum); `schedule('FA-1')` must use T1's cost, never T2's;
an unknown code throws NotFoundException; asking T1 for a code that exists only in T2 throws NotFoundException.
Also render XLSX and PDF through `ReportExportService.render` for the register table and assert the XLSX starts with `PK` and the PDF starts with `%PDF`.

C. `modules/invoicing/sales-report.pg.spec.ts` ("Sales report on PostgreSQL"), style of `modules/invoicing/pos-sale.pg.spec.ts` for DB setup
(invoices have no FORCE RLS: they are isolated by the `tenant_id` filter, so also assert that). Insert InvoiceEntity rows directly. All IRR, VAT 10 percent,
`issuedAt` set explicitly. Look at `invoice.entity.ts` for the required columns and at `sales-report.spec.ts` for how item lines are shaped
(a line of qty 2 at unit price 1000 with tax 200 has total 2200 and counts as net 2000 rials = 200000 minor; quantity text from `quantity` strings/numbers as the entity stores them).
T1 invoices:
  1. ISSUED sale ORIGINAL, issuedAt 2026-05-01T08:00:00+03:30, buyer "شرکت الف", items: SKU-A qty 2 price 1000 tax 200; SKU-B qty 1 price 500 tax 50.
  2. PAID sale ORIGINAL, issuedAt 2026-05-02T08:00:00+03:30, buyer "شرکت ب", items: SKU-A qty 1 price 1000 tax 100.
  3. ISSUED RETURN (subject RETURN, relatedInvoiceId = invoice 2), issuedAt 2026-05-03T08:00:00+03:30, buyer "شرکت ب", items: SKU-A qty 1 price 1000 tax 100.
  4. DRAFT sale (must not count), SKU-A qty 7.
  5. ISSUED sale ORIGINAL issuedAt 2026-06-20T08:00:00+03:30, buyer "شرکت الف", SKU-A qty 1 price 1000 tax 100 (outside the May range used below).
T2 has one ISSUED sale in May for "شرکت الف" with SKU-A qty 100 price 1000 tax 10000 (must never appear in T1).
Expected for T1 with from=2026-05-01 to=2026-05-31, groupBy=item (rials; JSON money values via moneyJson, so 2000 rials is the number 2000):
  - SKU-A: quantity 2 (2 + 1 - 1), net 2000 (2000 + 1000 - 1000), vat 200 (200 + 100 - 100).
  - SKU-B: quantity 1, net 500, vat 50.
  groupBy=customer: "شرکت الف" net 2500 vat 250; "شرکت ب" net 0 vat 0 (sale minus return; the group still exists).
  Same T1 without from/to: SKU-A quantity 3, net 3000, vat 300 (invoice 5 included), SKU-B unchanged.
  T2 same query: only SKU-A quantity 100, net 100000, vat 10000. A range that contains no invoices returns an empty list.
Render xlsx and pdf of the table through `ReportExportService.render` (magic bytes `PK` / `%PDF`).
Instantiate services by hand as the other pg specs do (no Nest app); the controller-level policy is covered by the permission-matrix snapshot, not here.
Keep any existing spec green; do not edit specs of other modules.

When done print a 5-line summary of files changed. Do not claim tests pass: you cannot run them.
