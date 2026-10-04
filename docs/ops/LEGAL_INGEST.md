# Legal corpus ingest pipeline (LOCAL Qdrant only)

Tool: `scripts/legal/ingest_pipeline.py` (stdlib, Python 3.13). Allowlist: `config/legal_allowlist.json`.
Context: `docs/research/LEGAL_CORPUS_GAP_AUDIT_2026-10.md`. Tests: `src/ops/test_ingest_pipeline.py`.

The pipeline writes only to a Qdrant on `localhost`, `127.0.0.1` or `[::1]`; any other host is refused in
code for `apply` and `eval`. It never prints law text (counts, law names and row numbers only).
Production ingestion is NOT part of this tool.

## Owner commands (run from the repo root)

Staged data: `~/Backups/roxira-legal/phase1_20261004/` (JSONL).

1. Start a throwaway local Qdrant (data is lost with the container unless you add a volume):

       docker run --rm -p 6333:6333 qdrant/qdrant

2. Validate (counts only; exit 0 = all gates pass, 3 = at least one gate fails):

       python3 scripts/legal/ingest_pipeline.py validate ~/Backups/roxira-legal/phase1_20261004/phase1_new_laws.jsonl

3. Plan (deterministic point ids and batches; no writes):

       python3 scripts/legal/ingest_pipeline.py plan ~/Backups/roxira-legal/phase1_20261004/phase1_new_laws.jsonl --batch 64

   Re-running prints the identical `plan_sha256`; point ids are uuid5 over normalised law name + article_no +
   article_label, so re-applying the same rows overwrites instead of duplicating.

4. Apply into a NEW local collection (needs `sentence_transformers`; embeddings use
   `LIGHTRAG_QDRANT_EMBED_MODEL`, default `BAAI/bge-m3`, normalised cosine, the same setup as the app's
   Qdrant vector path in `legal_graph/lightrag_engine.py`). Use `--dry-run` first:

       python3 scripts/legal/ingest_pipeline.py apply <jsonl> --qdrant http://127.0.0.1:6333 --collection iran_laws_test_b1 --dry-run
       python3 scripts/legal/ingest_pipeline.py apply <jsonl> --qdrant http://127.0.0.1:6333 --collection iran_laws_test_b1

   Refused: non-local host; `iran_laws_v2` or an already existing collection (unless `--allow-existing`).

5. Evaluate retrieval against the local collection (runs `scripts/eval_legal_rag.py`; needs the app's Python
   dependencies and `data/eval/legal_rag_eval.jsonl`; its SQL layer is skipped with an error note when no local
   Postgres exists). If in-process import fails, run the manual command the tool prints:

       python3 scripts/legal/ingest_pipeline.py eval iran_laws_test_b1 --qdrant http://127.0.0.1:6333
       QDRANT_HOST=127.0.0.1 QDRANT_PORT=6333 python3 scripts/eval_legal_rag.py --collection iran_laws_test_b1

## Gates (any one blocks `apply`)

| Gate | Blocks when |
| --- | --- |
| missing_fields | law_name, article_no, article_label, text, status, is_active missing or empty |
| bad_article_no | article_no not `digits` or `digits-suffix` (e.g. `13-mokarrar`) |
| missing_source_tier / invalid_source_tier | tier absent, or not in official, secondary, unofficial |
| repealed | `is_active` false or status REPEALED/INVALID/ABROGATED/CANCELLED |
| duplicates | more than one row with the same (law_name, article_no, article_label) |
| bill_with_enacted_law | row is a bill (status BILL/DRAFT, law_type BILL, is_bill) and an enacted row or allowlist entry for that law exists |
| not_in_allowlist | law name not in `config/legal_allowlist.json` |

Warnings only (counted by `validate`): `missing_approval_date`, `suffixed_article_no`.

Known result on the staged v2 file (2026-10-04): 1,504 rows, all 17 laws on the allowlist, all `official`, but
99 rows share 39 duplicate keys, so `apply` blocks until the duplicates are resolved (disambiguate the label for
تبصره/مکرر rows, or drop true duplicates, in a reviewed new JSONL). All rows lack `approval_date` (warning).

## Approvals required before anything touches production

This tool cannot do any of these. Each needs the owner's explicit written yes (see audit section 6):

1. Written yes to ingest, naming the batch and the row count.
2. A full Qdrant snapshot of production taken first (owner runs or authorises it).
3. Target is a NEW collection (for example `iran_laws_v3`), never an in-place upsert into `iran_laws_v2`.
4. The pre-write verification report (validate counts, spot checks of 5 articles per law, eval vs the 63.3%
   citation-accuracy baseline) accepted by the owner and a lawyer.
5. Separate approval to switch the app's collection env var (`LIGHTRAG_QDRANT_COLLECTION`) and the
   citation-guard collection, with a rollback plan.
6. Lawyer sign-off on in-force status for new areas (audit batch 2 onward).
