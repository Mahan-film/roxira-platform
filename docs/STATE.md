# Current state (read this first)

> **Last update: 2026-11-24 evening (P1 planner refresh, main at `808dee63c`).**
> New hub: `docs/hub/HUB_START.md` -> `docs/hub/MAIN_HUB_MASTER_BRIEF.md` -> this file. Laptop: `docs/hub/BOX_HUB_MASTER_BRIEF.md`.
> Live GitHub data beats this file: `gh pr list`, the newest `## WAVE`, `HUB -> LANES`, `BOX:` and `HUB→BOX:` comments on #592, and `HUB-ANSWER`/`ASK-BOX` on #965.

The owner speaks Persian: reply in Persian; code, commits and docs in English. Never name the owners' country ("the default pack").
The owner wants maximum pressure on Antigravity lanes and cheap agents (Haiku/Sonnet 5.5) for hub work; the hub plans, reviews and merges.

## Hub discipline
- ONE acting Mac hub chat. The Mac hub never administers or SSHes into the Linux box; GitHub is the control plane (#592 notes, #965 answers).
- Secrets: clipboard relay only (never files on the Mac, never AirDrop). Do not rotate `box-lanes` again unless exposed.
- **Merge = production write** (autodeploy about every 5 min). Merge check (lesson 37): desk `Verdict: no blocker` naming the CURRENT head, CI green at job level,
  no comment newer than the head with `Verdict: blocker`, not on the Held list. Use the merge queue: `gh pr merge N --auto --match-head-commit <sha>`.
- Protected paths (migrations, auth, payment, Dockerfile.prod, deploy scripts, workflows, nginx, production compose) need the owner's answer for that PR;
  the hub then posts `OWNER-OK @ <sha>` and queues it. B1 core (Smart Judge core prompts/algorithms, billing, pricing, tax rules, ALL `country_packs/**`) is human-hub only.
- Private flip: only the owners say "go private". The box plans it for 2026-11-25 after its merge gate goes live; the hub told the box on #965 it needs the owners' own sentence.

## Box standing rules (accepted on #965, 2026-11-23)
- The box hub may merge `agent/claude-mahansudo/*` PRs, and its merge gate may merge lane PRs, when: desk no blocker at head, required checks green, no B1 core.
  Main-hub conditions: also refuse on any newer `Verdict: blocker`, the Held list, or a desk note that a critical file was truncated. The main hub may revert.
- `CI_RUNNER_MODE` is currently `main` (verified via `gh variable list`; box merge gate is live with `dry_run = false` since 2026-11-23 13:08 UTC per #965). Never edit box timers, gate config or runners: ask with `ASK-BOX:` on #965.
- Owner approver account (numeric id 243877284) invited read-level; the box registers it in `owner_approver_ids`.

## Fleet (Antigravity, all on the Mac until the laptop's Antigravity works)
- One stable prompt per lane in `docs/antigravity/PROMPTS_FA.md` (also `prompts/L<n>.txt`): no wave or issue numbers; the queue is the newest `## WAVE` on #592.
  The owner re-pastes the same block every round. Mac cap 8 chats. Mac chats: L1-L12 and RV1-RV8 (RV = review helpers, PR number modulo 8; paste RV1-RV5 then RV6-RV8). L7 now also runs on the Mac (repo files and offline tests only; laptop work is posted as `NEEDS BOX RUN`). WIP cap 8 open PRs per lane (WAVE 34).
- Slash policy: `/swarm` only L8/L11 (max 3 workers, own working copies), `/boost` L3/L5 for one hard bug, `/teamwork` and `/schedule` never.
- Worktrees and caches go to the external SSD: `/Volumes/ssd/roxira-work` (APFS, case-sensitive, encrypted) via `source scripts/dev/lane_env.sh`; `claim.sh` uses it.
  The other SSD partition is exFAT: not for git. Mac system disk had about 14 GiB free on 2026-11-23.
- Owner guide: `docs/owner/ANTIGRAVITY_GUIDE_FA.md`.

## WAVE 35 (2026-11-24 evening) and verified status
- WAVE 35 posted on #592 (71 open PRs, 241 open issues, WIP cap 8 open PRs per lane) with a Production readiness table.
- Merged since WAVE 34: #1266 (tenant export), #1365/#1370 (tax/report UI), #1366 (first-customer journey QA), #1369 (sales cycle UI), #1371 (a11y/RTL audit), #1384 (locked Python dev env), #1385 (latest-circular regulations), #1397 (R36/Tech Radar docs), #1398 (corpus inventory doc), #1400 (laptop CI capacity probe), #1401 (Persian golden set), #1407 (prod disk reclaim plan), #1408 (licence/model guard), #1409 (aarch64 wheel matrix), #1412 (T178 actorRole fix), #1420 (handoff). Main CI runs `45375049847` and `45374659383` are green.
- Open PRs at WIP cap (8/8): L1 (`#1427 #1424 #1405 #1378 #1376 #1349 #1309(held) #1198`), L2 (`#1440 #1436 #1429 #1423 #1386 #1242 #1229 #1226`), L6 (`#1445 #1439 #1438 #1435 #1433 #1410 #1406 #1297`). L4 has 7/8; L3/L5 have 5/8; L7 has 3/8; L9–L11 have 1–2/8; L8/L12 have 0/8.
- Hub/owner reviews still owed (B1 core / protected): `#1374` (law validity dates), `#1432` (embedding weights), `#943` (tax engine), `#663`, `#831`, `#963`, `#1198`, `#1229`, `#1242`, `#1262`, `#1297`, `#1349`, `#1379`, `#1386`.
- Mac disk: internal disk had ~14 GiB free on 2026-11-23; SSD work disk (`/Volumes/ssd/roxira-work/wt`) has 314 GiB free (2026-11-24).
- Legal corpus is NOT lost: prod Qdrant has laws v6 (served, 6304), v7b (7229, not served), regulations_v3b (1322), rulings_v1 (1732), judiciary_circulars (250, wired in open PR `#1431` for `#1382`). Switching the served law collection needs the owner's sentence.

## Production (read-only facts, 2026-11-24)
- **Autodeploy smoke gate fix ready to merge:** PR `#1424` (for `#1413`) is `MERGEABLE`, CI green at job level, and has `OWNER-OK #1424 c320dc9` from `mahansudo`. Until `#1424` merges and deploys, prod stays on `71c80e51` (`#1072` and `#1200` merged on `main` but not running). After `#1424` deploys, recreate `postgres_prod` and `pgbouncer_prod` (owner runs the compose command) so the sizing applies.
- Host: aarch64, 4 vCPU, **7.7 GB RAM** (5 GB used), disk 78%. Postgres 17 is tiny (137 MB, 9 connections). Qdrant v1.19.0 (upgrade row #1388). AI core image python:3.11 (#1391 matrix decides 3.14 or 3.15; #1309 held).
- Kavenegar key was rotated (Mac env and prod .env match, containers recreated, SMS arrives). Owner is creating new SMS templates with the last line `@domain #%token` (ghazi-verify2, roxira-verify2); then the hub gives the .env template-name change.

## Waiting on the owner
- Private flip (not done, repo still public): needs the exact `--owner-go` sentence from both owners AFTER: docker-slot proof under load (#1395/#1400), P14 (disable deploy-prod.yml at flip), billing check P13/P15 (no payment method; hosted minutes budget), P16 gate count, P2 hooks on Mac and colleague, history scan done (31 findings, 8 triaged: old OpenRouter/SMS.ir keys in history, Kavenegar rotated; owner checks the other two providers).
- Owner sentences per protected PR: #663 (hash refresh, new head), #831 (RLS/login migration: owner logs in once after), #963 (renumber migration first), #1198 (desk blocker), #1262 #1349 #1386 #1309 #1229 #1242 #1297 #1379. L12 writes Persian owner packets (#1419).
- Restart window of 04:07 happened for #1072/#1200 only; #663 and #831 skipped.

## Known issues
- Review desk: 8 PRs per run; free models give false blockers; dispatch once, never while one runs (a loop script did this overnight; it lived in the old session's scratchpad).
- #1295 hub_merge.py fail-open gaps; 164 OSV findings (#1031); CSP report-only; 21 tables without FORCE RLS (#1417 report); Ruff 14k violations (non-blocking).

## Next step for the new hub chat
1. Read newest `HUB -> LANES`/WAVE 34 on #592 and #965. 2. `gh pr list`; merge queued PRs that have a no-blocker desk verdict at the current head (lesson 37); re-run the review desk once if heads changed. 3. Review #1385 again after L4 pushes, then #1374 #943 #1266. 4. Ask the owner for the single sentence on the #1413 smoke-gate fix. 5. After deploy works: Postgres recreate command, then flip readiness. Do not name the country; replies to the owner in Persian.

## Key documents
`docs/hub/SYSTEM_OVERVIEW.md`, `docs/hub/MAIN_HUB_MASTER_BRIEF.md`, `docs/antigravity/LANE_RULES.md`, `docs/antigravity/PROMPTS_FA.md`, `docs/ops/PRIVATE_FLIP_CHECKLIST.md`, `docs/strategy/research/R36_DIGEST.md` (issue #1387), `docs/agents/LESSONS.md`.
