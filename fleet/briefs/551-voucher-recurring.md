# Task #551: recurring vouchers and auto-reversing accruals
Read modules/accounting/services/accounting.service.ts (createJournalEntry, reverseJournalEntry), modules/invoicing/processors/suite-events.processor.ts for the BullMQ pattern. @nestjs/schedule is not used in modules; do not add it.

## Data
Migration 1789900000100: erp_recurring_vouchers (id, tenant_id, name, description, lines jsonb, frequency MONTHLY|QUARTERLY|YEARLY, next_run_date date, end_date date null, auto_reverse boolean default false, active boolean, created_by, timestamps), erp_recurring_voucher_runs (id, tenant_id, recurring_id, run_date, journal_entry_id, reversal_entry_id null, reversal_date date null, UNIQUE(tenant_id, recurring_id, run_date)). Lines must balance on create and update: reject otherwise.

## Behaviour
New controller recurring-voucher.controller.ts: CRUD, POST recurring-vouchers/run-due (AccessAction.POST). New service runDue(tenantId, today):
- For each active template with next_run_date <= today, one run per due date, catching up missed periods, oldest first. Insert the run row first; the unique key makes a repeat run a no-op, so two runners never create a voucher twice.
- Regular template: create a DRAFT voucher for an accountant to post.
- auto_reverse template: create and POST the accrual on run_date, set reversal_date to the first day of the next month.
- Then reverse every run with reversal_date <= today and reversal_entry_id null, through reverseJournalEntry, dated reversal_date.
- A locked period or closed year: skip that one and report it in the result { created, reversed, skipped: [{id, date, reason}] }; do not advance next_run_date past it and do not abort the others.
- Advance by calendar month in the Jalali calendar using the repo Jalali helper, so a monthly template on 1 Farvardin next runs on 1 Ordibehesht.
Daily trigger: a BullMQ repeatable job in the same pattern as the reference processor, iterating tenants that have due templates.

## UI
Page frontend/src/app/app/accounting/recurring-vouchers/page.tsx with list, form, «اجرای موارد سررسیده» and the result. No nav edit (coordinator adds it).

## Tests
pg spec recurring-vouchers.pg.spec.ts: unbalanced rejected; three missed months make exactly three vouchers; running twice makes no more; accrual of 10,000,000 posted on 1404-12-20 is reversed on 1405-01-01 with debit and credit swapped and the account balance back to 0 after; locked period reported in skipped and retried later; other tenant sees nothing.
Requirements row: E-04. Help: docs/help/fa/18-recurring-vouchers.md.

## Rules for all work here
App root: output_apps/enterprise_hub. Do NOT commit or push. Do NOT edit package.json, lockfiles, frontend app-shell.tsx, app.module.ts, .github/, modules/posting_rules, modules/treasury. Add no dependency.
Code, comments and tests in English; every user-visible string in Persian. Dates shown Jalali. Money is bigint through modules/accounting/money.ts: never parseFloat or Number on money. No hardcoded account codes.
Every query is tenant-scoped; read modules/accounting/repositories/dimension.repository.ts and copy how it enters TenantScope. New tables: tenant_id, ENABLE and FORCE RLS with the same policy as the newest migration in modules/parties (erp_parties). App DB role is not superuser, so a repo without TenantScope sees nothing.
Controllers use DTO classes with class-validator and the same guards and @RequireAction style as controllers/accounting.controller.ts. Business logic in services, SQL in repositories.
Tests must assert computed values, not just that a call succeeded. Do not weaken a test to pass. Do not claim a test passes unless you ran it.
Update the docs/strategy/REQUIREMENTS_STATUS.md row named below with file evidence, and write the named Persian help page in docs/help/fa/.

