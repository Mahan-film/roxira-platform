# R22: Source watcher for Iranian legal feeds and Setad auctions

Date: 2026-11-21. Refs #1156, #996 (T257), #965, #592. Research and design only: nothing is built or installed, no key was read.

## 0. Summary

- **Extend, do not replace.** The repo already has a polite, tested, stdlib fetch stack: `scripts/legal/law_watch.py` (ekhtebar, nezamat), `iran_relay.py` (taxreg, dotic, rcmajlis), `sync_sources.py`, `fetch_unity_rulings.py`, `rulings_delta.py`, `rulings_auto_update.sh`, `corpus_crawl4ai.py`. A unity-ruling feed therefore **already exists, at the unofficial (ekhtebar) tier**. The real gaps are (a) **judiciary and executive circulars**, (b) an **official-tier** source for rulings and gazette items, and (c) an **auction watcher** (Setad). No new crawler framework is needed for any of them.
- **"HTTP 200" is not content.** Of the sources probed today, several answer 200 with a challenge, a block page or a parked-domain page (section 3). The core new component is a small **page-state classifier** that decides `ok | challenge | blocked | parked | tls_error | empty | redirect` before anything is parsed, stored or diffed.
- **Policy is already set** by `docs/legal/SOURCES_ACCESS.md`: no challenge solving, no CAPTCHA solving, no stealth or fingerprint spoofing, no IP rotation. That removes some tools outright (section 2).
- **Pilot (section 7): rrk.ir** (Official Gazette), as a read-only watcher on the box, after a TLS diagnosis that pins the host's certificate chain instead of disabling verification.

## 1. Constraints that shape the design

| Constraint | Source | Effect |
|---|---|---|
| Free / open source first; flag AGPL, SSPL, BSL; runtime licences MIT/Apache/BSD/PostgreSQL only | box brief §11, T257 #996 rules | every tool below carries its licence |
| No bypass of challenges, CAPTCHAs, bot detection; no logins without permission | `SOURCES_ACCESS.md`, task | stealth modes and challenge-passing browsers are out |
| One request per 2-3 s per host, robots.txt honoured, honest UA `RoxiraBot/1.0 (+https://ghazihoushmand.ir)` | `sync_sources.py`, `law_watch.py` | speed is not the bottleneck; Rust speed buys nothing |
| `.ir` direct, foreign APIs via `http://127.0.0.1:10809`; never print IPs | box brief §1 | watcher must not log peer addresses |
| `mahanfilms` must not use Docker (docker group bypasses the proxy); Docker Hub is blocked | box brief §2 | no container-only tools as that user; use venv or `runner` |
| Builders hold no keys on the box | box brief §4 | extraction is rule-based first; the LLM step is optional and its location is an ASK-HUB |
| Load shedding: load > 7, free RAM < 3 GB, disk > 85/90%; night window 00:30-04:30 reserved | box brief §7 | watcher is priority 5, runs outside the window, stops when shed |
| Public repo | brief | raw pages and state stay outside git; only staged JSONL reaches a PR |

## 2. Tool comparison

Facts below are from each project's GitHub repository (licence and latest release read with `gh api` on 2026-11-21). Memory and CPU use were **not measured**; the pilot measures them (section 7).

