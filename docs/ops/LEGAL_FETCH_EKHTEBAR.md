# Fetching laws from ekhtebar.ir (owner-run)

Tool: `scripts/legal/fetch_ekhtebar.py` (stdlib + certifi). Targets: `config/ekhtebar_laws.json`.
Tests: `src/ops/test_fetch_ekhtebar.py` (offline). Next step after this: `docs/ops/LEGAL_INGEST.md`.

ekhtebar.ir is an UNOFFICIAL aggregator (`docs/research/LEGAL_SOURCES_PLAN_2026-10.md`): rows are tagged
`source_tier: unofficial`, `status: UNVERIFIED`, `needs_review: true`. It is a locator and cross-check, not a
source of record.

## What it does and does not do

- Honours `robots.txt` (read first; if unreadable, it refuses to crawl), sends a clear User-Agent, waits at
  least 3 s between requests (lower `--delay` is refused), retries with backoff, stops after 5 consecutive
  failures, never follows `wp-admin` / login / account links or off-site redirects.
- Searches `https://www.ekhtebar.ir/?s=<query>`, ranks results by title similarity, downloads a linked PDF if
  one exists, otherwise saves the page's law text. Resumable through `manifest.json`.
- Data goes OUTSIDE the repo (default `~/Backups/roxira-legal/ekhtebar_<YYYYMMDD>/`; an `--out` inside the
  repo is refused). Never commit it. Output printed is summaries only.
- It cannot ingest anything. Ingest still needs the owner's written approval and the checks in
  `docs/ops/LEGAL_INGEST.md`. Lawyer sign-off is required for the law lists (which instrument, in-force status,
  amendments), per `LEGAL_SOURCES_PLAN_2026-10.md`. New law names must be added to
  `config/legal_allowlist.json` after that review, or `ingest_pipeline.py validate` will block them.

## UNVERIFIED assumptions (written offline, never tested against the live site)

Check these on the first dry run; adjust the script if results look wrong:

1. Site search is `/?s=<query>` and returns result links inside `h1-h4` headings (falls back to any link).
2. Law text lives in an `entry-content` / `post-content` container or an `<article>` (falls back to body).
3. A PDF is a plain `<a href="...pdf">` on the same host (an external or script-driven PDF is not found).
4. Law pages include only the statute; if the page also carries comments or commentary, they end up in the text
   (the lawyer must not accept that into the corpus).
5. Article markers start a line («ماده N», «ماده N مکرر», «ماده واحده»). Pages that put a marker mid-line are
   not split and show as `no_articles_found` or gaps in `missing_numbers`.

## Owner commands (repo root; run from your own network)

1. List targets (no network):

       python3 scripts/legal/fetch_ekhtebar.py --list

2. Dry run first (search only, prints the chosen candidate per law; writes nothing). Use `--only ID` to try one:

       python3 scripts/legal/fetch_ekhtebar.py --dry-run --only cybercrime
       python3 scripts/legal/fetch_ekhtebar.py --dry-run

   Lines marked `FLAG` have a low title similarity (< 0.6) or several close candidates: look at them by hand.

3. Download (resumable; re-run the same command after an interruption):

       python3 scripts/legal/fetch_ekhtebar.py
       python3 scripts/legal/fetch_ekhtebar.py --only ecommerce --out ~/Backups/roxira-legal/ekhtebar_test

   Exit code 4 means it stopped after consecutive failures (rate limit or block): wait, then re-run.
   Review `manifest.json` (chosen match, candidate list, sha256, `needs_human_check`).

4. Convert text to staged JSONL (PDFs need `pdftotext`, `brew install poppler`; without it they are reported
   as skipped). Laws with `needs_human_check` are skipped unless `--include-flagged`:

       python3 scripts/legal/fetch_ekhtebar.py --to-staged
       python3 scripts/legal/fetch_ekhtebar.py --to-staged --include-flagged

   Result: `<out>/staged_ekhtebar.jsonl`, plus a summary (articles per law, missing article numbers, skipped).

5. Counts-only validation (expect the `not_in_allowlist` gate to block until the lawyer/owner approves the law
   names, and a `missing_approval_date` warning on every row):

       python3 scripts/legal/ingest_pipeline.py validate ~/Backups/roxira-legal/ekhtebar_<date>/staged_ekhtebar.jsonl

## Staged row format (matches `ingest_pipeline.py` REQUIRED_FIELDS)

`law_id, law_name (= title_fa from the config), law_type LAW, article_no ("13" or "13-mokarrar"),
article_label ("ماده 13"), approval_date null, status UNVERIFIED, is_active true, source_url, source ekhtebar.ir,
source_tier unofficial, content_hash, chunk_index, text, title, category, needs_review true, review_reasons`.
Digits are normalised to 0-9 (also Arabic yeh/kaf to Persian forms). Text before the first article is dropped (the
count is reported). A repeated article number gets a label like `ماده 2 (2)` and a reason, so the duplicate gate
is not tripped silently.

Ambiguities left to a human (not decided by the script):

- `is_active: true` is only a placeholder because the gate requires the field. Real in-force status (including
  repeals such as the 1403 invalid-laws list for commerce) is unverified; `status` is `UNVERIFIED`.
- `approval_date` is always null (the page's dates are not parsed), so every row carries the warning.
- `law_name` must equal an allowlist name after normalisation; the config titles may differ from existing
  allowlist spellings.
- Notes (تبصره) stay inside their article text; «ماده واحده» is mapped to `article_no` 1.
- Which instrument is meant for guild violations, computer guild system and lawyers' discipline is a lawyer
  decision; their search results are best-effort.
