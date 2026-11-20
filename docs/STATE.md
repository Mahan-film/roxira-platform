# Current state (read this first)

> **Last update: 2026-11-19 (main hub, Claude on the Mac).** Older state: `git log -p docs/STATE.md`, `docs/HANDOFF_2026-11-12.md`, `docs/HANDOFF_2026-11-17.md`. New chat or other AI: `docs/AI_HANDOFF.md`, then this file, then `docs/PARALLEL_CHATS.md`.

Owner speaks Persian: reply in Persian; code, commits and docs in English. The owner wants full automation: hand over a command only when a secret, a physical action or a production write the classifier refuses is involved.

## Direction (owner, 2026-11-16/17)
- **Product first.** CRM/ERP/accounting/tax usable globally (DE/EU first, then Gulf); the default pack is live. No company, market or pricing questions until the product is complete; legal/company steps (Malaysian Sdn Bhd owns everything, German partner as representative) come after product and infrastructure.
- **Hub = strategist and reviewer only** (save Claude tokens). Lanes build (Antigravity on the Mac, Gemini CLI on the box); the hub writes rows/issues, routes reviews, merges, and runs production steps.
- Lowest cost, free models first (`config/models.yaml`). Rust only for a measured hot path behind a contract (`docs/strategy/INFRA_TARGET_2026-11-17.md`).
- Never raise the hosting-location topic yourself.

