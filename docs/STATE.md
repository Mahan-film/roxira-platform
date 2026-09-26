# Current state (read this first)

Short snapshot for a new chat. `docs/STRATEGY.md` explains **why**; this file says **where we are now**. Every chat updates it through `/handoff`. Keep it under 100 lines. Last update: 2026-09-26 (hub).

## Live and working
- **Repo:** `Mahan-film/roxira-platform`. Private, GitHub Team. The `main` ruleset requires a PR plus the checks `Detect changes`, `Secret scan`, `Pytest (unit)`. 0 approvals required.
- **Production** (`5.75.200.67`): runs main @ `f286378` (deployed 2026-09-26). Only 22/80/443 are reachable from outside. The LLM router flag is **off**. Streaming TTS is **off**.
- **Cheap agent lane:** an issue labelled `agent` → OpenCode on Actions (`deepseek/deepseek-v4.1-flash`) → PR → CI → `agent-review` (`anthropic/claude-sonnet-5`) → auto-merge gate. Proven on #42→#45. Repo variables: `AGENT_ENABLED`, `AUTO_MERGE_ENABLED`, `AGENT_REVIEW_MODEL`. Budget: the OpenRouter key's daily limit.
- **Model registry:** `config/models.yaml` is the only place model ids live. Swaps go through `model-eval.yml`. 2026-09-26 results: v4.1-flash 7/7 cheapest; GLM-5.3 and Kimi K3 are also 7/7 but 20× and 8× the cost.
- **Builder tooling:** subagents `implementer`/`tester`/`reviewer` (`.claude/agents/`); skills `start-workstream`, `feature-plan`, `review-diff`, `deploy-prod`, `impeccable`, `handoff`; MCP servers Context7, codebase-memory, engram (owner's Mac).
- **Legal corpus:** `data/legal/dotic_articles_2026-09-22.jsonl` covers 8 laws and 4,216 records, including CPC 1379, the consolidated Cheque Law and Dispute Councils 1402. **Not yet loaded into Qdrant.**

## Waiting on the owner (server writes need an explicit yes in chat)
1. W6: upsert into `iran_laws_v2` + `scripts/eval_legal_rag.py` (commands: `docs/W6_legal_corpus_diagnosis.md` §7.3). Baseline citation accuracy is 16.7%.
2. W7: run `scripts/voice_latency_bench.py` on the server (`docs/W7_voice_latency.md`).
3. Cleanup: remove `/tmp/w9run`, revert the 2 radar files, restart `roxira-dispatcher` (loopback).
4. W9 live run (≤ $1.50, `docs/research/LIVE_RUN.md`).

## Next workstreams (ready to start, see docs/PARALLEL_CHATS.md for prompts)
| Id | What | Lane | Needs server |
| --- | --- | --- | --- |
| W14 | Playwright E2E smoke: Smart Judge chat, payment invoice, `/health` via nginx | Sonnet chat | no (runs in CI against the prod URL, read-only) |
| W15 | STT robustness: remove the dead `gemini-2.0-flash-001` fallback in `stt_engine.py`; plan for self-hosted faster-whisper | Sonnet chat | no |
| W5b | Switch the router `cheap` tier to v4.1-flash after the W6 eval; flag-on runbook | hub | after W6 |
| W13b | Weekly Persian cost report (product + agents + reviews) as a scheduled workflow | agent issue | no |
| W16 | Fix nginx `/health` (404 from outside, 200 inside the app) | Sonnet chat (nginx is a sensitive path, so it needs human merge) | deploy |

## Known issues
- `/health` returns 404 through nginx; app-internal `/health` returns 200.
- The server radar timer dirties `TECH_RADAR_PROPOSALS.md` and `tech_radar_report.json` after each run (W9 follow-up).
- Keys are still in git history (the owner chose not to rotate).
