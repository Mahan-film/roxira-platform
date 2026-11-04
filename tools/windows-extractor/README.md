# Roxira table extractor for old SQL Server databases (spec + stub)

**Status: SPEC AND STUB. Not built, not tested on Windows, not shipped.** Issue #353, `docs/ops/BAK_PIPELINE.md`.

## Why it exists
Backups made by SQL Server 2000 and 2005 (older Holoo installs) cannot be restored by any SQL Server that runs on Linux:
`RESTORE` fails with error 3169 and there is no supported way around it. A customer's own Windows machine, which still
runs the source SQL Server, can read the tables directly. This tool does that and uploads the tables in the same format
the server-side `.bak` pipeline produces, so everything after it is shared.

## What the customer does (target experience)
1. Roxira shows a "legacy database" page with a one-time upload code and a download link (signed, per tenant).
2. They run `RoxiraExtract.exe` (or the PowerShell stub) on the machine that has the database, pick the server and
   database from a list (Windows login by default; SQL login supported), press Start.
3. It shows progress per table, can be stopped and resumed, and uploads straight to the same resumable upload
   (`/enterprise-hub/data-import/bulk/uploads`, `frontend/src/lib/upload` protocol) with the upload code. No file is
   left behind except an optional local copy the customer may delete.

## Output contract (identical to the `.bak` path, `modules/data_import/migration/manifest.ts`)
- One file per table: `tN.ndjson.gz`, UTF-8, one JSON object per line, `INCLUDE_NULL_VALUES` semantics.
- `decimal`, `numeric`, `money`, `smallmoney`, `float`, `real`, `bigint` are written as JSON **strings**
  (amounts must never pass through a double). Binary columns are base64. Dates are ISO 8601 without time zone.
- Text is exported as it is stored: Arabic ي/ك are **not** normalised here (the server does it).
- `manifest.json`: `{ version: 1, source: { kind: "extractor", sqlMajor, databaseName, collation, createdAt }, tables: [{ schema, name, rows, file, sha256, columns: [{ name, type }] }] }`.
  `rows` is counted while reading; the server re-counts and compares, a mismatch fails the job.
- The server validates the manifest as untrusted input (safe file names, hashes, counts) before reading any file.

## Why NDJSON.gz and not Parquet on the customer machine
The decision in PRODUCT_DECISIONS section 4 says "uploads Parquet". NDJSON.gz keeps the extractor free of native
libraries on unknown, often locked-down, old Windows machines (.NET Framework 4.x or Windows PowerShell 5.1 is enough).
DuckDB converts it to Parquet on the server in one pass. A Parquet writer (Parquet.Net) can replace the NDJSON writer
later without changing anything downstream, because the manifest names the file and the worker sniffs the type.

## Requirements and limits
- Windows 7 SP1 or later, .NET Framework 4.6.2+ (or PowerShell 5.1 for the stub), read access to the database (`db_datareader`).
- Reads with `READ UNCOMMITTED`-free default isolation but in a single `SELECT` per table with a server-side cursor
  (streaming `SqlDataReader`, `SequentialAccess`), so memory stays flat for 50 GB.
- Resumable: per-table completion is recorded in `progress.json` next to the output; partial tables restart from zero
  (tables are independent). Uploads resume with the existing part protocol.
- No code or SQL is run on the customer database except `SELECT`.
- Code signing and an installer are required before it is given to customers (unsigned executables trigger SmartScreen).

## Stub
`Extract-RoxiraTables.ps1` is a working outline in PowerShell: lists tables, streams each to NDJSON.gz with the type
rules above, hashes files and writes the manifest. The **upload is deliberately not implemented** (a `TODO` marks where
the part protocol goes). Never run it against a production database before it has been reviewed and tested on a copy.
