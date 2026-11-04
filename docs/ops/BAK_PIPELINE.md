# SQL Server `.bak` pipeline (phase 2, step 1)

Issue #353. From `docs/strategy/PRODUCT_DECISIONS_2026-11.md` section 4 (PR #352). Upload side: `docs/ops/HUGE_IMPORT.md` (#324).
Code: `output_apps/enterprise_hub/modules/data_import/migration/` (`bak/`, `manifest.ts`). Legacy path: `tools/windows-extractor/`.

**Status: built and unit-tested against a fake `docker`. Never run against a real SQL Server container**: this Mac session
has no Docker access, no SQL Server image and no real `.bak`. Everything marked "unverified" below must be exercised
once on the worker box before a customer file goes through it.

## 1. Flow

```
R2 object (.bak, uploaded by #324)  --worker downloads-->  local file on the worker host
   |
   v  docker run  mssql/server:2019-latest   --network none --memory 4g --cpus 2 --pids-limit 1024
   |                                          --cap-drop ALL --no-new-privileges  .bak mounted read-only
   1. RESTORE HEADERONLY      -> version, type, encryption, backup sets      (bak-header.ts: chooseRoute)
   2. RESTORE FILELISTONLY    -> exact data/log sizes -> capacity check      (capacity.ts)
   3. RESTORE DATABASE ... WITH MOVE ... ; set READ_ONLY                      (restore-plan.ts)
   4. per table: SELECT (SELECT cols FOR JSON PATH ...) -> /out/tN.ndjson -> gzip + sha256 + row-count check
   5. manifest.json  (the same contract the Windows extractor writes)
   6. docker rm -f, scratch data deleted, SA password file deleted           (always, in `finally`)
   v
manifest + NDJSON.gz  ->  DuckDB transform (phase 2.2, #354)  ->  staging schema  ->  certificate (#355)
```

Routing (`chooseRoute`), decided before any restore:

| Backup | Route |
|---|---|
| SQL Server 2008 / 2008 R2 to 2019 (`SoftwareVersionMajor` 10-15), full backup | restore in the sandbox. The newest full backup set in the file is used. |
| 2000 / 2005 (major 8, 9), or the server answers error 3169 | **legacy extractor** (Windows), never restored |
| SQL Server 2022 (16) and newer | refused until `MIGRATION_MSSQL_IMAGE` and max major are raised together |
| encrypted, differential-only, log-only, empty | refused with a Persian-ready reason |
| FILESTREAM data | refused (documents outside the database file) |

2000/2005 backups (old Holoo): the product decision allowed a second route, an intermediate SQL 2008 R2 upgrade step.
Not built: 2008 R2 has no supported Linux image, so it needs a Windows host, which is the same cost as the extractor
and also needs the customer's backup to travel. The extractor reads the live database where it already is.

## 2. Safety model (hostile backups)

A `.bak` is customer-controlled input that SQL Server executes parts of (restore runs the database engine over it).
- **No network** (`--network none`): no linked servers, no `xp_cmdshell` callbacks, no exfiltration. The only channel is `docker exec`.
- **Resource limits** on memory (swap off), CPU, pids, wall clock (6 h, then the container is removed), `tmpfs` for `/tmp`.
- **No privileges**: `--cap-drop ALL`, `no-new-privileges`, backup mounted `:ro`, one scratch dir per job.
- **No shell**: `docker` is called with argument arrays; scripts are written to files and run with `sqlcmd -i`; every name
  taken from the file (logical file names, schema, table, column) goes through `sqlString` / `sqlIdent` (tests cover quote injection).
- **SA password** is random per job, lives in a 0600 env file and inside the container, never in argv or logs.
- The restored database is set `READ_ONLY` before export; nothing the customer's database contains is executed by Roxira.
- Unverified: whether SQL Server starts with `--cap-drop ALL` on the chosen image. If it does not, relax to the minimum
  that works and record it here; do not remove `--network none`.

## 3. Licence: decision needed from the owner

