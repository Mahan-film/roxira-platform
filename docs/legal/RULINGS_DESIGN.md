# Judicial practice («رویه قضایی»): unity rulings and Administrative Court board rulings (track A3, gap L13)

Source: ekhtebar.ir only (WordPress REST, category 247 = آرا وحدت رویه, 794 = آرای دیوان عدالت اداری; ids verified live 2026-10-12).
Rows are `source_tier: unofficial`, `needs_review: true`. Lawyer sample check is still required before the rulings are called authoritative.

## Pipeline
1. `scripts/legal/fetch_unity_rulings.py run --raw-dir DIR` pages both categories (10 posts/call, 2 s apart, about 300 requests),
   parses deterministically (no LLM) and writes two NEW files plus a report:
   `data/legal/staged/unity_rulings_2026-10-12.jsonl`, `admin_court_board_rulings_2026-10-12.jsonl`, `unity_rulings_2026-10-12_report.json`.
   Category 247 mixes rulings with news/commentary posts; only posts whose title is «رأی وحدت رویه شماره N – تاریخ هیئت عمومی دیوان عالی کشور»
   become rows. Category 794 rows need a decision header (شماره دادنامه); `ruling_type` is `admin_court_annulment`, `admin_court_unity` or
   `admin_court_board_other` (a decision of a branch, not of the General Board).
2. `scripts/legal/ingest_rulings.py` converts rows for the ingest gates (pseudo law names, `article_no` = ruling number) and writes a NEW
   local collection `iran_rulings_v1` (bge-m3, same embedder as iran_laws_v3). Embedded text = title + subject + holding; the full ruling is
   in the payload (`full_text`).
3. `scripts/legal/build_rulings_collection_on_server.sh` (server): preflight, validate, build, snapshot, golden eval, prints switch and
   rollback commands. It never switches serving and never touches iran_laws_v2/v3.

## Retrieval (flag `SMARTJUDGE_RULINGS_COLLECTION`, default unset = off)
`output_apps/generated_modules/smartjudge/rulings_retrieval.py`. With the flag set to `iran_rulings_v1`, `_aquery_knowledge_graph_uncached`
starts the ruling search concurrently with the law search (no added latency beyond the slower branch), keeps hits with cosine >= 0.55
(`SMARTJUDGE_RULINGS_MIN_SCORE`), at most 3 (`SMARTJUDGE_RULINGS_LIMIT`), and appends them to the existing *precedents* list as rows with
`category: "RULING"`. Reused plumbing: `unified_precedents`, `source_filter` (citation matching by ruling number, now also «دادنامه»), the prompt
context. New: the chat prompt gets a separate «رویه قضایی» block (number, date, binding effect) and the response gets a `judicial_practice`
list (number, date, body, subject, excerpt, source_url). Any failure returns no rulings; laws are unaffected. Why a separate collection and
not rows in iran_laws_v3: rulings have no article structure, a different relevance profile, and must never be mixed into «مبنای قانونی».

Rollback: unset the flag and recreate `enterprise_app`.
