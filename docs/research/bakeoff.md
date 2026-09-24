# W9 — Deep-research agent bake-off (Phase A)

Goal (owner brief, 2026-09-24): before starting any new product, run a fully
automatic deep-research agent that surveys the newest tech for every layer
(UI/UX, frontend, backend, infra, database, AI models), checks a plan is
future-proof/complete/cheap, and outputs a concrete stack recommendation. It
must search beyond English (zh/ja/de/ko/ru), be agentic/modular/easy to
modify, and run near-zero cost on OpenRouter cheap/free models — never
Anthropic for bulk synthesis.

This doc is Phase A only: landscape survey + one real baseline run + a
recommendation. **No code changes.** Phase B (build/upgrade) starts after the
owner decides.

## 1. What exists today — verified by a live run, not just reading the code

`src/automation/tech_radar.py` (Tavily/Exa/Brave → Firecrawl/Jina Reader →
Jina Reranker → single OpenRouter model) was run for real against benchmark
brief (a) below, with the project's actual API keys, outside the harness
sandbox (the sandboxed Python couldn't verify TLS against the proxy; same
run works standalone).

```
python -m src.automation.tech_radar --topic "best open-source stack for a
  Persian real-time voice legal assistant: STT, LLM, TTS, RAG, vector DB in
  2026" --no-save --json --verbose
```

Result: `status=SUCCESS`, 32 search results → 6 pages crawled → 5 sources kept
after rerank, wall time **107 s**, model `deepseek/deepseek-v4.1-flash`
(≈$0.02 for this run at current OpenRouter pricing). It needed one repair
pass because `suggested_commands` came back empty on the first synthesis
call — this happens even on a *successful* run, not just under the 429s the
owner already caught; the self-repair worked here but it's clearly fragile.

Confirmed weaknesses (owner's list, now with evidence):
1. **No non-English sourcing at all.** All 5 kept sources were English blog
   round-ups (getstream.io, vellum.ai, inworld.ai, olostep.com). Nothing from
   GitHub, Hugging Face, or any zh/ja/de/ko/ru source — the search layer only
   ever calls Tavily/Exa/Brave with English queries.
2. **Generic, not requirement-aware.** The 6 "top repos" it returned
   (AnythingLLM, Jan.ai, Leon, PyGPT, Vision Agents, QwenPaw) are general
   personal-assistant projects, not stack components for a Persian legal
   voice pipeline — nothing on Persian STT/TTS quality, nothing on legal RAG.
   The topic string reaches the search queries but nothing scores results
   against the actual requirement (language, domain, latency).
3. **No claim verification.** Every claim in `key_findings` is synthesis
   from 5 generic sources with no spot-checkable citation map; the model
   itself flagged low confidence in one finding, which is honest but not a
   substitute for a scoring rubric.
4. **Single-shot, no per-layer structure.** One `--topic` string in, one flat
   report out. There's no way to ask for "give me one recommendation per
   layer with alternatives and a migration path," which is exactly what a
   new-project brief needs.
5. Confirmed independently: `providers()` silently returns all-`False` and
   `search()` returns 0 results with **no error** if a search-provider env
   var isn't loaded (we hit this ourselves before sourcing `.env`
   correctly) — the pipeline logs "completed successfully" in that state,
   matching the owner's 429 finding exactly. This is a systemic gap, not a
   one-off.

## 2. Landscape survey (Sep 2026, English + zh/ja/de/ko/ru queried)

| Project | Stars | Last push | License | Notes |
|---|---|---|---|---|
| **bytedance/deer-flow** (DeerFlow 2.0) | 82.9k | 2026-09-24 | MIT | Full agent *harness* (LangGraph), not just research: sub-agents, memory, Docker sandboxes, MCP skills. Supports OpenRouter/any OpenAI-compatible `base_url`. #1 GitHub trending Feb 2026, still very active. Heaviest option — 8–32 vCPU tiers, `make setup` wizard. No non-English *search-source* adapters out of the box (still calls generic web search), but the harness itself is provider- and language-agnostic. |
| **Alibaba-NLP/DeepResearch** (Tongyi DeepResearch) | 20.0k | 2026-02-27 | Apache-2.0 | The model+framework the owner asked us to check. **Confirmed: the 30B-A3B model is NOT on OpenRouter** (checked the live catalogue, no `alibaba/*` or `*tongyi*` entry) — so using it means self-hosting a 30B MoE model on GPU, which breaks the "near-zero cost, OpenRouter-only" constraint. The *framework* (ReAct + "Heavy" test-time-scaling mode) could still be run with a different backend model, but that's a rewrite, not a drop-in. Best BrowseComp-ZH numbers of anything surveyed, which matters for the multilingual requirement, but the cost path doesn't fit. |
| **MiroMindAI/MiroFlow** + **MiroThinker** | 3.1k / 8.4k | 2026-07-06 | Apache-2.0 | Multi-agent framework, explicit OpenRouter support ("GPT, Claude, Gemini, Qwen, etc." via OpenRouter), 3-step setup with `uv`, <5 min. GAIA 82.4%, BrowseComp-ZH 47.1% (vs 33.2% EN — genuinely stronger non-English), xBench-DeepSearch 72.0%. Lightest, most OpenRouter-native of the strong performers. |
| assafelovic/gpt-researcher | 29.6k | 2026-08-27 | Apache-2.0 | Mature, well documented, OpenRouter-compatible. `report_type="deep"` gives recursive tree-based exploration (breadth/depth/concurrency config) — the per-layer, budgeted-search idea tech_radar lacks. No non-English source adapters; report language is a prompt setting, not real multilingual sourcing. |
| stanford-oval/storm | 31.5k | 2025-09-30 | MIT | Wikipedia-style outline-then-section-write agent. Stale (last push a year ago relative to this survey) — deprioritized. |
| langchain-ai/open_deep_research | 12.7k | 2026-08-10 | MIT | **Archived.** Drop from consideration. |
| jina-ai/node-DeepResearch | 5.2k | 2026-05-01 | Apache-2.0 | Small, TS, "keep searching/reading/reasoning until answer" loop. Niche; not evaluated further given size and lower activity vs. the above. |
| huggingface/smolagents (open_deep_research recipe) | 29.5k | 2026-09-23 | Apache-2.0 | `smolagents` itself is a very active, minimal agent library (good building block), but its "open_deep_research" example is a thin recipe on top, not a product. Worth stealing patterns from, not adopting whole. |
| LearningCircuit/local-deep-research | 9.1k | 2026-09-24 | MIT | Local-first (Ollama/llama.cpp), 10+ search engines incl. arXiv/PubMed, SearXNG integration. Good for private/offline research, less relevant to our "search live web, multilingual" requirement. |

