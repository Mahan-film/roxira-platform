# Deep research — round 4 (R18–R19)

برای مالک: هر پرامپت را جدا در Deep Research اجرا کنید. بعد از گزارش اول، متن «STAGE 2» پایین همین فایل را در همان گفتگو بفرستید و هر دو خروجی را برای من بفرستید. اولویت: R18 (قاضی هوشمند)، بعد R19.

---

## R18 — Smart Judge: faster, more accurate legal answers on chat and phone

```
CONTEXT
"Smart Judge" (قاضی هوشمند) is our Persian legal consultation product: web chat and a phone/voice agent answering questions on Iranian law with citations. Stack: Python FastAPI AI core; retrieval from Qdrant (about 6,300 law-article points, 1,300 regulation points, 1,700 court rulings, 250 judiciary circulars) with BAAI/bge-m3 embeddings on CPU; an optional cross-encoder reranker (1.5 s budget, one at a time); a LightRAG-style legal graph in Postgres; LLM calls through a LiteLLM key pool, free models first (OpenRouter free tiers, Groq, Gemini Flash), paid as fallback; Redis cache. Voice agent: Node/TypeScript on LiveKit with VAD, STT (Groq whisper-large-v3, fallbacks), the same chat stream, sentence-by-sentence TTS (Edge TTS, OpenAI tts-1, a local TTS server). Server: 4 vCPU, 8 GB RAM, no GPU, shared with the ERP.
Measured (7 days, Nov 2026): about 110 chat questions/day; streamed answers p50 2.7 s, p95 25 s, hard cut at 30 s; no per-stage timing logged. Retrieval gate (70 questions, older index): Recall@1 0.67, @5 0.86. Answer-level citation accuracy and abstention are not measured; the golden answer set has 10 unverified cases. As-of (law version by date) retrieval and a deterministic citation check are being built.

TASK R18 — design the fastest, most accurate and cheapest version of Smart Judge we can run on this hardware, with numbers.
1. Retrieval quality for Persian legal text: chunking by article/note (تبصره), Persian normalisation (ZWNJ, Arabic vs Persian letters, digits), hybrid search (bge-m3 dense + sparse/lexical, BM25 in Qdrant or Postgres), query rewriting, citation-graph expansion (amendments, repeals, references), as-of versioning of articles. Which combination gives the best Recall@5 on Persian legal benchmarks; any public Persian legal datasets or benchmarks.
2. Rerankers that run on 4 CPU cores: multilingual cross-encoders (e.g. bge-reranker-v2-m3, jina-reranker-v2-multilingual, mxbai, ColBERT-style late interaction), quantised ONNX/int8 latency for 20–50 candidates, quality on Persian.
3. Answer latency: target first token under 1.5 s and full answer under 8 s. Streaming, smaller/faster models for drafting vs verification, speculative or parallel retrieval, prompt and KV caching offered by free/cheap providers, semantic answer cache keyed by normalised question + law version, precomputed answers for the top 500 questions. Which free or cheap API models give the best Persian legal reasoning per second (compare Groq, Cerebras, Gemini Flash, DeepSeek, Qwen, Llama, GPT-OSS models) with current rate limits.
4. Faithfulness: deterministic citation verification against retrieved text, abstention rules, "unofficial source never stands alone", hallucination detection methods that work in Persian; how to build a 300–500 question golden set cheaply (lawyer-verified sampling, synthetic questions from articles) and run it nightly.
5. Voice: lowest-latency Persian STT (whisper-large-v3-turbo on Groq, other APIs, on-device options), Persian TTS quality and latency (Edge TTS, open-source Persian voices such as Piper, others), barge-in/VAD tuning, total turn latency budget under 1.5 s, telephony options (SIP trunks) and costs.
6. Observability: per-stage tracing for RAG (OpenTelemetry, Langfuse self-hosted under 1 GB RAM, or lighter), what to log per answer.
7. Code structure: our core module is one 350 KB Python file; a safe refactor plan into retrieval / generation / verification / voice adapters with tests.
RULES: CPU-only server, free-first model policy (paid only as fallback), open-source licences MIT/Apache/BSD; primary sources (papers, model cards, provider docs, repos) with dates; flag anything older than 12 months; give latency and cost numbers with their source; say when evidence is missing.
OUTPUT: a target architecture diagram in text, a table of changes ranked by (quality or speed gain) / effort, measured or sourced latency budget per stage, and a 4-week rollout plan with acceptance numbers.
```

