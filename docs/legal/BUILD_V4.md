# BUILD_V4: build `iran_laws_v4` on the server (2026-10-13)

`scripts/legal/build_v4_on_server.sh` builds the next legal collection `iran_laws_v4` from
`iran_laws_v3` plus the staged files below, then evaluates both collections. It never switches
serving and never modifies `iran_laws_v3` (read-only + snapshot).

## How to run

```
cd /opt/roxira_platform
bash scripts/legal/build_v4_on_server.sh            # build + eval
bash scripts/legal/build_v4_on_server.sh --dry-run  # preflight + validate + merge + build_collection --dry-run
bash scripts/legal/build_v4_on_server.sh --rebuild  # delete ONLY iran_laws_v4 (typed confirmation on /dev/tty) and rebuild
```

## Inputs (applied lowest priority first)

1. `data/legal/staged/corpus_fill_2026-10-11.jsonl`
2. `data/legal/staged/corpus_fill_2026-10-11_replace_lease1376.jsonl`
3. `data/legal/staged/corpus_fill_2026-10-12_ekhtebar.jsonl`
4. `data/legal/staged/coverage_nezamat_2026-10-13.jsonl`
5. `data/legal/staged/qavanin_2026-10-13.jsonl`
6. `data/legal/staged/qavanin_laws_2026-10-13.jsonl`
7. `data/legal/staged/deregulation_board_2026-10-13.jsonl`
8. `data/legal/staged/circulars_2026-10-13.jsonl`

`*.repealed.jsonl` side files are never included (the script refuses them explicitly).

## Later input wins (dedupe)

When the same law+article+section appears in more than one input, the **later** input wins:
qavanin overrides nezamat, nezamat overrides the older ekhtebar rows. `dedupe_staged_rows.py`
merges the inputs in order, keyed on normalised `(law_name, article_no, section)`, and keeps the
last occurrence. It also reuses `ingest_pipeline.py`'s deterministic point ids, so the single
`apply` upserts over the copied v3 points instead of duplicating them.

Rows flagged `needs_review` are **still ingested**; the flag is preserved in the payload so the
lawyer review gate can find them.

## Eval and verdict

After building, the script runs the retrieval-only eval (`scripts/eval_chat_golden.py
--retrieval-only`, no LLM) for `iran_laws_v3` and `iran_laws_v4` over the golden sets
`retrieval_golden`, `retrieval_golden_new_laws`, `retrieval_golden_crawl_2026-10-12`, and prints
both **recall@5** values (the eval's "after relevance filter" number) plus one line:

| Verdict | Meaning |
|---|---|
| `V4_BETTER` | v4 recall@5 is higher than v3 across all golden sets |
| `V4_EQUAL` | v4 recall@5 equals v3 |
| `V4_WORSE` | v4 recall@5 is lower than v3 (inspect regressions before switching) |

The script also lists per-set regressions (cases v3 passed that v4 does not). Nothing is switched;
the switch/rollback commands for the owner are printed at the end but not executed.

## Tests

`scripts/legal/tests/test_dedupe_staged_rows.py` covers the dedupe key (last wins, section kept
distinct, ZWNJ/Persian-digit normalisation, `needs_review` preserved). Run:

```
python3 -m pytest scripts/legal/tests/test_dedupe_staged_rows.py -q
```
