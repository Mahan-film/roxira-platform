# Current state (read this first)

Short snapshot for a new chat. Next read `docs/SYSTEM_MAP.md` (what exists: domains, server, keys by name, toolchain, permissions). `docs/STRATEGY.md` explains **why**; `docs/research/NEXTGEN_ROADMAP_2026-10.md` is the build order; `docs/research/PLATFORM_CAPABILITY_ASSESSMENT_2026-10.md` says what each product can and cannot do today. Every chat updates this file through `/handoff`. Last update: 2026-10-03 (hub on Sonnet, context full, handoff).

## Roles and lanes (ADR `docs/decisions/0003-agent-operating-model.md`)
- The hub is strategist and reviewer: it writes exact issue specs (files, verified data shapes, rules), reviews diffs line by line, and does not implement product code. Hard fixes go to a Sonnet `implementer` subagent in a prepared worktree (`~/Developer/rx-wt/...`; subagents cannot run git, the hub commits and pushes).
- Workers: `rx <issue> [model] [base-branch]` (`scripts/dev/rx`, zsh). Codex is EXHAUSTED until 2026-10-30 and officially unsupported in Iran: use `dsflash` (DeepSeek V4.1 Flash via OpenRouter, reachable again), `dspro`, `gptoss`, `team` (OmniRoute) for hard tasks. Weak models loop on code-graph search, invent images/versions/URLs and miss imports: verify every pin, send follow-ups by editing the issue body and rerunning `rx <n> dsflash issue-<n>`. Max 3 workers, stagger starts 25 s. rx enables auto-merge itself except for sensitive paths; use `RX_AUTOMERGE=0` for billing/auth/nginx/compose/workflows.
- Merging: rx PRs merge through `rx-automerge.yml` (server-side gate, PAT secret `MERGE_BOT_TOKEN`; needs green required checks, Agent review not failing, size <= 1500 lines, no sensitive path unless label `hub-approved`). `agent/*` PRs go through `agent-automerge.yml`. The assistant is denied: plain `gh pr merge`, `/approve` comments, cron/unattended jobs, branch deletion, batch edits of many issues. Allowed: `gh pr merge --auto`, labels, `gh workflow run`, `gh pr close` + `reopen`.
- Bot-authored PRs (Factory plan/agent) get 0 checks because `GITHUB_TOKEN` events do not trigger CI: close + reopen as the owner (fix in PR #446).
- Owner rules (memory): test every link/command before presenting it; give the owner exact commands, one per block; research first-hand; disagree only with evidence; lawyer gets only hard questions.

## Live and working (prod `5.75.200.67`, Hetzner, Cloudflare in front)
- Auto-deploy armed (`deploy-prod.yml` after green CI on main; `DEPLOY_ENABLED`, `.deploy-freeze`). CI ignores `*.md`-only pushes: if main drifted (generated `docs/SYSTEM_INVENTORY.generated.md`), run `gh workflow run ci.yml --ref main`, then deploy follows. Last verified 2026-10-03: `/health` 200, 45 routers, `/admin` 404, legacy `/api/v1/payment/zibal/checkout` and `/trial/start` 404.
- Security done (owner + hub, 2026-10-02/03): sshd key-only, `ufw` 2053 closed, JWT_SECRET rotated (prod value had equalled the repo default), `VIP_PHONE_ALLOWLIST` and `JWT_TTL_SECONDS` in `.env`, Dependabot alerts + security updates, ruleset has 6 required checks, Cloudflare OTP rate-limit rule, GitHub Pages source = Actions, server rebooted (15 containers healthy). Merged: #379 payments, #378 JWT, #381 sensitive paths, #382 actions kit (`pin_actions.py`, CODEOWNERS, SECURITY.md, Dependabot majors ignored via #419), #385-#388 Smart Judge fixes (fake 85% removed, disclaimer + scope guard, admin passcode removed, SEO), #430 unifiedauth robust env ints.
- Factory first real run: brief #236 -> proposal (run 6) -> `/approve` -> plan (8 tasks #433-#440, plan PR #441 merged) -> build: #433 scaffold merged (#442), #434 running. Planner on `cheap` tier (#390), overlapping tasks serialized (#431), ledger comments on the issue (`/report`), spec artifacts, task contracts. Agent PRs are reviewed by `deepseek/deepseek-v4.1-flash` (~$0.0005 each).
- Research stack: SearXNG + Valkey on prod (127.0.0.1:8888, not wired into the app), Crawl4AI compose pinned `unclecode/crawl4ai:0.9.4`. Local Whisper (`ROXIRA_STT_LOCAL=1`) merged but off.
- Qdrant: `iran_laws_v2` 5,103 points (8 laws), `judicial_precedents` 6, `judiciary_circulars` 250, advisory opinions 0.
- Smart Judge https://ghazihoushmand.ir: chat, document analysis (OCR), defense-document generation, damages calculator, citation check, voice, Zibal payments, SMS OTP. It is an assistant, by design NOT a judge (system prompt). Roxira OS https://roxira.ir (+ roxira.net -> roxira.ir): pages exist (accounting, crm, hr, inventory, invoicing, radar) but modules are skeletons with empty tables.

## Legal corpus (W25)
- Rules (`docs/LAWYER_ANSWERS_2026-09-30.md`): delete repealed articles; official sources only (rc.majlis.ir, Official Gazette); advisory opinions not authoritative; unification rulings authoritative.
- Staged, NOT in Qdrant: `data/raw/phase1/phase1_official_v2.jsonl` (git-ignored, Mac only): 1504 rows, 17 laws, all official. Ingest needs the owner's explicit yes (backup, separate collection, spot checks, switch).
- Gaps: invalid commerce arts 51 and 53-71 still served, no `source_tier` on served rows, unification rulings, `config/jurisdiction_rules.yaml` not wired, no case-level eval. FAQ citation checker for the public microsite: issue #447.

## Open work (check `gh pr list`; do not redo merged work)
- Workflow PRs reviewed by the hub, waiting for the owner's plain merge: #445 (agent-automerge regression fix), #446 (kick CI as PAT user), #432 (Pages basePath). Red PRs with known causes and follow-ups sent: #380 nginx (quote bug in test), #384 model gateway (Persian-digit card redaction), #383 hub CRM tenant isolation (brittle test), #389 /health (async handler not found by the test, branch DIRTY), #345 artifact cache. Dependabot major PRs must NOT be merged (django 6, typescript 7, nestjs 12, bullmq 6, eslint 10); #419 stops new ones.
- Issues: #423 merge gate treats skipped required checks as passed, #425 superseded by #430, #396 hub accounting audit, #447 FAQ citation verification, #428 and older W-items.

## Waiting on the owner
1. Plain merges listed above, and later `/approve`-type actions (the assistant cannot do them).
2. Apply `docs/ops/TWENTY_HARDENING.md` on the server (pinned compose, secrets from `.env`); decide the one-day Twenty Persian/RTL/Jalali spike.
3. Enable local Whisper after a real-voice test (`scripts/stt_bench.py`); legal ingest yes; send lawyer questions (`docs/LEGAL_RESEARCH_ROUND2_2026-09-30.md`).
4. DB fixes: order 4815502353 paid but `pending`; revoke fake user `authenticated_user`; SINGLE_DRAFT credits (#101). Move the old burned admin passcode anywhere it was reused.
5. Local branches with unpushed work (back up before any cleanup): feature/weekly-research-radar, fix/runners-off-prod, hub/status-2026-09-25, issue-133, issue-144, a stash, 12 dirty worktrees under `.claude/worktrees/`.
6. Optional: GitHub App instead of the PAT for the merge bot; PAT expiry date reminder.

## Next workstreams
| Id | What | Lane |
| --- | --- | --- |
| F1 | Finish brief #236 (tasks #434-#440), verify FAQ citations (#447), publish via `project-pages.yml` (basePath #432), then `/report` | agents |
| F2 | Preview environments on host (planner/preview.sh/compose template exist), golden fullstack template (#330, #335 backend slice merged), budget wiring | rx |
| M1 | Merge automation hardening: #423, #445, #446; required check `Agent review` only after it is stable | rx + owner |
| S1 | Security round 2: nginx (#380), OTP (#366), docker.sock removal from backend, RAG tenant isolation and prompt-injection tests, `pin_actions.py --apply` then `sha_pinning_required`, SOPS/age secrets | rx + owner |
| C1 | Agentic CRM on `CrmPort` + own agent layer (`docs/research/COMPOSABLE_CRM_ACCOUNTING_2026-10.md`): tenant/auth (#369), model gateway (#368), ledger audit (#396), Twenty spike | rx |
| J1 | Smart Judge: verified-citation drafts for lawyers/judges, eval set of expert-labelled cases, corpus expansion, scope/disclaimer done (see capability assessment) | rx + lawyer |
| V1 | Voice: local Whisper decision from `stt_bench`, VAD tuning | rx |
| X1 | Intelligence: tournament runs (#326), radar decision log (#347), DBOS spike, bake-off lab (`src/factory_pipeline/bakeoff.py` exists) | rx |

## Known issues
- Mac to GitHub/OpenRouter is flaky: use `timeout`, retries, kill hung shells; `gh pr merge` prompts "Delete the branch locally?" for merged PRs (answer N).
- rtk wraps git/pytest: use `rtk proxy python3 -m pytest <file>`; never run pytest over `src/` or the repo root. In zsh an unquoted variable is not word-split and `echo ====` fails: use bash -c or literal paths.
- Compose passes unset optional vars as empty strings: code must treat empty env values as unset (see #430).
- Dockerfile.prod is Python 3.11 while pyproject says >=3.13; `.env.example` names differ from prod.
