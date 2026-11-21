# Current state (read this first)

> **Last update: 2026-11-22 (main hub, Claude Sonnet 5.5 on the Mac).**
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
- Production writes need the owner's explicit sentence in the chat (a read-only check is free). Approved so far: create and rotate the `box-lanes` virtual key (rotated
  2026-11-21 17:02 UTC; do NOT rotate again unless exposed). Key delivery to the box (gateway.env) is the owner's clipboard relay (note on #592).
- Merge only on a review-desk "no blocker" for the PR's CURRENT head; check CI at JOB level (a run can say success with a failed job). Probe free tiers once, spaced apart.
  Lessons 30-36 in `docs/agents/LESSONS.md`. `gh` needs the sandbox off on the Mac (TLS error). With little disk, edit through the GitHub API instead of new worktrees.

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

## Merged 2026-11-21/22
#1081 #1180 #1097 #1182 (box lane runner, box-lanes key, mission prompt), #1165 (health.sh fix) and nine more green PRs, #1195 (test_orch import fix, main CI), #1204 (lessons),
#1207 #1209 #1211 #1221 #1223 (Gemini second opinions R29 R28 R31 R30 R32), #1213 #1219 #1234 (AGENTS 4a private-code policy), #1238 (safe worktree prune script),
#1215 (REVERT of the cutover wizard #1202: it could apply an irreversible period lock with an empty body; production shows 0 cutover rows, 0 new locks, 0 OB- journals).
Queued after "no blocker": #1241 (R28 Stage 2 run 2), #1246 R24, #1247 R22, #1248 R23, #1250 R25, #1252 R26 (second opinions), #1197 (accountant access).

## Open PRs
- The review desk reviews only 8 PRs per run: dispatch it once and let it finish (re-dispatching cancels the pending run).
- Cutover redo: #1229 has THREE BLOCKERS from an independent review (no confirmation step, no test that red tie-outs stop the lock, self-attested totals); #1226 and #1227 had none from it
  (the desk put a blocker on #1226: read both). Merging #1229 re-enables the reverted path: needs the owner's explicit sentence.
- Held for the owner: #1161 (deploy key, signed tags), #1158 (Redis pin), #1046 (root CI script), #1072 (nginx/SSE), #889 (parked, row #1093), #1200 (Postgres/PgBouncer sizing),
  #1225 (proprietary LICENSE: desk reviews, a lawyer sees it, hub never self-merges), #1205 (draft, box hub).
- Lane PRs with real blockers (lanes answer them): #1201 #1198 #1159 #963 #964 #943 #868 #850 #831 #805 #771 #728; #999 and #1172 were updated to main and need a fresh verdict.

## Production steps waiting (each needs the owner's explicit sentence)
1. Deliver the existing `box-lanes` key to the box with the hidden-prompt relay (exact commands in the HUB -> BOX note on #592), then replace the temporary
   tunnel `authorized_keys` line with the lane user's own public key.
2. WAL-G enable (Postgres restart window); after #831 the T200 restricted DB role; after #926 the v7b switch; #1020 deploy key + signed tag.
3. Disk on srv1 was at 80%: clean old Qdrant collections and images before 85%.

## Waiting on the owner
- Box (laptop Claude has the mission prompt and answers on #965): sudo lines, restic password and Telegram env, SIP registration details,
  confirm the tunnel key (or send the lane user's PUBLIC key), caps in each provider console, the `box-lanes` cap (hub proposes 1 USD/day, approved).
- Decided 2026-11-21: no non-EU AI engine on the ledger path of EU or German tax-advisor tenants (row #1108). Still open: Redis licence audit (#1122); private-repo flip date (only the owners
  say "go private"); #889 error table (platform-scope mechanism = hub recommendation, or drop tenant_id); free-first routing vs "no free tiers" for tenant documents (R22/R25); country order
  (Gemini: Malaysia or UAE first; digests: default pack, DE, Gulf); hard spend caps in provider consoles; the owner clears Brave/Codex caches himself.
- Research outputs still to send (Gemini): R27 and R33 (both stages), R22 Stage 2; prompts are in `docs/research/prompts/`. R22-R26 and R28-R32 are registered as `R<n>_GEMINI.md` plus a Second opinion section.

## Known issues
- Gateway groups `agent-light-free`, `agent-strong-free`, `best-all` timed out in one burst probe (may be quota, not a dead model); #1092 needs per-request timeouts, a fallback order and a timeout in the direct health probe. Do not probe repeatedly.
- Redis pins that may be non-BSD (#1122); Node `engines` and Python 3.11 vs 3.13 mismatch (#1125); `openai` pinned twice.
- Mac disk: 36 more clean worktrees removed 2026-11-22 (28 GiB free after the owner cleared caches). 51 dirty, 42 no-PR, 24 open-PR and 6 unpushed worktrees kept; use
  `scripts/ops/prune_worktrees.sh` (dry run first). Never bulk-delete.
- Production keeps an EMPTY table `data_import_cutovers` from the reverted wizard (its migration file was deleted); #1226's migration is idempotent against it. A drop needs the owner's sentence.
- Orch dry-run fails on the box until #1205 removes `gh --slurp` (gh 2.46).
- Box SSH: port 22 open but the handshake is closed (optional; GitHub is the control plane). Mac launchd jobs `llm-tunnel`, `team-status`, `fleet` need a check.
- 164 OSV findings (#1031), CSP report-only, PgBouncer sizing, Redis AOF, 21 tables without FORCE RLS until T200.

## Key documents
`docs/hub/SYSTEM_OVERVIEW.md` (read first), `docs/hub/MAIN_HUB_MASTER_BRIEF.md`, `docs/hub/BOX_INFRA_MISSION_PROMPT.md`, `docs/antigravity/LANE_RULES.md`, `docs/ops/BOX_LANE_RUNNER.md`,
`docs/ops/ORCH.md`, `docs/ops/BUILDER_EGRESS.md`, `docs/strategy/research/`, `docs/strategy/TECH_RADAR.md`, `docs/STRATEGY_NOW.md`,
`docs/owner/OWNER_ASKS_FA.md`, `docs/OPERATIONS_RUNBOOK.md` sections 7-8.
