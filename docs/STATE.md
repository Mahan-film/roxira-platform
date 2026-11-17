# Current state (read this first)

> **Last update: 2026-11-17 evening (hub, Opus 5.5).** Older state: `git log -p docs/STATE.md`, `docs/HANDOFF_2026-11-12.md`, `docs/HANDOFF_2026-11-17.md`. New chat or other AI: `docs/AI_HANDOFF.md`, then this file, then `docs/PARALLEL_CHATS.md`.

Owner speaks Persian: reply in Persian; code, commits and docs in English. The owner wants full automation: hand over a command only when a secret, a physical action or a production write the classifier refuses is involved.

## Direction (owner, 2026-11-16/17)
- **Product first.** CRM/ERP/accounting/tax usable globally (DE/EU first, then Gulf); Iran is live. No company, market or pricing questions until the product is complete; legal/company steps (Malaysian Sdn Bhd owns everything, German partner as representative) come after product and infrastructure.
- **Hub = strategist and reviewer only** (save Claude tokens). Antigravity lanes build; the hub writes rows/issues, routes reviews, merges, and runs production steps.
- Lowest cost, free models first (`config/models.yaml`). Rust only for a measured hot path behind a contract (`docs/strategy/INFRA_TARGET_2026-11-17.md`).
- Never raise the hosting-location topic yourself.

## How work flows now
- **Queues are GitHub issues.** Label `lane:L1`…`lane:L6` (+ `prio:1..3`, `research-row`). Research rows T166–T226 are issues #898–#940 with "Done when" specs; older issues carry lane labels as backlog. Order per lane: latest `## WAVE` comment on #592 (WAVE 19b).
- **Two machines** (`docs/TEAM_SPLIT_2026-11-17.md`): owner's Antigravity L1 ops/CI/infra, L2 frontend+currency, L3 security/data, L4 Smart Judge; colleague's Antigravity L5 core ledger, L6 Germany then Gulf. The colleague's Claude Code reviews/merges only L5/L6.
- Prompts: `docs/antigravity/prompts/L1..L6.txt` and `LANE_PROMPTS.html` (v6b). Claim with `bash scripts/dev/claim.sh <issue> --agent antigravity` (draft PR = lock).
- Review: `gh workflow run review-desk.yml` once, **without** `-f pr` (per-PR dispatches cancel each other). Merge only with "no blocker" on the current head: `gh pr merge N --auto --squash` ("merge strategy set by merge queue" is fine).
- Pre-push local CI takes 20–30 min: `LOCAL_CI_SKIP_PYTEST=1 FRESH_DB_PORT=<unique> git push`. Frontend-touching pushes fail inside Claude's sandbox (Turbopack cannot bind a port): push from the owner's Terminal tab.
- Agent briefs must forbid printing env, `docker inspect` Env or secrets (an agent leaked three on 2026-11-17).

