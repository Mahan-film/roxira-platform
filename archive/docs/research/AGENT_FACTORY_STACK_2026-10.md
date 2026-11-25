# Agent factory stack: orchestration, durability, reliability (2026-10-04)

Question: what is the best CURRENT stack for a local, parallel, supervised multi-agent software factory run by one developer in Iran, with GitHub Actions minutes exhausted (everything local)? Method: WebSearch (extended) plus WebFetch on 2026-10-04. "UNVERIFIED" = not confirmed from a fetched page (search snippet or blog only). Does not repeat `NEXTGEN_ROADMAP_2026-10.md` (Postgres ledger, spec-first, objective gates, DBOS spike, skip Temporal/Inngest), `METHOD_VALIDATION_2026-10.md` (merge problems), `RAAS_AAAS_PLATFORMS_2026-10.md` or `AGENT_LANES_CAPACITY_2026-10.md` (model lanes). New here: the actual runtime/orchestrator choice and a local-only architecture.

## 0. Key new facts that change earlier plans

1. Earlier docs assume "GitHub Actions is a bounded executor". With minutes exhausted, the executor must be the Mac itself (launchd/cron or a long-lived supervisor process), with GitHub used only as git remote + PR/merge surface. Durable state in a local Postgres/SQLite (DBOS supports both, verified).
2. Anthropic's own docs confirm Iran is NOT in the supported-countries list for API or claude.ai ([supported-countries](https://www.anthropic.com/supported-countries), fetched). Claude Code / Agent SDK therefore cannot be the production worker lane; it stays a human-directed hub tool (already the policy in STATE.md). Also: Agent SDK terms forbid offering claude.ai login to third parties; API-key auth only ([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), fetched).
3. GitHub access from Iran: a GitHub blog post title says "GitHub is fully available in Iran" ([blog](https://github.blog/news-insights/policy-news-and-insights/advancing-developer-freedom-github-is-fully-available-in-iran/), search result only, date UNVERIFIED), while a 2026 article claims tightening of Actions/Copilot/Codespaces/npm ([abhs.in](https://www.abhs.in/blog/iran-sanctions-developers-github-npm-blocked-2026), UNVERIFIED, low-quality source). Treat GitHub-hosted anything as fragile; local-first is correct. Do not use VPNs to hide location (GitHub terms prohibit, per the same snippets).
4. Reward hacking is measured, not anecdotal: SpecBench shows frontier models saturate visible tests but fail held-out tests, gap +28 points per 10x code size, smaller models hack more ([arXiv 2605.21384](https://arxiv.org/abs/2605.21384), fetched). Our pool runs cheap/small models, so hidden/held-out acceptance tests are mandatory.

## 1. Candidate table

Legend: Verdict ADOPT = use now, TRY = time-boxed spike, SKIP = not for us now.

### 1a. Agent runtimes (the thing that executes one task)

| Candidate | What / maturity / license | Fit for solo local | Cost | Iran/geo | Verdict |
|---|---|---|---|---|---|
| OpenCode (`opencode serve`, `opencode run --attach`, JS SDK) | Open-source coding agent, 211.6k stars, MIT ([repo](https://github.com/sst/opencode), repo now under `anomalyco/opencode` per release link, fetched). Headless HTTP server, OpenAPI 3.1 at `/doc`, sessions with fork, permission-response endpoint, basic auth via env ([server docs](https://opencode.ai/docs/server/), fetched). | Excellent: already our worker. One long-lived server per worktree/model, driven by SDK instead of spawning a CLI per issue. Gives per-session permission callbacks and event stream for a supervisor. | Free; model cost only | Local binary; model endpoints are our lanes (LiteLLM/OmniRoute/Mistral/SambaNova) so no US dependency | ADOPT (move from CLI spawn to server+SDK) |
| Claude Code CLI / Agent SDK (Python, TS), subagents, skills, hooks | Official; subagents with `isolation: worktree`, `maxTurns`, `permissionMode`, per-agent `model`, nesting depth 3, 20 concurrent default ([sub-agents](https://code.claude.com/docs/en/sub-agents), fetched). Hooks: 33 events as of 2026-09-06 (search snippet, UNVERIFIED). SDK governed by Commercial Terms. | Best supervisor/hub harness and the model for our `.claude/agents` roles. Not a worker lane (Iran unsupported, cost). Hooks are the right deterministic gate layer when a human drives it. | API-key paid / subscription for personal CLI | Iran NOT supported (fetched). Personal-use risk is the owner's; do not build automation on it | ADOPT for hub only; SKIP as factory worker |
| OpenHands Software Agent SDK | MIT, 1.2k stars on SDK repo, Python/TS/REST, local or Docker/K8s agent server, event-sourced state with deterministic replay ([repo](https://github.com/OpenHands/software-agent-sdk), fetched; v1.7.0 May 2026 per search, UNVERIFIED) | Strong alternative runtime with built-in sandbox and replay, LiteLLM-based so works with our pool. Heavier (Docker per task) on a MacBook; duplicates OpenCode. | Free | Docker Hub pulls may need mirror/caching (UNVERIFIED) | TRY (one bake-off lane vs OpenCode on the tracer corpus) |
| Goose (AAIF / Linux Foundation) | Apache-2.0, 54.9k stars, Rust, CLI+desktop+API, 70+ MCP extensions, recipes with sub-recipes and scheduler, moved to `aaif-goose/goose` ([repo](https://github.com/aaif-goose/goose), [move](https://goose-docs.ai/blog/2026/04/07/goose-moves-to-aaif/), fetched). | Recipes (parameters, retry, structured response schema) are a nice declarative task format. Overlaps OpenCode. | Free | Local; provider-neutral | TRY (steal the recipe idea; optional second runtime) |
| Aider / Codex CLI / Gemini CLI | Mentioned as adapters in orchestrators ([Bernstein docs](https://docs.bernstein.run/en/latest/), fetched) | Codex exhausted and unsupported from Iran (see lanes doc); Gemini excluded (Google regions) | n/a | Blocked/unsupported | SKIP |

### 1b. Orchestrators / task schedulers around runtimes

| Candidate | What / maturity / license | Fit | Cost | Iran | Verdict |
|---|---|---|---|---|---|
| Our own `rx` + Project Factory (Postgres ledger, planner -> tasks -> PRs) | In-house, working, known holes (STATE.md, METHOD_VALIDATION) | Fits exactly; cheapest to evolve | Time | none | ADOPT as the control plane; harden, do not replace |
| Bernstein | Apache-2.0 (per Augment table, fetched), pip/pipx/uv/brew, deterministic Python scheduler with zero LLM coordination tokens, per-task worktrees, "Janitor" gates (tests/lint/types/PII), replay journal, 40+ adapters, optional HMAC audit ([docs](https://docs.bernstein.run/en/latest/), [Augment list](https://www.augmentcode.com/tools/open-source-agent-orchestrators), fetched). Several forks exist and one README says "beta"; solo-maintained (Augment). Maturity UNVERIFIED. | Closest match to what we are building (planner -> task graph -> worktree agents -> verify -> merge). Best used as a design reference or a spike, not a dependency on a solo-maintained beta. | Free | local | TRY (one-day spike; copy Janitor + replay ideas regardless) |
| Baton (poll GitHub Issues, dispatch Claude Code, per-issue worktree, MIT) | Active Python daemon; "no automated merge conflict resolution" ([Augment](https://www.augmentcode.com/tools/open-source-agent-orchestrators)) | This is `rx` already, but Claude-only | Free | Claude-only = unusable | SKIP |
| Claude Squad | AGPL-3.0, tmux+worktree TUI ([Augment](https://www.augmentcode.com/tools/open-source-agent-orchestrators)) | Only a human dashboard; AGPL fine for personal use | Free | Claude-centric | SKIP (use plain tmux/`rx status`) |
| Vibe Kanban | Apache-2.0 but Bloop shut down April 2026, disk bloat with many worktrees (Augment, fetched) | Abandonware risk | Free | n/a | SKIP |
| Agent Orchestrator (ComposioHQ-style), Emdash, Nimbalyst, Code Conductor, Microsoft Conductor | Desktop apps/pre-1.0 (Augment table) | Add UI weight, no gain over rx | Free | n/a | SKIP |
| Git worktree per agent (pattern) | Universal in all 9 orchestrators above; solves file isolation only, not task decomposition, semantic conflicts or merge choice ([Augment guide](https://www.augmentcode.com/guides/how-to-run-a-multi-agent-coding-workspace), fetched) | Already in rx (`~/Developer/rx-wt/...`) | Disk | none | ADOPT (add per-worktree port allocation and a `gc`; Baton lists port collisions as unsolved) |

### 1c. Agent frameworks (in-process multi-agent libraries)

| Candidate | What / maturity / license | Fit | Verdict |
|---|---|---|---|
| LangGraph | MIT; graph state machine, checkpointing to your own Postgres, human-in-the-loop interrupts; async checkpoint mode can lose data on hard crash; checkpoints whole nodes ([HackerNoon 2026-09-24](https://hackernoon.com/durable-execution-for-ai-agents-langgraph-dbos-inngest-and-temporal-compared), fetched; license from search snippet, UNVERIFIED) | Good for a planner/reviewer state machine, but our control flow is already Postgres rows + scripts; adds a big dependency | SKIP now (revisit only if Factory planner needs approval-gate branching beyond SQL state) |
| CrewAI | MIT, ~54.7k stars (search snippet, UNVERIFIED); role-based crews; common migration path is CrewAI -> LangGraph when control flow hits ceiling (search snippet, UNVERIFIED) | Prototype tool; wrong abstraction for repo-editing agents | SKIP |
| OpenAI Agents SDK | MIT; LiteLLM extension for non-OpenAI models, but Responses API/hosted tools/tracing are OpenAI-first (search snippet, UNVERIFIED) | OpenAI excludes Iran; its handoff pattern adds nothing over a task queue | SKIP |
| Pydantic AI / Google ADK / AutoGen | Not researched in depth | n/a | SKIP (UNVERIFIED, out of scope) |

### 1d. Durable workflow engines

| Candidate | What / license / self-host | Fit | Verdict |
|---|---|---|---|
| DBOS Transact (Python) | MIT, 1.6k stars, Postgres or SQLite backend, durable queues with rate limits/timeouts/dedup, cron, "youngest, shortest track record", workflow traffic shares your DB ([repo](https://github.com/dbos-inc/dbos-transact-py), [HackerNoon](https://hackernoon.com/durable-execution-for-ai-agents-langgraph-dbos-inngest-and-temporal-compared), fetched) | Library not cluster; SQLite backend means no server needed on the Mac. Gives crash-resume for a multi-step factory run (plan -> task -> verify -> PR) and queue concurrency caps (max 3 workers) for free. Matches the roadmap's one workflow spike. | TRY now (promote to ADOPT if the spike survives a kill -9 test) |
| Restate | Single binary, TS/Java/Kotlin/Python/Go/Rust SDKs, 4.5k stars; license is BSL 1.1 (source-available, converts to Apache-2.0 after 4 years; forbids offering a public Restate platform service) ([LICENSE](https://github.com/restatedev/restate/blob/main/LICENSE), fetched); $20M Series A announced 2026-09-30 (search, UNVERIFIED) | Light enough for a Mac, but second runtime to operate; BSL fine for internal use | SKIP (DBOS covers the need with less) |
| Temporal | Event-sourced, strict determinism rules, needs a cluster or Cloud ([HackerNoon](https://hackernoon.com/durable-execution-for-ai-agents-langgraph-dbos-inngest-and-temporal-compared), fetched) | Overkill for one laptop | SKIP |
| Inngest | Step functions; self-host means ~9 services; Cloud is US-hosted (HackerNoon, fetched) | Overkill and Cloud geo-risk | SKIP |
| launchd + Postgres/SQLite claim loop (`SELECT ... FOR UPDATE SKIP LOCKED`) | Zero dependency | What the roadmap already describes; fallback if DBOS fails | ADOPT as fallback |

### 1e. MCP gateways / tool governance

| Candidate | What | Fit | Verdict |
|---|---|---|---|
| Bifrost | Go single binary, routes LLM+MCP, virtual keys with budgets/rate limits/tool allowlists, audit logs, air-gap capable ([Maxim, updated 2026-09-08](https://www.getmaxim.ai/articles/best-open-source-mcp-gateways-in-2026-2/), fetched; vendor-authored, treat as marketing) | Overlaps OmniRoute (already our model router) | SKIP (UNVERIFIED independent quality) |
| Docker MCP Gateway | MIT per search snippet (UNVERIFIED), each MCP server in its own container | Good isolation for untrusted MCP servers, needs Docker Desktop | TRY only if we add third-party MCP servers for workers |
| MCPJungle / Obot / IBM ContextForge / Microsoft MCP Gateway | Aggregators; Obot and ContextForge/MS are heavy (K8s) | Overkill; MCPJungle token cost grows with tool count (Maxim, fetched) | SKIP |
| Static per-role MCP allowlist in agent config (what `.claude/agents` and opencode.json already do) | Zero infra | Matches roadmap "MCP allowlist" | ADOPT |

### 1f. Merge / integration

| Candidate | Fit | Verdict |
|---|---|---|
| Sequential merge: rebase each branch on updated `main`, one at a time (Augment pattern 6, fetched) | Equivalent to a merge queue without Enterprise plan (merge queue unavailable on private Team repos, per METHOD_VALIDATION) | ADOPT: implement as a local `integrate.sh` that takes the green branch list, rebases, re-runs `local_ci.sh`, then pushes |
| Mergify / Kodiak / bors | Hosted or Actions-dependent, US services | SKIP |
| `rx-automerge.yml` server-side gate | Needs Actions minutes, which are exhausted | Move its checks into the local integrate step; keep workflow only as backup |

## 2. What practitioners report about reliability (with sources)

| Finding | Source |
|---|---|
| Verification, not generation, is the bottleneck; quality gates = plan approval, lifecycle hooks that keep the agent working until tests pass, curated AGENTS.md | [Addy Osmani, Code Agent Orchestra](https://addyosmani.com/blog/code-agent-orchestra/) (fetched) |
| Hard per-agent token budgets with auto-pause at 85%; kill criterion after 3+ iterations on the identical error; reset context between tasks ("Ralph loop") | same (fetched; numbers are one author's practice, not a standard) |
| LLM-generated AGENTS.md gave ~3% lower success and +20% cost; human-written gave ~4% gain (ETH Zurich as cited by Osmani; primary paper not fetched, UNVERIFIED) | same |
| Models above 70% on single-issue tasks drop below 25% on multi-file patches, so decompose into bounded spec-scoped tasks; semantic contradictions pass compile and lint and need explicit review | [Augment guide](https://www.augmentcode.com/guides/how-to-run-a-multi-agent-coding-workspace) (fetched; vendor, numbers UNVERIFIED) |
| Long-running agents declare victory early, mark features done untested, leave no progress notes. Fix: initializer writes a feature list (all "failing"), one feature per session, progress file + git log at session start, browser/E2E testing | [Anthropic engineering](https://anthropic.com/engineering/effective-harnesses-for-long-running-agents) (fetched) |
| Reward hacking: visible tests saturate, hidden tests fail; gap grows with code size | [SpecBench](https://arxiv.org/abs/2605.21384) (fetched) |
| Infinite agentic loops exist in LangChain, LangGraph and AutoGen; framework defaults insufficient; explicit iteration caps, recursion limits and tool-call sequence monitoring needed | [Hou et al. arXiv 2607.01641](https://arxiv.org/pdf/2607.01641) (fetched) |
| Runaway agent can burn $50-$500 before noticed; one case 400 identical tool calls in 5 minutes; tool calls fail 3-15% in production | [Openlayer, July 2026](https://www.openlayer.com/blog/ai-agent-failure-modes-tool-calling-loops-propagation) (search snippet, UNVERIFIED) |
| Git worktrees isolate files only; do not solve decomposition, dependency tracking, semantic conflicts or merge selection | [Augment orchestrator list](https://www.augmentcode.com/tools/open-source-agent-orchestrators) (fetched) |

Mapped to our known problems (hallucinated image/version names, workers cannot run tests, weak models loop on code-graph search): every one is a verification-loop or cap problem, not a framework problem. No framework fixes it for us.

## 3. Recommended architecture (local-first)

Components
1. Control plane = existing Project Factory + `rx`, state in local Postgres (or SQLite) tables `runs/steps/tasks/ledger`; durability via DBOS spike.
2. Task contract (per task, a file in the worktree and a DB row): spec version, owned paths, max diff lines, acceptance commands, HIDDEN acceptance tests (kept outside the worker's worktree), max turns, token cap, wall-clock cap, stop rule.
3. Workers = OpenCode servers (one per worktree, SDK-driven) on the LiteLLM/OmniRoute pool; max 3 concurrent; staggered starts.
4. Verifier lane = different model family and read-only: sees spec + diff + test evidence only (our `reviewer` agent semantics); objective gates (local_ci.sh, hidden tests, secret scan, pin check) decide, models advise.
5. Integrator = local sequential rebase-and-verify, then push/PR; auto-merge only after local gate green (replaces minute-hungry Actions).
6. Hub = Claude Code (human-directed, rare), using `.claude/agents` implementer/tester/reviewer.

Data flow
brief -> research (Brave/Tavily/Exa/Jina/Firecrawl) -> owner `/approve` -> planner (strong model) writes spec/plan/tasks/acceptance -> DB claim loop pops a task under DBOS queue concurrency=3 -> create worktree + port -> OpenCode server session with contract -> loop: edit, run acceptance (visible), cap check -> branch -> verifier + hidden tests + local_ci.sh -> pass: integrator rebases and re-verifies, PR, ledger row; fail: one bounded repair round, else park as "needs-human" with log -> worktree gc.

Where existing tools fit
- scripts/dev/rx: becomes the thin CLI over the claim loop; keep.
- LiteLLM pool: default worker lane; OmniRoute (502 models): router/fallback, health-probed; OpenRouter/Mistral/SambaNova: named lanes in `config/models.yaml`.
- `.claude/agents`: hub-side roles; mirror the same contracts as OpenCode agent profiles.
- local_ci.sh: the only merge authority.
- Search stack: research step only; treat output as untrusted data.
- Skills: use Agent Skills format for repeatable procedures (works in Claude Code; OpenCode/Goose read compatible files, UNVERIFIED).

Hard caps (adopt from section 2): max turns per task, 3 identical-error strikes then park, 85% token budget pause, per-run cost ceiling, daily lane budget, context reset per task, no agent may edit its own gate, hidden tests, or model registry.

## 4. Next steps (ordered, each one rx-sized)
1. Spike: OpenCode `serve` + SDK driving one issue in one worktree with a cap/strike wrapper (1 day).
2. Spike: DBOS (SQLite) wrapping the claim loop; kill -9 resume test (1 day).
3. Local `integrate.sh` (sequential rebase + local_ci) to retire the Actions merge gate.
4. Hidden-acceptance-test convention in the task contract and verifier.
5. 1-day Bernstein and OpenHands bake-off on 3 tracer tasks; record Pareto result.

## 5. Open items / UNVERIFIED
- Whether `anthropics` hooks count (33) and Agent SDK pricing apply to our use; irrelevant while Claude is hub-only.
- GitHub's actual 2026 Iran policy for private repos, Actions and PR APIs; test from the Mac and record in the reachability matrix.
- Bernstein stability; OpenHands Docker footprint on macOS; Docker MCP Gateway license; LangGraph/CrewAI/OpenAI SDK details came from search snippets only.
