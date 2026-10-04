# Model and compute plan for many parallel agents at near-zero cost (4 Oct 2026)

Scope: solo developer, Mac + OmniRoute + free/cheap API keys + two manual subscriptions.
Read-only research. Flags: **VERIFIED** = read on the cited page during this session (2026-10-04);
**UNVERIFIED** = secondary source, estimate, or not checked. Existing repo research
(`AGENT_LANES_CAPACITY_2026-10.md`, `OMNIROUTE_EVAL.md`, `LEGAL_RAG_RESEARCH_2026-10.md`) is
referenced, not repeated. Model ids and prices stay in `config/models.yaml` (AGENTS.md §3).

## 0. Hardware and assets (measured)

| Item | Value |
|---|---|
| Machine | MacBook Air M4 (Mac16,12), 10 cores (4P+6E), **16 GB unified memory**, fanless (VERIFIED via system_profiler; `sysctl` is blocked in the sandbox) |
| Implication | About 10 GB usable for a model after macOS, Docker and agent processes. Fanless = sustained local inference throttles after several minutes (UNVERIFIED, general M-series Air behaviour). |
| Local runtimes installed | `ollama` not installed, no `~/.ollama` (VERIFIED) |
| Cloud keys | OpenRouter, Mistral, SambaNova OK; Groq 403 (excluded); DeepSeek balance; OmniRoute (502 models, loopback gateway, dev only) |
| Manual only | Gemini Pro, ChatGPT Plus (no automation) |
| Registry today | `config/models.yaml` (checked_at 2026-09-29): executor = DeepSeek v4.x flash; reviewer = Sonnet 5 / Gemini 3.8 flash / Qwen3-coder; mechanical = Gemini 3.1 flash-lite / Haiku 4.5; free = Qwen3.8-27b:free, Gemma 4 31B:free, Nemotron 3 Super:free |

## 1. Best models per role and limits

### 1.1 Provider limits that decide concurrency

