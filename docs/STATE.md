# Current state (read this first)

> **Last update: 2026-11-21 (main hub, Claude on the Mac, before the Mac's Claude account switch).**
> Older state: `git log -p docs/STATE.md`. New hub: `docs/hub/HUB_START.md` →
> `docs/hub/MAIN_HUB_MASTER_BRIEF.md` → this file. Laptop: `docs/hub/BOX_HUB_MASTER_BRIEF.md`.
> Live GitHub data beats this file. Rebuild it with `gh pr list` and the latest WAVE/BOX: comments on #592 and #965.

The owner speaks Persian: reply in Persian; code, commits and docs in English. The owner wants full automation: hand over a command only for a secret, a physical action, sudo on the laptop or a production write.

## Direction
- **Product first:** CRM/ERP/accounting/tax usable globally (default pack live; DE/EU next, then the Gulf), plus Smart Judge (web and phone). No company, market or pricing work until the product is complete.
- **Hub = chief architect, planner and reviewer.** Lanes build; the hub writes rows, routes reviews, merges and runs production steps. Lowest cost, free models first.
- Map of every decision: `docs/STRATEGY_NOW.md`. Research digests: `docs/strategy/research/` (R1–R21).

## People and accounts (changed 2026-11-21)
- The Mac's Claude login moves to the colleague, now the main owner. The current Claude account moves to the Linux laptop (box hub). The hub's context lives in git, so nothing is lost (`docs/hub/HUB_START.md` §2a).
- GitHub does not change: Mac gh `mahan-films` (id 226124844), laptop gh `mahansudo` (id 211047265), both with full repo access.
- **O-1 (open, the two partners decide):** who approves production writes and spending. Default until they say otherwise: the person running the Mac hub.

## How work flows
- **Queues:** GitHub issues labelled `lane:L1`…`lane:L7` (+ `prio:1..3`, `research-row`, `filler`). Each lane follows the latest `## WAVE` comment on #592. Open issues 2026-11-21: L1 22, L2 7, L3 12, L4 22, L5 13, L6 7, L7 10.
- **Mac:** main hub + Antigravity L1–L4 (the owner pastes `docs/antigravity/prompts/L1..L4.txt` and relays the hub's messages).
- **Laptop `roxira-ci`:** box hub (Claude, gh `mahansudo`) + L5–L7 (Gemini CLI/OpenCode headless), runner, phone stack. Reports go to #592 as `BOX:`.
- **Mac → laptop without the owner:** `WAVE:` comments on #965 (`scripts/dev/hub_wave.sh`). A systemd timer on the laptop runs them with `claude -p` and answers `REPORT:` (`scripts/dev/hub_reports.sh`). Built in #1028. Being installed now (Phase 0, `BOX:` reports of 2026-11-21, fixes in #1035).
- **Review:** `gh workflow run review-desk.yml` once, never with `-f pr`. Merge on "no blocker" for the current head with `gh pr merge N --auto` (the merge queue sets the strategy).
- **Push:** `LOCAL_CI_SKIP_PYTEST=1 FRESH_DB_PORT=<unique> git push`. Pre-push now also runs gitleaks (#1032); re-run `bash scripts/dev/install_hooks.sh` in every clone.

## Live (production `ssh roxira-prod`, repo `/opt/roxira_platform`)
- **Services:** Docker Compose with nginx, NestJS backend, Next.js, FastAPI AI core + Smart Judge (`roxira_app_prod`), Postgres 17, PgBouncer, Redis, Qdrant, TEI embeddings, LiteLLM key pool, research + SearXNG, mail, Umami, Twenty CRM. RAM 52%, **disk 80%** (plan a cleanup before 85%).
- **Timers:** autodeploy (pull every 5 min), hourly encrypted off-site backups + DR drill, monitors and Telegram, radar, rulings update, self-improve, digest.
- **Phone gateway key** `SMARTJUDGE_PHONE_GATEWAY_KEY` is set (64 characters). A copy is in the Mac's `~/Secrets/roxira/roxira.env` since 2026-11-21. The Mac file also holds the same three Groq keys as production.
- **WAL-G** code is merged (#886) but off until `/etc/roxira/walg.env` exists.

## Merged 2026-11-20/21
- #1025: account-independent hub memory (`docs/hub/`).
- #1026: R21 research.
- #1027: R20 digest fix.
- #1028: agent bridge.
- #1029: merge gate, dry-run.
- #1030: laptop mirror/export + reliability pack.
- #1032: gitleaks/OSV/Semgrep.
- #1033: box hub master brief.

## Open PRs (2026-11-21)
- **Lane PRs with blockers:**

  | Lane | PRs |
  |------|-----|
  | L1 | #831, #850, #771 |
  | L2 | #868, #763 |
  | L3 | #728, #854, #955 |
  | L4 | #805 |
  | L5 | #943, #963, #964 |

- **Hub and ops PRs:** #889, #892 (conflicts), #972 (T232), #999 (licence gate), #1005 (merge desk), #1012 and #1014 (docs).
- **Laptop:** #1035 (gh 2.46 fixes).
- **Old drafts:** #663 (needs owner), #350.

## Production steps waiting (each needs the owner's explicit sentence)
1. **WAL-G:** create `/etc/roxira/walg.env` and restart Postgres in a maintenance window.
2. **After #831:** T200 restricted DB role (<1 min downtime) + cross-tenant smoke test.
3. **After #926 (T212):** switch `LIGHTRAG_QDRANT_COLLECTION` to v7b. After #927, clean up old Qdrant collections, which also frees disk.
4. **After #972:** confirm a dirty tree can no longer block autodeploy. The radar drop-in hot-fix stays until then.
5. **#1020:** read-only deploy key + signed-tag guard for migrations.

## Laptop work order
`docs/hub/BOX_HUB_MASTER_BRIEF.md` §9:
1. Phase 0: install the bridge, merge gate, mirror, reliability and phone keys.
2. Phase 1: #947, #949, #1024.
3. Phase 2: #1021 orch v0, #1022 egress, #951 merge desk go-live.
4. Phase 3: #987–#990 phone and evals.

## Waiting on the owner
- **O-1:** approval rule (above).
- **Spending:** Gemini API key (~USD 5, needed for reliable unattended Google lanes), small server for the phone stack, bigger production server (trigger: RAM above 70% for 7 days).
- **Laptop:** sudo lines during Phase 0, the restic password, the Telegram bot env, and the SIP trunk registration, which still shows "Unregistered".
- **Research R22:** unattended `claude -p` on a subscription login, and the risk of `agy -p`.
- **Optional:** rotation of the secrets printed on 2026-11-17.

## Mac background jobs (launchd, per macOS user)
Jobs `ir.roxira.*` in `~/Library/LaunchAgents`:
- backup-pull, reposync, lawwatch, diskguard, mac-cleanup, iranrelay, team-status, llm-tunnel, fleet.

They keep running after a Claude account switch. A new macOS user must re-install them (`docs/hub/HUB_START.md` §3).

Known on 2026-11-21:
- `llm-tunnel` exits 255.
- `team-status` exits 1.
- `fleet` is not loaded.

All three are to be checked by L1 or the hub.

## Known issues
- CSP is report-only (T216 #930). PgBouncer pool is above `max_connections` (T214 #928). Redis has no AOF (T217 #931).
- 21 production tables lack FORCE RLS (T215). The app still connects as a superuser until T200.
- OSV reports 164 dependency findings (#1031). GitHub Dependabot shows 179.
- Docker Hub is blocked from the laptop's network: use `public.ecr.aws` images there.
- The R17 digest file is missing. The prod IP is still in `docs/OPERATIONS_RUNBOOK.md` §1: scrub it.

## Key documents
- `docs/hub/MAIN_HUB_MASTER_BRIEF.md`
- `docs/hub/BOX_HUB_MASTER_BRIEF.md`
- `docs/STRATEGY_NOW.md`
- `docs/ARCHITECTURE.md`
- `docs/strategy/R20_DIGEST.md`
- `docs/research/R21_AGENT_BRIDGE.md`
- `docs/TEAM_SPLIT_2026-11-17.md`
- `docs/owner/OWNER_ASKS_FA.md`
- `docs/OPERATIONS_RUNBOOK.md` §7–8
