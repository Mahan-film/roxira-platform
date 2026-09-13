# SYSTEM STATUS

**Reported at:** 2026-09-10
**Scope:** Health check of core HTTP endpoints

## Summary

| # | Endpoint | HTTP Status | Response Time | Content-Type | Result |
|---|----------|-------------|---------------|--------------|--------|
| 1 | `http://127.0.0.1/` | 200 | 6 ms | `text/html; charset=utf-8` | OK |
| 2 | `http://127.0.0.1/api/v1/apps/judge/health` | 200 | 25 ms | `application/json` | OK |
| 3 | `http://127.0.0.1/api/backend/enterprise-hub/damages` | 200 | 19 ms | `application/json; charset=utf-8` | OK |

**Overall:** All 3 endpoints are healthy and responding with HTTP 200.

## Endpoint Details

### 1. Root UI — `http://127.0.0.1/`
- Serves the Next.js UI layer (`text/html`).

### 2. SmartJudge AI Core — `/api/v1/apps/judge/health`
- `status`: `ONLINE`
- `engine`: Roxira SmartJudge Dual-Level GraphRAG (Qdrant Vector + PostgreSQL Graph + OpenRouter LLM)
- `llm_configured`: `true`
- `stt`: `local-faster-whisper` (`groq_stt_configured`: `false`)
- Vector collections: `iran_laws_bge_m3`, `judicial_precedents`, `judiciary_circulars`, `legal_advisory_opinions`
- Graph relations: `MODIFIES`, `EXCEPTS`, `GOVERNS`, `REFERENCES`
- Graph DB: `postgres_prod:5432` — 20 nodes / 6 edges
- Retrial module: free quota 1; case types `CRIMINAL_474`, `CIVIL_426`, `SPECIAL_477`

### 3. Enterprise Hub — `/api/backend/enterprise-hub/damages`
- Response: `{"data":[],"total":0,"page":1,"limit":20}`
- Endpoint reachable; no damage records returned (empty dataset).

## Notes
- Checks performed via `curl` against `127.0.0.1` on the host.
- No failures detected.
