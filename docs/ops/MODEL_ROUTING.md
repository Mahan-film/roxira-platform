# Model routing: free first, then cheap, then strong (issue #288)

One rule for every AI call in the repo: try free models first, then the cheapest paid
model, then a strong model only when the task needs it. The order, the data-class limits and
the daily cost caps live in **one place**: `config/models.yaml` (`tasks:` and `budgets:`).
Read them with `output_apps/generated_modules/smartjudge/model_registry.py`:

```python
model_registry.chain_for("assistant_chat")            # ordered steps, free first
model_registry.chain_for("selfimprove", mode="production")
model_registry.role_daily_cap_usd("cheap")            # USD per UTC day
model_registry.global_daily_cap_usd()
```

`chain_for` drops steps the data policy (`config/ai_data_policy.json`, #204) does not allow
for the task's data class. In `production` mode that removes every may-log / `:free` step for
tenant-business and personal data. A caller can make the class stricter, never looser.

## Status of this work

| Part | State |
|---|---|
| 1 Inventory | below (this PR) |
| 2 Provider check | below (this PR) |
| 3 Chains and caps in `models.yaml` | this PR (`tasks`, `budgets`, `chain_for`, tests) |
| 4 Route every call site through the router, served-model + cost log | next PRs, see "Call sites that still bypass the gateway" |
| 5 Events instead of polling | next PR |
| 6 Weekly cost line in the 12-hour digest | next PR (no new sender; it goes through `notify.py --queue`) |

## Existing routing layer (already in the repo)

- **Key pool**: LiteLLM gateway on `127.0.0.1:4000` (`config/key_pool.yaml`, `scripts/infra/key_pool/`).
  Groups are ordered ladders with fallbacks (`best-product-free` -> nothing, `vip-product` ->
  `best-product-free`, `agent-strong-free` -> `gemini-best` -> `agent-free-paid`, `private` = paid, no_train only).
  A 429 or failure cools a deployment down for 60 s and traffic moves on.
- **Cost log**: `scripts/infra/key_pool/cost_logger.py` (LiteLLM callback) writes one JSON line per request
  (served model, tokens, cost, latency, tier, answer id / feature / tenant / plan tags) to
  `/var/log/roxira-keypool/requests.jsonl`; `cost_report.py` summarises it (`--weekly-fa` for Persian).
- **Mac client**: `scripts/dev/llm_pool.py` calls the same groups directly with per-key cooldown.
- **Product entry**: `smartjudge/llm_gateway.py` picks the group per plan; `llm_router.py` keeps the direct
  OpenRouter path as a last fallback.

## Inventory: product runtime

| Task (`tasks:` key) | Code | Input size | Quality / latency need | Data class | Current model source | Chain (this PR) |
|---|---|---|---|---|---|---|
| `assistant_chat` | enterprise_hub assistant | short, tool calls | medium / interactive | tenant-business | gateway `best-product-free` | free, cheap, strong |
| `invoice_capture` | enterprise_hub `invoice_capture` | 1 image or text | OCR of Persian print / interactive | personal | free ladder, then `invoice_extraction` (gemini-3.8-flash) | free, invoice_extraction |
| `import_mapping` | enterprise_hub `data_import` (`openrouter-mapping`, `openrouter-vision` services) | headers + masked rows; image for scans | medium / batch | tenant-business | OpenRouter direct (`data-import.constants.ts`) | free, cheap, vision |
| `recon_classify` | bank reconciliation classification | one line per call | low / batch | tenant-business | not wired to a model yet | free, cheap |
| `smartjudge_chat` | `smartjudge/llm_router.py` via `llm_gateway.py` | question + RAG context (long) | high / interactive | personal | `best-product-free` (guests, free) | free, cheap, strong |
| `smartjudge_chat_basic/pro/premium` | same, per paid plan | same | high | personal | `vip-product`, `vip-pro`, `vip-premium` | plan role, then lower plans, then free |
| `smartjudge_draft` | `/drafts/ruling`, `/drafts/indictment` | long | highest / 60-150 s | personal | `drafting` ladder (fixed order) | drafting |
| `case_ocr` | `smartjudge/case_files.py` | scanned pages | OCR / batch | personal | `vision` (OpenRouter direct) | vision |
| `case_summarize` | key-pool `summarize-cheap` | very long | medium / batch | personal | not wired | summarize, cheap |
| `stt` | `smartjudge/voice_stt.py` | audio clip | Persian Whisper / 2 s | personal | `stt_direct` (Groq, Mistral, Gemini) then OpenRouter whisper | stt_direct, stt |
| `tts` | edge-tts (no API key) | text | n/a | public | `tts` | tts |
| `voice_realtime` | `gemini_live_bridge.py` | audio stream | live | personal | Gemini Live (off by default) | voice_realtime |

## Inventory: factory (public code and docs only)

| Task | Code | Current model source | Chain (this PR) |
|---|---|---|---|
| `fleet` | `scripts/dev/fleet.py`, `config/fleet.yaml` | `llm_pool.py` groups | free, cheap_agent, executor |
| `review_desk` | `scripts/dev/` reviewer, `output_apps/ecosystem_core/src/factory/review_gate.py` | OpenRouter direct | reviewer (other family than executor) |
| `dispatch_opencode` | `scripts/infra/server_agents/` (`run_task.sh`, `llm_client.py`) | `agent_runner` role, Groq first | agent_runner, cheap_agent |
| `selfimprove` | `scripts/ops/selfimprove/llm.py` | OpenRouter direct (`SELFIMPROVE_LLM_URL`) | free, cheap_agent |
| `radar` | `scripts/ops/radar/radar.py` | OpenRouter direct | free, cheap_agent |
| `law_watch` | `scripts/legal/law_watch.py` | OpenRouter direct | free, cheap |
| `marketing` | `scripts/marketing/mkt_llm.py`, `src/marketing_intelligence/` | mixed | free, cheap_agent |

## Call sites that still bypass the gateway (to move in next PRs)

They call `https://openrouter.ai/api/v1/chat/completions` directly with one key and no free-first order
(found with `grep openrouter.ai/api`; archived scripts and benchmarks excluded):

- Factory scripts: `scripts/ops/selfimprove/llm.py`, `scripts/ops/radar/radar.py`, `scripts/legal/law_watch.py`,
  `scripts/auto_review_system.py`, `scripts/infra/server_agents/llm_client.py`, `factory_engine.py`.
- ecosystem_core: `factory/llm_client.py`, `factory/review_gate.py`, `factory/swarm_orchestrator.py`,
  `agents/ai_router.py`, `ai/multi_model_llm_router.py`, `legal/live_legal_engine.py`, `crawlers/roxira_factory_core.py`.
- src/: `intelligence/providers/*`, `intelligence/models/smart_ai_router.py`, `automation/self_healing_agent.py`,
  `marketing_intelligence/*`, `roxira_manager/*/provider*.py`.
- Product: `smartjudge/case_files.py`, `documents/document_processor.py`, `legal_graph/lightrag_engine.py`,
  enterprise_hub `data_import` constants, and the OpenRouter fallback inside `llm_router.py`.

## Provider check, 2026-11-04 (Mac, no VPN)

`scripts/dev/check_keys.py` (key values never printed):

| Provider | Result |
|---|---|
| Mistral (4 keys), Groq (3), SambaNova (1), Gemini (4), Cloudflare (1) | OK |
| OpenRouter | **403 from the Mac's Iranian IP** (needs the VPN; srv1 is not affected) |
| OmniRoute | container not running on the Mac |
| NVIDIA NIM, DeepSeek direct, Chutes, Together, Fireworks | no key set on the Mac |

Free quotas to plan around (from `config/key_pool.yaml`, all still `status: unverified`): Groq 30 rpm / 1000 rpd per key,
Gemini AI Studio 10 rpm / 250 rpd per key, Mistral 60 rpm, OpenRouter `:free` about 1000 rpd with >= $10 credit.
Mistral's included usage is at 80% until 1 December (owner note, not measurable from the API).

`scripts/check_models.py` (OpenRouter catalogue): 15 ok, 12 skipped (non-OpenRouter), 28 flagged.

- **Missing from the live catalogue** (dead ids: every try is a wasted call): `qwen/qwen3.8-27b:free`,
  `nvidia/nemotron-3-super-120b-a12b:free`, `meta-llama/llama-3.3-70b-instruct:free`,
  `mistralai/mistral-small-24b-instruct-2501:free`. Live free ids today include `nvidia/nemotron-3-ultra-550b-a55b:free`,
  `nvidia/nemotron-3.5-lightning:free`, `nvidia/nemotron-3.5-super-vl:free`, `google/gemma-4-31b-it:free`,
  `google/gemma-4-26b-a4b-it:free`, `cohere/north-mini-code:free`. Replacing them touches the `free`, `reviewer` and
  `agent_runner_public` roles and the key pool; it needs the bake-off results, so it is a separate PR.
- **Price drift** (registry is lower than live): DeepSeek V4.1 Flash is now 0.045 / 0.50 per 1M (registry 0.036 / 0.405),
  Gemini 3.8 Flash 0.825 / 4.125 (registry 0.75 / 3.75), DeepSeek V4 Flash 0.0763 -> 0.091 in. GLM-5.3 output is lower
  (3.6 vs 4.8). The caps below have about 20% headroom for this drift.

## Daily caps (proposal, USD per UTC day, `budgets:` in `models.yaml`)

Global 2.00. Per role: cheap 0.40, strong 0.40, product 0.40, product_pro 0.40, product_premium 0.60, drafting 0.30,
vision 0.30, invoice_extraction 0.30, cheap_agent 0.20, executor 0.20, agent_runner 0.20, reviewer 0.10, summarize 0.10,
stt 0.10, mechanical 0.05; free and tts 0. The numbers are a starting point for the owner to change in that one file.
Enforcement (refuse or downgrade when a cap is spent) arrives with the router PR, reading `requests.jsonl`.

## Pool proof, 2026-11-05 (Mac, `scripts/dev/pool_proof.py`, key names only)

A working key check (`check_keys.py`, a models listing) does not mean chat works. Real chat calls through the pool:

| Provider | Keys (env names) | Chat result today | Roles / groups |
|---|---|---|---|
| Groq | `GROQ_API_KEY`, `_2`, `_3` (`_` and `_2` hold the **same key value**) | ok (gpt-oss-120b/20b, qwen3.8-27b; no Llama 4 listed any more) | agent-strong/light-free, best-product(-free) |
| OpenRouter free | `OPENROUTER_API_KEY_AGENTS` (ok), `OPENROUTER_API_KEY` (403/429 on free ids) | ok on nemotron-ultra and 3.5-lightning; gemma-4 and nemotron-super fail | best-product-free |
| OpenRouter paid | agents key, product key | ok (GLM-5.3 Flash, DeepSeek V4.1 Flash, Haiku 5.5) | agent-free-paid, vip-* , private |
| SambaNova | `SAMBANOVA_API_KEY` | 429 "high demand" | agent-strong-free |
| Mistral | `MISTRAL_API_KEY` .. `_4` (`_` and `_3` are the **same value**) | **402 API budget exhausted** (free quota is used up, not 80%) | agent-*-free, best-product |
| Gemini | `GEMINI_API_KEY` .. `_4` | 502/503 "high demand" today | gemini-best*, best-product |
| OmniRoute | `OMNIROUTE_API_KEY` | answers (rank 9, last resort; upstream auth errors seen earlier) | agent-free-paid |
| Cloudflare AI | `CF_AI_TOKEN` | not callable: `CF_ACCOUNT_ID` is not set | agent-*-free |
| NVIDIA NIM, DeepSeek direct | no key | skipped | candidates |

Order inside a group is by rank; same-rank keys of every provider share the load; a 429/402/auth/5xx/connection error puts that
key in cooldown and the next deployment takes over (`llm_pool.chat`, LiteLLM `cooldown_time` on the gateway). Duplicate key
values are collapsed (`dedupe_keys`) because two slots with one value share one rate limit.
**Forced-429 proof:** `pool_proof.py --failover groq` -> `GROQ_API_KEY_2 -> 429 (forced)`, then `GROQ_API_KEY_3 -> 200`, served by groq/gpt-oss-120b.

srv1 runtime pool has these env names set (names only): Groq x3, Mistral x4, Gemini x4, OpenRouter x2, SambaNova, CF_AI_TOKEN, Brave, Exa, Tavily (`TAVILY_KEYS`), Jina, Firecrawl. It has no DeepSeek, NVIDIA or OmniRoute. Nothing was copied between machines.
