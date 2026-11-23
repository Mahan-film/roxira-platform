# Redis / Valkey Container Image Licence Audit (T299 / #1122)

**Date:** 2026-11-21 (updated 2026-11-22)  
**Scope:** Container image audit across CI workflows, compose files, and infra scripts.  
**PR Scope (#1158):** Documentation, CI test suite (`tests/test_valkey_data_compatibility.py`), image licence CI gate (`scripts/ci/check_image_licences.py`), and CI service container pin (`.github/workflows/ci.yml`). Production compose files are strictly excluded from this PR and scheduled for owner-approved cutover in row #992 (T253).

---

## 1. Inventory & Disposition Table

| File & Line | Service / Job | Existing Image on `main` | Existing Licence Status | PR #1158 Disposition | Target Image for Cutover (#992) | Licence |
|---|---|---|---|---|---|---|
| `.github/workflows/ci.yml:719` | CI service `redis` | `${{ ... }}/redis:7` | Unpinned `7.x` (resolves to 7.4+ RSALv2/SSPLv1) | **Replaced in CI** | `${{ ... }}/redis:7.2` | BSD-3-Clause |
| `docker-compose.prod.yml:196` | `redis_prod` | `redis:7-alpine@sha256:ff02b58f...` | Pinned digest of mutable `7-alpine` (RSALv2/SSPLv1 risk) | **Kept untouched in PR** (avoids autodeploy restart) | `valkey/valkey:8-alpine@sha256:9971099af41c36e887aabdfe22b80c0fe45df949163dfc9cb434febc57cfc3fc` | BSD-3-Clause |
| `docker-compose.modern-stack.yml:21` | `twenty_redis` | `redis:7.4.11-alpine` | RSALv2 / SSPLv1 (non-OSI) | **Kept untouched in PR** (avoids autodeploy restart) | `valkey/valkey:8-alpine@sha256:9971099af41c36e887aabdfe22b80c0fe45df949163dfc9cb434febc57cfc3fc` | BSD-3-Clause |
| `scripts/infra/e2e/sandbox_up.sh:107` | `$RX_REDIS` | `redis:7-alpine` | Unpinned `7.x` | **Kept untouched in PR** | `valkey/valkey:8-alpine@sha256:9971099af41c36e887aabdfe22b80c0fe45df949163dfc9cb434febc57cfc3fc` | BSD-3-Clause |
| `docker/research-stack/docker-compose.yml:23` | `valkey` | `docker.io/valkey/valkey:8-alpine` | BSD-3-Clause | **Kept on main** | `docker.io/valkey/valkey:8-alpine` | BSD-3-Clause |
| `output_apps/docker-compose.prod.yml:19` | `redis` | `valkey/valkey:8` | BSD-3-Clause | **Kept on main** | `valkey/valkey:8` | BSD-3-Clause |

> **Exclusion rationale:** Production and dev compose references (`docker-compose.prod.yml:196`, `docker-compose.modern-stack.yml:21`, and `scripts/infra/e2e/sandbox_up.sh:107`) are excluded on purpose via `EXCLUDED_PENDING_MIGRATION` in `scripts/ci/check_image_licences.py` until the #992 cutover to avoid unexpected autodeploy container recreation. They are kept untouched in this PR.

---

## 2. Valkey Digest Pinning & CLI Parity

### Immutable Multi-Arch Digest Lock
To prevent unpinned image drift, Valkey 8 Alpine is pinned by its multi-architecture manifest digest:
```yaml
image: valkey/valkey:8-alpine@sha256:9971099af41c36e887aabdfe22b80c0fe45df949163dfc9cb434febc57cfc3fc
```
Architectures resolved:
- `linux/amd64`: `sha256:bba7a8ff03d38e61a98c3ce3d37ababcff29ff73b8e0ee06a1b14a22a1fa1005`
- `linux/arm64`: `sha256:9fd135924798d88b8a353f29396300eb6665e2320cf091947d1ae4fb9990df8b`

### `redis-cli` Verification in Valkey Container
Healthchecks (`docker-compose.prod.yml:213`), automated backups (`scripts/ops/backup/server_backup.sh:253`), and monitoring (`scripts/auto_review_system.py:168`) invoke `redis-cli`.
- **Upstream Build Verification:** In the official Valkey source tree (`src/Makefile`), `USE_REDIS_SYMLINKS?=yes` is enabled by default. `make install` installs symlinks:
  - `redis-cli -> valkey-cli`
  - `redis-server -> valkey-server`
  - `redis-benchmark -> valkey-benchmark`
  - `redis-check-rdb -> valkey-check-rdb`
  - `redis-check-aof -> valkey-check-aof`
- In `valkey/valkey:8-alpine`, these symlinks reside in `/usr/local/bin` and are included in the runtime container path. Existing commands (`docker exec roxira_redis_prod redis-cli ping`) remain 100% compatible without requiring script changes.

---

## 3. Data Compatibility & Test Coverage

### RDB & AOF Compatibility
- **RDB Version 11:** Redis 7.0, 7.2, and 7.4 all serialize RDB files with format version 11 (header `REDIS0011`). Valkey 8.0 was forked from Redis 7.2.4 and uses the exact same `RDB_VERSION 11`. Valkey loads `dump.rdb` files from Redis 7.x without conversion errors.
- **Twenty CRM Multi-Part AOF:** Twenty CRM runs with `appendonly yes`. Its multi-part AOF manifest (`appendonly.aof.manifest` with base RDB `type b` and incremental `type i`) uses standard RESP commands that Valkey parses and executes transparently.
- **Automated Test Suite:** Verified in `tests/test_valkey_data_compatibility.py`:
  - `test_rdb_header_and_version_11_compatibility`: Synthesizes Redis 7.4.11 RDB payload and parses format 11 headers.
  - `test_multipart_aof_manifest_structure`: Validates manifest parser against Twenty CRM AOF layouts.
  - `test_resp_aof_command_stream_compatibility`: Validates stream commands (`SET`, `HSET`, BullMQ queue `LPUSH`).
  - `test_redis_cli_command_parity_contract`: Asserts command parity for ping, bgsave, and lastsave.
  - `test_safe_volume_copy_and_rollback_lifecycle`: Validates non-destructive backup copying and rollbacks.

> **Live volume validation status:** While format specifications (RDB v11, multi-part AOF, redis-cli symlink) are verified structurally and in unit test harnesses (`tests/test_valkey_data_compatibility.py`), full live volume compatibility remains unverified until a real volume-copy test runs during the #992 cutover window.

---

## 4. Production Cutover Runbook (Tracked in #992 / T253)

Production cutover MUST take place in an owner-approved maintenance window to prevent unexpected container recreation during continuous autodeploy:

1. **Pre-flight Persistence Flush:**
   ```bash
   docker exec roxira_redis_prod redis-cli bgsave
   # Confirm dump completion
   docker exec roxira_redis_prod redis-cli lastsave
   ```
2. **Copy Data to Staging (Zero-Destruction Guardrail):**
   ```bash
   mkdir -p /opt/roxira_backups/pre_valkey_staging
   docker cp roxira_redis_prod:/data/dump.rdb /opt/roxira_backups/pre_valkey_staging/dump.rdb
   cp -a /opt/roxira_platform/twenty_data/redis /opt/roxira_backups/pre_valkey_staging/twenty_redis
   ```
3. **Verify Data Copies:**
   Check file size and magic:
   ```bash
   head -c 9 /opt/roxira_backups/pre_valkey_staging/dump.rdb # must output REDIS0011
   ```
4. **Apply Image Cutover in PR for #992:**
   Update `docker-compose.prod.yml` and `docker-compose.modern-stack.yml` with the digest-pinned Valkey image.
5. **Rollback Plan:**
   If Valkey encounters any startup or data load failure:
   - Revert image in compose to `redis:7-alpine@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf`.
   - Restore `/data/dump.rdb` from `/opt/roxira_backups/pre_valkey_staging/dump.rdb`.
   - Recreate container: `docker compose -f docker-compose.prod.yml up -d redis_prod`.

---

## 5. Automated CI Licence Gate

`scripts/ci/check_image_licences.py` runs in the `agent-guards` CI job and blocks:
- Redis 7.4+, Redis 8+, latest, or unpinned 7.x (RSALv2 / SSPLv1).
- Redis <= 7.0 (EOL / unsupported).
- `redis-stack*` (RSALv2 / SSPLv1).
- `mongodb` / `mongo` (SSPLv1).
- `elasticsearch` (SSPLv1 / ELv2).
- `minio/minio` (AGPL-3.0).
- `grafana/grafana` (AGPL-3.0).
- Only `redis:7.2` (final BSD-3-Clause release) and `valkey/valkey:*` are permitted.
