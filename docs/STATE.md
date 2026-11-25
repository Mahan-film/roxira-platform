# Current state (read this first)

> **Last update: 2026-11-26 (P1 WAVE 39 milestone refresh on `origin/main` @ `70b0f1dbc`).**
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
- Active lane set (`25g`/`25h`/`25i`/`26a`): `L1`–`L12`, `P1`, `M1` (LABELER: adds `merge-queue` label whenever `main` is green, does not wait for retired `DQ`, never merges), `M2` (conflicts/broken CI), `M3` (main/deploy health); `H1` proposed in `#1482`. `DQ` and `RV1`–`RV8` stay retired: the 2-hourly desk cron + gate dispatch handles reviews (moving desk to a box timer in `26a`), and each lane fixes its own desk blockers (`L8` handles orphaned/stale PRs; false positives go to `#592` for hub `DESK-OVERRIDE`).
  WIP cap **8 open PRs per lane** (not counting PRs waiting only for the owner, `WAITING-OWNER`). One push per PR per round; never push on a head with a `no blocker` VERDICT and green CI (except M2/L8/owner-lane fixing a conflict or blocker). Lanes do NOT manually dispatch `review-desk.yml`. When > 25 open non-draft PRs lack a valid head `VERDICT` (`GATE ON`), builders fix only their own open PRs or take `GATE-EXEMPT` rows.
  Ready PRs (not draft, local tests pass, not `needs-human`/`do-not-merge`/`[needs owner]`) get `gh pr edit N --add-label merge-queue` so the box merge gate picks them up.
- Slash policy: per-block allowlist (`/compact` after every 3 PRs; `/plan` for P1 and big L3/L5 rows; bounded `/boost` only for one hard bug on L3/L5; `/browser on localhost only` + `impeccable` on L9/L10/L11; `/swarm` max 3 on L8/L11; capped `/schedule` on M3 only); no bare `/boost`; never `/teamwork`, `/automation`, or `/goal`.
- Worktrees and caches go to the external SSD: `/Volumes/ssd/roxira-work` (APFS, case-sensitive, encrypted) via `source scripts/dev/lane_env.sh`; `claim.sh` uses it.
  The other SSD partition is exFAT: not for git. Remove only a PR's own worktree when finished.
- Owner guide: `docs/owner/ANTIGRAVITY_GUIDE_FA.md`.

## WAVE 39 (2026-11-26) and live GitHub state (`origin/main` @ `70b0f1dbc`)
- **Merged milestones since `3d01763d9`:** `#1466` (WAVE 38 STATE/progress/LANE_RULES), `#1423` (`data_import` QA), `#1368` (`mutating-routes-auth.spec.ts`), `#1425` (FORCE RLS gap audit: 141/146 public tables forced incl. all 139 `tenant_id` tables, 5 allowlisted), `#1430` (legal compliance docs), `#1433` (pilot runbook & status page design), `#1434` (backup/DR evidence pack), `#1435` (`#230` audit regenerated), `#1436` (fuzzy duplicate queue), `#1440` (opening stock/PO/SO import), and `#1442` (`T1415` tax pages a11y/RTL/375px).
- **Main CI (`70b0f1dbc`):** push CI run `45596394389` is **RED** (initial run and rerun) on `roxira-ci` in `Backend (tsc + jest + Postgres specs)` (`Bind for 127.0.0.1:5432 failed: port is already allocated`) and `M1 gate (Playwright)`. Autodeploy skips failed SHAs until main turns green, and `M1` paused queuing (`REPORT WAVE 38 2026-11-26 M1`).
- **Open PR queue & GATE:** `99` open PRs (`96` non-draft, `3` drafts `#1294–#1296`). Prior to the WAVE 39 docs PR, `33` open non-draft PRs lack a valid `github-actions[bot]` `VERDICT` at current head (`> 25` -> **`GATE ON`**; `51` valid `no blocker`, `12` valid `blocker`).
- **Owner priority 1 (`25c`/`25i`/`26a`):** automatic accounting for the default pack, gated by `#1473` (S1–S12 E2E acceptance gate, green CI job link on `main` required; `0/12` checked in `#1473`). Frozen until `#1473` is green: non-default/secondary packs, billing research R31, R27/R28, and R33 upgrades.
- **Open hub/docs/gate PRs:** `#1468` (`PROMPTS_FA_v4.md`, `no blocker`, CI green), `#1482` (`H1` role, `stale` VERDICT at `1183ea1`), `#1483` (portable skills, `no blocker`, CI green), `#1484` (`[needs owner]` merge-gate hardening), `#1458` (owner packets for 14 PRs, `no blocker`, `merge-queue`).
- **Merge-gate & review hygiene (`25f`–`25h`):** `merge-queue` label live; `18` open PRs carry `needs-human`; Held PRs `#1309` and `#943` carry `do-not-merge`. Lanes never reply to or push for ruff/ESLint inline comments.
- Mac disk: launchd job `ir.roxira.reaper` runs every 15 min (`#1404`/`#1405`); SSD work disk has ~297 GiB free (`preflight`).
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

