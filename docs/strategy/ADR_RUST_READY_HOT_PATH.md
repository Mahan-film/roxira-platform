# ADR: Rust-Ready Hot Path for Smart Judge Retrieval (T211)

- **Status:** Accepted (2026-11-18)
- **Task:** #925 (T211)
- **Owner:** Smart Judge (L4)

## Context

Smart Judge's `/chat` and `/chat/stream` endpoints sit on the interactive user path.
Before T211:
1. Query embeddings were cached only in an in-process 10-minute `TTLCache`, so every
   worker restart or cold replica re-embedded repeated Persian legal queries.
2. Independent retrieval stages (primary knowledge-graph/Qdrant/SQL retrieval, catalog
   `latest_rulings`, and prompt-library domain expansion) ran sequentially in `_run_consult`.
3. `/chat/stream` waited for the first LLM token before returning `StreamingResponse`,
   causing 30s+ time-to-first-byte under cold retrieval and tripping the 30s client timeout.
4. Standard-library `json` serialized every SSE frame and API response.
5. Retrieval had no typed boundary separating FastAPI orchestration from a future Rust
   retrieval service.

## Decision

1. **Typed `RetrievalBackend` Protocol + JSON wire contract**
   (`output_apps/generated_modules/smartjudge/retrieval_contract.py`):
   - `RetrievalRequest` -> `RetrievalResponse` (`LawHit`, `PrecedentHit`, `RetrievalTimings`).
   - Any backend (the in-process `LocalRetrievalBackend` today, or a future Rust HTTP/UDS
     sidecar) implements `async def retrieve(self, request: RetrievalRequest) -> RetrievalResponse`.
   - Wire types are strict Pydantic JSON models with `RetrievalTimings` (`embed_ms`,
     `qdrant_ms`, `sql_ms`, `rulings_ms`, `regs_ms`, `total_ms`).

2. **Redis L2 query-embedding cache** (`legal_graph/lightrag_engine.py`):
   - Keys use `legal_tokenize.normalize` (Persian `ی`/`ک`, ASCII digits, collapsed
     whitespace) hashed with backend + embed model.
   - 7-day TTL (`SMARTJUDGE_EMBED_CACHE_TTL_S=604800`) and bounded size cap
     (`SMARTJUDGE_EMBED_CACHE_MAX_ENTRIES=10000` via a Redis ZSET eviction index),
     backed by the existing 512-entry in-process L1 `TTLCache`.

3. **Concurrent independent retrieval stages** (`smartjudge_module.py`):
   - Primary `aquery_knowledge_graph`, catalog `latest_rulings`, and competence-expansion
     queries execute concurrently via `asyncio.gather(..., return_exceptions=True)`.

4. **Immediate first SSE frame + 60s client timeout**:
   - `/chat/stream` returns `StreamingResponse` immediately and emits `event: meta`
     as the first frame, surfacing pre-delta failures as `event: error` with `status`.
   - `STREAM_FIRST_BYTE_TIMEOUT_MS` in `frontend/src/lib/api/chat-stream.ts` is `60_000`.

5. **`orjson` serialization** (`chat_fast.py`, `smartjudge_module.py`):
   - `ORJSONResponse` and `orjson.dumps` are used when `orjson` is installed, with a
     transparent stdlib `json` / `JSONResponse` fallback.

6. **Replay benchmark** (`eval/replay_benchmark.py`):
   - Measures per-stage `p50` and `p95` across a fixed Persian legal query corpus in
     both offline deterministic mode (CI) and live mode.

## Consequences

- A future Rust service (wrapping TEI + Qdrant + sparse/dense fusion) can be swapped in
  by implementing `RetrievalBackend` over HTTP/UDS with zero changes to `/chat`,
  `/chat/stream`, or frontend SSE parsing.
- No new runtime container is added in T211; existing Redis is reused with bounded keys.
