# Current state (read this first)

> **Last update: 2026-11-23 evening (main hub, Claude Opus 5.5 on the Mac).**
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
- `CI_RUNNER_MODE=auto` is agreed; never set `CI_RUNS_ON`. Never edit box timers, gate config or runners: ask with `ASK-BOX:` on #965.
- Owner approver account (numeric id 243877284) invited read-level; the box registers it in `owner_approver_ids`.

## Fleet (Antigravity, all on the Mac until the laptop's Antigravity works)
- One stable prompt per lane in `docs/antigravity/PROMPTS_FA.md` (also `prompts/L<n>.txt`): no wave or issue numbers; the queue is the newest `## WAVE` on #592.
  The owner re-pastes the same block every round. Mac cap 8 chats. Running: L1-L8 (L7 is box-only). L9-L12 start when L1-L8 ease off.
- Slash policy: `/swarm` only L8/L11 (max 3 workers, own working copies), `/boost` L3/L5 for one hard bug, `/teamwork` and `/schedule` never.
- Worktrees and caches go to the external SSD: `/Volumes/ssd/roxira-work` (APFS, case-sensitive, encrypted) via `source scripts/dev/lane_env.sh`; `claim.sh` uses it.
  The other SSD partition is exFAT: not for git. Mac system disk had about 14 GiB free on 2026-11-23.
- Owner guide: `docs/owner/ANTIGRAVITY_GUIDE_FA.md`.

## WAVE 32 (2026-11-23): finish every open PR
- 50 PRs were triaged read-only. Fix queue (25) belongs to L8, with each lane taking its own. Claims are on #592 (`taking PR #N (Lx)`).
- Hub agents fixed #850 (new `country_packs/try-resolve-pack.ts`, so it is now B1 core: the hub reviews it), #1313, #1314, and posted evidence on #1312 (false alarms); #1310 was already fixed.
- Merged 2026-11-23 after the owner's yes: #1227 #1271 #1301 #1303 (OWNER-OK), #1275 (box lane policy), #1342 (SSD + stable prompts), #1355, #1363 (RV prompts, if the queue finished).
  #1201 (OWNER-OK) is still open: check why it left the queue before re-queuing. The queue stall of 07:12 UTC ended after the box set `CI_RUNNER_MODE=main` (09:17 UTC).
- **Review helpers:** finished builder chats run RV1-RV4 (`docs/antigravity/PROMPTS_FA.md`, end of file). Each takes open PRs with number mod 4, fixes real desk findings on the PR branch,
  and posts `Lane check (RVn) @ <sha>: READY FOR HUB | NEEDS OWNER | BLOCKED`. They never write a verdict line. The hub merges READY ones after a clean desk verdict at the same head.
- L9-L12 and RV1-RV4 were running at the end of the 2026-11-23 session.
- Held: #1309 (Python 3.11 -> 3.13 on the AI-core image is untested at runtime; the PR lists four fixes for L1), #943 (L5 checks the WHT journal sign), #1311 (hub blocker: Number() on money, phone in logs).
- Waiting for the owner, after the five above: #831 (auth function), #663 (nginx cache); planned restart window: #1072, #1198, #1200; #1302 (relaxes OSV).
- Closed: #889 and #1237 (replaced by #1239).

## New rows 2026-11-23
- #1343 L1 reviewdog + semgrep rules (money as Number, PII in logs). #1344 L1 pr-agent (MIT) on our own keys as a second reviewer. CodeRabbit (free on public repos) is the owner's choice.
- #1348 L4 (B1 core, hub review): apply law valid_from/valid_to on every Smart Judge retrieval path; document that law collections are public (no tenant filter).

## Production
- `ssh roxira-prod`, `/opt/roxira_platform`. Healthy on 2026-11-23 (app, backend, frontend, nginx, postgres; both sites 200). Postgres 17, AI core on Python 3.11, Node 26, aarch64.
- `data_import_batches` had 1 row and 0 duplicates (so #1227's migration changes no data). `data_import_cutovers` is still an empty leftover table (a drop needs the owner).

## Waiting on the owner
- Accept the approver account invitation from that account. Say "go private" or not for 2026-11-25.
- German e-invoice deadline: was 2026 turnover above 800k EUR? Who keeps the backup encryption key offline?
- Sentences for #831 #663 (then #1072 #1198 #1200 in a window), CodeRabbit yes/no, delete the exFAT copies of an env file and a key (owner only).
- Research still to send in Gemini: R34, R35, R27, R33, R22 Stage 2 (prompts in `docs/research/prompts/`).

## Known issues
- Review desk: 8 PRs per run, free models give false blockers; dispatch once (`gh workflow run review-desk.yml`) and never while one runs.
- #1295 hub_merge.py still has fail-open gaps (draft); #1294 #1296 guard PRs are drafts.
- 164 OSV findings (#1031), CSP report-only, 21 tables without FORCE RLS until T200, #1092 gateway timeouts (probe once only).

## Key documents
`docs/hub/SYSTEM_OVERVIEW.md`, `docs/hub/MAIN_HUB_MASTER_BRIEF.md`, `docs/antigravity/LANE_RULES.md`, `docs/antigravity/PROMPTS_FA.md`, `docs/owner/ANTIGRAVITY_GUIDE_FA.md`,
`docs/ops/BOX_LANE_POLICY.md`, `docs/ops/PRIVATE_FLIP_CHECKLIST.md`, `docs/strategy/research/DEEP_RESEARCH_2026-11-23_PLAN.md`, `docs/agents/LESSONS.md`.
