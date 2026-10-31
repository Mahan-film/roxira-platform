# Backend database role

Production `enterprise_admin` is superuser with BYPASSRLS, so the FORCE RLS from #918 does nothing and
tenant isolation rests on repository filters alone. This runbook moves the NestJS backend to `roxira_app`,
which has neither right. Python services, backups, `agent_db.sh` and migrations stay on `enterprise_admin`.

| Role | Used by | Rights |
| --- | --- | --- |
| `enterprise_admin` | migrations, backups, Python services | owner, superuser |
| `roxira_app` | NestJS backend through PgBouncer | SELECT, INSERT, UPDATE, DELETE on tables, sequences; read-only on `migrations`; SELECT and INSERT on `audit_log`; no DDL |

The switch is what makes the existing RLS on `audit_log`, `tenant_branches`, `tenant_departments` and
`tenant_roles` real. It adds no RLS to other tables (see the audit below).

## Before you start

- This PR must be deployed: `grep -c 'APP_DB_PASSWORD:-' docker-compose.prod.yml` on the server prints 1.
  The compose defaults keep the owner role until `.env` holds `APP_DB_USER` and `APP_DB_PASSWORD`, so deploying it changes nothing.
- `switch` and `rollback` recreate the backend container, so expect under a minute of API downtime.

## Steps

Run as root on the server. Stop at the first failure.

```bash
cd /opt/roxira_platform
```

1. Look at the current state. Read-only.

```bash
bash scripts/ops/db_app_role.sh audit
```

2. Dry run. Applies the role and grants in a transaction, then rolls back.

```bash
bash scripts/ops/db_app_role.sh plan
```

3. Create the role. The backend is untouched. The password is generated into `/etc/roxira/app_db.env` (mode 600) and is never printed. Safe to rerun; it also refreshes the grants.

```bash
bash scripts/ops/db_app_role.sh apply --yes
```

4. Check the role through PgBouncer. Read-only. Every line must say `ok`.

```bash
bash scripts/ops/db_app_role.sh verify
```

5. Switch. Reruns `verify`, saves `.env` as `.env.before-app-role.<time>` (mode 600), adds the two variables and recreates the backend. If the backend is not healthy within 120 seconds or runs as the wrong role, it undoes all of this and reports failure.

```bash
bash scripts/ops/db_app_role.sh switch --yes
```

6. Confirm on the live system: log in on the site, open `/app`, list branches or the audit log in an organisation, and submit a test inquiry. Then check that no permission errors appear:

```bash
docker logs --since 10m roxira_enterprise_backend 2>&1 | grep -ciE 'permission denied|row-level security|must be owner'
```

The count must be 0. Then confirm that the backend no longer holds the owner password; this prints an empty value:

```bash
docker exec roxira_enterprise_backend sh -c 'echo "owner=[$POSTGRES_PASSWORD]"'
```

## Roll back

At any time, including days later:

```bash
cd /opt/roxira_platform && bash scripts/ops/db_app_role.sh rollback --yes
```

This removes the two lines from `.env` and recreates the backend on `enterprise_admin`. The role stays in the database, unused and harmless.
No schema changes, so no database restore is involved.

## After the switch

- `scripts/ops/deploy_local.sh migrate` takes the owner credentials from the Postgres container, no longer from the backend.
- New tables get grants through `ALTER DEFAULT PRIVILEGES` for `enterprise_admin`. A table created by another role does not: `verify` reports it, and `apply --yes` fixes it.
- PgBouncer keeps a pool per user. `max_connections` on the server is 100 while `default_pool_size` is 200, which predates this work. Idle owner connections age out after the switch; watch for `too many connections` during the first hour.

## RLS audit, production 2026-10-31

RLS with FORCE and policies: `audit_log`, `tenant_branches`, `tenant_departments`, `tenant_roles`. These are the only tables whose repositories go through `TenantScope`, so no new policy was added: a tenant policy on any other table would hide every row from the restricted role.

32 tables have `tenant_id` and no RLS. Their isolation is still repository filters only:
`auth_refresh_tokens`, `contact_messages`, `crm_activities`, `crm_leads`, `damage_calculations`, `data_import_batch_items`, `data_import_batches`, `enterprise_inquiries`, `erp_stock_items`, `erp_warehouses`, `fin_balance_reconciliation_log`, `fin_bank_accounts`, `fin_bank_statement_lines`, `fin_chart_of_accounts`, `fin_journal_entries`, `fin_journal_entry_lines`, `fin_period_locks`, `hr_employees`, `hr_employment_contracts`, `hr_payroll_runs`, `hr_payslips`, `inventory_fifo_batches`, `invoices`, `moadian_credentials`, `moadian_submissions`, `tax_invoice_signatures`, `tax_signing_keys`, `tenant_invitations`, `tenant_memberships`, `tenant_module_entitlements`, `tenant_module_requests`, `users`.

20 tables have no `tenant_id` and no RLS. `legal_*`, `graph_*` and `migrations` hold no tenant data. The rest are per-user or Python-owned: `accounting_accounts`, `auth_passkey_credentials`, `chat_conversations`, `chat_messages`, `crypto_unmatched_tx`, `email_accounts`, `fin_invoices`, `journal_entries`, `payment_orders`, `support_tickets`, `system_users`, `tenants`, `user_entitlements`, `user_retrial_requests`, `user_totp`.

Move a table to RLS only after its repository runs in `TenantScope` and these paths are handled, because each runs with no tenant set and would see nothing:

- Auth lookups before a tenant is known: `users`, `auth_refresh_tokens`, `tenant_memberships` by user, `tenant_invitations` by token hash.
- BullMQ processors with no request context: `damages-queue`, `package-import`, `suite-events`, `moadian`. They need the tenant in the job payload.
- Operator views across tenants: inquiries list, entitlements, module requests.
- Python services and sweeps stay unaffected only while they use the owner role.

## Tested

- `output_apps/enterprise_hub/test/migrations/run-app-role-e2e.sh`: private Postgres 15, all migrations as owner, then `plan`, `apply` twice, `verify`, a later table reaching the role, and all e2e suites as `roxira_app`.
- `output_apps/enterprise_hub/test/migrations/run-app-role-pgbouncer.sh`: Postgres 17 and the pinned production PgBouncer image in Docker with a small stand-in schema, covering SCRAM login, tenant setting per transaction, `switch`, `rollback`, and the automatic rollback.

Not tested: the real backend image behind PgBouncer, and production itself.
