# Laptop queue (orchestrator-maintained). Source: #116 body + strategist comments, 2026-11-04.
# Update 11-07 Track B (Haiku) print forms STATE: #575 MERGED. 259 cheque receipt: PR 578 MERGED (54ed9e8a after rebase; fix 8a2b55ee-era amount-words change). Hotspot lock RELEASED by track-b-haiku. Next: 260 (draft 579, reviewed OK), 261 (draft 580, reviewed OK, test asserts added, uncommitted in worktree), 262 (draft 581, reviewed OK): each needs package.json test line on current main, push.sh, ship-ui (note ship-ui refuses package.json, so merge by hand as for 578 if review clean). Payslip: payroll page NOT restricted to hr/owner (hr:read allows read_only and admin; permission-matrix hotspot, not edited). 256 not rerun. 577 (empty, from 258) still open: close it.
# Update 11-07 (Track A, Sonnet, stopped at context budget): MERGED #583 (T2 gate), #586 (#584 item 1: policy registry A/B/C at modules/tenants/policy, page /app/settings/policies, 5 rules + 3 fixed A rows), #588 (#555: DB trigger assigns permanent_number per tenant+fiscal year, entry_number optional, shown in table and print; migrations 1789900000400 and 500). Not done: #555 legal-book export columns and idempotency key; group B dual approval; REQUIREMENTS_STATUS rows for #586/#588 not written. Notes: push.sh does git add -u only, run git add -A first for new files; pg spec recurring-vouchers needs TZ=UTC locally; frontend tests run with npx tsx --test; OC_SLOT must be a number. NEXT: #584 item 3 (roles with scope/amount limits), then #230 items (combined report, report builder, cost-centre trial balance UI, fast-check ledger properties); none ticked yet.
# Update 11-07 Track B (Haiku) print forms: claimed 256 258 259 260 261 262 (draft PRs 576-581, worktrees under roxira-wt). Briefs in _fleet/briefs/25x-print-*.md, OpenCode run sequentially, status in logs/print-oc-status.log. Hotspot lock still held until #575 MERGED (watcher, do not touch). #545 #574 read.
# Update 11-07 Track B (Haiku) STOPPED at context budget: PR #575 [hotspot] package.json test lines (sales-invoice, contracting-ui) is ready, cross-family review no blocker, CI all green except M1 gate (Playwright) still pending; merge-loop 575 running; hotspot lock held by B until #575 MERGED (watcher releases it, log _fleet/b-lock-release.log; if it says released, the lock is free). Browser check (Chrome headless via playwright-core, mocked /api, synthetic session, scripts in scratchpad bcheck): /app/accounting/recurring-vouchers, /app/contracting, /app/accounting/fixed-assets render at 1280 and 375 with no horizontal overflow and no console errors (contracting needed list-wrapper mock); desktop sidebar clicks reach all three; 375 sidebar links not reached (mobile menu toggle not found, unchecked). Invoice print button NOT checked (needs invoice mock). Not started: step 3 print forms #256 #258-#262, step 4 design #526 #535 #518 #519. Needs backend: real login and data checks.
# Update 11-07 Track B (Haiku): MERGED #573 (nav entries) and #574 (print button to printSalesInvoice). Hotspot lock released. NEEDS HOTSPOT: package.json test lines for print/sales-invoice.test.ts and contracting-ui.test.ts. Not started: step 3 print forms 256,258-262; step 4 design 526,535,518,519. Browser checks at 1280/375 not run.
# Update 11-07 05:30: merged #537 #541 #550 #552 #554 #557 #559. Building through OpenCode only: asset disposal, T1 slice 4. Unreviewed; coordinator reads diffs. Budget and approval design wait for owner research. Nav entries pending: recurring vouchers, contracting.
# Update 11-07: owner wants rules configurable by management; Deep Research prompt sent. Treat #541 reviewer rule, tolerances and approval steps as defaults until that result arrives.
# Update 11-07 04:45: M1 green on main (end condition 2). Coordinator read diffs of #550 #552 #554 #557; merge loop running in that order. #230 items left after these: accruals done in 552; next closing/carry-forward, budget, report builder, combined report, fixed-asset disposal. #555 numbering after 550 lands.
# Update 11-07: M1 #524 merged; verify gate on main before claiming end condition 2. Research check issues #555 (numbering, do after voucher PRs), #556 (build started, PR 557). Landing copy #559.
# Update 11-06 16:25: #230 voucher slices started through OpenCode only (no Claude agent, 5-hour 82%): #549/PR 550 copy+lock, #551/PR 552 recurring+accrual, #553/PR 554 attachments. Logs _fleet/oc-<worktree>.log. Coordinator reads each diff after 20:20 Tehran reset. Migrations band 17899.
# Plan 11-06 15:40 (owner asked for lowest cost). Claude plan is Pro: weekly 61% used, resets 11-12 06:00 UTC. Biggest burn: coordinator context near 1M tokens re-read every turn, and long-lived subagents. Rules: at most 3 agents; retire any agent above 150k tokens and start fresh from QUEUE; design agents stay paused until M1 and ledger are done; no replies to interim notices; builds on DeepSeek Flash via oc.sh; add Mistral Codestral free lane. Priority: M1 09-17 > #230 laptop ledger items > T1, T2, T3 finish > RLS #475 > print forms > Design v2. Colleague's account available Tuesday via GitHub. Note: srv1 /opt/roxira_platform/.env line 37 has an unquoted value with a space: do not source it; owner to fix.
# Update 11-06 11:00: speed mode: _fleet/SKIP_LOCAL_CI flag makes the pre-push hook skip local build (docs/ops/ZERO_COST_CI.md option); guard and key scan stay; original at _fleet/pre-push.orig. Delete the flag file to restore. Required GitHub CI still gates merges.
# RESUME 11-06 04:20 (5-hour limit): merged through #481 (M1 01-08 on main), ledger bug #503 live. Resume agents with SendMessage (work saved): T1 a5069bcb0e286e98c (#509 deepseek), T2 a11e284130c26ba90 (#510), T3 a3a1bc8454b8af5a4, M1 09-17 a5f25e03b5115641f, #504 resolver ad79f67611c467dd4, routes a94fd9a9df99bdafa, design accounting a3610df03d35264e3 (#512), design treasury ae5a13e261ec02f0e (#516), design tax a0c21ed3ed491b6c9 (#513). Priority if tokens short: #504, M1, routes, then T1-T3, then design. Keep 4-5 agents; resume in batches. Hotspot lock with routes agent.
# Update 11-06 00:15: merged today also #123 #124 #157 #147 #161 #163 #166 #283 #344-#347 #445 #457-#459 #469 #471 #473 #476 #480 #484 #486-#489 #491-#494 #498 #501 #503. Ledger closing-balance bug fixed and live. In flight: #481 M1 07-08 (cash mapped to 1102), hotspot PR for test lines + routes #244 #245 #246 #247. Next: Design v2 2,4,5,6,7,8; M1 09-17; T1 T2 T3; recurring vouchers; #475 RLS; #500 quantity scale. Prod tour: owner runs, rehearse locally first. Claude has a 5-hour limit: keep parallel agents to about 3.
# Update 20:30: owner gave full authority and asked for parallel agents. Decided: accountant gets read on parties (do with next snapshot hotspot). Hotspot queue, one at a time via .hotspot-lock: menu #295 (holder) -> accountant read + report routes (#244 #245 #246 #247 #250 after #461) -> RLS #475 batches -> #440 salesperson -> #301 due_date (#349). Limits that stay: no account creation on production, no permanent deletes.
# RESUME (usage limit hit, 2026-11-05): merged #465 #474 #467 #429 #164 #431 #456; keypool rebuilt. Laptop merges this week per owner: CI green + coordinator diff + review.sh, via merge-batch.sh <prs>. Next: merge-batch.sh 458 445 457 347 344 345 469 471 (conflicts auto-rebased; rerun after CI). #468 agent holds .hotspot-lock (draft PR, review, then release lock). Then #472 invoice import, step 06 title 238, #475 RLS, T1-T3, Design v2, core ledger. #227 report overdue (needs cost line). Mac: waiting for owner's Remote Login commands; key ~/.ssh/roxira_mac.
# Update 14:40: gateway LIVE (llm-gateway.env from srv1, oc.sh uses pool/* first). #465 merged, keypool rebuilt (6 Mistral keys). Owner authorised laptop merges this week: CI green + coordinator diff read + _fleet/review.sh, `gh pr merge N --squash --match-head-commit SHA` enqueues. No new server. Next: finish reviews, #164 merge releases hotspot, then #468 #470 #472.
# Update 14:30: laptop now has tsx pnpm pytest(pipx) build-essential psql sqlite3 age autossh google-chrome (native; Playwright channel:'chrome'). Deep Research reviewed: no config adopted from it; keep 4181 tunnel, OpenRouter Flash, current key_pool. Open: Contabo factory server (owner purchase), test Groq cached-prompt TPM claim once gateway works. M1 gaps: #468 party master, #470 item cost, #472 invoice import; all need migrations after #164.
# Update 13:50 (HANDOFF_2026-11-05: laptop carries the project ~11-12; Mac session paused; merges still only by mac review desk, laptop never merges). Plan: (1) #464 Mistral keys 5,6 then rebuild keypool (owner approved) and test via tunnel (needs llm-gateway.env). (2) AUDIT_230.md decides #230 ticks. (3) #164 hotspot blocker being fixed (holds lock); then batch [hotspot] PR: package.json test lines, app-shell label, #283, #440. (4) open PR review findings: #429 major needs package.json line. (5) queue: T5 M1 steps, T1, T2, T3, Design v2 1-8, core ledger.
# Update 13:40: browser unblocked: `_fleet/win-chrome.sh start|stop` runs headless Windows Chrome on CDP 127.0.0.1:9333; use chromium.connectOverCDP from any worktree's @playwright/test. Ready: #347, #456, #457 (plus #431 #429 #345 #344 #445). #461 filed (fractional stock, before report routes). #459 (#306) stays draft: unit column and screenshots unmet, needs app-shell + package.json hotspot lines. #380 in OpenCode.
# Update 12:30: srv1 gateway tunnel live (systemd user unit roxira-llm-tunnel, 4181->4000, linger on). oc.sh has pool/* rungs first; they skip until ~/Secrets/roxira/llm-gateway.env exists (laptop-gateway.env NOT yet on this laptop; watcher running). #445 ready. #348, #432 merged. Subagents (see AGENT_BRIEF.md; drafts only, coordinator reviews and readies): #383, #380, #246, #347 Sonnet; Haiku triage to TRIAGE.md.
# Status 2026-11-04 20:35: WSL restarted (4.8 GB + 16 GB swap, heavy.sh 2 slots). All 5 agents resumed per "Assignments on resume". Crons recreated: watchdog 7,37; #227 report 08:43/20:43 plus a pointer on #116. 10 laptop PRs are ready, waiting for the Mac. The reorder.test.ts package.json line waits for #121 to merge (A1).
# Update 09:55: ready: #348 #345 #344 #431(#243 core) #429(#257). #432(#245) pushed, waits for CI; written by Claude after two OpenCode failures. #445(#250) building. Bug on main filed as #443. Playwright browser download gets 403 on this IP, so browser checks (#257 print, #346 screenshots) are blocked. Next: #244 purchases after #431 merges (reuse countedDocs), #246 after #432, #258 and other print forms after #429.
# Update 09:05: strategist decisions: #439 (#348 leftovers), #440 (salesperson_id, hotspot migration, then back into #243), foreign invoices count in reports at the invoice's own rate with a currency column, exact maths through money.ts. #345 ready. Waiting for laptop-gateway.env on the Windows Desktop: move to ~/Secrets/roxira, chmod 600, tunnel per docs/ops/TWO_COMPUTERS.md and #227, gateway first in oc.sh, direct path last. #440 waits for the hotspot lock (held for #164).
# Update 09:00: oc.sh ladder live with Cloudflare (kimi-k2.7-code, glm-5.3-flash); gpt-oss on CF cuts off. #348 marked ready (OpenCode fix). In flight: #344 (2nd), #245 (spec), #243 (2nd), #257 (2nd). A second failure on #243 or #257 means Claude writes it. Pending package.json test lines (hotspot): reorder.test.ts, invoice-list.test.ts, import-routing.test.ts, print tests. Follow-ups: #277 resume after reload; #243 salesperson needs a field on the invoice.
# Update 06:50: 11 OpenCode free models tested one by one: 9 FreeUsageLimit (Retry-After 74380s, about 03:30 Tehran on 11-06), 2 RegionError. No usable API key found in WSL, Windows env or the user's documents. Keys go in ~/Secrets/roxira/roxira.env; test each before use.
# Status 2026-11-05 02:05 (operating model per #227, 2026-11-05: OpenCode builds, Claude reviews): opencode 1.19.5 installed at ~/.local/bin. BLOCKED: every free OpenCode model returns FreeUsageLimitError and no DeepSeek key exists on this laptop. wait-model.sh polls every 20 min. When a model works, run: oc.sh <worktree> briefs/<brief>.md, review the diff, commit, push. Briefs ready: #344, #345, #348. Do not mark #283 ready until #164 merges. #346/#348 need hotspot package.json test lines. #350 and #345 hold uncommitted WIP in their worktrees.
# Priority (owner + strategist, #227): 1) open PRs  2) claude-win issues from the Mac (posting_rules, treasury, print templates, import presets, design audit)  3) tracks T1, T2, T3, T5 (T4 paused)  4) #230 core ledger. Keep all 5 agents busy. One hotspot holder at a time.

