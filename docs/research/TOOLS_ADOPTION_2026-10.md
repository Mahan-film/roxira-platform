# Tools adoption review for Roxira (2026-10-04)

Scope: which of ~30 popular tools Roxira should adopt for (a) resilient multi-source Iranian legal-text collection with automatic fallback, (b) Persian-law RAG, (c) agent orchestration, (d) UI building, (e) automation. Read-only research. Existing verdicts are NOT repeated: see `AGENT_FACTORY_STACK_2026-10.md` (OpenCode/OpenHands/Goose/DBOS/Bernstein), `ZERO_COST_RESEARCH_STACK_2026-10.md` (SearXNG + Crawl4AI + trafilatura; Firecrawl cloud off; self-host Firecrawl not initially), `AGENTIC_TOOLING_RESEARCH_2026-10.md` (Mem0 duplicates engram; Langfuse noted), `AUTONOMOUS_APP_BUILDERS_LANDSCAPE_2026-10.md` (Dyad), `LEGAL_RAG_RESEARCH_2026-10.md` (LightRAG, promptfoo, bge-m3), `MODEL_AND_COMPUTE_PLAN_2026-10.md` (bge-m3 + reranker local), `LEGAL_SOURCES_PLAN_2026-10.md` (source list). This file adds: fresh facts verified today, OCR/PDF verdicts, Archive fallback tests, and the "never give up" chain design.

Evidence flags: **V** = verified by fetching the page/API on 2026-10-04 (GitHub API for stars/licence/last push; README for details). **U** = unverified (search snippet, general knowledge, estimate). Stars and push dates are from the GitHub API today.

## 0. Facts that change earlier plans