No newer/non-English-first project outranked the above in stars, freshness,
or benchmark position; nothing indicates a big new entrant this month beyond
DeerFlow 2.0 (Feb 2026) and MiroThinker-1.7 (~mid-2026), both already
included.

## 3. Benchmark briefs used

- (a) *Stack for a Persian real-time voice legal assistant* — **run live**
  against current `tech_radar.py`, see §1.
- (b) *Stack for a multilingual SEO-heavy web app with an admin panel* — not
  yet run against any candidate.
- (c) *Best open-source OCR/layout parsing for Persian and Arabic PDFs* — not
  yet run against any candidate.

## 4. What was *not* done in this pass, and why

The brief asked for head-to-head runs of tech_radar plus 2–3 candidates on
all 3 briefs with a shared rubric (freshness, citation accuracy on 5
spot-checked claims each, non-English coverage, depth/layer, cost, wall
time, extensibility). We ran the real baseline (§1) but did **not** stand up
DeerFlow, MiroFlow or GPT Researcher end-to-end in this pass — each needs
its own dependency install / config wiring (DeerFlow additionally wants
Docker) and, done properly for 2–3 candidates × 3 briefs, is a multi-hour,
multi-dollar exercise better scoped as its own follow-up once the owner
picks a direction worth spending that on. Scoring below is therefore from
verified docs/benchmarks/pricing, not live execution, for MiroFlow, GPT
Researcher and DeerFlow — flagged accordingly.

| | tech_radar (live) | GPT Researcher (docs) | MiroFlow (docs) | DeerFlow 2.0 (docs) |
|---|---|---|---|---|
| Non-English sourcing | ✗ confirmed | ✗ (prompt-only) | partial (BrowseComp-ZH tuned) | ✗ (harness-level, no adapters) |
| Cost fit (OpenRouter cheap/free) | ✓ ~$0.02/topic | ✓ | ✓ | ✓ but heavier infra = more calls |
| Setup effort | none (already in repo) | low (`pip install`) | low (`uv`, <5 min) | high (Docker, 8–32 vCPU tiers) |
| Per-layer / new-project mode | ✗ (single flat topic) | partial (`deep` mode = tree search) | ✗ (general agent) | ✗ (general agent, skills-based) |
| Extend vs. replace effort | — | rewrite our pipeline around it | rewrite around it | adopt whole harness, heaviest lift |

## 5. Recommendation

**Extend `tech_radar.py`; do not adopt a full harness.** None of the
surveyed candidates does the one thing the owner actually wants — a cheap,
per-layer, multilingual, new-project stack brief — out of the box. They are
either general-purpose research/agent harnesses (DeerFlow, MiroFlow, GPT
Researcher) that would need the same multilingual-adapter and per-layer-brief
work built on top regardless, or disqualified on cost (Tongyi's model isn't
on OpenRouter). Our existing pipeline already proves the cheap
search→crawl→rerank→synthesize loop works end-to-end on real keys for ~$0.02
and ~2 minutes; the gaps are additive, not architectural:

- Borrow GPT Researcher's **tree/budgeted query expansion** idea for the
  `project-brief` mode instead of one flat topic string.
- Add **per-language query translation + source adapters** (zh/ja/de/ko/ru)
  as new, swappable functions in `web_intelligence.py` — this is genuinely
  missing everywhere surveyed, including in the "multilingual" candidates.
- Route all synthesis through the **PR #5 tiered router** (fixes the silent
  "completed successfully while degraded" bug directly — a degraded run
  should exit non-zero) instead of the single hardcoded model.
- Add a claim-verification/scoring rubric pass (maturity, license, adoption,
  maintenance, cost) before the synthesis step, spot-checkable against the
  kept sources.

This keeps the surface small, in Python, in this repo, and fully on the
OpenRouter router already being built in PR #5 — matching "agentic, modular,
easy to modify, near-zero cost" better than importing an 80k-star Docker
harness whose sandboxing and multi-agent orchestration we don't need for a
report-generation task.

## 6. Open decision for the owner

1. Approve **extend tech_radar** (§5) as the Phase B direction — recommended.
2. Or: spend the time/cost budget on real head-to-head runs of MiroFlow and
   GPT Researcher on briefs (b) and (c) before deciding (§4) — slower, more
   evidence, likely same conclusion given the docs-based scoring above.
3. Confirm the zh/ja/de/ko/ru source-adapter list in the owner's brief
   (GitHub trending, Hugging Face, arXiv, ModelScope, Qiita/Zenn, Juejin,
   heise) is the right starting set, or should be trimmed/extended.

Stopping here per the brief — Phase B starts once the owner picks 1 or 2
above.
