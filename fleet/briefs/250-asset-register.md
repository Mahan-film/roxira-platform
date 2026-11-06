Issue #250: fixed-asset register and depreciation schedule (row R-18 in docs/accounting/research/MUST_HAVE_REPORTS.md). Backend core only, no controller route in this PR: a route needs the permission snapshot hotspot and comes later.

Read first, under output_apps/enterprise_hub/modules/accounting: assets/depreciation.ts and depreciation.spec.ts, entities/fixed-asset.entity.ts, money.ts, reports/report-table.ts.

Create modules/accounting/assets/asset-register.ts:
1. assetRegister(assets) takes rows of FixedAssetEntity fields as stored (decimal strings) and returns one row per asset: code, name, category, acquisitionDate, method, status, costMinor, accumulatedMinor, bookValueMinor, plus totals. All amounts are bigint via toMinor from ../money. bookValueMinor = costMinor - accumulatedMinor. Never use Number arithmetic on amounts.
2. depreciationSchedule(asset) returns the month-by-month plan, using the functions already in depreciation.ts. Do not write a second depreciation formula. If depreciation.ts lacks a function you need, stop and say which one rather than inventing it. The closing book value must equal the salvage value when the asset is fully depreciated.
3. assetRegisterTable(result) and depreciationScheduleTable(schedule, jalali): ReportTable builders with Persian labels, money: true on amount columns, a bold total row. Dates are passed through a `jalali: (day: string) => string` parameter, as modules/accounting/reports/legal-books.ts does.

Create modules/accounting/assets/asset-register.spec.ts covering: straight-line asset, declining-balance asset, a DISPOSED asset still listed with its status, exact totals, schedule closing value, table columns and total row.

Acceptance: from output_apps/enterprise_hub run: npx jest --maxWorkers=2 modules/accounting/assets
Do not edit REQUIREMENTS_STATUS.md. Do not touch package.json, lockfiles, migrations, app.module.ts or .github. Create only these two files. Do not commit or push. Only say tests ran if you saw them pass.
