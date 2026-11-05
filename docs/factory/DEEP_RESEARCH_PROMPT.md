# Deep-research prompt: next-generation agent factories and legal-AI architecture

مالک عزیز: این متن را کامل در ابزار Deep Research (Claude، ChatGPT یا Gemini) پیست کنید؛ خروجی را به هاب بدهید تا راستی‌آزمایی شود.

---

You are a senior AI-platform architect doing deep research. Browse the web, cite a URL and a date for
every factual claim, and mark anything you could not verify as UNVERIFIED. Prefer primary sources
(official docs, repos, release notes, papers) over blogs. Today is 2026-10-12; ignore tools whose last
release is older than six months unless nothing better exists.

## Who I am and the constraints

- A solo owner/operator building **Roxira / Smart Judge**: a Persian-language legal AI assistant
  (statute retrieval with citations, case analysis, drafting of petitions, indictments and rulings)
  for Iranian lawyers and the public.
- Stack: Python/FastAPI AI core (Qdrant vectors, PostgreSQL with a graph/CTE layer, LLM router with
  role tiers free/cheap/strong), NestJS + TypeScript enterprise app, Next.js + Tailwind + shadcn UI,
  Redis, Nginx, Docker Compose on one Hetzner VPS (Germany). The owner works from **Iran**: some
  vendors are blocked or refuse Iranian accounts (Anthropic API/claude.ai regions list, Groq 403,
  GitHub risk). Payments via Zibal, SMS via Kavenegar.
- Builder tooling today (on a 16 GB Mac): Claude Code (Opus as strategist, Sonnet/Haiku subagents),
  OpenCode, Aider, Goose, RTK output compression, OmniRoute and LiteLLM gateways, OpenRouter
  (DeepSeek V4.1 Flash as default paid executor, $0.30/$1.20 per 1M tokens), Mistral/Groq/SiliconFlow
  free or cheap keys, qmd, engram, codebase-memory MCP, a home-grown `rx` issue-to-PR worker and an
  autonomy ladder L0 to L4. GitHub Actions is off (zero-spend), CI runs locally.
- Budget: **builder tooling under about $25 per month on API spend** plus the Claude subscription;
  product runtime LLM spend must stay a small fraction of subscription revenue (target below 20%).
- Policy: cheap models first; `:free` models only for public, non-customer data; never Gemini Pro;
  customer/case data never to free-tier or log-and-train providers; no migrations without review;
  every table has a tenant column. Persian text, RTL, Jalali dates, Persian digits matter.
- Legal domain: Iranian statutes (civil, criminal, procedure, commerce, labour), court rulings,
  official gazette. Sources are scattered (ekhtebar.ir, qavanin.ir, majlis, rrk.ir); several block
  foreign or automated access. Current corpus: about 1,444 articles from 17 laws. A lawyer must sign
  off on repeals and benchmark answers.

## Part A: agent factories and developer tooling

Evaluate, for a one-person team, the best current options for (1) headless coding agents driven by
cheap models, (2) orchestrators that turn a brief into small PRs with tests and review, (3) gateways
and routers for many providers with budget caps, and (4) code-context tools (graph, search, memory).
Compare at minimum: OpenCode, Goose, Aider, Crush, Claude Code/Agent SDK, OpenHands, DeepSeek Harness
(dsh), Codex CLI, Gemini CLI, Cline/Roo/Kilo, Plandex, Hermes Agent, DeerFlow, LangGraph, OmniRoute,
LiteLLM, Portkey/Helicone/OpenRouter native features, graphify, codebase-memory-mcp, Serena, Sourcegraph/Amp,
and anything newer you find. For each: license, maturity, headless/CI use, MCP support, per-agent
permissions, cost controls, Iran-accessibility, security record (supply-chain, prompt-injection incidents).

Answer:
1. What is the best 2-tool or 3-tool combination for my constraints, and what would you retire?
2. Which tools measurably beat DeepSeek V4.1 Flash + OpenCode for mechanical batch edits per dollar?
   Give benchmark evidence (SWE-bench variants, Aider polyglot, Terminal-Bench) and caveats.
3. How do others implement reviewer-model-family separation, test-tampering detection, and
   reward-hacking defences in autonomous PR pipelines?
4. Best practice for prompt caching, context packing and token budgets across DeepSeek, Anthropic,
   Mistral and OpenRouter; per-key daily limits and spend dashboards.
5. How to keep the factory vendor-neutral (no lock-in) and robust to a provider suddenly refusing
   Iranian accounts. Include a fallback ladder.
6. Safe local gateway practice: risks of aggregating dozens of free web-scraped providers, key custody.

## Part B: legal-AI platform architecture

1. State of the art for Persian/Arabic-script legal RAG: embeddings (bge-m3, multilingual-e5, Jina,
   Persian-specific), rerankers, chunking by article/clause, hybrid BM25 plus vector, graph-of-citations
   retrieval; what benchmarks exist for Persian legal text; recommended 50-question evaluation design.
2. Citation faithfulness: techniques to guarantee every cited article exists and is in force
   (citation guards, abrogation tracking, versioned law graphs); how LexisNexis/Harvey/CoCounsel-style
   products and open projects do it; failure modes and measured hallucination rates.
3. Best models for Persian legal reasoning at low cost today (DeepSeek, Qwen, GLM, Kimi, Gemini Flash,
   Mistral, others): evidence of Persian quality, price per 1M tokens, and when a strong tier is
   justified. Include self-hosted options that fit a single GPU-less VPS vs a rented GPU.
4. Corpus acquisition under access restrictions: lawful ways to crawl Iranian legal sources from a
   non-Iranian server, Wayback/Common Crawl usage, OCR for scanned gazettes (Tesseract fas, Surya,
   Docling, vision LLMs), crawl4ai/Firecrawl trade-offs, rate-limit etiquette.
5. Architecture patterns for multi-tenant legal SaaS: tenant isolation in Postgres (RLS vs repository
   checks), audit logging, data retention, encryption, handling of privileged client data and
   the Iranian legal/regulatory context (data localisation, Enamad, lawyer-client confidentiality).
6. Voice and drafting UX: Persian STT/TTS options (Whisper variants, Gemini Live, edge-tts), drafting
   workflows (guided chat, templates, court-specific formats) that lawyers actually adopt.
7. Regulatory and liability: disclaimers, unauthorised-practice-of-law boundaries relevant to Iran,
   and how comparable products position themselves.

## Output format

- A one-page executive summary with a clear recommendation per question.
- Tables (tool, verdict ADOPT/TRIAL/SKIP, cost per month, risk, source URLs).
- A 30/60/90-day plan sized for one person and under the stated budget.
- A section "What I could not verify" listing every UNVERIFIED claim.
- No marketing copy; flag star counts and benchmark claims that come from vendor pages.
