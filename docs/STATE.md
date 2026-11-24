# Current state (read this first)

> **Last update: 2026-11-25 (P1 planner refresh, WAVE 37, `origin/main` @ `f010aea02`).**
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
- One stable prompt per lane (`L1`–`L12`, `DQ`, `M1`–`M3`, `P1`, `OP`, `RV1`–`RV2`): no wave or issue numbers; the queue is the newest `## WAVE` on #592 plus later `HUB -> LANES` / `OWNER ->` comments.
  WIP cap **8 open PRs per lane**. One push per PR per round; never push on a head with a `no blocker` VERDICT and green CI (except M2/RV1/RV2 fixing a conflict or blocker).
- Slash policy: per-block allowlist (`/compact` after every 3 PRs, `/plan` for P1); no bare `/boost`; no `/teamwork`, `/automation`, `/goal`, `/schedule`.
- Worktrees and caches go to the external SSD: `/Volumes/ssd/roxira-work` (APFS, case-sensitive, encrypted) via `source scripts/dev/lane_env.sh`; `claim.sh` uses it.
  The other SSD partition is exFAT: not for git. Remove only a PR's own worktree when finished.
- Owner guide: `docs/owner/ANTIGRAVITY_GUIDE_FA.md`.

## WAVE 37 (2026-11-25) and live GitHub state
- **GATE OFF**: 11 open non-draft PRs lack a valid `github-actions[bot]` VERDICT at head (threshold > 25; 68/79 non-draft PRs have a valid head VERDICT: 54 `no blocker`, 14 `blocker`; 3 draft PRs `#1294`, `#1295`, `#1296`; 82 total open PRs, 230 open issues).
- **Owner priority 1 (25c):** automatic accounting for the default pack. No new rows for non-default packs (DE, Gulf, secondary) until hub lifts the pause; L6 finishes its open PRs and default-pack work only.
- **Review-noise rule (25d):** lanes do NOT reply to or push for ruff/style inline comments; act only on red required checks, desk `"Verdict: blocker"`, or hub `"BLOCKER:"`; batch fixes (one push per review round) and dispatch review desk once when ready.
- Merged on 2026-11-24/25: `#1424` (autodeploy smoke gate, `#1413`), `#1465` (`lane_preflight.sh` roles), `#1467` (reviewdog download test marked `integration`, main unblocked), `#1469` (fixed Smart Judge `UnboundLocalError` in production, 0 errors since), `#1470` (closed `#1385` hub blocker on unreviewed/OCR regulation rows & untrusted dates), plus `#1412`, `#1266`, `#1384`, `#1385`, `#1420`. `#1468` (`docs/antigravity/PROMPTS_FA_v4.md`) is open and docs-only.
- GATE-EXEMPT priority rows in WAVE 37: L5 `data_import` period-lock check (`sepidar-persistence.service.ts:966` / `import-dry-run.service.ts:1433`); L1 ruff reviewdog `-reporter=github-pr-check` + `RUF001-003` ignore, `DQ` in `lane_preflight.sh`, `m1-gate` on backend/frontend without `continue-on-error`, deploy chat-answer smoke probe, and `jit_launcher.sh` `_ExtendedAttributes` fix; L4 `scripts/eval/legal_gate.py:732` `%%` fix; L11 `#230` E2E successor issue; L12 lane skills once `#1468` is on `main`.
- Hub reviews still owed (B1 core): `#1374` (law validity dates), `#1432` (embedding weights), `#943` (HELD), and `country_packs/**` tax rules (`#1438`, `#1439`, `#1445`). Check whether `#1463` is superseded by merged `#1470`.
- Mac disk: launchd job `ir.roxira.reaper` runs every 15 min (`#1404`; L1 extends it in `#1405`); SSD work disk has ~313 GiB free.
- Legal corpus: prod Qdrant has laws v6 (served, 6304), v7b (7229, not served), regulations_v3b (1322), rulings_v1 (1732), judiciary_circulars (250, retrieval PR `#1431`). Switching the served law collection needs the owner's sentence.

