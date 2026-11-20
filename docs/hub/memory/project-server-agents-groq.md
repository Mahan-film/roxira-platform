---
name: project-server-agents-groq
description: Server-side OpenCode agents on <ip> with 3 Groq keys — SMOKE PASS 2026-10-13; how to dispatch
metadata:
  node_type: memory
  type: project
  originSessionId: 0fd9cb50-0fa4-4312-aca1-111eeb5c9f87
  modified: 2026-10-13T00:08:29.489Z
---

Since 2026-10-13, server agents (PR #591) work: `ssh <ip> "/opt/roxira_platform/scripts/infra/server_agents/run_task.sh ..."`. The smoke test passed with groq-fast (gpt-oss-20b) in 54 s, using key index 1. Runs as the unprivileged roxira-agent user, only on agent/* branches, never pushes. OPENROUTER_API_KEY_AGENTS was skipped, so ds-flash, free-public and the 429 fallback are unavailable. The server's old OpenCode 1.18.30 is broken (it points at the LiteLLM :4000 pool, which is down). Use run_task.sh instead.

**Why:** owner wants mechanical work done by cheap server agents (Groq) to save Claude tokens.

**How to apply:** send low-risk mechanical tasks (parsers, docs, tests) to groq-strong or groq-fast through run_task.sh, then review the diff before the hub commits. Never send customer or case data. Related: [[feedback-cheap-execution-only]], [[project-keys-and-local-infra]].
