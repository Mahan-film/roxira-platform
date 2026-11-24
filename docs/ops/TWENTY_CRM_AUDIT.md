# Twenty CRM Licence Audit & Status Decision

> **Task**: #1059 (T264 R26: Twenty CRM licence + status decision)  
> **Source**: `docs/strategy/research/R26_DIGEST.md` (2026-11-21), `docs/strategy/research/R26_GEMINI.md`  
> **Context**: Licence gate classification (#991, #999), state/system map contradiction resolution, and decommission roadmap.

---

## 1. Executive Summary

This audit evaluates the licensing, production status, and strategic architecture of **Twenty CRM** (`twentyhq/twenty`) within the Roxira platform.

### Key Conclusions:
1. **Licensing Contagion (AGPLv3 + Enterprise)**: Twenty CRM's core server is licensed under **AGPLv3**, with several server modules containing proprietary `@license Enterprise` headers requiring paid commercial Organization agreements. AGPLv3 Section 13 imposes network source-code disclosure obligations if modified and provided as a remote network service. This violates Roxira's runtime licence standard (which permits only permissive licences: MIT, Apache-2.0, BSD, ISC, CC0, PostgreSQL).
2. **Production Status (Retired Since 2026-10-22)**: The 3 Twenty CRM containers (`twentycrm/twenty:v2.41.0`, Postgres 16.9, Redis 7) were formally stopped on 2026-10-22 to save ~440 MB RAM and reclaim host capacity. The instance holds no active customer data and is not exposed to users.
3. **Product Redundancy**: Roxira's native NestJS/PostgreSQL backend (`output_apps/enterprise_hub/modules/`) now includes its own multi-tenant CRM, customer drawer, invoicing, party management, and accounting integration. Adopting Twenty CRM would impose a multi-runtime DevOps tax and licensing compliance risk.
4. **Resolution**: **REMOVE and REPLACE**. Twenty CRM is permanently decommissioned in favor of Roxira's native enterprise suite. The port 3002 reservation in `AGENTS.md` is designated as legacy/decommissioned.

---

## 2. Upstream Licensing Analysis

| Component | Upstream Licence | Classification in Licence Gate (#999) | Impact on Roxira Platform |
|---|---|:---:|---|
| **Twenty Server Core** (`twentyhq/twenty`) | **AGPLv3** (GNU Affero GPL v3) | **BLOCKED** | Section 13 requires complete source code disclosure to all users interacting with the software across a computer network. Incompatible with Roxira's commercial proprietary enterprise architecture if modified. |
| **Twenty Enterprise Modules** | **Proprietary Commercial** (`@license Enterprise`) | **BLOCKED** | Server features (e.g. enterprise SSO, advanced RBAC, audit logs) require paid commercial licenses from TwentyHQ and cannot be freely self-hosted in multi-tenant commercial offerings. |
| **Twenty Client SDK** | **MIT** | PERMISSIVE | Permissive client library, but unused since Roxira uses native REST/OpenAPI client contracts. |
| **Twenty Stack Databases** (`postgres:16`, `redis:7`) | PostgreSQL / RSALv2-SSPL | SEPARATE | Redundant database engines requiring dual-major PostgreSQL maintenance (Postgres 16 alongside Roxira's primary Postgres 17). |

### Autonomous Engineering Standard Compliance & AGPLv3 Section 13 Boundary:
Per `AGENTS.md`, `docs/strategy/ARCHITECTURE_DECISIONS_2026-11-16.md`, and issue #1387 / #1396:
> *"No adoption of outside suites (Twenty, NocoBase, Teable, Plane, Huly, Medusa). They are AGPL or a second platform... We use them as UX references only."*

#### Exact AGPLv3 Boundary & File:Line Evidence:
1. **Unmodified Upstream Image**: Roxira runs strictly the unmodified upstream image `twentycrm/twenty:v2.41.0` (`docs/ops/TWENTY_CRM_AUDIT.md#L41`). We do not maintain, build, or fork Twenty code.
2. **Strict API-Only Isolation**: We talk to Twenty exclusively over its HTTP REST API via `scripts/ops/crm/sync_to_twenty.py`:
   - `scripts/ops/crm/sync_to_twenty.py#L2-L15`: Python stdlib script reading our Postgres read-only and upserting into Twenty over its REST API (`TWENTY_API_URL`, default `http://roxira_twenty_crm:3000`).
   - `scripts/ops/crm/sync_to_twenty.py#L190-L224`: `TwentyClient._req` uses Python's standard `urllib.request` to issue standard HTTP requests (`POST`, `PATCH`, `GET`) to `/rest/{path}`.
   - `scripts/ops/crm/sync_to_twenty.py#L14-L28`: Zero imports of Twenty libraries or npm packages; standard library and psycopg only.
   - `scripts/ops/crm/roxira-crm-sync.service#L14`: Integration executed as a decoupled background service stdin script.
3. **AGPL Section 13 Trigger**: AGPLv3 Section 13 (Remote Network Interaction) requires source code disclosure if an entity **modifies** the program and provides network access. Running an unmodified upstream container behind a decoupled REST API prevents copyleft contagion. **ANY modification of Twenty itself triggers AGPLv3 section 13 and strictly requires owner approval and explicit sentence.** Modifying Twenty core is prohibited.

Twenty CRM is classified as **BLOCKED** for core adoption or modification under the runtime licence gate.

---

## 3. Production Inventory & Audit Evidence

### Host Evidence:
- **Image**: `twentycrm/twenty:v2.41.0` (digest unpinned, Node 22).
- **Listening Ports**: Previously bound to `127.0.0.1:3002` (reverse-proxied via Nginx at `/crm-service/`).
- **Containers**:
  1. `roxira_twenty_crm` (application server)
  2. `roxira_twenty_db` (`postgres:16.9-alpine`)
  3. `roxira_twenty_redis` (`redis:7.4.11-alpine`)
- **Operational State**: Containers stopped via `docker stop` on 2026-10-22. Cold volumes preserved in Docker storage. No automated backup or replication jobs target Twenty volumes.
- **Data Status**: No production tenants or customer records exist in Twenty CRM.

---

## 4. Contradiction Resolution: STATE.md vs SYSTEM_MAP.md

### Historical Discrepancy:
- `docs/SYSTEM_MAP.md` line 45 records:
  `Retired: Twenty CRM (3 containers, data volumes kept; replaced by our own suite; restart command in /root/deploy-state/disk-guard.log), crawl4ai.`
- Earlier strategy documents (`docs/strategy/MASTER_PLAN_2026-10-16.md`, `INFRA_MAP_2026-10-09.md`) referred to Twenty CRM as an active internal dogfooding component.
- `AGENTS.md` listed port `3002` under active reserved ports.

### Authoritative Resolution:
- **`docs/SYSTEM_MAP.md` is correct**: Twenty CRM is **Retired**.
- **Product Architecture**: All CRM capabilities (customer directory, party links, contact drawers, communication logs, invoicing integration) are implemented natively inside `output_apps/enterprise_hub/` with strict multi-tenancy (`tenant_id`), PostgreSQL Row-Level Security (RLS), and TypeORM.
- **Port Status**: Port `3002` remains reserved solely to prevent port re-assignment collisions during container teardown, but no active traffic is routed to it.

---

## 5. Strategic Options & Decommission Plan

| Option | Pros | Cons | Recommendation |
|---|---|---|:---:|
| **A. Re-activate & Isolate** | Full-featured external CRM UI immediately available. | AGPLv3 compliance burden, paid enterprise license requirements, 2nd PostgreSQL engine, 440 MB RAM overhead. | **REJECTED** |
| **B. Fork & Modify** | Code control. | Extreme maintenance overhead, AGPL Section 13 viral contagion, monorepo desynchronization. | **REJECTED** |
| **C. Replace with Native Suite (Decommission Twenty)** | Zero licensing risk (100% MIT/Apache/PostgreSQL code), single unified PostgreSQL 17 engine, zero extra RAM waste, seamless RLS multi-tenancy. | Requires incremental UX polish on native CRM pages. | **ACCEPTED** |

### Decommission Action Items:
1. **Host Hygiene (Next Scheduled Host Maintenance)**: Remove stopped Twenty containers (`docker rm roxira_twenty_crm roxira_twenty_db roxira_twenty_redis`) and prune orphan Docker volumes (`twenty_data`).
2. **Nginx Clean-up**: Remove inactive upstream block for `:3002` from Nginx configuration during the next major gateway review.
3. **CI Licence Gate**: Ensure CI checks prevent accidental re-introduction of AGPL-licensed upstream dependencies.
