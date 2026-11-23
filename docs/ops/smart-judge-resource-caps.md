# Smart Judge Resource Caps & ERP Guard Alert Runbook (T254 / #993)

## 1. Hard Container Caps (`docker-compose.prod.yml`)

To guarantee the ERP keeps its share of host RAM and CPU while co-located with Smart Judge:

| Service | `mem_limit` | `cpus` |
|---|---|---|
| `enterprise_app` (FastAPI AI Core) | `1200m` | `1.0` |
| `qdrant_prod` | `512m` | `0.5` |
| `roxira_embeddings` (TEI `bge-m3`) | `2800m` | `1.0` |
| **Total** | **`4512m` (<= 4.5 GB)** | **`2.5` (<= 2.5 vCPU)** |

**Rollback:** In `docker-compose.prod.yml`, remove `cpus:` on the three services and restore `roxira_embeddings` `mem_limit` to `3500m`, then recreate with `docker compose -f docker-compose.prod.yml up -d`.

## 2. ERP Guard Alert (`scripts/ops/monitor/erp_guard_alert.py`)

Fires a Telegram alert (`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`) when either trigger trips:
- ERP p95 latency rises **> 10%** above its 7-day baseline, OR
- Host RAM exceeds **7.0 GB** for **>= 15 consecutive minutes**.

**Action on alert:** This is the operational trigger to move Smart Judge (`enterprise_app`, `qdrant_prod`, `roxira_embeddings`) onto its own dedicated server.