The image runs with `MSSQL_PID=Express` by default (free for production use). Express limits a database to **10 GB of
data** (the capacity check refuses larger ones with `edition-limit`) and 1.4 GB buffer memory. **Developer edition is
licensed for development and test only**, so using it to migrate paying customers' data is a licence breach; the code
accepts `Developer` / `Standard` only as an explicit setting. Options for databases over 10 GB: a Standard licence on the
worker box (owner decision, cost), or ask the customer for the Windows extractor, which has no size limit.

## 4. Where it can run: srv1 or a separate worker box

Hard limits found by `capacity.ts` (`SRV1_POLICY`: 8 GiB must stay free, 3 GiB RAM minimum):
- The `.bak` must exist as a **local file** (SQL Server cannot restore from a stream), the restored database is usually
  1-5x its size (compressed backups expand), and the export adds about the data size again.
  Disk needed ~ `(data + min(log, 2 GiB) + data) x 1.1`, on top of the `.bak` itself.
- srv1 has about 16 GB free and serves customers: with the 8 GiB reserve that is roughly a **1.5 GB database** (a `.bak`
  up to about 1 GB). Anything larger is refused with a message that names the worker box.
- RAM: SQL Server needs 2 GB minimum; the container limit is 4 GiB. The backend container itself is limited to 900 MB.
  Free RAM on srv1 was not measured (no SSH access in this session): **check `free -m` before enabling it there**.

**Recommendation:** do not run restores on srv1. Run them on a separate ephemeral worker box:

| Item | Spec |
|---|---|
| Host | Hetzner CCX23 or similar (4 vCPU dedicated, 16 GB RAM), x86-64 (the SQL Server image is amd64) |
| Disk | attached volume sized per job, 60 GB covers a 10 GB data database; create per job, delete after |
| Network | private network to R2 only (egress), no inbound except the job queue; no customer data stays after the job |
| Software | Docker, the worker (this module), `IMPORT_*`/`R2_*` read-only credentials, `MIGRATION_*` settings |
| Cost | about EUR 0.05 per hour while running; nothing when deleted |

The worker host being separate also removes the risk of a hostile backup sharing a kernel with the production database.
(A container is a weaker boundary than a VM; a per-job VM is the stronger option if hostile uploads become likely.)

## 5. Settings

| Variable | Default | Meaning |
|---|---|---|
| `MIGRATION_MSSQL_IMAGE` | `mcr.microsoft.com/mssql/server:2019-latest` | must contain `/opt/mssql-tools/bin/sqlcmd` (2019 does; 2022+ images dropped the tools) |
| `MIGRATION_MSSQL_EDITION` | `Express` | see section 3 |
| memory / cpus / pids / timeout | 4096 MiB / 2 / 1024 / 6 h | `SandboxLimits` in `restore-plan.ts` |

(The runner takes these as constructor arguments; wiring them to env and to the BullMQ worker is the next step.)

## 6. Tests and what is not proven

14 unit tests (`bak/bak.spec.ts`): routing of every backup kind, 3169 detection, docker argument safety (network none,
no secret in argv, hostile names), T-SQL quoting, export SQL (amounts as strings, one JSON object per row), sqlcmd table
parsing, capacity decisions (srv1-sized and Express limit), the full runner against a fake `docker` (export, gzip, hash,
row-count verification, cleanup on failure, 3169 route, refusal before RESTORE), manifest validation.

Not proven (no SQL Server available here):
- a real `RESTORE` and `sqlcmd` output format (the table parser assumes `-W -s` output; `-C` assumes the 2019 tools);
- `FOR JSON` on every column type of real Holoo/Sepidar databases (types with no JSON form are cast to text);
- `sqlcmd -y 0` behaviour with rows over 1 MB (large `nvarchar(max)` cells);
- start-up under `--cap-drop ALL`; Persian collations on the Linux image (`Persian_100_CI_AS` is available).
First real run: take a small `Holoo` or synthetic database, `BACKUP DATABASE` it on any SQL Server, run the worker on the
worker box, and compare the manifest row counts with `SELECT COUNT(*)`.
