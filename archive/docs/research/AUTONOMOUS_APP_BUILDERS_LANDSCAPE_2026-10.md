# Autonomous App Builders Landscape — 2026-10-01

## Decision

Build the factory around the existing GitHub-issue → approved plan → small PR →
CI/review flow. Add isolated workspaces, a deterministic Playwright/API repair
loop, and per-PR previews. Do **not** make an app-builder UI or a generic
multi-agent framework the control plane. Production remains an explicit owner
approval, even when every pre-production gate passed.

This is a decision for one Hetzner host, GitHub Actions, and local Mac workers;
it is not a claim that one tool can safely build every possible app unattended.

## Method and baseline

I read `SYSTEM_MAP`, `PROJECT_FACTORY`, STRATEGY §8, ADR 0003, the operations
runbook, and all `factory-*.yml`, `agent-task.yml`, `agent-review.yml`, and
`agent-automerge.yml` before surveying the market. The baseline is unusually
strong: Persian brief/proposal/status, explicit approval before code, task DAG,
PR-only workers, a cost cap, CI, review, and a disabled-by-default auto-merge
gate already exist. It is not yet a fully closed loop: research secrets are
missing, a live run is unproven, browser E2E is not a universal gate, and
there is no disposable workspace/preview/DB lifecycle.

Metadata is a public-GitHub snapshot on 2026-10-01: stars are rounded (`~`),
and “push” is the latest upstream commit/push observed, not a release date.
Maturity is an engineering judgement, not a star count. Each category verdict
uses the four linked independent primary sources immediately below it, plus the
local-baseline evidence above. Links were opened and checked during research.

Verdict meanings: **adopt** = deploy as a supported primitive; **adapt** =
reuse a bounded capability behind our contracts; **skip** = do not introduce
as a production dependency now.

## 1. Prompt-to-app builders

