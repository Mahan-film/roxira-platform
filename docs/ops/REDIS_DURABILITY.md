# Redis / Valkey Durability & Queue/Cache Segregation (T217 / #931)

**Status:** Implemented  
**Date:** 2026-11-21  
**Scope:** `redis_prod` (`docker-compose.prod.yml`), BullMQ queues (`enterprise_hub`), ephemeral caches (`auth`, `public_api`, `smartjudge`, `ecosystem_core`), memory budgeting (`MEMORY_BUDGET.md`).

---

## 1. Executive Summary & Problem Statement

Prior to T217:
1. Redis (`redis_prod`) ran with default settings: AOF persistence disabled (`appendonly no`), no memory limit (`maxmemory 0`), and `maxmemory-policy noeviction`.
2. Both durable queues (BullMQ background jobs for accounting, reporting, data imports) and ephemeral volatile caches (Auth OTPs, rate-limiter counters, legal AI semantic caches) resided in logical database 0 without separation.
3. Unclean host restarts or container crashes risked silent loss of queued background jobs. Furthermore, under host memory pressure, an unbounded cache could trigger kernel OOM kills.

**T217 Solution:**
- **AOF Persistence for Queues:** Enables Append-Only File with `appendfsync everysec`, giving an RPO $\le$ 1s on power loss and zero job loss on clean restarts.
- **Queue vs. Cache Separation:**
  - **Database 0 (`REDIS_QUEUE_DB=0`):** BullMQ job queues and background streams. Zero eviction (`noeviction`).
  - **Database 1 (`REDIS_CACHE_DB=1`):** Ephemeral tokens, OTPs, rate limits, and LLM query caches. Keys enforce mandatory TTLs. Supports optional independent cache instance (`REDIS_CACHE_HOST` / `REDIS_CACHE_PORT`).
- **Memory Ceiling:** Enforces `maxmemory 200mb` within the `256m` container cgroup limit (`oom_score_adj: -500`), safeguarding host memory while providing 30x headroom over baseline usage (~7 MB).

---

## 2. Architectural Blueprint

```
+-----------------------------------------------------------------------------------+
| Host Container: roxira_redis_prod (Port 6379, mem_limit 256m, maxmemory 200mb)   |
|                                                                                   |
|  +---------------------------------------+  +-----------------------------------+ |
|  | Logical DB 0: Durable Queues          |  | Logical DB 1: Ephemeral Cache     | |
|  | - BullMQ (Enterprise Hub jobs)        |  | - Auth OTPs & login challenges    | |
|  | - Factory synthesis streams           |  | - Public API rate limit tokens    | |
|  | - Keys stored without eviction        |  | - Smart Judge LLM / embed cache   | |
|  | - Persistent across server restarts   |  | - Mandatory TTL on every key      | |
|  +---------------------------------------+  +-----------------------------------+ |
|                                                                                   |
|  Engine Persistence Engine:                                                      |
|    - appendonly yes                                                               |
|    - appendfsync everysec                                                         |
|    - no-appendfsync-on-rewrite yes                                                |
|    - auto-aof-rewrite-percentage 100                                              |
|    - auto-aof-rewrite-min-size 64mb                                               |
|    - maxmemory 200mb                                                              |
|    - maxmemory-policy noeviction (queues protected from silent drop)              |
+-----------------------------------------------------------------------------------+
```

---

## 3. Configuration Specification

### 3.1 Docker Compose (`docker-compose.prod.yml`)

The `redis_prod` service includes:

```yaml
  redis_prod:
    image: redis:7-alpine@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf
    container_name: roxira_redis_prod
    command: >
      redis-server
      --appendonly yes
      --appendfsync everysec
      --no-appendfsync-on-rewrite yes
      --auto-aof-rewrite-percentage 100
      --auto-aof-rewrite-min-size 64mb
      --maxmemory 200mb
      --maxmemory-policy noeviction
    restart: always
    mem_limit: 256m
    mem_reservation: 128m
    oom_score_adj: -500  # T205: protect queue/session state
    security_opt:
      - no-new-privileges:true
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli ping | grep -q PONG"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
```

