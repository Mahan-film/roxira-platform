# Memory budget and OOM protection (T205)

Host: one 4 vCPU / 7.7 GB server (srv1). Measured read-only on 2026-11-17 with `docker stats --no-stream`,
`docker inspect` and `free -m` (host: 4.3 GB used, 3.4 GB available, page cache 2.5 GB). Re-read after the 09:00 reboot: 5.0 GB used (65%), 2.7 GB available; the table shows the higher of the two readings. The 70% bigger-server trigger is already close.
Nothing here is deployed until the owner runs `docker compose up -d` in a maintenance window (see "Deploy").

## What the live host looked like (2026-11-17)

The limits already written in `docker-compose.prod.yml` were **not applied** to five running containers:
`roxira_postgres_prod`, `roxira_redis_prod`, `roxira_pgbouncer`, `roxira_qdrant_prod`,
`roxira_docker_socket_proxy` all report `Memory=0` (unlimited) and `OomScoreAdj=0`. `roxira_keypool`,
`roxira_mail`, `roxira_umami` are unlimited too. So today Postgres has the same OOM score as everything else.

## Budget table

| Service (container) | Measured now / idle | Limit (`mem_limit`) | Reservation | oom_score_adj | Why |
|---|---|---|---|---|---|
| postgres_prod | 94 MB | 1024m (unchanged) | 512m | **-800** | Work memory per backend plus `shared_buffers`; killing it mid-commit forces crash recovery. Last to die. |
| pgbouncer_prod | 1.4 MB | 128m (unchanged) | 64m | **-500** | Tiny; losing it drops every DB connection. |
| redis_prod | 7 MB | 256m (unchanged) | 128m | **-500** | Queues/sessions; small dataset, 256m is 35x headroom. |
| qdrant_prod | 49-63 MB | 512m (unchanged) | 256m | 0 | Vectors grow with the law corpus; mmap'd, so RSS lags. |
| enterprise_app (Python) | 243 MB idle, 545 MB under use | 1200m (unchanged) | 600m | 0 | 2.2x the busy figure. One uvicorn process (`run_unified_server.py`), no extra workers to size. |
| roxira_embeddings (TEI bge-m3) | 33-41 MB idle (model is lazily paged in) | 3500m (unchanged) | 1024m | **+500** | Stateless, restarts alone, dies first. 1.6 GB after the reboot with the model loaded; 3500m is 2.2x. Could drop to 2560m after a full-batch peak is measured. |
| enterprise_backend (NestJS) | 121 MB | 900m (unchanged) | 450m | 0 | `NODE_OPTIONS=--max-old-space-size=640`: V8 collects hard at 640 MB instead of being OOM-killed at 900. |
| enterprise_frontend (Next.js) | 82 MB | 600m (unchanged) | 300m | 0 | `NODE_OPTIONS=--max-old-space-size=400`. |
| nginx_gateway | 14 MB | 128m (unchanged) | 64m | 0 | |
| docker_socket_proxy | 6 MB | 64m (unchanged) | 32m | 0 | |
| keypool (LiteLLM, `docker-compose.keypool.yml`) | 245 MB idle, 645 MB in use | **1024m (new)** | 400m | **+500** | 1.6x the in-use peak (it grows with traffic). Disposable gateway; the app falls back to OpenRouter when it is down. |
| keypool_db | 27 MB | 256m (unchanged) | 64m | 0 | |
| research, searxng, valkey (other compose, not touched) | 20 / 4 / 2 MB | 1024m / 768m / 128m | n/a | 0 | Already limited. |
| mail, umami (other compose, not touched) | 18 / 105 MB | none | n/a | 0 | Unlimited today: give them a limit in their own compose files (see follow-ups). |
| twenty_crm / twenty_db / twenty_redis (`docker-compose.modern-stack.yml`, not touched) | 736 / 36 / 9 MB | 2048m / 512m / 256m | n/a | 0 | Already limited. |
| *Planned:* JVM e-invoice sidecar | n/a | 768m (heap 512m + metaspace/thread overhead) | | +300 | `-Xmx512m -XX:MaxRAMPercentage` must stay under the container limit. |
| *Planned:* flagd | n/a | 96m | | 0 | |

Rule used: limit = 2-3x measured steady state, except where the workload grows with data (Postgres, Qdrant,
embeddings) and the limit is kept as already committed. `restart: always` / `unless-stopped` is set on every
service in both compose files already (re-checked); nothing was missing.

