# Huge import (1, 5, 10 GB and more): limits, design, status

Issue #286. Goal: a customer uploads a database dump, ZIP, Excel, CSV or SQL of any practical size and it becomes
Roxira data end to end, with progress, cancel, resume and the existing review gate (nothing posts before approval).
Sibling doc for the streaming parser and benchmark: `docs/BULK_IMPORT.md` (#105). Laptop wizard work: #277, #282.

**Hard constraint:** srv1 has about 16 GB free disk. A customer file must never be written there.

## 1. Every limit on today's path (traced end to end)

Two paths exist. The **old wizard path** (`/app/import` upload button) is small-file only. The **bulk path**
(`/enterprise-hub/data-import/bulk/*`, panel "ورود حجیم", #105) has no practical size limit already.

| # | Layer | Old wizard path | Bulk path (#105) | Where |
|---|---|---|---|---|
| 1 | Browser | one `fetch` of the whole file; allow-list `.xlsx .csv .pdf .jpg .jpeg .png` (so `.sql`/`.zip`/`.sqlite` are refused before upload, #277) | XHR `PUT` of 64 MiB parts straight to R2, 4 in parallel, retry with back-off, resume by listing stored parts | `frontend/src/lib/api/data-import-suite-client.ts:94`, `bulk-import-client.ts` |
| 2 | Cloudflare (if the zone is proxied; **not verified**) | 100 MB request body and 100 s origin timeout on Free/Pro; larger bodies give 413, slow origin gives 524 (`docs/research/UPLOAD_PIPELINE_2026-10-12.md` §1.2) | not in the path for direct R2 parts; the relay fallback sends 64 MiB parts, under 100 MB | n/a |
| 3 | nginx | global `client_max_body_size 50M`; `/enterprise-hub/` 16m; `/enterprise-hub/data-import/packages` 41m; `/api/backend/` inherits 50M; `client_body_timeout 60s`; proxy timeouts 300s; request buffering ON (body spooled to nginx temp dir up to the cap) | JSON-only calls (start/sign/parts/complete) fit the 16m location; **the relay route had no suitable location** (a 64 MiB part exceeded 50M) | `output_apps/nginx_config/nginx.conf` lines 16, 19, 422, 440, 455 |
| 4 | NestJS | multer: 10 MB CSV/XLSX, 15 MB PDF/image; package import 40 MB; non-streaming readers (XLS, ODS, DBF, JSON, XML, OFX, IIF, SQLite, PDF) up to `IMPORT_MAX_FILE_BYTES` 120 MB; container `mem_limit: 900m`, `/tmp` is a RAM tmpfs | no multer, no body parser on parts: bytes never reach Nest on the direct path; throttler 120/min start, 600/min sign/parts | `constants/data-import.constants.ts`, `constants/package-import.constants.ts`, `docker-compose.prod.yml:287` |
| 5 | Chunked upload | #105 multipart: `MAX_PARTS` 10 000, part = max(64 MiB, size/10 000) so 640 GiB at default part size and scales beyond; `IMPORT_BULK_MAX_FILE_BYTES` default 1 TiB (sanity bound); 5 active jobs per tenant | same | `bulk/bulk.constants.ts` |
| 6 | Quota | none | `IMPORT_TENANT_QUOTA_BYTES` default **50 GiB**, a single env value for every tenant (not per tenant); counts uploaded sources currently kept; freed on post/cancel/expiry | `bulk-import.service.ts startUpload` |
| 7 | Bytes at rest | tmp files on the API host | **R2** object `tenants/<tenant>/imports/<job>/source` (keys built only from UUIDs). Not on srv1 disk. | `bulk/storage/s3-object-store.ts` |
| 8 | Staged rows | in memory (small) | **PostgreSQL on srv1**: `bulk_import_rows`, about **1.4x the CSV** (14.4 M rows / 5.1 GB CSV = 7.5 GB). **This is the real disk limit of a huge import.** | `docs/BULK_IMPORT.md` benchmark |
| 9 | Hostile-file guards | zip-slip, nested archives, XXE refused | same plus ratio 1 000:1 after 256 MiB, 20 000 entries, 200 GiB expanded, 4 MiB record, 32 768 char cell | `bulk.constants.ts`, `stream/zip-walker.ts` |

### Findings (what was actually wrong or missing)

1. **The 10 GB path already exists and never touches srv1 for the file itself** (R2 multipart, presigned parts, resume,
   quota, tenant-scoped rows with FORCE RLS). It was not wired into the wizard and had gaps below.
2. **No fallback if R2 is unreachable from Iran.** The S3 store threw "Parts are uploaded directly to the presigned
   URL"; only the dev `local` driver accepted parts through the API.
3. **No per-part integrity check.** Only sizes were compared at `complete`.
4. **Latent production bug, fixed here:** `@aws-sdk/client-s3` 3.1161 adds `x-amz-checksum-crc32=AAAAAA==` (the CRC of an
   *empty* body) to every presigned `UploadPart` URL (`requestChecksumCalculation` defaults to `WHEN_SUPPORTED`). Real
   parts do not match it, so R2 can answer `BadDigest`. Found by a unit test; the client now uses `WHEN_REQUIRED`.
   Production R2 was never exercised with real credentials in CI, so run the probe (section 5) once.
5. **Staging can fill srv1.** A 10 GB CSV stages about 14 GB of rows. Nothing capped the staging table. Fixed: global
   `IMPORT_STAGING_MAX_BYTES` guard (section 3).
6. **Database dumps in binary or non-streamed formats** (`pg_dump -Fc`, SQL Server `.bak`, SQLite, XLS, ODS, DBF,
   JSON, XML) stay capped at 120 MB; text SQL dumps (MySQL, PostgreSQL incl. COPY, T-SQL) already stream with no limit.
   See section 6, follow-up.
7. The old wizard still caps at 10/16/41 MB and refuses `.sql`/`.zip`: laptop issue #282 / the `claude-win` issue below.

## 2. Design

```
browser (resumable-upload.ts)                      API (NestJS, tenant from JWT)          R2
 start ------------------------------------------> create job row + CreateMultipartUpload
 for each missing part, 4 in parallel:
   sha256(part) (WebCrypto)
   sign {n, sha256} ------------------------------> presign UploadPart (digest header signed)
   PUT part --------------------------------------------------------------------------> stored, digest verified
   -- if R2 is unreachable 3x in a row (no HTTP answer) switch to relay:
   PUT /bulk/uploads/:id/parts/:n  --nginx(stream)--> UploadPart(stream, ContentLength) ---> stored
 complete ----------------------------------------> ListParts, compare every size, CompleteMultipart, queue job
queue worker: stream object from R2 -> parse -> bulk_import_rows (tenant_id, FORCE RLS) -> status "ready"
review gate (user approves) -> post job -> one undoable import batch -> source + rows deleted
```

- **State:** `bulk_import_jobs` and `bulk_import_rows` already carry `tenant_id` with FORCE RLS and are only reached
  through `TenantScope` (`bulk-import.pg.spec.ts` proves it with a non-superuser role). The upload id (R2 `uploadId`) and
  part list live in R2, the job row holds the object key; nothing client-supplied enters a key.
- **Resume:** closing the tab, killing the connection or rebooting is fine. `listParts` is the source of truth; a part
  with the wrong size is re-sent. Job id is returned by `start`; the UI keeps it (localStorage) and calls with `resumeId`.
- **Checksums:** with `IMPORT_PART_CHECKSUMS=1` each presigned URL binds `x-amz-checksum-sha256`; R2 rejects a part whose
  bytes differ. The relay forwards the same header to `UploadPart`. Off by default until the probe confirms R2 enforces
  it. Size is verified in all cases.
- **Fallback relay:** `PUT /enterprise-hub/data-import/bulk/uploads/:id/parts/:n` streams the request body to R2
  (`Body` stream + `ContentLength` = the exact part size known from the job). It refuses a wrong `Content-Length`
  before storing anything. nginx location (regex, both server blocks): `client_max_body_size 98m`,
  `proxy_request_buffering off`, `client_body_timeout 120s`, proxy timeouts 900s. 98m is above the 64 MiB part and below
  Cloudflare's 100 MB. **Nothing is spooled to srv1's disk.** `IMPORT_PROXY_PARTS=0` switches the relay off.
  The `PUT` is on the existing tenant-scoped, JWT-guarded controller.
- **tus?** Not needed: S3 multipart already gives resumable, parallel, checksummed chunks, and the relay is the same
  protocol over the API. Adding tus would add a second chunk store for no gain.
- **Safety checks kept** (nothing removed): per-tenant quota (`IMPORT_TENANT_QUOTA_BYTES`), file sanity bound 1 TiB,
  zip-bomb and ratio guards, XXE refusal, format sniffing (`stream/sniff.ts`), SQL is parsed and never executed, 5 active
  jobs per tenant, review gate with explicit `confirmReviewed`.
- **Staging guard (new):** every 15 s the runner reads `pg_total_relation_size('bulk_import_rows')`; above
  `IMPORT_STAGING_MAX_BYTES` (default 6 GiB, srv1) the job stops with a Persian message and **resumes from its
  checkpoint** when the owner presses "ادامه" after space is free. This keeps a 10 GB CSV from filling the disk.

## 3. What this PR changed

| File | Change |
|---|---|
| `modules/data_import/bulk/storage/s3-object-store.ts` | `WHEN_REQUIRED` checksums (bug 4), signed `x-amz-checksum-sha256`, streamed `putPart` relay |
| `.../bulk-import.service.ts`, `.controller.ts`, `.dto.ts` | `proxyParts`/`checksums` capabilities, `putProxyPart` (any driver), checksum sanitising |
| `.../bulk.constants.ts`, `bulk-import.runner.ts`, `bulk-import.repository.ts` | `IMPORT_PROXY_PARTS`, `IMPORT_PART_CHECKSUMS`, `IMPORT_STAGING_MAX_BYTES`, staging guard |
| `output_apps/nginx_config/nginx.conf` | streaming relay location in roxira.ir and roxira.net blocks |
| `frontend/src/lib/upload/` | framework-free resumable uploader (parallel, checksum, retry, abort, fallback) + 7 tests |
| `frontend/src/lib/api/bulk-import-client.ts` | now a thin adapter over the library (same exported API) |
| `output_apps/enterprise_hub/scripts/bulk-import/huge-upload-test.mjs` | end-to-end harness against an in-process R2 mock |
| `scripts/ops/huge_import_probe.mjs` | one-shot probe of the real bucket (checksum enforcement, relay, CORS reminder) |

## 4. Tests and measured throughput

Harness: the real upload library + real `BulkImportService` + real `S3ObjectStore` (AWS SDK presigning and streamed
`UploadPart`) against an in-process S3/R2 mock that verifies every part digest and discards the bytes. Synthetic 2 GiB
file (`fs.openAsBlob`, 32 parts of 64 MiB), MacBook, 2026-11-04, other sessions running. **Client and server share one
Node process, so these MB/s are bounded by SHA-256 hashing and the shared event loop, not by a network; they prove
correctness and absence of per-part stalls, not R2 or Iranian-ISP speed.**

| Scenario | Result (run 1 / run 2) |
|---|---|
| A. direct presigned PUT, 4 parallel, SHA-256 per part | 2 GiB, 32 parts, 0 bad digests; 20.8 s (98 MB/s) / 47.7 s (43 MB/s) |
| B. connection killed at 41 %, then resume from the job id | 13-14 parts already stored were skipped (0.87-0.94 GB), only the remaining parts were sent; resume took 6.6-9.8 s; storage finished with exactly 2 GiB |
| C. relay through the API (the nginx fallback), streamed | 2 GiB, 0 bad digests; 23.2 s (88 MB/s) / 26.5 s (77 MB/s) |
| D. storage unreachable from the browser | auto switch to the relay after 3 network failures (`fellBack: true`); 2 GiB delivered; 26-27 s (75-79 MB/s) |

Peak RSS of the shared process 580-910 MiB (includes four 64 MiB blobs being hashed on the client side); it does not
grow with file size. Unit tests: library 7/7; service spec 11/11 (includes checksum signing, relay size checks,
`IMPORT_PROXY_PARTS=0`); all other `data_import/bulk` specs pass.

**Not done / not provable here (stated plainly):**
- No real R2 bucket, no Cloudflare, no Iranian network: reachability of `*.r2.cloudflarestorage.com` from Iran is
  unmeasured. The relay exists exactly for that case.
- No 10 GB run: the Mac has 12 GB free. The 2 GiB run is 32 parts; 10 GB is 160 parts of the same size, linear in this
  harness. To repeat at 10 GiB on a machine with 25 GB free: `--gib 10`.
- Server-side post/approve at 10 M rows is unmeasured (see `docs/BULK_IMPORT.md`).
- `nginx -t` was not run locally (no nginx); autodeploy validates and rolls back.
- `data-import.controller.spec.ts` needs a loopback listen that this sandbox forbids; it was not run here.

Re-run:

```bash
cd output_apps/enterprise_hub
DIST=/tmp/hugedist; npx tsc -p tsconfig.json --outDir $DIST --noEmit false
NODE_PATH=$PWD/node_modules node scripts/bulk-import/huge-upload-test.mjs --dist $DIST --gib 2
```

## 5. Owner steps (exact commands; nothing here restarts anything by itself)

1. Merge, then autodeploy ships the code and the nginx change (it runs `nginx -t` and rolls back on failure,
   `docs/ops/AUTODEPLOY.md`). If the reload is skipped, on srv1:
   ```bash
   docker exec <nginx-container> nginx -t && docker exec <nginx-container> nginx -s reload
   ```
2. R2 must be configured (`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, see `docs/BULK_IMPORT.md`),
   bucket CORS set for `https://roxira.ir` (allow `PUT`, headers `*`, expose `ETag`), lifecycle "abort incomplete
   multipart uploads after 3 days".
3. Probe the real bucket once (prints PASS/FAIL, never keys). Only if all four pass, set `IMPORT_PART_CHECKSUMS=1` in the
   backend env and recreate the backend container:
   ```bash
   set -a; . ~/Secrets/roxira/roxira.env; set +a
   NODE_PATH=output_apps/enterprise_hub/node_modules node scripts/ops/huge_import_probe.mjs
   ```
4. Staging budget: `IMPORT_STAGING_MAX_BYTES` defaults to 6 GiB. Raise it only after attaching a data volume or
   checking `df -h` on srv1.
5. Prerequisite already documented: `install -d -o 100 -g 101 /var/lib/roxira/import-spool`.

## 6. Follow-ups (not in this PR)

1. **Wire the wizard** (`claude-win`): route any file over ~5 MB, and every `.sql`/`.zip`/`.sqlite`, to the bulk path with
   `uploadBulkFile` (resume, progress, cancel); keep the job id in localStorage and pass `jobId` after a reload; show
   `config.proxyParts` fallback events. Same issue as #282's accept-list work.
2. **Per-tenant quota as a setting:** today one env value for all tenants. Needs a tenant-scoped settings table (FORCE
   RLS migration) and an admin edit in the console. Small, but a migration needs its own reviewed PR.
3. **Binary database dumps (`pg_dump -Fc`, `.bak`, SQLite over 120 MB):** restore into a throwaway container or scratch
   schema with CPU/RAM/disk limits, then read tables through the normal parser. Needs a sandbox host that is not srv1's
   main PostgreSQL (suggested: a one-shot container on a Hetzner volume, `--memory`, `--cpus`, read-only R2 input,
   network off, killed after N minutes). Design review before building; this PR does not execute any customer SQL.
4. **Staging off srv1's disk:** keep `bulk_import_rows` on a separate tablespace/volume, or stage to compressed Parquet
   in R2. The guard in this PR only prevents harm; it does not raise capacity.
5. Cloudflare plan check: confirm whether `roxira.ir` is proxied (100 MB body cap); if it is, keep `IMPORT_PART_BYTES` at
   or under 64 MiB for the relay (it is).
