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
       from config/key_pool.yaml: agent-light-free, then the paid fallback agent-free-paid), JSON
       answer validated against the real columns
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
node --test                                                      # transform + certificate + discover-eval tests
```
`INSTALL postgres` must have been run once on the worker (it downloads the extension).

## Measured AI mapping accuracy (issue #397)

The AI step is wired to the key pool with the default groups read from `config/key_pool.yaml`
(`agent-light-free`, then the paid fallback `agent-free-paid`; no model id is hardcoded). The eval in
`services/migration_worker/eval/` records the model's answers once and replays them in CI, so the
offline test never calls a model:

```bash
cd services/migration_worker
node eval/run-eval.mjs            # replay the committed recordings, print the accuracy
LITELLM_API_KEY=... node eval/run-eval.mjs --record   # refresh the recordings (hub/Mac, not CI)
```

Measured over the committed recordings (12 mappable synthetic tables across the four presets,
plus 3 unmappable ones):

| metric | value |
|---|---|
| mappable tables correct (target + all required fields) | 11 / 12 = **0.92** |
| model group used | `agent-light-free` (fallback `agent-free-paid`) |
| calls to the model | 15 (one per case) |
| accepted hallucinated columns | 0 |
| unmappable tables ending `needs-review` | 3 / 3 |

`eval.test.mjs` gates on accuracy >= 0.8, zero accepted hallucinated columns and all unmappable
tables ending `needs-review`. The one recorded miss is a real hallucination (`date` -> `doc_date`,
a column that does not exist) that `validateAnswer` sent to `needs-review`. Recordings are masked
with `maskSample` and the runner refuses to write a phone number or e-mail.

## Tested (synthetic data only) and not proven
9 transform tests with real DuckDB: normalisation (JS and SQL agree), Jalali dates incl. leap years, manifest validation, the full
pipeline on Holoo-like tables (Arabic letters, Persian-digit amounts, bad cells, a table only the "AI" can place with a fake
client), tamper and row-count mismatch, 300 000 rows under `memory_limit=64MB`, AI guardrails, masking and model fallback
order, DDL and loader dry run. Plus the replayable discover eval above.

Not proven here:
- **Load into PostgreSQL**: no Postgres on this Mac; the statements are generated and checked, not executed.
- **50 GB**: only 300 k rows / 64 MB limit were run. DuckDB spills to `temp_directory`; run a real 5-10 GB export first.
- **A live model on new vendor schemas**: the recordings cover the eval's synthetic tables; a real export may use
  column names none of the cases or synonyms contain. Re-run `--record` after adding cases for it.
- Date columns in a real Holoo export may be Jalali text, Gregorian text or both; only those spellings are handled.
