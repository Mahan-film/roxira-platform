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
| 4 Router with fallback, caps, served-model + cost log | `scripts/dev/llm_route.py` (PR for #288, review desk first). Product direct-OpenRouter sites and the other factory scripts still to move |
| 5 Events instead of polling | cost log is already a LiteLLM callback (`cost_logger.py`); BullMQ events not done yet |
| 6 Weekly cost line in the digest | `scripts/ops/kpi/weekly_report.py` queues ONE line with `notify.enqueue_report` (no new sender) |
| Policy (PRODUCT_DECISIONS section 5) | `smartjudge/routing_policy.py` + `routing:` in `models.yaml`: cache, confidence < 0.80 escalation, 25-50 line micro-batches, off-peak 19:30-03:30 Tehran, token budgets |

## Why the review desk got "Access denied by security policy" (2026-11-04)

OpenRouter answers `403 {"error":"Access denied by security policy."}` to **blocked egress IPs**: from the Mac without
the VPN even the public `GET /api/v1/models` returns 403, while srv1 returns 200. It is not the account privacy
setting, not the #204 allowlist and not `opencode.json`. Fix: (1) turn the VPN on, or (2) use
`python3 scripts/dev/llm_route.py --diff FILE`, which falls back automatically: OpenRouter DeepSeek -> the srv1 key
pool over ssh (`private` group, DeepSeek, key stays on the server) -> DeepSeek API (`DEEPSEEK_API_KEY`) -> free
non-Claude models (gpt-oss-120b on Groq/Cerebras, Mistral Medium; public diffs only). Qwen3 Coder is not used: the
owner banned Qwen Coder everywhere. `dispatch_opencode.sh` now fails fast with this hint instead of printing "Forbidden".

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
| Cerebras, NVIDIA NIM, DeepSeek direct, Chutes, Together, Fireworks | no key set on the Mac |

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

## Cost-saving policy (PRODUCT_DECISIONS_2026-11 section 5)

Order: cache, free, cheap, strong (escalate only when `confidence_score` < 0.80). Prefix caching: keep the fixed
chart-of-accounts / Moadian rules prompt first in every request. Bank lines go 25-50 per call. Batch tasks
(`offpeak_tasks`) wait for 19:30-03:30 Tehran (16:00-00:00 UTC), DeepSeek's 50% window. Token budgets per tenant and per
task live under `routing.token_budgets`. Customer documents and bank statements never reach a may-log free tier: that
is `chain_for(..., mode="production")`, so **flip `ai_data_policy.json` mode to `production` before the first real
customer** (tests pin that invoice, case OCR, import and reconciliation tasks keep no `:free` step in production).