| Tool | Lang | Licence | Latest release (date) | Persian/RTL | Policy fit (`SOURCES_ACCESS.md`) | Verdict |
|---|---|---|---|---|---|---|
| `reqwest` + `scraper` | Rust | Apache-2.0 / ISC | reqwest v0.13.5 (2026-09-08), scraper v0.29.0 (2026-10-21) | UTF-8 native; Persian handled by our own normaliser, not the crate | fits | Good for a later Rust rewrite of a proven fetcher; no gain now |
| `spider-rs` (`spider`) | Rust | MIT | v2.54.2 (2026-11-19) | UTF-8; no Persian-specific logic | fits if per-host delay and robots are configured; its value is concurrency, which we deliberately do not use | Not needed; revisit only for wide crawls of one cooperative host |
| `chromiumoxide` | Rust | Apache-2.0 | v0.9.1 (2026-02-25), last push 2026-04-03; docs.rs flags RUSTSEC-2026-0007 (transitive `bytes`) | browser renders Persian | browser use only for public JS-only pages with no challenge | Watch; maintenance is slow |
| `headless_chrome` | Rust | MIT | 1.0.22 (2026-06-11) | browser renders Persian | same | Simpler API, little activity; same verdict |
| Crawl4AI | Python | Apache-2.0 **plus an attribution clause (flag)**; the clause is stated in third-party summaries, read the LICENSE before shipping | v0.9.6 (2026-11-20) | Chromium renders Persian; Markdown output keeps RTL text | already in repo (`corpus_crawl4ai.py`, honours robots, stops a host on a challenge) | Keep for **JS-only public pages** (likely Setad lists); heavy (Chromium) |
| Scrapling | Python | BSD-3-Clause | v0.5.1 (2026-11-04) | Firefox/Chromium based | its headline feature is `StealthyFetcher` (fingerprint spoofing, Cloudflare bypass), which the policy forbids | **Out** as a stealth tool; plain `Fetcher` adds nothing over stdlib |
| Scrapy | Python | BSD-3-Clause | 2.20.0 (2026-11-06) | UTF-8 | fits (AUTOTHROTTLE, ROBOTSTXT_OBEY) | Good framework but a second fetch stack beside the tested one |
| `scrapy-playwright` | Python | BSD-3-Clause | v0.0.48 (2026-07-10) | via Chromium | as Crawl4AI | No: same job as Crawl4AI, extra layer |
| Playwright (Python) | Python | Apache-2.0 | v1.65.2 (2026-11-14) | via Chromium | as Crawl4AI | Only as Crawl4AI's engine |
| changedetection.io | Python | Apache-2.0 (per the GitHub licence API; read LICENSE before use) | 0.70.4 (2026-11-19); had CVE fixes in 0.54.x | text diff, Persian OK | plain HTTP mode fits; its browser-steps mode would need Playwright and care | Optional **UI/alert layer** for Setad pages, run as a venv user service, no Docker; not the source of truth |

**Decision:** keep **Python stdlib fetchers + a small shared watcher core** (state, classifier, scheduler hook), and use **Crawl4AI only where a page needs JS and shows no challenge**. Rust is deferred: with a 2-3 s per-host delay and a few hundred requests a day the cost is network waiting, and rewriting tested parsers has no payoff. Revisit when a parser is stable and a measured CPU or memory problem exists (then `reqwest` + `scraper`).

## 3. Source probes, 2026-11-21

Method: one `GET /robots.txt` per host from the box as Linux user `mahan`, UA `RoxiraBot/1.0`, 3 s apart, no retries, no browser UA. `rrk.ir` and `lawnet.ir` used an explicit per-host `-k` only to read the response. These probes were run as `mahan`, **not** the service user: the pilot must repeat them as the user that will run the timer.

| Host | robots.txt result | What that means |
|---|---|---|
| qavanin.ir | HTTP 200, `text/html`, a "Transferring to the website..." interstitial | **Challenge page**, not a robots file. Matches `SOURCES_ACCESS.md` (ArvanCloud JS challenge). Never automate; manual save + `parse_qavanin_print.py`, or ask the publisher |
| rc.majlis.ir | timeout after 20 s | Unreachable from the box in this probe. `iran_relay.py` covers it from the Mac. Re-test |
| dotic.ir | 200, `text/plain`: `User-agent: *`, `Allow: /`, sitemap index `/view/sitemapindex.php` | Clean. Already covered by `iran_relay.py` (dotic) |
| divan-edalat.ir | 302, not followed | Unknown; needs one redirect-aware check |
| cbi.ir | HTTP 200 but an HTML "request rejected" page (Persian) for the bot UA | **WAF block served with 200.** Do not retry with a browser UA; ask CBI or use manual saves |
| setadiran.ir | 404 | No robots file. Not permission: apply our own default (>= 3 s, off-peak, public pages only, no login) |
| rrk.ir | 404 (TLS only readable with the host exception) | No robots file; same default. TLS cause open |
| lawnet.ir | 200, a "domain for sale" page | **Parked domain. Drop it** from all lists |
| dadiran.ir, ijri.ir | `getent`: no DNS | Gone under these names (matches the NXDOMAIN note). A search found no successor. A web search did mention the Judiciary Research Institute's national rulings portal at `ara.jri.ac.ir`; both `jri.ac.ir` and `ara.jri.ac.ir` resolve in DNS, but **no page was fetched**. Treat as candidate, verify first |
| rooznamehrasmi.ir | resolves in DNS, **not fetched** | Named in `SOURCES_ACCESS.md` as the gazette; relation to rrk.ir (same publisher, different domain?) to be settled in the pilot |

