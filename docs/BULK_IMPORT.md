# Bulk import (no size or row limit)

Replaces the "10 MB / 20 000 rows / 20 files a day" ceiling of the single-file import for CSV, XLSX, SQL dumps and ZIP.
Code: `output_apps/enterprise_hub/modules/data_import/bulk/`. UI: `/app/import` (panel "ورود حجیم").

## How it works

1. **Upload** — `POST /enterprise-hub/data-import/bulk/uploads` creates a job and an R2 multipart upload (parts of 64 MiB,
   `IMPORT_PART_BYTES`). The browser asks for presigned URLs (`/sign`) and PUTs each part **straight to R2**; the API never
   carries file bytes. Four parts go in parallel, each retried with back-off. Closing the tab or losing the network is fine:
   `GET /uploads/:id/parts` lists what R2 already has and only the missing parts are sent. `/complete` checks every part and
   its size against R2 (not against what the browser claims), stitches the object and queues the job.
2. **Stage** — a BullMQ worker (queue `bulk-import`, concurrency 1) reads the object as a stream, parses it incrementally and
   writes rows to `bulk_import_rows` in batches of 5 000 (one write in flight while the next batch parses). Progress and a
   resume checkpoint are committed in the same transaction as each batch. Heap stays bounded: one input chunk + two batches.
3. **Control** — pause, resume, retry, cancel from the UI. Pause/cancel are honoured at the next batch boundary (≈1 s).
   A resumed or retried job re-reads the object, skips the rows already staged and continues; no duplicates, no gaps.
4. **Review gate** — the job ends in `ready`. Nothing reaches CRM/accounting/inventory until the user has seen the tables
   (first rows per table, detected entity, notes about truncated cells / formula-looking cells / skipped statements) and sent
   `approve` with `confirmReviewed: true`.
5. **Post** — a second job pages through the staged rows (2 000 at a time), runs the same validation and adapters as the small
   import, keeps a voucher's lines together, and records everything in **one import batch** so the existing undo works.
   Afterwards the source object and staged rows are deleted (quota is freed). A sweeper (every 6 h) also removes jobs that sat
   untouched for `IMPORT_STAGING_RETENTION_DAYS` (default 14).

## Formats

| Format | How |
|---|---|
| CSV / TSV / `;` / `\|` | streaming state machine; UTF‑8, UTF‑16, Windows‑1256; quoted newlines; delimiter sniffed |
| SQL dumps (MySQL/MariaDB, PostgreSQL incl. `COPY`, T‑SQL `GO` scripts) | streaming tokenizer, **never executed**; one 2 GB `INSERT` costs the same memory as a small one |
| XLSX | two streaming passes over the ZIP (metadata + shared strings spooled to disk, then sheets); dates, hidden sheets noted |
| ZIP / folder | streaming inflate; CSV, SQL and XLSX entries are read; other entries are listed in the notes |
| XLS, ODS, DBF, JSON, XML, OFX, IIF, SQLite, PDF… | still read whole by the older readers, up to `IMPORT_MAX_FILE_BYTES` (120 MB). Larger files of these types are refused with a message to export CSV/SQL. |

## Hostile-file checks (unchanged in spirit, now streaming)

ZIP: unsafe paths (`..`, absolute, drive letters, backslashes) reject the archive; nested archives are skipped with a note;
entry count cap (`IMPORT_BULK_MAX_ZIP_ENTRIES`, 20 000); total expanded size cap (200 GiB) and an expansion-ratio check
(1 000:1 after 256 MiB) against bombs; input is fed to the inflater in 16 KiB slices so one push cannot expand beyond ~16 MiB.
XML parts: DOCTYPE/ENTITY refused (XXE, billion laughs). CSV: a record over 4 MiB (unterminated quote) stops the job with a
message; cells over 32 768 chars are cut; columns over 512 dropped; formula-looking cells are counted and stored as text.
SQL: nothing is executed; `ATTACH`, `DROP`, stacked statements are skipped and counted.
Tenant isolation: tables carry `tenant_id`, every repository query filters on it and runs inside `TenantScope`
(row-level security on both tables, verified by `bulk-import.pg.spec.ts` with a non-superuser role). Object keys are
`tenants/<tenantId>/imports/<jobId>/source`, built only from UUIDs.

## Quota and limits

No row limit, no daily file limit, no per-file limit below the 1 TiB sanity bound (`IMPORT_BULK_MAX_FILE_BYTES`).
The only product ceiling is the per-organisation storage quota `IMPORT_TENANT_QUOTA_BYTES` (default 50 GiB of uploaded
sources currently kept). Over quota, the upload is refused before any byte is sent, with the quota, the usage and the file
size in the message. At most `IMPORT_BULK_MAX_ACTIVE_JOBS` (5) jobs per organisation run at once.

