# Law watch: keeping the Smart Judge corpus current (design + P0)

> **Update 2026-10-12:** SMTP settings are no longer stored in the LaunchAgent plist; `law_watch.py` reads them at runtime from `~/Secrets/roxira/roxira.env` (override `ROXIRA_SECRETS_ENV`), skipping e-mail if absent. Taxonomy adds `law_text` (library page of an old law, never ingest-eligible) and `resolution` (category 24); `bill` wins over law categories (category 1890, titles starting طرح/لایحه, or containing پیش‌نویس). Sections 2 and 8 below predate this.


Status: P0 implemented (`scripts/legal/law_watch.py`), P1/P2 designed. All content is `unofficial`, UNVERIFIED, and
`proposed` until a human approves it. Source rule from the owner: **ekhtebar.ir is the only source.** Never
rc.majlis.ir, qavanin.ir, dotic.ir or anything else.

## 1. Sources (verified live 2026-10-12, from the owner's network)

ekhtebar.ir is WordPress and reachable only from Iranian IPs, so the fetch job runs on the owner's Mac with the VPN off.

| endpoint | result |
|---|---|
| `/feed/` | 200 RSS, latest ~10 posts only (36 KB). Good as a cheap "anything new?" probe, not for catch-up |
| `/wp-json/wp/v2/posts?per_page=..&modified_after=..&categories=..&orderby=modified&order=asc` | 200 JSON; `X-WP-Total` 19,819 posts. This is the poll endpoint. `modified_after` catches new posts and edits of old ones |
| `/wp-json/wp/v2/categories?per_page=50&page=N` | 200, 3 pages (~116 categories). Intermittent `IncompleteRead` on big responses: retry |
| `/wp-json/wp/v2/posts/<id>?_fields=content` | full body for one post |
| `/robots.txt` | only `Disallow: /wp-admin/` |

Practical notes: list requests that include `content` are 1.6 MB per 10 posts and break with `IncompleteRead`. The
poller therefore lists without content (20 posts per page) and fetches the body per post, only for non-news items.
Rate: 1 request per 2 s (`MIN_DELAY`), retries with backoff, host allow-list = `www.ekhtebar.ir`, `ekhtebar.ir`.
On the Mac, run it with Bash `allowed_domains: ["www.ekhtebar.ir", "ekhtebar.ir"]`.
`urllib` needs `certifi` or the system store (curl in the Claude sandbox failed TLS verification; Python+certifi works).

### Category map (ids are ekhtebar's; verified)

| ekhtebar category (id) | change type hint |
|---|---|
| آرای دیوان عدالت اداری (794) | annulment |
| آرا وحدت رویه (247) | unity_ruling |
| رای اصراری (1112) | judicial_ruling |
| مصوبات (24) | resolution (law, cabinet) |
| آیین نامه ها (854), اساسنامه (2164), مصوبه شورای عالی شهرسازی (2113) | regulation |
| بخشنامه ها (1072) | circular (ministries: بیمه مرکزی, مالیات, صمت, ثبت ...) |
| متن قوانین (127), مواد قانونی (5460) | law_text (new law / amendment / repeal by title) |
| طرح و لایحه (1890) | bill (never ingested) |
| نظریه های مشورتی (826), نظریه رئیس مجلس (1148), نظریه شورای نگهبان (4846) | advisory_opinion |
| رویه قضایی (1875), نشست‌های قضایی (5525) | judicial_procedure |
| سیاست های کلی (1079) | policy |
| اخبار قوه قضائیه (503), مجلس (539), دولت (1138), شورای نگهبان (1130), مجمع تشخیص (4701) | news |

Not polled: exam, university and job categories. Ministry circulars are not a separate category: they arrive under
بخشنامه ها / آیین نامه ها and the issuer is detected from title/body (P0: keyword list).

## 2. Change taxonomy

`change_type`: new_law, amendment, repeal, annulment, unity_ruling, cabinet_decision, regulation, circular,
judicial_procedure, judicial_ruling, resolution, advisory_opinion, bill, policy, news, other.
`effect` (what it does to the corpus): adds, modifies, repeals, annuls, informs.
`fresh`: false when the post is old and ekhtebar merely edited its page (live data: 127 of 223 items in 30 days).
Such items are never treated as a new act; they only trigger "re-check the stored text of that law".

## 3. Data model

Change record (one JSONL line, `record_type: "law_change"`, written to `data/legal/staged/law_watch_<date>.jsonl`):
`change_id` (`ekhtebar:<post_id>`), `source_url`, `title`, `published_at`, `modified_at`, `change_type`, `effect`,
`issuer`, `approval_date` (jalali, if found in body), `law_refs[] {law_name, article_nos, confidence, evidence}`,
`target_law_raw` (law named in the title even when it is not in our corpus), `classification {method rules|llm,
confidence, signals}`, `needs_llm`, `fresh`, `ingest_eligible`, `proposed_actions[]`, `text` (legal types only,
12k chars), `text_sha256`, `status: "proposed"`, `source_tier: "unofficial"`.

