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
| SambaNova as an extra fast fallback | Adopt, up to 4 keys (superseded by the owner decision below) | Cheap resilience behind Groq |
| R2 lifecycle: delete temporary uploads after 14 days | Adopt | Keeps storage under the 10 GB free tier; needs the owner to add the rule in the Cloudflare dashboard (our token is object-scoped) |
| int8 quantization of local Qdrant | Reject now | ~57 MB RAM in use; no gain |
| Sending case files to many free providers | Reject | Spreads customer data; must be revisited before real paying customers anyway |

## Owner decision (final), 2026-10-22: use every key

The owner decided to use **every API key he has, on every provider**, both as fallback and concurrently. He
holds 3–4 keys per provider inside one account and sets each key's limit himself. Implemented in
`config/key_pool.yaml` (docs/infra/KEY_POOL.md):

- Every provider has 4 key slots (`NAME`, `NAME_2`, `NAME_3`, `NAME_4`); unset slots are skipped when the gateway
  config is rendered, so a provider with no key is inert. Added slots: Groq `_4`, SambaNova `_2.._4`, OpenRouter
  agents `_2.._4` and product `_2.._4`.
- New providers (each inert until a key is set; model ids marked unverified until the inventory probe passes on
  the server): Cerebras, NVIDIA NIM (build.nvidia.com), Cloudflare Workers AI (`CF_ACCOUNT_ID` + `CF_AI_TOKEN*`),
  DeepSeek direct API, Chutes, Together, Fireworks. The last four are paid and only sit in paid steps.
- Within a ladder rank, all keys of all providers serving that model share the load (weighted simple-shuffle;
  weight = the key's rpm unless the owner sets `limits_per_key`). A 429 or error cools that one deployment for 60 s
  and traffic moves on; when the whole rank fails the ladder drops to the next rank. Ladders still end where they
  did: product ladders on the product key (`private`), agent ladders on paid DeepSeek, free users never on paid.
- Data policy unchanged (AGENTS.md section 4): free / may-log providers are allowed for product traffic while all
  customers are test accounts; the `private` group still refuses every free or may-log provider (DeepSeek direct
  included) and uses only product-workspace OpenRouter keys with `data_collection=deny`.
- Inventory and health: `python3 scripts/infra/key_pool/inventory.py` lists which slots are set (names only);
  `--probe` sends one 1-token call per set key.

This supersedes the "Sending case files to many free providers: Reject" row above for test-account data only;
that row applies again before real paying customers with confidential data.
