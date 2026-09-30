# CitationHallucinationGuard vs `iran_laws_v2` payloads (issue #117)

Sources: `smartjudge_module.py` (guard), `legal_graph/lightrag_engine.py`
(`qdrant_retrieve`, `active_point_filter`), `scripts/w6_ingest_dotic.py`
(payload = the JSONL record verbatim), line 1 of
`data/legal/dotic_articles_2026-09-22.jsonl`. No network or prod access.

## Change made
`CITATION_QDRANT_COLLECTION` now reads env `ROXIRA_CITATION_QDRANT_COLLECTION`
(default `iran_laws_bge_m3`, so no default behaviour change).

## Important finding
The guard's lookup (`_qdrant_citation_lookup` -> `qdrant_retrieve`) queries
`QDRANT_FALLBACK_COLLECTION`, i.e. env `LIGHTRAG_QDRANT_COLLECTION` (default
`iran_laws_bge_m3`). `CITATION_QDRANT_COLLECTION` is only used as a label in
the report (`qdrant_collection`) and in `record["source"]`. So the guard
already follows whatever `LIGHTRAG_QDRANT_COLLECTION` points to; the new env
only keeps the label honest and must be set to the same value.

## Payload keys needed by the guard
| Key | Used for | In v2 payload? |
|---|---|---|
| `is_active` | Qdrant filter (`must is_active==true`, or missing tolerated) and `_only_active` / row filter | Yes (`true`) |
| `text` | article-number regex match in `_qdrant_confirm` | Yes (starts "ماده 1 قانون مدنی: ...") |
| `title` | same blob | Yes ("قانون مدنی - ماده 1") |
| `article_no` | exact article lookup, dedupe key | Yes ("1", "N-mokarrar" for supplementary) |
| `law_name` | dedupe key, exact lookup by law | Yes |
| `summary`, `content`, `article` | optional blob fields | No (harmless: `title`/`text` suffice) |

Extra v2 keys (`law_id`, `article_label`, `status`, `chunk_index`, ...) are
ignored by the guard.

## Caveats
- Confirmation is a regex for the article number inside `title`+`text`; v2
  text always carries "ماده N", so matching works. Long articles are split
  into chunks (`chunk_index`); each chunk keeps `title`, so still matches.
- The vector model must match the collection (bge-m3 embeddings per the
  ingest script); the `_try_vector_search` path falls back to scroll otherwise.
- `-mokarrar` article numbers will not match a plain "ماده N" regex on
  `article_no`, but the text-blob match is what confirms; unchanged behaviour.

## Verdict
Safe to switch on prod: all keys the guard needs exist in v2 payloads and no
code change is required. Set `LIGHTRAG_QDRANT_COLLECTION=iran_laws_v2` (this
drives the actual lookup) and `ROXIRA_CITATION_QDRANT_COLLECTION=iran_laws_v2`
(label only) together. Not verified against live prod data.
