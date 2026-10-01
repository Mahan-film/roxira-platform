# Current state (read this first)

Short snapshot for a new chat. Next read `docs/SYSTEM_MAP.md` (what exists: domains, server, keys by name, toolchain, permissions). `docs/STRATEGY.md` explains **why**. Every chat updates this file through `/handoff`. Keep it under 100 lines. Last update: 2026-10-01 evening (hub, Factory proposal quality fixed, research stack installed).

## Roles and lanes (ADR `docs/decisions/0003-agent-operating-model.md`)
- The hub chat is the control room: strategy, issue specs, diff review, merge. It does not implement product code.
- Escalation ladder, cheapest first: (1) `rx <issue>` / `rxall` (`scripts/dev/`, linked from `~/bin`): default worker is the **Codex CLI** (owner's ChatGPT Plus login, no Claude quota), fallback dsflash → dspro → codestral on the LiteLLM pool, 15-minute timeout per attempt, ruff undefined-name gate before a PR; (2) a Claude `implementer`/general-purpose subagent on Sonnet that only edits files in a prepared worktree (subagents cannot run git: the hub commits); (3) a separate Sonnet chat (design, investigation); (4) Opus for ADRs only. Caps: 3 rx, 2 subagents, 1 extra chat.
- Research lane: `codex --search exec ...` (live web search, no Claude quota). A Sonnet research subagent cost 311k tokens on 2026-09-30: avoid for web research.
- Merging: the hub reviews the diff, then `gh pr merge <n> --auto --squash`. Not for PRs that add spend or touch the auto-merge workflow itself.
- Owner rules (memory): test every link/command before presenting it; research anything the owner names (and alternatives) first-hand on several sites; disagree only with evidence; the lawyer gets only hard questions that search cannot settle.

## Live and working (prod `5.75.200.67`)
- **Automatic deploy is built and ARMED** (owner approved 2026-10-01): `.github/workflows/deploy-prod.yml` runs after the `CI` workflow succeeds on `main`, in the GitHub environment `production`, and SSHes with a key whose `authorized_keys` line forces `/opt/roxira_platform/scripts/ops/ci-deploy.sh` (accepts only `deploy <40-hex-sha>`, flock, refuses commits not on origin/main, maps changed paths to services, runs `deploy.sh` with rollback). Kill switches: repo variable `DEPLOY_ENABLED` (currently `true`), file `/opt/roxira_platform/.deploy-freeze`. Secrets in env `production`: PROD_DEPLOY_KEY, PROD_KNOWN_HOSTS; variable PROD_HOST. **The deploy only runs if the whole CI run is green; CI on main was red from a8f4b55 because the `System inventory up to date` job needs `python3 scripts/gen_system_inventory.py` after adding workflows/scripts (fix PR #246).** Never add a workflow/script without regenerating `docs/SYSTEM_INVENTORY.generated.md`.
- **Assistant permissions**: after the owner added the allow rules, ssh writes, docker and `gh pr merge` work from the hub session; the auto-mode classifier still refuses anything that looks like creating a deploy path unless the owner states approval in chat (he did for the above).
- **Prod fully deployed** (core + frontend, last core deploy 2026-10-01 10:18 UTC): exact article lookup, identity fast path (`fast_path.classify_fast_path`; «سلام تو کی هستی» answers as «قاضی هوشمند»), Whisper request forces `language=fa` + vocabulary prompt, `/coverage`, new design tokens/components (not yet used by pages). Recipe: `ssh 5.75.200.67 'cd /opt/roxira_platform && nohup scripts/ops/deploy.sh <enterprise_app|roxira_enterprise_frontend> > /root/deploy.log 2>&1 &'`; never deploy `enterprise_app` during a long job inside `roxira_app_prod` (it recreates the container).
- Research stack on prod (2026-10-01): SearXNG + Valkey run from `docker/research-stack/` (127.0.0.1:8888, secret in git-ignored `.env` on the server, Persian queries return results). Not yet wired into the app container (needs `SEARXNG_BASE_URL` reachable from `roxira_app_prod`). `WebIntelligence` now prefers `LocalReranker` when `ROXIRA_LOCAL_RERANK=1`. Pull-based deployer (`scripts/ops/pull-deploy.sh`, `ops/systemd/roxira-pull-deploy.*`) exists but is NOT enabled. `src/factory_pipeline/preview_gate.py` holds the preview limits (<=2, 1 CPU/1 GiB, TTL 24 h); no preview host wired yet.
- Merged but NOT deployed to prod: local faster-whisper engine (`ROXIRA_STT_LOCAL=1`, off; model `large-v3-turbo` already cached on the server, loads in ~9 s), LightRAG/openai pin (#182 deployed in the 10:18 deploy), research libraries (SearXNG/ddgs clients, local reranker, free-first order in `WebIntelligence`).
- Qdrant `iran_laws_v2`: 5103 points (12 new official laws added 2026-10-01; snapshots from 08:54 exist in Qdrant as backup).
- Site https://ghazihoushmand.ir: Zibal payments, SMS OTP login, STT/TTS voice, `/health` 200.
- GitHub Actions: secrets BRAVE_API_KEY, EXA_API_KEY, FIRECRAWL_API_KEY, JINA_API_KEY, TAVILY_KEYS, OPENROUTER_AGENT_KEY, OPENROUTER_RESEARCH_KEY (daily-capped) are set; variables FACTORY_ENABLED=true, AGENT_ENABLED=true, AUTO_MERGE_ENABLED=true, AGENT_REVIEW_MODEL=deepseek/deepseek-v4.1-flash. Auto-merge is enabled on the repo (runbook §7). Required checks list in the ruleset still lacks `Undefined names` and `System inventory up to date` (owner).
- Project Factory on brief #236 (static Persian legal FAQ microsite): run 6 (2026-10-01 16:10 UTC, $0.01) produced a good Persian proposal: only ui_ux/frontend/infra_server/cost layers (`--layers`, `src/factory_pipeline/brief_subject.py` picks layers from the issue text), preferred stack Next.js static + shadcn/ui honoured, GitHub Pages recommended. **The owner replies `/approve` on #236 to start plan/build** (the old run-4 proposal is superseded). Layer output is normalised (`normalize_alternatives`) so a schema-ignoring model no longer yields blank options.
- OmniRoute (Mac, `127.0.0.1:20128`): encrypted DB (key in the volume's `server.env`, backup in `~/omniroute-backups/`), Cloud off, combo `team-coding`, key env `OMNIROUTE_OPENCODE_KEY` in `~/.config/omniroute.env` (rotated 2026-10-01). Measured: LiteLLM codestral 7/7 at 1.6 s, OmniRoute team-coding 7/7 at 3.9 s; LiteLLM stays the default gateway, `rx <n> team` is the secondary lane.
- Gemini CLI returns 403 from this Mac (region); Codex CLI works.

## Legal corpus (W25)
- Served corpus: `iran_laws_v2`, 8 laws, 4,216 article rows, all without `source_tier` (manifest shows them as unknown/unofficial). `docs/LEGAL_COVERAGE_MANIFEST.md` is generated.
- Lawyer rules (`docs/LAWYER_ANSWERS_2026-09-30.md`): delete repealed articles; official sources only (Official Gazette, rc.majlis.ir); advisory opinions not authoritative; unification rulings authoritative; peace court up to 1,000,000,000 rials (art. 12 of the 1402 law, adjustable every 3 years).
- Research (`docs/LEGAL_RESEARCH_2026-09-30.md`): «لایحه اصلاحی قانون تجارت» is enacted law (1347/12/24); only arts 51 and 53-71 were declared invalid (1403/11/15) and must be removed. Official rc.majlis.ir ids for the remaining laws are listed there (reported by the agent; the hub could not re-open them). A second, deeper pass by Codex is being written to `docs/LEGAL_RESEARCH_ROUND2_2026-09-30.md` (branch `docs-legal-research-2`, may be unfinished).
- Tools: `scripts/legal_fetch_page.py` (deterministic, works on `https://rc.majlis.ir/fa/law/print_version/<id>`), `scripts/w6_ingest_dotic.py --file ... --source-tier official`. rc.majlis.ir is reachable only intermittently: retry later rather than switching source.
- Staged, NOT in Qdrant: `data/raw/phase1/phase1_official_v2.jsonl` (git-ignored, Mac only): 1504 rows, 17 law units, all `source_tier=official`, built from the official rc.majlis.ir texts fetched 2026-10-01 into `data/raw/phase1/*.txt` with the #177 filters and the #200 `--amending` splitter (reduction 1399, cheque amendments 1397/1400). Ingest into prod Qdrant needs the owner's explicit yes (plan: backup, separate collection, spot-check lookups, then switch).
- Remaining legal gaps: re-fetch of the 8 laws served in `iran_laws_v2` (commerce, civil code, etc. not in the staged file except commerce 96314 not staged yet), unification rulings (Phase 4), wiring `config/jurisdiction_rules.yaml` into answers after the lawyer replies.

## Autonomy wave (2026-10-01 night, hub = strategist only)
- Research: `docs/research/NEXTGEN_ROADMAP_2026-10.md` (+ `nextgen/A,B,C`), Persian overview `docs/OWNER_MASTER_OVERVIEW_FA.md`, lane/capacity plan `docs/research/AGENT_LANES_CAPACITY_2026-10.md`.
- Merged via rx (issues #267-#299): run-ledger CLI in factory-research, HN adapter, spec_artifacts, reachability matrix, task-contract validation in the planner, eval tournament runner, axe a11y e2e, preview.sh (bash) + preview compose template, Trivy/Semgrep (report-only), compose_policy, template_check job, preflight report, golden template `templates/roxira-static-rtl`, rx auto-merge step, Agent review on rx PRs (`pull_request_target`, trusted checkout). Open: #298 ledger via hidden issue comments.
- Still unwired: delivery_report, budget in factory workflows, spec_artifacts gate, `/report` command. Next waves are in the roadmap (DBOS spike, SOPS, gVisor, Coolify, tournament schedule).
- Lanes (measured research, 2026-10-01): local LiteLLM pool first, Groq, Cerebras, SiliconFlow free, OpenRouter `:free`, OpenCode Zen free. Codex CLI/Gemini are officially unsupported in Iran: treat as supervised escalation, not capacity. GitHub Models is retired; Team has no Copilot; 3,000 Actions min/month is a shared budget.
- Classifier limits: the assistant cannot post `/approve`, plain `gh pr merge`, or delete branches; owner runs those. Local branches with unpushed work: feature/weekly-research-radar, fix/runners-off-prod, hub/status-2026-09-25, issue-133, issue-144, worktree-agent-aedbb559e8fd6de8f, plus a stash and 12 dirty worktrees: back up before any cleanup.

## Waiting on the owner
1. `/permissions` allow rules in an interactive `claude` terminal: `Bash(ssh 5.75.200.67:*)`, `Bash(gh:*)`, `Bash(docker:*)`. Without them the assistant's auto-mode classifier refuses ssh writes, direct merges, secret-file handling and anything that looks like a deploy pipeline.
2. Approve the Factory proposal on issue #236 with a `/approve` comment (run 6 proposal is good).
3. Enable local Whisper on prod (add `ROXIRA_STT_LOCAL=1` to the server `.env`, redeploy `enterprise_app`) after a real-voice test; Crawl4AI is not installed yet (SearXNG+Valkey already run).
4. Send (or not) the five expert questions at the end of `docs/LEGAL_RESEARCH_ROUND2_2026-09-30.md` to the lawyer.
5. DB fixes: order 4815502353 paid but `pending`; revoke fake user `authenticated_user`; SINGLE_DRAFT credits (#101).
6. Server housekeeping: kernel reboot; disk is at 79% (31 GB free) which limits preview environments.

## Next workstreams (roadmap: `docs/research/FULL_AUTONOMY_GAP_ANALYSIS_2026-10.md`)
| Id | What | Lane |
| --- | --- | --- |
| F0 | Fix llm_router `models` cap (#238), then re-run brief #236 and record the run | rx |
| F1 | Preview environments on the same server with hard limits (<=2, 1 CPU/1 GB each, TTL 24 h), preview E2E (Playwright), `deploy-prod.yml` with forced-command SSH key + `.deploy-freeze` | rx + owner install |
| F2 | Golden templates (Next+Nest+Postgres, RTL fa) checked by `template_check.py`; run ledger + budget wired into factory workflows; final Persian report in factory-status | rx |
| R1 | Zero-cost research stack: SearXNG+Valkey compose, Crawl4AI, wire `LocalReranker`, disable paid auto-reload in Brave/Exa/Tavily/Firecrawl/Jina dashboards (`docs/research/ZERO_COST_RESEARCH_STACK_2026-10.md`) | rx + owner |
| W25 | Official laws still to add: replace the 3 overlapping laws (civil procedure, dispute councils, cheque) with official versions, unification rulings, wire `config/jurisdiction_rules.yaml` after the lawyer answers | rx |
| V1 | Voice: promote local Whisper after a measured test, VAD/endpointing tuning, re-ask on low confidence (`docs/research/STT_PERSIAN_RESEARCH_2026-10.md`) | rx |
| misc | #99, #77, #113, #67, #66, #84, #94/#95, PR #74 e2e (red) | rx |

## Known issues
- Dockerfile.prod is Python 3.11 while pyproject says >=3.13; `.env.example` names differ from prod (SYSTEM_MAP §3-4).
- The Mac's link to GitHub, OpenRouter and Iranian sites drops often: retry loops are normal; `gh` needs `SSL_CERT_FILE` from certifi.
- rtk wraps git/pytest: use `rtk proxy python3 -m pytest <file>`. Never run pytest over `src/` or the repo root.
- Git worktree creation needs the sandbox disabled (writes `.git/config`). Many stale worktrees under `.claude/worktrees/` and `~/Developer/rx-wt/` can be pruned.