### 3.2 Application Environment Variables

| Variable | Default | Purpose | Target DB |
|---|---|---|---|
| `REDIS_HOST` | `127.0.0.1` | Primary Redis host | - |
| `REDIS_PORT` | `6379` | Primary Redis port | - |
| `REDIS_QUEUE_DB` | `0` | BullMQ queues & worker stream DB | DB 0 |
| `REDIS_QUEUE_HOST`| `${REDIS_HOST}` | Dedicated queue host (if separate cluster) | DB 0 |
| `REDIS_QUEUE_PORT`| `${REDIS_PORT}` | Dedicated queue port | DB 0 |
| `REDIS_CACHE_DB` | `1` | Ephemeral cache & auth token DB | DB 1 |
| `REDIS_CACHE_HOST`| `${REDIS_HOST}` | Dedicated cache host (if separate cluster) | DB 1 |
| `REDIS_CACHE_PORT`| `${REDIS_PORT}` | Dedicated cache port | DB 1 |

---

## 4. Eviction & Durability Guarantees

1. **Why `noeviction` for the Shared Instance:**
   - In Redis and Valkey, `maxmemory-policy` applies globally across all logical databases (`DB 0`..`DB 15`).
   - If `allkeys-lru` was applied globally, Redis under high load could evict un-expired BullMQ queue metadata (`bull:*:id`, `bull:*:waiting`), permanently corrupting active job state.
   - Therefore, `maxmemory-policy noeviction` is enforced. Memory safety is maintained by:
     1. Strict TTLs on all Cache DB keys (DB 1).
     2. Hard 200 MB memory cap (well above steady-state 7-20 MB).
     3. Optional split to an isolated cache container if cache load grows beyond 100 MB.

2. **Dedicated Cache Instance (Dual-Container Mode):**
   - For deployments where cache throughput is massive, deploy a secondary container `redis_cache` configured with:
     ```bash
     redis-server --appendonly no --maxmemory 128mb --maxmemory-policy allkeys-lru
     ```
   - Point applications using `REDIS_CACHE_HOST=redis_cache` and `REDIS_CACHE_PORT=6380`.

---

## 5. Operations & Verification Runbook

### 5.1 Verification Commands

Run against the running container or host:

```bash
# 1. Verify AOF persistence is active and syncing every second
redis-cli info persistence | grep -E "aof_enabled|aof_current_size|aof_last_write_status"
# Expected:
# aof_enabled:1
# aof_last_write_status:ok

# 2. Verify memory budget and eviction policy
redis-cli config get maxmemory
# Expected: 209715200 (200mb)

redis-cli config get maxmemory-policy
# Expected: noeviction

# 3. Verify database segregation
redis-cli info keyspace
# Expected:
# db0:keys=...,expires=0,...  (Queue DB: persistent jobs)
# db1:keys=...,expires=...,... (Cache DB: expiring keys)
```

### 5.2 Zero-Downtime Live Activation (Without Container Restart)

To enable AOF and memory bounds immediately on production without dropping existing connections:

```bash
# Connect to container
docker exec -it roxira_redis_prod redis-cli

# Apply AOF live
CONFIG SET appendonly yes
CONFIG SET appendfsync everysec
CONFIG SET no-appendfsync-on-rewrite yes
CONFIG SET auto-aof-rewrite-percentage 100
CONFIG SET auto-aof-rewrite-min-size 67108864

# Apply Memory bounds live
CONFIG SET maxmemory 209715200
CONFIG SET maxmemory-policy noeviction

# Persist configuration to disk
CONFIG REWRITE
```

### 5.3 Rollback Plan

If AOF disk I/O degrades host performance:
```bash
CONFIG SET appendonly no
CONFIG REWRITE
```
In `docker-compose.prod.yml`, revert `command:` to previous state or remove `--appendonly yes`.