## Environment (owner must set; values only in the server env, never in code or frontend)

| Variable | Purpose |
|---|---|
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | bucket for imports (a **separate** bucket from backups) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | token with Object Read & Write on that bucket only |
| `IMPORT_TENANT_QUOTA_BYTES` | optional, default 53 687 091 200 (50 GiB) |
| `IMPORT_PART_BYTES`, `IMPORT_STAGING_RETENTION_DAYS` | optional (64 MiB, 14 days) |
| `IMPORT_PROXY_PARTS`, `IMPORT_PART_CHECKSUMS`, `IMPORT_STAGING_MAX_BYTES` | optional: API relay fallback (on), per-part SHA-256 (off until probed), staging table ceiling (6 GiB). See `docs/ops/HUGE_IMPORT.md` |

**Host prerequisite (one command on srv1, owner/ops):** `install -d -o 100 -g 101 /var/lib/roxira/import-spool`. The backend
container's `/tmp` is a RAM tmpfs inside a 900 MB limit, so XLSX shared-string and nested-workbook spills go to this folder
(`IMPORT_BULK_SPOOL_DIR=/import-spool`, set in `docker-compose.prod.yml`). If the folder is missing the code falls back to `/tmp`
and only workbooks with very many strings are affected.

Without the four `R2_*` values production reports "not configured" and refuses uploads (it never falls back to sending
files through the API). Outside production the `local` driver is used.

**R2 bucket CORS (required, set once in the Cloudflare dashboard → bucket → Settings → CORS):**

```json
[{"AllowedOrigins":["https://roxira.ir"],"AllowedMethods":["PUT"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]
```

Also add an R2 lifecycle rule "abort incomplete multipart uploads after 3 days".

## Re-running the benchmark

```bash
node output_apps/enterprise_hub/scripts/bulk-import/gen-fixture.js csv /tmp/big.csv 14400000      # ≈5.5 GB
npx tsc -p output_apps/enterprise_hub/tsconfig.json --outDir /tmp/dist --noEmit false
NODE_PATH=output_apps/enterprise_hub/node_modules /usr/bin/time -l node --max-old-space-size=256 \
  /tmp/dist/scripts/bulk-import/bench.js --file /tmp/big.csv --expect-rows 14400000 --pg-port <port>
```

## Measured results (local MacBook, 2026-11-01/03; PostgreSQL 15 on the same machine)

Runs use the real worker code (`BulkImportRunner`) with `node --max-old-space-size=256`. "Peak RSS" is the kernel's
`maximum resident set size` from `/usr/bin/time -l` for the whole process (Node + pg driver + parser). Raw JSON: `docs/research/2026-11-01/`.

| Fixture | Size | Rows staged | Time | Peak RSS | Peak heap | Verified |
|---|---|---|---|---|---|---|
| CSV, 12 columns, Persian text | **5.11 GiB** (5 486 153 990 B) | **14 400 000** | 436 s (33 000 rows/s, 12 MB/s) | **240 MB** | 83 MB | count = expected, row numbers 1…14 400 000 contiguous, first/last row correct |
| MySQL dump, multi-row INSERT | 1.51 GiB | 4 000 000 | 54 s (74 000 rows/s) | 231 MB | 74 MB | count = expected |
| XLSX, 3 sheets × 1 000 000 rows | 0.35 GiB (≈3.4 GiB of XML) | 3 000 000 | 142 s | 357 MB | 118 MB | count = expected |
| ZIP folder of 6 CSV files | 0.35 GiB (2.2 GiB expanded) | 6 000 000 | 146 s | 301 MB | 84 MB | count = expected |
| ZIP64, single 5.5 GB CSV entry (parse only, no DB) | 0.83 GiB zip | 14 400 000 | 30 s | 321 MB | — | count = expected |

Staged data for the 14.4 M-row CSV occupies 7.5 GB in PostgreSQL (about 1.4× the file); on srv1 (17 GB free) a job of that
size fits, and a job's rows are deleted when it is posted or cancelled. The slowest stage is PostgreSQL, not parsing
(parse alone: 134 MB/s on the same CSV).

Bug found by the benchmark: XLSX/ZIP entries written with a data descriptor (Excel, streaming zippers) made the unzip library
buffer skipped entries (peak RSS 821 MB on the XLSX); skipped entries are now drained (357 MB).

Not measured: the post (approve) step at 10 M rows (its paging is unit-tested; throughput depends on the owning module's
adapters), and uploads to a real R2 bucket (no credentials here; presigning is unit-tested and the local driver exercises the
same part/resume/complete logic).
