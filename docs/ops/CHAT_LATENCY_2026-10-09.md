# Smart Judge chat latency, 2026-10-09

## Measured (read-only on prod, 24 h of `roxira_app_prod` logs, 2 test chats)

| Item | Result |
|---|---|
| Retrieval (`[SMARTJUDGE][RETRIEVAL-SLOW]`, n=308) | median 362 ms, p90 465 ms, p95 519 ms, max 3.95 s (2 outliers of ~3.8 s = cold embedder) |
| Retrieval is sequential | Qdrant exact lookup, then vector search, then SQL, one after another; every `Batches ... it/s` bar in the log is a separate bge-m3 encode (~0.3 s each) |
| `[CHAT-TIMING]` lines in prod | 0 (not yet deployed), so the LLM share is inferred: total 9 s median minus ~0.4 s retrieval |
| LLM call (old) | single non-streaming call, 16 s total timeout, no first-token budget, `max_tokens` 1500, no `reasoning` control, new TLS connection per request |
| Models | VIP = `strong[0]` deepseek-v4-pro (reasoning model), FREE = `cheap[0]` deepseek-v4.1-flash |
| **Incident** | The OpenRouter key has a **$3 daily limit** (`/api/v1/key`: limit 3, limit_remaining 0, usage_daily 3.95). Every LLM call returned HTTP 403 "Key limit exceeded"; the old code ignored non-200 and returned a **canned template answer with HTTP 200 in ~0.5 s** (2 test chats confirmed). Prod key and local key have the same sha prefix. |

Not measured: per-model TTFT/total time. The key was exhausted, and the coordinator then stopped all OpenRouter calls. Re-run the model comparison after the limit resets (UTC midnight) or after raising the limit; the new `[CHAT-TIMING] ttft_ms` field will give real numbers in prod.

## Changes

1. Streaming: `POST /api/v1/apps/judge/chat/stream` (all tiers, same auth, anonymous limits and request_id idempotency as `/chat`). Events `meta`, `delta`*, `done` (full `/chat` JSON), `error`. Failures before the first token keep their HTTP status and JSON. Completed request_id replays as one chunk. App sends `X-Accel-Buffering: no`; nginx `location /api/v1/apps/judge/` already has `proxy_buffering off` (no nginx change). The old VIP-only `/chat-stream` is untouched (used by `smart-judge-client.ts`).
2. LLM path: shared keep-alive httpx client, `stream=true`, first-token budget 12 s (strong) / 8 s (fast) then immediate fallback to the next registry model (was 16 s total then fail), 40 s total cap, `max_tokens` 1000 (env `SMARTJUDGE_CHAT_MAX_TOKENS`), `reasoning` off for cheap and low for strong (env `SMARTJUDGE_REASONING_CHEAP/STRONG`), `:free` ids refused for case data. Model ids only from `config/models.yaml` through the registry (no models.yaml change).
3. Retrieval: Qdrant exact+vector and SQL run in parallel (`asyncio.gather`), competence expansion queries in parallel, query-embedding cache and retrieval cache (10 min), embedder warm-up at startup, progress bar off, prompt context trimmed to top 4 rows x 600 chars (`SMARTJUDGE_CTX_TOPK/CHARS`).
4. Response: `statutory_basis` / `unified_precedents` carry title/category/number plus a 220-char `excerpt` instead of the full `summary`. DB persistence moved off the response path.
5. `[CHAT-TIMING]` now logs `embed_ms qdrant_ms sql_ms retrieval_ms ttft_ms llm_ms total_ms`.
6. No more fake answers: if every provider fails, `/chat` returns HTTP 503 `{status:"ERROR", code:"LLM_UNAVAILABLE", message:...}` with `Retry-After`, and logs `[LLM-UNAVAILABLE] provider=.. status=.. model=.. kind=quota|auth|timeout|upstream|error|no_key`. If `OPENROUTER_API_KEY_FALLBACK` is set, it is tried when the first key is out of quota or rejected.

## Expected after

First visible text: retrieval ~0.2 to 0.3 s (parallel, cached repeats near 0) plus TTFT of a non-reasoning fast model, expected 1 to 2 s (to be confirmed). Full answer median < 6 s, p95 < 12 s as long as the daily key limit is not exhausted.

## Risks / follow-ups

- Raise or remove the $3/day OpenRouter key limit and alert on `[LLM-UNAVAILABLE]`; consider a second key in `OPENROUTER_API_KEY_FALLBACK`.
- `reasoning` low for deepseek-v4-pro is untested; if answers degrade set `SMARTJUDGE_REASONING_STRONG=default`.
- Without `SMARTJUDGE_PROMPT_LIBRARY=1` the system prompt is the short "under 25 words" voice prompt even for text chat (prod has it unset). Not changed here.
- Per-process caches: with several uvicorn workers each has its own cache.
