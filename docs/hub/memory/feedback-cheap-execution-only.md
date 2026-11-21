---
name: feedback-cheap-execution-only
description: HARD RULE from the owner — Opus does zero implementation; strategy/architecture only; all execution by cheap models
metadata:
  node_type: memory
  type: feedback
  originSessionId: 4da31019-fd4c-4f74-bea0-a21965e340d9
  modified: 2026-09-28T12:18:09.321Z
---

**HARD RULE (owner, 2026-09-28, repeated many times, explicitly "hardcore/strict"):** Opus (me) performs NO implementation work at all: no code edits, no commits, no fixing tests, no debugging, and no running deploy or merge commands for work that cheap models could do. My role is strategist and architect only: decide, plan, write the task spec, review the result and give a verdict.

Execution goes only to cheaper models, in this order:
1. GitHub `agent` issues (OpenCode on GitHub runners, DeepSeek via OpenRouter).
2. Local OpenCode on the owner's Mac with the free-key pool (`pool/gptoss`, `pool/codestral`, `pool/qwen`). The owner runs the command I give, because the classifier blocks me from launching unattended OpenCode runs.
3. Claude Sonnet subagents only as a last resort, at most one at a time, and only if the owner agrees.

**Why:** Claude quota runs out. Five parallel Sonnet agents hit the session limit in about an hour on 2026-09-28. On that same day I still ended up fixing YAML, tests and commits myself, and the owner was angry.

**How to apply:** when something breaks (a cheap model's bad edit, failing tests), write a corrective spec for a cheap model. Do not fix it myself. Keep my own tool calls to reading and reviewing. Related: [[feedback-hub-delegation]], [[feedback-owner-minimal-work]].
