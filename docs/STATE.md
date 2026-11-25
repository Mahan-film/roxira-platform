# Current state (read this first)

> **Last update: 2026-11-25 (main hub, Claude Opus 5.5 session on the Mac).**
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
  the owner then posts `OWNER-OK #<PR> <sha7>` from the owner approver account (the hub prepares the packet and the exact line) and the hub queues it.
  B1 core (Smart Judge core prompts/algorithms, billing, pricing, tax rules, ALL `country_packs/**`) is owner-driven-hub only (any tool; `docs/hub/HUB_ROLE.md`).
- Private flip: only the owners say "go private". The box plans it for 2026-11-25 after its merge gate goes live; the hub told the box on #965 it needs the owners' own sentence.

## Box standing rules (accepted on #965, 2026-11-23)
- The box hub may merge `agent/claude-mahansudo/*` PRs, and its merge gate may merge lane PRs, when: desk no blocker at head, required checks green, no B1 core.
  Main-hub conditions: also refuse on any newer `Verdict: blocker`, the Held list, or a desk note that a critical file was truncated. The main hub may revert.
- `CI_RUNNER_MODE=auto` is agreed; never set `CI_RUNS_ON`. Never edit box timers, gate config or runners: ask with `ASK-BOX:` on #965.
- Owner approver account (numeric id 243877284) invited read-level; the box registers it in `owner_approver_ids`.

## Fleet (Antigravity, all on the Mac until the laptop's Antigravity works)
- One stable prompt per lane in `docs/antigravity/PROMPTS_FA.md` (also `prompts/L<n>.txt`): no wave or issue numbers; the queue is the newest `## WAVE` on #592.
  The owner re-pastes the same block every round. Mac cap 8 chats. Mac chats: L1-L12 and RV1-RV8 (RV = review helpers, PR number modulo 8; paste RV1-RV5 then RV6-RV8). L7 now also runs on the Mac (repo files and offline tests only; laptop work is posted as `NEEDS BOX RUN`). WIP cap 8 open PRs per lane (WAVE 34).
- Slash policy: `/swarm` only L8/L11 (max 3 workers, own working copies), `/boost` L3/L5 for one hard bug, `/teamwork` and `/schedule` never.
- Worktrees and caches go to the external SSD: `/Volumes/ssd/roxira-work` (APFS, case-sensitive, encrypted) via `source scripts/dev/lane_env.sh`; `claim.sh` uses it.
  The other SSD partition is exFAT: not for git. Mac system disk had about 14 GiB free on 2026-11-23.
- Owner guide: `docs/owner/ANTIGRAVITY_GUIDE_FA.md`.

## 2026-11-25 hub session (Opus 5.5, Mac)
- Main CI fixed (#1467). Smart Judge chat was broken about 15 h by #1385 (UnboundLocalError from a local import): fixed by #1469, deployed.
  #1470 closed the #1385 hub blocker (unreviewed/OCR regulation rows never called official, exact Jalali dates, inactive rows skipped); deployed f010aea0, 0 chat errors.
  #1463 closed as its duplicate. Autodeploy works again (the 2026-11-24 rollback loop is over).
- Hub notes on #592: 25b, 25c (full audit rows: L5 import period lock, L1 m1-gate blocking, L1 chat probe in deploy smoke, L11 #230 successor, L1 opentelemetry flake),
  25d (ruff reviewdog inline comments -> checks tab, ignore RUF001-003), 25e (lanes stop manual desk dispatch; desk one edited comment + status; prune timer 24h;
  WIP -> draft; close stale blocker PRs and duplicates; do not merge dependabot #1450 python 3.15).
- Measured (last 60 PRs): 435 comments, 77% bots, 57% ruff inline. Desk 595 runner-min in 2.5 days, 94/100 runs manual. 19 open PRs with newest desk blocker, 11 still CLEAN.
  Pytest (unit) red on main (opentelemetry `_ExtendedAttributes` import) and not required. 82 open PRs.
- Owner has a Gemini full-system audit prompt (not in the repo: public repo, it lists gaps). The Gemini report comes back to the hub: review it, turn it into rows.
- Rule for the hub: never reply to ruff/style inline comments; act only on red required checks, desk blocker, hub BLOCKER. Once desk says no blocker and CI is green, merge.

## Production (read-only facts, 2026-11-25)
- Repo HEAD f010aea0 (#1470), autodeploy every 5 min with smoke + rollback. Host 7.7 GB RAM (279 MB free, swap 4/8 GB), disk 77% (disk guard at 80%).
- Docker: rollback needs the `:prev` tags (`deploy.sh:89-101`, `rollback.sh:39-43`) so NEVER `docker image prune -a`. Several running containers use untagged images.
  Safe to remove (owner yes pending): build cache 5 GB, old pgbouncer `<none>` 4c1ca, two `roxira-sandbox-*` images. `unclecode/crawl4ai` 8.6 GB is a stopped service
  in `docker/research-stack/docker-compose.yml`: removal is a decision, not cleanup. Weekly prune timer `until=168h` reclaims 0 B (25e row).
- Backups OK (DR dump + restic nightly, offsite timers). TLS until 2027-01-17/20. #1200 Postgres/PgBouncer recreate still not done.

## Waiting on the owner
- Yes/no: clean the safe server items above (~5.6 GB, rollback untouched).
- SMOKE_AUTH_TOKEN for a real chat probe in the deploy smoke (25c row). Ruleset: add Pytest and m1-gate as required once green.
- Private flip (repo still public): exact `--owner-go` sentence from both owners after the checklist in `docs/ops/PRIVATE_FLIP_CHECKLIST.md`.
- Owner sentences per protected PR (#663 #831 #963 #1198 #1229 #1242 #1262 #1297 #1349 #1379 #1386 #1410); `OWNER-OK` must come from approver id 243877284.
- Held, never touch: #1309 #943.

## Known issues
- Mac: 178 git worktrees (about 31 GB on the SSD, 14 GB on the Mac), 1,751 local branches; Mac system disk about 29 GB free. Clean per branch only, never bulk.
- Docs sprawl: 7+ state files, 7 handoffs, prompts in 4 places. `docs/hub/memory/` duplicates the Claude memory. Consolidate after the Gemini audit.
- #1295 hub_merge.py fail-open gaps; 164 OSV findings (#1031); CSP report-only; 21 tables without FORCE RLS (#1417); Ruff 14k violations (non-blocking).

## Next step for the new hub chat
1. Read #592 notes 25c, 25d, 25e and newer lane reports. 2. If the owner gives the Gemini audit report, verify its claims and post one HUB -> LANES note with rows.
3. `gh pr list`; merge PRs with a no-blocker desk verdict at head (lesson 37); do not loop on nits. 4. #1468 (prompts v4, docs) merge after desk no blocker.
5. Server cleanup only after the owner's yes, with the safe list above. Replies to the owner in Persian; never name the country.

## Key documents
`docs/hub/SYSTEM_OVERVIEW.md`, `docs/hub/MAIN_HUB_MASTER_BRIEF.md`, `docs/antigravity/LANE_RULES.md`, `docs/antigravity/PROMPTS_FA.md`, `docs/ops/PRIVATE_FLIP_CHECKLIST.md`, `docs/strategy/research/R36_DIGEST.md` (issue #1387), `docs/agents/LESSONS.md`.