| Provider | Limit | Status / source |
|---|---|---|
| OpenRouter `:free` | 20 req/min always; 50 req/day if lifetime credit purchases < $10, **1,000 req/day once >= $10 ever purchased** (permanent); negative balance gives 402 even on free models; honour `Retry-After` on 429 | VERIFIED [OpenRouter limits](https://openrouter.ai/docs/api-reference/limits) |
| OpenRouter free catalogue (Oct 2026) | ~20 ids, e.g. Qwen3.8 27B, Gemma 4 26B/31B, Nemotron 3 Super 120B / Ultra 550B, North Mini Code, Laguna S/XS 2.1, Ling 3.1 Flash; training/logging policy per provider not stated | catalogue VERIFIED via [costgoat list](https://costgoat.com/pricing/openrouter-free-models) (secondary); data policy UNVERIFIED, so treat every `:free` as logged/trained |
| SambaNova free tier (no card) | DeepSeek-V3.1, Llama-3.3-70B, gpt-oss-120b: **20 RPM, 20 RPD, 200k tokens/day each** model. Developer tier (card linked): 60 RPM / 12k RPD, 20M tokens/day total | VERIFIED [SambaNova limits](https://docs.sambanova.ai/docs/en/models/rate-limits). Per-model quotas, so rotating three models gives about 60 req/day and 600k tokens/day |
| Mistral | Free "Experiment" mode with included monthly usage; exact RPS/tokens shown only on console Limits page. Free tier historically allows training on inputs; opt-out and ZDR need paid | doc page VERIFIED but numbers absent; limits UNVERIFIED, read the console Limits page once |
| DeepSeek official | `deepseek-flash` (V4.1-Flash) $0.15-0.30 in (miss) / $0.60-1.20 out, cache-hit $0.003-0.006; `deepseek-v4-pro` $0.66-1.32 in / $1.98-3.96 out, 1M context; **half price off-peak**: peak is Mon-Fri 01-04 and 06-10 UTC; concurrency 2,500 (flash) / 500 (pro) | VERIFIED [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/). Data is processed in China: never customer/case data |
| Groq | blocked (403) | VERIFIED by `docs/ops/OPENCODE_KEYS.md` |

Rule that overrides everything (AGENTS.md §4): customer or case data never goes to `:free`, SambaNova free, Mistral free, DeepSeek official, or any OmniRoute combo that can fall through to one of them. Only synthetic or public legal text goes to those lanes.

### 1.2 Best per role (coding agents)

| Role | Pick (primary / fallback) | Why and price per 1M in/out | Evidence |
|---|---|---|---|
| architect | Claude Opus 5 via the Claude Code subscription (human-driven) / Gemini Pro and ChatGPT Plus by hand (task packets, §4) | Not billed per token; `billed_via_api: false` in registry | repo registry |
| executor (bulk) | `deepseek/deepseek-v4-flash-0731` ($0.018/$0.32) or `deepseek-v4.1-flash` ($0.30/$1.20); fallback Qwen3-coder, GLM 5.3 ($1.40/$4.40) | Cheapest coding-capable ids in registry, prices re-checked live 2026-09-29 (issue #103). A 20-turn agent task of ~300k in / 30k out costs about $0.015 on 0731 | registry VERIFIED; quality ranking UNVERIFIED (pending the repo's model-eval runs: GLM 5.3, Kimi K3 are candidates) |
| executor (hard) | `deepseek/deepseek-v4-pro` ($0.94/$1.87 OpenRouter) | 1M context, 500 concurrency on official API | VERIFIED pricing |
| reviewer | Sonnet 5 ($2/$10) for risky diffs; Gemini 3.8 flash ($0.75/$3.75) or Qwen3-coder ($0.30/$1.00) for routine. Different family from executor | registry rule: reviewer is never DeepSeek | registry |
| mechanical | Local model (§2) first; else `gemini-3.1-flash-lite` ($0.25/$1.50) | renames, formatting, summaries | registry |
| free (non-sensitive) | OpenRouter `qwen3.8-27b:free`, `gemma-4-31b-it:free`, Nemotron 3 Super; SambaNova free gpt-oss-120b / DeepSeek-V3.1 | crawler summaries, tagging, radar | VERIFIED limits above |

Independent coding-quality ranking of these exact ids was **not** established here (blog benchmarks conflict and several are vendor-adjacent). Use `docs/ops/BAKEOFF.md` / `TOURNAMENT.md` results as the tie-breaker before changing the registry.

### 1.3 Best per role (Persian legal text)

Evidence is thin: public Persian benchmarks found (FarSense, PersLitEval, TARAZ) test commonsense/literature, not law, and the ones surfaced rank **Gemini 2.5 Flash** best on Persian ([FarSense](https://aclanthology.org/2025.ijcnlp-long.187.pdf), [PersLitEval](https://arxiv.org/html/2605.27015)); they predate the current model generation, so this is UNVERIFIED for Oct 2026 models. No Persian legal LLM benchmark was found. Recommendation therefore rests on repo registry plus a local eval:

| Task | Pick | Notes |
|---|---|---|
| Customer chat, query rewriting (`cheap`) | `deepseek-v4-flash` family, `qwen3.8-flash`, `gemini-3.1-flash-lite` | as registry |
| Final legal drafting (`strong`) | `deepseek-v4-pro`, `gemini-3.8-flash`, `glm-5.3`, `kimi-k3` | run `docs/ops/RULING_EVAL.md` on Persian cases; Gemini family is the best prior for Persian fluency (UNVERIFIED) |
| Persian digits, citation form, article-number fidelity | deterministic post-processing, not a bigger model | already done (#478) |
| Anything with real case data | paid, non-training endpoints only (OpenRouter paid with provider pinning + ZDR, direct Mistral paid with opt-out) | never `:free` |

## 2. Local models on this Mac (16 GB M4 Air)

Constraint: memory bandwidth, not compute, caps decode speed; weights must fit in about 10 GB.
Tokens/s below are **UNVERIFIED estimates** from secondary sources ([stridenote](https://stridenote.net/best-local-llms-coding-2026/), [insiderllm](https://insiderllm.com/guides/best-local-llms-mac-2026/), [codersera](https://codersera.com/blog/apple-silicon-llms-complete-guide-2026/)) scaled for an M4 base (about 120 GB/s). Benchmark once with `ollama run --verbose` or `mlx_lm.generate` before relying on them.

| Model (4-bit) | Weights | Fits 16 GB? | Est. decode | Use |
|---|---|---|---|---|
| Qwen3-class 4B-8B coder/instruct | 2.5-5 GB | yes, with headroom | 25-45 tok/s | mechanical edits, commit messages, summaries, JSON extraction |
| Phi-4 14B | ~9 GB | tight | ~15-25 tok/s (32 tok/s reported on M2 Air, [source](https://pinggy.io/blog/top_5_local_llm_tools_and_models/)) | reasoning-light review |
| gpt-oss-20b (MoE, 3.6B active) | ~12-13 GB | marginal, swap risk with Docker | 20-35 tok/s | only if nothing else runs |
| Qwen3-Coder-30B-A3B / Coder-Next 80B-A3B | 19 GB / 45+ GB | **no** (needs 32-48 GB) | n/a | not on this Mac |

Runtime: MLX (`mlx-lm`) is modestly faster than Ollama on Apple Silicon (about 10-20% in [codersera](https://codersera.com/blog/apple-silicon-llms-complete-guide-2026/), UNVERIFIED); Ollama is simpler and OpenAI-compatible, so register it in OmniRoute/OpenCode as `http://127.0.0.1:11434/v1`. Local models reach only ~40-55% of frontier coding quality ([localaimaster](https://localaimaster.com/models/best-local-ai-coding-models), UNVERIFIED), so use them for mechanical work, never for architecture or merge-gating review.

Embeddings and reranking (local, Persian legal retrieval):

| Model | Size | Evidence | Role |
|---|---|---|---|
| `BAAI/bge-m3` (already in repo) | 567M, ~1.2 GB fp16, dense+sparse | FaMTEB: 59.1% avg, **best rerank 85.2**; Jina-v3 best retrieval 43.5 ([FaMTEB](https://arxiv.org/html/2502.11571)) | primary dense+sparse index; run via Ollama `bge-m3` or sentence-transformers on MPS |
| `jina-embeddings-v3` | 572M | FaMTEB best average 59.28% (same source); licence is CC-BY-NC, check before commercial use (UNVERIFIED) | A/B candidate for retrieval |
| `multilingual-e5-large` | 560M | 58.44% avg (same source) | fallback |
| `BAAI/bge-reranker-v2-m3` | ~570M cross-encoder | recommended in `LEGAL_RAG_RESEARCH_2026-10.md` | rerank top 20-50 locally; about 1-3 s per query batch on M4 (UNVERIFIED) |
| Persian-only (Tooka-SBERT, ParsBERT) | small | weaker overall than multilingual in FaMTEB | skip |

Embedding legal corpus locally is free and keeps case text on the device; it needs ~2 GB RAM so it coexists with a 4-8B chat model.

## 3. Parallelism plan

### 3.1 What actually limits concurrency

| Limiter | Capacity | Effect |
|---|---|---|
| Mac RAM/CPU | Each OpenCode/agent process ~0.3-0.6 GB plus git worktree; Docker (Postgres, OmniRoute, services) ~2-3 GB (UNVERIFIED) | **6-8 concurrent cloud-backed agent processes**; **1 local model server** (4-8B) shared by all, serialised to 1-2 concurrent generations |
| OpenRouter free | 20 RPM, 50/day (<$10 bought) or 1,000/day | Without the $10 top-up the lane is almost worthless (50 calls). One $10 purchase unlocks 1,000/day permanently (and the paid balance also funds DeepSeek-via-OR). Needs owner approval, since it is spending |
| SambaNova free | 3 models x 20 RPD = ~60 requests/day, 200k tokens/day/model | ~15-20 agent *turns* per day per model; use for short tasks only |
| Mistral free | Account specific | treat as ~1 RPS, a few hundred req/day (UNVERIFIED) until Limits page read |
| DeepSeek balance | 500-2,500 concurrent allowed; budget is money | the real workhorse: $1 buys ~50 executor tasks on 0731 pricing (estimate above) |
| Repo/CI | GitHub Team 3,000 Actions min/month shared (`AGENT_LANES_CAPACITY`) | cap simultaneous PR gates |

### 3.2 Concurrency numbers (recommended)

| Lane | Max concurrent | Daily budget |
|---|---|---|
| DeepSeek executor (paid, direct/OmniRoute) | **5** | $0.50-1.00/day soft cap (~25-50 tasks) |
| Local Ollama (mechanical, embeddings) | **2** generations + 1 embedding job | unlimited, thermal limited |
| OpenRouter `:free` | **2** (stay under 20 RPM; 1 req/4 s per agent) | 40/day unfunded, 900/day if funded (keep 10% margin) |
| SambaNova free | **1** | 50 req/day total across models |
| Mistral | **1** | until limits read, 100/day |
| Reviewer (different family, Gemini flash / Qwen3-coder) | **2** | $0.30/day |
| Opus/Sonnet via subscription | human only, 1-2 sessions | n/a |

Total: **about 8-10 agents in flight** (5 executors + 2 local + 2 reviewers + 1-2 free), all within a 16 GB Mac; start at 5 and raise only if `memory_pressure` stays green.

### 3.3 Queueing and backoff

1. One local queue (BullMQ/Redis already in the AGENTS.md stack, or a file-lock in `scripts/dev`) with a token bucket per lane: OR-free 15 RPM, SambaNova 15 RPM, Mistral 30 RPM, DeepSeek 60 RPM.
2. On 429/5xx: honour `Retry-After`, else exponential backoff 2 s, 4 s, 8 s with jitter, max 3 tries, then fail over along the lane order. On 402 (OpenRouter negative balance or in-flight budget) stop the lane for the day.
3. Failover order for non-sensitive work: local -> OR free -> SambaNova -> Mistral -> DeepSeek paid. For sensitive work: local or paid-no-train only; never fall through to a free lane (set OmniRoute combos to explicit lists, no `auto`).
4. Hard caps per task: <= 25 tool turns, <= 400k input tokens, one retry of a failed model call; abort and escalate instead of looping.
5. Schedule bulk non-urgent jobs on weekends or outside 01-04 / 06-10 UTC weekdays for the 50% DeepSeek discount.
6. Daily ledger: read `GET /api/v1/key` (OpenRouter free counters) and OmniRoute usage before starting a batch; stop at 80% of any cap.

### 3.4 Routing table

| Job | Tier | Model (registry role) | Data allowed |
|---|---|---|---|
| Architecture, schema, plan review | architect | Opus 5 (subscription) + manual Gemini/ChatGPT packets | repo only |
| Feature/bug PR, tests | executor | deepseek-v4-flash-0731 -> v4.1-flash | repo code, no secrets |
| Hard multi-file refactor | executor-hard | deepseek-v4-pro | repo code |
| Diff review | reviewer | Gemini 3.8 flash / Qwen3-coder; Sonnet 5 for security/migrations | diff only |
| Renames, formatting, docstrings, changelog, commit text | mechanical | local Qwen 4-8B, else gemini-3.1-flash-lite | repo code |
| Crawler summaries, tagging, SEO, radar | free | OR `:free`, SambaNova free | public data only |
| Embeddings / rerank | embedding | local bge-m3 + bge-reranker-v2-m3 | any, stays on device |
| Product chat/drafting | cheap/strong via prod keys (not OmniRoute) | per registry | customer data only on paid non-training endpoints |
| Customer/case data experiments | local only | local models | local only |

## 4. Manual subscriptions as task packets (no automation)

Do not script browsers, cookies or OAuth tokens for Gemini Pro or ChatGPT Plus (terms risk; also repo rule in `OPENCODE_KEYS.md`). Make human-paced work cheap for the human:

1. **Packet generator**: `scripts/dev/pack_agent_context.sh` (exists) builds one markdown file: goal, constraints, file list, acceptance tests, output format ("return a unified diff / a table / numbered findings"). One packet = one paste. Never include secrets or customer data (consumer plans may train; check each app's data setting and turn training off).
2. **Best uses for these seats**: (a) second-opinion architecture review in a different model family from the executors; (b) long-context reading (Gemini Pro) of large docs or the legal corpus excerpt for synthesis; (c) Deep Research reports on searchable legal or tooling questions, saved to `docs/research/`; (d) Persian-fluency spot checks of drafted legal text (public/synthetic only); (e) writing hard test cases.
3. **Return path**: paste the answer into `inbox/<date>-<topic>.md`; an agent then converts it into issues/diffs, so the human step is two pastes. Batch 3-5 packets per sitting to respect usage windows; Plus caps are windowed and vary by model (UNVERIFIED current numbers; see `AGENT_LANES_CAPACITY`, whose note about Iran-region support applies if relevant).
4. Treat output as untrusted input: it goes through the normal executor -> reviewer -> CI path.

## 5. Actions and decisions for the owner

| # | Action | Cost | Value |
|---|---|---|---|
| 1 | Install Ollama, pull a 4-8B Qwen-class model and `bge-m3`; benchmark tok/s and record real numbers here | $0 | replaces the estimates in §2 |
| 2 | Decide on a one-time $10 OpenRouter purchase | $10 | 50 -> 1,000 free req/day permanently |
| 3 | Read the Mistral console Limits page; add RPS/token numbers to §3.1 | $0 | removes UNVERIFIED |
| 4 | Run the bake-off on Persian cases for Gemini 3.8 flash vs DeepSeek v4-pro vs GLM 5.3 | few cents | picks the `strong` model on evidence |
| 5 | Build the lane queue with token buckets (§3.3) | engineering | enforces the numbers |

## Sources

[OpenRouter limits](https://openrouter.ai/docs/api-reference/limits) | [SambaNova limits](https://docs.sambanova.ai/docs/en/models/rate-limits) | [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/) | [Mistral limits overview](https://docs.mistral.ai/admin/user-management-finops/tier) | [OpenRouter free list](https://costgoat.com/pricing/openrouter-free-models) | [FaMTEB](https://arxiv.org/html/2502.11571) | [Hakim](https://arxiv.org/html/2505.08435) | [FarSense](https://aclanthology.org/2025.ijcnlp-long.187.pdf) | [PersLitEval](https://arxiv.org/html/2605.27015) | [local LLM roundups](https://stridenote.net/best-local-llms-coding-2026/), [insiderllm](https://insiderllm.com/guides/best-local-llms-mac-2026/), [codersera](https://codersera.com/blog/apple-silicon-llms-complete-guide-2026/), [localaimaster](https://localaimaster.com/models/best-local-ai-coding-models). Repo: `config/models.yaml`, `docs/ops/OPENCODE_KEYS.md`, `docs/research/AGENT_LANES_CAPACITY_2026-10.md`, `OMNIROUTE_EVAL.md`, `LEGAL_RAG_RESEARCH_2026-10.md`.
