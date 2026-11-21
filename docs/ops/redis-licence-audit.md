# Redis / Valkey Container Image Licence Audit (T299 / #1122)

**Date:** 2026-11-21
**Scope:** All `docker-compose*.yml`, `.github/workflows/*.yml`, and `scripts/infra/e2e/sandbox_up.sh` references on `main`.
**Policy:** Runtime dependencies and container images must use permissive OSI-approved licences (BSD, MIT, Apache-2.0, PostgreSQL). Redis 7.4+ and Redis 8 are dual-licensed under RSALv2 / SSPLv1 (non-OSI) and are disallowed.

## 1. Inventory & Disposition Table

| File & Line | Service / Job | Previous Image | Previous Licence | Disposition | New Image | New Licence |
|---|---|---|---|---|---|---|
| `docker-compose.modern-stack.yml:21` | `twenty_redis` | `redis:7.4.11-alpine` | RSALv2 / SSPLv1 (non-OSI) | **Replaced** | `valkey/valkey:8-alpine` | BSD-3-Clause |
| `docker-compose.prod.yml:196` | `redis_prod` | `redis:7-alpine@sha256:ff02b58f...` | Unpinned `7.x` minor (RSALv2 / SSPLv1 risk) | **Replaced** (prod restart requires owner OK) | `valkey/valkey:8-alpine` | BSD-3-Clause |
| `docker/research-stack/docker-compose.yml:23` | `valkey` | `docker.io/valkey/valkey:8-alpine` | BSD-3-Clause | **Kept** | `docker.io/valkey/valkey:8-alpine` | BSD-3-Clause |
| `output_apps/docker-compose.prod.yml:19` | `redis` | `valkey/valkey:8` | BSD-3-Clause | **Kept** | `valkey/valkey:8` | BSD-3-Clause |
| `.github/workflows/ci.yml:716` | `m1-gate` service `redis` | `${{ vars.CI_IMAGE_REGISTRY \|\| 'public.ecr.aws/docker/library' }}/redis:7` | Unpinned `7.x` (resolves to 7.4+ RSALv2 / SSPLv1) | **Replaced** | `${{ vars.CI_IMAGE_REGISTRY \|\| 'public.ecr.aws/docker/library' }}/redis:7.2` | BSD-3-Clause |
| `scripts/infra/e2e/sandbox_up.sh:107` | `$RX_REDIS` | `redis:7-alpine` | Unpinned `7.x` (RSALv2 / SSPLv1) | **Replaced** | `valkey/valkey:8-alpine` | BSD-3-Clause |

## 2. Cache-Engine Decision

- **Standard cache/queue engine:** **Valkey 8 (`valkey/valkey:8-alpine`, BSD-3-Clause)** for all compose stacks and local/sandbox environments. Valkey is a Linux Foundation-backed BSD-3-Clause drop-in fork of Redis 7.2.4, wire-compatible with `ioredis` / BullMQ and providing `redis-cli` / `redis-server` compatibility symlinks.
- **CI library-mirror service container:** **`redis:7.2` (BSD-3-Clause)** in `.github/workflows/ci.yml` because `CI_IMAGE_REGISTRY` mirrors Docker Hub `library/*` images (`redis:7.2` is the final BSD-3-Clause Redis minor series).
- **Production cutover & durability:** Production container restart requires explicit owner approval. The live data migration runbook is tracked in `#992` (T253) and AOF/RDB durability tuning in `#931` (T217).
- **Benchmark note:** A live BullMQ + rate-limit command-mix benchmark comparing Valkey 8.1/9.1 vs Redis 7.2 was **not** executed in this PR because Docker was not running on the local runner; run it on the staging/CI box before cutting over production in `#992`.

## 3. Automated Enforcement

`scripts/ci/check_image_licences.py` runs in the `agent-guards` CI job on every PR and fails on:
- `redis:7.4*`, `redis:8*`, `redis:latest`, or unpinned `redis:7` / `redis:7-alpine` (RSALv2 / SSPLv1)
- `redis-stack*` (RSALv2 / SSPLv1)
- `mongo*` / `mongodb*` (SSPLv1)
- `elasticsearch*` (SSPLv1 / ELv2)
- `minio/minio*` (AGPL-3.0)
- `grafana/grafana*` (AGPL-3.0)
