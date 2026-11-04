# Migration transform: DuckDB, Parquet, schema discovery, typed staging (phase 2, step 2)

Issue #354. Input is the manifest + NDJSON.gz written by the `.bak` pipeline or the Windows extractor
(`docs/ops/BAK_PIPELINE.md`). Code: `services/migration_worker/` (Node ESM, `@duckdb/node-api`, no build step).
It is a separate process on the worker box, not part of the 900 MB API container.

```
manifest.json + tN.ndjson.gz
  1. verify sha256 and row counts                      transform.mjs   (a damaged or edited file is refused)
  2. normalise to Parquet, all columns as text         ی/ک for ي/ك/ى, tatweel, NBSP, spaces   (normalize.mjs)
  3. schema discovery                                   discover.mjs
       heuristic over Persian/English column names  ->  mapped | ambiguous | unmapped
       AI for the rest: table name + columns + 5 masked sample rows, free model first (LiteLLM groups
       agent-light-free, then agent-free-paid), JSON answer validated against the real columns
  4. typed staging                                      stage.mjs
       amounts: Persian/Arabic digits, ٬ ، , separators, (1,000), trailing minus -> DECIMAL(28,4)
       dates: Jalali (1403/05/12, ۱۴۰۳-۰۵-۱۲, 14030512) and Gregorian -> ISO, leap-year aware
       rows that cannot be typed go to rejects/<target>.parquet with src_table + src_row (never silently dropped)
       invariant checked per table: staged + rejected = source rows
  5. load into mig_<tenant uuid> with COPY BINARY       DuckDB postgres extension; DDL has tenant_id + FORCE RLS
```

Target model (`catalog.mjs`): `gl_accounts`, `gl_trial_balance`, `gl_lines`, `parties`, `open_items` (AR/AP), `cheques`,
`items`, `stock_moves`. These are what the reconciliation certificate (#355) needs. Vendors do not publish schemas, so the
catalog holds hints, not fixed column names.

## Decisions worth knowing
- **AI is advisory.** A model answer is accepted only if every column exists, required fields are present and no column
  is used twice; confidence is capped at 0.9; everything else is `needs-review` for the customer (the existing review
  step). The heuristic runs first, so most tables never reach a model. Samples are cut to 40 chars and mobile numbers and
  e-mails are masked. The LiteLLM key is read from `LITELLM_API_KEY` and never logged.
- **Everything is text until the target is known**, so no amount passes through a double and no value is guessed.
- **Optional dates that do not parse stay NULL with the raw text kept**; an unparsable amount or quantity rejects the row.
- **Dates are converted in JS on the distinct values only** and joined back in SQL, so a 50 GB table is never read into JS.

## Run
```bash
cd services/migration_worker && npm ci
node cli.mjs --manifest-dir <dir> --out <dir> [--ai]            # transform + discover + stage (no database)
node cli.mjs --print-ddl --tenant <uuid> | psql ...            # review and apply the staging DDL (reviewed PR/ops step)
MIGRATION_PG_DSN=... node cli.mjs --manifest-dir <dir> --out <dir> --tenant <uuid> --load
node --test                                                      # 9 tests
```
`INSTALL postgres` must have been run once on the worker (it downloads the extension).

## Tested (synthetic data only) and not proven
9 tests with real DuckDB: normalisation (JS and SQL agree), Jalali dates incl. leap years, manifest validation, the full
pipeline on Holoo-like tables (Arabic letters, Persian-digit amounts, bad cells, a table only the "AI" can place with a fake
client), tamper and row-count mismatch, 300 000 rows under `memory_limit=64MB`, AI guardrails, masking and model fallback
order, DDL and loader dry run.

Not proven here:
- **Load into PostgreSQL**: no Postgres on this Mac; the statements are generated and checked, not executed.
- **50 GB**: only 300 k rows / 64 MB limit were run. DuckDB spills to `temp_directory`; run a real 5-10 GB export first.
- **A live model**: the AI step was tested with a fake client; free-model JSON compliance is unmeasured.
- Date columns in a real Holoo export may be Jalali text, Gregorian text or both; only those spellings are handled.
