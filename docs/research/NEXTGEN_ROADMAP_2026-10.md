# Next-generation agentic platform: synthesis and roadmap (2026-10-01)

Owner vision (2026-10-01): from one prompt, Roxira researches the best technology (repos, papers, communities), compares several candidate stacks by actually trying them, builds the whole product with agent teams (frontend, backend, database, infrastructure, tests), verifies it, delivers it, and keeps improving itself.

This page turns three live-web research passes (observed 2026-10-01, sources and UNVERIFIED marks inside each file) into one decision set and one build order. It does not repeat `AUTONOMOUS_APP_BUILDERS_LANDSCAPE_2026-10.md`, `AGENTIC_TOOLING_RESEARCH_2026-10.md` or `AUTONOMY_OPS_RESEARCH_2026-10.md`.

- `nextgen/A_agent_native_architecture.md`: durable execution, protocols, team patterns, skills and memory.
- `nextgen/B_selfimprovement_bakeoff_radar.md`: benchmarks, bake-off method, self-improvement, evals-as-CI, radar sources.
- `nextgen/C_execution_delivery_substrate.md`: previews and sandboxes on one server, QA gates, templates, Iran continuity, agent safety.

## 1. The five architectural decisions

1. **State lives in Postgres, GitHub Actions is a bounded executor.** Every Factory run, step and artifact is a durable row; each Action claims one idempotent step and exits (Actions jobs are time-boxed and the token dies with the job). DBOS Transact is the only workflow engine worth a spike (Python, Postgres-backed, MIT). Temporal, Inngest, LangGraph-as-platform and AGNTCY are skipped: too much control plane for one 15 GB host.
2. **Spec first, then a planner / worker / verifier contract.** Each task carries spec version, owned paths, max diff, commands, expected artifacts, cost cap and stop rule. The verifier sees spec + diff + test evidence, never the planner's prose. GitHub Spec Kit's artifact chain (`spec -> plan -> tasks -> acceptance`) is adopted as a format, not installed wholesale.
3. **Objective gates decide, models advise.** No LLM judge is an acceptance authority. A PR passes only on compile/type/unit, Semgrep + Gitleaks + Trivy, preview, Playwright + axe + visual/ARIA baselines, policy (OPA) and, on schedule, ZAP baseline. An agent may propose a fix but can never waive its own gate.
4. **Bake-off = private tracer-bullet corpus + blinded tournament, not public leaderboards.** 12-20 replayable tasks (RTL Next.js, Nest/FastAPI ownership checks, CI repair, Playwright repair), 3 trials each, Pareto ranking on success, cost, time, policy violations. Public benchmarks (SWE-bench Live, Terminal-Bench) are periodic calibration on disposable runners only.
5. **Self-improvement is data, not self-editing code.** DSPy + GEPA tune bounded prompts and agent config files (versioned YAML) against a frozen holdout, promoted by PR. Darwin-Gödel-style self-modification and AlphaEvolve are research patterns only; no system may change its own merge rules, routing policy, secrets or deploy config.

## 2. What the radar may and may not read

| Source | Verdict |
| --- | --- |
| GitHub API, Hacker News (Algolia), arXiv | Adopt: official APIs, cheap |
| Product Hunt, YouTube (selected channels, quota 10k/day) | Trial, discovery only |
| Reddit | Only after reading the Data API terms; official API only |
| X | Skip unless a hard monthly cap is approved |
| Telegram, Instagram, TikTok | Skip: terms forbid scraping or AI use. Owner may paste or forward links by hand; the radar then reads the linked primary source |

Pipeline: ingest -> canonicalise/deduplicate -> score metadata locally -> require a primary source -> human review -> append decision log. The radar recommends a trial; it never installs software, creates credentials or touches production.

## 3. Constraints that shape everything

