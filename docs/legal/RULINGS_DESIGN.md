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

## Keeping the collection current: the delta loop
The full crawl is a one-off, so new Supreme Court unity rulings (after number 882) arrive through `law_watch` instead:
1. **Mac `scripts/legal/law_watch.py`** (every 6 h) stages ekhtebar posts as `data/legal/staged/law_watch_*.jsonl`; unity rulings are
   `change_type: unity_ruling` records (a short version first, an edited long version later, text capped near 12000 chars).
2. **Relay PR** brings those staged files to the repo (see `docs/legal/IRAN_RELAY.md`).
3. **`scripts/legal/rulings_delta.py`** (offline, deterministic; `--dry-run` prints a summary) keeps the newest version per post, parses
   number/date, extracts the holding (after «ج) رأی وحدت رویه شماره N»; a short version is the bare holding; else the excerpt with
   `needs_review: true`), drops every ruling already in `unity_rulings_*.jsonl` / `admin_court_board_rulings_*.jsonl` and writes
   `data/legal/staged/unity_rulings_delta_<date>.jsonl` in the corpus schema. News posts without a ruling number (for example an
   announcement of a new ruling) are listed as skipped; the numbered post usually follows within days and a later run picks it up. Commit the delta file via PR.
4. **`scripts/legal/upsert_rulings_delta_on_server.sh [--dry-run] [--include-review] FILE...`** (server): snapshot, then
   `ingest_rulings.py apply --allow-existing` into the existing `iran_rulings_v1` (deterministic point ids, so reruns are idempotent;
   `needs_review` rows are skipped unless `--include-review`). It still requires `pwd == $REPO` (env, default `/opt/roxira_platform`)
   and a clean git tree.

### The loop is now automatic (owner approval 2026-11-15)
Relay PRs from `relay/<date>` that only add `data/legal/staged/*.jsonl` are queued by `scripts/dev/hub_autopilot.sh` (green CI, MERGEABLE;
a duplicate `change_id` flagged by the desk is expected: law_watch files are append logs, consumers keep the newest `modified_at`).
On the server a systemd timer (`roxira-rulings-update.timer`, every 6 h with a random delay, `Persistent=true`) runs
`scripts/legal/rulings_auto_update.sh`:
* it uses its **own** checkout `/opt/roxira_legal_worker` (fast-forwarded to `origin/main` each run); the production checkout
  `/opt/roxira_platform` is never pulled or modified by it;
* it runs `rulings_delta.py` into `/var/lib/roxira/rulings/out` and compares the rows with `/var/lib/roxira/rulings/upserted.json`
  (ruling_id -> sha256 of holding+text); `needs_review` rows are held back;
* only when something is new it calls the upsert script (`REPO=/opt/roxira_legal_worker`, all safety checks kept, Qdrant snapshot first)
  and then records the rows in the state file. A failed upsert leaves the state untouched, so the next run retries;
* runs never overlap (`flock`); exit 0 when nothing is new. New rulings are published with `source_tier: unofficial` in the payload.

**Install (owner, once, as root on the server):** `cd /opt/roxira_platform && sudo bash scripts/legal/install_rulings_timer.sh`
(idempotent; creates state dir and worker checkout, runs one `--dry-run`, enables the timer, prints `systemctl list-timers`).
Remove with `... install_rulings_timer.sh --uninstall`.

**Check:** `journalctl -u roxira-rulings-update -n 100 --no-pager`; `systemctl list-timers roxira-rulings-update.timer`; run now with
`systemctl start roxira-rulings-update.service`; state: `cat /var/lib/roxira/rulings/upserted.json`.

**Roll back:** every write is preceded by a Qdrant snapshot of `iran_rulings_v1` (name printed in the journal, stored in
`roxira_qdrant_prod:/qdrant/storage/snapshots/iran_rulings_v1/`). Restore it via the Qdrant snapshot-recovery API, then delete the
affected ids from `upserted.json` (or stop the timer with `systemctl disable --now roxira-rulings-update.timer`) so they are not
re-applied. Switching retrieval off entirely: unset `SMARTJUDGE_RULINGS_COLLECTION` (see above).
