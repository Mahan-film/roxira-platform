# R22 watcher -> Smart Judge corpus: handoff format

Date: 2026-11-23. Refs #1279 (watcher), #996 (T257 corpus growth), #965 (hub). Owner decision of 2026-11-23: collect all public legal
sources, then analyse and filter (see `docs/legal/SOURCE_TOS_CHECKLIST.md`).

## What the watcher produces

`~/.local/state/roxira-source-watcher/staged/watcher_YYYY-MM-DD.jsonl` (append-only, one file per day, written and fsynced before the state
database is updated, so rows can repeat after a crash: dedupe on `doc_id` + `content_sha256`). One JSON object per **new or changed** item:

| field | meaning |
|---|---|
| `source`, `source_tier` | config id (`rrk`, `dotic`, ...) and `official` |
| `url`, `doc_id` | page URL and a stable hash of it |
| `title`, `text` | listing title; `text` is the page text of the first `--details N` new/changed items per source per run (else empty) |
| `doc_type`, `issuer` | from config (`law`, `court_ruling`, `circular`, ...); `number` and `date` are null (not parsed yet) |
| `content_sha256`, `state` | hash of the normalised content; `new` or `changed` |
| `fetched_at` | UTC time |
| `staging_status`, `needs_review` | always `proposed` / `true` |

Same row contract as `scripts/legal/iran_relay.py`. State is in `state.db` (SQLite: `items`, `hosts`, `runs`).

## Proposed path into the Smart Judge corpus (hub-only, B1)

1. The hub (not this watcher) copies day files out of `staged/` to the corpus staging area.
2. Filter pass (analysis, owner's "then filter"): drop rows with empty `text`, news and navigation links, near-duplicates by `content_sha256`;
   keep `law`, `court_ruling`, `circular`, `cabinet_decision`, `judiciary` first.
3. Split per article/ruling with the existing splitters (`split_rc_law_articles.py`, `rulings_delta.py`), fill `number`/`date`, keep `needs_review`.
4. Ingest only with `--allow-proposed` after the review desk; every answer that cites such a row says the source is unreviewed.

ASK-HUB: #965 - please decide (a) who copies `staged/*.jsonl` into the corpus staging area and how often, (b) whether rows with empty `text`
(listing only) are fetched in a second detail pass by the watcher or dropped, and (c) the review rule for `official` rows from news-style sites
(`dotic`, `tax`, `mimt`) before they count as legal knowledge. The watcher does not write to any corpus or vector store.
