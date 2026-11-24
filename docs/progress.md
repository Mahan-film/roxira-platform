# Progress log

Append-only. One entry per PR/session that finishes a `docs/plan.md` item or
otherwise changes something worth remembering. Newest entry at the bottom.
Do not edit past entries — add a new one instead.

## Template

```
## YYYY-MM-DD — <workstream/PR> — <one-line summary>
- What changed:
- Why:
- Follow-up (if any):
```

## Log

## 2026-09-25 — W12 — cheap hands, open memory (first slice)
- What changed: `opencode.json` rewritten to explicit allow/deny permissions
  only (no `ask`, since OpenCode runs non-interactively in CI);
  `agent_runner.py`'s `run_opencode()` now passes `--agent build` and its
  `DEFAULT_MODEL` reads the `executor` role from `config/models.yaml`
  instead of a hardcoded id; added `.github/workflows/model-registry-check.yml`
  (weekly OpenRouter drift check, opens/updates one `model-registry` issue,
  never auto-edits the registry); added this plan/progress/decisions memory
  set; added `feature-plan` and `review-diff` project skills; added a
  PostToolUse ruff-on-save hook.
- Why: docs/STRATEGY.md §3a/§4 — execution should be cheap and non-interactive,
  and spec/plan memory should be a few small files agents actually read
  instead of a long chat history.
- Follow-up: `model-registry-check.yml` has not had a live run yet (needs a
  scheduled trigger or a manual `workflow_dispatch` after merge). The
  `feature-plan`/`review-diff` skills are new and unexercised on a real task.

## 2026-09-28 — hub — security cleanup + local free-model pool, handoff
- What changed: removed the self-hosted runner and server-side LiteLLM from prod (runner service disabled, no sudo/docker); PR #60 moves agent/model workflows back to GitHub-hosted runners. Built the owner's local LiteLLM pool (Groq gpt-oss-120b → Codestral → Qwen3.8 → DeepSeek V4.1 via OpenRouter) and pointed global OpenCode at it. Merged/deployed during this hub session: #53 real Zibal payments, #54 design, #56 subscription modal fix (merged, not yet deployed), #55 prepared (v2 legal collection + vector search, 63.3% citation accuracy, awaiting owner).
- Why: agent/model code must never execute on the production host; implementation work should use free keys instead of the Claude plan quota.
- Follow-up: owner test payment; decide #55; remove runner in GitHub UI; W20 Gemini Live verification.

## 2026-09-30 — hub — payments/citation-guard fixes deployed, keys rotated, cost tooling, legal coverage audit
- What changed: deployed #100 (payment callback), #132 (citation guard restored verbatim after daemon commit 2b605a1), #131 (/factory removed from nginx); disabled roxira-worker timer; new prod OpenRouter key with a $3/day cap (old keys revoked); merged prices fix #109, eval script #110/#128/#136 (reasoning flag), deploy.sh nginx-inode fix #111, deps audit #112/#127, restore drill #116/#125, Frontend gate #115, cheap-tier reasoning off #135 (not yet deployed), legal coverage roadmap #137. Built `rx`/`rxall` Mac tools.
- Why: the site was returning 500 on legal questions, prod key was revoked, and the Claude weekly limit was exhausted, so all implementation moved to cheap lanes.
- Follow-up: change VPN (OpenRouter 403 for the Mac IP), deploy #135, rerun quality eval, review W25 PRs (#138-#140), fix order 4815502353, lawyer check of the commercial-code bill.