Evidence bundle: [bolt.diy repository](https://github.com/stackblitz-labs/bolt.diy),
[Dyad organisation/repository](https://github.com/dyad-sh),
[archived GPT Engineer organisation](https://github.com/gpt-engineer-org), and
[Adorable open-source Lovable-like builder](https://github.com/Baseline-Trials/app-builder).

| Project | Snapshot: stars / push / licence / maturity | What it actually does; known failure mode | Verdict for Roxira |
| --- | --- | --- | --- |
| bolt.diy | 19.9k / 2026-02-07 / MIT, but commercial WebContainers need a licence / active community | Browser IDE, chat code generation, WebContainer preview, many providers and one-click deployment. Its own docs say prompt quality differs by provider; browser sandbox and product UI are not reliable backend/E2E infrastructure. | **Adapt** only as UX/reference: provider picker, file diff, preview affordances. Do not fork/control builds with it. |
| Dyad | 21.6k / 2026-09-30 / “Other” (review before use) / active | Local desktop power-user builder, positioned against v0/Lovable/Replit/Bolt; templates and model providers. Desktop-local state and non-standard licence do not fit hosted multi-project orchestration. | **Skip** runtime; borrow its template/product ideas after licence review. |
| Lovable/v0/Replit-Agent-like OSS (Adorable, Open Lovable clones) | small/fast-moving / current / varies / prototype | Chat UI + patch approval + Git + preview; Adorable also needs Postgres, Redis, Anthropic and Freestyle credentials. Most clones demonstrate a surface, not safe provisioning, tenancy, billing or durable repair. | **Skip** as foundations; use as acceptance-test examples only. |
| GPT Engineer and successors | original OSS line effectively archived / GPT Engineer web app last push 2024-04-14 / MIT / historic | Early “spec → code” loop; successors are mainly products or new independent projects, not a maintained autonomous delivery stack. | **Skip**; no migration target. |
| 2026 newcomer: DeerFlow 2.0 | large, fast-moving / active / MIT / early production harness | General super-agent with skills, sandboxes, memory and subagents; it includes research/code but is a rewrite, not a proven deployment control plane. | **Adapt** only for research experiments, never replace the factory state machine. |

Category verdict: builders optimise an interactive human-in-the-loop experience;
our owner needs auditable, resumable, multi-worker delivery. Keep the Persian
owner UI in GitHub initially, then build a thin Roxira portal over the same
factory API—not a fork of a “vibe coding” product.

## 2. Multi-agent software-team frameworks and coding agents

Evidence bundle: [OpenHands architecture](https://github.com/OpenHands/openhands),
[Aider](https://github.com/Aider-AI/aider), [OpenAI Agents SDK](https://github.com/openai/openai-agents-python), and
[Google ADK](https://github.com/google/adk-python).

| Candidate | Snapshot: stars / push / licence / maturity | Actual value and failure mode | Verdict |
| --- | --- | --- | --- |
| MetaGPT; ChatDev | ~60k; ~30k / active but research-oriented / MIT or Apache-2.0 / demo | Role-play “software company” and chat-to-artifacts. They duplicate planner/reviewer roles but do not supply trustworthy CI, GitHub policy, sandbox or deploy evidence. | **Skip**. |
| OpenHands | 89.7k / active Sep-2026 / MIT core; enterprise is source-available / mature but heavy | Agent Server/SDK/Canvas/Automation can run multiple agents on hosts. Strong reference for workspace APIs; operationally large and its permissions are not a security boundary. | **Adapt** later for a remote execution backend; pilot on a separate host only. |
| SWE-agent | ~20k / active / MIT / mature benchmark tool | Issue-to-patch agent with an Agent-Computer Interface and SWE-bench lineage. Optimised for repo bug tasks, not app provisioning or multi-PR programme management. | **Adapt** as one selectable executor benchmark; do not orchestrate around it. |
| Aider | 49.3k / active / Apache-2.0 / mature CLI | Repo-map editing, git commits, lint/test repair, model flexibility. It assumes an interactive user and direct git; conflicts with PR-only worktree discipline if unwrapped. | **Adapt** as a local Mac executor option behind `rx`, with branch/command allowlists. |
| Plandex | ~15k / active / MIT / beta | Long-running terminal coding agent with plans and git. Useful inspiration for resumability; another state store and agent policy would duplicate the factory. | **Skip**. |
| Cline; Roo Code | ~50k; ~30k / active / Apache-2.0 / mature IDE extensions | Human-supervised IDE agents with tools/MCP. Approval fatigue, local credentials and user-session state make them poor headless workers. | **Adapt** only as developer tools, not workers. |
| Goose | ~25k / active / Apache-2.0 / mature CLI | Extensible local agent/MCP client. It is already installed on the server but direct server execution violates the current safety model. | **Skip** in production; optional Mac experiment. |
| Claude Code subagents + skills/routines | proprietary / continuous / commercial terms / mature product | Excellent planning, review, skills and bounded parallel work. Quota/start-up cost and the documented inability of some subagents to use git require the ADR 0003 escalation ladder. | **Adopt** as the Claude hub/reviewer exactly as now; use file ownership and no direct deploy. |
| OpenAI Agents SDK | 29.8k / active / MIT / maturing | Lightweight agents, handoffs, guardrails, sessions, tracing and sandbox clients; provider-agnostic but Python-centric. | **Adapt** for a future typed factory worker protocol if it beats current simple scripts; do not add now. |
| LangGraph | ~25k / active / MIT / mature | Stateful graphs, checkpoints, cycles and human gates. Already present in AI core; adds value only if factory state leaves GitHub. | **Adapt** as the durable orchestrator *after* GitHub workflow limits become measured pain. |
| CrewAI; AG2/AutoGen; Mastra | ~40k; ~15k; ~20k / active / MIT or Apache-2.0 / maturing | Pleasant multi-agent APIs (Mastra is TypeScript-first). All add their own task/memory/runtime model; quality depends primarily on the executor and tests. | **Skip**; framework churn exceeds value. |
| Google ADK | growing / active / Apache-2.0 / maturing | Code-first agent/workflow/evaluation toolkit, model/deployment agnostic in principle but strongly aligned to Google tooling. | **Skip** for now; duplicate of LangGraph/Agents SDK seams. |

Category verdict: retain the asymmetric team already chosen—Claude plans/reviews,
Codex/OpenCode executes small patches, deterministic CI decides. Parallelism is
the task DAG plus isolated workspaces, not a room of chatting “roles”.

## 3. Deep-research agents

Evidence bundle: [GPT Researcher package metadata](https://github.com/assafelovic/gpt-researcher/blob/main/pyproject.toml),
[Stanford STORM metadata](https://github.com/stanford-oval/storm/blob/main/setup.py),
[DeerFlow 2.0](https://github.com/bytedance/deer-flow), and
[Alibaba Tongyi DeepResearch](https://github.com/Alibaba-NLP/DeepResearch).

| Candidate | Snapshot: stars / push / licence / maturity | Actual value and failure mode | Verdict |
| --- | --- | --- | --- |
| GPT Researcher | 29.8k / active / MIT (metadata is inconsistent with older Apache references) / mature-ish | Searches, retrieves, synthesises cited reports with many providers. Dependency surface is broad; citations still require URL opening, source-quality checks and budget/time caps. | **Adapt** its report/citation contract only; keep `tech_radar.py` as the orchestrator. |
| Open Deep Research variants/local-deep-research | fragmented / mixed / mixed / experimental | Local search-and-synthesis loops; useful where data must stay local. Search quality, JS rendering and attribution deteriorate without paid retrieval/crawl backends. | **Adapt** one offline fallback later; no standard dependency now. |
| STORM / Knowledge STORM | ~25k / slow research cadence / MIT, Alpha classifier / research | Builds an outline and “Wikipedia-like” knowledge curation report. It is not a current technology-radar workflow and is explicitly alpha. | **Skip**. |
| MiroFlow / DeerFlow | DeerFlow large/active / MIT / v2 early | DeerFlow is a long-horizon harness with search, subagents, memory and sandbox choices; v2 shares no code with v1. | **Adapt** only as a comparison harness; current docs already chose not to adopt it. |
| Tongyi DeepResearch | 20k / active / Apache-2.0 / research release | 30B-A3B search agent with ReAct/“Heavy” modes and benchmark claims; requires model/runtime/search credentials, and the demo warns of latency/tool-QPS failures. | **Adapt** as a model-evaluation candidate via the registry, never as an autonomous source of truth. |

Category verdict: keep multilingual research in the existing pipeline, require
at least four independently opened sources in every stack recommendation, save
URL/title/date/extract hashes, and have a strong model synthesise only after
retrieval. Never pass case/customer data to free research models.

## 4. Agent QA, browser automation and E2E generation

Evidence bundle: [Playwright MCP security/runtime notes](https://github.com/microsoft/playwright-mcp),
[Browser Use](https://github.com/browser-use/browser-use),
[Playwright retries](https://playwright.dev/docs/test-retries), and
[Playwright traces/screenshots/video](https://playwright.dev/docs/test-use-options).

| Candidate | Snapshot: stars / push / licence / maturity | Actual value and failure mode | Verdict |
| --- | --- | --- | --- |
| Playwright Test | mature / continuous / Apache-2.0 / production | Deterministic browser E2E, isolation/retries, traces, video, screenshots, network/API assertions. Retrying can mask a flaky product; it cannot prove payments or external providers without controlled test modes. | **Adopt** as the mandatory factory acceptance harness. |
| Playwright MCP | ~20k / active / Apache-2.0 / maturing | Lets a coding agent inspect/click a browser from accessibility snapshots. Project states MCP is not a security boundary; Docker is headless Chromium only. | **Adopt** as a *repair tool* inside an ephemeral sandbox, not CI’s test runner. |
| browser-use | 116.9k / active / MIT / fast-moving | LLM browser agent, local/hosted browsers and profiles. It acknowledges no CAPTCHA guarantee; agent navigation is nondeterministic and cloud/profile use leaks operational complexity. | **Adapt** for exploratory UX checks and research, not pass/fail E2E. |
| Stagehand | ~20k / active / MIT / maturing | TypeScript API combining Playwright determinism with natural-language actions/extraction. Model costs and selector drift remain; Browserbase coupling is optional but tempting. | **Adapt** for test authoring, compile approved results into Playwright specs. |
| Skyvern | ~15k / active / AGPL-3.0 / maturing | Visual web-workflow automation with anti-bot/cloud features. AGPL and fragile vision/browser flows are incompatible with a small proprietary factory. | **Skip**. |
| “Playwright test agents” | not one product / n/a / n/a / pattern | Agent writes/updates tests from failures, then runs deterministic assertions and consumes trace artifacts. The dangerous failure is teaching the agent to weaken assertions to go green. | **Adopt** the pattern with an assertion-change review gate. |

Required loop: generate API contract tests + role/tenant tests + Playwright smoke
specs; deploy preview; run chromium/firefox/WebKit where relevant; attach traces,
screenshots, video and server logs; let a repair worker change code (not delete
assertions); rerun once or twice; then require a separate reviewer and green CI.
Mark tests that only pass on retry as flaky and block automatic promotion.

## 5. Infrastructure primitives

Evidence bundle: [Coolify capabilities](https://github.com/coollabsio/coolify),
[E2B sandboxing](https://github.com/e2b-dev/E2B), [GitHub deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments), and
[Neon DB branching workflow](https://neon.com/docs/get-started-with-neon/workflow-primer).

| Primitive | Snapshot: stars / push / licence / maturity | Actual value and failure mode | Verdict |
| --- | --- | --- | --- |
| Per-PR preview env | pattern / n/a / n/a / mature | Disposable app URL plus non-production secrets; GitHub can show URL/approval/deployment history. Orphans, shared DBs and branch-secret exposure are the real risks. | **Adopt**; TTL + PR-close cleanup + no prod credentials. |
| Coolify | 62.2k / 2026-09-29 / Apache-2.0 / mature | Self-hosted PaaS: Git deployments, PR previews, Docker/Compose, TLS, databases, rollback/backups and API/MCP. Its own recommendation is a separate control host; sharing the revenue host creates blast-radius/resource risk. | **Adapt**: put on a small second Hetzner VM, not the production box. |
| Dokploy | 37k / 2026-09-11 / core mixed/source-available portions / maturing | Vercel/Heroku-like self-hosted deployment platform with templates/MCP. Licence changed for proprietary portions and its smaller operator ecosystem adds risk. | **Skip**; choose one PaaS, not two. |
| Kamal | ~20k / active / MIT / mature | SSH/Docker deployment tool with simple rolling deploys; no PaaS dashboard or self-service previews. | **Adapt** only for controlled production deployment if Coolify is deferred. |
| CapRover | ~15k / active / Apache-2.0 / mature but slower | Docker Swarm self-hosted PaaS. Good simple hosting, weaker modern preview/agent integrations and an extra orchestrator. | **Skip**. |
| Neon Postgres branching | managed service / active / commercial / mature | Fast isolated DB branch/connection string per PR; schema-only option protects sensitive data. Egress, vendor cost and residency are constraints. | **Adapt** for *new factory projects* with non-sensitive test data; never branch Smart Judge production data. |
| Supabase self-host; PocketBase | mature / active / Apache-2.0 / mature-to-maturing | Supabase offers Postgres/auth/storage; PocketBase is a single-file SQLite backend. Self-hosted Supabase is ops-heavy; PocketBase is weak for multi-tenant enterprise/payment workloads. | **Adapt** Supabase templates only; **skip** PocketBase except throwaway prototypes. |
| Templates/boilerplates | n/a / n/a / per-template / essential | Contracted Next/Nest/FastAPI/Postgres/auth/RTL/payments skeletons reduce agent ambiguity. Old templates fossilise insecure dependencies. | **Adopt** a versioned, tested Roxira template registry with lockfiles and upgrade cadence. |
| E2B / Firecracker | E2B 14.1k / active / Apache-2.0 / mature service | Isolated code/desktop sandboxes; E2B self-host needs Terraform and a supported cloud/Linux setup, Firecracker needs KVM/ops expertise. | **Adapt** E2B managed first for untrusted agent/browser tasks; no self-hosted Firecracker on the one box. |
| Daytona | 71.7k / 2026-07-24 / Apache-2.0 core / maturing | Secure elastic workspaces with SDK/CLI and agent tooling. Excellent direction but another control plane and less suitable than a minimal Docker baseline at this scale. | **Skip** now; reconsider at >10 concurrent workspaces. |
| Docker-in-Docker | standard / continuous / Apache-2.0 components / mature | Reproducible build/test containers in Actions. Privileged Docker socket or nested daemon is an escape/DoS hazard. | **Adopt** only disposable GitHub runner jobs with scoped credentials; never agent-controlled Docker on production. |

## Recommended reference architecture

```text
Persian owner: «build app X»
          |
          v
GitHub Issue / Roxira Persian portal  -- approval -->  Factory state (issue + plan.json)
          |                                               |
          | research workers: open 4+ sources, cite, score | task DAG / budget / kill switch
          v                                               v
 Claude hub (plan/review) ----------------------> GitHub Actions dispatcher
          |                                               |
          |                                      +--------+--------+
          |                                      |                 |
          v                                      v                 v
 Mac workers: Codex/OpenCode              E2B/Docker workspace  Template registry
 (branch + small PR only)                 (untrusted commands,  (Next/Nest/FastAPI,
                                          Playwright MCP)        OpenAPI, RTL)
          |                                      |                 |
          +--------------- PR ------------------+-----------------+
                                          |
                                          v
 CI: lint/type/unit + OpenAPI/API + Playwright deterministic E2E
       | traces/video/screenshots; repair loop; separate review
       v
 Coolify on separate preview VM  <--- ephemeral preview + non-prod DB branch
       |                                     |
       +-- status URL/artifacts to Persian owner
                                             |
                                  owner approves production
                                             v
 GitHub protected `production` environment --> current Hetzner deploy.sh
                                             |
                                   health/smoke/rollback/report (Persian)
```

Security boundaries: no customer/case data leaves the approved paid model path;
workers receive minimum repo/secrets; previews have synthetic/empty data;
payments use provider sandbox keys until owner approval; every new table has
tenant ownership enforced in the Nest repository layer; production cannot be
reached from agent sandboxes.

## Top eight adoption order

| # | Component/outcome | Install effort | Risk | Incremental cost |
| --- | --- | --- | --- | --- |
| 1 | Make Project Factory live safely: add missing research secrets, perform one synthetic brief-to-PR run, record budget/artifacts; keep `FACTORY_ENABLED` kill switch. | S | Medium: unproven workflow and external search. | Existing Actions/model budget; cap $0.50 research. |
| 2 | Create versioned golden templates: Next App Router + Nest DTO/OpenAPI + Postgres tenant guard + shadcn + `dir=rtl`/Persian locale + optional auth/payment interfaces. | M | Medium: template becomes a security dependency. | $0; maintenance time. |
| 3 | Standardise API and real-browser gates: Playwright config, API contract tests, trace/video upload, retry/flaky policy, seeded test data. | M | Low–medium: flaky tests if isolation is poor. | GitHub runner minutes. |
| 4 | Add sandboxed repair workspaces: E2B managed pilot (or disposable Docker Actions job), no production network/keys, Playwright MCP for diagnosis only. | M | High if egress/secrets are not denied. | E2B usage or runner compute; start capped. |
| 5 | Add preview lifecycle: one Coolify VM, PR URL, temporary env vars, PR-close TTL cleanup, no customer data. | M | Medium: extra host and orphan resources. | One small Hetzner VM + domains. |
| 6 | Add DB preview policy: Neon branches for new non-sensitive projects or a schema-only seeded Postgres container; explicit migration/cleanup job. | M | Medium: data leakage/migration drift. | Neon usage or VM disk/CPU. |
| 7 | Promote through GitHub environments: preview automatic; staging gated; production requires owner; deployment URL, smoke, rollback and Persian release report. | S | Low–medium: wrong environment permissions. | $0 beyond Actions. |
| 8 | Instrument and evaluate: per-task cost/latency/pass/flaky/revert ledger; monthly executor bake-off (Codex/OpenCode/Aider/SWE-agent); only then consider LangGraph/OpenHands. | M | Low; avoids framework cargo cult. | Storage + bounded model-eval budget. |

## Explicit non-goals and exit criteria

Do not auto-deploy production, auto-spend beyond a cap, run untrusted code on
the production host, use free models for customer data, or let a repair agent
modify tests without review. “Fully autonomous” is reached only when three
synthetic projects and one owner-approved low-risk real project have completed
research, plan, parallel PRs, preview, API/E2E repair, protected deployment,
rollback drill, and a Persian report with no manual code edit by the hub.