## Assignments on resume (strategist order: open PRs > claude-win > tracks > core ledger)
- A1: finish #283 (#277 pt1 + package.json line) → #267 chart (posting) → #295 menu tree (app-shell, hotspot) → T1
- A2 (fresh agent, the old A2's context was full): #280 ready at 2b4409f1; #346 (#301) draft, needs Playwright screenshots (desktop + 375px) and then ready → #302 customer drawer → T2 2/n (service + fixture + spec saved in _fleet/handoff/a2-service/, stacked on #280; move the adapter onto posting-rules role settings #339)
- A3: #277 pt2 merged with #325: /app/import via uploadBulkFile (resumable), accept list from the server (#282), progress/cancel/resume, Playwright → then T3 (params from #229)
- A4: #237 ageing from real allocations (now unblocked) → #242 route (hotspot) → #249 legal books
- A5: #307 number formatter + realistic demo seed (owner feedback) → T5 gate steps
- Unassigned design issues for whoever is free: #294 dashboard, #296 split accounting, #297 petty cash/cash boxes, #298 bank page, #299 reports hub, #300 fiscal years, #303 cheques page, #304 tax page, #305 payroll, #306 inventory list

## Owner-reported bugs (#277), taken right after the current PRs
- [ ] #277 part 1 [hotspot, A1]: the app-shell sidebar overflows onto the white body. Add overflow-y-auto on the aside, the dark theme on html/body, and a Playwright check. Bundle it with the frontend package.json reorder.test.ts line as one tiny [hotspot] PR after #164.
- [A3 running] #277 part 2 (A3, while it waits for the T3 hotspot, data_import + frontend lane): build the accept list from the support-matrix (IMPORT_ACCEPT is hard-coded to xlsx/csv/pdf/img), use the existing chunked upload in the /app/import wizard with resume, send files over 40 MB to bulk, add Persian errors and a Playwright step. Then the read-only SQLite worker plus a hostile fixture. The nginx chunk-route limit is the Mac's.

## claude-win issues from the Mac, children of #230 (added 14:45; they come after the open PRs, before the track work, and agents take them between track PRs too)
- [A4 running] Party-statement cluster (ONE agent does all of it): #124 (#120) open PR + #242 party statement with running balance + #237 (blocked on Mac #234)
- [ ] #249 legal books: printable journal + general ledger PDF (core ledger, good fit for A4)
- [ ] #250 fixed-asset register + depreciation schedule report
- [ ] #243 sales report by item/customer/salesperson | #247 gross profit per invoice/item/customer (T1 agent)
- [ ] #244 purchases by item/supplier (T2 agent)
- [ ] #245 stock cardex | #246 stock balance as of a date + reorder alerts (with #121 reorder point)
- [ ] #248 POS day-end close + daily sales report (= E1.6 Z report)
- [ ] #266 import presets Sepidar/Rahkaran/Mahak/Holoo: BLOCKED on real template files from a licensed user (owner). Only parts (3) Arabic ي/ك normalisation and .xls input can be done now.
- [ ] Print templates, one small PR each: #255 invoice A4 (classic + Moadian) | #256 invoice A5 | #257 accounting voucher | #258 receipt/payment voucher | #259 cheque receipt | #260 warehouse receipt/issue | #262 POS 80 mm receipt (= E1.5) | #261 payslip (HR is outside our lane: wire the print template only, read through public services)
  Rule from the issues: items marked "unverified" in docs/accounting/research/PRINT_FORMS.md (e.g. the e-invoice QR) need an owner decision; leave them out and ask on #230.

## Open PRs (finish first)
- [done] #146 merged | #165 merged | #147 ready, green at 9b25de27, no blocker | #157 ready, green at 06065fa0, no blocker (A2)
- [done] #161 #126 ready, green at ae4adc64 (A3)
- [done] #164 #160 ready, green at cabf825e (A1). A1 keeps the hotspot: #277 part 1 + the package.json line, then #267, then T1. Each hotspot PR is marked ready only after the one before it merges.
- [done] #166 #148 ready, green at 89efd2dd (A4)
- [done] #163 #162 ready, green at fe9bc30a. now uses money.ts, green at 0bad9d7f
- [done] #121 #117 ready, green at 4dab1379 (A2). A2 is now on T2 + #244
- [done] #123 #119 ready, green at d537147c (A3). The API is done; the POS return screen is a follow-up
- [done] #124 #120 ready, green at ba556ce2 (A4). It includes the #242 XLSX/PDF and the #237 allocation seam. #242's route + on-screen view sit on the unpushed branch agent/claude-win-mahansudo/242-route-and-view-pending (c85d922c) and need the permission-matrix snapshot entry (hotspot)

## Tracks (#227) — start each one once its agent's open PR is ready. One track per agent, PRs of about 400 lines.
- T1 Sales cycle (A1, after #164): quote → order with reservation → partial deliveries (COGS) → invoice → return. Gate: Playwright quote→order→2 deliveries→1 invoice→partial return
- T2 Purchase + 3-way match + landed cost (A2). Gate: PO, 2 receipts, invoice with a price difference, late freight
- T3 Contracting / progress statements, retention, insurance deduction, advance recovery (A3). Statutory params are read-only; if one is missing, open an issue labelled `mac`. A3 posted the T3 design on #227 and asked the Mac for the statutory params in #278 (label mac): insurance withholding, retention, advance cap, Art. 104 withholding. Until they exist, T3 refuses with a Persian error.
- **#230 (owner, 2026-11-04): accounting comes first.** T4 is PAUSED. A4 moves to the core-ledger items instead: recurring vouchers + auto-reversing accruals, closing entries + carry-forward, 2/4/6/8-column trial balances, budget (+ budget vs actual), report builder. Laptop lane = modules/accounting, subledgers, fixed assets. Posting-rules engine and treasury belong to the Mac; laptop adapters come only through claude-win issues. No hardcoded account codes.
- (PAUSED by #230) T4 Field sales PWA /app/field: offline orders with idempotency, visit log, commission (A4). Gate: mobile offline→sync→exactly once
- T5 [A5 running: #279 ready, the mint session now includes tenant_memberships, gate 5/21; next are import steps 02-06] M1 gate owner + perf (100k vouchers, 50k items, <2 s) + read-only closed years (A5). When green, comment "M1 green" on #116
- After a track: T6 light manufacturing (single-level BOM). ASK on #116 before multi-level BOMs
- Between track PRs: take the next short item from the #116 lists below

## claude-win issues from the Mac — HIGHEST priority (posting_rules / treasury hookups first, per owner 2026-11-04)
- [ ] #267 chart template: kol→standard mapping, missing equity moeins 52/53/56/57 + memorandum 91/92, contra flag, and the cheque code collision (cheques post to 1110/1120/2110 = land / acc. depreciation / LT loans; move to 1021/2011). This is posting-related, so it goes FIRST. Probably [hotspot] (chart seed or migration). The cheques module is the Mac's: change only the chart template on our side, and agree the cheque code switch with the Mac on #230. Standard table unverified (see PR #241 CHART_AND_POSTING_STANDARD.md).
- [ ] #237 ageing + party statement use real treasury allocations instead of FIFO (modules/accounting/reports/ageing.ts + #120 statement). UNBLOCKED (#234 merged 2026-11-04). Overlaps open PR #124 (#120): one agent does both. Acceptance: a payment allocated to the newest invoice leaves the oldest invoice in its old bucket.
- #211 FYI only (keep FinancialReportsService dashboard/incomeStatement/balanceSheet/ageing stable) — no work

## Small follow-ups
- [ ] POS return screen in the frontend (the API is done in #123). M1 step 10 waits for steps 06 and 08.
- [ ] Strategist question on #227: may a contract record its own retention/advance % within the store's maximum?
- [ ] UI page for GET reports/trial-balance-by-cost-centre (API only in #164). Goes in A4's core-ledger list.
- [ ] [hotspot, for A1, bundled with #277 part 1] add reorder.test.ts to the `test` script in output_apps/enterprise_hub/frontend/package.json (from #121). Until then CI does not run it. Do it as a tiny [hotspot] PR after #164.
- [ ] The frontend app/invoicing/page.tsx still shows tenant.defaultVatRate / VAT_RATE=0.1 as a display default (the server decides the rate). Switch the display to the statutory store (from #161).
- [reported] Flaky test seen in pre-push: src/test_chat_idempotency.py::test_in_progress_request_is_awaited_not_recomputed (assert 2 == 1) under load. Reported to the Mac as #273 (label mac).
- [ ] From the #147 review: other accounting DTOs (fiscal-year, report, petty-cash, period-lock) still accept impossible dates. Reuse dto/calendar-date.validator.ts.

## Original #116 queue (after open PRs), remaining
- [ ] E1.4 split payment | E1.5 80mm receipt | E1.6 Z report
- [ ] E2.2 warehouse transfer | E2.3 stock count | E2.4 tree coding + dual units
- [ ] E3.1 depreciation run + disposal | E3.3 cash-flow page | E3.5 attachments+edit lock | E3.6 period-close checklist
- [ ] E4.1 credit limit | E4.3 reminder templates
- [ ] E5 Sepidar preset + import reconciliation report | E6 UI/help

## Extended queue (2026-11-04 comment), in order
1. [ ] [hotspot] fast-check ledger property tests
2. [ ] I-02 rest: serials, quarantine, tree coding + dual units
3. [ ] I-05 report builder
4. [ ] N-04 rest: attachments, edit lock, budgeting + budget vs actual
5. [ ] N-02 bilingual reports + FX rate file import
6. [ ] STD-02 FX translation view (ASK before deferred tax)
7. [ ] E-01 DBF fixed->floating level mapping + review screen + Iran System/Win-1256 fixtures
8. [ ] E-06 read-only closed years + 100k-voucher perf pg spec
9. [ ] N-01 consolidated TB/IS across owner's tenants (read-only sum, no eliminations)
10. [ ] E5 presets Hamkaran Rahkaran, Mahak

## Do not build (Mac): public_api/webhooks, calendar/country_packs, assistant memory/copilot, cheques/Sayad.

## #230 tick log (tick an item in #230's body only when every part of it has merged)
- 14:45: merged #146 (#125) and #165 (#128). Neither completes a #230 line, so no tick.
- #164 cost centres: open | #63 fixed assets merged, #129 (PR #157) open, so the fixed-assets line stays unticked until #157 merges

## Waiting on owner/strategist
- #274 proposal (hosting inside Iran, landing copy/trust, cloud sessions, fast pre-push). Do not change the site or hosting until it is decided.
- #273 flaky test (Mac)
- Hotspot waiting list (one holder at a time): A1 (#277 part 1 + package.json line, then #267) → A4 #242 route (cherry-pick c85d922c + snapshot entry, tiny) → A3 T3 proj_contracts migration → A2 #301 invoices.due_date (ALTER) + T2 migrations (purchase_requests/orders/goods_receipts) → A5 perf indexes. Pending frontend package.json test lines: reorder.test.ts (#121), invoice-list.test.ts (#346)