## 2026-09-30 — hub session (evening) — operating model, legal Phase 0/1 groundwork, Codex worker
- What changed: ADR 0003 (#148); exact article lookup (#149); `/coverage` page (#150); guard collection label (#151); chat declutter (#146); undefined-names CI job (#154); `source_tier` (#158); deterministic law fetcher (#160, #162); SYSTEM_MAP + generated inventory + CI drift check (#163, #166); lawyer answers and research docs (#165, #169); rx moved to `scripts/dev` with a Codex CLI worker, fallback chain and timeout (#152, #168); commerce act no longer flagged as a bill (#171); tech-radar weekly (#96).
- Why: the cheap lane failed repeatedly on large issues; the owner needed one inventory for new chats, official-source legal texts, and merges without manual clicks (`gh pr merge --auto --squash`).
- Follow-up: deploy is still pending (prod at 64478f3); OmniRoute onboarding by the owner; fetch the remaining official texts when rc.majlis.ir answers; first official ingest needs owner approval; PR #167 needs the owner's review.

## 2026-10-01 — hub session (all day) — prod fully deployed, OmniRoute, official laws, autonomy foundations, auto-deploy armed
- What changed: prod deployed twice (core + frontend; #178 state, #182 LightRAG pin, #205 identity fast path, #208 Whisper `language=fa` + removed «هست→هاست» rule); Qdrant `iran_laws_v2` 4243 → 5103 points (12 official laws, backed up by Qdrant snapshots); OmniRoute configured (combo `team-coding`, gateway comparison in `docs/research/OMNIROUTE_EVAL.md`: LiteLLM 7/7 at 1.6 s vs OmniRoute 7/7 at 3.9 s; #203, #211); 10 research reports in `docs/research/` (#185, #209, #213, #231); Factory libraries (#217 task contract, #218 delivery report, #219 run ledger, #224 preflight, #223 budget, #225 template check); zero-cost research (#227 tiers, #232-#234 SearXNG/ddgs/local rerank clients, #237 free-first order); local Whisper engine behind `ROXIRA_STT_LOCAL=1` (#212); `llm_router` model cap (#240); factory-research layers on `cheap` (#241); automatic deploy (#244, #245, #246: `ci-deploy.sh` forced command + `deploy-prod.yml`, armed with `DEPLOY_ENABLED=true`); runbook sections 7-8 (#184, #199); 7 Actions secrets and variables FACTORY_ENABLED / AGENT_REVIEW_MODEL set by the owner.
- Why: the owner wants a fully autonomous agentic delivery system (one central request → research → plan → parallel agent teams → tests → deploy → Persian report) at near-zero cost. Gap analysis (`docs/research/FULL_AUTONOMY_GAP_ANALYSIS_2026-10.md`) says the critical path is the delivery tail (preview, deploy, observation), not another agent framework.
- Follow-up: Factory run 4 on brief #236 starts automatically after #243 (Event-loop fix) merges (`~/rx-logs/chain-factory4.out`); then owner replies `/approve`. Preview environments on the same server (disk 31 GB free), SearXNG+Valkey+Crawl4AI install, local Whisper enablement after a real-voice test, wire `LocalReranker`, golden templates, replace the 3 overlapping laws with official versions, unification rulings. Pitfalls: Codex puts tests in the wrong folder and forgets imports (hub fixes), CI main goes red if the system inventory is not regenerated, never deploy `enterprise_app` during a long job inside `roxira_app_prod`, terminal Run buttons replay old commands.

## 2026-10-01 (evening) — hub continuation — Factory proposal quality, research stack, preview gate
- What changed: #250 `--layers`, #251 subject = title + goal and auto layer pick, #254/#255 preferred stack in subject, short heading, `normalize_alternatives` + recommended fallback; Factory run 6 on #236 gave a relevant Persian proposal ($0.01). #260 SearXNG+Valkey compose (installed on prod, valkey runs as non-root via #264), #262 LocalReranker first in `WebIntelligence` (env `ROXIRA_LOCAL_RERANK=1`), #261 pull-based systemd deployer (disabled), #263 preview limits planner.
- Why: the first live proposal researched all 9 layers from the issue title only; the owner needs a usable proposal before `/approve`.
- Follow-up: owner `/approve` on #236; wire `SEARXNG_BASE_URL` into the app container; preview host wiring; run ledger/delivery report wiring into factory workflows; Crawl4AI.

## 2026-10-03 — hub (Sonnet) — security hardening shipped, merge gate live, Factory first real run, capability assessment
- What changed: owner hardened ssh, closed ufw 2053, rotated JWT_SECRET, set VIP env, enabled Dependabot alerts, added 2 required checks, Cloudflare OTP rule, Pages source, rebooted. Merged #379 (legacy payment routes removed), #378 (JWT/VIP), #381, #382, #385-#388, #398, #419, #420, #422, #426, #430, #431 (planner serializes overlapping tasks), #441 (Factory plan) and #442 (first Factory build PR); earlier rx waves #267-#347 (ledger comments, /report, spec artifacts, capability grants, bake-off lib, preview.sh, golden templates, MCP allowlist, secret hygiene, workflow safety checker, merge gate lib + orchestrator + `rx-automerge.yml`, tournament, radar log).
- Why: owner asked for a fully agentic platform with a security upgrade, an agentic CRM evaluation, a Smart Judge check and a first real Factory run. Audits found real defects (payments, JWT, admin passcode, merge automation never firing, CI blind to markdown pushes, empty-env regression).
- Follow-up: merge #445/#446/#432 (workflow PRs, owner), watch Factory tasks #434-#440, FAQ citation check (#447), red PRs #380/#383/#384/#389/#345, security round 2, CRM phase 0, Smart Judge J1 plan in `docs/research/PLATFORM_CAPABILITY_ASSESSMENT_2026-10.md`.

## 2026-10-04 (late) — hub (Sonnet 5.5) — deploy tooling merged, law fetcher, research docs, handoff
- What changed: merged #502 (deploy_local.sh), #475 (minimal /health), #508 (merge-gate: skipped checks, test-tamper, reviewer-family check), #509 (migrate / migrate-rollback via one-off container), #511 (multi-source law fetcher + sources plan + tools adoption research), #512 (set_server_env generate mode no longer desyncs local and server). Server `.env` got GOOGLE_CLIENT_ID/SECRET and ADMIN_HEALTH_KEY. `check` and the `migrate` plan ran read-only on prod: one pending migration, all required env names present.
- Why: the owner wants everything deployed with minimal manual steps; deploy and prod DB changes stay owner-run by design.
- Follow-up: owner runs `migrate --yes` then `deploy --yes`; legal fetch + ingest; 50-question eval (the owner's Deep Research draft needs lawyer verification); model roles decision; wire task caps into rx. See `docs/STATE.md`.

## 2026-10-09 — hub (Sonnet 5.5) — deploy completed, prod verified read-only, handoff to Opus 5.5
- What changed: deployed 537d94c0 with `deploy_local.sh` after `migrate --yes` (CRM tenant isolation; backup kept); fixed three script bugs on the way (#514 DATABASE_PASSWORD pattern, #515 deploy accepts applied migrations, #512). Later sessions deployed #516-#518 by hand. Read-only audit on 2026-10-09 found: server git tree in conflict (`UU docker-compose.prod.yml`), disk 96%, docker.sock mounted into the backend, stale `prev_commit`.
- Why: owner wanted everything deployed and a clean handoff to an Opus 5.5 strategist chat.
- Follow-up: fix the compose conflict and free disk (owner approves), law fetch + ingest, 50-question eval with lawyer, model roles, secrets plan, full audit rerun. See `docs/STATE.md`.

## 2026-10-13..15 — hub — srv1 migration, full automation, tenancy, legal corpus growth
- What changed: production moved to srv1 (91.107.248.99); server-side autodeploy timer (#633) so merges ship themselves with backup/migrate/smoke/rollback; key pool with strong/light/product free tiers and paid DeepSeek fallback (#637, #641, #644, #655), 3 Groq + 4 Mistral keys; Smart Judge chat free-first behind `SMARTJUDGE_LLM_GATEWAY` (#650) with reasoning-leak filter; serving `iran_laws_v5` with industrial property law 1403 (#646); public `/guides` (21, #624, #636) and `/regulations` (#663); Roxira honest copy, no prices, stored pre-registration (#625, #635); tenant isolation for every enterprise module (#627, #629, #648, #656, #657); CRM AI import CSV/xlsx (#649, #654); Mac Iran relay for regulation.tax.gov.ir / dotic / rc.majlis with PR publishing, office-hours schedule (#658–#664) and first data batch (#661); research service with tavily (#634); two-person collaboration tools (#653); strategy status audit (#638), factory product plan (#642), Moadian requirements (#639); lawyer review pack (30 live answers, docx).
- Why: owner asked for maximum automation, free models first, a sellable Roxira and a growing, up-to-date legal corpus.
- Follow-up: docs/STATE.md "Next workstreams" (regulations v2 into chat, three missing laws via rc.majlis ids, lawyer verdicts into golden set, Moadian live, factory MVP).

## 2026-11-03 — hub (mahansudo, Opus 5.5) — deploys unblocked, two accounts, secret audit, cleanup
- What changed: moved stray `.env` backup off the srv1 tree (deploys had refused since 11-01); #975 (hardcoded Kavenegar key removed), #976 (`iam.sh`), #977/#979/#980 (Antigravity A17/A20/A21, reviewed), #978 (34 stale files archived, wrong instructions fixed, team workflow doc).
- Why: owner and collaborator share the repo and the Mac; agents kept reading stale "100% ready" files; the owner wants the repo public so `mahansudo` can join without a paid seat.
- Follow-up: public-repo migration (STATE.md 2026-11-03, needs a permission mode that allows repo rename/create and srv1 writes); confirm the deploy of `main` passed; six unfinished local branches (bulk-import-streaming, format-logical-menus, issue-958/959/960) need issues or PRs.

## 2026-11-12 — hub (Opus 5.5) — waves 9-12, review desk on Haiku/DeepSeek, Claude agents fixed blockers
- What changed: #230 reached 29/29 (#737). Merged #786 (artifact upload no longer fails CI), #710, #765, #772, #740, #767, #777, Dependabot and legal relay batches; #736 #741 #761 #773 #785 queued. Sonnet agents fixed review blockers on #728 #736 #740 #763 #773 #781 #785 and built T94 (#791) and T96 (#792). Review desk now: Haiku CI triage, DeepSeek for routine reviews, Sonnet only to confirm critical PRs. Waves 9-12 posted on #592; deep research on electronic books, Moadian sandbox, payment gateways and trusted tax companies folded into the specs.
- Why: review/fix was the bottleneck; Claude quota ran out mid-day, so Gemini lanes own all building and fixing again.
- Follow-up: docs/HANDOFF_2026-11-12.md "Open for the next hub"; make the M1 gate blocking; #663 nginx -t.


## 2026-11-17 — hub (Opus 5.5) — WAVE 19/19b: research rows as GitHub issues, two-machine split, Linux CI box plan
- What changed: merged #870–#874 #884 #885 #887 #888 #893 #857 #896 #897 (target infrastructure T211–T218, team split L1–L6); 44 research-row issues #898–#940 and #947 (T166–T227) with lane/prio labels and Done-when specs, older issues labelled per lane; WAVE 19b on #592; prompts v6b (#941); STATE.md rewritten under 100 lines; `docs/ops/LINUX_CI_BOX.md` for the owner's HP laptop as CI box.
- Why: owner wants Antigravity to carry far more work, a colleague's machine working in parallel, and the hub spending tokens only on strategy and review.
- Follow-up: review-desk verdicts on hub PRs #883 #886 #889 #891 #892 #894 #895; production steps in STATE.md; owner rotates three secrets and installs the CI box; R18 digest when it arrives.

## 2026-11-19 — hub (Sonnet 5.5) — two-machine hub split, CI box live, autodeploy hot-fix, STATE.md refresh
- What changed: merged #883 (off-site backups + restore drill), #891 (CI guards), #894 (tenant scope), #895 (oxlint/TS7), #962 (T211 Smart Judge speed), #968 (box-status, narrow sudoers). Open hub PRs are now #886 (needs coreutils in the WAL-G image) and #892 (conflicts with main), both handed to L1; #889 waits for merge.
- Two machines: Mac runs the main hub and L1–L4; the Linux box `roxira-ci` runs a box hub (Claude Code, gh `mahansudo`) for L5–L7 built by Gemini CLI in tmux, plus the phone stack. WAVE 20 on #592 orders blocker fixes first; prompts are v6c for L1–L7.
- CI box: runner `roxira-ci`, Xray proxy always on, egress lock so agent traffic uses the proxy only, no production keys on the box (`docs/ops/LINUX_CI_BOX.md`).
- Production autodeploy stuck ~19 h on 2026-11-18 because `roxira-radar-daily` dirtied the checkout; hot-fixed with systemd drop-ins that move `DECISIONS.md` to `/var/lib/roxira/radar/`. Permanent fix and a Telegram alert are #961 T232 (L1).
- Private repo stays plan A (Free); visibility flips after #947, #949 and #951. R18 raw report will land via a box-hub PR before the main hub digests it.
- Follow-up: merge #889 on "no blocker"; production steps in STATE.md (#883 install, #886 WAL-G, T212 v7b switch); remove stale worktrees singly.

## 2026-11-21 (evening) - hub (Sonnet 5.5) - Claude-free box lanes, R22-R33 research, marathon lane prompts
- What changed: research R22-R33 digested into docs/strategy/research (PRs #1053 #1062 #1086 #1100) with 55+ rows (T259-T332, WAVE 24-29); box path without consumer logins built by hub agents (#1082 orch, #1083 budgets, #1087 LiveKit keys, #1088 push alert, #1089 egress + redaction, #1084 CI image mirror; #1081 runner pack queued); lane prompts replaced by ~600-character prompts plus docs/antigravity/LANE_RULES.md, WIP 5, OSS-first (#1091); red CI fixed on #955 #728 #964 #963 #1072; box-lanes virtual key PR #1180; a no-shell tunnel account with one forwarding-only key was created on the production server; 24 clean worktrees removed on the Mac.
- Why: the box Claude Pro hit its 5-hour limit and R22 says consumer logins are unfit for unattended work; the owner wants a Claude-free, open-source, cheap box and multi-hour Antigravity rounds.
- Follow-up: fix gateway health (#1092) before enabling orch --apply; create the box-lanes key after #1180; merge #1081 #1097; resolve #889 (#1093); Redis licence (#1122); disk hygiene (#1177); private-repo flip only after #947 #949 #1024 and the merge gate; monthly radar (#1098).

## 2026-11-22 - hub (Sonnet 5.5) - box key, cutover revert, research second opinions, parallel agents
- What changed: created the `box-lanes` gateway key and merged #1180 #1097 #1081 #1182 (key delivery is the owner's clipboard relay); #1195 fixed main CI; #1215 reverted the cutover wizard (#1202) that could lock a period with an empty body, production checked read-only (0 rows, 0 locks, 0 OB- journals); #1204 lessons 30-36; Gemini outputs registered as second opinions for R22-R26 and R28-R32 (#1207 #1209 #1211 #1221 #1223 and queued #1241 #1246-#1250 #1252); #1238 safe worktree prune (36 worktrees, about 16 GiB removed); independent review of the cutover redo (#1229 three blockers).
- Why: the owner wanted the Claude-free box lanes unblocked, production protected after the live wizard, and every research output compared with the agent digests before rows are opened. Hub agents (implementer, reviewer, registration agents) ran in parallel.
- Follow-up: owner sentence before any cutover merge; #889 design choice (row #1093); R27, R33 and R22 Stage 2 outputs; gateway timeouts (#1092) before orch --apply; desk verdicts for #999 #1172 and the held PRs listed in STATE.md.

## 2026-11-23 — main hub (Opus 5.5) — fleet on the Mac with SSD, WAVE 32 "finish every PR", box standing rules
- What changed: merged #999 #1158 #1263 #1298 #1300 #1304 #1305 #1306 #1307 #1308 #1335 #1336 #1337 #1339 #1340; queued with OWNER-OK #1201 #1227 #1271 #1301 #1303 #1275, plus #1342 (SSD work disk, stable prompts in PROMPTS_FA.md, owner guide); closed #889 #1237; WAVE 32 (25-PR fix queue for L8); hub agents fixed #850 #1313 #1314; rows #1343 #1344 #1348; HUB-ANSWER on #965 (box standing rules, approver account invited).
- Why: 50 open PRs and a full Mac disk were the bottleneck; the owner wants all open PRs finished and maximum Antigravity load.
- Follow-up: the merge queue stalled (no runner for merge_group jobs since 07:12 UTC; ASK-BOX on #965); #1309 fixes by L1; owner sentences for #831 #663; private flip needs the owners' own sentence.

## 2026-11-23 (evening) - main hub (Opus 5.5) - WAVE 33, CI load rule, site review
- What changed: posted WAVE 33 (review-first for all lanes, RV1-RV4 again) and a CI load rule on #592; re-queued #1201, reviewed and queued #850, dispatched the review desk once; relayed the owner's private-flip wish on #965 with the preconditions; reviewed roxira.ir and roxira.net public pages (roxira.net header overflows at 375 px).
- Why: the owner wants maximum speed with less CI and server load, and a real check of the site.
- Follow-up: frontend row for the roxira.net mobile header; owner signs in to the pane so the logged-in app can be reviewed; owner sentences for #831 #663 #963 and the restart window; merge READY FOR HUB PRs after desk verdicts at their heads.

## 2026-11-24 - main hub (Sonnet 5.5 session) - legal corpus found, R36 rows, disk reaper, overnight window
- What changed: found the legal corpus in prod Qdrant and opened Smart Judge rows #1380-#1383 #1392 #1393; digested R36 (#1387) into rows #1388-#1396; RV1-RV8 (modulo 8) and a Mac L7 block (#1402), Mac worktree reaper (#1404, launchd), 64 worktrees removed (disk 2.9 -> 34 GB); Kavenegar key rotated on Mac and prod; review desk looped 6 rounds; 15 safe PRs queued; WAVE 34 posted; #1072 and #1200 merged but production autodeploy rolled every deploy back (smoke gate, row #1413).
- Why: the owner wanted the lost corpus found, maximum Antigravity load, a safe disk, and a production window at 04:07.
- Follow-up: fix the smoke gate (#1413, owner sentence), Postgres/pgbouncer recreate after a real deploy, #1385 hub blocker, B1 reviews (#1374 #943 #1266), private flip conditions, SMS template change.

## 2026-11-25 - P1 (WAVE 36/37) - autodeploy unblocked, Smart Judge fixed, full-system audit rows, LANE_RULES v4 alignment
- What changed: #1424 (smoke gate fix, #1413), #1465 (`lane_preflight.sh` roles), #1467 (reviewdog download test marked `integration`), #1469 (fixed Smart Judge `UnboundLocalError` in production, 0 errors since), and #1470 (closed `#1385` hub blocker on unreviewed/OCR regulation rows & untrusted dates) merged on `main` (`f010aea02`); DQ reduced open non-draft PRs without a valid `github-actions[bot]` head VERDICT from 58 to 11 (68/79 have valid head VERDICT: 54 `no blocker`, 14 `blocker`); posted WAVE 36 and WAVE 37 (`GATE OFF`, default-pack accounting Priority 1, non-default packs paused, review-noise rule, and GATE-EXEMPT audit rows from `HUB -> LANES` 25c/25d) on #592; refreshed `docs/STATE.md` and aligned `docs/antigravity/LANE_RULES.md` with `PROMPTS_FA_v4.md` (VERDICT = `github-actions[bot]` only, `OWNER-OK #<PR> <sha7..40>`, WIP cap 8, per-block slash policy, bare `/boost` removed, review-noise rule added).
- Why: production deploys and Smart Judge chat needed stabilizing, the review-desk backlog and ruff inline-comment noise needed clearing, and lane priorities needed to focus on default-pack automatic accounting per owner decision.
- Follow-up: land `#1468` (`PROMPTS_FA_v4.md`), L5 `data_import` period-lock fix, L1 ruff reviewdog/DQ/`m1-gate`/chat-probe/`jit_launcher` fixes, L4 `legal_gate.py:732` fix, L11 `#230` E2E successor issue, and L12 lane-skill generator; owner actions for Postgres/PgBouncer recreate, `OWNER-OK` packets (`Owner packet @ 2026-11-25`, `#1458`), SMS templates, and private-flip prerequisites.

