# RLS Cutover Runbook (Staging & Production Cutover)

> [!IMPORTANT]
> **No production change.** The coordinator schedules the cutover with the owner.
> This runbook defines the verified, deterministic procedure for enabling database-level Row-Level Security (RLS) by switching the NestJS Enterprise Hub from the superuser (`enterprise_admin`) to the restricted application role (`roxira_app`).

---

## 1. Context & Architecture

### 1.1 Why Switch Roles?
In PostgreSQL, roles with `rolsuper = true` or `rolbypassrls = true` completely bypass Row-Level Security policies. Production historically connected the NestJS backend as `enterprise_admin` (the database owner and superuser), meaning all `ENABLE + FORCE ROW LEVEL SECURITY` policies were skipped at the database engine level, leaving multi-tenant isolation dependent solely on application repository filters.

Switching the backend to `roxira_app` activates kernel-enforced multi-tenant isolation:
- Queries without an explicit tenant scope (`app.tenant_id` session setting) see **0 rows** on tenant tables.
- A tenant cannot read, insert, update, or delete another tenant's rows, even in the event of an application logic bug or raw SQL query injection.

### 1.2 Database Role Matrix

| Role | Used By | Privileges & Restrictions |
| :--- | :--- | :--- |
| `enterprise_admin` | Migrations, Python AI Core, backups, `agent_db.sh` | Owner, superuser (`rolsuper=true`, `rolbypassrls=true`). Full DDL & DML. |
| `roxira_app` | NestJS Enterprise Hub (`output_apps/enterprise_hub`) via PgBouncer | Restricted runtime role (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`).<br>• `SELECT, INSERT, UPDATE, DELETE` on application tables and sequences.<br>• Read-only (`SELECT`) on `migrations`.<br>• Append-only (`SELECT, INSERT`) on `audit_log` (no UPDATE/DELETE).<br>• **No DDL privileges** (`CREATE TABLE`, `ALTER TABLE`, `DROP`, `TRUNCATE` denied). |

---

## 2. Pre-Flight Verification & Read-Only Checks

Run all pre-checks from `/opt/roxira_platform` (or repository root) as root before switching. Stop immediately if any check fails.

### Step 2.1: Verify Docker Compose Environment Variables
Verify that `docker-compose.prod.yml` supports role decoupling:
```bash
grep -n -C 3 'APP_DB_PASSWORD:-' docker-compose.prod.yml
```
*Expected output*: Contains lines:
```yaml
- DATABASE_USER=${APP_DB_USER:-enterprise_admin}
- DATABASE_PASSWORD=${APP_DB_PASSWORD:-${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}}
```

### Step 2.2: Audit Current RLS Table Status
Inspect the current RLS status of all tables in the database:
```bash
bash scripts/ops/db_app_role.sh audit
```
*Verification criteria*:
- All pre-tenant tables (`users`, `auth_refresh_tokens`, `tenant_memberships`, `tenant_invitations`, `tenant_module_entitlements`, `tenant_module_requests`, `contact_messages`, `enterprise_inquiries`) report `rls | force`.
- Completed module tables (`audit_log`, `tenant_branches`, `tenant_departments`, `tenant_roles`, `invoices`, etc.) report `rls | force`.

### Step 2.3: Dry Run (Plan)
Validate role creation and permissions in an isolated transactional dry-run:
```bash
bash scripts/ops/db_app_role.sh plan
```
*Expected output*:
- Applies grants in a transaction and rolls back.
- Output ends with `dry run finished; nothing changed`.

---

## 3. Cutover Execution Procedure

### Step 3.1: Apply Restricted Role & Grants
Create the `roxira_app` role with a secure 32-byte secret stored in `/etc/roxira/app_db.env` (mode 600):
```bash
bash scripts/ops/db_app_role.sh apply --yes
```
*Notes*:
- This command does **not** restart the backend. The backend continues running on `enterprise_admin`.
- Idempotent: safe to run multiple times to refresh schema grants after new migrations.

### Step 3.2: Verify Role Through PgBouncer
Verify connectivity, privileges, and negative security constraints as `roxira_app`:
```bash
bash scripts/ops/db_app_role.sh verify
```
*Expected output*:
```text
  ok   connects as the role
  ok   not superuser, no BYPASSRLS
  ok   reads an ordinary table
  ok   RLS hides tenant_roles with no tenant set
  ok   RLS hides audit_log with no tenant set
  ok   cannot create tables
  ok   cannot alter tables
  ok   cannot truncate
  ok   cannot change audit_log
  ok   cannot delete audit_log
  ok   cannot write migrations
  ok   every table is readable
[app-role] verify passed
```
If any check fails, do **not** proceed to switch.

### Step 3.3: Perform Atomic Switch
Execute the cutover. This saves a timestamped backup of `.env` (`.env.before-app-role.<timestamp>`), appends `APP_DB_USER` and `APP_DB_PASSWORD`, and restarts the backend container:
```bash
bash scripts/ops/db_app_role.sh switch --yes
```
*Automated Guardrail*:
If the container does not become healthy within 120 seconds or runs as the wrong role, `db_app_role.sh` **automatically rolls back** to the owner role.

---

## 4. Post-Cutover Verification Queries

### 4.1 Confirm Connection User & Privileges
Query database user through the running application / psql:
```sql
SELECT current_user, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname = current_user;
```
*Expected output*: `roxira_app | f | f`.

### 4.2 Test Unscoped Tenant Isolation (RLS Proof)
Run an unscoped query as `roxira_app` without setting `app.tenant_id`:
```sql
SELECT count(*) FROM tenant_branches;
```
*Expected output*: `0` (rows are hidden by RLS).

### 4.3 Test Scoped Tenant Visibility
Run a scoped query in a transaction with a valid tenant UUID:
```sql
BEGIN;
SELECT set_config('app.tenant_id', '<TENANT_UUID>', true);
SELECT count(*) FROM tenant_branches;
COMMIT;
```
*Expected output*: Returns the actual branch count for that tenant.

### 4.4 Verify Superuser Credential Sanitization
Ensure the superuser password is no longer accessible inside the backend container:
```bash
docker exec roxira_enterprise_backend sh -c 'echo "owner=[$POSTGRES_PASSWORD]"'
```
*Expected output*: `owner=[]` (empty string).

### 4.5 Inspect Application Runtime Logs
Monitor logs for 10 minutes to verify zero RLS violations or permission errors:
```bash
docker logs --since 10m roxira_enterprise_backend 2>&1 | grep -ciE 'permission denied|row-level security|must be owner'
```
*Expected output*: `0`.

---

## 5. Rollback Procedure

The switch is completely reversible at any time without database restores or schema changes.

```bash
cd /opt/roxira_platform
bash scripts/ops/db_app_role.sh rollback --yes
```

*What Rollback Does*:
1. Removes `APP_DB_USER` and `APP_DB_PASSWORD` from `.env`.
2. Recreates the backend container (`roxira_enterprise_backend`).
3. Waits for container health check (up to 120 seconds).
4. Restores backend connection to `enterprise_admin`.
5. Expected downtime: < 30 seconds.
