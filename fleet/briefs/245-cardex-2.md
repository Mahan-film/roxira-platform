Issue #245 continued. output_apps/enterprise_hub/modules/inventory/reports/cardex.ts already exists in the worktree; read it and keep it unless a test proves it wrong. Add:
1. modules/inventory/reports/cardex.spec.ts with an in-memory fixture: opening balance, two receipts at different unit costs, an issue crossing a FIFO layer, a transfer that nets to zero across all warehouses, exact closing value with bigint.
2. If cardex.ts has no ReportTable builder, add one with Persian labels for the existing PDF and XLSX writers (see modules/accounting/reports/report-tables.ts) and a spec for it.
3. Update the matching row in docs/strategy/REQUIREMENTS_STATUS.md with file paths and test names.
Create no helper scripts. Do not commit or push. Do not touch package.json, lockfiles, migrations or .github.