- One Hetzner host, 15 GB RAM, about 28 GB free disk (about 80 GB reclaimable). Proposed envelope: one browser job, one build sandbox, at most two previews of 1.5 GB each, 24 h TTL, empty schema-only preview databases, no production data or secrets in a preview.
- Iran: forged DNS answers in `10.10.34.0/24` are a failed dependency, not a service. Keep a reachability matrix (GitHub, registries, model APIs) from the host and from an Iranian network, pin image digests and lockfiles, cache essentials. A 403 from OpenRouter is a provider/country policy decision, not something to route around; a quantized llama.cpp model is the offline fallback for low-risk non-customer tasks only, after measurement.
- Agent safety: web text and issues are untrusted data. Separate identities per role (researcher, coding worker, CI tester, PR bot, deployer), minimal `permissions:` blocks, no Docker socket or PAT in sandboxes, SOPS + age for secrets, Actions pinned by SHA.

## 4. Adopt / trial / skip

| Adopt now | Trial | Skip |
| --- | --- | --- |
| Postgres run ledger + step claimers; Spec Kit-shaped artifacts; planner/worker/verifier contract; Agent Skills library; MCP allowlist; Compose previews with TTL; Playwright + axe + baselines; Trivy, Gitleaks; Copier template; OPA CLI; SOPS/age; Promptfoo gate; DSPy/GEPA (one prompt); GitHub/HN/arXiv radar; monthly tournament | DBOS spike; gVisor for untrusted workers; Coolify after plain Compose; Semgrep custom rules; ZAP baseline on previews; SWE-bench Live (2 tasks); Terminal-Bench (3 tasks); RouteLLM-style measured escalation; Inspect AI base package; AG-UI read-only progress page; llama.cpp fallback; OpenTofu (DNS/firewall only) | Temporal, Inngest, Restate (for now), AGNTCY, Kiro, Daytona (public repo frozen), Dokploy (license), Firecracker (KVM unverified), Pulumi, DGM, AlphaEvolve, X/Telegram/Instagram/TikTok scraping, full Inspect eval install, AppWorld, BrowserGym |

## 5. Build order

Already in flight from other chats (do not duplicate): SearXNG + Valkey compose (#260), local reranker order (#262), pull-based systemd deployer (#261), preview hard-limit planner (#263), Factory research fixes (#254, #255).

| Wave | Goal | Items (each one reviewable `rx` issue) |
| --- | --- | --- |
| 0 Proof | One real end-to-end Factory run | Re-run brief #236 on current main, judge proposal, `/approve`, plan; record run evidence in `docs/STATE.md` |
| 1 Ledger and contract | Durable, checkable runs | `factory_runs/steps/artifacts` Postgres schema + repository (tenant/owner column); spec-first artifact checker (`spec/plan/tasks/acceptance` present, owned paths set); task contract gains verifier fields; capability-token manifest per run (repo, paths, tools, budget, expiry) |
| 2 Delivery substrate | Anything built can be previewed and tested | `preview.sh up/down/gc` Compose contract wired to #263 limits; Playwright + axe + visual/ARIA baseline kit in the golden template; CI gates Trivy/Gitleaks/Semgrep rules; OPA policy set (no privileged, no host mounts, no `latest`, limits required); Copier `roxira-fullstack` template + `factory.yaml`; SOPS/age secrets layout |
| 3 Intelligence | Measure instead of guess | `factory-evals` corpus (12 tasks) + deterministic PR smoke gate; Promptfoo workflow with a spend cap; monthly tournament runner; GitHub + HN + arXiv radar with decision log; DSPy/GEPA on one proposal-classification prompt |
| 4 Scale and resilience | Harder but valuable | DBOS durability spike; gVisor worker trial; Coolify deploy/rollback trial; Iran reachability matrix workflow + cached artefacts; llama.cpp fallback measurement; read-only Persian AG-UI progress page; MCP manifest enforcement |
| 5 Bake-off lab | The owner's headline feature | For a brief with N candidate stacks: build a tracer bullet of each in a preview, run the same acceptance suite, score on the Pareto frontier, post a Persian comparison with the winner. Needs waves 1-3 first; hard caps: 3 candidates, one build at a time, cost cap per run |

Owner-only steps remain what STATE.md lists (server writes, key dashboards, `/approve`, ingest "yes"). Nothing here widens agent authority over production.

## 6. What would change this plan

- A measured GPU or second server makes Firecracker/E2B/vLLM realistic and previews less cramped.
- If DBOS recovery or RAM measurements disappoint, Restate is the fallback; the ledger schema stays the same.
- If the 12-task corpus shows no spread between candidate models, stop optimising models and spend on tests and templates instead.
