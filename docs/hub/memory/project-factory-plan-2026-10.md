---
name: project-factory-plan-2026-10
description: "Decisions for the local agent factory: stack verdicts, autonomy ladder, Mac limits, what is built and what is next (2026-10-04)"
metadata:
  node_type: memory
  type: project
  originSessionId: 8397ea00-8e5d-4ca7-bb7e-b2a46f06fd77
  modified: 2026-10-04T07:00:06.673Z
---

Research docs (merged/open PRs #483-#485): docs/research/MODEL_AND_COMPUTE_PLAN_2026-10.md, AUTONOMY_AND_SAFETY_2026-10.md, AGENT_FACTORY_STACK_2026-10.md, LEGAL_CORPUS_GAP_AUDIT_2026-10.md.

Hardware: MacBook Air M4, 10 cores, 16 GB, fanless: only 4-8B local models; run ~5-10 concurrent agents; cheap executor DeepSeek V4 Flash, reviewer MUST be a different model family (currently same family: gap), embeddings bge-m3 + bge-reranker-v2-m3.

Stack verdicts: ADOPT OpenCode (move to `opencode serve`), own Factory+rx as control plane, git worktree per agent, local sequential integrator, Claude Code only as human-directed hub (Iran is not in Anthropic's supported-country list: owner's account matter). TRY DBOS, Bernstein ideas, OpenHands, Goose. SKIP Temporal, Inngest, Restate, LangGraph, CrewAI, OpenAI Agents SDK. Hidden acceptance tests outside the worker worktree are mandatory (cheap models overfit visible tests).

Autonomy ladder (config/autonomy_ladder.json, PR #486): L0 docs auto; L1 non-sensitive code/tests auto if local_ci green, <=400 lines, no deleted/weakened tests, new tests, no new manifests; L2 smartjudge prompts/retrieval/corpus/models.yaml need `hub-approved`; L3 auth/billing/migrations/manifests/tenant owner reads; L4 .github, scripts/ci, rx, ops, compose, nginx, budget.py owner-only. Deploy only after smoke test; migrations never auto.

Built by 2026-10-04: smartjudge never-empty answers + Latin digits + 6 court types (#478), /draft-ruling page (#482), fallback chains (#481), check_keys (+OmniRoute), local integrator #486, task caps+ledger #487 (rx not yet wired). Next: wire rx to caps, `opencode serve` spike, gate gap fixes, safe deploy script (owner runs it; prod writes need owner OK), ingest legal corpus in batches (owner approval per batch, separate Qdrant collection), restyle from the owner's reference image (tokens in globals.css `.ap-theme`).

Also built 2026-10-04: model bake-off harness (#490/#491/#492, ids unverified until `--list-verify`), Open Design workflow doc (#489), merge-time lesson: agents' test files must load scripts inside fixtures (quarantine guard) and the owner's terminal Run buttons replay OLD command blocks, so give ONE command block per message and avoid listing old PR numbers. In progress at the end of the day: court taxonomy + court-suggest + indictment draft (backend), court picker UI + /draft-indictment, quality-gated escalation (cheap->strong, never :free for case data), Persian STT bake-off (MAI-Transcribe Persian support unverified). Owner wants the hub to act as an orchestrator without re-asking permission; only merges (`gh pr merge N --squash --admin`) and prod deploys need the owner.

Later 2026-10-04: merged court-aware drafting (#494), ingestion pipeline (#503, local-only; staged v2 file has 99 duplicate-key rows to fix before apply), sanitized public export (#504), prompt library behind SMARTJUDGE_PROMPT_LIBRARY=1 (#505). Open: #502 deploy_local.sh (unverified server layout: run `check` first), #506 chat restyle (owner must run npm build; header token count hard-coded 0). INFRA GOTCHA: the Claude desktop app cleans up agent worktrees and leaves `core.bare=true` in the main repo's .git/config; run `git config core.bare false` at the START of every bash chain before git ops, launch agents ONE at a time, and tell the owner if `git checkout` says 'must be run in a work tree'. The env-var override GIT_CONFIG_* does NOT work for this. rx (OpenCode pool/dsflash) works again after #499 (my #473 allowlist had hidden the `pool` provider): always check ~/.config/opencode providers (pool, omniroute) before changing enabled_providers. rx failed tests only because of core.bare, not model quality. All 5 bake-off model ids FOUND on OpenRouter; model_bakeoff real run started 2026-10-04.

**Why:** keeps strategy coherent across sessions. **How to apply:** read with [[project-keys-and-local-infra]]; sensitive paths need owner review; do not pay for GitHub/Actions or free-tier lanes for case data.
