---
name: feedback-opencode-builds-claude-supervises
description: "Owner 2026-11-05 — OpenCode/fleet and other non-Claude agents do the bulk of building on both machines; Claude only briefs, reviews and merges"
metadata:
  node_type: memory
  type: feedback
  originSessionId: d089f50d-4d5d-43d3-9d64-464656318ead
  modified: 2026-11-04T20:54:31.697Z
---

Owner (2026-11-05): save Anthropic tokens so we stop hitting limits. The bulk of execution goes to OpenCode (key pool, free models first, then DeepSeek V4.1 Flash, off-peak 19:30–03:30 Tehran) and other non-Claude agents. Claude sessions act as supervisor only: write small exact briefs (files + acceptance test), read diffs, merge green no-blocker PRs, close fabrications, and code themselves only after a task fails twice in fleet.

**Why:** Many Claude sessions hit the 5-hour limit repeatedly on 2026-11-04.

**How to apply:** On the Mac, new work becomes fleet issues rather than new Claude sessions; existing sessions finish their open PR and hand the rest to fleet. On the laptop, 4 of 5 slots are OpenCode with the colleague's own accounts (rule posted on #227). Cross-family review via the hourly review desk (fallback fixed in #356). Related: [[feedback-cheap-execution-only]], [[project-accounting-first]].
