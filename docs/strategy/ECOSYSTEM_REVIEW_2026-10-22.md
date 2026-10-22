# Review: "Total Ecosystem & Zero-Cost Strategy" proposal (2026-10-22)

The owner received an external proposal to give every service and key (3–4 accounts each) a role. This is the
hub's verdict after checking each claim against the code, the server env (key names only) and the live
OpenRouter catalogue. Rule applied: adopt only what fixes a real problem or measurably improves quality/cost;
every extra provider is another thing that can break (see QUALITY_SYSTEM_2026-10-22.md).

## Verified facts
- Keys present on srv1: Mistral ×4, Gemini ×4, Groq ×3, OpenRouter ×2, Tavily, SambaNova ×1, Exa ×1,
  Firecrawl ×1, Jina ×1, Qdrant Cloud ×1, Neon ×1, Daytona, Modal, R2, Cloudflare AI. **No** Chutes, Supabase,
  Zilliz or AssemblyAI key (AssemblyAI code exists in `voice_stt.py`, unused without a key).
- OpenRouter has `thinkingmachines/inkling:free` (1M ctx), `nvidia/nemotron-3.5-content-safety:free`,
  `recursive/flint-v1.0:free`, `dots-studio/dots-3-note-preview:free`. It has **no** "Nemotron Rerank 8B" or
  "Nemotron Embed 8B" model; our reranker is a local cross-encoder (`reranker.py`, customer text stays on host).
- Qdrant laws collection is on-disk; the container uses ~57 MB RAM. int8 quantization would save almost nothing.
- Already built: Codeberg mirror, Qdrant Cloud failover (`legal_graph/qdrant_cloud.py`), Neon off-site restore,
  R2 uploads, key-rotating LiteLLM pool, fast path, separate law / ruling / regulation collections.

## Decisions
| Proposal | Verdict | Why |
| --- | --- | --- |
| Codeberg mirror, R2 storage, Qdrant Cloud fallback, Neon off-site copy | Keep (already live) | — |
| Modal for Docling, Daytona for heavy batch jobs | Adopt (in progress: taskq 45, factory v2) | Moves heavy work off srv1 |
| Daytona for crawling Iranian government sites | **Reject** | Those sites block non-Iranian IPs; crawling runs on the owner's Mac relay (`ir.roxira.iranrelay`) for that reason |
| 3–4 keys per provider | Keep (owner-confirmed 2026-10-22: several keys/projects inside ONE account, checked against each provider's terms) | Spread across keys for resilience and per-key limits; rotate via the key pool; paid cheap models (DeepSeek) remain the last fallback |
| Supabase hot standby, Zilliz cold backup, 4 Qdrant clusters, 4 Neon projects | **Reject** | Duplicates existing backups, adds moving parts and data copies; no measured need |
| Tavily / Exa / Firecrawl live web search in the legal answer path | **Reject for answers**, keep for research agents | Legal answers must cite our vetted sources (ekhtebar, nezamat, qavanin); open web adds wrong or outdated law |
| Nemotron content-safety step on every request | Defer | Adds latency to every chat; `chat_safety.py` exists. Revisit with abuse data |
| Inkling:free 1M context for very long case files | Adopt as an experiment | Real gap (500-page files). Free + may-log is allowed for test data now (AGENTS.md §4); must pass the model bake-off before use |
| SambaNova as an extra fast fallback | Adopt in the registry (1 key) | Cheap resilience behind Groq |
| R2 lifecycle: delete temporary uploads after 14 days | Adopt | Keeps storage under the 10 GB free tier; needs the owner to add the rule in the Cloudflare dashboard (our token is object-scoped) |
| int8 quantization of local Qdrant | Reject now | ~57 MB RAM in use; no gain |
| Sending case files to many free providers | Reject | Spreads customer data; must be revisited before real paying customers anyway |
