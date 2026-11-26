# Agentic tooling research — 2026-10-01

## Decision in one page

Roxira already has the important control plane: small issues, isolated worktrees,
ephemeral GitHub runners, a different-family reviewer, `codebase-memory` for code
navigation, `qmd` for Markdown, `engram` for small local lessons, and an explicit
cost/model registry. Do not replace that with a general agent platform or another
gateway. The highest-value additions are: a **local, bounded context packer** for
exceptional cross-cutting work; **portable on-demand skills**; and **deterministic
gateway eval fixtures**. Trace UI is a later, self-hosted-only decision.

**Method.** Metadata below is a 2026-10-01 GitHub snapshot (stars rounded; `main`
last commit, not release date). Candidates had a commit after 2026-04-01 and clear
public adoption. "Network" means an avoidable outbound data path, not normal model
inference. Never route a paid subscription/OAuth account through a proxy; use only
direct provider API keys and the existing LiteLLM/OmniRoute endpoints.

## A. Context compression and repository navigation

| Tool | Snapshot / fit | Delta from Roxira | Security | Verdict |
|---|---|---|---|---|
| [Repomix](https://github.com/yamadashy/repomix) ([history](https://github.com/yamadashy/repomix/commits/main)) | ~28.6k stars; 2026-09-23; MIT. Local CLI packs selected files and has Tree-sitter `--compress`, token counts, ignore rules and secret-pattern exclusion. | Adds an **explicit, disposable file list → compact handoff** for a large review or a fresh worker. It does not replace `codebase-memory` symbol/call queries or `qmd` docs search. | Local CLI needs no account/key; the hosted web/remote-repo modes do make network calls. Packed output can still contain sensitive source: keep it ignored and never upload it. | **ADAPT.** Add a narrow `--stdin --compress` helper for worker handoffs; preserve `docs/STRATEGY.md`'s rule never to read a whole-repo output by default. |
| [Aider](https://github.com/Aider-AI/aider) ([history](https://github.com/Aider-AI/aider/commits/main)) | ~49.3k; 2026-05-22; Apache-2.0. Mature terminal editor with a Tree-sitter repo map. | Its repo-map design validates selective structural context, but its editing loop duplicates Codex CLI/OpenCode and `rx`. | Sends selected source to whichever model endpoint it is configured for; it has no reason to proxy a subscription account. | **SKIP.** Borrow the repo-map principle; do not add a third worker harness. |
| `codebase-memory` MCP (existing) | Already indexed here; its graph search/trace paths are the right lazy alternative to whole-repo packing. | Already replaces code-index MCP servers, Graphify/Serena-class duplicate indexes, and most repo-map need. | Existing MCP server count/tool schemas must stay small. | **ADOPT (keep).** Make it the default for "where/who calls" and invoke Repomix only after a bounded file list is known. |
| [LLMLingua](https://github.com/microsoft/LLMLingua) ([history](https://github.com/microsoft/LLMLingua/commits/main)) | ~6.7k; **2025-10-28**; MIT. Research-grade prompt/KV compressor. | Would add lossy natural-language compression, not code navigation. | Local model downloads are a supply-chain/network event; compression can remove legal or operational qualifiers. | **SKIP / freshness fail.** It misses the six-month rule; do not insert lossy compression ahead of legal/coding instructions. |

## B. Memory and documentation for agents

| Tool / convention | Snapshot / fit | Delta from Roxira | Security | Verdict |
|---|---|---|---|---|
| [Agent Skills](https://github.com/agentskills/agentskills) ([history](https://github.com/agentskills/agentskills/commits/main)) | ~25.4k; 2026-08-09; Apache-2.0 (docs CC-BY-4.0). A `SKILL.md` plus optional scripts/references/assets, loaded progressively. | Formalises the useful part of `.claude/agents/` and Codex skills so procedural knowledge is loaded on demand rather than pasted into `AGENTS.md`. | Skills can bundle executable scripts: review and pin local content; never install arbitrary marketplace skills in CI. | **ADAPT.** Keep `AGENTS.md` short; move repeatable repo-only procedures into versioned, audited skills compatible with the standard. |
| [`llms.txt` v2](https://llmstxt.org/) | A published Markdown convention, not a package; therefore no stars/commit/license metric. It is a concise route map to human and machine-readable docs. | Adds a public/docs-facing index; it does not replace `qmd`, ADRs, `SYSTEM_MAP.md`, or `AGENTS.md`. | Static file; links can become stale. Do not expose internal topology, credentials, case/customer material or private URLs. | **ADAPT, later.** Generate a public-safe `docs/llms.txt` only when the documentation site exists; keep private operating instructions in-repo. |
| ADR Markdown + current `docs/decisions/` | No new runtime required. Numbered, reviewed Markdown is already searchable by `qmd` and legible to every worker. | Already supplies durable, reviewable "why"; a CLI would only automate filenames. | No network/telemetry. | **ADOPT (keep).** Add an ADR index/check, not another documentation store. |
| [Mem0](https://github.com/mem0ai/mem0) ([history](https://github.com/mem0ai/mem0/commits/main)) | ~66.4k; 2026-09-30; Apache-2.0. Production-oriented extraction/retrieval memory. | Duplicates `engram` + Markdown source of truth while adding LLM/vector extraction infrastructure. | Cloud product is optional but easy to select; memory extraction can send sensitive facts to an LLM/provider. | **SKIP.** High adoption, wrong abstraction for verified engineering decisions. |
| [MCP Memory Service](https://github.com/doobidoo/mcp-memory-service) ([history](https://github.com/doobidoo/mcp-memory-service/commits/main)) | ~2.0k; 2026-09-29; Apache-2.0. Local semantic memory/graph with optional cloud/hybrid sync. | More capable cross-client recall than `engram`, but overlaps it and adds another write-capable MCP/database. | Disable cloud/hybrid sync and inspect migrations/backups if ever piloted. An MCP server acts with the client’s permissions. | **SKIP.** Current local SQLite `engram` + reviewed docs are simpler and auditable. |

## C. Orchestration and queues for coding work

| Tool | Snapshot / fit | Delta from Roxira | Security | Verdict |
|---|---|---|---|---|
| [GitHub Agentic Workflows (`gh-aw`)](https://github.com/github/gh-aw) ([history](https://github.com/github/gh-aw/commits/main)) | ~5.2k; 2026-09-12; MIT. Markdown workflow source compiles to Actions; supports Codex/Claude and guarded "safe outputs". | Its read-only investigation, compile/audit and least-privilege patterns improve *non-code-writing* jobs. It duplicates the existing `agent-task.yml` issue → worktree → OpenCode → PR runner. | Public preview; past versions had a retired security range. Agent workflow authors must audit permissions, network allow-list and prompt-injection boundaries. API keys only; never subscription-token relay. | **ADAPT.** Borrow its read-only/safe-output rules for a weekly docs/queue report; do not migrate the existing worker lane. |
| [OpenHands](https://github.com/OpenHands/OpenHands) ([history](https://github.com/OpenHands/OpenHands/commits/main)) | ~88k; 2026-09-11; MIT. Full agent server, UI, automation and sandboxing. | Replaces far more than needed and duplicates Codex/OpenCode, `rx`, worktrees, CI and review. | A broad agent platform expands credentials, container and MCP attack surface. | **SKIP.** Reference its isolation ideas only; do not operate a second agent platform. |
| [SWE-agent](https://github.com/SWE-agent/SWE-agent) ([history](https://github.com/SWE-agent/SWE-agent/commits/main)) | ~20.4k; 2026-07-16; MIT. Issue-to-fix agent with isolated agent-computer interfaces. | Docker sandboxing and task trajectory format are useful ideas; operationally it duplicates the one-issue worker pipeline. | Model/provider traffic is configurable; container isolation still needs image/update and secret controls. | **SKIP.** Keep the smaller, already policy-gated `agent-task.yml` runner. |

## D. Evaluation, observability and gateway cost

| Tool | Snapshot / fit | Delta from Roxira | Security | Verdict |
|---|---|---|---|---|
| [Promptfoo](https://github.com/promptfoo/promptfoo) ([history](https://github.com/promptfoo/promptfoo/commits/main)) | ~20k; 2026-09-11; MIT. Declarative assertions and model comparisons; works with OpenAI-compatible endpoints and CI. | Adds repeatable pass/fail fixtures around the existing `scripts/eval_coding_smoke.py`, LiteLLM and local OmniRoute pilot; it is not a router or trace store. | Local by default, but live providers receive fixtures; use synthetic/redacted prompts and disable browser/cloud sharing features. | **ADOPT.** Best low-infrastructure guard against a cheap-model or gateway regression. |
| [Langfuse](https://github.com/langfuse/langfuse) ([history](https://github.com/langfuse/langfuse/commits/main)) | ~35.2k; 2026-09-11; MIT. Self-hosted traces, scores, datasets and evals; LiteLLM callback-compatible. | Adds searchable per-request latency/cost/quality traces beyond the existing cost ledger; it does not replace LiteLLM/OmniRoute routing. | Cloud is optional; self-host with telemetry disabled and redact/hash prompts. Raw traces may contain case data. | **DEFER.** Adopt only after Promptfoo shows a measurement gap; it introduces a substantial stateful data service. |
| [OpenLIT](https://github.com/openlit/openlit) ([history](https://github.com/openlit/openlit/commits/main)) | ~2.5k; 2026-09-04; Apache-2.0. OpenTelemetry-oriented AI tracing/evals. | Alternative to Langfuse and extra OTel plumbing; duplicates LiteLLM cost logging. | Telemetry/exporter destinations must be explicitly local; traces can contain prompts. | **SKIP.** Choose one trace store, if any; Langfuse has the stronger adoption/ecosystem fit. |

## Adoption plan — six small, offline-testable tasks

1. **Add deterministic gateway fixtures first.** Create `evals/gateway/promptfooconfig.yaml` and synthetic `evals/gateway/cases.yaml`; use Promptfoo's local `echo` provider in that fixture and test with `npx --offline promptfoo@<pinned-version> eval -c evals/gateway/promptfooconfig.yaml --no-share --no-write` (after the package is cached). Wire a separate follow-up to compare the LiteLLM and local OmniRoute OpenAI-compatible base URLs.
2. **Make the existing smoke gate consume the same fixtures.** Update `scripts/eval_coding_smoke.py` to emit/consume JSONL cases under `evals/gateway/`; verify offline with `python3 scripts/eval_coding_smoke.py --offline`.
3. **Add a bounded packing helper, not an MCP server.** Create `scripts/dev/pack_agent_context.sh` that accepts a newline file list and calls a pinned local `repomix --stdin --compress`; add `tests/scripts/test_pack_agent_context.sh`; test with `bash tests/scripts/test_pack_agent_context.sh` using only fixture files. Keep outputs in the existing ignore list.
4. **Publish the context-selection rule.** Amend `docs/STRATEGY.md` and `AGENTS.md`: `codebase-memory`/`qmd` first, file-list packing only for a documented cross-cutting task, never whole-repo or customer data. Test with `rg -n "pack_agent_context|codebase-memory.*first" AGENTS.md docs/STRATEGY.md`.
5. **Convert one repeated procedure to a portable skill.** Add `.agents/skills/agent-issue-handoff/SKILL.md` with the issue-size, worktree, permitted-command and validation contract derived from `docs/AGENTS_WORKFORCE.md`; test metadata and links with `rg -n "^(name|description):|agent-task.yml|eval_coding_smoke" .agents/skills/agent-issue-handoff/SKILL.md`.
6. **Add a no-network ADR/docs integrity check.** Create `scripts/check_agent_docs.py` to require an ADR status, a `STATE.md`/`SYSTEM_MAP.md` cross-reference for changed worker policy, and no secrets; run `python3 scripts/check_agent_docs.py --offline`. Defer Langfuse deployment until this and Promptfoo results demonstrate that ledger-only reporting cannot answer a real incident.

## Sources and limits

The linked repositories and their commit-history pages above are the primary sources
used for this review; the offline fixture follows Promptfoo's [CLI reference](https://github.com/promptfoo/promptfoo/blob/main/site/docs/usage/command-line.md?plain=1)
and [Echo provider](https://www.promptfoo.dev/docs/providers/echo/). Stars are a
popularity signal, not a security review. GitHub source pages sometimes lag the live
repository by days, so pin a release/commit and repeat the metadata check during
implementation. The official MCP reference servers call their memory server an
educational reference rather than a production solution, which reinforces the
decision not to add it here: [MCP Servers](https://github.com/modelcontextprotocol/servers)
and [memory-server README](https://github.com/modelcontextprotocol/servers/blob/main/src/memory/README.md).