## Live and working (production `ssh roxira-prod`, srv1, repo `/opt/roxira_platform`)
- Docker Compose (`docker-compose.prod.yml`): nginx, NestJS hub, Next.js, FastAPI AI core, Postgres 17, PgBouncer 1.26.1, Redis, Qdrant, TEI bge-m3 (CPU), LiteLLM key pool. 4 vCPU / 7.7 GB, RAM ~65% (bigger server = owner's spend, trigger RAM > 70% for 7 days).
- Backups: hourly encrypted pg_dump off-site + second copy + Telegram, weekly drill. Monitoring: synthetic checks, Telegram, e-mail, external uptime (`uptime.yml`). Memory limits/OOM priority (T205).
- Prod E2E 2026-11-17: 8 pass / 4 warn / 0 fail. Smart Judge chat ~2.1 s, `answer_timing` logs per stage.
- Smart Judge serves Qdrant collection v6 (16 laws, R@1 0.729, R@5 0.929). v7b has 60 laws at equal R@5; switch after T212 (#926).
- Merged 2026-11-17: #857 #870–#874 #884 #885 #887 #888 #893 #896 #897 (WAVE 19 docs); #890 T184 bank import and #941 (WAVE 19b prompts) queued.

## Hub PRs open (hub owns; a lane takes one only if a blocker stays unfixed 12 h)
#883 T197/T198 off-site backups + Mac restore drill · #886 T204 WAL-G · #889 T199 error capture · #891 T207 CI guards · #892 T203 flagd · #894 T209 tenant scope · #895 T202 oxlint/TS7. A review-desk run for all open PRs was dispatched 2026-11-17 ~19:00 Tehran: read its verdicts, merge "no blocker", fix or hand back blockers.

## Production steps waiting (in order; prod writes need the owner's explicit sentence or the owner runs them)
1. After #883: install per its PR body (`BACKUP_OFFSITE_EXTRAS=1`), run one backup, check `status.env`.
2. #884 merged: restart the AI core for timing logs; install the nightly legal-gate timer.
3. After #831 (L1): T200 restricted DB role (<1 min downtime) + cross-tenant smoke test.
4. After #886: enable WAL-G (Postgres restart) in one maintenance window.
5. After #926 (T212): switch `LIGHTRAG_QDRANT_COLLECTION` to v7b. After #927 (T213): hub runs the Qdrant cleanup (v8h, v7, v4, v5, mistral_v1, phase1_test; later v2, bge_m3).

## Waiting on the owner
- Rotate the Gemini key, `POSTGRES_PASSWORD` and the Umami secret with `set_secret.sh` (printed by an agent on 2026-11-17).
- Paste the v6b prompts into fresh Antigravity chats (L1–L4 here; L5–L6 on the colleague's machine).
- Set up the HP laptop as the Linux CI box: `docs/ops/LINUX_CI_BOX.md` (workflow part: #947 T227, lane L1).
- R18 (Smart Judge) deep-research report; its prompt is in `docs/strategy/DEEP_RESEARCH_ROUND4.md`.

## Next for the hub
1. Review-desk verdicts → merge hub PRs and green lane PRs; dispatch the desk again after lane pushes.
2. Production steps above as their PRs merge.
3. Guide the owner through `docs/ops/LINUX_CI_BOX.md`; then move the nightly M1 suite, Playwright shards (T168) and the restore drill (T198) to that runner.
4. Unpushed Claude-agent work for T211/T212 sits in worktrees `.claude/worktrees/agent-a7ca394a0585f37b1` and `agent-a19b58c760855d859`. L4 owns T211/T212 now (#925, #926): offer L4 the diff, then remove each worktree singly after the lane PR merges.
5. Digest R18 when it arrives into rows and issues (same pattern as `scratchpad mk_issues.py`: one issue per row, lane label, Done-when).

## Known issues
- CSP is report-only (T216 #930). PgBouncer pool 200/500 above `max_connections` 100 (T214 #928). Redis without AOF (T217 #931).
- 21 production tables without FORCE RLS: user-scoped or legacy (T215 #929). The app still connects as a superuser until T200.
- `lightrag_engine.py` silently falls back to `iran_laws_v2` (R@5 0.44) when the collection env var is unset (T212 fails fast).
- The browser aborts chat streams at 30 s (`frontend/src/lib/api/chat-stream.ts:27`); early SSE frame in T211.
- `src/ops/test_autodeploy.py` fails locally only (unrelated); never run pytest over `src/` or the repo root.

## Key documents
`docs/strategy/ARCHITECTURE_DECISIONS_2026-11-16.md` (rows T166–T210) · `docs/strategy/INFRA_TARGET_2026-11-17.md` (T211–T218, Rust path) · `docs/strategy/research/` (R13–R16, R19 digests) · `docs/TEAM_SPLIT_2026-11-17.md` · `docs/owner/OWNER_ASKS_FA.md` · `docs/OPERATIONS_RUNBOOK.md` §7–8 (merge traps).
