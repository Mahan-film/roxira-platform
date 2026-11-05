# Schema discovery eval (issue #397, phase 2 of #354)

Measures how well the AI schema-discovery step (`services/migration_worker/discover.mjs`) maps
Iranian vendor tables to the Roxira target model, and makes the measurement replayable so CI never
calls a model.

## Layout

- `cases.json` — 12 synthetic mappable tables (3 each for the holoo, sepidar, mahak and
  hamkaran-rahkaran presets in `e2e/fixtures/import-presets/`) plus 3 deliberately unmappable
  tables. Every case holds the source `table` (name + columns), two sample rows, and the expected
  `{ target, fields }`. Synthetic data only; phone-like samples are masked before a model sees them.
- `run-eval.mjs` — the runner. `--record` calls the real model through the key pool and writes one
  recording per case; with no flag it replays the recordings and prints the accuracy.
- `recorded/<case>.json` — the raw model reply for one case, plus the group that answered and the
  number of calls. `_summary.json` is the manifest of the recorded run.

## Record (on the hub/Mac, not in CI)

```bash
cd services/migration_worker
LITELLM_API_KEY=... MIGRATION_LLM_URL=http://127.0.0.1:4000/v1/chat/completions \
  node eval/run-eval.mjs --record
```

The client tries the groups from `config/key_pool.yaml`: `agent-light-free` first, then the paid
fallback `agent-free-paid` (no model id is hardcoded — `defaultModelGroups()` reads the group and its
`fallback:` chain from the file). `MIGRATION_LLM_MODELS` overrides the group list. The runner refuses
to write a recording that still contains a phone number or an e-mail.

## Replay (CI, offline)

```bash
cd services/migration_worker && node eval/run-eval.mjs   # prints accuracy, no network
node --test                                              # eval.test.mjs replays and asserts thresholds
```

`eval.test.mjs` requires, over the committed recordings:

- mapping accuracy >= 0.8 on mappable tables (target correct **and** every required field mapped),
- 0 accepted hallucinated columns (a recording that names a non-existent column goes to
  `needs-review`, never to a mapping),
- every unmappable table ends as `needs-review`.

## Measured (committed recordings)

| metric | value |
|---|---|
| mappable tables correct | 11 / 12 (0.92) |
| calls to the model | 15 (one per case) |
| model group used | `agent-light-free` (fallback `agent-free-paid`) |
| accepted hallucinated columns | 0 |
| unmappable tables ending `needs-review` | 3 / 3 |

The one miss (`sepidar-vouchers`) is a recorded hallucination: the model mapped `date` to the
non-existent `doc_date` column, and `validateAnswer` rejected the whole answer to `needs-review`.
Re-run `--record` to refresh the files and the numbers.
