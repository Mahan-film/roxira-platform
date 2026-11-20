---
name: feedback-hub-delegation
description: Owner wants the Opus chat to act as strategist only and delegate execution to Sonnet 5 subagents; auto-mode blocks subagent prod writes
metadata:
  node_type: memory
  type: feedback
  originSessionId: f7ba6c6a-595b-41b2-b969-c1e5a8883d7a
  modified: 2026-09-26T13:21:22.338Z
---

In the hub chat, the owner wants Claude to act as **strategist**: review the whole system, update docs/STRATEGY.md, and hand implementation to separate Sonnet 5 chats/subagents (max 3 in parallel, each in its own worktree), to save tokens and avoid hitting limits.

2026-09-26: the owner wants the hub on Opus 5.5 and workstreams on Sonnet 5, running as parallel chats. Small tasks go to GitHub `agent` issues, which run on the OpenRouter key instead of the Claude quota. On context handoff: run `/handoff`, which updates `docs/STATE.md` and prints a starter prompt for the next chat. The playbook is `docs/PARALLEL_CHATS.md`.

**Why:** said on 2026-09-24: "تو فقط استراتژیست هستی". Token/limit management is an explicit goal.

**How to apply:** spawn background Sonnet agents with `isolation: worktree`. Tell them not to edit STRATEGY.md; the hub merges status. Scope agents as LOCAL-ONLY plus read-only ssh: the auto-mode classifier denies subagent launches whose prompt includes writes on the prod server ("Remote Shell Writes"). Do server runs as a separate step after the owner approves in chat. Related: [[project-roxira-overview]], [[feedback-never-collect-src-tests]].
