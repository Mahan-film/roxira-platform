# Current state (read this first)

> **Last update: 2026-11-26 (P1 WAVE 40 milestone refresh on `origin/main` @ `edb90022b`).**
> New hub: `docs/hub/HUB_START.md` -> `docs/hub/MAIN_HUB_MASTER_BRIEF.md` -> this file. Laptop: `docs/hub/BOX_HUB_MASTER_BRIEF.md`.
> Live GitHub data beats this file: `gh pr list`, the newest `## WAVE`, `HUB -> LANES`, `BOX:` and `HUB→BOX:` comments on #592, and `HUB-ANSWER`/`ASK-BOX` on #965.

The owner speaks Persian: reply in Persian; code, commits and docs in English. Never name the owners' country ("the default pack").
The owner wants maximum pressure on Antigravity lanes and cheap agents (Haiku/Sonnet 5.5) for hub work; the hub plans, reviews and merges.

## Hub discipline
- ONE acting Mac hub chat. The Mac hub never administers or SSHes into the Linux box; GitHub is the control plane (#592 notes, #965 answers).
- Secrets: clipboard relay only (never files on the Mac, never AirDrop). Do not rotate `box-lanes` again unless exposed.
- **Merge = production write** (autodeploy about every 5 min). Merge check (lesson 37): valid `VERDICT` = `github-actions[bot]` `"Cross-family review"` comment naming a prefix of the CURRENT head SHA, non-google/gemini family for lane accounts (`mahan-films`, `mahansudo`), and last `Verdict:` line `no blocker`; CI green at job level; read EVERY comment newer than the head from any author and stop on any `Verdict: blocker` or `BLOCKER:`; not on the Held list (`#1309`, `#943`). Use the merge queue: `gh pr merge N --auto --match-head-commit <sha>`.
- Protected paths (migrations, auth, payment, Dockerfile.prod, deploy scripts, workflows, nginx, production compose) need `OWNER-OK #<PR> <sha7..40>` at the start of a PR comment from author id `243877284` matching the CURRENT head (any push voids it). Under hub standing authority (`2026-11-26` `26b`), CI/workflow/ops/docs PRs marked `[needs owner]` may be queued by the hub once desk says `no blocker` at head and CI is green (quoting owner authority), while migrations, auth, payment, billing, pricing, and tax rules always wait for the owner's own sentence. B1 core (Smart Judge core prompts/algorithms, billing, pricing, tax rules, ALL `country_packs/**`) is human-hub only.
- Private flip (`2026-11-26` `26c` owner decision): the repo stays **PUBLIC** until heavy product work (`#1473`) is done (zero paid GitHub plan; keeps rulesets, branch protection, and native merge queue at USD 0). The future zero-cost flip still needs the owners' own `"go private"` sentence after all checklist items pass.

## Box standing rules (accepted on #965, 2026-11-23)
- The box hub may merge `agent/claude-mahansudo/*` PRs, and its merge gate may merge lane PRs (live `dry_run=false` since 2026-11-23 13:08 UTC), when: desk `no blocker` at head, required checks green, no B1 core.
  Main-hub conditions: also refuse on any newer `Verdict: blocker`, the Held list, or a desk note that a critical file was truncated. The main hub may revert.
- `CI_RUNNER_MODE` is currently `main` (needs `auto` or `box` + loaded JIT proof before private flip); never set `CI_RUNS_ON`. Never edit box timers, gate config or runners: ask with `ASK-BOX:` on #965.
- Owner approver account (numeric id 243877284) invited read-level and registered in `owner_approver_ids`.

## Fleet (Antigravity, v4 prompts)
- Active lane set (`25g`–`26b`): `L1`–`L12`, `P1`, `M1` (LABELER: adds `merge-queue` label whenever `main` is green, does not wait for retired `DQ`, never merges), `M2` (conflicts/broken CI), `M3` (main/deploy health), `OP` (owner packets); `H1` proposed in `#1482` (every 2 h status & `DESK-OVERRIDE` summary once merged). `DQ` and `RV1`–`RV8` stay retired (`PROMPTS_FA_v4.md` in `#1468` keeps `DQ`/`RV1`/`RV2` blocks for optional reactivation). Each lane fixes its own desk blockers (`L8` handles orphaned/stale PRs; false positives go to `#592` for hub `DESK-OVERRIDE`).
  WIP cap **8 open PRs per lane** (not counting `WAITING-OWNER` / `[needs owner]` or `needs-human` B1 PRs). One push per PR per round; never push on a head with a `no blocker` VERDICT and green CI (except M2/L8 fixing a conflict or blocker). Lanes do NOT manually dispatch `review-desk.yml`. When `> 25` open non-draft PRs lack a valid head `VERDICT` (`GATE ON`), builders fix only their own open PRs or take `GATE-EXEMPT` rows (`L1` may also take deploy/disk/CI/preflight rows); when `<= 25` (`GATE OFF`), all queued rows open.
  Ready PRs (not draft, local tests pass, not `needs-human`/`do-not-merge`/`[needs owner]`) get `gh pr edit N --add-label merge-queue` so the box merge gate picks them up.
- Slash policy: per-block allowlist (`/compact` after every 3 PRs; `/plan` for P1 and big L3/L5 rows; `/boost` only for one hard bug in L3/L5/RV1/RV2; `/browser on localhost only` + `impeccable` in L9/L10/L11; `/swarm` max 3 in L8/L11/RV1/RV2; capped `/schedule` only in M3/DQ); no bare `/boost`; never `/teamwork`, `/automation`, `/goal`.
- Worktrees and caches go to the external SSD: `/Volumes/ssd/roxira-work` (APFS, case-sensitive, encrypted) via `source scripts/dev/lane_env.sh`; `claim.sh` uses it.
  The other SSD partition is exFAT: not for git. Remove only a PR's own worktree when finished.
- Owner guide: `docs/owner/ANTIGRAVITY_GUIDE_FA.md`.

## WAVE 40 (2026-11-26) and live GitHub state (`origin/main` @ `edb90022b`)
- **Merged milestones since `3d01763d9` (25 commits):** `#1466` (WAVE 38 STATE/LANE_RULES), `#1423` (`data_import` QA), `#1368` (`mutating-routes-auth.spec.ts`), `#1425` (FORCE RLS gap audit: 141/146 public tables forced incl. all 139 `tenant_id` tables, 5 allowlisted in `docs/security/FORCE_RLS_GAP.md`), `#1430` (legal compliance docs), `#1433` (pilot runbook & status page design), `#1434` (backup/DR evidence pack), `#1435` (`#230` audit regenerated), `#1436` (fuzzy duplicate queue), `#1440` (opening stock/PO/SO import), `#1442` (`T1415` tax pages a11y/RTL/375px), `#1484` (merge-gate hardening: hub blocker hold, B1 globs, `DESK-OVERRIDE`, `auto_resume`, desk retry, `queue_mode="github"`), `#1453` (`openai` pip bump), `#1462` (`T273` R22 agent bridge API-key mode), `#1486` (`DQ` allowed in `scripts/dev/lane_preflight.sh`), `#1448` (`T182` intercompany mirroring), `#1475` (opening voucher period-lock guard), `#1483` (portable skills & handoff hooks), `#1508` (`T246` deterministic post-answer verifier), `#1499` (`T241` Qdrant hybrid BM25+dense+sparse with as-of filters), `#1374` (`#1348` law validity dates & public collection guard), `#1431` (`#1382` `judiciary_circulars` retrieval behind flag), `#1426` (`#1381` voice mid-word truncation fix), `#1354` (`#1322` `T349` phone answers grounded flag, no upsell, phonetics parity), and `#1297` (`#1287` `T338` pack/currency registry validation & `CountryPackInterceptor`).
- **Main CI (`edb90022b`):** push CI run `45716396656` is **RED** on `roxira-ci` in `Backend (tsc + jest + Postgres specs)` & `M1 gate (Playwright)` (`Initialize containers`, fixed host port `5432` collision; earlier `15efeb3e3` run `45715703248` passed). Fix PR `#1524` failed workflow parsing (`run 45707613475`, invalid `job.services` in job-level `env:` at `ci.yml:675,794,800`, plus hardcoded step ports at `:710,721`) and needs an L1 fix.
- **Open PR queue & GATE:** `86` open PRs (`3` drafts `#1294–#1296`, `83` non-draft: `45` valid `no blocker` incl. `3` truncated `#1422 #1468 #1490`, `15` valid `blocker`, `23` without valid head `VERDICT` -> **`GATE OFF`**). `205` open issues.
- **Owner priority 1 (`25c`/`25i`/`26b`):** automatic accounting for the default pack, gated by `#1473` (S1–S12 E2E acceptance gate, green CI job link on `main` required; `0/12` checked). Frozen until `#1473` is green: non-default / secondary packs, billing R31, R27/R28, and R33 upgrades.
- **Root causes (`26b`):** (R1) `roxira-ci` port `5432` collision (`#1524` fix broken), (R2) `[needs owner]` PRs rarely get desk verdicts under hosted cron (moving desk to box `systemd --user` timer / evaluating self-hosted `pr-agent`), (R3) Dependabot `#1454` red on `TS2345` in `sqljs-common.ts:23` (`@types/sql.js` 1.16.0 -> L2 fix PR), (R4) repo stays `PUBLIC` until `#1473` finishes (`26c`).
- **Merge-gate & review hygiene (`25f`–`25h`):** `merge-queue` label live (`#1484` merged); `11` open PRs carry `needs-human`; Held PRs `#1309` and `#943` carry `do-not-merge`. Lanes never reply to or push for ruff/ESLint inline comments.
- Mac disk: launchd job `ir.roxira.reaper` runs every 15 min (`#1404`/`#1405`); SSD work disk has ~297 GiB free (`preflight`).
- Legal corpus: prod Qdrant has laws v6 (served, 6304), v7b (7229, not served), regulations_v3b (1322), rulings_v1 (1732), judiciary_circulars (250, retrieval merged in `#1431` behind flag). Switching the served law collection needs the owner's sentence.

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
- Autodeploy active every 5 min with smoke + rollback (`#1470` deployed `f010aea0`; `26` merges up to `edb90022b` awaiting `#965` box confirm; red `main` CI skips autodeploy on failed SHAs). Host 7.7 GB RAM, disk **65%** (down from 77% after hub removed `unclecode/crawl4ai:0.9.4` 8.63 GB and ~1.1 GB unused images/old cache; 20 containers up, site 200 per 2026-11-25 check).
- Docker: rollback needs the `:prev` tags (`deploy.sh:89-101`, `rollback.sh:39-43`) so NEVER `docker image prune -a`. 3 `:prev` rollback images kept. `deploy/systemd/roxira-docker-prune.service` still uses `until=168h` (`#1525` open `[needs owner]` for `until=24h`).
- Backups OK (DR dump + restic nightly, offsite timers). TLS until 2027-01-17/20. `#1200` Postgres/PgBouncer recreate still not done.

## Waiting on the owner
- `SMOKE_AUTH_TOKEN` for a real chat probe in the deploy smoke (`#1514` `[needs owner]` open). Ruleset: add `Pytest (unit)` and `M1 gate` (`backend-gate` `#1517`) as required once green.
- Private flip (`26c` owner decision): repo stays `PUBLIC` until `#1473` completes (`PRIVATE_FLIP_CHECKLIST.md` `P2`, `P7`, `P11`, `P13–P17` tracked as future zero-cost checklist); exact `--owner-go` sentence from both owners later.
- `OWNER-OK #<PR> <sha7..40>` from approver id `243877284` (`0` open PRs currently carry a valid `OWNER-OK` at head) for migrations/auth/payment/billing/pricing/tax-rules (`#831 #868 #963 #964 #1229 #1242 #1399 #1410 #1428 #1441 #1513`, etc.); CI/ops/docs `[needs owner]` PRs (`#1495 #1500 #1514 #1517 #1521 #1522 #1524 #1525`) can be queued by the hub after `no blocker` + green CI (`26b`).
- P17 full-history gitleaks triage (`31` findings across `5570` commits: `30` `generic-api-key`, `1` `private-key` posted on `#592` comment `7175579722`).
- Held, never touch (`do-not-merge`): `#1309`, `#943`.

## Known issues
- Main CI red on `edb90022b` (`run 45716396656`) from `roxira-ci` fixed host port `5432` collision (`#1524` failed workflow parsing `run 45707613475`, needs L1 fix); `CI_RUNNER_MODE` = `main`; `review-desk.yml` hosted cron misses `[needs owner]` PRs (`R2`).
- Dependabot `#1454` red on `TS2345` in `sqljs-common.ts:23` after `@types/sql.js` 1.16.0 (`R3`, L2 fix queued).
- Mac: ~297 GiB free on SSD work disk; `check_hooks.sh` (`P2`) pending. Clean per branch only, never bulk.
- Docs sprawl: 7+ state files, 7 handoffs, prompts in 4 places (`#1498` archives 31 dated files, `#1468` `PROMPTS_FA_v4.md` open with `no blocker(trunc)`, `#1523` WAVE 39 docs superseded by WAVE 40 docs PR).
- 164 OSV findings (`#1031` / `#1522`); CSP report-only; `#1425` verified 141/146 public tables FORCE RLS including all 139 `tenant_id` tables (`5` allowlisted in `docs/security/FORCE_RLS_GAP.md`, `user_totp` and `auth_passkey_credentials` next); Ruff 14k violations (non-blocking, inline PR noise silenced in `#1471`).

## Next step for the new hub chat
1. Read `#592` `HUB -> LANES (2026-11-26 b)`, `HUB -> LANES (2026-11-26 c)`, `MAIN HEALTH`, and `## WAVE 40 (P1, 2026-11-26)`.
2. Land/review `#1468` (`PROMPTS_FA_v4.md`), `#1482` (`H1`), `#1458` (owner packets), `DESK-OVERRIDE`s (`#763 #771 #805 #854 #1192 #1406 #1449`), and CI/ops `[needs owner]` PRs (`#1495 #1500 #1514 #1517 #1521 #1522 #1524 #1525`) once desk `no blocker` + green CI hold.
3. Keep replies to the owner in Persian; never name a country.

## Key documents
`docs/hub/SYSTEM_OVERVIEW.md`, `docs/hub/MAIN_HUB_MASTER_BRIEF.md`, `docs/antigravity/LANE_RULES.md`, `docs/antigravity/PROMPTS_FA.md` (`PROMPTS_FA_v4.md` in `#1468`), `docs/ops/PRIVATE_FLIP_CHECKLIST.md`, `docs/strategy/research/R36_DIGEST.md` (issue #1387), `docs/agents/LESSONS.md`.