## How work flows now
- **Queues are GitHub issues.** Label `lane:L1`…`lane:L7` (+ `prio:1..3`, `research-row`, `filler`). Research rows T166–T233 are issues with "Done when" specs. Order per lane: latest `## WAVE` comment on #592 (WAVE 20: fix review-desk blockers on your open PRs first, then drain the label queue).
- **Two machines** (`docs/TEAM_SPLIT_2026-11-17.md`). Mac: main hub (Claude, gh `mahan-films`) plus Antigravity L1 ops/CI/infra, L2 frontend+currency, L3 security/data, L4 Smart Judge. Linux laptop `roxira-ci`: box hub (Claude Code as user `mahanfilms`, gh `mahansudo`; reviews and merges L5–L7 and posts `BOX:` reports on #592), lanes L5 core ledger, L6 Germany then Gulf, L7 built by **Gemini CLI** in tmux (Antigravity cannot sign in there; runner script = #965 T233), and the phone stack (user `phone`, deploy kit #959 T231). Both accounts push to the same repo (#968 by `mahansudo` merged).
- Prompts: `docs/antigravity/prompts/L1..L7.txt` (v6c). Claim with `bash scripts/dev/claim.sh <issue> --agent <id>` (draft PR = lock).
- Review: `gh workflow run review-desk.yml` once, **without** `-f pr` (per-PR dispatches cancel each other). Merge only with "no blocker" on the current head: `gh pr merge N --auto --squash` ("merge strategy set by merge queue" is fine).
- Pre-push local CI takes 20–30 min: `LOCAL_CI_SKIP_PYTEST=1 FRESH_DB_PORT=<unique> git push`. Frontend-touching pushes fail inside Claude's sandbox (Turbopack cannot bind a port): push from the owner's Terminal tab.
- Agent briefs must forbid printing env, `docker inspect` Env or secrets (an agent leaked three on 2026-11-17).

## Live and working (production `ssh roxira-prod`, srv1, repo `/opt/roxira_platform`)
- Docker Compose (`docker-compose.prod.yml`): nginx, NestJS hub, Next.js, FastAPI AI core, Postgres 17, PgBouncer 1.26.1, Redis, Qdrant, TEI bge-m3 (CPU), LiteLLM key pool. 4 vCPU / 7.7 GB, RAM ~65% (bigger server = owner's spend, trigger RAM > 70% for 7 days).
- Backups: hourly encrypted pg_dump off-site + second copy + Telegram, weekly drill. Monitoring: synthetic checks, Telegram, e-mail, external uptime (`uptime.yml`). Memory limits/OOM priority (T205).
- Prod E2E 2026-11-17: 8 pass / 4 warn / 0 fail. Smart Judge chat ~2.1 s, `answer_timing` logs per stage.
- Smart Judge serves Qdrant collection v6 (16 laws, R@1 0.729, R@5 0.929). v7b has 60 laws at equal R@5; switch after T212 (#926, still open).
- Merged 2026-11-17/18: #883 (off-site backups + Mac restore drill) #884 #885 #890 #891 (CI guards) #894 (tenant scope) #895 (oxlint/TS7) #962 (T211 speed) #864 #941 #950 #960 and the CI-box docs/scripts (#953 #957 #958 #968).
- **CI box `roxira-ci`** (`docs/ops/LINUX_CI_BOX.md`): Ubuntu 26.04, 907 GB data disk, GitHub runner `roxira-ci` (rootless Docker; no workflow uses it until #949), Xray proxy always on with domestic routes direct, egress lock so `mahanfilms` reaches the internet only through the proxy, read-only `box-status` with a narrow sudoers file (#968). No production keys on the box; deploy is pull-based from the server.
- Autodeploy stuck ~19 h on 2026-11-18: `roxira-radar-daily` wrote `docs/radar/DECISIONS.md` into the checkout (dirty tree). Hot-fixed on the server with systemd drop-ins (`RADAR_DECISIONS_FILE=/var/lib/roxira/radar/DECISIONS.md`); permanent fix plus Telegram alert = #961 T232 (L1).

## Hub PRs open (hub owns; a lane takes one only if a blocker stays unfixed 12 h)
- #886 T204 WAL-G: blocker, needs coreutils (`timeout`) in `docker/postgres-walg/Dockerfile`; handed to L1.
- #892 T203 flagd: conflicts with main; handed to L1.
- #889 T199 error capture: open, mergeable; merge on "no blocker".
- Merged since the last update: #883 #891 #894 #895.
- Lane PRs with open blockers (WAVE 20 step 1): L1 #831 #771 #850; L2 #868 #763; L3 #728 #854 #955; L4 #805; L5 #943 #963 #964 (box hub handed them to L5).

## Production steps waiting (in order; prod writes need the owner's explicit sentence or the owner runs them)
1. #883 merged: install per its PR body (`BACKUP_OFFSITE_EXTRAS=1`), run one backup, check `status.env`.
2. #884 merged: restart the AI core for timing logs; install the nightly legal-gate timer. #962 (T211) ships with the next autodeploy.
3. After #831 (L1): T200 restricted DB role (<1 min downtime) + cross-tenant smoke test.
4. After #886: enable WAL-G (Postgres restart) in one maintenance window.
5. After #926 (T212): switch `LIGHTRAG_QDRANT_COLLECTION` to v7b. After #927 (T213): hub runs the Qdrant cleanup (v8h, v7, v4, v5, mistral_v1, phase1_test; later v2, bge_m3).
6. After #961 (T232): confirm autodeploy cannot be blocked by a dirty tree; until then watch for the drop-in hot-fix staying in place.

## Waiting on the owner
- Secrets printed by an agent on 2026-11-17 (Gemini key, `POSTGRES_PASSWORD`, Umami secret): owner decided 2026-11-18 not to rotate now. They went into a local Mac transcript and the model provider, never to GitHub. Optional later via `set_secret.sh`.
- Run `04_root_box_status.sh` once on the box (#968), and one sudo step for the phone stack once #959 (T231) lands. Open hardening item: `mahanfilms` is in the docker group, so its containers bypass the proxy.
- Private repo: owner chose option A (Free, USD 0) on 2026-11-18. The hub flips visibility after #947 (T227), #949 (T228) and #951 (T229, merge desk).
- R18 digested 2026-11-20: rows T234-T258 (#973-#997), see `docs/strategy/research/R18_SMART_JUDGE.md`. R1–R17 and R19 are digested.

## Next for the hub
1. Review-desk verdicts → merge queued green PRs (#889, lane PRs listed in WAVE 20); dispatch the desk again after lane pushes.
2. Production steps above as their PRs merge.
3. Move the nightly M1 suite, Playwright shards (T168) and the restore drill (T198) to the box runner once #947/#949 land.
4. T212 (#926) is still open with L4; T211 is merged (#962). Remove the two old Claude-agent worktrees (`agent-a7ca394a0585f37b1`, `agent-a19b58c760855d859`) singly only after confirming nothing unpushed is left.
5. Digest R18 when its raw report lands into rows and issues (one issue per row, lane label, Done-when).

## Known issues
- CSP is report-only (T216 #930). PgBouncer pool 200/500 above `max_connections` 100 (T214 #928). Redis without AOF (T217 #931).
- 21 production tables without FORCE RLS: user-scoped or legacy (T215 #929). The app still connects as a superuser until T200.
- `lightrag_engine.py` silently falls back to `iran_laws_v2` (R@5 0.44) when the collection env var is unset (T212 fails fast).
- The browser aborts chat streams at 30 s (`frontend/src/lib/api/chat-stream.ts:27`); the early SSE frame shipped in T211 (#962), verify in the browser.
- Docker Hub is blocked from the box network: use `public.ecr.aws` images there.
- `src/ops/test_autodeploy.py` fails locally only (unrelated); never run pytest over `src/` or the repo root.

## Key documents
`docs/strategy/ARCHITECTURE_DECISIONS_2026-11-16.md` (rows T166–T210) · `docs/strategy/INFRA_TARGET_2026-11-17.md` (T211–T218, Rust path) · `docs/strategy/research/` (R1–R17, R19 digests) · `docs/TEAM_SPLIT_2026-11-17.md` · `docs/TEAM_START.md` · `docs/owner/OWNER_ASKS_FA.md` · `docs/OPERATIONS_RUNBOOK.md` §7–8 (merge traps).