---

## R19 — reuse map: open-source components for our planned rows

```
CONTEXT
We build "Roxira", a multi-tenant cloud ERP: NestJS + TypeScript backend, PostgreSQL 17 with row-level security per tenant, Next.js frontend, BullMQ/Redis, a Python FastAPI AI core, Docker Compose on one Linux server (4 vCPU, 8 GB RAM), CI on GitHub Actions. Licence policy: MIT, Apache-2.0, BSD, MPL-2.0 or similar; no AGPL/GPL inside the product, no source-available/BUSL. Small team; most code is written by AI coding agents, so a well-tested library beats writing our own when it fits.

TASK R19 — for each planned capability below, find the best existing open-source building block we could adopt instead of writing it, or say clearly that none fits and we should build.
Capabilities:
1. Double-entry ledger internals: gapless per-entity numbering and a hash-chained journal on Postgres (sequencer patterns, pg extensions, libraries); immutable audit tables.
2. Money and currency: exact decimal/bigint money in TypeScript with ISO 4217 minor units (0/2/3 decimals), FX conversion and rounding-residual handling.
3. Tax engine: effective-dated tax rules, reverse charge, withholding (any open rules engine or tax-code libraries usable from TypeScript).
4. Bank statements: CAMT.053, MT940, OFX parsers for Node/TypeScript; bank-transaction matching libraries.
5. E-invoicing: EN 16931 / XRechnung / ZUGFeRD / Peppol PINT generation and validation (KoSIT validator, Mustangproject, any maintained TypeScript libs); ZATCA (Saudi) signing and QR libraries for Node; Peppol access point software (phase4).
6. Germany: DATEV EXTF writers, GDPdU/GoBD export, ELSTER ERiC wrappers, E-Bilanz XBRL generation.
7. Fixed assets: depreciation schedule libraries (multiple books, declining balance).
8. Inventory costing: FIFO/AVCO/standard cost engines.
9. Reporting: a fast pivot/report engine over Postgres for financial statements by dimension.
10. Multi-tenant ops: feature-flag systems that run self-hosted with low RAM (OpenFeature providers, Unleash, Flagsmith, GrowthBook), error tracking that runs in under 300 MB RAM, Postgres migration linting, backup tooling (pgBackRest, WAL-G) versus our pg_dump + age + object storage.
11. Developer speed: faster TypeScript compile/lint/test toolchain (TypeScript native compiler, oxlint, Biome, SWC/Vitest for Jest suites) — measured speedups and migration risk for a NestJS codebase with Jest.
For each: candidate (name, repo URL, licence, last release date, stars/maintainers, production users), fit for our stack (TypeScript/Postgres/Docker, RAM), what we would still have to build, integration effort (days), risks (abandonment, licence, security), and a verdict ADOPT / TRIAL / BUILD with one sentence why.
RULES: primary sources (repo pages, release notes, licence files) with dates; flag anything without a release in the last 12 months; no AGPL/GPL/BUSL in the product; say when evidence is missing.
OUTPUT: one table per capability, then a ranked list of the 10 adoptions with the biggest time saving per effort.
```

---

## STAGE 2 (send after each report, in the same chat)

```
STAGE 2 — Act now as a skeptical senior reviewer of the report you just wrote.
1. Re-check every number, date, threshold and legal claim against a primary source. Table: claim | source URL | source date | VERIFIED / CHANGED (correct value) / UNVERIFIABLE.
2. List what the report missed that would hurt us in 12–24 months (at least 10), each with why it matters.
3. Turn it into a DECISION PACK: options, recommendation, one-off and monthly cost, effort, reversibility, what to do this month / 3 / 6 / 12 months, revisit trigger.
4. List open questions that need a human expert, each with the default you would choose.
Keep facts and recommendations separate. Do not repeat the original report; only correct, extend and decide.
```
