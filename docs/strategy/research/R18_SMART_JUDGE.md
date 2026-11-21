# Research R18 — Smart Judge v2 (digest)

Source: the owner's deep-research run R18, received 2026-11-19. Raw report, unchanged: `R18_SMART_JUDGE_RAW.md` (about 85 KB; treat as input, not as verified fact). Rows T234-T258 are GitHub issues #973-#997 (label `research-row`, "Done when" spec in each body).

## Decision (main hub, 2026-11-20)
Adopt the report's **Option 2**: a phased Smart Judge v2 on the current shared server. The trigger to move Smart Judge to its own server is the ERP guard alert in T254; moving and paying for a server stays the owner's decision. The free-first model spine stays (`config/models.yaml`); paid models only as fallback.

## Not adopted now
| Item | Reason |
|---|---|
| New paid or credit-based vendor accounts for voice (Deepgram, Azure Speech) | Free and local paths first; revisit after the T250/T251 measurements. |
| Langfuse | Too heavy for the 8 GB host; `rag_traces` in Postgres instead (T245). |
| Semantic L2 answer cache on by default | A wrong legal answer is worse than a slow one; ships with the flag off (T244). |
| Speculative multi-draft generation | Multiplies free-tier token use. |
| Full 150K-250K corpus now | Grow to about 500 laws first (T257), measure, then decide. |
| Global GraphRAG community summaries | Weak on unanswerable questions; we use 1-hop citation expansion (T243). |

## Kept from the stage 2 review
- Every vendor claim the report marks UNVERIFIABLE is checked live first (T240), the way R19 caught the false pgBackRest claim.
- Licence policy: only MIT, Apache, BSD or PostgreSQL licences at runtime, enforced in CI by T252.
- PII is scrubbed before any external model call (T239).
- Open human-expert question: disclaimer wording goes to the lawyer later; the default wording ships in T258.

## Targets
- Web: first token <= 1.5 s p95; full answer <= 8 s p95 (stretch 6.5 s).
- Voice turn <= 1.5 s p50.
- Recall@5 >= 0.95 on the 70-question gate after T241.
- Recall@5 >= 0.93 on the 300-500 question golden set at about 500 laws.

## Rows
| T | Issue | Lane | Prio | Title | Depends |
|---|---|---|---|---|---|
| T234 | #973 | L4 | 1 | SSE keepalive and no 30 s chat cut | - |
| T235 | #974 | L4 | 1 | BGE-M3 INT8 ONNX query encoder with pinned threads | - |
| T236 | #975 | L4 | 1 | LLM router hygiene: effort pins, static prefix, per-user cap | - |
| T237 | #976 | L4 | 1 | Symmetric Persian normalisation with display and search fields | - |
| T238 | #977 | L4 | 1 | Authority tiers and "unofficial never stands alone" gate | T237 |
| T239 | #978 | L3 | 1 | Persian PII scrubber before any external model call | - |
| T240 | #979 | L4 | 1 | Live check of every R18 vendor claim | - |
| T241 | #980 | L4 | 1 | Qdrant hybrid: native BM25 + dense + sparse with as-of filters | T237, T240 |
| T242 | #981 | L4 | 2 | Replace the 1.5 s cross-encoder with BGE-M3 ColBERT MaxSim | T235, T241 |
| T243 | #982 | L4 | 2 | 1-hop citation-graph expansion in Postgres | T241 |
| T244 | #983 | L4 | 2 | Version-safe answer cache L0/L1 with amendment invalidation | T237 |
| T245 | #984 | L4 | 2 | Per-answer RAG trace table and stage timings | - |
| T246 | #985 | L4 | 1 | Deterministic post-answer verifier: temporal, numeric, authority | T238 |
| T247 | #986 | L4 | 1 | Golden set to 300-500 questions with lawyer queue | - |
| T248 | #987 | L7 | 1 | Nightly Smart Judge eval on roxira-ci | T247 |
| T249 | #988 | L7 | 3 | Async Persian NLI faithfulness audit on the box | T248 |
| T250 | #989 | L7 | 1 | Phone agent: fast STT path and VAD/barge-in tuning | T245 |
| T251 | #990 | L7 | 2 | Phone agent: local Persian TTS and spoken-number normaliser | - |
| T252 | #991 | L1 | 1 | Runtime licence gate in CI | - |
| T253 | #992 | L1 | 2 | Redis to Valkey (BSD) with AOF | - |
| T254 | #993 | L1 | 1 | Smart Judge resource caps and ERP guard alert | - |
| T255 | #994 | L4 | 1 | Strangler-fig refactor part 1: characterization tests and pure leaves | - |
| T256 | #995 | L4 | 2 | Strangler-fig refactor part 2: retrieval, cache, generation, adapters | T255 |
| T257 | #996 | L4 | 2 | Corpus growth 60 -> 500 laws with weekly amendment ingestion | T241, T247 |
| T258 | #997 | L4 | 2 | Multi-turn fact tracking and query condensation | T236 |

## Order per lane
- **L4 (Mac):** T240, T234, T237, T236, T235, T238, T255, T246, T247, T241, T244, T245, T243, T242, T258, T256, T257.
- **L7 (box roxira-ci):** T250 and T251 after #959 (phone deploy kit); T248 after T247; T249 last.
- **L1 (Mac):** T252, T254, T253.
- **L3 (Mac):** T239.