## Total of limits against host RAM

| Group | Sum of limits |
|---|---|
| `docker-compose.prod.yml` (10 services) | 8312 MB |
| key pool (1024 + 256) | 1280 MB |
| Twenty CRM stack (2048 + 512 + 256, `docker-compose.modern-stack.yml`) | 2816 MB |
| research stack (1024 + 768 + 128) | 1920 MB |
| planned JVM + flagd | 864 MB |
| **Total** | **14 592 MB = 189% of 7720 MB** |

Limits are ceilings, not allocations, so overcommit is normal; what matters is that the sum of *peaks* fits.
Measured after the 09:00 reboot: containers use about 4.4 GB RSS in total (embeddings 1.6 GB, Twenty CRM 0.74 GB,
keypool 0.65 GB, app 0.5 GB); host used 5.0 GB (65%), available 2.7 GB. The biggest overcommitters are embeddings
(3500m) and Twenty (2048m). Until the peak is measured the OOM scores make the outcome safe: if the host
runs out of RAM the kernel kills embeddings / keypool first and Postgres, PgBouncer and Redis last.

## Recommended Postgres and Redis settings (NOT applied)

Postgres has no memory flags in compose; live values are the image defaults (`shared_buffers=128MB`,
`work_mem=4MB`, `max_connections=100`). With `mem_limit: 1024m` recommended: `shared_buffers=256MB`,
`effective_cache_size=512MB`, `work_mem=4MB`, `maintenance_work_mem=64MB`, `max_connections=100`.
These need a Postgres restart and a reviewed change, so they are documented only.

**Found while doing this:** PgBouncer is set to `DEFAULT_POOL_SIZE=200` and `MAX_DB_CONNECTIONS=500`, but Postgres
`max_connections` is 100. Under real load PgBouncer would try to open more server connections than Postgres allows
(errors, not OOM), and 100 busy backends at ~10 MB each already approach the 1024m limit. Recommended:
`DEFAULT_POOL_SIZE=40`, `MAX_DB_CONNECTIONS=60`. Not changed here (connection behaviour, needs its own review).

Redis has no `maxmemory` (live: 0). Recommended `maxmemory 200mb` with `maxmemory-policy noeviction`
(BullMQ queues must not be evicted silently), under the 256m container limit.

## Alerts (`scripts/ops/monitor/synthetic_check.py`)

With `MONITOR_CHECK_DISK=1` (the existing server-only switch) the monitor now also checks, every 5 minutes,
`ram:host` (used > 85%, from `/proc/meminfo` `MemAvailable`, `MONITOR_RAM_WARN_PCT`) and `containers:restarts`
(any container with `RestartCount` > 0 that started, or was OOM-killed, in the last 60 minutes,
`MONITOR_RESTART_WINDOW_MIN`). They use the existing alert-on-change path into the digest/notify queue.
The monitor process needs access to the `docker` CLI for the restart check; if it has none, that check reports
"skipped" (OK) rather than a false alarm. Listed in `docs/ops/MONITORING.md`.

## When to buy a bigger server

Trigger: host RAM used (`ram:host`, MemAvailable basis) **above 70% sustained for 7 days**, or any
`containers:restarts` alert caused by OOM (`OOMKilled=true`) more than once in a week. Adding the JVM sidecar
and flagd adds about 0.6 GB of real use; re-measure after they ship. Next step up: 8 vCPU / 16 GB.

## Deploy (owner-approved maintenance window)

`cd /opt/roxira_platform && docker compose -f docker-compose.prod.yml up -d` recreates postgres_prod,
redis_prod, pgbouncer_prod, qdrant_prod, embeddings, backend and frontend (limits, oom_score_adj and
NODE_OPTIONS are container-create-time settings: a plain restart does not apply them). Postgres recreation is a
short outage; Redis and the key pool follow. Key pool: `scripts/infra/key_pool/install.sh --apply`.
Verify: `docker inspect -f '{{.Name}} {{.HostConfig.Memory}} {{.HostConfig.OomScoreAdj}}' $(docker ps -q)`.

## Not measured

- TEI embeddings peak RSS with the model loaded and a full batch (1.6 GB seen after reboot; full-batch peak unknown).
- Peak Python app memory during a long legal-chat burst (545 MB seen once).
- `mail` and `umami` limits (their compose files are not in this change).
