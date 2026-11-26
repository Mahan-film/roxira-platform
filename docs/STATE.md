# Current state (read this first)

> **Last update: 2026-11-26 (main hub, Claude Opus 5.5 session on the Mac; handoff after the Antigravity features research).**
> New hub: `docs/hub/HUB_START.md` -> `docs/hub/MAIN_HUB_MASTER_BRIEF.md` -> this file. Laptop: `docs/hub/BOX_HUB_MASTER_BRIEF.md`.
> Live GitHub data beats this file: `gh pr list`, the newest `## WAVE`, `HUB -> LANES`, `BOX:` and `HUB→BOX:` comments on #592, and `HUB-ANSWER`/`ASK-BOX` on #965.

The owner speaks Persian: reply in Persian; code, commits and docs in English. Never name the owners' country ("the default pack").
The owner wants maximum pressure on Antigravity lanes and cheap agents (Haiku/Sonnet 5.5) for hub work; the hub plans, reviews and merges.

## Hub discipline
- ONE acting Mac hub chat. The Mac hub never administers or SSHes into the Linux box; GitHub is the control plane (#592 notes, #965 answers).
- Secrets: clipboard relay only (never files on the Mac, never AirDrop). Do not rotate `box-lanes` again unless exposed.
- **Merge = production write** (autodeploy about every 5 min). Merge check (lesson 37): valid `VERDICT` = `github-actions[bot]` `"Cross-family review"` comment naming a prefix of the CURRENT head SHA, non-google/gemini family for lane accounts (`mahan-films`, `mahansudo`), and last `Verdict:` line `no blocker`; CI green at job level; read EVERY comment newer than the head from any author and stop on any `Verdict: blocker` or `BLOCKER:`; not on the Held list (`#1309`, `#943`). Use the merge queue: `gh pr merge N --auto --match-head-commit <sha>`.
- Protected paths (migrations, auth, payment, Dockerfile.prod, deploy scripts, workflows, nginx, production compose) need `OWNER-OK #<PR> <sha7..40>` at the start of a PR comment from author id `243877284` matching the CURRENT head (any push voids it). B1 core (Smart Judge core prompts/algorithms, billing, pricing, tax rules, ALL `country_packs/**`) is human-hub only.
- Private flip: only the owners say "go private". The box plans it after all checklist items pass; the hub told the box on #965 it needs the owners' own sentence.

## Box standing rules (accepted on #965, 2026-11-23)
- The box hub may merge `agent/claude-mahansudo/*` PRs, and its merge gate may merge lane PRs (live `dry_run=false` since 2026-11-23 13:08 UTC), when: desk `no blocker` at head, required checks green, no B1 core.
  Main-hub conditions: also refuse on any newer `Verdict: blocker`, the Held list, or a desk note that a critical file was truncated. The main hub may revert.
- `CI_RUNNER_MODE` is currently `main` (needs `auto` or `box` + loaded JIT proof before private flip); never set `CI_RUNS_ON`. Never edit box timers, gate config or runners: ask with `ASK-BOX:` on #965.
- Owner approver account (numeric id 243877284) invited read-level and registered in `owner_approver_ids`.

## Fleet (Antigravity, v4 prompts)
- Active lane set (`25g`/`25h`/`25i`): `L1`–`L12`, `P1`, `M1` (LABELER: adds `merge-queue` label, never merges), `M2` (conflicts/broken CI), `M3` (main/deploy health); `H1` proposed in `#1482`. `DQ` and `RV1`–`RV8` are retired: the 2-hourly desk cron + gate dispatch handles reviews, and each lane fixes its own desk blockers (`L8` handles orphaned PRs; false positives go to `#592` for hub `DESK-OVERRIDE`).
  WIP cap **8 open PRs per lane** (not counting PRs waiting only for the owner, `WAITING-OWNER`). One push per PR per round; never push on a head with a `no blocker` VERDICT and green CI (except M2/L8/owner-lane fixing a conflict or blocker). Lanes do NOT manually dispatch `review-desk.yml`.
  Ready PRs (not draft, local tests pass, not `needs-human`/`do-not-merge`/`[needs owner]`) get `gh pr edit N --add-label merge-queue` so the box merge gate picks them up.
- Slash policy: per-block allowlist (`/compact` when the context is full, `/plan` for P1); no bare `/boost`; no `/teamwork`, `/goal`. `/automation` and `/schedule` are under review (see 2026-11-26 below). Rounds are 8-12 PRs, not 3 (note 26d, PR #1542).
- Worktrees and caches go to the external SSD: `/Volumes/ssd/roxira-work` (APFS, case-sensitive, encrypted) via `source scripts/dev/lane_env.sh`; `claim.sh` uses it.
  The other SSD partition is exFAT: not for git. Remove only a PR's own worktree when finished.
- Owner guide: `docs/owner/ANTIGRAVITY_GUIDE_FA.md`.

## WAVE 38 (2026-11-25) and live GitHub state (`origin/main` @ `3d01763d9`)
- **Merged milestones since `f010aea02`:** `#1376` (CoW `node_modules` + `claim.sh` disk guard), `#1378` (local multi-lane test stack), `#1405` (Mac disk guard v2), `#1481` (semgrep rule tests opt-in, unblocking `Pytest (unit)` + urgent Telegram chat-probe alerts), `#1479` (gitleaks secret scan on hosted runner), and `#1471` (ruff reviewdog `github-pr-check`, drop PR count comment, ignore `RUF001-003`).
- **Owner priority 1 (`25c`/`25i`):** automatic accounting for the default pack, gated by `#1473` (S1–S12 E2E acceptance gate, green CI job link on `main` required). Frozen until `#1473` is green: non-default packs (DE, Gulf, secondary), billing R31, R27/R28, and R33 upgrades.
- **Merge-gate & review hygiene (`25f`–`25h`):** `merge-queue` label created and live (`#1376`, `#1378`, `#1405` merged via gate). 17 B1/nginx PRs labeled `needs-human`; Held PRs `#1309` and `#943` labeled `do-not-merge`. `#1484` (`[needs owner]`) hardens `merge_gate.py`.
- **Review-noise rule (`25d`/`25g`):** lanes do NOT reply to or push for ruff/ESLint inline comments; act only on red required checks, desk `"Verdict: blocker"`, or hub `"BLOCKER:"`; batch fixes (one push per review round).
- Mac disk: launchd job `ir.roxira.reaper` runs every 15 min (`#1404`/`#1405`); SSD work disk has ~312 GiB free.
- Legal corpus: prod Qdrant has laws v6 (served, 6304), v7b (7229, not served), regulations_v3b (1322), rulings_v1 (1732), judiciary_circulars (250, retrieval PR `#1431`). Switching the served law collection needs the owner's sentence.

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
- Autodeploy active every 5 min with smoke + rollback (`#1470` deployed `f010aea0`; newer merges up to `3d01763d` awaiting box confirm on `#965`). Host 7.7 GB RAM, disk **65%** (down from 77% after hub removed `unclecode/crawl4ai:0.9.4` 8.63 GB and ~1.1 GB unused images/old cache; 20 containers up, site 200).
- Docker: rollback needs the `:prev` tags (`deploy.sh:89-101`, `rollback.sh:39-43`) so NEVER `docker image prune -a`. 3 `:prev` rollback images kept. Weekly prune timer `until=168h` stays (recent 72 h build cache reused by deploys).
- Backups OK (DR dump + restic nightly, offsite timers). TLS until 2027-01-17/20. #1200 Postgres/PgBouncer recreate still not done.

## 2026-11-26 hub session (Opus 5.5, Mac)
- Merged: #1481 #1479 #1471 #1484 (merge gate: hold on hub `Verdict: blocker`, B1/nginx globs, `DESK-OVERRIDE #<PR> <sha7>: reason`, auto-resume on green main, desk retry, `queue_mode` github enqueue up to 5 per tick), #1483 (portable skills, hooks, `auto_handoff.sh`), and with the owner's yes #1379 #1198 #1239 #663. Hub re-reviewed B1 PRs and queued 1508 1499 1374 1431 1426 1354 1297.
- Hub blockers posted: #1437 (normaliser changes content_hash/point_id -> duplicate Qdrant points), #1443 (TTS regex misreads money with thousands separators), #1432 (bge-m3 revision pin also hits Hakim).
- Notes on #592: 25g-25j, 26a (WAVE 39), 26b (WAVE 40 brief, root causes R1-R4), 26c (stay public), 26d (lanes run 8-12 PRs per round; L12 updates prompts -> PR #1542).
- Root causes: R1 box CI port 5432 collision (fix #1524 `[needs owner]`, dynamic host ports); R2 `[needs owner]` PRs never got desk verdicts; R3 Dependabot `@types/sql.js` drift (#1454); R4 Free private repos lose rulesets and the native merge queue.
- ASK-BOX on #965 (comment 7175507304): sync gate to #1484, add B1 globs, `queue_mode = "github"` after one dry run, clear PAUSE, free port 5432. Box reply not yet read.
- **Owner decisions:** repo stays PUBLIC until the heavy product work is done; no Team plan, the box takes CI; **blanket authority for every approval (2026-11-26)**, so `[needs owner]` PRs wait only on desk no-blocker + hub review (the gate's OWNER-OK still needs account id 243877284; otherwise the hub quotes the owner sentence and merges). Deep research runs in the owner's Gemini; the hub only writes prompts and light-checks results.
- **Antigravity features research (owner's Gemini, 2026-11-26), to act on next:** `.agents/workflows` is deprecated -> Agent Skills (`.agents/skills/<name>/SKILL.md`, loaded on demand); rules in `GEMINI.md`/`AGENTS.md` (12k chars each); `/automation` starts a fresh session on a schedule even with no chat open (native, ToS-allowed; Flash/Flash Lite/Pro); `/schedule` dies with its chat; "New worktree mode" per conversation; `/swarm` workers; `/compact <next instruction>`; compute-based quota with reported weekly lockouts, about 5 concurrent agents practical; ToS forbids third-party OAuth tools, allows native autonomous agents; agents must not merge to main. Light-check these claims before rewriting prompts.

## Waiting on the owner
- Nothing blocking: blanket authority given. Owner still pastes Antigravity prompts and runs Gemini research prompts the hub writes.
- Private flip: only after the heavy product work; checklist in `docs/ops/PRIVATE_FLIP_CHECKLIST.md`.
- Held, never touch (`do-not-merge`): #1309 #943.

## Known issues
- Mac: many worktrees/branches; clean per branch only, never bulk. Docs sprawl (L12 consolidation).
- 164 OSV findings (#1031); CSP report-only; Ruff 14k violations (non-blocking).
- Box CI port 5432 collisions until #1524 lands or the box frees the port.

## Next step for the new hub chat
1. Redesign lanes as stateless queue workers from the research: one `process-queue` Agent Skill + `GEMINI.md` rules (claim row on the issue, worktree, test, PR, label `merge-queue`, never merge); replace 15 always-open chats with 3-5 `/automation` runs on Flash plus a few manual lanes; update this file's slash policy, `LANE_RULES.md`, `PROMPTS_FA.md`. Give the owner a short Persian setup guide (clicks only).
2. Read new lane reports and Gemini answers the owner pastes; turn them into rows / WAVE briefs for P1.
3. Merge queue: #1482 (H1), #1542 (26d prompts), #1524 (box ports); decide #1449 (L5 asks DESK-OVERRIDE) and review #1410 (auth + migration) under blanket authority.
4. Read the box reply on #965 (gate sync, queue mode, port 5432).

## Key documents
`docs/hub/SYSTEM_OVERVIEW.md`, `docs/hub/MAIN_HUB_MASTER_BRIEF.md`, `docs/antigravity/LANE_RULES.md`, `docs/antigravity/PROMPTS_FA.md`, `docs/ops/PRIVATE_FLIP_CHECKLIST.md`, `docs/strategy/research/R36_DIGEST.md` (issue #1387), `docs/agents/LESSONS.md`.