1. **Flowise is archived** (read-only since 2026-08-13, banner "Flowise has been archived", repo flag `archived=true`). V. Do not adopt. Reason beyond the banner not read (discussion #6727 not fetched, U).
2. **"Hexbot" is ambiguous; neither candidate is relevant.** Searches return (a) **HexStrike AI** (0x4m4/hexstrike-ai, MIT, 12.3k stars, last push 2026-08-03): an MCP server that lets LLM agents run 150+ offensive security tools; README itself warns of "powerful system access". Security press (Check Point as quoted by SecurityAffairs/TechRadar/Infosecurity, search snippets, U on details) reports threat actors discussing it to exploit Citrix CVEs within days of disclosure. It is an offensive/pentest tool: **AVOID** (never connect to our agents or MCP allowlist). (b) **Hexabot** (hexabot-ai/hexabot, ~1k stars, TypeScript/NestJS + MongoDB chatbot/agent builder, search snippet only). Small, duplicates Dify/n8n; **SKIP**. If the owner meant another "Hexbot", ask for the URL.
3. **Wayback has useful but unreliable copies of Iranian law portals** (tested live, section 5): CDX works but is slow (~20 s/query) and the availability endpoint returned HTTP 429 on first call. Captures can be junk (a 2025 capture of `rc.majlis.ir/fa/law/show/10` is a Cloudflare challenge page; a 2014 "law/show/100012" capture was a news page, not a law). Archive fallback therefore needs content validation, not just HTTP 200.
4. **Promptfoo is now part of OpenAI** (README says MIT and open source continue). V. Fine to use locally; treat as a vendor-ownership risk, keep configs provider-neutral.
5. **Several "OSS" tools are not OSI open source**: n8n (Sustainable Use License: internal business or personal non-commercial use OK, commercial resale not), Dify (Apache-2.0 plus conditions on multi-tenant and logo), MinerU (own "Open Source License", Apache-2.0 plus conditions), Dyad (Apache-2.0 except `src/pro` under FSL 1.1), Langfuse (MIT except `ee/`). V.
6. **Marker and Surya code is Apache-2.0 but model weights are "modified AI Pubs Open Rail-M"**: free for research, personal use, startups under $5M funding/revenue; above that a paid licence. V. Roxira is a commercial product: acceptable now, flag in the licence register.

## 1. Verdict table

Verdict: ADOPT = use now, TRY = time-boxed spike, SKIP = not for us, AVOID = security/legal risk. RAM = rough extra RAM on the 16 GB Mac (U unless stated). "Data leaves" = whether content/prompts go to a third party.

| Tool | What it is / licence / maturity (V) | Fit for Roxira | Cost / RAM | Risks | Verdict |
|---|---|---|---|---|---|
| **Dyad** | Local desktop AI app builder (Lovable/v0 style), 21.7k stars, push 2026-10-01, Apache-2.0 + FSL `src/pro`, BYO keys, Supabase/Vercel oriented | UI building is Next.js + shadcn + OpenCode already; Dyad's output stack (React/Supabase) differs from our NestJS/Postgres rules (AGENTS.md section 2) | free; Electron app ~0.5-1 GB | generated code bypasses our DTO/tenant rules; Supabase/Vercel dependencies; desktop-state | SKIP (owner may use as a throwaway prototyping sandbox only) |
| **Flowise** | Visual LLM-flow builder, 55.5k stars, **archived 2026-08-13** | n/a | n/a | abandoned | SKIP |
| **Composio** | 1000+ managed tool integrations + auth broker, 30.4k stars, MIT SDK, **hosted SaaS** (needs `COMPOSIO_API_KEY`, sessions/OAuth brokered via their cloud) | we need ~5 integrations (GitHub, Telegram, email); case data must not pass a third-party broker; US cloud, Iran-geo risk | free tier unknown (U) | data leaves machine; OAuth tokens held by vendor; supply-chain | SKIP |
| **Open Notebook** | NotebookLM alternative: FastAPI + Next.js + SurrealDB, 18+ providers incl. Ollama, MIT, 39.8k stars, active | useful as an owner-facing "chat with my research PDFs" tool, not as Roxira's legal RAG (no article-level citation guard, new DB engine SurrealDB) | Docker, ~1-2 GB (U) | extra DB engine; another RAG that can disagree with ours | SKIP for product; optional personal tool |
| **n8n** | Workflow automation, 206.6k stars, push today, Sustainable Use License | We already have launchd + Python + (planned) DBOS; n8n adds a Node service, UI-built workflows not reviewable in PRs; licence forbids commercial resale | ~0.5-1 GB | licence ambiguity if embedded in a product; workflows live in DB not git | SKIP (reconsider only for owner-side no-code chores) |
| **Firecrawl (self-host)** | Scraper-to-markdown, 188k stars, AGPL-3.0 core, SDKs MIT. Self-host docs exist; open-source vs cloud feature gap is in a table I did not read (U) | `ZERO_COST_RESEARCH_STACK` already says no initially; AGPL if exposed as network service; Crawl4AI does the same under Apache-2.0 | heavy: Redis + workers + Playwright (U, ~3-4 GB) | AGPL; missing cloud anti-bot engine in self-host (U) | SKIP; keep cloud `firecrawl` only as a last-resort step in `extract_page` chain |
| **Crawl4AI** | Async Playwright crawler to LLM-ready markdown, v0.9.4 (2026-09-23), Apache-2.0 (attribution recommended), 84.7k stars, proxy support, stealth mode, CSS/XPath extraction without LLM | The JS-page and anti-bot fallback step in the collector; run on Hetzner per existing plan | free; browser 1-2 GB per context; Docker needs `--shm-size=1g` | headless browser attack surface: fetch only allowlisted law domains, never follow links off-domain, no LLM extraction on law text (use CSS selectors) | ADOPT (as step 3 of chain, on server) |
| **Scrapy (+ scrapy-playwright)** | Mature crawler framework, 64.6k stars, BSD-3 | Built-in retry, AutoThrottle, HTTP cache, robots, per-domain concurrency, item pipelines: ideal for bulk crawl of a single portal's thousands of law pages. Plain `httpx` + our chain is simpler for the 25-60 allowlisted laws | free; ~150 MB | learning curve; overlaps Crawl4AI | TRY only if the corpus grows beyond ~500 pages from one site; otherwise skip |
| **Docling** (IBM, LF AI & Data) | Document converter (PDF/DOCX/HTML/images) with layout + tables, MIT, 68.3k stars, push today; OCR engines: RapidOCR, EasyOCR, Tesseract (CLI or tesserocr), OcrMac (native macOS Vision), Nemotron-OCR, KServe | Best general converter for text-layer PDFs and mixed docs; local only; LightRAG can use it as parser. Persian OCR coverage is NOT documented (docs mention Arabic script via RapidOCR; Tesseract can take `fas`) | models ~1-3 GB, 2-4 GB RAM while converting (U) | Persian quality unproven: must be measured on 20 gazette pages | TRY (spike with Tesseract `fas` backend vs Surya, section 4) |
| **Marker** | PDF to markdown, Apache-2.0 code, weights Open Rail-M (see 0.6), 40.2k stars, OCR via Surya; reports 76.0% overall on olmOCR-bench balanced mode, claims it beats MinerU/Docling (self-reported by vendor) | Candidate OCR for scanned gazette PDFs | MPS/CPU possible, llama.cpp on Apple Silicon; heavy: ~3-6 GB (U) | weight licence; vendor benchmarks | TRY (same spike) |
| **Surya** | OCR/layout VLM, 91 languages; **Persian 82.3%, Arabic 72.7% on vendor's own benchmark** (V README); Apple Silicon via llama.cpp Metal at ~0.1 pages/s (V README); weights Open Rail-M | Only option with a published Persian number; slow on the Mac (about 10 s/page), so run on selected pages only or on the server | 4-8 GB while running (U) | slow; licence; vendor benchmark | TRY (fallback OCR for pages where pdftotext/Tesseract fail) |
| **Tesseract `fas`** | Classic OCR, Apache-2.0, 76.8k stars. Independent academic evaluation (IDPL-PFOD Farsi form dataset): Tesseract 84.4% vs EasyOCR 73.3% overall, 92.5% on plain backgrounds, 67.2% on textured (search snippet of pcdp.qut.ac.ir paper, U not fetched) | Cheapest baseline, runs anywhere, `brew install tesseract tesseract-lang`; start here for scanned PDFs | ~200-500 MB | accuracy on old gazette scans unknown; digits/ZWNJ errors must be normalised by our existing digit/ZWNJ code | ADOPT as baseline OCR |
| **PaddleOCR** | Apache-2.0, 90.6k stars, push 2026-09-16; strong on Latin/Chinese; Farsi support exists in its multilingual models (U version-specific) | heavy PaddlePaddle runtime on Apple Silicon is awkward | 2-3 GB (U) | dependency weight; unproven Persian | SKIP (Tesseract + Surya cover it) |
| **MinerU** | PDF to markdown for LLM, 81k stars, MinerU 4.0, own Apache-based licence, basic tier ONNX 2 GB RAM, standard 8 GB+; Persian OCR not stated | Chinese-centric ecosystem; licence conditions unread in full | 2-8 GB | licence; Persian unknown | SKIP |
| **Unstructured** | ETL partitioner, Apache-2.0, 15.5k stars | overlaps Docling; the free library is a funnel to their paid API | 1-2 GB | upsell, weaker layout | SKIP |
| **LightRAG** | Graph+vector RAG, MIT, 40k stars, push 2026-10-03; storage options Postgres (recommended all-in-one), Qdrant, Neo4j; BGE-M3 recommended for multilingual; reranker support; citation/traceability; REST API + WebUI; parsers MinerU/Docling | Already chosen and pinned in repo (`smartjudge/legal_graph/lightrag_engine.py`, `src/test_lightrag_pin.py`). Graph value for Persian statutes is unproven: statutes are already structured (law, article, note, cross-reference) | extraction needs LLM tokens (cost), RAM small | graph from LLM entity extraction invents edges; use only as secondary recall behind exact-article lookup | KEEP as is (opt-in); do not expand until the eval in LEGAL_RAG_RESEARCH shows a gain |
| **GraphRAG (Microsoft)** | MIT, 36.2k stars | heavy indexing cost, designed for narrative corpora | high token cost | cost | SKIP |
| **Haystack** | Pipelines framework, Apache-2.0, 26.6k stars, push 2026-10-02 | We already own retrieval code; a framework adds abstraction without new capability | ~100 MB | churn | SKIP |
| **LlamaIndex** | Data framework, MIT, 52.4k stars | same as Haystack; its node parsers are fine for experiments only | ~200 MB | churn, heavy dependency tree | SKIP (use `llama-index` only inside a throwaway notebook if wanted) |
| **Dify** | LLM app platform, 157.8k stars, Dify Open Source License (multi-tenant/logo limits), needs Docker Compose, min 2 CPU + 4 GB RAM | Duplicates our FastAPI/NestJS product layer; multi-tenant restriction conflicts with our SaaS plan | 4+ GB | licence; heavy | SKIP |
| **Langfuse** | LLM observability, 35.4k stars, MIT except `ee/`; self-host needs Postgres + ClickHouse + Redis + S3-compatible storage (V); LiteLLM integration exists | Good for traces/evals but ClickHouse + Redis + S3 + 2 services is too heavy for a 16 GB Mac that also runs agents | 4-6 GB (U) | heavy; cloud variant sends prompts out | SKIP now; revisit on the server when 3+ products need traces. Interim: LiteLLM request log + a `llm_calls` table |
| **Promptfoo** | CLI evals + red-team, MIT, 25.7k stars, now part of OpenAI, runs 100% locally (V README) | Perfect for a golden-set eval of Persian legal answers and for regression of the fallback prompts; YAML configs reviewable in git | ~300 MB (Node) | vendor ownership; keep telemetry off (`PROMPTFOO_DISABLE_TELEMETRY=1`, U) | ADOPT (CI-local) |
| **DeepEval** | Pytest-style LLM eval, Apache-2.0, 18.6k stars; local judge models supported; cloud sync only after `deepeval login` (V) | Overlaps Promptfoo; Python-native | small | cloud sync if logged in | SKIP (Promptfoo covers it; DeepEval only if we need RAG metrics inside pytest) |
| **Mem0** | Agent memory layer, Apache-2.0, 66.6k stars | existing verdict: duplicates engram + Markdown memory | needs vector store + LLM | extra LLM calls, drift | SKIP (existing verdict stands) |
| **SearXNG** | Metasearch engine, AGPL-3.0 (fine if unmodified/internal), 37.9k stars, push today; known issue: Google/Bing/DDG may CAPTCHA or block instances (V README) | The multi-engine discovery layer: finds alternative URLs for a law when the primary portal is down. Existing plan runs it on Hetzner with Valkey limiter | ~0.5-1 GB on server | engines get blocked; results are untrusted data; Iranian sites poorly indexed by Western engines, so add Yandex/Mojeek/Brave engines and `site:` queries | ADOPT (server) |
| **Wayback / archive.org CDX** | CDX server API: `filter`, `collapse`, `from/to`, `limit`, `output=json`, `showResumeKey`; max 150000 rows/query; **no rate limits documented** (V). Live tests: section 5 | Last-resort source for pages that vanished or are blocked; also gives historical versions (useful for repeal/amendment dating) | free | 429s, ~20 s latency, junk captures, stale text (legal currency risk) | ADOPT as chain step 6, always flagged `provenance=archive` and `needs_human_check=true` |
| **bge-m3 + bge-reranker-v2-m3** | bge-m3: MIT, 1024-dim, 8192 tokens, dense+sparse+multi-vector, XLM-R base (V). Reranker v2-m3: Apache-2.0, 0.6B params (V). FaMTEB per `MODEL_AND_COMPUTE_PLAN` (rerank score 85.2 for bge-m3, secondary source) | Already the plan: local embeddings and rerank keep case text on device | ~1.2 GB + ~1.2 GB fp16 (U) | rerank latency 1-3 s per batch on M4 (U) | ADOPT (already in repo; add the reranker step with eval) |
| **HexStrike AI** | see 0.2 | offensive security | n/a | misuse, host compromise | AVOID |

Not asked but better: see section 6.

## 2. Relevance to each need

- **Collection with fallback**: SearXNG (discovery), Crawl4AI (JS/anti-bot), Wayback CDX (archive), plain `httpx`/Scrapy (primary), Tesseract/Surya (scanned PDFs). Nothing else is needed.
- **RAG over Persian law**: bge-m3 + reranker + exact-article lookup + citation guard (already built). LightRAG stays opt-in. No new framework.
- **Agent orchestration**: nothing from this list; existing `rx` + OpenCode + DBOS spike stands. Composio, Flowise, n8n, Dify do not improve it.
- **UI building**: nothing here; Dyad is a prototype toy for our stack.
- **Automation**: launchd/DBOS plus scripts; n8n only if owner wants UI-built chores (licence permits internal use).

## 3. Security and supply-chain notes

- Everything that fetches the web (Crawl4AI, SearXNG, Scrapy) runs on the **server or in a container with no access to `~/Secrets`, git credentials or customer data**, with an egress allowlist of law domains plus archive.org. Fetched text is untrusted data: never pass it to an agent that has write tools without the existing verifier path.
- Pin versions and hashes (pip `--require-hashes`, Docker digest). Several candidates (Crawl4AI, Docling, Marker) ship large transitive trees with models downloaded at first run from Hugging Face: pre-download, record SHA-256, and block runtime downloads.
- No candidate here should receive customer or case data in hosted mode (Composio, Langfuse Cloud, DeepEval login, Crawl4AI Cloud, Firecrawl cloud).
- Licence register to update: Open Rail-M weights (Marker/Surya), AGPL (SearXNG, Firecrawl), Sustainable Use (n8n), Dify licence, FSL (Dyad pro).

## 4. Persian PDF/OCR plan (pragmatic, measured)

Order per document, stop at the first result that passes validation (section 7, gate V):
1. Text-layer extraction (`pdftotext -layout` via poppler, then Docling for tables). Many official PDFs have a text layer but Persian extraction often has reversed order, broken ligatures or presentation-form characters (U, common experience); normalise with NFKC + Arabic-to-Persian letters + ZWNJ rules + digit mapping (existing code).
2. Tesseract `fas` (plus `eng` for Latin tokens) at 300 dpi after deskew. Baseline.
3. Surya (or Marker) only for pages where step 2 fails the validator, on the server or overnight on the Mac (about 10 s/page on Apple Silicon per README).
4. Human check queue: scanned pages that still fail, or any statute whose article count differs from the expected count.
Spike (half a day, no spend): take 20 Gazette pages (rrk.ir PDFs, from the owner's network), run steps 1-3, score with character error rate on 5 hand-checked pages and article-number recall (every `ماده N` found in sequence). Record in `docs/research/`. Decide Docling vs plain poppler+Tesseract on that data. Do not choose from vendor benchmarks.

## 5. Archive fallback: live test results (2026-10-04, from the agent Mac)

| Test | Result |
|---|---|
| CDX `rc.majlis.ir/fa/law/show/*` with `collapse=urlkey` | HTTP 200 in 19.5 s, JSON rows; included junk URLs |
| CDX prefix `rc.majlis.ir/fa/law/show/1` | numeric law ids present (`/show/10`, `/show/1000025`, `/show/100006`) with 2014-2017 and 2025 captures |
| CDX for `www.ekhtebar.ir`, `dotic.ir`, `qavanin.ir`, `www.rrk.ir` | each has captures (2011-2025); qavanin captures include only `.well-known` stubs (1.1 KB) |
| Raw capture `.../web/<ts>id_/<url>` of a 2014 `law/show/100012` | HTTP 200, 19.8 KB, 2759 Persian characters, but the page was an RCMajlis news item, not a law: an id is not proof of content type |
| Raw capture of 2025 `rc.majlis.ir/fa/law/show/10` | Cloudflare "waiting" challenge page, no law text |
| `archive.org/wayback/available` | HTTP 429 on the very first call |
| Direct fetch of `ekhtebar.ir` robots and `rc.majlis.ir` from this Mac | connection failed (same as `LEGAL_SOURCES_PLAN`) |

Conclusions: use the **CDX API (not the availability endpoint)**, one request at a time with 10 s minimum spacing and a descriptive User-Agent, cache every CDX answer on disk, always request `id_` raw captures, and **validate content** (min Persian-character count, presence of `ماده` markers, absence of challenge strings like "cdn-cgi", "Just a moment", "waiting"). Pick the newest capture that passes validation; record capture timestamp. Old captures can predate amendments or repeal: archive results never auto-ingest, they enter staging with `needs_human_check`.

## 6. Anything better found?

- **trafilatura** (already in the zero-cost plan) is the right static-HTML extractor; keep. **selectolax/lxml + per-site CSS selectors** beat LLM extraction for law pages: deterministic, zero cost, testable with saved fixtures.
- **`ddgs`** (in the zero-cost plan) as a keyless secondary discovery engine behind SearXNG: keep as step in chain.
- **A "site adapter" contract per source** (selectors, article regex, expected article count, last-seen hash) matters more than any tool in the table. Build and fixture-test one adapter per allowlisted source (ekhtebar, wikisource, rc.majlis, dotic, rrk).
- **Content-addressed raw store** (SHA-256 of fetched bytes, source URL, timestamp, HTTP headers) on disk: replay and diff without refetching; the cheapest resilience feature of all.
- **robots.txt + terms check per source before enabling** (lawyer item already in `LEGAL_SOURCES_PLAN`).

## 7. "Never give up" source-fallback chain for law-text acquisition

Extends `src/ops_fallback/chains.py` (it has ordered steps, status-based retry, in-memory cooldown) and `config/fallback_chains.yaml`. Gaps today: one attempt per step (no per-step retry/backoff), cooldown is in memory only, no content validation, no "all failed" handoff, no discovery of new URLs, no provenance. Proposal (design only, no code written):

### 7.1 Inputs and outputs
Input: a law request `{law_id (from config/legal_allowlist.json), expected_article_count (optional), title_variants[]}`. Output: `{text, source, url, fetched_at, content_sha256, provenance: primary|mirror|archive|ocr, validation: {...}, needs_human_check: bool, attempts[]}` or a `HumanCheckTicket`. Never returns unvalidated text. The attempts trail keeps names and status codes only (existing rule, no URLs with secrets, no bodies).

### 7.2 Ordered sources (config-driven, per law)
| # | Step | What | Trust tier | Typical failure |
|---|---|---|---|---|
| 1 | `local_cache` | content-addressed store, last good copy newer than TTL (e.g. 30 d) | as stored | stale |
| 2 | `official_html` | rc.majlis.ir / dotic.ir / qavanin.ir adapters (selectors per site). Fetch from the owner's Iranian-reachable network (Mac), not from Hetzner if the portal geo-blocks (U) | primary | TLS reset, 403, timeouts |
| 3 | `official_pdf` | rrk.ir gazette PDF: pdftotext, then Tesseract `fas`, then Surya (section 4) | primary (original text, not consolidated) | scan quality |
| 4 | `secondary_html` | ekhtebar.ir (robots allow, V), fa.wikisource (API) | secondary; use only as cross-check or when 2-3 fail | commercial site, may be wrong |
| 5 | `discovery` | SearXNG (engines: Brave, Mojeek, Yandex, Bing, DDG) then `ddgs` then paid `tavily/brave/exa` (off by default) with queries from `title_variants` plus `site:` filters; results go through the allowlist of domains, then are fed back into steps 2-4 as candidate URLs | n/a | engine CAPTCHAs |
| 6 | `browser` | Crawl4AI/Playwright for JS pages and soft blocks, concurrency 1, CSS-selector extraction only | as source | challenge pages |
| 7 | `archive` | Wayback CDX then `id_` raw capture of each source URL in steps 2-4 (newest capture passing validation), then optionally archive.today (U, not tested; skip if it needs CAPTCHA) | archive, always flagged | stale, junk, 429 |
| 8 | `human_check` | write a ticket and stop (7.6) | n/a | n/a |

Steps 2-4 and 6-7 are tried per candidate URL; discovery (5) is entered when 2-4 are exhausted or return 404 for every known URL (slugs change), then 2-4 and 6-7 are re-run on newly found URLs only.

### 7.3 Retry and backoff (per step)
- Retryable: network error, timeout, 408, 425, 429, 500, 502, 503, 504, TLS reset, "challenge page" detected. Non-retryable on that source: 404 (go to discovery), 410, validation failure with a clean 200 (the content is wrong, not the network).
- Policy: up to 3 attempts, delay `min(30 s, 2^n s) * jitter(0.5-1.5)`; honour `Retry-After` (cap at 120 s); per-request timeout connect 10 s / read 30 s (archive.org 90 s, it is slow); total wall-clock budget per law 10 minutes.
- Politeness: per-domain concurrency 1, minimum spacing 2 s (10 s for archive.org), descriptive User-Agent, robots honoured (config switch per source after lawyer sign-off).
- The existing `RETRYABLE_STATUS` includes 401/402/403 (right for paid keys, wrong for portals where 403 may be bot-blocking): make the retryable set per step in YAML.

### 7.4 Circuit breaker (per source, persisted)
Extend `Cooldown` to states closed / open / half-open stored in SQLite (survives restarts, shared by workers): open after 3 consecutive failures or 50% failures in the last 10 calls; open duration 5 min, doubling to a 6 h cap; half-open allows one probe request; success closes. A source that is open is skipped instantly and recorded as `cooldown` in the trail. A source open for more than 24 h raises an alert (Telegram message to the owner, existing channel) rather than silently degrading.

### 7.5 Validation gate (decides success, not HTTP 200)
A result is accepted only if all pass: (a) minimum length and Persian-character ratio; (b) no challenge/error markers (`cdn-cgi`, "Just a moment", "access denied", login forms); (c) title matches an allowlist entry after normalisation (ZWNJ, Arabic letters, digits; reuse existing normaliser); (d) article markers: sequence of `ماده N` has no gaps and count equals `expected_article_count` when known (tolerance for `مکرر` and notes); (e) not marked `(منسوخ)` / repealed unless the request asks for history; (f) diff against the cached copy: a change above 15% of text goes to human check instead of overwriting. Gates are deterministic code (extend `src/ops_fallback/gates.py`); no LLM decides acceptance.

### 7.6 Human-check flag
Raised when: only archive/secondary/OCR sources succeeded; cross-source texts disagree (normalised article texts differ in more than 2% of articles); article count mismatch; repeal status unknown; every step exhausted. The ticket (JSON + markdown under `data/legal_staging/needs_human/`, no PII) has: law id, attempts trail, best candidate text path, validation failures, suggested manual action ("download from rc.majlis.ir on your normal connection and drop the PDF in `inbox/legal/`"). The owner or lawyer approves; approved text goes through the existing `scripts/legal/ingest_pipeline.py` allowlist, never directly to production. A drop-folder watcher closes the loop so the system "never gives up": it re-runs the pipeline on the dropped file (steps 2-3 offline mode).

### 7.7 Never-give-up scheduling
The chain returns within the per-law budget; failed laws are re-queued with exponential schedule (1 h, 6 h, 24 h, then daily) and a counter; after 7 days still failing, escalate to the lawyer list in `LEGAL_SOURCES_PLAN`. Runs are idempotent (content hash) so retries are safe.

### 7.8 Config sketch (`config/fallback_chains.yaml`, new chain `law_text`)
```
law_text:
  allow_free_tier: true          # public law text only; never case data
  steps: [local_cache, official_html, official_pdf, secondary_html, discovery, browser, archive]
  retry: {attempts: 3, base_s: 2, cap_s: 30, honour_retry_after: true}
  breaker: {fail_threshold: 3, open_s: 300, max_open_s: 21600, store: sqlite}
  budget_s: 600
  on_exhausted: human_check
```
Step definitions (domains, selectors, per-step retryable codes, spacing) live in a new `config/legal_sources.yaml`; secrets stay in env as today.

## 8. Prioritised adoption plan (max 6)

1. **Law-text chain v1 (engine + validator + store).** Extend `src/ops_fallback/chains.py` with per-step retry/backoff, SQLite-persisted breaker, and a validator hook; add `config/legal_sources.yaml`; add content-addressed raw store. First step: write fixtures from the 3 reachable sources (ekhtebar, wikisource, Wayback captures) and unit tests with injected clock and fake fetchers (no network in tests). Cost 0. Dependencies: none new.
2. **SearXNG + Crawl4AI on the Hetzner server** (as already planned in `ZERO_COST_RESEARCH_STACK`): compose with Valkey, JSON API, engines Brave/Mojeek/Yandex/Bing/DDG; smoke test with 10 Persian legal queries and record block rate. First step: `docker/research-stack/` compose and `scripts/research_stack_smoke.py` (needs owner OK to touch the server). Cost 0, RAM server-side only.
3. **Wayback CDX client** (small `httpx` module): CDX then `id_` capture, 10 s spacing, disk cache, validator. First step: reproduce the section 5 tests as a script for 5 allowlisted laws, store results; confirm which laws have good captures. Cost 0.
4. **Persian OCR spike**: poppler + Tesseract `fas` baseline versus Surya/Docling on 20 gazette pages, scored on article-number recall and CER (section 4). First step: `brew install tesseract tesseract-lang poppler` on the Mac and run 5 pages. Cost 0; decide Docling/Marker only on data. Record weight licence in the licence register.
5. **Promptfoo local eval gate** for Persian legal answers and for the fallback prompts: golden set of 30 questions with exact-article expectations, YAML in git, telemetry off, runs in `local_ci`. First step: 10-question set against the existing exact-article lookup, no LLM judge (string/regex asserts). Cost 0.
6. **bge-reranker-v2-m3 behind a flag** in the retrieval path, evaluated with the same golden set (recall@5 with and without). First step: load via sentence-transformers on MPS, measure latency and memory on 20 candidates. Cost 0, ~1.2 GB.

Explicitly not adopted: Dyad, Flowise (archived), Composio, n8n, Dify, Langfuse (for now), Firecrawl self-host, Haystack, LlamaIndex, GraphRAG, MinerU, Unstructured, PaddleOCR, DeepEval, Mem0, Open Notebook (as product), HexStrike (avoid), Hexabot.

## 9. Open items (UNVERIFIED)

- Why Flowise was archived (discussion #6727 not read); whether a fork exists.
- Persian accuracy of Docling+Tesseract/Surya on Iranian gazette scans (measure, section 4); the Tesseract 84.4% vs EasyOCR 73.3% figures come from a search snippet of a Farsi OCR paper, not read in full.
- Firecrawl open-source vs cloud feature gap and self-host RAM; Langfuse and Dify RAM on a 16 GB Mac; Open Notebook RAM.
- Whether Iranian portals (rc.majlis.ir, dotic.ir, rrk.ir) are reachable from Hetzner or only from Iran; direct fetch from this Mac failed (consistent with `LEGAL_SOURCES_PLAN`).
- archive.today behaviour and terms; Wayback rate limits (none documented; 429 observed on the availability endpoint).
- Hexbot identity (HexStrike AI vs Hexabot vs something else).
- Promptfoo telemetry opt-out variable name; Crawl4AI telemetry settings.