Article versions (P1, in the Qdrant payload and in the staged article rows; fields extend the existing schema, so
`ingest_pipeline.py` keeps working):

| field | meaning |
|---|---|
| `status` | `VALID` (active) / `AMENDED` (the active row is an amended version, text is the new one) / `REPEALED` / `ANNULLED` |
| `is_active` | false for REPEALED/ANNULLED and for every superseded old version (this is what retrieval already filters on) |
| `valid_from`, `valid_to` | jalali dates; `valid_to` set when superseded, repealed or annulled |
| `superseded_by` | `point key` (law+article+version) of the newer row, or the repealing law |
| `version` | 1,2,3 ... per (law, article) |
| `change_id` | link back to the law-watch record that caused the change |
| `amended_on` | already exists; the date of the latest amendment (used for the warning) |

`proposed_actions` (P0 output, executed in P1 after approval): `mark_repealed`, `mark_annulled`,
`add_new_version_and_supersede`, `review_new_text`, `fetch_and_add_new_law`, `recheck_corpus_text`.

## 4. Pipeline

fetch -> dedupe -> classify -> link -> stage "proposed" -> human approval -> ingest into the next collection -> eval -> switch.

1. **poll**: ekhtebar posts with `modified_after=cursor`, ascending by `modified`. Cursor and items are stored in
   `~/.roxira/law_watch/` (outside the repo). A page failure never advances the cursor.
2. **dedupe**: by post id; a changed `modified` is a new revision (`is_edit`). Staged ids are remembered, so a
   change is staged once.
3. **classify (rules)**: title patterns first (ابطال, وحدت رویه, نسخ/لغو, تصویب‌نامه, اصلاح/الحاق, بخشنامه,
   آیین‌نامه, طرح/لایحه, نشست قضایی, نظریه), then category hints. Conflicting signals or an amend/repeal without a
   target law set `needs_llm`.
4. **link**: longest corpus law name (from `config/legal_allowlist.json`) found in the title (high) or first 2,500
   chars of the body (medium); token coverage for names of 2+ words; article numbers via `ماده/مواد/تبصره` regex.
   P1: map `target_law_raw` to corpus laws through an alias table and a Qdrant lookup of (law, article).
5. **optional LLM, ambiguous only**: `classify --llm`. Model comes from `config/models.yaml` through
   `model_registry.models_for("cheap", sensitive=False)` (DeepSeek V4.1 Flash first), `reasoning: {"enabled": false}`,
   max 120 output tokens, ~1.5k chars of public text. Daily spend is tracked in `llm_budget.json` and capped at
   $0.02 (about 40 calls). LLM-classified rows are never `ingest_eligible`. No Gemini Pro, never in the fetch path.
6. **stage**: a new file each run (`law_watch_<date>.jsonl`, `_2`, ... if it exists, opened with mode `x`). No
   existing file in `data/` is touched. News is excluded from the staged file and appears only in the digest.
7. **approval gate**: the owner/lawyer reviews the digest and the staged file, and sets `status` to `approved` (or
   deletes the row). P1 adds `law_watch.py approve <change_id>...` which writes `law_watch_<date>.approved.jsonl`.
   Nothing reaches the server unapproved.
8. **ingest to the next collection** (P1): approved `add_new_version` rows become article rows (text fetched from the
   ekhtebar page with `fetch_laws.py` + `corpus_fill.py stage`, same normalisation), then
   `build_collection.py --src iran_laws_vN --dst iran_laws_vN+1` copies vectors, flips old versions to
   `is_active=false` / `valid_to` / `superseded_by` (payload update, no re-embedding), and `ingest_pipeline.py apply`
   adds the new rows. Repeals are payload-only flips. This reuses the audited runbook of `CORPUS_AUDIT_2026-10-11.md` §5.
9. **eval**: `eval_chat_golden.py --retrieval-only` on old and new collection plus per-change golden cases
   (one query per amended/repealed article). Switch `LIGHTRAG_QDRANT_COLLECTION` only if nothing regresses; rollback
   = set the variable back.

## 5. How chat must treat versions

What exists today: `lightrag_engine.py` filters `is_active == True` (and tolerates a missing field), so repealed rows
are never cited, and `prompt_library.py` already tells the model to prefer the latest amendment. Gaps this design closes:

1. **Prefer the current version**: only the newest version has `is_active=true`; older versions are payload-flipped, so the
   existing filter already yields the current text. Never keep two active versions of one (law, article).
2. **Warn when amended**: if a retrieved row has `status=AMENDED` or `amended_on` set, the context block adds
   `(اصلاح‌شده در <amended_on>)` and the system prompt requires the answer to say the article was amended and to
   cite the date. P1 change in `lightrag_engine` payload rendering + `prompt_library`.
