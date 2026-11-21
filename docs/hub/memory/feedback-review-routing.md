---
name: feedback-review-routing
description: Owner 2026-11-12 — Haiku 5.5 reviews every Antigravity PR in parallel; Sonnet 5.5 only confirms critical PRs Haiku passed; Haiku triages red CI
metadata:
  node_type: memory
  type: feedback
  originSessionId: d089f50d-4d5d-43d3-9d64-464656318ead
  modified: 2026-11-12T19:49:17.178Z
---

Owner (2026-11-12) wants maximum review speed at minimum cost, "especially Haiku 5.5". Earlier (2026-11-11) rule: important reviews must not be left to DeepSeek alone.

**Why:** Review was the bottleneck (14 open PRs, half blocked); Haiku is cheap and fast, Sonnet is kept for money/tax/tenant/auth/migrations.

**Superseded 2026-11-12 evening:** Claude quota nearly gone → desk is DeepSeek-only every 2 h, no Claude agents (see [[project-team-operating-model-2026-11-12]]).

**How to apply (old):** `roxira-review-desk` runs at :07/:27/:47. Step A: Haiku CI triage comment (`CI triage @ sha`) on red PRs, max 6/run. Step B: Haiku reviewer for every Antigravity PR, in parallel, max 10/run; critical PRs get Sonnet only after Haiku says no blocker (max 4 Sonnet/run). Laptop (Claude-authored) PRs still need DeepSeek via OpenCode for a different family. Raise to more Antigravity chats only when the open PR queue is under ~8. Related: [[feedback-opencode-builds-claude-supervises]], [[feedback-antigravity-owner-relay]].
