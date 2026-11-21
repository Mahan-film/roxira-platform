# Current state (read this first)

> **Last update: 2026-11-21 evening (main hub, Claude on the Mac).**
> New hub: `docs/hub/HUB_START.md` -> `docs/hub/MAIN_HUB_MASTER_BRIEF.md` -> this file. Laptop: `docs/hub/BOX_HUB_MASTER_BRIEF.md`
> and `docs/hub/BOX_INFRA_MISSION_PROMPT.md`. Live GitHub data beats this file: `gh pr list`, newest `## WAVE` and `BOX:`/`HUB` comments on #592 and #965.

The owner speaks Persian: reply in Persian; code, commits and docs in English. The owner wants full automation: hand over a command only for a
secret, a physical action, sudo on the laptop or a production write. Never name the owners' country ("the default pack").

## Hub discipline (read before acting)
- Only ONE Mac hub chat acts (merges, review-desk dispatch, production writes). Any other chat only reads and answers. The newest handoff decides which one.
- The Mac hub never administers the Linux box and never SSHes into it. Box work belongs to the box hub; GitHub is the control plane (notes on #592, answers on #965).
- Secrets: never write a key into a file under the repo, ~/Desktop, ~/Documents or any synced folder, never print it. Move it only by clipboard relay
  (Mac `ssh roxira-prod '... | cut -d= -f2-' | pbcopy`; box `read -rs` into the env file, mode 600; then `pbcopy </dev/null`). AirDrop does not work with Linux.
- Private flip: the sentence "go private" comes only from the owners. Policy for private code and production paths is AGENTS.md section 4a.
- Production writes need the owner's explicit sentence in the chat. Approved so far: create and rotate the `box-lanes` virtual key. It was rotated on
  2026-11-21 at 17:02 UTC; every earlier value is dead. Do NOT rotate again unless a value was exposed. Delivery to the box (gateway.env) is still pending.

## Direction
- **Product first:** CRM/ERP/accounting/tax usable globally (default pack live; DE/EU next, Malaysia second, then the Gulf), plus Smart Judge.
- **Hub = chief architect and reviewer.** Lanes build; the hub writes rows, routes reviews, merges, runs production steps. Free models first.
- **Open source first, permissive licences only in the runtime** (MIT/Apache/BSD/ISC/CC0). Faster or newer tech only through the monthly
  radar (`docs/strategy/TECH_RADAR.md`, issue #1098) with a measurement and a rollback. Rust only where it measurably pays. No rewrites.
- **No consumer login (Claude Pro, Antigravity, Gemini) on any automated path** (R22). Antigravity stays interactive, one account per person.

## How work flows
- Queue = issues `lane:L1..L7` ordered by the newest WAVE on #592. **WAVE 27 = marathon** (WIP 5, never stop at the cap, OSS-first); WAVE 28/29 add
  the R27-R33 research rows (T278-T332). Digests: `docs/strategy/research/R22..R33_DIGEST.md` (everything "requires primary check").
- **Lane prompts are minimal:** `docs/antigravity/prompts/L<n>.txt` (~600 chars, first line `LANE = L<n>`), rules in `docs/antigravity/LANE_RULES.md`.
  Owner pastes: `git show origin/main:docs/antigravity/prompts/L<n>.txt | pbcopy`. Mac Antigravity runs L1-L6 (L2 was still running at handoff).
- **Box lanes L5-L7:** Linux laptop `roxira-ci`, no Claude login on the path: roxira-orch (`scripts/infra/server_agents/orch.py`, **dry-run only until
  #1092 is fixed**) -> taskq -> OpenCode -> loopback tunnel -> LiteLLM key pool on srv1 (free first, capped paid DeepSeek last).
- **Review:** `gh workflow run review-desk.yml` once (never `-f pr`). Merge on "no blocker" for the current head with `gh pr merge N --auto`.
- **Push:** `LOCAL_CI_SKIP_PYTEST=1 FRESH_DB_PORT=<unique> git push`. `claim.sh` pushes too: export the same env first. BSD sed needs `-i ''`.
- Hub subagents work in isolated worktrees on claimed branches (the draft PR is the lock); hooks forbid writing into another worktree.

## Live
- **Production (`ssh roxira-prod`, `/opt/roxira_platform`):** Compose stack, autodeploy every 5 min, hourly backups. A dedicated no-shell account
  `boxtunnel` holds ONE forwarding-only key (permitopen to the gateway port only) for the box tunnel (created 2026-11-21).
- Gateway virtual keys: `mac-agents` (3 USD/day), `laptop-mahansudo-srv` (2); `box-lanes` (1 USD/day, agent groups only) EXISTS (verified 2026-11-21); its value is delivered by the owner relay (note on #592).
- Paid fallback balances checked: both OpenRouter keys have limits (5 and 4 USD) and almost no usage. Nothing to charge now.

## Merged 2026-11-21
#1053 #1062 #1086 #1100 (research digests R22-R33), #1082 orch v0, #1083 lane budgets, #1084 CI image mirror, #1087 LiveKit generated keys,
#1088 direct-push alert (dry-run), #1089 builder egress + redaction, #1091 minimal lane prompts, #1157 source watcher design,
#1074 currency precision, #955 user RLS for Smart Judge, #1073 #1075 Smart Judge normalisation and router hygiene, #1044 #972 #892.

## Open PRs
- Hub: #1081 lane runner pack, #1180 box-lanes key, #1097 mission prompt + TECH_RADAR and #1182 handoff are all merged. The review desk reviews only 8 PRs per run: dispatch it once and let it finish (re-dispatching cancels the pending run).
- Red or blocked: #1072 (CI image pull), #889 (conflicts + migration number + raw DataSource, row #1093).
- Lane PRs with real review blockers (lanes answer them in marathon rounds): #728 #763 #805 #831 #850 #854 #868 #943 #963 #964 #999; #771 conflicts.

## Production steps waiting (each needs the owner's explicit sentence)
1. Deliver the existing `box-lanes` key to the box with the hidden-prompt relay (exact commands in the HUB -> BOX note on #592), then replace the temporary
   tunnel `authorized_keys` line with the lane user's own public key.
2. WAL-G enable (Postgres restart window); after #831 the T200 restricted DB role; after #926 the v7b switch; #1020 deploy key + signed tag.
3. Disk on srv1 was at 80%: clean old Qdrant collections and images before 85%.

## Waiting on the owner
- Box (laptop Claude has the mission prompt and answers on #965): sudo lines, restic password and Telegram env, SIP registration details,
  confirm the tunnel key (or send the lane user's PUBLIC key), caps in each provider console, the `box-lanes` cap (hub proposes 1 USD/day, approved).
- Decisions: EU-tenant AI data path vs tax-advisor secrecy (#1108), Redis licence audit (#1122), private-repo flip date (only after #947 #949 #1024,
  merge gate live, runner mode proven; review desk every 4 h then), R22 spend choices, wedge market after the default pack (DE proposed).
- Research still to run by the owner: none open (R22-R33 digested); new topics only on request.

## Known issues
- Gateway groups `agent-strong-free`, `best-product`, `best-all` fail health; `health.sh` KeyError (#1092, L1 prio 1).
- Redis pins that may be non-BSD (#1122); Node `engines` and Python 3.11 vs 3.13 mismatch (#1125); `openai` pinned twice.
- Mac disk was 2.8 GiB free; 24 clean worktrees removed (8.6 GiB free). 69 dirty/unpushed worktrees kept (row #1177). Do not bulk-delete.
- Box SSH: port 22 open but the handshake is closed (optional; GitHub is the control plane). Mac launchd jobs `llm-tunnel`, `team-status`, `fleet` need a check.
- 164 OSV findings (#1031), CSP report-only, PgBouncer sizing, Redis AOF, 21 tables without FORCE RLS until T200.

## Key documents
`docs/hub/SYSTEM_OVERVIEW.md` (read first), `docs/hub/MAIN_HUB_MASTER_BRIEF.md`, `docs/hub/BOX_INFRA_MISSION_PROMPT.md`, `docs/antigravity/LANE_RULES.md`, `docs/ops/BOX_LANE_RUNNER.md`,
`docs/ops/ORCH.md`, `docs/ops/BUILDER_EGRESS.md`, `docs/strategy/research/`, `docs/strategy/TECH_RADAR.md`, `docs/STRATEGY_NOW.md`,
`docs/owner/OWNER_ASKS_FA.md`, `docs/OPERATIONS_RUNBOOK.md` sections 7-8.