3. **Warn when repealed**: when the user's question names an article that exists only as `REPEALED/ANNULLED`
   (detected through the existing article-reference extractor), run a second Qdrant query with `is_active=false` and
   `valid_to` set, and answer "این ماده در تاریخ ... نسخ/ابطال شده است" with the `superseded_by` law. Repealed rows stay
   unreachable for normal retrieval. Until then the user simply gets no citation, which is safe but unhelpful.
4. **Time-aware answers** (P2): for disputes about past events, filter by `valid_from <= event date <= valid_to`.
5. A "recent changes" footer for laws touched in the last 90 days (from the change records) is P2.

## 6. Scheduling (Mac, launchd)

`deploy/launchd/ir.roxira.lawwatch.plist`: `StartInterval` 21600 (6 h) plus `RunAtLoad`. launchd runs a job
missed during sleep once the Mac wakes. The job is idempotent and cursor-based, so an offline day or a VPN-on period
just means "ekhtebar not reachable, cursor kept" (exit 0, `last_poll_ok=false`), and the next run catches up from
the saved `modified` cursor; `MAX_PAGES_PER_RUN=40` (~800 items) bounds a run and the rest follows next time.
Install (not loaded by this change): `scripts/legal/install_law_watch_mac.sh` renders the plist into
`~/Library/LaunchAgents/` and prints the `launchctl bootstrap` command. Logs: `~/.roxira/law_watch/{out,err}.log`.
Future Iranian VPS: run the same script there with `LAW_WATCH_STATE_DIR` set and push the staged file by scp; nothing
else changes.

## 7. Transfer to the server

Option A (default): `scp data/legal/staged/law_watch_<date>.approved.jsonl 5.75.200.67:/opt/roxira_platform/data/legal/staged/`
after approval, then run the existing validate / build_collection / apply / eval commands from the audit runbook inside the
app image (owner approval for every production write). Option B: commit the approved file in a PR (the repo already
versions `data/legal/staged/`); CI runs `ingest_pipeline.py validate` offline. Raw polled items stay on the Mac.

## 8. Daily digest

`law_watch.py digest` writes `~/.roxira/law_watch/digests/digest_<date>.md` (counts per type, then per-type lists
with linked law/article, `[needs review]` flags and ekhtebar links). `run --email` (the plist) sends it through the
existing `scripts/ops/monitor/monitor_common.send_email` with `BACKUP_SMTP_USER/PASS` and `BACKUP_NOTIFY_TO` set in
the plist `EnvironmentVariables`; placeholders left as `__SET_ME__` skip mailing. P1: send once a day, bilingual like
`selfimprove/report.py`, plus a short "law changes last 24 h" section in the daily self-improve report on the server
(the Mac pushes `digest_<date>.md` by scp).

## 9. Failure modes

| failure | handling |
|---|---|
| ekhtebar unreachable (VPN on, Iran outage) | cursor kept, exit 0, retry next interval; digest warns if no successful poll for 24 h (P1) |
| `IncompleteRead` on big responses | no `content` in list calls, 4 retries with backoff, body fetch skipped (empty text) on failure |
| ekhtebar markup/categories change | category ids re-verified with `/categories`; unknown categories fall back to title rules; P1 `check-categories` subcommand |
| false classification (e.g. a circular title containing "لغو") | everything is `proposed`; low confidence rows flagged; never auto-ingested |
| old page edited by the site, looks "new" | `fresh=false` -> `recheck_corpus_text` only |
| unofficial source error or wrong text | `source_tier unofficial`, lawyer sign-off, eval gate; text is shown in the record for review |
| duplicate staging | `staged_ids.json` + `open(..., "x")` |
| Mac asleep/off for days | catch-up from cursor (page cap spreads very large backlogs over runs) |
| LLM cost or leak | cap $0.02/day, public text only, no key in code (`OPENROUTER_API_KEY` env), ids from `config/models.yaml` |
| WAF/ban | 2 s spacing, identifying UA, no retry storms; stop and report on repeated 403/429 (P1: explicit stop) |

## 10. Phases

- **P0 (done)**: poll / classify / stage / digest / run, launchd plist + installer, tests, live 30-day run, this design.
- **P1**: `approve` subcommand; alias table and Qdrant (law, article) lookup for linking; per-law body fetch + staged
  article rows with `valid_from/valid_to/superseded_by/version`; payload-flip tooling in `build_collection.py`; chat
  warnings (amended/repealed) and golden cases; 24 h staleness alert; scp helper; daily e-mail wired to the server report.
- **P2**: time-aware retrieval, repealed-article answers from a small `iran_law_changes` collection, per-ministry
  issuer rules and category discovery, optional Iranian VPS runner, dashboard of pending approvals.
