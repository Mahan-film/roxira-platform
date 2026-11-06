# Task #549: voucher copy and edit lock
Read modules/accounting/services/accounting.service.ts (updateVoucher, changeVoucherStatus, reverseJournalEntry) and controllers/accounting.controller.ts first.

## Copy
POST journal-entries/:id/copy with @RequireAction(AccessAction.CREATE), body { date?: calendar date } defaulting to today. New service voucher-tools.service.ts. Creates a DRAFT voucher in the same tenant with the same lines (account, debit, credit, description, dimensions) and description, and a new number by the normal route. It never posts, and never touches the source. Source in another tenant gives 404. Copying a reversal or POSTED voucher is allowed; the copy is DRAFT. A date in a locked period or closed fiscal year is refused by the existing check.

## Edit lock (optimistic)
Migration 1789900000000: add version integer NOT NULL DEFAULT 1 to the journal entries table. Return version in the response DTO. PUT journal-entries/:id and POST journal-entries/:id/status take required expectedVersion when called from the UI; absent means no check, so existing internal callers keep working. The UPDATE itself must be atomic: WHERE id AND tenant_id AND version = expected, incrementing version; zero rows gives 409 with Persian message «این سند را کاربر دیگری تغییر داده است؛ صفحه را تازه کنید». A read-then-write check is wrong.

## UI
In frontend/src/components/accounting/journal-entries-table.tsx add «کپی سند» to the row menu. In journal-entry-form.tsx send expectedVersion and show the 409 message.

## Tests
pg spec voucher-tools.pg.spec.ts: copy equals source line by line and is DRAFT, source unchanged, other tenant 404, locked period refused; two updates with the same expectedVersion: first succeeds, second 409, and version is 2.
Requirements row: N-04 (edit lock) and E-04 (copy). Help: docs/help/fa/17-voucher-copy-lock.md.

## Rules for all work here
App root: output_apps/enterprise_hub. Do NOT commit or push. Do NOT edit package.json, lockfiles, frontend app-shell.tsx, app.module.ts, .github/, modules/posting_rules, modules/treasury. Add no dependency.
Code, comments and tests in English; every user-visible string in Persian. Dates shown Jalali. Money is bigint through modules/accounting/money.ts: never parseFloat or Number on money. No hardcoded account codes.
Every query is tenant-scoped; read modules/accounting/repositories/dimension.repository.ts and copy how it enters TenantScope. New tables: tenant_id, ENABLE and FORCE RLS with the same policy as the newest migration in modules/parties (erp_parties). App DB role is not superuser, so a repo without TenantScope sees nothing.
Controllers use DTO classes with class-validator and the same guards and @RequireAction style as controllers/accounting.controller.ts. Business logic in services, SQL in repositories.
Tests must assert computed values, not just that a call succeeded. Do not weaken a test to pass. Do not claim a test passes unless you ran it.
Update the docs/strategy/REQUIREMENTS_STATUS.md row named below with file evidence, and write the named Persian help page in docs/help/fa/.