## Production (verified facts, 2026-11-25)
- **Autodeploy is unblocked & Smart Judge chat fixed.** `#1424`/`#1465` deployed cleanly at `52ccc21d`; `#1469` fixed the Smart Judge `UnboundLocalError` (`c1fa97d6`, 0 errors since); `#1470` (`f010aea02`) landed the `#1385` safety fixes. M1 pause is lifted (max 5 PRs/batch, wait for main CI green between batches).
- **Main CI watch:** `#1467` moved the flaky reviewdog test to `integration`, but `Pytest (unit)` still has `_ExtendedAttributes` (opentelemetry) failures on `jit-light` runners (L1 GATE-EXEMPT fix) and `ci.yml` run `45517726735` had `Trivy` report-only failure & `Secret scan` cancelled.
- **Post-deploy eval & smoke gaps:** `scripts/eval/legal_gate.py:732` unescaped `%` crashes on Python 3.14 (L4 GATE-EXEMPT); deploy smoke needs a real chat-answer probe + Telegram alert (L1 GATE-EXEMPT, `OWNER-OK`).
- After deploy, `postgres_prod` and `pgbouncer_prod` still need an owner compose recreate so `#1200` sizing applies.
- Host: aarch64, 4 vCPU, **7.7 GB RAM**, Qdrant v1.19.0 (upgrade PR `#1427`), AI core image `python:3.11` (`#1309` held).
- Kavenegar key rotated (Mac env and prod `.env` match, SMS arrives). Owner is creating new SMS templates (`ghazi-verify2`, `roxira-verify2`) with `@domain #%token`.

## Waiting on the owner
- Private flip (repo is still `PUBLIC`): needs the exact `--owner-go` sentence from both owners AFTER: P2 (colleague hooks), P7 (`06_root_reliability.sh`), P11 (`CI_RUNNER_MODE=auto|box` + loaded JIT proof), P13/P15 (hosted minutes budget / no payment method), P14 (`deploy-prod.yml` `environment: production` / `#1020`), P16 (20-PR gate tally on `#592`), P17 (remaining OpenRouter/SMS.ir findings from 31-item history scan).
- `OWNER-OK #<PR> <sha>` sentences per protected PR (`Owner packet @ 2026-11-25`, 17 PRs incl. `#1427`, `#831`, `#663`, `#963`, `#1198`, `#1229`, `#1242`, `#1262`, `#1297`, `#1349`, `#1379`, `#1386`, `#1410`; L12 owner packets PR `#1458`).
- Postgres/PgBouncer container recreate command on prod; SMS template `.env` update; legal corpus switch to `v7b`.

## Known issues
- `Pytest (unit)` `_ExtendedAttributes` on `jit-light`; `scripts/eval/legal_gate.py:732` unescaped `%` on Python 3.14; `data_import` period-lock bypass (`sepidar-persistence.service.ts:966`); ruff reviewdog PR comment noise (L1 GATE-EXEMPT).
- `#1295` `hub_merge.py` fail-open gaps (draft); 164 OSV findings (`#1031`); CSP report-only; 21 tables without FORCE RLS (`#1417` / PR `#1425`); Ruff violations (non-blocking).

## Next step for the new hub chat
1. Read newest `## WAVE 37` and `HUB -> LANES` (25c/25d) on #592 and #965. 2. Land `#1468` (`PROMPTS_FA_v4.md`) and L1/L4/L5 GATE-EXEMPT fixes (ruff reporter, `DQ` preflight, `data_import` period-lock, `legal_gate.py`). 3. Let M1 queue green `no blocker` PRs in batches of 5 (checking all comments newer than head). 4. Review B1 core PRs (`#1374`, `#1432`, `country_packs/**`; check `#1463` vs `#1470`). 5. Coordinate owner actions (Postgres recreate, `OWNER-OK` packets, private flip prerequisites). Do not name a country; replies to the owner in Persian.

## Key documents
`docs/hub/SYSTEM_OVERVIEW.md`, `docs/hub/MAIN_HUB_MASTER_BRIEF.md`, `docs/antigravity/LANE_RULES.md`, `docs/antigravity/PROMPTS_FA.md`, `docs/ops/PRIVATE_FLIP_CHECKLIST.md`, `docs/strategy/research/R36_DIGEST.md` (issue #1387), `docs/agents/LESSONS.md`.