## Production (read-only facts, 2026-11-26)
- Autodeploy active every 5 min with smoke + rollback (`#1470` deployed `f010aea0`; `18` PRs merged up to `70b0f1dbc` awaiting `#965` box confirm; newer autodeploys wait on green main CI). Host 7.7 GB RAM, disk **65%** (20 containers up, site 200 per 2026-11-25 check).
- Docker: rollback needs the `:prev` tags (`deploy.sh:89-101`, `rollback.sh:39-43`) so NEVER `docker image prune -a`. 3 `:prev` rollback images kept. `deploy/systemd/roxira-docker-prune.service` still uses `until=168h` (pending `25e` 2c update to `until=24h`).
- Backups OK (DR dump + restic nightly, offsite timers). TLS until 2027-01-17/20. #1200 Postgres/PgBouncer recreate still not done.

## Waiting on the owner
- SMOKE_AUTH_TOKEN for a real chat probe in the deploy smoke (`#1514` `[needs owner]` open). Ruleset: add `Pytest (unit)` and `M1 gate` (`backend-gate` `#1517`) as required once green.
- Private flip (repo still `PUBLIC`): exact `--owner-go` sentence from both owners after `P2`, `P7`, `P11`, `P13–P17` in `docs/ops/PRIVATE_FLIP_CHECKLIST.md` pass.
- `OWNER-OK #<PR> <sha7..40>` from approver id `243877284` (`0` open PRs currently carry a valid `OWNER-OK` at head): `Owner packet @ 2026-11-25` / `#1458` + `[needs owner]` PRs (`#1484`, `#1495`, `#1500`, `#1513`, `#1514`, `#1517`, `#1521`, `#1522`, plus `#868`, `#1242`, `#1372`, `#1399`, `#1441` once desk passes).
- Held, never touch (`do-not-merge`): `#1309`, `#943`.

## Known issues
- Main CI red on `70b0f1dbc` from `roxira-ci` fixed host port `5432` collision (`ci.yml` lines `667`/`782`); `CI_RUNNER_MODE` still `main`; `review-desk.yml` still on `ubuntu-latest` (USD 12 cap risk after flip).
- Mac: ~297 GiB free on SSD work disk; `check_hooks.sh` (`P2` across worktrees) pending. Clean per branch only, never bulk.
- Docs sprawl: 7+ state files, 7 handoffs, prompts in 4 places (`#1498` archives 31 dated files, `L12` consolidation continues).
- `#1484` (`[needs owner]`) merge-gate hardening open; 164 OSV findings (`#1031` / `#1522`); CSP report-only; `#1425` verified 141/146 public tables FORCE RLS including all 139 `tenant_id` tables (5 allowlisted in `docs/security/FORCE_RLS_GAP.md`).

## Next step for the new hub chat
1. Read `#592` `HUB -> LANES (2026-11-26 a)`, `MAIN HEALTH`, and `## WAVE 39 (P1, 2026-11-26)`.
2. Land/label `#1468` (`PROMPTS_FA_v4.md`), `#1483`, `#1458`; review `OWNER-OK` packets (`#1484`, `#1495`, `#1500`, `#1514`, `#1521`, `#1522`) and `DESK-OVERRIDE` requests (`#763 #771 #805 #854 #1192 #1406 #1449`).
3. Keep replies to the owner in Persian; never name a country.

## Key documents
`docs/hub/SYSTEM_OVERVIEW.md`, `docs/hub/MAIN_HUB_MASTER_BRIEF.md`, `docs/antigravity/LANE_RULES.md`, `docs/antigravity/PROMPTS_FA.md`, `docs/ops/PRIVATE_FLIP_CHECKLIST.md`, `docs/strategy/research/R36_DIGEST.md` (issue #1387), `docs/agents/LESSONS.md`.
