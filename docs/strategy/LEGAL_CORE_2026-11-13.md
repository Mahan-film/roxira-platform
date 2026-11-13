# Legal core: one brain for chat, phone, live voice and tax/accounting (2026-11-13)

**Owner directive (2026-11-13).** The Smart Judge legal intelligence serves:

- web/app chat
- the phone line and future live voice/video
- tax and accounting products (enterprise_hub)
- future agents

The goal is the best quality and the lowest latency at the lowest cost, built for 2–3 years. Direct (non-OpenRouter) providers come first; OpenRouter is only the fallback.

## Where we are (read from code, 2026-11-13)

**Brain.** It lives in `output_apps/generated_modules/smartjudge/smartjudge_module.py` (about 7.4k lines). `_consult_core` serves `/chat`, `/consult`, `/chat/stream` and `/contract-review`. The pipeline runs in this order:

1. Fast-path and small-talk.
2. Jurisdiction rules.
3. Quota.
4. `aquery_knowledge_graph`: Qdrant bge-m3 plus a lexical rerank, plus SQL, rulings and regulations.
5. Top-4 context of 600 chars each.
6. Key-pool gateway LLM.
7. `CitationHallucinationGuard`.

**Quality.** Measured answer quality is 40–49/100. The bake-off says retrieval and the prompt are the bottleneck, not the model (`docs/eval/ANSWER_QUALITY_PLAN_2026-10-21.md`).

**Reusable already:**

- the retrieval layer
- `POST /query` and `POST /citations/verify`
- `llm_gateway.py`
- `voice_stt.py` and `voice_tts.py`
- `model_registry.py`
- `jurisdiction_rules.py`, `source_filter.py` and `chat_safety.py`

**Coupled to web chat:**

- `_consult_core` mixes identity, persistence, quotas, prompt assembly and output format.
- The output is chat-shaped markdown, not typed claims.
- There is no `tenant_id` and no service-to-service auth.

**Two voice brains.**

- `ecosystem_core/src/factory/smartjudge_live_voice.py` calls OpenRouter directly with a hardcoded model. It has no gateway, no guard, no history and no cost tags, and it returns a canned legal sentence on error.
- The new edge phone agent (`services/voice_phone_agent`, PR #800) calls `/chat/stream`, so it already uses the real core.

**Tax/accounting.**

- `enterprise_hub` never calls Smart Judge. Its assistant, data_import and invoice_capture code calls OpenRouter directly, outside the key pool and its cost log.
- There is no legal or tax tool.
- The tax corpus is thin: Direct Taxes 1366 is unamended and VAT 1400 is missing.

**Streaming risk.** The citation guard runs after the stream, so users see unguarded deltas first.

**Data policy.** `config/ai_data_policy.json` is `test_accounts`. The Python chat gateway does not read it.

## Target shape

```
            channels (thin adapters)
  web chat ─┐  phone agent ─┐  live voice ─┐  enterprise_hub tools ─┐  agents ─┐
            ▼               ▼              ▼                        ▼          ▼
                 legal_core  /v1/legal/{answer (SSE), retrieve, verify}
   request: {question, channel, tenant_id, history, mode: chat|voice|tool, domain: law|tax}
   answer:  {text, spoken_text, claims[], citations[{law, article, collection_version, score}],
             grounded, model, prompt_version, trace_id}
            │ retrieval (Qdrant laws/regulations/rulings + iran_tax_v1, hybrid + rerank, Redis cache)
            │ LLM via key-pool gateway only (free-first ladders per plan/channel, models.yaml)
            │ citation guard per sentence (before it is streamed)
            └ audit row ai_answers (tenant, inputs hash, sources, model, cost)
```

Each channel only chooses `mode` and shape:

- **Voice:** short spoken text, around 200 tokens, the first sentence fast.
- **Chat:** full markdown.
- **Tool:** a JSON schema with citations.

## Moves, ranked by impact over cost (candidate WAVE 13+ tasks)

| # | Move | Main files | Why first |
|---|---|---|---|
| 1 | Extract `smartjudge/legal_core/` with the typed contract above. `_consult_core` becomes an adapter. | `smartjudge_module.py`, `chat_fast.py`, `prompt_library.py` | Every channel and future product depends on it |
| 2 | Voice on the core: gateway group `voice-fast`, `mode=voice`, history kept, guard on. Delete the second brain and its canned answer. | `smartjudge_live_voice.py`, `config/key_pool.yaml`, `config/models.yaml` | One quality bar; cost tags; rule compliance |
| 3 | Service auth plus tenancy: per-tenant service keys (the phone gateway in #799 is the first one), `tenant_id` and `channel` in the call context, auth on `/query` and `/citations/verify`. | `chat_auth.py`, `llm_gateway.py`, nginx | Required before enterprise_hub and partners call the core |
| 4 | enterprise_hub through the gateway and the core: one TS `LlmGatewayClient`, plus assistant tools `legal_lookup` and `tax_rule_lookup`. | `assistant-llm.service.ts`, `assistant-tools.service.ts`, `data_import/*openrouter*`, `capture-llm.service.ts` | Cost control, data policy, a legal edge in the accounting product |
| 5 | Guard per sentence before streaming, plus a `citations` SSE event. | `judge_chat_stream`, guard, frontend client | Removes the unguarded-delta risk; voice also needs it |
| 6 | Tax corpus `iran_tax_v1` (amended DTA 1366, VAT 1400, Moadian law and regulations, effective dates), plus a tax split in `legal_gate`. | `scripts/legal/*`, `regulations_retrieval.py`, `scripts/eval/legal_gate.py` | The tax product needs grounded answers |
| 7 | Turn on measured retrieval gains: hybrid sparse plus the reranker, top_k 4→8, Redis retrieval cache. Score each step on the gate. | `lightrag_engine.py`, `reranker.py` | Quality is retrieval-bound |
| 8 | Audit and data policy in Python: an `ai_answers` table (with a tenant column); the core drops may-log groups in production mode. | new migration, `llm_gateway.py`, `model_registry.py` | Trust and compliance for the business products |

The order is 1 → 2/3 in parallel → 4/5 → 6/7 → 8. Moves 6 and 7 can start any time because they touch other files.

## Phone line

- **Today:** the edge box in Iran (LiveKit plus SIP plus the Sabanet bridge) runs `services/voice_phone_agent`.
  - STT: Groq Whisper, about 0.9 s.
  - TTS: edge-tts Farid, 1.6–2.8 s per sentence.
- **Latency plan:**
  - streaming TTS
  - a sentence-level first answer from `mode=voice`
  - a turn-end model instead of the energy VAD
  - possibly speech-to-speech
- These will be decided after the deep research in `docs/research` comes back. The prompt is kept with the owner.
- **Cost guard:** the phone gateway's daily cap (`PHONE_GATEWAY_DAILY_LIMIT`, #799).

## Open questions (sent to deep research)

1. Persian STT on 8 kHz phone audio.
2. Persian streaming TTS: official vs edge-tts.
3. Persian speech-to-speech.
4. Time-to-first-token and free-tier terms of direct providers.
5. Persian legal embeddings and rerankers.
6. Moadian 1404–1405 changes, and machine-readable amended tax laws.
7. Persian JSON and tool calling on free tiers.
8. Iranian rules for an AI legal-advice phone line.

Answers will land in `docs/research/LEGAL_CORE_RESEARCH_2026-11.md`.
