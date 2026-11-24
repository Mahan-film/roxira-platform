# PostgreSQL & PgBouncer Sizing Specification and Maintenance Runbook (T214 / #928)

**Status:** Implemented  
**Date:** 2026-11-21  
**Scope:** `postgres_prod` & `pgbouncer_prod` in `docker-compose.prod.yml`, sizing per `docs/ops/MEMORY_BUDGET.md`.

---

## 1. Context & Architectural Root Cause

In production on `srv1` (4 vCPU, 7.7 GB total host RAM), the database layer is partitioned between `postgres_prod` (`mem_limit: 1024m`) and `pgbouncer_prod` (`mem_limit: 128m`).

### The Mismatch Problem Identified in `MEMORY_BUDGET.md`:
- Previously, PgBouncer was configured with `DEFAULT_POOL_SIZE=200` and `MAX_DB_CONNECTIONS=500`.
- However, PostgreSQL defaulted to `max_connections=100`.
- Under sudden traffic spikes, PgBouncer would attempt to open up to 500 server connections to PostgreSQL. Once PostgreSQL hit 100 connections, it immediately rejected new sessions with:
  ```
  FATAL: remaining connection slots are reserved for non-replication superuser connections
  ```
- Additionally, each active PostgreSQL backend process consumes approximately 5–10 MB of RAM. 100 concurrent active backends could demand 500–1,000 MB, threatening PostgreSQL's `mem_limit: 1024m` ceiling and risking container OOM recovery.

---

## 2. Quantitative Sizing Specification

### 2.1 PgBouncer (`pgbouncer_prod`)

| Parameter | Previous Value | New Value (T214) | Rationale |
|---|---|---|---|
| `POOL_MODE` | `transaction` | `transaction` | Transaction-level pooling multiplexes client connections over a compact physical server pool. |
| `DEFAULT_POOL_SIZE` | `200` | **`40`** | Sized for 1,500–2,500 active tenants (~150–300 RPS) per architecture benchmarks. |
| `MAX_DB_CONNECTIONS` | `500` | **`60`** | Hard ceiling on physical connections opened to PostgreSQL. Safely leaves 40 headroom slots on PostgreSQL for direct admin, migrations, backups, and monitoring. |
| `MAX_CLIENT_CONN` | `10000` | `10000` | Permits high volume of incoming client connections waiting on transaction boundaries. |
| `mem_limit` | `128m` | `128m` | Sufficient for holding 10,000 socket descriptors and buffer state. |
| `oom_score_adj` | `-500` | `-500` | Protects the database entry proxy against host OOM kills. |

### 2.2 PostgreSQL 17 (`postgres_prod`)

Applied via container startup flags under `mem_limit: 1024m` (`mem_reservation: 512m`):

| Setting | Default Value | New Value (T214) | Memory Impact |
|---|---|---|---|
| `shared_buffers` | `128MB` | **`256MB`** | 25% of container RAM ceiling. Caches frequent index pages and hot tables. |
| `effective_cache_size`| `4GB` (or image) | **`512MB`** | 50% of container RAM ceiling. Guides planner cost estimates for OS page cache. |
| `work_mem` | `4MB` | **`4MB`** | Bounded per sort/hash operation to prevent multi-clause queries from exhausting memory. |
| `maintenance_work_mem`| `64MB` | **`64MB`** | Accelerates VACUUM, CREATE INDEX, and DDL migrations without starving running services. |
| `max_connections` | `100` | **`100`** | Strict upper limit. Leaves a guaranteed 40-connection buffer above PgBouncer's 60 cap. |
| `oom_score_adj` | `-800` | `-800` | Highest OOM protection on the host (last container kernel will terminate). |

---

## 3. Maintenance Window & Restart Runbook

Because PostgreSQL memory parameters (`shared_buffers`, `max_connections`) require an instance restart, and container parameter updates (`command`, `environment`) require recreation, this runbook details the owner-approved deployment process.

### 3.1 Maintenance Window Characteristics
- **Recommended Window:** Low-traffic hours (e.g. 03:00 – 03:30 IRST).
- **Service Impact:** Short database connection pause. In transaction pool mode with backend retry logic (`ioredis` and TypeORM reconnection), total brief blip is **10 to 15 seconds**.

### 3.2 Pre-Flight Checklist
1. Verify no long-running schema migration or backup is actively running:
   ```bash
   docker exec -it roxira_postgres_prod psql -U enterprise_admin -d enterprise_db -c \
     "SELECT pid, now() - query_start AS duration, query FROM pg_stat_activity WHERE state != 'idle';"
   ```
2. Verify host free memory and disk space:
   ```bash
   free -m
   df -h /var/lib/docker
   ```

### 3.3 Execution Commands (Production Host)

```bash
cd /opt/roxira_platform

# 1. Pull / verify compose configuration
docker compose -f docker-compose.prod.yml config --quiet

# 2. Recreate postgres_prod and pgbouncer_prod with updated sizing
docker compose -f docker-compose.prod.yml up -d --no-deps postgres_prod pgbouncer_prod

# 3. Wait for healthchecks to become healthy
docker inspect -f '{{.Name}}: {{.State.Health.Status}}' roxira_postgres_prod roxira_pgbouncer
```

### 3.4 Post-Restart Verification

```bash
# Verify PostgreSQL active settings
docker exec -it roxira_postgres_prod psql -U enterprise_admin -d enterprise_db -c \
  "SHOW shared_buffers; SHOW effective_cache_size; SHOW work_mem; SHOW maintenance_work_mem; SHOW max_connections;"
# Expected:
#  shared_buffers        | 256MB
#  effective_cache_size  | 512MB
#  work_mem              | 4MB
#  maintenance_work_mem  | 64MB
#  max_connections       | 100

# Verify PgBouncer active configuration
docker exec -it roxira_pgbouncer psql -h 127.0.0.1 -p 6432 -U enterprise_admin -d pgbouncer -c \
  "SHOW CONFIG;" | grep -E "default_pool_size|max_db_connections"
# Expected:
#  default_pool_size     | 40
#  max_db_connections    | 60

# Verify backend connectivity through PgBouncer
docker exec -it roxira_enterprise_backend curl -s http://127.0.0.1:3000/api/health
```

### 3.5 Rollback Procedure

If unexpected connection queueing (`cl_waiting > 0`) occurs under anomalous load:
1. Increase pool size live on PgBouncer without restart:
   ```bash
   docker exec -it roxira_pgbouncer psql -h 127.0.0.1 -p 6432 -U enterprise_admin -d pgbouncer -c \
     "SET default_pool_size = 60; SET max_db_connections = 80;"
   ```
2. Or rollback `docker-compose.prod.yml` to previous commit and run:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --no-deps postgres_prod pgbouncer_prod
   ```