Not re-probed (already documented in the repo): ekhtebar.ir and nezamat.ir (polled by `law_watch.py`, `sync_sources.py`), regulation.tax.gov.ir (taxreg in `iran_relay.py`). Other hosts in the task list (eadl.ir, adliran.ir, dolat.ir, mimt.gov.ir, shora-gc.ir, icbar.org, iets.mporg.ir, divar.ir, sheypoor.com, iranbar.org, tender.ir) were **not fetched** in this research; their status above the repo is only what the task reported.

### 3.1 Per-source notes

Update frequencies below are **not measured**; the pilot records them. "Not verified" means taken from search results or repo docs, not from a fetch today.

| Source | Role | URL patterns (known) | Update rhythm | TLS / access | Tier |
|---|---|---|---|---|---|
| rrk.ir (Official Gazette) | unity rulings, circulars, laws as published | not verified from the box | gazette issues, expected daily-ish | TLS verification fails; fix = diagnose chain, pin per host | official |
| qavanin.ir | consolidated laws | `/law/...` | amendments | ArvanCloud challenge | official, **not automated** |
| rc.majlis.ir | parliament research centre laws | `/fa/law/show/<id>` (from `iran_relay.py`) | irregular | timeout in probe | official |
| dotic.ir | legislation news, sitemap | `sitemap.php?page=N` (repo) | frequent | clean, 200 | official-ish, covered |
| regulation.tax.gov.ir | tax regulations | `lws3?act=...`, `lwvi?lid=<id>` (repo) | weekly+ | works from Iranian IP | official, covered |
| ekhtebar.ir | WordPress mirror: laws, rulings, circulars | REST `wp-json`, category 247 (unity) and 794 (admin court), repo docs | multiple posts/day | clean | **unofficial**, covered |
| nezamat.ir | consolidated laws with amendment tags | WordPress REST (repo) | ~3 posts/day | clean | unofficial, covered |
| ara.jri.ac.ir (candidate) | national judicial rulings (per news) | not verified | unknown | not fetched | official, verify |
| setadiran.ir | public auctions, tenders | list and detail URL patterns **not verified from the box** | per notice; auctions have fixed open/close times | login needed to bid (e-signature, deposit); public listing visibility unverified | n/a, non-legal |
| tamliki.ir | confiscated-property organisation notices | not verified | per auction | resolves; not fetched | n/a |

## 4. Architecture

```
 systemd --user timer (per source, off-peak, jittered)
        |
        v
 watcher core (Python stdlib, one module)
   1. polite client: UA, per-host delay >= 3 s, robots, ETag/Last-Modified, budget per run
   2. page-state classifier: ok | challenge | blocked | parked | tls_error | empty | redirect
        non-ok  -> record state, back off that host, never parse, never retry harder
   3. extract (rule-based per source: regex/selectors, same helpers as fetch_unity_rulings)
   4. change detection: SHA-256 of normalised text + (source_id, item_id) -> SQLite (WAL) state
   5. emit: new/changed items -> staged JSONL (NEW file per day), review digest
        |
        v
 PR via a relay_publish.sh-style publisher (only data/legal/staged/*.jsonl), human merge
        |
        v
 existing ingest gates -> rulings / regulations collections (L4, T257)
```

