# System overview: one shared map (2026-11-21)

Every Claude account (Mac hub, box hub) and every lane reads this first. It states what exists, who does what and why. Older briefs
(`MAIN_HUB_MASTER_BRIEF.md`, `BOX_HUB_MASTER_BRIEF.md`) keep their details but this file wins where they differ. Live GitHub data beats all files.
Never put keys, IPs, hostnames, phone numbers or personal names in git. Never name the owners' country ("the default pack").

## 1. The product and the plan
- **Roxira**: SaaS for accounting/tax, CRM, ERP, HR and an AI legal assistant **Smart Judge** (web and phone). Product first: the default pack is live;
  Germany/EU next, Malaysia second, then the Gulf (R27, R28). Digests R1-R33: `docs/strategy/research/`; rows T-numbers on GitHub (WAVE 24-29 on #592).
- **Rules of the build:** free models first, paid only as a capped fallback; open source with permissive licences (MIT/Apache/BSD/ISC/CC0, no AGPL/GPL/SSPL/ELv2
  at runtime); reuse before writing; no rewrites without a measured gain; newer or faster tech only through the monthly radar (`docs/strategy/TECH_RADAR.md`, #1098).
- **Spend and decisions:** business, pricing and production writes are the owners' decisions (explicit sentence in chat). Everything else the hubs do themselves.

## 2. People, accounts, machines
| Who/what | Is | Does |
|---|---|---|
| Two owners | two people, each with their own Claude Code Pro account and their own Antigravity account | decide, relay secrets by hand, run sudo on the box |
| **Mac hub** | Claude Code on the Mac (gh `mahan-films`) | chief architect, strategy, review routing, merges, production steps, research digests, WAVE posts |
| **Box hub** | Claude Code on the Linux laptop (gh `mahansudo`) | builds and runs the laptop's infrastructure; never touches production |
| Antigravity chats | Gemini 3.8 Flash in the Antigravity app, interactive, one account per person, never automated or rotated | lanes L1-L6 on the Mac, pasted from `docs/antigravity/prompts/L<n>.txt` (rules in `LANE_RULES.md`) |
| Mac | the hub's machine | hub chats, Antigravity chats, `ir.roxira.*` launchd jobs (backups pull, law watch, disk guard) |
| Linux laptop `roxira-ci` | Ubuntu 26.04, always on, home LAN, no public IP, egress locked to a local proxy, 24 GB RAM | **the build server** (section 4) |
| Production `srv1` | Docker Compose stack, autodeploy pulls `main` every 5 min | the live product; read-only knowledge for everyone except the Mac hub with the owner's sentence |
Claude accounts and Antigravity are **interactive only**. No consumer login on any automated path (R22).

## 3. Stack (inventory: `docs/strategy/TECH_RADAR.md`)
NestJS/TypeScript backend (`output_apps/enterprise_hub`), Next.js frontend, Python FastAPI AI core and Smart Judge, PostgreSQL 17 with PgBouncer and RLS, Redis
(licence audit #1122; Valkey in places), Qdrant + TEI embeddings (bge-m3), LiteLLM key-pool gateway, nginx, Docker Compose, GitHub Actions, OpenCode + taskq
(SQLite) for agent runs, LiveKit + Asterisk phone stack, restic/WAL-G backups, Telegram alerts. Country packs in `modules/country_packs`.

## 4. What the Linux laptop does (target)
1. **Lanes L5-L7** without any Claude login: `roxira-orch` (issues -> taskq, WIP, REPORT comments, draft PRs, never merge) -> OpenCode -> loopback tunnel -> the
   gateway on srv1 (free providers first, capped paid last). Key `box-lanes`: agent groups only, 1 USD/day. Orch stays dry-run until #1092 (gateway health) is closed.
2. **CI/CD**: JIT runner pool and runner picker so the repo can go private without buying minutes; merge gate (replaces auto-merge on a private Free plan);
   review desk later; direct-push alert.
3. **Phone stack** (LiveKit SIP + Asterisk) and nightly Smart Judge/voice evals.
4. **Backups and mirror** (`/srv/data`), egress allowlist, builder users without write tokens, redaction hook, status page, Telegram alerts only for failures.
5. Production is NOT reachable from the box except through one forwarding-only tunnel account to the gateway port.

## 5. How work flows
- Queue = GitHub issues `lane:L1..L7` ordered by the newest `## WAVE` on #592 (WAVE 27 = marathon: WIP 5, never stop at the cap, OSS-first). Claim with `scripts/dev/claim.sh`;
  the draft PR is the lock. Review desk (cross-family, at most 8 PRs per run, dispatch once); the merge gate merges on a desk "no blocker" at the PR head.
  B1 core needs the hub review; protected paths need `OWNER-OK #<PR> <sha7>` from the owner approver account. The hub is a role in any tool (`docs/hub/HUB_ROLE.md`); Claude is optional.
- Mac <-> box talk through GitHub only: notes `HUB -> BOX` and `BOX:` on #592, `ASK-HUB:` and `HUB-ANSWER` on #965. No SSH from the Mac to the box.
- Secrets move only by the clipboard relay (see STATE.md "Hub discipline"); never to files outside `~/Secrets/roxira` or the box's mode-600 env files.
- Subagents (hub) work in isolated worktrees on claimed branches; hooks forbid writing into another worktree. One acting Mac hub chat at a time.

## 6. State of the build (see STATE.md for numbers)
Done: Claude-free box design and code (orch, runner pack, egress, budgets, key, tunnel account), R22-R33 research and rows, minimal lane prompts, disk hygiene (24+38 worktrees).
Next: gateway health (#1092), tunnel up and smoke on the box, #889 (#1093), Redis licence (#1122), EU-tenant AI data path (#1108, owner decision), private flip after #947 #949 #1024
and the merge gate, then the product rows (accounting #230, DE pack, Smart Judge v2, Malaysia, Gulf).

## 7. Where things are
`docs/STATE.md` (now), `docs/STRATEGY_NOW.md`, `docs/ARCHITECTURE.md`, `docs/SYSTEM_MAP.md`, `docs/hub/HUB_START.md`, `docs/hub/BOX_INFRA_MISSION_PROMPT.md`,
`docs/hub/HUB_ROLE.md`, `docs/ops/BOX_LANE_RUNNER.md`, `docs/ops/ORCH.md`, `docs/ops/BUILDER_EGRESS.md`, `docs/antigravity/LANE_RULES.md`, `docs/agents/LESSONS.md`, `docs/strategy/research/`.
