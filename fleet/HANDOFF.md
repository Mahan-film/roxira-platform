# Coordinator handoff (read first after any compaction or new session)

## Current state 11-07 05:50 Tehran: read this first
Done: M1 on main and gate passed (end condition 2). Merged this round: #515 #524 #530 #531 #534 #537 #539 #541 #544 #545 #550 #552 #554 #557 #559.
Running, not reviewed: OpenCode builds, logs `_fleet/oc-561-asset-disposal.log` and `oc-563-t1-invoice-from-delivery.log`; PRs #562 and #564. On finish: read the whole diff, fix, `git add` in the worktree, `push.sh`, `gh pr ready`, CI, `review.sh N --post`, `merge-loop.sh N`.
Note: OPENROUTER_API_KEY_AGENTS returned 403 for DeepSeek on 11-07; both builds fell to gateway rungs. Investigate (cap or location), names only.
Next, in order:
1. T1 slices 5-6, T2 slices 3-6: read `gh issue view 227`; use `_fleet/oc.sh`, DeepSeek first.
2. Hotspot nav via `.hotspot-lock` in `frontend/src/lib/nav-menu.ts`: /app/accounting/recurring-vouchers, /app/contracting. Test lines: sales-invoice, contracting-ui.
3. #555 final voucher number: confirm legal text in docs/legal_sources first.
4. #230 per `_fleet/AUDIT_230.md`: combined report, report builder, trial balance by cost centre UI, property tests; tick items that fully meet the standard.
5. #475 RLS batches with non-superuser pg specs; #500 quantity scale; print forms #256 #258-#262; design #526 #535 #518 #519; #440; #301; #560 list; #248; #296; #548.
6. Tour rehearsal locally; then the owner runs it on roxira.ir; then write DONE on #227.
Wait for owner Deep Research: budgets, approvals, access model. Keep rules behind tenant settings with safe defaults. The owner gets research prompts as text in chat and sends results; check results against code.
Owner may still run on the Mac: `claude auth login`, Remote Login, public key; none confirmed. Never raise hosting or internet topics.
Style: reply in Persian, short. Do not reply to interim agent notices. Keep agents Haiku unless hard; retire above 150k tokens. Keep report on #227 twice daily.

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
- Merge (owner approved): CI green + diff read or review for UI + `_fleet/review.sh N --post`. Use `_fleet/review-merge.sh N` (stops on a blocker). Then `_fleet/merge-loop.sh N...` (`merge-batch.sh` underneath; `res-rows.py` resolves status-doc rows). UI-only: `_fleet/ship-ui.sh N "title"`.
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

## Research result 11-06 18:55 (official docs: remote-control, cross-session-messaging, costs)
- Same account means the same Pro quota: the Mac adds hardware, not tokens. Plan upgrade is still the only way to more Claude.
- Mac routes: (a) SSH + OpenCode with API keys: zero Claude tokens, preferred for builds and tests. (b) `claude remote-control` on the Mac: appears in ListAgents, reachable by SendMessage (plain text) from a Remote Control session. Peer rows seen now: both offline.
- Quota order: fresh session over long one (/clear costs nothing, compaction reads everything); subagents draw on the same quota; delegate noisy output; keep Haiku for mechanical work.
- T1 agent a5069bcb0e286e98c retired at 95% 5-hour use, above the 150k rule. Restart slice 3 (#537) with a fresh Haiku agent after the 20:20 Tehran reset. Worktree 536-t1-delivery holds attempt 2.
- After reset: read diffs of #550 #552 #554 (not reviewed, built by DeepSeek); #515 in merge loop; #524 M1 CI running on a new head; re-slot #526 #535 #518 #519.

## Audit 11-07
Decisions and measurements: https://github.com/Mahan-film/roxira-platform/issues/560. Twenty CRM is NOT on production. Next: resolve #550 conflict, T1 and T2 with fresh Haiku agents, then closing and carry-forward, budget, report builder, fixed-asset disposal, #555.

## Delegation 11-07 11:15 Tehran
Coordinator session is over 500k tokens, and no tool here can open a new chat. Work moved to fresh track agents (each retires at 150k with a note in QUEUE.md). Merged since last note: #562 #564 #568. Track A sales/purchase/ledger, Track B UI. Use review-merge.sh; verify any blocker in code.

## Research 11-07 (fleet research/ folder; do not re-read whole files, grep the section you need)
Plan issue #584, cost verdicts in #560. Builds are paid DeepSeek only (OC_ALLOW_FREE=1 restores free). No law found for gapless numbering in docs/legal_sources/iran/aeinnameh-mavad-95-owner-copy.md: never cite Article 95 for it.
