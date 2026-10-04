# Persistent multi-source law acquisition (owner-run)

Tool: `scripts/legal/fetch_laws.py`. Targets and allow-list: `config/ekhtebar_laws.json`.
Tests: `src/ops/test_fetch_laws.py` (offline, fake transport). It wraps the verified
`fetch_ekhtebar.py` logic (`docs/ops/LEGAL_FETCH_EKHTEBAR.md`) as ONE source and reuses
`src/ops_fallback` (`Cooldown` circuit breaker, `run_with_fallback`, `search_with_fallback`;
see `docs/ops/FALLBACK_CHAINS.md`). All fetched text is `source_tier: unofficial`,
`UNVERIFIED`, `needs_review`: ingest rules in `docs/ops/LEGAL_INGEST.md` still apply.

## Source chain (per law, in order; first success wins)

| # | source | how | status of assumptions |
|---|--------|-----|-----------------------|
| 1 | `ekhtebar` | `/?s=` search, ranked by title similarity, PDF else page text | search verified by owner (cybercrime law, similarity 0.9); page/PDF selectors still generic |
| 2 | `qavanin` | `https://qavanin.ir/?q=<query>`, generic link ranking | UNVERIFIED search URL and markup; flagged `qavanin_selectors_unverified` |
| 3 | `wikisource` | `fa.wikisource.org/w/api.php` `list=search`, then `action=parse` | API shape is standard MediaWiki; law may be split into sub-pages (flag `possibly_index_or_partial_page`) |
| 4 | `discovery` | `search_with_fallback` (Brave/Exa/Tavily keys from the environment), keep only allow-listed domains, fetch top 3 | flag `found_by_search_engine`; page markup unknown |
| 5 | `archive` | web.archive.org availability API, then CDX, for page URLs that failed in 1-4 | snapshot may be stale: always flagged `archive_snapshot_may_be_stale` |

Per-source options per law (optional `sources` object in the config): `order`, `skip`, and
`ekhtebar|qavanin|wikisource|discovery` each with `query` (qavanin also `search_url` with `{q}`).

## Politeness and safety (enforced in code, covered by tests)

- robots.txt is read per host before any other request; unreadable robots.txt or a disallow means
  the URL is not fetched (reason `robots_denied`). Login/admin paths and hosts outside
  `allowed_domains` (plus the archive hosts) are refused.
- At least 3 s between requests to the same host (lower `--delay` is refused), per-request timeout,
  retries on network errors/5xx with exponential backoff and jitter.
- HTTP 403/429: no retry, no header change, no proxy. The host is left alone for the rest of the run
  and the chain moves on. The User-Agent is always the identifying Roxira one.
- Circuit breaker: `--max-failures N` (default 3) consecutive hard failures skip a source for the rest of
  the run. "Not found" and robots denials do not count as failures.
- Output is outside the repo (`--out` inside the repo is refused). Keys are read from the environment
  only by the existing search clients; the script never reads or prints them. Only summaries are printed.
- Cross-check: after a source succeeds, a second source is tried; normalised text is compared (hash,
  length ratio, article count). Disagreement sets `needs_human_check` with reason `sources_disagree`.
  `--no-cross-check` skips this (fewer requests). PDFs are not compared.
- Judgement call to confirm: the archive step also runs for pages that returned 403/429 (a public
  third-party copy, not a bypass of the host), but never for robots-denied URLs. Use
  `--skip-source archive` if you prefer to respect a block fully.

## Owner commands (dry-run first)

```bash
cd ~/Developer/roxira-platform
# 1. Locate only, no downloads, one law (nothing is written)
python3 scripts/legal/fetch_laws.py --dry-run --only cybercrime
# 2. Download one law, then read the outcome
python3 scripts/legal/fetch_laws.py --only cybercrime
python3 scripts/legal/fetch_laws.py --report
# 3. All laws (resumable: re-run the same command after an interruption or a block)
python3 scripts/legal/fetch_laws.py
# 4. Per-law result: source used, or "GAVE UP after trying: ..." with the next manual step
python3 scripts/legal/fetch_laws.py --report
# 5. Staging (same path as fetch_ekhtebar.py --to-staged; flagged laws need --include-flagged)
python3 scripts/legal/fetch_laws.py --to-staged
```

Default output: `~/Backups/roxira-legal/laws_<YYYYMMDD>/` (`manifest.json` with every attempt,
`<id>.txt|pdf`, `staged_ekhtebar.jsonl`). Use the same `--out` to resume on another day. For discovery,
export your search keys in the shell first (`BRAVE_SEARCH_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEYS`);
without them the discovery step reports `search_unavailable_or_no_keys` and the chain continues.
Other flags: `--skip-source NAME` (repeatable), `--retries`, `--timeout`, `--threshold`.

## Manifest entry

`status` is `done` or `gave_up`. `done` adds `source`, `source_url`, `file`, `sha256`, `needs_human_check`,
`reasons`, `cross_check`, `attempts`. Every attempt is `{source, step, status, reason, url, phase}`. A
`gave_up` law is retried on the next run; a `done` law is skipped. Staged rows carry the real source
(`source`, and `law_id` prefixed with the source name, e.g. `qavanin_cybercrime`).

## UNVERIFIED (check on the first dry run)

1. qavanin.ir search URL/markup (override per law with `sources.qavanin.search_url`).
2. Whether `fa.wikisource.org` and `archive.org` robots.txt allow `/w/api.php` and `/wayback/available`; if
   not, those sources report `robots_denied` and the chain continues (by design, nothing is overridden).
3. Whether search engines return allow-listed URLs for these Persian titles; rc.majlis.ir pages may need
   JavaScript (then text extraction fails and the law falls through to the archive or gives up).
4. The disagreement heuristic is coarse (length ratio 0.8, article count); it only raises a flag for a human.
