---
name: feedback-no-claude-subagents
description: UPDATED 2026-10-16 — server agents first; when their credit is out, Claude subagents ARE allowed (Haiku 5.5 first, then Sonnet 5.5), in parallel
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0fd9cb50-0fa4-4312-aca1-111eeb5c9f87
  modified: 2026-10-13T18:23:20.852Z
---

The owner keeps hitting Claude usage limits and asked, with strong emphasis, that implementation work NOT be done by me or by Anthropic subagents (the Agent tool with sonnet/haiku). The work should go to their own API keys and open-source tools instead: server OpenCode agents (`run_task.sh`, Groq x3), the key pool gateway (`config/key_pool.yaml`, LiteLLM on srv1 127.0.0.1:4000, group agent-free = Groq first, then paid DeepSeek fallback), and OpenRouter/DeepSeek for reviews.

**Why:** Claude limits block the owner's work; their mission is to build Roxira (and later free education) affordably.

**How to apply:**
- Hub = strategist only: write short task specs and review diffs.
- Dispatch coding to `ssh roxira-prod 'run_task.sh --task ...'`, with or without `--gateway --public`.
- Reviews go to DeepSeek through the server relay.
- Use the Agent tool only when no non-Anthropic path works, and say so.

Related: [[feedback-cheap-execution-only]], [[project-server-agents-groq]].

**Update 2026-10-16 (owner, explicit):** when the server agents have no credit or fail, use Claude subagents in parallel: **Haiku 5.5 first**, then **Sonnet 5.5** for harder work; the hub acts as next-gen architect. Still prefer server agents when funded (they do not consume the owner's Claude limits). Always explain to the owner in Persian.
