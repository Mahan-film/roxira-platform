# Pilot Operations Runbook

Status: **Draft for pilot readiness** (support hours and contact details are left blank for the owners to fill before go-live).

## 1. Roles (No Personal Names)

| Role | Responsibility |
|---|---|
| **Incident Commander (IC)** | Owns incident triage, severity classification, external/customer communications approval, and post-incident review. |
| **Primary On-Call Operator** | First responder for health-check alerts, container restarts, rollback execution, and log inspection. |
| **Database / Backup Operator** | Executes database restore drills, verifies `pg_dump` / Qdrant snapshots, and oversees `restore.sh` during data recovery. |
| **Customer Support Lead** | Handles customer tickets, delivers approved incident notices, and tracks customer-facing follow-ups. |
| **Owner / Approver** | Grants explicit approval for production migrations, auth/payment changes, DNS cutovers, and destructive recovery actions. |

### Support Hours and Contacts (Owner to Fill)

| Item | Value |
|---|---|
| Business / Pilot Support Hours | `[TBD — owner to fill]` |
| On-Call Escalation Channel | `[TBD — owner to fill]` |
| Customer Support Email / Portal | `[TBD — owner to fill]` |
| Security / Privacy Contact | `[TBD — owner to fill]` |
| External Status Page URL | `[TBD — owner to fill]` (see [PUBLIC_STATUS_PAGE_DESIGN.md](./PUBLIC_STATUS_PAGE_DESIGN.md)) |

---

## 2. Pilot Acceptance Checklist

Verify every item before onboarding pilot customers:

1. **Application & Health Endpoints**
   - Enterprise Hub API (`/v1/health` / liveness & readiness) returns HTTP 200.
   - Next.js frontend renders `/`, `/login`, `/signup`, `/terms`, `/privacy`, `/app` without 5xx errors.
   - Smart Judge AI Core responds on health check and enforces tenant isolation.
2. **Authentication & Legal Acceptance**
   - Sign-up requires explicit acceptance of Terms of Service and Privacy Policy (`acceptTerms: true`) and records version + timestamp.
   - Rate limits and MFA/password policies are active.
3. **Database & Tenant Isolation**
   - All migrations applied cleanly (`migration:run` is a no-op).
   - Application connects as `roxira_app` (non-superuser, `NOBYPASSRLS`) with `FORCE RLS` active on tenant tables.
4. **Backups & Restore Drill**
   - Latest backup in `scripts/ops/backup/server_backup.sh` completed without errors.
   - A scratch restore drill via `scripts/ops/backup/restore.sh` has been verified (see `docs/ops/DISASTER_RECOVERY.md`).
5. **Monitoring & External Status Page**
   - Alerts route to the configured operator channel.
   - External static status page is reachable independently of the production host.

---

## 3. Severity & Escalation Matrix

| Severity | Definition | Target Ack | Escalation Path |
|---|---|---|---|
| **SEV-1 (Critical)** | Complete outage, data-loss risk, or cross-tenant/security breach. | 15 min | Primary On-Call -> Incident Commander -> Owner / Approver immediately. |
| **SEV-2 (High)** | Core workflow degraded (e.g. invoicing, auth, or AI core unavailable for a subset of tenants). | 30 min | Primary On-Call -> Incident Commander if unresolved after 30 min. |
| **SEV-3 (Medium)** | Non-critical feature degraded, workaround available. | 4 hours | Primary On-Call logs issue and schedules fix in next release window. |
| **SEV-4 (Low)** | Minor UI/copy issue or cosmetic defect. | Next business day | Customer Support Lead -> standard backlog triage. |

See also `docs/security/policies/INCIDENT_MANAGEMENT_POLICY.md` for security incident handling.

---

## 4. Rollback Steps

When a recent deploy introduces regressions or fails post-deploy smoke checks (see `docs/ops/AUTODEPLOY.md`):

1. **Identify the last known-good commit/image tag** from the deploy log or CI history.
2. **Application Rollback (no schema change)**:
   - Re-deploy the previous known-good image tag / git SHA via the standard deploy workflow or `docker compose -f docker-compose.prod.yml up -d --no-deps <service>`.
   - Verify health checks pass on all restarted containers.
3. **If a database migration ran**:
   - Do **not** blindly run `migration:revert` on production without Owner / Approver confirmation and a fresh pre-rollback `pg_dump`.
   - Prefer forward-fixing or restoring from the pre-deploy backup if data integrity is affected.
4. **Post-rollback verification**:
   - Confirm `/login`, `/app`, and core API endpoints return HTTP 200.
   - Update the external status page and incident log.

---

## 5. Restore Steps

Refer to `docs/ops/DISASTER_RECOVERY.md` for full backup architecture and secrets locations.

1. **Declare incident** (SEV-1 if production data is lost or corrupted) and notify Owner / Approver.
2. **Verify backup integrity** before overwriting any live state:
   - Check latest restic snapshot / staged dump set.
   - Run a scratch drill first using `scripts/ops/backup/restore.sh` (without `--full`) to confirm `pg_restore -l` and Qdrant snapshot readability.
3. **Full server recovery (if host is lost)**:
   - Provision a fresh Ubuntu/Debian host and run `scripts/infra/bootstrap_new_server.sh --restore` (which bootstraps the host and runs `restore.sh --full`).
4. **Post-restore checks**:
   - Verify row counts, tenant RLS role (`roxira_app`), Redis/Qdrant connectivity, and run smoke checks before re-enabling customer traffic.

---

## 6. Customer Incident Communication Template

```text
Subject: [Incident Notice] <Short Service Impact Summary> — <YYYY-MM-DD>

Current Status: <Investigating | Identified | Monitoring | Resolved>
Impact: <Which product area is affected and what users experience>
Start Time (UTC): <YYYY-MM-DD HH:MM UTC>

Summary:
We are currently <investigating / resolving> an issue affecting <service/feature>.
<Brief, factual description without internal hostnames, secrets, or unverified claims.>

Workaround (if any):
<None / Describe workaround>

Next Update:
We will provide the next update by <YYYY-MM-DD HH:MM UTC> or sooner if status changes,
and post updates on our status page: <External Status Page URL>.
```
