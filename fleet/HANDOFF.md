# Coordinator handoff (read first after any compaction or new session)

Repo: Mahan-film/roxira-platform. Laptop WSL. Owner replies in Persian. Owner gave full authority for this push.
Owner's rules that stand: never print or commit a key; no customer data to free models; lowest cost; no new server.
My own limits regardless of authority: no account creation on production, no permanent deletes of user files.

## End conditions
1. All laptop items in #230 ticked, by its own standard (`_fleet/AUDIT_230.md`).
2. All steps of `e2e/tests/m1-shop-month.spec.ts` green in CI.
3. `prod-feature-tour` 16/16 on roxira.ir: the OWNER runs it (it signs up a tenant); rehearse it locally first.
Then write «DONE» on #227 with evidence.

## How we work
- Coordinator (me): architecture, decisions, read diffs of money and permission code, merge. Keep turns few; do not answer interim notices.
- Build: `_fleet/oc.sh <worktree> <brief>`: default order DeepSeek Flash, then gateway, then direct. `OC_FIRST=-` for the plain ladder.
- Agents: Haiku 5.5 for mechanical work, Sonnet only for hard tracks. About 3 to 5 at once. Retire above 150k tokens. Brief: `_fleet/AGENT_BRIEF.md` + `RULES.md`.
- Merge (owner approved): CI green + diff read or review for UI + `_fleet/review.sh N --post`. Then `_fleet/merge-loop.sh N...` (`merge-batch.sh` underneath; `res-rows.py` resolves status-doc rows). UI-only: `_fleet/ship-ui.sh N "title"`.
- Free-model reviews are noisy: verify each Blocker in code. Real ones have been found (float scaling in #473), so do not dismiss them unread.
- Local CI is skipped by `_fleet/SKIP_LOCAL_CI`; history guard and key scan stay. Original hook: `_fleet/pre-push.orig`.
- Gateway tunnel: systemd user unit `roxira-llm-tunnel`, 127.0.0.1:4181; key `~/Secrets/roxira/llm-gateway.env`. Cap 2 USD/day; OpenRouter agents key 5 USD/day.
- Hotspot lock: `~/Developer/roxira-wt/.hotspot-lock` for `package.json`, `app-shell.tsx`. Migrations use timestamp bands: T1 17896, T2 17897, T3 17898.
- Browser: native Chrome, Playwright `channel: "chrome"`, use `localhost`, real `npm ci` in `frontend/`.
- Never `source` srv1's `.env`: line 37 is malformed.

## Agents running at last update (SendMessage resumes; work is saved)
- M1 09-17: a5f25e03b5115641f, PR #524.
- T1 sales: a5069bcb0e286e98c, slice 3 PR #537; slices 4-6 left.
- T2 purchase: a11e284130c26ba90, PR #515 must post through the engine; slices 2-6 left.
- T3 stack landing: a0342d85f97aaad9e, #522 #530 #534 #539 #544 (T3 builder retired).
- Daytona offload: a8762cf3a9bfdc966 (`_fleet/remote.sh`).
- Design landing and print forms: new Haiku agents; see QUEUE.md.
Retired design agents' work is in draft PRs #300 (#531), #303 (#526), #297 (#535), #305 (#518), #302 (#519).

## Next, in order
M1 09-17 > #230 laptop ledger (recurring vouchers, accruals, closing and carry-forward, budget, report builder, combined report, copy, attachments, edit lock, fixed-asset disposal and page) > T1, T2 finish > #475 RLS in batches with non-superuser pg specs > #500 quantity scale > print forms > Design v2 (dashboard #294, theme, invoice form + #477, lists, mobile) > #440 salesperson, #301 due date > Codestral free lane in the gateway > tour rehearsal.
Hotspot queue: nav entry for /app/contracting, test lines for contracting-ui and later libs.

## Owner decisions pending
- Pro to Max upgrade (recommended; weekly 61% used on 11-06, resets 11-12).
- More Mistral keys welcome, placed in srv1 `.env`; add names to `config/key_pool.yaml` by PR, then `install.sh --apply`.
- Colleague's account frees up Tuesday 11-10: hand work over by GitHub issue.
- Mac address never arrived; no SSH on the laptop's network. Optional.
- Fix srv1 `.env` line 37.

## Reports
Twice daily on #227 with the line: `OpenCode PRs / Claude PRs / est. cost`. Last posted 11-05 18:45 Tehran; next one is overdue.

## Cost and continuity (11-06)
- `~/.claude/settings.json`: autoCompactWindow 200000, autoContinueAtUsageLimit true, prompt suggestions off, default subagent model haiku, SessionStart hook pointing here. Applies from the next session start.
- `fleet-state.sh` runs every 15 min by systemd user timer `roxira-fleet-state`: publishes scripts, notes and briefs (never logs or keys) to branch `fleet-state`. Another computer takes over with `MAC_TAKEOVER.md`.
- Mac: no port 22 open on the LAN at 11-06 16:30. Needs Remote Login plus `~/.ssh/roxira_mac.pub`; then add a `mac.sh` runner like `remote.sh`.
- Windows sleep is 15 min on AC, 10 on battery: owner to change. Coordinator must not change system settings.