- **State and queue:** per-source SQLite file under `/srv/data/watcher/` (HDD, outside git), plus the timer. No new queue: the orch SQLite design in the brief (#1021) is the future place for leases and cost logs, and the watcher can register as a task source later.
- **Capacity row to add to brief §7:** watcher, 1 thread, 512 MB `MemoryMax` for HTTP-only sources (Chromium sources only after measurement), 1 job at a time, priority 5, paused by load shedding, never in 00:30-04:30.
- **Schema:** reuse the staged-row contract from `iran_relay.py`: `source`, `source_tier`, `url`, `doc_id`, `title`, `doc_type`, `number`, `date`, `issuer`, `text`, `fetched_at`, `staging_status: "proposed"`, `needs_review: true`; add `content_sha256` and `state` (new/changed). Rows never overwrite existing corpus data (same rule as `sync_sources.py`).
- **Page-state classifier:** a short list of fingerprints per class (challenge interstitial markers, WAF "request rejected" text, parked-domain phrases, tiny body, redirect to a login). Unit-tested offline with the three real pages seen today (qavanin, cbi, lawnet). A host that returns a non-ok state is skipped for the run and counted; two days in a row raises one line in the digest, no loop of retries.
- **TLS:** never `verify=False`. For rrk.ir: capture the served chain (fingerprint, issuer; no IP), check whether the server omits an intermediate CA; if so ship that intermediate as a pinned per-host CA file. If the cert is genuinely invalid, treat the host as `tls_error`, report it, and do not poll until the owner decides.
- **LLM step (optional):** only for ambiguous classification (is this item a circular, a ruling, news?), as in `law_watch.py --llm`. Use the `free` role from `config/models.yaml` by role name (never an id in code); public legal text is non-sensitive so `non_sensitive_only` is acceptable. Builders on this box hold no keys, so where it runs (Mac/production, or a box key) is an ASK-HUB. Rule-based output is complete without it.

## 5. Setad auctions (design only)

Goal: notice when a new auction or tender appears or changes, for the owner's market watch.

- **Boundaries:** public listing pages only, no login, no bidding, no CAPTCHA, no bypass. If listings need a session, stop and ask the site (their support or terms) for permission or a feed. Bidding needs an electronic-signature certificate and deposit (from news guides, not verified), so anything behind the account stays out of scope.
- **Method:** step 1 of the pilot's second phase is a **human-readable structure check** with the honest UA: one request each for the list page and one detail page, reading the HTML to see whether data is in the markup, a JSON endpoint or only rendered by JS. Only a public JSON/HTML list is polled. If JS-only, use Crawl4AI for that one public page under the same delay.
- **Change detection:** item id + SHA-256 of normalised title, price, open/close dates, status. The one use where changedetection.io is worth considering is a human-facing diff and alerts on a single list URL; it must run as a venv service without Docker.
- **Rate:** no robots file means our default: >= 3 s per request, list page every 30-60 min in daytime, detail pages only for new ids. Off-peak and slower if the site slows down; stop at any 429/403/challenge.
- **Similar sites** (iets.mporg.ir, tender.ir, divar.ir, sheypoor.com, tamliki.ir): add one config entry each after their own robots/terms check. Marketplaces (divar, sheypoor) usually forbid scraping in terms and run bot defences: do not automate them without written permission.

## 6. Feeding Smart Judge (T257 #996) and the circulars feed

- **Current state, from the repo:** the corpus is about 60 laws. Unity rulings arrive via `rulings_auto_update.sh` every 6 h from ekhtebar (unofficial tier). `docs/research/SMART_JUDGE_PHONE_DIAGNOSIS_2026-11.md` found **no judiciary circulars**, and `latest_rulings` on the regulations collection has no filter case (code-reading finding of that PR, not re-verified here).
- **Proposal:**
  1. The watcher stages **official-tier** rows (rrk.ir first) with `doc_type` in `{circular, unity_ruling, law, regulation}` and `source_tier: official`. L4 decides authority boost (T238 tier 2 for circulars).
  2. T257's weekly amendment job consumes `data/legal/staged/watcher_<source>_<date>.jsonl` by the same PR route as `iran_relay_*.jsonl`. Ingest remains L4's.
  3. Duplicates against ekhtebar rows are matched by `(issuing body, ruling type, number)` as in `rulings_delta.py`; an official row supersedes the unofficial one and keeps its source link.
  4. Rows stay `needs_review: true`, `lawyer_review_pending`, until a lawyer confirms.
- **Coordination (ASK-HUB on #965, one line):** who owns which hosts (the Mac already polls ekhtebar, nezamat, taxreg, dotic, rcmajlis through `iran_relay.py`/`law_watch.py`), so box and Mac do not double-poll; where the optional LLM step runs; whether L4 wants `watcher_*.jsonl` or the `iran_relay_*.jsonl` name. Proposed split: Mac keeps the current hosts; the box takes rrk.ir, `ara.jri.ac.ir` (if verified) and Setad.

## 7. Pilot plan: rrk.ir on the box

Why this source: it passes the three tests used here: no challenge seen (robots 404, TLS issue), it fills the official circulars/unity-ruling gap, and the Mac does not poll it. dotic.ir is clean but already covered; qavanin.ir and cbi.ir are blocked by design.

Steps (each small, reversible, no production touch):

1. **Re-probe as the service user** (`mahanfilms`, no Docker): one request each for `/` and `/robots.txt` of rrk.ir and rooznamehrasmi.ir with the honest UA. Record status, content type, size, TLS chain subject/issuer and expiry. No IPs in the notes.
2. **Diagnose TLS:** is the intermediate missing, or is the cert expired/self-signed? Outcome: pinned CA file for that host, or `tls_error` and stop.
3. **Structure check:** read, by hand from saved pages, the list and detail layout of unity rulings and circulars; write the URL patterns and selectors into a source config. Max ~20 requests, >= 3 s apart.
4. **Build the classifier first** with unit tests on the three fixtures seen today (challenge, WAF block, parked), then the rrk.ir extractor.
5. **Dry run**: one timer-less run into a scratch dir; compare 10 rows by hand against the site and against ekhtebar's rulings.
6. **Timer**: `systemctl --user` timer, every 6 h inside 07:00-23:00, jittered, with `MemoryMax=512M`, `CPUWeight` low, plus the shed check. Log per run: requests, states, new/changed counts, wall time, peak RSS (the first real resource numbers).
7. **Publish** staged JSONL by PR (publisher restricted to `data/legal/staged/watcher_*.jsonl`).
8. **Review after 7 days:** classifier hit rate, false "ok", resource use, duplicates vs ekhtebar. Then decide on `ara.jri.ac.ir` and Setad (section 5), each with the same steps.

Done when: 7 days of timer runs without a non-ok state being parsed, at least one real new official row staged and matched or not matched against ekhtebar, and measured CPU/RAM written into the brief's capacity table.

## 8. Legal and ethical limits (summary)

- Honour robots.txt where it exists; where it does not (setadiran.ir, rrk.ir) apply our stricter default and stop on any complaint or rate-limit sign.
- Never solve or pass CAPTCHAs, JS challenges, WAF blocks, or use stealth/fingerprint tools; never use a browser UA to avoid a block aimed at bots.
- No scraping behind logins or accounts without the site's written permission; no deposits, bids or form submissions.
- Mark every row `source_tier` and `needs_review`; keep raw pages out of git; keep the publisher's name and URL on each row.
- Where a host is blocked, use the two routes already in policy: ask the publisher for a feed or permission, or manual saves by a person.

## 9. Open questions

- Where do `ara.jri.ac.ir`, the successor of dadiran/ijri, and the rrk.ir/rooznamehrasmi.ir relationship stand? (Pilot steps 1 and 3.)
- Are Setad listing pages public and plain HTML? (Not verified from the box.)
- cbi.ir blocks the bot UA: contact CBI for a feed or use manual saves?
- Where may the optional LLM step run, given builders hold no keys? (ASK-HUB.)
- Crawl4AI attribution clause: acceptable for a product we ship? (Read LICENSE before adoption.)

## Sources

- Repo: `docs/legal/SOURCES_ACCESS.md`, `docs/legal/LAW_WATCH_DESIGN.md`, `scripts/legal/{law_watch,iran_relay,sync_sources,fetch_unity_rulings,rulings_delta,corpus_crawl4ai}.py`, `docs/hub/BOX_HUB_MASTER_BRIEF.md`, `docs/research/SMART_JUDGE_PHONE_DIAGNOSIS_2026-11.md`, issue #996.
- Licences and releases, read 2026-11-21 from the GitHub API for spider-rs/spider, mattsse/chromiumoxide, rust-headless-chrome/rust-headless-chrome, rust-scraper/scraper, seanmonstar/reqwest, unclecode/crawl4ai, D4Vinci/Scrapling, scrapy/scrapy, scrapy-plugins/scrapy-playwright, microsoft/playwright-python, dgtlmoon/changedetection.io.
- [deps.rs: chromiumoxide 0.9.1](https://deps.rs/crate/chromiumoxide/0.9.1) (RUSTSEC-2026-0007 flag).
- [Geekflare: Crawl4AI](https://geekflare.com/open-source/crawl4ai/) (attribution clause, third-party; check LICENSE).
- [Scrapling docs](https://scrapling.readthedocs.io/en/latest/) (StealthyFetcher).
- [Tasnim on ara.jri.ac.ir](https://tasnimnews.ir/2410335), [Ekhtebar explainer](https://www.ekhtebar.ir/معرفی-سامانه-ملی-آرای-قضایی/) (candidate source, unverified).
- [Tejarat News: Setad auction participation](https://tejaratnews.com/بخش-اقتصاد-کلان-6/899338-چگونه-در-مزایده-اموال-تملیکی-شرکت-کنیم) (registration and deposit, dated, unverified).
